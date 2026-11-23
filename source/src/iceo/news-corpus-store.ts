import type {RefreshClaim} from './refresh-ledger.js';
import type {NewsDiagnostics} from './news-diagnostics.js';
import type {NewsCorpus,NewsCorpusEpoch} from './news-corpus.js';
import type {NewsPageItem} from './news-page-contracts.js';

type NewsArticleReference={readonly id:string;readonly revision:string;readonly cityId?:string};

/** Server-only capability. Readers never acquire sources or receive writer credentials. */
export interface NewsCorpusStore {
 stage(claim:RefreshClaim,corpus:NewsCorpus,diagnostics?:NewsDiagnostics):Promise<{readonly epoch:string;readonly digest:string}>;
 read(epoch?:string):Promise<NewsCorpusEpoch|null>;
 /** Search exact versions across still-valid committed epochs when epoch is omitted. */
 lookup(reference:NewsArticleReference,epoch?:string):Promise<NewsPageItem|null>;
}

import {readPersistenceConfiguration} from '../persistence/config.js';
import type {PersistenceFetch} from '../persistence/contracts.js';
import {publicSnapshotDigest} from './refresh-ledger.js';
import {validNewsCorpus,NEWS_CORPUS_MAX_BYTES,NEWS_CORPUS_MAX_AGE_MS} from './news-corpus.js';
import {validNewsPageItem,validNewsEpochId,validNewsGlobalCard,validNewsLocalCard} from './news-page-contracts.js';
import {validNewsDiagnostics} from './news-diagnostics.js';
import {validArchiveCard} from '../share/archive.js';
import {findCity} from '../local/cities.js';
import {validLocalNewsArticle} from '../local/news-policy.js';
import {newsCard} from '../local/service.js';
import {newsCategory} from './news-taxonomy.js';
import {ICEO_SOURCES} from './registry.js';

