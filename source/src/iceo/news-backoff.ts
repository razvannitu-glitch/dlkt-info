import {createHash} from 'node:crypto';
import {getCache} from '@vercel/functions';

export const NEWS_BACKOFF_NAMESPACE='prj_3JKAWw8EvzWKNPqFNFxk4iDL2l7P:news-origin-backoff-1';
export const NEWS_BACKOFF_IO_TIMEOUT_MS=500;
const VERSION='news-origin-backoff-1';
const DEFAULT_RETRY_MS=60_000,AUTH_RETRY_MS=3_600_000;
// A syntactically valid longer server instruction is retained, not shortened.
// Reject impossible/out-of-range timestamps rather than manufacturing permission.
const MAX_TIMESTAMP=8_640_000_000_000_000;
const MAX_ORIGINS=256;
export interface NewsBackoffStore {
  read(key:string):Promise<unknown>;
  write(key:string,value:unknown,ttlSeconds:number):Promise<void>;
}
interface BackoffRecord {
  readonly version:typeof VERSION;
  readonly origin:string;
  readonly recordedAt:number;
  readonly blockedUntil:number;
  readonly status:401|402|403|429|503;
}
export function newsBackoffKey(origin:string):string {
  return `origin:${createHash('sha256').update(origin).digest('hex')}`;
}
async function bounded<T>(operation:()=>Promise<T>):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('NEWS_BACKOFF_STORE_UNAVAILABLE')),NEWS_BACKOFF_IO_TIMEOUT_MS);
  })]);}finally{if(timer)clearTimeout(timer);}
}
function validRecord(value:unknown,origin:string,now:number):value is BackoffRecord {
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const record=value as Record<string,unknown>;
  return Object.keys(record).sort().join('|')==='blockedUntil|origin|recordedAt|status|version'
    &&record.version===VERSION&&record.origin===origin&&[401,402,403,429,503].includes(Number(record.status))
    &&typeof record.status==='number'&&typeof record.recordedAt==='number'&&Number.isSafeInteger(record.recordedAt)
    &&typeof record.blockedUntil==='number'&&Number.isSafeInteger(record.blockedUntil)
    &&record.recordedAt>=0&&record.recordedAt<=now+300_000&&record.blockedUntil>record.recordedAt&&record.blockedUntil<=MAX_TIMESTAMP;
}
function untilFrom(response:Response,now:number):number {
  const fallback=now+([401,402,403].includes(response.status)?AUTH_RETRY_MS:DEFAULT_RETRY_MS);
  const raw=response.headers.get('retry-after')?.trim();
  if(!raw)return fallback;
  let until:number;
  if(/^\d{1,12}$/u.test(raw))until=now+Number(raw)*1000;
  else if(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(raw))until=Date.parse(raw);
  else return fallback;
  if(!Number.isSafeInteger(until)||until>MAX_TIMESTAMP)return fallback;
  return Math.max(now+1000,until,[401,402,403].includes(response.status)?fallback:now);
}
function denied(status:401|402|403|429|503,until:number,now:number,code:string):Response {
  return new Response(JSON.stringify({error:code}),{status,headers:{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','Retry-After':String(Math.max(1,Math.ceil((until-now)/1000)))}});
}
function waitForResponse(pending:Promise<Response>,signal:AbortSignal|null):Promise<Response> {
  if(!signal)return pending;
  if(signal.aborted)return Promise.reject(signal.reason);
  return new Promise<Response>((resolve,reject)=>{
    const abort=():void=>{signal.removeEventListener('abort',abort);reject(signal.reason);};
    signal.addEventListener('abort',abort,{once:true});
    pending.then(response=>{signal.removeEventListener('abort',abort);if(signal.aborted){void response.body?.cancel().catch(()=>undefined);reject(signal.reason);}else resolve(response);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}

/**
 * Public, origin-only backoff. Same-origin requests are serialized so a 429/403
 * observed by the first request blocks queued requests. Other origins proceed.
 * Cache read/write failures fail closed. Runtime Cache is evictable: this is not
 * durable rate-limit state across cache eviction or platform outages.
 */
export function createNewsBackoffFetch(fetcher:typeof fetch,store:NewsBackoffStore,clock:()=>number=Date.now):typeof fetch {
  const memory=new Map<string,BackoffRecord>(),queues=new Map<string,Promise<void>>();
  const remember=(record:BackoffRecord):void=>{
    if(!memory.has(record.origin)&&memory.size>=MAX_ORIGINS){const oldest=memory.keys().next().value;if(oldest!==undefined)memory.delete(oldest);}
    memory.set(record.origin,record);
  };
  const wrapped:typeof fetch=async(input,init)=>{
    const request=input instanceof Request?input:null;
    const url=new URL(request?.url??String(input));
    if(url.protocol!=='https:'||url.username||url.password||url.port)throw new TypeError('NEWS_BACKOFF_URL_INVALID');
    const method=(init?.method??request?.method??'GET').toUpperCase();
    if(method!=='GET'&&method!=='HEAD')throw new TypeError('NEWS_BACKOFF_READ_ONLY');
    const signal=init?.signal??request?.signal??null,origin=url.origin;
    signal?.throwIfAborted();
    if(!queues.has(origin)&&queues.size>=MAX_ORIGINS)return denied(503,clock()+DEFAULT_RETRY_MS,clock(),'NEWS_BACKOFF_CAPACITY');
    const run=async():Promise<Response>=>{
      signal?.throwIfAborted();
      const now=clock();if(!Number.isSafeInteger(now)||now<0||now>=MAX_TIMESTAMP)throw new Error('NEWS_BACKOFF_CLOCK_INVALID');
      const known=memory.get(origin);
      if(known&&known.blockedUntil>now)return denied(known.status,known.blockedUntil,now,'NEWS_ORIGIN_BACKOFF');
      if(known)memory.delete(origin);
      try{
        const stored=await bounded(()=>store.read(newsBackoffKey(origin)));
        if(stored!==undefined&&stored!==null){
          if(!validRecord(stored,origin,now))throw new Error('NEWS_BACKOFF_RECORD_INVALID');
          if(stored.blockedUntil>now){remember(stored);return denied(stored.status,stored.blockedUntil,now,'NEWS_ORIGIN_BACKOFF');}
        }
      }catch{
        const record:BackoffRecord={version:VERSION,origin,recordedAt:now,blockedUntil:now+DEFAULT_RETRY_MS,status:503};remember(record);
        return denied(503,record.blockedUntil,now,'NEWS_BACKOFF_STORE_UNAVAILABLE');
      }
      signal?.throwIfAborted();
      const response=await fetcher(input,init);
      if(![401,402,403,429,503].includes(response.status))return response;
      const observed=clock();if(!Number.isSafeInteger(observed)||observed<0||observed>=MAX_TIMESTAMP){await response.body?.cancel();throw new Error('NEWS_BACKOFF_CLOCK_INVALID');}
      const record:BackoffRecord={version:VERSION,origin,recordedAt:observed,blockedUntil:untilFrom(response,observed),status:response.status as BackoffRecord['status']};
      remember(record);
      try{
        await bounded(()=>store.write(newsBackoffKey(origin),record,Math.max(1,Math.ceil((record.blockedUntil-observed)/1000))));
      }catch{
        await response.body?.cancel();
        return denied(503,record.blockedUntil,observed,'NEWS_BACKOFF_STORE_UNAVAILABLE');
      }
      return response;
    };
    const pending=(queues.get(origin)??Promise.resolve()).then(run);
    const tail=pending.then(()=>undefined,()=>undefined);queues.set(origin,tail);
    void tail.then(()=>{if(queues.get(origin)===tail)queues.delete(origin);});
    return waitForResponse(pending,signal);
  };
  return wrapped;
}

/** Shared across workers while present; eviction can remove a stored origin gate. */
export function newsBackoffFetch(fetcher:typeof fetch=fetch,clock:()=>number=Date.now):typeof fetch {
  const cache=getCache({namespace:NEWS_BACKOFF_NAMESPACE});
  return createNewsBackoffFetch(fetcher,{
    read:key=>cache.get(key),
    write:async(key,value,ttlSeconds)=>{await cache.set(key,value,{ttl:ttlSeconds,name:'DLKT INFO public news origin backoff'});},
  },clock);
}
