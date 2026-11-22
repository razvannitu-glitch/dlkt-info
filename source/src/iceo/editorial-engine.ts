import type {IceoSnapshot,SourceResult} from './contracts.js';
import {iceoEngine,reconcile,fitPublicSnapshot} from './engine.js';
import {discoverNewsWithDiagnostics,type NewsCandidate} from './news-discovery.js';
import type {NewsDiagnostics} from './news-diagnostics.js';
import {createNewsCandidateStore} from './news-store.js';
import {newsBackoffFetch} from './news-backoff.js';
import {buildNewsCorpus,collectCorpusLocalNews,type NewsCorpus} from './news-corpus.js';
import {createNewsCorpusStore} from './news-corpus-store.js';

export interface EditorialCollection {readonly snapshot:IceoSnapshot;readonly corpus:NewsCorpus;readonly diagnostics:NewsDiagnostics}
interface EditorialData {readonly full:IceoSnapshot;readonly diagnostics:NewsDiagnostics}
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
   if(store?.writable)await store.write(pool,clock());
  },previousSnapshot?{retainedCards:previousSnapshot.cards}:{});
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
let pendingCollection:Promise<EditorialCollection>|undefined;
/** Only the authenticated durable lease holder invokes source collection and corpus staging. */
export function publicEditorialCollection(signal:AbortSignal,previousSnapshot?:IceoSnapshot):Promise<EditorialCollection>{
 signal.throwIfAborted();
 pendingCollection??=(async()=>{
  let retained:Pick<IceoSnapshot,'cards'>|undefined=previousSnapshot;
  try{const previous=await createNewsCorpusStore(process.env)?.read();if(previous)retained={cards:previous.corpus.cards};}
  catch{/* A store outage does not turn candidates into verified records. Fresh acquisition can still run. */}
  signal.throwIfAborted();
  const [collected,local]=await Promise.all([collectEditorialData(fetch,Date.now,undefined,process.env,signal,retained),collectCorpusLocalNews(signal)]);
  signal.throwIfAborted();
  // Generation describes this completed union. Individual source observation times are never rewritten.
  const completed=Date.now(),full:IceoSnapshot=Object.freeze({...collected.full,generatedAt:new Date(completed).toISOString()});
  return Object.freeze({snapshot:fitPublicSnapshot(full),corpus:buildNewsCorpus(full,local,completed),diagnostics:collected.diagnostics});
 })().finally(()=>{pendingCollection=undefined;});
 return pendingCollection;
}
