import {contextForCard} from './context.js';
import {COMPARISON_MAX_AGE_MS} from './comparison.js';
import {rankContextualCards,type ContextualReadingCard} from './contextual.js';
import {PUBLIC_TOPICS} from './topics.js';
import type {EvidenceCard,Topic} from './contracts.js';
import {PUBLIC_EDITORIAL_CATEGORIES,editorialCategory,headlineSignalPriority,type PublicEditorialCategory} from './editorial-categories.js';
import {compareEditorialCards,rankEditorialCards,type EditorialReadingCard,type RankedEditorialCard} from './editorial-ranking.js';
import {validateEditorialContext,type EditorialReaderContext} from './editorial-relevance.js';
export type {EditorialReadingCard} from './editorial-ranking.js';

/** Compact-top preferences only, never limits on the complete eligible publication stream. */
export const DAILY_EDITION_POLICY=Object.freeze({minimum:20,target:30,maximum:40,perCategory:2,perTopic:2,perPublisher:4,windowMs:86_400_000} as const);
export interface TodayContext extends EditorialReaderContext {
  /** Deliberate legacy local callers keep their existing contextual reader rules. */
  readonly localEdition?:boolean;
  /** Number of front-page places; additional eligible publications remain in more. */
  readonly limit?:20|30|40;
}
export interface DailyEditionCoverage {
  readonly windowStart:string;
  readonly windowEnd:string;
  readonly minimum:20;
  readonly target:30;
  readonly limit:20|30|40;
  /** Persisted Topic compatibility; public coverage uses the separate category arrays below. */
  readonly selectedTopics:readonly Topic[];
  readonly availableTopics:readonly Topic[];
  readonly missingTopics:readonly Topic[];
  readonly selectedCategories:readonly PublicEditorialCategory[];
  readonly availableCategories:readonly PublicEditorialCategory[];
  readonly missingCategories:readonly PublicEditorialCategory[];
  readonly completeCoverage:boolean;
  readonly belowMinimum:boolean;
  readonly belowTarget:boolean;
  readonly eligibleCount:number;
}
export interface ContextualToday {
  /** Balanced compact top; its count is not a limit on coverage. */
  readonly first:readonly EditorialReadingCard[];
  /** All remaining eligible unique publications, ranked for progressive reading. */
  readonly more:readonly EditorialReadingCard[];
  readonly daily?:DailyEditionCoverage;
}

/** Match one representative per category before any category gets a second story. */
function representatives<T extends ContextualReadingCard,K extends string>(candidates:readonly T[],keyOf:(view:T)=>K,order:readonly K[]):readonly T[] {
  const options=new Map<K,T[]>();
  for(const view of candidates){
    const key=keyOf(view),group=options.get(key)??[];
    if(!group.some(candidate=>publisherKey(candidate)===publisherKey(view)))group.push(view);
    options.set(key,group);
  }
  const slots=new Map<string,T>();
  const assign=(key:K,visited:Set<string>):boolean=>{
    for(const view of options.get(key)??[]){
      for(let index=0;index<DAILY_EDITION_POLICY.perPublisher;index++){
        const slot=JSON.stringify([publisherKey(view),index]);
        if(visited.has(slot))continue;
        visited.add(slot);
        const previous=slots.get(slot);
        if(previous===undefined||assign(keyOf(previous),visited)){slots.set(slot,view);return true;}
      }
    }
    return false;
  };
  const keys=[...options.keys()].sort((a,b)=>(options.get(a)?.length??0)-(options.get(b)?.length??0)||order.indexOf(a)-order.indexOf(b));
  for(const key of keys)assign(key,new Set());
  const positions=new Map(candidates.map((view,index)=>[view.card.id,index]));
  return [...slots.values()].sort((a,b)=>(positions.get(a.card.id)??0)-(positions.get(b.card.id)??0));
}

function publisherKey(view:ContextualReadingCard):string {
  return view.card.publisher.normalize('NFKC').trim().toLowerCase();
}
function storyKey(view:ContextualReadingCard):string {
  return view.storyKey??JSON.stringify(['article',view.card.identity]);
}

