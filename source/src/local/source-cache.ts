import {allowedPlacesQuery,placesSourceError} from './places.js';
/** Fixed-origin, bounded JSON transport. Never accepts a URL from a browser. */
export interface JsonDocument {readonly value:unknown;readonly checkedAt:string;readonly expiresAt:number}
interface Entry extends JsonDocument{readonly lastModified:string|null}
export class LocalSourceCache{
 private readonly entries=new Map<string,Entry>();private readonly inflight=new Map<string,Promise<JsonDocument>>();private blockedUntil=0;private readonly failures=new Map<string,number>();
 constructor(private readonly fetcher:typeof fetch=fetch,private readonly clock:()=>number=Date.now){}
 async read(url:string,minimumMs:number):Promise<JsonDocument>{
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!['api.met.no','api.tfl.gov.uk','overpass.private.coffee'].includes(u.hostname))throw Error('LOCAL_SOURCE_FORBIDDEN');
  if(u.hostname==='api.met.no'&&(u.pathname!=='/weatherapi/locationforecast/2.0/compact'||[...u.searchParams.keys()].some(k=>!['lat','lon'].includes(k))))throw Error('LOCAL_SOURCE_FORBIDDEN');
  if(u.hostname==='api.tfl.gov.uk'&&(u.pathname!=='/Line/Mode/tube/Status'||u.search))throw Error('LOCAL_SOURCE_FORBIDDEN');
  if(u.hostname==='overpass.private.coffee'&&!allowedPlacesQuery(u))throw Error('LOCAL_SOURCE_FORBIDDEN');
  const prior=this.entries.get(url),now=this.clock();if(prior&&prior.expiresAt>now)return prior;if(this.inflight.size>=6||now<(this.failures.get(url)??0)||now<this.blockedUntil)throw Error('LOCAL_SOURCE_BACKOFF');const running=this.inflight.get(url);if(running)return running;
  const task=this.fetchDocument(url,prior,minimumMs);this.inflight.set(url,task);try{const value=await task;this.failures.delete(url);return value;}catch(error){if(this.failures.size>=256)this.failures.delete(this.failures.keys().next().value??'');this.failures.set(url,this.clock()+60000);throw error;}finally{this.inflight.delete(url);}
 }
 private async fetchDocument(url:string,prior:Entry|undefined,minimumMs:number):Promise<Entry>{
  const now=this.clock();const headers:Record<string,string>={Accept:'application/json','User-Agent':'DLKT/0.9.36 (+https://www.dlkt.ee; office@dlkt.ee)'};if(prior?.lastModified)headers['If-Modified-Since']=prior.lastModified;
  const r=await this.fetcher(url,{headers,redirect:'error',signal:AbortSignal.timeout(8000)});const expiry=Date.parse(r.headers.get('expires')??'');const expiresAt=Math.max(now+minimumMs,Number.isFinite(expiry)?expiry:0);
  if(r.status===429||r.status===503){const retry=r.headers.get('retry-after');const delay=retry&&/^\d+$/u.test(retry)?Number(retry)*1000:Date.parse(retry??'')-now;this.blockedUntil=now+Math.min(86400000,Math.max(60000,Number.isFinite(delay)?delay:0));await r.body?.cancel();throw Error('LOCAL_SOURCE_BACKOFF');}
  if(r.status===304&&prior){const entry={...prior,checkedAt:new Date(now).toISOString(),expiresAt};this.entries.set(url,entry);return entry;}
  if(r.status!==200||!r.headers.get('content-type')?.includes('json')){await r.body?.cancel();throw Error('LOCAL_SOURCE_UNAVAILABLE');}
  const reader=r.body?.getReader();if(!reader)throw Error('LOCAL_SOURCE_EMPTY');let length=0;const parts:Uint8Array[]=[];try{while(true){const p=await reader.read();if(p.done)break;length+=p.value.length;if(length>1_048_576)throw Error('LOCAL_SOURCE_TOO_LARGE');parts.push(p.value);}}finally{await reader.cancel();}
  const value:unknown=JSON.parse(Buffer.concat(parts).toString('utf8'));if(new URL(url).hostname==='overpass.private.coffee'&&placesSourceError(value))throw Error('LOCAL_SOURCE_PARTIAL_ERROR');const entry={value,checkedAt:new Date(now).toISOString(),expiresAt,lastModified:r.headers.get('last-modified')};
  if(this.entries.size>=256)this.entries.delete(this.entries.keys().next().value??'');this.entries.set(url,entry);return entry;
 }
}
