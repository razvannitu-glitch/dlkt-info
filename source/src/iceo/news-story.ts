import {createHash} from 'node:crypto';
import {groupStories} from './story-grouping.js';
import type {NewsPageOriginal,NewsStorySource} from './news-page-contracts.js';

export interface NewsStoryGroup {
 readonly primary:NewsPageOriginal;
 readonly storyKey:string;
 readonly basis:'single'|'matching-headlines'|'shared-event';
 readonly sources:readonly NewsStorySource[];
}
type Bucket={primary:NewsPageOriginal;thread:string;basis:NewsStoryGroup['basis'];members:NewsPageOriginal[]};
const normalized=(value:string):string=>value.normalize('NFKC').toLowerCase().replace(/[‘’]/gu,"'").replace(/[‐‑‒–—]/gu,'-').replace(/\s+/gu,' ').trim();
const lexical=(a:string,b:string):number=>a<b?-1:a>b?1:0;
const published=(item:NewsPageOriginal):string=>item.kind==='global'?item.card.date:item.card.news!.publishedAt;
const summary=(item:NewsPageOriginal):string=>item.kind==='global'?item.card.summary??'':item.card.news!.summary??'';
const source=(item:NewsPageOriginal):NewsStorySource=>item.kind==='global'?{kind:'global',card:item.card}:{kind:'local',card:item.card};
function headline(item:NewsPageOriginal):string|null {
 const title=normalized(item.card.title),words=title.match(/[\p{L}\p{N}]+/gu)??[],time=Date.parse(published(item));
 if(title.length<55||words.length<8||new Set(words.filter(word=>word.length>2)).size<7||!Number.isFinite(time))return null;
 return JSON.stringify([title,Math.floor(time/172800000)]);
}
function compatibleSummary(a:NewsPageOriginal,b:NewsPageOriginal):boolean {
 const left=normalized(summary(a)),right=normalized(summary(b));return !left||!right||left===right;
}
function printedLocalPlace(item:Extract<NewsPageOriginal,{kind:'local'}>):boolean {
 const title=' '+normalized(item.card.title).replace(/[^\p{L}\p{N}]+/gu,' ')+' ';
 return item.card.news!.geoAnchors.some(anchor=>{
  const place=normalized(anchor).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  return place.length>=3&&title.includes(' '+place+' ');
 });
}
/**
 * Presentation groups preserve checked originals. The existing engine groups an
 * explicitly identified event, never a consensus claim. Local cross-origin
 * matching is narrower: complete informative headline, fixed time window and
 * compatible excerpts; crossing into global reporting also needs a printed place.
 */
export function groupNewsStories(items:readonly NewsPageOriginal[]):readonly NewsStoryGroup[] {
 if(!Array.isArray(items)||items.length>5000)throw Error('NEWS_STORY_INPUT_INVALID');
 const positions=new Map(items.map((item,index)=>[item.key,index]));
 const global=items.filter((item):item is Extract<NewsPageOriginal,{kind:'global'}>=>item.kind==='global');
 const globals=new Map(global.map(item=>[item.card.id,item]));
 const buckets:Bucket[]=[],urls=new Map<string,Bucket>(),retained=new Set<string>();
 for(const group of groupStories(global.map(item=>item.card),(a,b)=>(positions.get('article:'+a.id)??5000)-(positions.get('article:'+b.id)??5000))){
  const members=[group.card,...group.related].flatMap(card=>{const item=globals.get(card.id);return item?[{...item,card}]:[];});
  const primary=members[0];if(!primary)continue;
  const bucket:Bucket={primary,thread:group.key,basis:group.basis,members};buckets.push(bucket);
  for(const member of members){urls.set(member.card.sourceUrl,bucket);retained.add(member.card.id);}
 }
 // A conflicting global record cannot re-enter through its local feed copy.
 const blockedUrls=new Set(global.filter(item=>!retained.has(item.card.id)).map(item=>item.card.sourceUrl));
 const locals=items.filter((item):item is Extract<NewsPageOriginal,{kind:'local'}>=>item.kind==='local'&&item.card.kind==='local-news'&&item.card.news!==undefined);
 const idVariants=new Map<string,Set<string>>(),urlVariants=new Map<string,Set<string>>();
 const add=(map:Map<string,Set<string>>,key:string,value:string):void=>{const values=map.get(key)??new Set<string>();values.add(value);map.set(key,values);};
 for(const item of locals){
  const signature=JSON.stringify([item.card.sourceUrl,item.card.title,item.card.publisher,published(item),summary(item),item.card.news!.cityId]);
  add(idVariants,item.card.id,signature);add(urlVariants,item.card.sourceUrl,signature);
 }
 const uniqueLocal=new Map<string,Extract<NewsPageOriginal,{kind:'local'}>>();
 for(const item of locals){
  if(blockedUrls.has(item.card.sourceUrl)||idVariants.get(item.card.id)?.size!==1||urlVariants.get(item.card.sourceUrl)?.size!==1)continue;
  const prior=uniqueLocal.get(item.card.sourceUrl);
  if(!prior||Date.parse(item.card.checkedAt)>Date.parse(prior.card.checkedAt)||item.card.checkedAt===prior.card.checkedAt&&lexical(item.card.id,prior.card.id)<0)uniqueLocal.set(item.card.sourceUrl,item);
 }
 for(const item of [...uniqueLocal.values()].sort((a,b)=>(positions.get(a.key)??5000)-(positions.get(b.key)??5000)||lexical(a.key,b.key))){
  // The original URL is already represented: keep one source link and the
  // directly checked global original, without rewriting either stored record.
  if(urls.has(item.card.sourceUrl))continue;
  const fingerprint=headline(item);
  const candidates=fingerprint===null?[]:buckets.filter(bucket=>bucket.primary.kind==='global'
   ?printedLocalPlace(item)&&bucket.members.some(member=>member.kind==='global'&&headline(member)===fingerprint&&compatibleSummary(member,item))
   :bucket.members.every(member=>member.kind==='local'&&member.card.news!.cityId===item.card.news!.cityId&&headline(member)===fingerprint&&normalized(summary(member))===normalized(summary(item))));
  if(candidates.length===1){
   const bucket=candidates[0]!;bucket.members.push(item);if(bucket.basis==='single')bucket.basis='matching-headlines';urls.set(item.card.sourceUrl,bucket);
  }else{
   // Ambiguous matches stay separate; no similarity chain joins two groups.
   const thread=fingerprint===null?JSON.stringify(['local-record',item.card.sourceUrl]):JSON.stringify(['local-headline',item.card.news!.cityId,fingerprint,normalized(summary(item)),...(candidates.length>1?[item.card.sourceUrl]:[])]);
   const bucket:Bucket={primary:item,thread,basis:'single',members:[item]};buckets.push(bucket);urls.set(item.card.sourceUrl,bucket);
  }
 }
 return Object.freeze(buckets.map(bucket=>Object.freeze({
  primary:bucket.primary,storyKey:'story:'+createHash('sha256').update(bucket.thread).digest('hex'),
  basis:bucket.members.length>1?bucket.basis:'single' as const,
  sources:Object.freeze(bucket.members.map(source)),
 })).sort((a,b)=>(positions.get(a.primary.key)??5000)-(positions.get(b.primary.key)??5000)||lexical(a.storyKey,b.storyKey)));
}
