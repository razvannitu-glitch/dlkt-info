import {XMLParser} from 'fast-xml-parser';
import {NEWS_INDEX_URL} from './news-sources.js';
import {readNewsCandidates} from './news-discovery.js';
import {qualifyDiscoveryBatch,type DiscoveryProposal,type DiscoveryRejection} from './discovery-qualification.js';
import {stageSourceCandidate,worldSourceAtlas} from './world-source-atlas.js';

/** Operator-only GDELT source-directory audit, no article requests or publication. */
export interface GdeltDirectoryReport {
 readonly index:'gdelt-gal';
 readonly checkedAt:string;
 readonly feedItems:number;
 readonly uniqueOrigins:number;
 readonly previouslyIndexedOrigins:number;
 readonly duplicateOrigins:number;
 readonly invalidItems:number;
 readonly deferredCapacity:number;
 readonly rejections:readonly DiscoveryRejection[];
 readonly proposals:readonly DiscoveryProposal[];
 readonly activationAllowed:false;
}
const MAX_FEED_BYTES=3_145_728;
const MAX_PROPOSALS=200;
const TIMEOUT_MS=7_000;
const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const originKey=(origin:string):string=>new URL(origin).hostname.replace(/^www\./u,'');
const instant=(now:number):string=>{
 if(!Number.isFinite(now)||now<0)throw Error('ICEO_GDELT_CLOCK_INVALID');
 try{return new Date(now).toISOString();}catch{throw Error('ICEO_GDELT_CLOCK_INVALID');}
};

/** Reuse the strict production parser to authenticate feed identity, size and freshness. */
export function inspectGdeltDirectoryFeed(xml:string,now:number):GdeltDirectoryReport {
 const checkedAt=instant(now);
 readNewsCandidates(xml,now);
 const parsed:unknown=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:true}).parse(xml);
 if(!isRecord(parsed)||!isRecord(parsed.rss)||!isRecord(parsed.rss.channel))throw Error('ICEO_GDELT_SCHEMA_INVALID');
 const raw=parsed.rss.channel.item;
 const rows:readonly unknown[]=raw===undefined?[]:Array.isArray(raw)?raw:[raw];
 const known=new Set(worldSourceAtlas().map(entry=>originKey(entry.origin)));
 const encountered=new Set<string>(),inputs:Record<string,string>[]=[];
 let previouslyIndexedOrigins=0,duplicateOrigins=0,invalidItems=0,deferredCapacity=0;
 for(const item of rows){
  if(!isRecord(item)||typeof item.link!=='string'){invalidItems++;continue;}
  let url:URL;
  try{url=new URL(item.link);}
  catch{invalidItems++;continue;}
  if(url.protocol!=='https:'||url.username||url.password||url.port||
     url.href.length>3000||/[\u0000-\u0020\u007f<>\\]/u.test(item.link)){
   invalidItems++;continue;
  }
  const key=originKey(url.origin);
  if(encountered.has(key)){duplicateOrigins++;continue;}
  encountered.add(key);
  if(known.has(key)){previouslyIndexedOrigins++;continue;}
  // A domain is only an observation, never an authenticated publisher identity.
  if(stageSourceCandidate(url.origin,url.hostname)===null){invalidItems++;continue;}
  if(inputs.length>=MAX_PROPOSALS){deferredCapacity++;continue;}
  inputs.push({index:'gdelt',recordUrl:NEWS_INDEX_URL,observedAt:checkedAt,sourceUrl:url.origin,sourceName:url.hostname});
 }
 const staged=qualifyDiscoveryBatch(inputs,checkedAt);
 return Object.freeze({
  index:'gdelt-gal',checkedAt,feedItems:rows.length,uniqueOrigins:encountered.size,
  previouslyIndexedOrigins,duplicateOrigins,invalidItems,deferredCapacity,
  rejections:staged.rejected,proposals:staged.proposals,activationAllowed:false,
 });
}

/** Exactly one hardcoded GDELT request, no redirects, timeout, streaming size cap. */
export async function collectGdeltDirectoryOnce(fetcher:typeof fetch,now:number):Promise<GdeltDirectoryReport> {
 instant(now);
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 const run=async():Promise<GdeltDirectoryReport>=>{
  const response=await fetcher(NEWS_INDEX_URL,{
   method:'GET',credentials:'omit',redirect:'manual',cache:'no-store',signal:controller.signal,
   headers:{Accept:'application/rss+xml, application/xml, text/xml','User-Agent':'DLKT-Info-ICEO/1.0 (+https://www.dlkt.ee)'},
  });
  if(response.redirected||response.status>=300&&response.status<400){await response.body?.cancel();throw Error('ICEO_GDELT_REDIRECT_REJECTED');}
  if(!response.ok){await response.body?.cancel();throw Error('ICEO_GDELT_HTTP_UNAVAILABLE');}
  const mime=(response.headers.get('content-type')??'').split(';')[0]?.trim().toLowerCase();
  if(!['application/rss+xml','application/xml','text/xml'].includes(mime??'')){
   await response.body?.cancel();throw Error('ICEO_GDELT_CONTENT_TYPE_INVALID');
  }
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>MAX_FEED_BYTES)){
   await response.body?.cancel();throw Error('ICEO_GDELT_RESPONSE_TOO_LARGE');
  }
  if(!response.body)throw Error('ICEO_GDELT_EMPTY');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];
  let total=0;
  const cancel=():void=>{void reader.cancel().catch(()=>undefined);};
  controller.signal.addEventListener('abort',cancel,{once:true});
  try{
   for(;;){
    const part=await reader.read();
    if(part.done)break;
    total+=part.value.byteLength;
    if(total>MAX_FEED_BYTES){await reader.cancel();throw Error('ICEO_GDELT_RESPONSE_TOO_LARGE');}
    chunks.push(part.value);
   }
  }finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
  if(total===0)throw Error('ICEO_GDELT_EMPTY');
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  return inspectGdeltDirectoryFeed(xml,now);
 };
 try{
  return await Promise.race([
   run(),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('ICEO_GDELT_TIMEOUT'));},TIMEOUT_MS);}),
  ]);
 }finally{if(timer)clearTimeout(timer);controller.abort();}
}
