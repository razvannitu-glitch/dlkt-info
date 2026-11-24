import type {IceoSnapshot,SourceResult} from './contracts.js';
import {iceoEngine,reconcile,fitPublicSnapshot} from './engine.js';
import {discoverNewsWithDiagnostics,mergeNewsCandidates,type NewsCandidate} from './news-discovery.js';
import type {NewsDiagnostics} from './news-diagnostics.js';
import {createNewsCandidateStore} from './news-store.js';
import {newsBackoffFetch} from './news-backoff.js';
import {buildNewsCorpus,collectCorpusLocalNews,type NewsCorpus,type NewsCorpusLocal,type NewsCorpusEpoch} from './news-corpus.js';
import {createNewsCorpusStore} from './news-corpus-store.js';

export interface EditorialCollection {readonly snapshot:IceoSnapshot;readonly corpus:NewsCorpus;readonly diagnostics:NewsDiagnostics}
interface EditorialData {readonly full:IceoSnapshot;readonly diagnostics:NewsDiagnostics}

function candidateObservationSignature(candidate:NewsCandidate):string{
 return JSON.stringify([candidate.sourceUrl,candidate.title,candidate.publisher,candidate.indexedAt,candidate.category]);
}
/** Completion time belongs to the union; original source observation times stay intact. */
export function finalizeEditorialCollection(full:IceoSnapshot,local:readonly NewsCorpusLocal[],diagnostics:NewsDiagnostics,completed:number):EditorialCollection{
 const snapshot:IceoSnapshot=Object.freeze({...full,generatedAt:new Date(completed).toISOString()});
 return Object.freeze({snapshot:fitPublicSnapshot(snapshot),corpus:buildNewsCorpus(snapshot,local,completed),diagnostics});
}
/** Public news discovery and official records share one read-only catalog; no private profile enters it. */
async function collectEditorialData(
 fetcher:typeof fetch=fetch,clock:()=>number=Date.now,officialLoad:(()=>Promise<IceoSnapshot>)|undefined=undefined,
 environment:Readonly<Record<string,string|undefined>>=process.env,signal?:AbortSignal,previousSnapshot?:Pick<IceoSnapshot,'cards'>,
):Promise<EditorialData>{
 signal?.throwIfAborted();
 const boundedFetch:typeof fetch=signal?((input,init)=>{signal.throwIfAborted();return fetcher(input,{...init,signal:init?.signal?AbortSignal.any([signal,init.signal]):signal});}):fetcher;
 const now=clock(),official=officialLoad?officialLoad():iceoEngine.snapshot(signal);
 const news=(async()=>{
  const store=createNewsCandidateStore(environment,boundedFetch);let candidates:readonly NewsCandidate[]=[];
  if(store){try{candidates=(await store.read(now)).candidates;}catch{/* Candidate availability cannot create publication evidence. */}}
  signal?.throwIfAborted();
  const newsFetch=environment.VERCEL==='1'?newsBackoffFetch(boundedFetch,clock):boundedFetch;
  return discoverNewsWithDiagnostics(newsFetch,now,candidates,async pool=>{
   if(!store?.writable)return;
   const persistAt=clock(),observed=new Map(candidates.map(candidate=>[candidate.sourceUrl,candidateObservationSignature(candidate)]));
   // A seed can expire while indexes are read; unchanged observations need no write.
   const changed=mergeNewsCandidates(pool,persistAt).filter(candidate=>observed.get(candidate.sourceUrl)!==candidateObservationSignature(candidate));
   if(changed.length)await store.write(changed,persistAt);
  },{
    ...(environment.VERCEL==='1'?{publisherIndexBatch:7,deadlineMs:27_000,maxArticleRequests:60}:{}),
    ...(previousSnapshot?{retainedCards:previousSnapshot.cards}:{}),
  });
 })();
 const [base,discovered]=await Promise.all([official,news]);signal?.throwIfAborted();
 const records:SourceResult[]=base.sources.map(health=>({health,cards:base.cards.filter(card=>card.sourceIds.includes(health.id))}));
 const combined=reconcile([...records,...discovered.sources]),conflicts=combined.conflictCount+base.conflictCount;
 return {full:Object.freeze({...combined,mode:'current-source-records',conflictCount:conflicts,state:conflicts>0&&combined.state==='ready'?'partial':combined.state}),diagnostics:discovered.diagnostics};
}
/** Compatibility collector remains bounded; the durable job uses the full collection below. */
export async function collectEditorialSnapshot(
 fetcher:typeof fetch=fetch,clock:()=>number=Date.now,officialLoad:(()=>Promise<IceoSnapshot>)|undefined=undefined,
 environment:Readonly<Record<string,string|undefined>>=process.env,signal?:AbortSignal,previousSnapshot?:IceoSnapshot,
):Promise<IceoSnapshot>{
 return fitPublicSnapshot((await collectEditorialData(fetcher,clock,officialLoad,environment,signal,previousSnapshot)).full);
}
let pending:Promise<IceoSnapshot>|undefined;
export function publicEditorialSnapshot(signal?:AbortSignal,previousSnapshot?:IceoSnapshot):Promise<IceoSnapshot>{
 signal?.throwIfAborted();
 pending??=collectEditorialSnapshot(fetch,Date.now,undefined,process.env,signal,previousSnapshot).finally(()=>{pending=undefined;});
 return pending;
}
/**
 * An expired/invalid shared snapshot cannot justify reading its entire durable
 * article corpus before each new collection. This removes unnecessary backend
 * I/O on cold recovery, without changing any retention path for eligible data.
 */
export async function retainedEditorialCards(
 previousSnapshot:Pick<IceoSnapshot,'cards'>|undefined,
 signal:AbortSignal,
 readFull:()=>Promise<NewsCorpusEpoch|null|undefined>,
):Promise<Pick<IceoSnapshot,'cards'>|undefined>{
 signal.throwIfAborted();
 if(!previousSnapshot)return undefined;
 try{
  const previous=await readFull();
  signal.throwIfAborted();
  if(previous)return {cards:previous.corpus.cards};
 }catch{/* An outage never makes old records current or bypasses source checks. */}
 signal.throwIfAborted();
 return previousSnapshot;
}
let pendingCollection:Promise<EditorialCollection>|undefined;
/** Only the authenticated durable lease holder invokes source collection and corpus staging. */
export function publicEditorialCollection(signal:AbortSignal,previousSnapshot?:IceoSnapshot):Promise<EditorialCollection>{
 signal.throwIfAborted();
 pendingCollection??=(async()=>{
  const retained=await retainedEditorialCards(previousSnapshot,signal,async()=>createNewsCorpusStore(process.env)?.read());
  signal.throwIfAborted();
  const [collected,local]=await Promise.all([collectEditorialData(fetch,Date.now,undefined,process.env,signal,retained),collectCorpusLocalNews(signal)]);
  signal.throwIfAborted();
  // Generation describes this completed union. Individual source observation times are never rewritten.
  return finalizeEditorialCollection(collected.full,local,collected.diagnostics,Date.now());
 })().finally(()=>{pendingCollection=undefined;});
 return pendingCollection;
}
