import {validNewsPage,validNewsStorySourcesPage,NEWS_MAX_RESPONSE_BYTES,type NewsSourceScope,type NewsPage,type NewsPageItem,type NewsStorySummary,type NewsStorySource,type NewsStorySourcesPage} from './news-page-contracts.js';
import type {NewsStreamFilter,NewsStreamItem} from './news-stream.js';
import type {City} from '../local/contracts.js';
import type {NewsPeriod} from './news-day.js';
import {readingCard} from './reader.js';
import {editorialCategory} from './editorial-categories.js';

export interface NewsContinuationContext {readonly language:string;readonly cityId:string|null;readonly filter:NewsStreamFilter;readonly city?:City;readonly period?:NewsPeriod;readonly sourceScope?:NewsSourceScope}
export interface NewsContinuationView {
 readonly page:NewsPage|null;readonly items:readonly NewsPageItem[];readonly loading:boolean;
 readonly error:'unavailable'|'invalid'|'expired'|null;readonly initialized:boolean;
}
const contextKey=(context:NewsContinuationContext):string=>JSON.stringify([context.language,context.cityId,context.city?.countryCode??null,context.city?.timezone??'UTC',context.filter,context.period??'recent',context.sourceScope??'edition']);
const MAX_PAGE_BYTES=NEWS_MAX_RESPONSE_BYTES;
async function jsonBody(response:Response,signal:AbortSignal):Promise<unknown>{
 if(!(response.headers.get('content-type')??'').toLowerCase().includes('application/json'))throw Error('NEWS_PAGE_INVALID');
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>MAX_PAGE_BYTES))throw Error('NEWS_PAGE_INVALID');
 const reader=response.body?.getReader();if(!reader)throw Error('NEWS_PAGE_INVALID');
 const chunks:Uint8Array[]=[];let size=0;
 const cancel=():void=>{void reader.cancel().catch(()=>undefined);};signal.addEventListener('abort',cancel,{once:true});
 try{
  for(;;){signal.throwIfAborted();const entry=await reader.read();if(entry.done)break;size+=entry.value.byteLength;
   if(size>MAX_PAGE_BYTES){await reader.cancel();throw Error('NEWS_PAGE_INVALID');}chunks.push(entry.value);}
  signal.throwIfAborted();const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
 }finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
}
function itemIdentity(item:NewsStorySource):readonly [string,string,string]{
 return item.kind==='global'?[item.card.id,item.card.identity,item.card.sourceUrl]:[item.card.id,item.card.sourceUrl,item.card.sourceUrl];
}
/** A server edition is append-only. A context change or explicit refresh starts a new edition. */
export class NewsContinuation {
 private context:NewsContinuationContext|null=null;
 private key='';private generation=0;
 private page:NewsPage|null=null;
 private items:readonly NewsPageItem[]=[];
 private loading=false;
 private error:NewsContinuationView['error']=null;
 private controller:AbortController|null=null;
 private pending:Promise<void>|null=null;
 constructor(private readonly fetcher:typeof fetch=fetch,private readonly clock:()=>number=Date.now,private readonly changed:()=>void=()=>{}){}
 view():NewsContinuationView{return Object.freeze({page:this.page,items:this.items,loading:this.loading,error:this.error??(this.page&&Date.parse(this.page.expiresAt)<=this.clock()?'expired':null),initialized:this.context!==null});}
 start(context:NewsContinuationContext,restart=false):Promise<void>{
  const key=contextKey(context);
  if(this.key===key&&this.context!==null&&!restart)return this.pending??Promise.resolve();
  this.controller?.abort();this.generation++;this.context=Object.freeze({...context,sourceScope:context.sourceScope??'edition'});this.key=key;
  this.page=null;this.items=Object.freeze([]);this.loading=false;this.error=null;this.pending=null;
  return this.next();
 }
 async next():Promise<void>{
  if(this.loading)return this.pending??Promise.resolve();
  if(!this.context||this.error==='expired'||this.page?.nextCursor===null)return;
  if(this.page&&Date.parse(this.page.expiresAt)<=this.clock()){this.error='expired';this.changed();return;}
  const generation=this.generation,context=this.context,cursor=this.page?.nextCursor??null;
  const controller=new AbortController();this.controller=controller;this.loading=true;this.error=null;
  const query=new URLSearchParams({lang:context.language,category:context.filter,period:context.period??'recent',sourceScope:context.sourceScope??'edition'});
  if(context.cityId!==null)query.set('city',context.cityId);if(cursor!==null)query.set('cursor',cursor);
  const timeout=setTimeout(()=>controller.abort(),12_000);
  const job=(async():Promise<void>=>{
   try{
    const fetcher=this.fetcher;
    const response=await fetcher('/api/news-page?'+query.toString(),{method:'GET',credentials:'omit',cache:cursor===null?'default':'no-store',
     headers:{Accept:'application/json'},signal:controller.signal});
    if(generation!==this.generation){await response.body?.cancel();return;}
    if(response.status===410||response.status===400&&cursor!==null){await response.body?.cancel();this.error='expired';return;}
    if(!response.ok){await response.body?.cancel();throw Error('NEWS_PAGE_UNAVAILABLE');}
    const value=await jsonBody(response,controller.signal);
    if(generation!==this.generation)return;
    if(!validNewsPage(value,this.clock(),context.city)||value.language!==context.language||value.cityId!==context.cityId||value.countryCode!==(context.city?.countryCode??null)||value.filter!==context.filter||value.period!==(context.period??'recent')||(value.sourceScope??'edition')!==(context.sourceScope??'edition'))throw Error('NEWS_PAGE_INVALID');
    if(Date.parse(value.expiresAt)<=this.clock()){this.error='expired';return;}
    const prior=this.page;
    if(prior&&(value.epoch!==prior.epoch||value.revision!==prior.revision||value.generatedAt!==prior.generatedAt||value.startedAt!==prior.startedAt
      ||value.period!==prior.period||(value.sourceScope??'edition')!==(prior.sourceScope??'edition')||JSON.stringify(value.day)!==JSON.stringify(prior.day)
      ||value.expiresAt!==prior.expiresAt||value.total!==prior.total||value.articleTotal!==prior.articleTotal||value.filteredTotal!==prior.filteredTotal||value.countryCode!==prior.countryCode
      ||value.coverage.national!==prior.coverage.national||value.coverage.local!==prior.coverage.local||value.coverage.international!==prior.coverage.international
      ||Object.keys(prior.counts).some(key=>value.counts[key]!==prior.counts[key])))throw Error('NEWS_PAGE_INVALID');
    if(value.nextCursor!==null&&(value.nextCursor===cursor||value.items.length===0))throw Error('NEWS_PAGE_INVALID');
    const ids=new Set<string>(),identities=new Set<string>(),urls=new Set<string>(),keys=new Set<string>(),stories=new Set<string>();
    for(const item of [...this.items,...value.items]){
     if(keys.has(item.key)||item.story&&stories.has(item.story.key))throw Error('NEWS_PAGE_INVALID');
     keys.add(item.key);if(item.story)stories.add(item.story.key);
     const primary:NewsStorySource=item.kind==='global'?{kind:'global',card:item.card}:{kind:'local',card:item.card};
     for(const original of [primary,...(item.story?.related??[])]){
      const [id,identity,url]=itemIdentity(original);
      if(ids.has(id)||identities.has(identity)||urls.has(url))throw Error('NEWS_PAGE_INVALID');
      ids.add(id);identities.add(identity);urls.add(url);
     }
    }
    const items=Object.freeze([...this.items,...value.items]);
    if(items.length>value.filteredTotal||value.nextCursor===null&&items.length!==value.filteredTotal)throw Error('NEWS_PAGE_INVALID');
    if(value.nextCursor===null&&value.filteredTotal===value.total&&items.reduce((sum,item)=>sum+(item.story?.sourceTotal??1),0)!==value.articleTotal)throw Error('NEWS_PAGE_INVALID');
    this.page=value;this.items=items;
   }catch(error){
    if(generation===this.generation)this.error=error instanceof Error&&error.message==='NEWS_PAGE_INVALID'?'invalid':'unavailable';
   }finally{
    clearTimeout(timeout);
    if(generation===this.generation){this.loading=false;this.pending=null;this.controller=null;this.changed();}
   }
  })();
  this.pending=job;this.changed();return job;
 }
}
export class NewsStorySourcesError extends Error {
 constructor(readonly code:'expired'|'unavailable'){super(code);this.name='NewsStorySourcesError';}
}
/** Bounded anonymous transport; the caller additionally checks edition, story, offset and prior identities. */
export async function fetchNewsStorySources(cursor:string,signal:AbortSignal,city?:City,fetcher:typeof fetch=fetch,clock:()=>number=Date.now):Promise<NewsStorySourcesPage> {
 if(typeof cursor!=='string'||cursor.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(cursor)||signal.aborted)throw new NewsStorySourcesError('unavailable');
 const controller=new AbortController(),abort=():void=>controller.abort();
 signal.addEventListener('abort',abort,{once:true});
 const timeout=setTimeout(abort,12_000);
 try{
  const response=await fetcher('/api/news-page?'+new URLSearchParams({sources:cursor}).toString(),{method:'GET',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
  if(response.status===410){await response.body?.cancel();throw new NewsStorySourcesError('expired');}
  if(!response.ok){await response.body?.cancel();throw new NewsStorySourcesError('unavailable');}
  const value=await jsonBody(response,controller.signal);
  if(!validNewsStorySourcesPage(value,clock(),city)||value.nextCursor===cursor)throw new NewsStorySourcesError('unavailable');
  return value;
 }catch(error){if(error instanceof NewsStorySourcesError)throw error;throw new NewsStorySourcesError('unavailable');}
 finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);}
}
export type NewsContinuationItem=NewsStreamItem&{readonly story?:NewsStorySummary};
/** Convert views only; the server already fixed categories and sequence for the entire edition. */
export function continuationItems(items:readonly NewsPageItem[],now:number):readonly NewsContinuationItem[]{
 return items.map(item=>{
  if(item.kind==='local')return {kind:'local' as const,card:item.card,key:item.key,category:item.category,
   url:item.card.sourceUrl,publisher:item.card.publisher,publishedAt:item.card.news!.publishedAt,...(item.story?{story:item.story}:{})};
  const card=item.card,category=editorialCategory(card),related=item.story?.related.flatMap(source=>source.kind==='global'?[source.card]:[])??[];
  return {kind:'global' as const,key:item.key,category:item.category,url:card.sourceUrl,publisher:card.publisher,publishedAt:card.date,...(item.story?{story:item.story}:{}),
   view:{...readingCard(card,now,related),reason:'Original report in this checked news edition.',localMatch:false,grouping:item.story?.basis??'single' as const,
    storyKey:item.story?.key??'article:'+card.identity,...(category===null?{}:{category})}};
 });
}
