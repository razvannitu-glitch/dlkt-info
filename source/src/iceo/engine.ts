import { PRODUCT_VERSION } from '../core/contracts.js';
import { ICEO_VERSION, type EvidenceCard, type Extraction, type IceoSnapshot, type SourceDefinition, type SourceHealth, type SourceResult } from './contracts.js';
import { ICEO_SOURCES } from './registry.js';
import { acquire, AcquisitionError } from './transport.js';
import { extract } from './extract.js';
const TTL=900_000, MAX_STALE=86_400_000;
interface Slot { result:Extraction|null; verifiedAt:number; checkedAt:number; nextAttempt:number; failures:number; error:string|null; etag:string|null; modified:string|null }
const safeError=(error:unknown):string=>error instanceof AcquisitionError?error.code:error instanceof Error&&/^[A-Z][A-Z0-9_]+$/u.test(error.message)?error.message:error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'SOURCE_TIMEOUT':'SOURCE_UNAVAILABLE';
async function waitingFor<T>(pending:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return pending;signal.throwIfAborted();
  let abort:(()=>void)|undefined;
  try{return await Promise.race([pending,new Promise<never>((_resolve,reject)=>{abort=()=>reject(signal.reason??new Error('SOURCE_ABORTED'));signal.addEventListener('abort',abort,{once:true});})]);}
  finally{if(abort)signal.removeEventListener('abort',abort);}
}
/** Per-source isolation, request coalescing, bounded backoff and explicit stale evidence. */
export class IceoEngine {
  private readonly slots=new Map<string,Slot>();
  private readonly inflight=new Map<string,Promise<SourceResult>>();
  constructor(private readonly fetcher:typeof fetch=fetch,private readonly clock:()=>number=Date.now){}
  private view(source:SourceDefinition,slot:Slot,now:number):SourceResult {
    const usable=slot.result!==null&&now-slot.verifiedAt<=MAX_STALE;
    const state:SourceHealth['state']=!usable?'unavailable':slot.error?'stale':slot.result?.rejected?'partial':'verified';
    const cards=usable?(slot.result?.cards??[]).filter(card=>!source.feed||Date.parse(card.date)>=now-source.feed.windowDays*86_400_000).map(card=>Object.freeze({...card,observedAt:new Date(slot.verifiedAt).toISOString(),sourceState:state==='unavailable'?'stale':state})):[];
    return {health:{id:source.id,label:source.label,publisher:source.publisher,topic:source.topic,state,checkedAt:new Date(slot.checkedAt).toISOString(),verifiedAt:usable?new Date(slot.verifiedAt).toISOString():null,count:cards.length,rejected:slot.result?.rejected??0,error:slot.error,retryAt:slot.error?new Date(slot.nextAttempt).toISOString():null,scope:source.scope,termsUrl:source.termsUrl,windowed:true},cards};
  }
  async read(source:SourceDefinition,signal?:AbortSignal):Promise<SourceResult>{
    signal?.throwIfAborted();
    const now=this.clock(); const prior=this.slots.get(source.id);
    if(new Date(now).toISOString().slice(0,10)>source.rightsReviewBy){return this.view(source,{result:null,verifiedAt:0,checkedAt:now,nextAttempt:now+MAX_STALE,failures:1,error:'RIGHTS_REVIEW_EXPIRED',etag:null,modified:null},now);}
    if(prior&&now<prior.nextAttempt)return this.view(source,prior,now);
    const existing=this.inflight.get(source.id);if(existing)return waitingFor(existing,signal);
    const pending=this.refresh(source,prior,now,signal);this.inflight.set(source.id,pending);
    try{return await pending;}finally{this.inflight.delete(source.id);}
  }
  private async refresh(source:SourceDefinition,prior:Slot|undefined,now:number,signal?:AbortSignal):Promise<SourceResult>{
    let slot:Slot;
    try{
      const sameDay=prior&&new Date(prior.checkedAt).toISOString().slice(0,10)===new Date(now).toISOString().slice(0,10);
      const fetcher:typeof fetch=signal?((input,init)=>{signal.throwIfAborted();return this.fetcher(input,{...init,signal:init?.signal?AbortSignal.any([signal,init.signal]):signal});}):this.fetcher;
      const response=await acquire(source,now,fetcher,sameDay?prior:undefined);
      signal?.throwIfAborted();
      const result=response.notModified?prior?.result??null:response.text!==null?extract(response.text,source,now):null;
      if(!result)throw new AcquisitionError('SOURCE_ORPHAN_304');
      if(result.rejected>0&&result.cards.length===0)throw new AcquisitionError('SOURCE_ALL_RECORDS_REJECTED');
      slot={result,verifiedAt:now,checkedAt:now,nextAttempt:now+(source.feed?.refreshSeconds??TTL/1000)*1000,failures:0,error:null,etag:response.etag,modified:response.modified};
    }catch(error){
      if(signal?.aborted)throw signal.reason??new Error('SOURCE_ABORTED');
      const failures=(prior?.failures??0)+1;
      const backoff=error instanceof AcquisitionError&&error.retryAfterSeconds!==null?Math.max(60,error.retryAfterSeconds)*1000:Math.min(TTL,60_000*2**Math.min(4,failures-1));
      slot={result:prior?.result??null,verifiedAt:prior?.verifiedAt??0,checkedAt:now,nextAttempt:now+backoff,failures,error:safeError(error),etag:prior?.etag??null,modified:prior?.modified??null};
    }
    this.slots.set(source.id,slot);return this.view(source,slot,now);
  }
  async snapshot(signal?:AbortSignal):Promise<IceoSnapshot>{
    const sources=ICEO_SOURCES.filter(source=>source.adapter!=='news-index');
    const results:SourceResult[]=[];let position=0;
    const worker=async():Promise<void>=>{for(;;){signal?.throwIfAborted();const index=position++,source=sources[index];if(!source)return;results[index]=await this.read(source,signal);}};
    await Promise.all(Array.from({length:Math.min(8,sources.length)},worker));
    return reconcile(results);
  }
}
export function reconcile(results:readonly SourceResult[]):IceoSnapshot {
  const cards=new Map<string,EvidenceCard>();const conflicts=new Set<string>();let duplicateCount=0;
  for(const result of results)for(const card of result.cards){
    if(conflicts.has(card.identity))continue;const previous=cards.get(card.identity);
    if(!previous){cards.set(card.identity,card);continue;}
    if(previous.contentHash!==card.contentHash){cards.delete(card.identity);conflicts.add(card.identity);continue;}
    duplicateCount++;
    // Keep timestamp and source state from the same observation; never relabel old evidence as fresh.
    const freshest=Date.parse(card.observedAt)>Date.parse(previous.observedAt)?card:previous;
    cards.set(card.identity,Object.freeze({...freshest,sourceIds:Object.freeze([...new Set([...previous.sourceIds,...card.sourceIds])])}));
  }
  // Health counts describe the published, reconciled catalog, not duplicate input rows.
  const sources=results.map(result=>Object.freeze({...result.health,count:[...cards.values()].filter(card=>card.sourceIds.includes(result.health.id)).length}));
  const available=sources.filter(source=>source.state!=='unavailable');
  const ordered=[...cards.values()].sort((left,right)=>Date.parse(right.date)-Date.parse(left.date)||left.id.localeCompare(right.id));
  return Object.freeze({version:ICEO_VERSION,product:'dlkt-info',productVersion:PRODUCT_VERSION,mode:'current-official-records',generatedAt:new Date(Math.max(0,...sources.map(source=>Date.parse(source.checkedAt)))).toISOString(),state:available.length===0?'unavailable':sources.every(source=>source.state==='verified')&&conflicts.size===0?'ready':'partial',sources,cards:ordered,conflictCount:conflicts.size,duplicateCount,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:[...new Set(ordered.map(card=>card.topic))]});
}
export const iceoEngine=new IceoEngine();
