import type {ContextualToday} from './contextual-today.js';
import type {EvidenceCard} from './contracts.js';
import {rankEditorialCards,type EditorialReadingCard} from './editorial-ranking.js';
import {COMPARISON_MAX_AGE_MS} from './comparison.js';
import {cardContent} from './card-validation.js';
import {editorialCategory,PUBLIC_EDITORIAL_CATEGORIES} from './editorial-categories.js';
import {PUBLIC_TOPICS} from './topics.js';
import {storyThreadKey} from './story-grouping.js';

export const PUBLIC_EDITION_POLL_MS=30_000;
export interface EditionChanges {readonly added:number;readonly updated:number;readonly removed:number;readonly total:number}
export interface LiveEditionView {readonly selection:ContextualToday;readonly changes:EditionChanges}

/** Publisher content only. Rechecking a source or changing its homepage order is not news. */
export function editionCardSignature(card:EvidenceCard):string {
  return JSON.stringify([card.id,card.identity,card.title,card.topic,card.kind,card.sourceUrl,card.publisher,
    card.date,card.dateLabel,card.summary??null,card.byline??null,card.licenseUrl??null,
    card.deadline,card.version,cardContent(card).context??null]);
}
export function editionStoryKey(view:Pick<EditorialReadingCard,'card'|'storyKey'>):string {
  return view.storyKey??storyThreadKey(view.card)??JSON.stringify(['article',view.card.identity]);
}
/** Changing the visible representative or related-source order changes no information. */
export function editionStorySignature(view:Pick<EditorialReadingCard,'card'|'related'>):string {
  return JSON.stringify([view.card,...view.related].map(editionCardSignature).sort());
}
function editionIndex(views:readonly EditorialReadingCard[]):{
  readonly stories:ReadonlyMap<string,EditorialReadingCard>;
  readonly originals:ReadonlyMap<string,EditorialReadingCard>;
} {
  const stories=new Map<string,EditorialReadingCard>(),originals=new Map<string,EditorialReadingCard>();
  for(const view of views){
    stories.set(editionStoryKey(view),view);
    for(const card of [view.card,...view.related])originals.set(card.identity,view);
  }
  return {stories,originals};
}
function matchingView(view:EditorialReadingCard,index:ReturnType<typeof editionIndex>,used:ReadonlySet<string>=new Set()):EditorialReadingCard|undefined {
  const keyed=index.stories.get(editionStoryKey(view));
  if(keyed!==undefined&&!used.has(editionStoryKey(keyed)))return keyed;
  // Editing an existing article can change its exact-headline thread key.
  // Its unchanged original identity still establishes an update, not a new story.
  for(const card of [view.card,...view.related]){
    const original=index.originals.get(card.identity);
    if(original!==undefined&&!used.has(editionStoryKey(original)))return original;
  }
  return undefined;
}
export function editionChanges(before:ContextualToday,after:ContextualToday):EditionChanges {
  const prior=editionIndex([...before.first,...before.more]);
  const next=editionIndex([...after.first,...after.more]);
  const matched=new Set<string>();
  let added=0,updated=0,removed=0;
  for(const view of next.stories.values()){
    const old=matchingView(view,prior,matched);
    if(old===undefined){added++;continue;}
    matched.add(editionStoryKey(old));
    if(editionStorySignature(old)!==editionStorySignature(view))updated++;
  }
  for(const key of prior.stories.keys())if(!matched.has(key))removed++;
  return Object.freeze({added,updated,removed,total:added+updated+removed});
}
function current(card:EvidenceCard,now:number):boolean {
  const published=Date.parse(card.date),observed=Date.parse(card.observedAt);
  return card.sourceState!=='stale'&&published<=now&&published>now-86_400_000
    &&observed<=now+300_000&&now-observed<COMPARISON_MAX_AGE_MS;
}
function retainCurrent(view:EditorialReadingCard,fresh:EditorialReadingCard|undefined,now:number):EditorialReadingCard|null {
  if(fresh!==undefined&&editionStorySignature(fresh)===editionStorySignature(view))return fresh;
  const incoming=new Map((fresh?[fresh.card,...fresh.related]:[]).map(card=>[card.id,card]));
  const retained=[view.card,...view.related].map(card=>{
    const checked=incoming.get(card.id);
    return checked!==undefined&&editionCardSignature(checked)===editionCardSignature(card)?checked:card;
  }).filter(card=>current(card,now));
  const primary=retained.find(card=>card.id===view.card.id)??retained[0];
  // An expired representative must not hide a still-current original of the
  // same group, and another publisher's check must never renew the old article.
  if(primary===undefined)return fresh??null;
  const base=primary.id===view.card.id?view:rankEditorialCards([primary],now)[0];
  if(base===undefined)return null;
  return Object.freeze({...base,card:primary,storyKey:editionStoryKey(view),grouping:view.grouping,
    related:Object.freeze(retained.filter(card=>card.id!==primary.id))});
}
function withCards(base:ContextualToday,first:readonly EditorialReadingCard[],more:readonly EditorialReadingCard[],now:number):ContextualToday {
  if(!base.daily)return Object.freeze({first:Object.freeze(first),more:Object.freeze(more)});
  const selectedTopics=PUBLIC_TOPICS.filter(topic=>first.some(view=>view.card.topic===topic));
  const selectedCategories=PUBLIC_EDITORIAL_CATEGORIES.filter(category=>first.some(view=>(view.category??editorialCategory(view.card))===category));
  return Object.freeze({first:Object.freeze(first),more:Object.freeze(more),daily:Object.freeze({...base.daily,
    windowStart:new Date(now-86_400_000).toISOString(),windowEnd:new Date(now).toISOString(),
    selectedTopics,selectedCategories,missingTopics:PUBLIC_TOPICS.filter(topic=>!selectedTopics.includes(topic)),
    missingCategories:PUBLIC_EDITORIAL_CATEGORIES.filter(category=>!selectedCategories.includes(category)),
    completeCoverage:selectedCategories.length===PUBLIC_EDITORIAL_CATEGORIES.length,
    belowMinimum:first.length<base.daily.minimum,belowTarget:first.length<base.daily.target})});
}