function coverage(first:readonly EditorialReadingCard[],candidates:readonly EditorialReadingCard[],now:number,limit:20|30|40):DailyEditionCoverage {
  const selectedTopics=PUBLIC_TOPICS.filter(topic=>first.some(view=>view.card.topic===topic));
  const availableTopics=PUBLIC_TOPICS.filter(topic=>candidates.some(view=>view.card.topic===topic));
  const selectedCategories=PUBLIC_EDITORIAL_CATEGORIES.filter(category=>first.some(view=>view.category===category));
  const availableCategories=PUBLIC_EDITORIAL_CATEGORIES.filter(category=>candidates.some(view=>view.category===category));
  const missingCategories=PUBLIC_EDITORIAL_CATEGORIES.filter(category=>!selectedCategories.includes(category));
  return Object.freeze({windowStart:new Date(now-DAILY_EDITION_POLICY.windowMs).toISOString(),windowEnd:new Date(now).toISOString(),minimum:20,target:30,limit,
    selectedTopics:Object.freeze(selectedTopics),availableTopics:Object.freeze(availableTopics),missingTopics:Object.freeze(PUBLIC_TOPICS.filter(topic=>!selectedTopics.includes(topic))),
    selectedCategories:Object.freeze(selectedCategories),availableCategories:Object.freeze(availableCategories),missingCategories:Object.freeze(missingCategories),
    completeCoverage:missingCategories.length===0,belowMinimum:first.length<DAILY_EDITION_POLICY.minimum,belowTarget:first.length<DAILY_EDITION_POLICY.target,eligibleCount:candidates.length});
}

/** Importance precedes top-page balance. Every other eligible story remains accessible in more. */
export function selectContextualToday(records:readonly EvidenceCard[],context:TodayContext,now:number):ContextualToday {
  const limit=context.limit??DAILY_EDITION_POLICY.target;
  if(![20,30,40].includes(limit))throw Error('DAILY_EDITION_LIMIT_INVALID');
  if(!Number.isFinite(now)||records.length>5000)throw Error('DAILY_EDITION_CONTEXT_INVALID');
  validateEditorialContext(context);
  if(context.localEdition)return selectLocalToday(records,context,now,limit);
  const candidates=rankEditorialCards(records,now,context),first:RankedEditorialCard[]=[];
  const featured=(view:RankedEditorialCard):boolean=>view.editorial.signals.includes('publisher-frontpage');
  const priority=(view:RankedEditorialCard):number=>headlineSignalPriority(view.editorial.headlineSignals);
  const strength=(view:RankedEditorialCard):string=>JSON.stringify([view.editorial.developmentPriority,view.editorial.relevance.priority,
    view.editorial.classification==='category-discovery'||view.card.sourceIds.includes('news-unclassified'),priority(view)===2,featured(view),priority(view)]);
  const used=new Set<string>(),identities=new Set<string>(),urls=new Set<string>(),stories=new Set<string>();
  const categories=new Map<PublicEditorialCategory,number>(),publishers=new Map<string,number>();
  const available=(view:RankedEditorialCard,firstCategory=false):boolean=>!stories.has(storyKey(view))&&!used.has(view.card.id)&&!identities.has(view.card.identity)&&!urls.has(view.card.sourceUrl)
    &&(view.category===undefined||view.editorial.globalEssential||(categories.get(view.category)??0)<DAILY_EDITION_POLICY.perCategory)
    &&(view.editorial.globalEssential||view.editorial.developmentPriority>=2&&priority(view)===2||featured(view)
      ||firstCategory&&view.category!==undefined&&!categories.has(view.category)||(publishers.get(publisherKey(view))??0)<DAILY_EDITION_POLICY.perPublisher);
  const take=(view:RankedEditorialCard,firstCategory=false):boolean=>{
    if(first.length>=limit||!available(view,firstCategory))return false;
    first.push(view);
    stories.add(storyKey(view));
    for(const card of [view.card,...view.related]){used.add(card.id);identities.add(card.identity);urls.add(card.sourceUrl);}
    if(view.category!==undefined)categories.set(view.category,(categories.get(view.category)??0)+1);
    publishers.set(publisherKey(view),(publishers.get(publisherKey(view))??0)+1);
    return true;
  };
  // A third essential development is not exchanged for a weak category filler.
  // The compact-top ceiling remains bounded; overflow stays in the complete stream.
  for(const view of candidates)if(view.editorial.globalEssential)take(view,true);
  // Explanatory/listicle/minor-product items stay accessible below rather than
  // padding the compact top to a promised number or category count.
  for(const developmentPriority of [2,1]){
    const level=candidates.filter(view=>view.editorial.developmentPriority===developmentPriority);
    // Confirmed publisher placement can earn a top position without a category label.
    for(const view of level)if(view.category===undefined&&featured(view))take(view);
    const classified=level.filter((view):view is RankedEditorialCard&{readonly category:PublicEditorialCategory}=>view.category!==undefined);
    const bestStrength=new Map<PublicEditorialCategory,string>();
    for(const view of classified)if(!categories.has(view.category)&&!bestStrength.has(view.category))bestStrength.set(view.category,strength(view));
    const representativePool=classified.filter(view=>!categories.has(view.category)&&strength(view)===bestStrength.get(view.category));
    for(const view of representatives(representativePool,view=>view.category,PUBLIC_EDITORIAL_CATEGORIES))take(view);
    for(const view of classified)if(!categories.has(view.category))take(view,true);
    for(const view of level){if(first.length>=limit)break;take(view);}
  }
  // Diversity controls membership. Readers see importance and context order,
  // rather than a mechanical first-category/second-category sequence.
  first.sort(compareEditorialCards);
  const more=candidates.filter(view=>!stories.has(storyKey(view))&&!used.has(view.card.id)&&!identities.has(view.card.identity)&&!urls.has(view.card.sourceUrl));
  return Object.freeze({first:Object.freeze(first),more:Object.freeze(more),daily:coverage(first,candidates,now,limit)});
}

