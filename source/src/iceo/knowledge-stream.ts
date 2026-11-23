import {selectKnowledgeCards,validateKnowledgeCatalog,type KnowledgeCard} from './knowledge.js';

/** A knowledge card follows each complete group of 22 original news records. */
export const INLINE_KNOWLEDGE_INTERVAL=23 as const;
const NEWS_PER_KNOWLEDGE=INLINE_KNOWLEDGE_INTERVAL-1;
export type KnowledgeScope='city'|'country'|'global';
export interface InlineKnowledge {
 readonly card:KnowledgeCard;
 readonly scope:KnowledgeScope;
}
export interface KnowledgeStreamContext {
 readonly cityId:string|null;
 readonly countryCode:string|null;
 readonly timeZone?:string;
}
export type KnowledgeStreamItem<T extends {readonly key:string}>=
 |Readonly<{kind:'news';item:T}>
 |Readonly<{kind:'knowledge';item:InlineKnowledge;afterNews:number}>;

function validContext(context:KnowledgeStreamContext):boolean {
 return context!==null&&typeof context==='object'&&
  (context.countryCode===null||typeof context.countryCode==='string'&&/^[A-Z]{2}$/u.test(context.countryCode))&&
  (context.cityId===null||typeof context.cityId==='string'&&context.cityId.length>0&&context.cityId.length<=80&&context.cityId.trim()===context.cityId)&&
  (context.timeZone===undefined||typeof context.timeZone==='string'&&context.timeZone.length<=70);
}

/**
 * Geography belongs to the reviewed fact, never to its publisher.
 * A fact about another city in the selected country is only a country fallback;
 * its original geography label must still be shown by the renderer.
 */
export function selectInlineKnowledge(
 cards:readonly KnowledgeCard[],context:KnowledgeStreamContext,now:number,seed:string,
):readonly InlineKnowledge[] {
 if(!validContext(context))throw Error('INLINE_KNOWLEDGE_CONTEXT_INVALID');
 const tiers:Record<KnowledgeScope,KnowledgeCard[]>={city:[],country:[],global:[]};
 for(const card of validateKnowledgeCatalog(cards)){
  const geography=card.geography;
  if(geography===undefined){tiers.global.push(card);continue;}
  if(context.countryCode===null||geography.countryCode!==context.countryCode)continue;
  const scope:KnowledgeScope=context.cityId!==null&&geography.cityIds.includes(context.cityId)?'city':'country';
  tiers[scope].push(card);
 }
 const result:InlineKnowledge[]=[];
 for(const scope of ['city','country','global'] as const){
  for(const card of selectKnowledgeCards(tiers[scope],'all',now,seed,context.timeZone??'UTC'))result.push({card,scope});
 }
 // An independent help spotlight occupies the first existing knowledge slot.
 // Keep its verified geographic scope; never label a national cause as local.
 const spotlight=result.findIndex(entry=>entry.card.format==='care');
 if(spotlight>0){const [entry]=result.splice(spotlight,1);if(entry)result.unshift(entry);}
 return result;
}

/**
 * Project an append-only news prefix with the same selected knowledge list.
 * Original news objects and their order are preserved. An exhausted catalogue
 * leaves news uninterrupted; it is never recycled or padded with placeholders.
 */
export function interleaveKnowledge<T extends {readonly key:string}>(
 news:readonly T[],knowledge:readonly InlineKnowledge[],
):readonly KnowledgeStreamItem<T>[] {
 const newsKeys=new Set<string>(),knowledgeIds=new Set<string>();
 for(const item of news){
  if(typeof item.key!=='string'||!item.key||newsKeys.has(item.key))throw Error('INLINE_NEWS_IDENTITY_INVALID');
  newsKeys.add(item.key);
 }
 for(const item of knowledge){
  if(knowledgeIds.has(item.card.id))throw Error('INLINE_KNOWLEDGE_DUPLICATE');
  knowledgeIds.add(item.card.id);
 }
 const result:KnowledgeStreamItem<T>[]=[];
 let afterNews=0,knowledgeIndex=0;
 for(const item of news){
  result.push({kind:'news',item});afterNews++;
  if(afterNews%NEWS_PER_KNOWLEDGE!==0)continue;
  const next=knowledge[knowledgeIndex];if(next===undefined)continue;
  result.push({kind:'knowledge',item:next,afterNews});knowledgeIndex++;
 }
 return result;
}
