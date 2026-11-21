import type {IceoSnapshot, SourceResult} from './contracts.js';
import {iceoEngine, reconcile} from './engine.js';
import {discoverNews, type NewsCandidate} from './news-discovery.js';
import {createNewsCandidateStore} from './news-store.js';
import {newsBackoffFetch} from './news-backoff.js';

/** Public news discovery and official records share one read-only catalog; no private profile enters it. */
export async function collectEditorialSnapshot(
  fetcher:typeof fetch=fetch,
  clock:()=>number=Date.now,
  officialLoad:(()=>Promise<IceoSnapshot>)|undefined=undefined,
  environment:Readonly<Record<string,string|undefined>>=process.env,
  signal?:AbortSignal,
):Promise<IceoSnapshot>{
  signal?.throwIfAborted();
  const boundedFetch:typeof fetch=signal?((input,init)=>{signal.throwIfAborted();return fetcher(input,{...init,signal:init?.signal?AbortSignal.any([signal,init.signal]):signal});}):fetcher;
  const now=clock(),official=officialLoad?officialLoad():iceoEngine.snapshot(signal);
  const news=(async():Promise<readonly SourceResult[]>=>{
    const store=createNewsCandidateStore(environment,boundedFetch);
    let candidates:readonly NewsCandidate[]=[];
    if(store){try{candidates=(await store.read(now)).candidates;}catch{/* A failed pool read never creates publication evidence. */}}
    signal?.throwIfAborted();
    const newsFetch=environment.VERCEL==='1'?newsBackoffFetch(boundedFetch,clock):boundedFetch;
    return discoverNews(newsFetch,now,candidates,async pool=>{
      if(store?.writable)await store.write(pool,clock());
    });
  })();
  const [base,discovered]=await Promise.all([official,news]);
  signal?.throwIfAborted();
  const records:SourceResult[]=base.sources.map(health=>({health,cards:base.cards.filter(card=>card.sourceIds.includes(health.id))}));
  const combined=reconcile([...records,...discovered]);
  const conflicts=combined.conflictCount+base.conflictCount;
  return Object.freeze({...combined,mode:'current-source-records',conflictCount:conflicts,state:conflicts>0&&combined.state==='ready'?'partial':combined.state});
}

let pending:Promise<IceoSnapshot>|undefined;
/** Collector entry point for the authenticated durable lease holder, never the public read path. */
export function publicEditorialSnapshot(signal?:AbortSignal):Promise<IceoSnapshot>{
  signal?.throwIfAborted();
  pending??=collectEditorialSnapshot(fetch,Date.now,undefined,process.env,signal).finally(()=>{pending=undefined;});
  return pending;
}