const WRITER=/^[A-Za-z0-9_-]{43,128}$/u,HASH=/^[a-f0-9]{64}$/u,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const MAX_IO_BYTES=NEWS_CORPUS_MAX_BYTES+262144,TIMEOUT_MS=8000,LATEST_CACHE_MS=10000;
const LOOKUP_PENDING_LIMIT=128;
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:readonly string[]):boolean=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const stamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export class NewsCorpusStoreError extends Error {constructor(readonly code:'NEWS_CORPUS_INVALID'|'NEWS_CORPUS_UNAVAILABLE'){super(code);this.name='NewsCorpusStoreError';}}
function fail(invalid=false):never {throw new NewsCorpusStoreError(invalid?'NEWS_CORPUS_INVALID':'NEWS_CORPUS_UNAVAILABLE');}
export function validNewsCorpusEpoch(value:unknown,now=Date.now()):value is NewsCorpusEpoch {
 return object(value)&&exact(value,['version','epoch','revision','generatedAt','publishedAt','expiresAt','digest','corpus'])
  &&value.version==='dlkt-news-epoch-1'&&validNewsEpochId(value.epoch)&&typeof value.revision==='number'&&Number.isSafeInteger(value.revision)&&value.revision>0
  &&stamp(value.generatedAt)&&stamp(value.publishedAt)&&stamp(value.expiresAt)&&Date.parse(value.publishedAt)<=now+5000
  &&Date.parse(value.publishedAt)>=Date.parse(value.generatedAt)-5000&&Date.parse(value.expiresAt)===Date.parse(value.generatedAt)+NEWS_CORPUS_MAX_AGE_MS
  &&Date.parse(value.expiresAt)>now&&typeof value.digest==='string'&&HASH.test(value.digest)
  &&validNewsCorpus(value.corpus,now)&&value.generatedAt===value.corpus.generatedAt&&publicSnapshotDigest(value.corpus)===value.digest;
}
async function json(response:Response,signal:AbortSignal):Promise<unknown> {
 if(!response.ok||!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type')??'')){await response.body?.cancel();return fail();}
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>MAX_IO_BYTES)){await response.body?.cancel();return fail();}
 const reader=response.body?.getReader();if(!reader)return fail();
 const chunks:Uint8Array[]=[];let bytes=0;const abort=():void=>{void reader.cancel().catch(()=>undefined);};signal.addEventListener('abort',abort,{once:true});
 try{
  for(;;){if(signal.aborted)return fail();const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;
   if(bytes>MAX_IO_BYTES){await reader.cancel();return fail();}chunks.push(chunk.value);}
  if(signal.aborted)return fail();return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
 }finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
}
/** Reuses the existing server writer authority. Private rows and diagnostics never cross this adapter's public projection. */
export function createNewsCorpusStore(environment:Readonly<Record<string,string|undefined>>,fetcher:PersistenceFetch=fetch,clock:()=>number=Date.now):NewsCorpusStore|null {
 const configuration=readPersistenceConfiguration(environment),writer=environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY;
 if(configuration.state!=='ready'||typeof writer!=='string'||!WRITER.test(writer))return null;
 const publishableKey=configuration.publishableKey,writerKey=writer;
 const base=new URL('/rest/v1/rpc/',configuration.url),epochs=new Map<string,NewsCorpusEpoch>();
 const pending=new Map<string,Promise<NewsCorpusEpoch|null>>();let latest:{epoch:string;until:number}|null=null;
 const pendingLookups=new Map<string,Promise<string|null>>();
 async function rpc(name:string,args:Readonly<Record<string,unknown>>):Promise<unknown> {
  const body=JSON.stringify(args);if(Buffer.byteLength(body,'utf8')>MAX_IO_BYTES)return fail(true);
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new NewsCorpusStoreError('NEWS_CORPUS_UNAVAILABLE'));},TIMEOUT_MS);});
   const pending=(async():Promise<unknown>=>{
    const response=await fetcher(new URL(name,base),{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal,
     headers:{apikey:publishableKey,Accept:'application/json','Content-Type':'application/json','x-dlkt-share-write':writerKey},body});
    if(controller.signal.aborted){void response.body?.cancel().catch(()=>undefined);return fail();}return json(response,controller.signal);
   })();return await Promise.race([pending,timeout]);
  }catch{return fail();}finally{clearTimeout(timer);controller.abort();}
 }
 function cache(value:NewsCorpusEpoch):void {
  for(const [key,entry] of epochs)if(Date.parse(entry.expiresAt)<=clock())epochs.delete(key);
  if(epochs.size>=4&&!epochs.has(value.epoch))epochs.delete(epochs.keys().next().value??'');epochs.set(value.epoch,value);
 }

 function validateLookup(value:unknown,reference:NewsArticleReference,city:ReturnType<typeof findCity>,now:number):NewsPageItem {
  let item:NewsPageItem;
   if(city){
    if(!object(value)||!exact(value,['kind','article','city'])||value.kind!=='local'||publicSnapshotDigest(value.city)!==publicSnapshotDigest(city)
     ||!validLocalNewsArticle(value.article,city,now)||value.article.id!==reference.id||value.article.documentHash!==reference.revision)return fail();
    const card=newsCard(value.article,city);if(!validNewsLocalCard(card,city.id,now,city))return fail();
    item={kind:'local',key:'local:'+card.id,category:newsCategory(card),card};
   }else{
    if(!object(value)||!exact(value,['kind','card'])||value.kind!=='global'||!validNewsGlobalCard(value.card,now)||!validArchiveCard(value.card)
     ||value.card.id!==reference.id||value.card.contentHash!==reference.revision
     ||value.card.sourceIds.some(id=>{const source=ICEO_SOURCES.find(entry=>entry.id===id);return !source||new Date(now).toISOString().slice(0,10)>source.rightsReviewBy;}))return fail();
    item={kind:'global',key:'article:'+value.card.id,category:newsCategory(value.card),card:value.card};
   }
   if(!validNewsPageItem(item,now,city??undefined))return fail();return item;
 }
 return Object.freeze({
  async stage(claim:RefreshClaim,corpus:NewsCorpus,diagnostics?:NewsDiagnostics){
   const now=clock();
   if(claim.state!=='claimed'||!Number.isSafeInteger(claim.fence)||claim.fence<1||typeof claim.leaseToken!=='string'||!UUID.test(claim.leaseToken)
    ||!claim.leaseExpiresAt||Date.parse(claim.leaseExpiresAt)<=now||!validNewsCorpus(corpus,now)
    ||diagnostics!==undefined&&!validNewsDiagnostics(diagnostics,now))return fail(true);
   const digest=publicSnapshotDigest(corpus),epoch=String(claim.fence);
   const result=await rpc('dlkt_info_stage_news_corpus',{p_lease_token:claim.leaseToken,p_fence:claim.fence,p_corpus:corpus,p_digest:digest,p_diagnostics:diagnostics??null});
   if(!object(result)||!exact(result,['epoch','digest'])||result.epoch!==epoch||result.digest!==digest)return fail();
   latest=null;return {epoch,digest};
  },
  async read(epoch?:string):Promise<NewsCorpusEpoch|null>{
   if(epoch!==undefined&&!validNewsEpochId(epoch))return fail(true);
   const now=clock(),key=epoch??'latest',cached=epoch?epochs.get(epoch):latest&&latest.until>now?epochs.get(latest.epoch):undefined;
   if(cached&&Date.parse(cached.expiresAt)>now)return cached;
   const running=pending.get(key);if(running)return running;
   const job=(async():Promise<NewsCorpusEpoch|null>=>{
    const value=await rpc('dlkt_info_read_news_corpus',{p_epoch:epoch===undefined?null:Number(epoch)});
    if(value===null)return null;
    if(!validNewsCorpusEpoch(value,clock())||epoch!==undefined&&value.epoch!==epoch)return fail();
    cache(value);if(epoch===undefined)latest={epoch:value.epoch,until:clock()+LATEST_CACHE_MS};return value;
   })();pending.set(key,job);try{return await job;}finally{pending.delete(key);}
  },
  async lookup(reference:NewsArticleReference,epoch?:string):Promise<NewsPageItem|null>{
   if(!object(reference)||!exact(reference,reference.cityId===undefined?['id','revision']:['id','revision','cityId'])
    ||typeof reference.id!=='string'||typeof reference.revision!=='string'||!HASH.test(reference.revision)
    ||epoch!==undefined&&!validNewsEpochId(epoch))return fail(true);
   const city=reference.cityId===undefined?null:findCity(reference.cityId);
   if(reference.cityId!==undefined&&!city||reference.cityId===undefined&&!/^[a-f0-9]{24}$/u.test(reference.id)
    ||city&&!new RegExp('^local-news:'+city.id+':[a-z0-9-]{1,80}:[a-f0-9]{24}$','u').test(reference.id))return fail(true);
   const key=JSON.stringify([reference.id,reference.revision,reference.cityId??null,epoch??null]);
   let job=pendingLookups.get(key);
   if(!job){
    job=(async():Promise<string|null>=>{
     const value=await rpc('dlkt_info_find_news_corpus_article',{p_id:reference.id,p_revision:reference.revision,p_city_id:reference.cityId??null,p_epoch:epoch===undefined?null:Number(epoch)});
     if(value===null)return null;
     validateLookup(value,reference,city,clock());
     // Share only this in-flight RPC. Completed results are never retained because
     // the database also checks committed-epoch validity, absent from its response.
     return JSON.stringify(value);
    })();
    // Coalescing is best effort at the cap, so the pending-key registry stays bounded.
    if(pendingLookups.size<LOOKUP_PENDING_LIMIT)pendingLookups.set(key,job);
   }
   try{
    const body=await job;if(body===null)return null;
    // Recheck after awaiting even a shared request; time may advance while it resolves.
    return validateLookup(JSON.parse(body) as unknown,reference,city,clock());
   }finally{if(pendingLookups.get(key)===job)pendingLookups.delete(key);}

  },
 });
}
