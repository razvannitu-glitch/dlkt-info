import {createHash} from 'node:crypto';
import {readBounded,sourceRetryDelay} from '../iceo/transport.js';
import {robotsAllowed} from '../local/publications.js';
import {articleImageUrl,photoPublisher,readArticlePhoto,PHOTO_HTML_LIMIT,type PhotoArticle,type ArticlePhotoMetadata} from './article-photo-source.js';
import {inspectPhotoRaster,type PhotoRaster} from './article-photo-raster.js';

export const PHOTO_IMAGE_LIMIT=1_572_864;
const PHOTO_TTL=300000,FAILURE_TTL=60000,MAX_CACHE_BYTES=24*1024*1024;
export interface ArticlePhotoResult extends PhotoRaster {
 readonly bytes:Buffer; readonly sha256:string; readonly metadata:ArticlePhotoMetadata; readonly checkedAt:number; readonly until:number;
}
interface PhotoEntry {readonly result:ArticlePhotoResult|null;readonly until:number}
interface RobotsEntry {readonly body:string;readonly until:number}
const headers=(accept:string):Record<string,string>=>({Accept:accept,'Accept-Encoding':'identity','User-Agent':'DLKT-Info/0.9.46 (+https://www.dlkt.ee)'});
/** Public preview only: bounded, coalesced and never allowed to fetch a caller-supplied source URL. */
export class ArticlePhotoService {
 private readonly cache=new Map<string,PhotoEntry>();
 private readonly pending=new Map<string,Promise<ArticlePhotoResult|null>>();
 private readonly robots=new Map<string,RobotsEntry>();
 private readonly pendingRobots=new Map<string,Promise<string>>();
 private readonly backoff=new Map<string,number>();
 private cacheBytes=0;
 constructor(private readonly fetcher:typeof fetch=fetch,private readonly clock:()=>number=Date.now){}
 private remember(key:string,entry:PhotoEntry):void {
  const previous=this.cache.get(key);if(previous?.result)this.cacheBytes-=previous.result.bytes.byteLength;
  this.cache.delete(key);
  while(this.cache.size>=64||this.cacheBytes+(entry.result?.bytes.byteLength??0)>MAX_CACHE_BYTES){
   const first=this.cache.keys().next().value;if(first===undefined)break;
   const prior=this.cache.get(first);if(prior?.result)this.cacheBytes-=prior.result.bytes.byteLength;this.cache.delete(first);
  }
  this.cache.set(key,entry);this.cacheBytes+=entry.result?.bytes.byteLength??0;
 }
 async read(article:PhotoArticle):Promise<ArticlePhotoResult|null> {
  const now=this.clock();
  if(!photoPublisher(article.sourceUrl)||!/^[a-f0-9]{64}$/u.test(article.revision)||!Number.isFinite(article.validUntil)||article.validUntil<=now)return null;
  const key=article.sourceUrl+'\n'+article.revision,hit=this.cache.get(key);
  if(hit&&hit.until>now)return hit.result;
  const running=this.pending.get(key);if(running)return running;
  if(this.pending.size>=8)throw Error('ARTICLE_PHOTO_BUSY');
  const job=(async():Promise<ArticlePhotoResult|null>=>{
   try{
    const result=await this.acquire(article);
    this.remember(key,{result,until:result?.until??Math.min(article.validUntil,this.clock()+FAILURE_TTL)});
    return result;
   }catch{
    this.remember(key,{result:null,until:Math.min(article.validUntil,this.clock()+FAILURE_TTL)});return null;
   }
  })();
  this.pending.set(key,job);try{return await job;}finally{this.pending.delete(key);}
 }
 private async request(address:string,accept:string,signal:AbortSignal):Promise<Response> {
  const origin=new URL(address).origin;if((this.backoff.get(origin)??0)>this.clock())throw Error('ARTICLE_PHOTO_BACKOFF');
  const response=await this.fetcher(address,{method:'GET',credentials:'omit',redirect:'manual',cache:'no-store',headers:headers(accept),signal});
  if([401,402,403,429].includes(response.status)||response.status>=500){
   const delay=sourceRetryDelay(response.headers,this.clock());this.backoff.set(origin,this.clock()+Math.max(60000,(delay??60)*1000));
   if(this.backoff.size>32)this.backoff.delete(this.backoff.keys().next().value??'');
  }
  return response;
 }
 private async robotsBody(origin:string,signal:AbortSignal):Promise<string> {
  const hit=this.robots.get(origin);if(hit&&hit.until>this.clock())return hit.body;
  const running=this.pendingRobots.get(origin);if(running)return running;
  const job=(async():Promise<string>=>{
   const response=await this.request(origin+'/robots.txt','text/plain',signal);
   let body:string;
   if(response.status===404){await response.body?.cancel();body='';}
   else{
    if(response.status!==200||(response.headers.get('content-type')??'').split(';')[0]?.trim().toLowerCase()!=='text/plain'){
     await response.body?.cancel();throw Error('ARTICLE_PHOTO_ROBOTS_UNAVAILABLE');
    }
    body=await readBounded(response,65536);
   }
   if(this.robots.size>=24)this.robots.delete(this.robots.keys().next().value??'');
   this.robots.set(origin,{body,until:this.clock()+21600000});return body;
  })();
  this.pendingRobots.set(origin,job);try{return await job;}finally{this.pendingRobots.delete(origin);}
 }
 private async imageBytes(address:string,articleUrl:string,signal:AbortSignal):Promise<Buffer> {
  let current=address;
  for(let redirects=0;redirects<=2;redirects++){
   if(articleImageUrl(current,articleUrl)!==current)throw Error('ARTICLE_PHOTO_IMAGE_URL');
   const response=await this.request(current,'image/jpeg, image/png, image/webp',signal);
   if(response.status>=300&&response.status<400){
    const target=response.headers.get('location');await response.body?.cancel();
    const next=target?articleImageUrl(new URL(target,current).href,articleUrl):null;
    if(!next||redirects===2)throw Error('ARTICLE_PHOTO_IMAGE_REDIRECT');current=next;continue;
   }
   const mime=(response.headers.get('content-type')??'').split(';')[0]?.trim().toLowerCase();
   if(response.status!==200||!['image/jpeg','image/png','image/webp'].includes(mime??'')){await response.body?.cancel();throw Error('ARTICLE_PHOTO_IMAGE_TYPE');}
   const declared=response.headers.get('content-length');
   if(declared&&(!/^\d+$/u.test(declared)||Number(declared)>PHOTO_IMAGE_LIMIT)){await response.body?.cancel();throw Error('ARTICLE_PHOTO_IMAGE_SIZE');}
   if(!response.body)throw Error('ARTICLE_PHOTO_IMAGE_EMPTY');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
    if(size>PHOTO_IMAGE_LIMIT){await reader.cancel();throw Error('ARTICLE_PHOTO_IMAGE_SIZE');}chunks.push(part.value);
   }}finally{reader.releaseLock();}
   const bytes=Buffer.concat(chunks),raster=inspectPhotoRaster(bytes);
   if(!raster||raster.mime!==mime)throw Error('ARTICLE_PHOTO_IMAGE_INVALID');
   return bytes;
  }
  throw Error('ARTICLE_PHOTO_IMAGE_REDIRECT');
 }
 private async acquire(article:PhotoArticle):Promise<ArticlePhotoResult|null> {
  const signal=AbortSignal.timeout(12000),origin=new URL(article.sourceUrl).origin;
  if(!robotsAllowed(await this.robotsBody(origin,signal),article.sourceUrl))return null;
  const response=await this.request(article.sourceUrl,'text/html, application/xhtml+xml',signal);
  // The article URL is already canonical in the verified catalog. A redirect cannot silently switch identity.
  if(response.status!==200||!['text/html','application/xhtml+xml'].includes((response.headers.get('content-type')??'').split(';')[0]?.trim().toLowerCase()??'')){
   await response.body?.cancel();return null;
  }
  const html=await readBounded(response,PHOTO_HTML_LIMIT),metadata=readArticlePhoto(html,article);
  if(!metadata)return null;
  const bytes=await this.imageBytes(metadata.imageUrl,article.sourceUrl,signal),raster=inspectPhotoRaster(bytes),checkedAt=this.clock();
  if(!raster||checkedAt>=article.validUntil)return null;
  if(metadata.expectedDimensions&&(raster.width!==metadata.expectedDimensions.width||raster.height!==metadata.expectedDimensions.height))return null;
  return{...raster,bytes,sha256:createHash('sha256').update(bytes).digest('hex'),metadata,checkedAt,until:Math.min(article.validUntil,checkedAt+PHOTO_TTL)};
 }
}
export const articlePhotoService=new ArticlePhotoService();