/** The explicit local-only path retains the prior personal reader ordering and eligibility. */
function selectLocalToday(records:readonly EvidenceCard[],context:TodayContext,now:number,limit:20|30|40):ContextualToday {
  const countryCode=(context.city?.countryCode??context.countryCode)?.toUpperCase()??null;
  const eligible=records.filter(card=>{
    if(card.dateLabel==='Document date'||card.kind==='legal-document')return false;
    const geography=contextForCard(card);
    if(countryCode&&geography.basis==='publisher-scope'&&geography.countries.length&&!geography.countries.some(country=>country.code===countryCode))return false;
    return !['regulation','opportunities'].includes(card.topic)||context.preferredTopics.includes(card.topic);
  });
  const ranked=rankContextualCards(eligible,{countryCode,topics:PUBLIC_TOPICS,query:'',budget:Math.max(1,records.length),publicationWindowMs:DAILY_EDITION_POLICY.windowMs},now);
  const candidates:EditorialReadingCard[]=ranked.map((view,index)=>({view,index})).sort((a,b)=>Number(b.view.localMatch)-Number(a.view.localMatch)
    ||Number(context.preferredTopics.includes(b.view.card.topic))-Number(context.preferredTopics.includes(a.view.card.topic))||a.index-b.index).map(({view})=>{
      const category=editorialCategory(view.card);
      return category===null?view:{...view,category};
    });
  const first:EditorialReadingCard[]=[],used=new Set<string>(),identities=new Set<string>(),urls=new Set<string>(),stories=new Set<string>(),topics=new Map<Topic,number>(),publishers=new Map<string,number>();
  const available=(view:EditorialReadingCard):boolean=>!stories.has(storyKey(view))&&!used.has(view.card.id)&&!identities.has(view.card.identity)&&!urls.has(view.card.sourceUrl)
    &&(topics.get(view.card.topic)??0)<3&&(publishers.get(publisherKey(view))??0)<DAILY_EDITION_POLICY.perPublisher;
  const take=(view:EditorialReadingCard):boolean=>{
    if(first.length>=limit||!available(view))return false;
    first.push(context.preferredTopics.includes(view.card.topic)?{...view,reason:`From your saved interests. ${view.reason}`}:view);
    stories.add(storyKey(view));
    for(const card of [view.card,...view.related]){used.add(card.id);identities.add(card.identity);urls.add(card.sourceUrl);}
    topics.set(view.card.topic,(topics.get(view.card.topic)??0)+1);publishers.set(publisherKey(view),(publishers.get(publisherKey(view))??0)+1);return true;
  };
  for(const view of representatives(candidates,view=>view.card.topic,PUBLIC_TOPICS))take(view);
  while(first.length<limit){
    const remaining=candidates.filter(available);if(!remaining.length)break;
    const fewest=Math.min(...remaining.map(view=>topics.get(view.card.topic)??0));
    const next=remaining.find(view=>(topics.get(view.card.topic)??0)===fewest);if(!next||!take(next))break;
  }
  return Object.freeze({first:Object.freeze(first),more:Object.freeze([]),daily:coverage(first,candidates,now,limit)});
}

/** Reproject at the exact daily-window or source-check boundary; never renew source dates. */
export function nextDailyEditionDelay(selection:ContextualToday,now:number):number|null {
  const cards=[...selection.first,...selection.more].flatMap(view=>[view.card,...view.related]);
  const boundaries=cards.flatMap(card=>[Date.parse(card.observedAt)+COMPARISON_MAX_AGE_MS,Date.parse(card.date)+DAILY_EDITION_POLICY.windowMs]).filter(value=>Number.isFinite(value)&&value>now);
  return boundaries.length?Math.min(2_147_483_647,Math.max(25,Math.min(...boundaries)-now+1)):null;
}