/** In-memory reading state only. No profile, browsing history or saved card leaves this browser. */
export class LiveEdition {
  private visible:ContextualToday|null=null;
  private context='';
  present(candidate:ContextualToday,context:string,now:number,apply=false,deferInitial=false):LiveEditionView {
    if(!Number.isFinite(now))throw new Error('LIVE_EDITION_CLOCK_INVALID');
    if(this.visible===null||(this.visible.first.length+this.visible.more.length===0&&!deferInitial)||this.context!==context||apply){this.visible=candidate;this.context=context;}
    else {
      const incoming=editionIndex([...candidate.first,...candidate.more]),used=new Set<string>();
      // Same story, newly checked evidence: update metadata without rearranging the reading order.
      // Materially changed publisher wording stays staged until the reader applies it.
      const retain=(views:readonly EditorialReadingCard[]):readonly EditorialReadingCard[]=>views.flatMap(view=>{
        const fresh=matchingView(view,incoming),key=fresh===undefined?editionStoryKey(view):editionStoryKey(fresh);
        if(used.has(key))return [];
        const copy=retainCurrent(view,fresh,now);
        if(copy===null)return [];
        used.add(key);return [copy];
      });
      this.visible=withCards(candidate,retain(this.visible.first),retain(this.visible.more),now);
    }
    return Object.freeze({selection:this.visible,changes:editionChanges(this.visible,candidate)});
  }
}

export function editionUpdateLabel(changes:EditionChanges):string {
  const parts:string[]=[];
  if(changes.added)parts.push(`${changes.added} new`);
  if(changes.updated)parts.push(`${changes.updated} updated`);
  if(changes.removed)parts.push(`${changes.removed} no longer selected`);
  return parts.join(' · ');
}

export function publicEditionPollDelay(failures:number):number {
  return Math.min(120_000,PUBLIC_EDITION_POLL_MS*2**Math.max(0,Math.min(2,Math.trunc(failures))));
}
