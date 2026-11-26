import {createHash} from 'node:crypto';
import {parseDocument,DomUtils} from 'htmlparser2';
import {robotsAllowed} from '../source/.build/src/local/publications.js';
import {ARCUB_AGENDA,parseArcubAgenda} from '../source/.build/src/local/arcub.js';
import {photoPublisher,readArticlePhoto} from '../source/.build/src/media/article-photo-source.js';
import {inspectPhotoRaster} from '../source/.build/src/media/article-photo-raster.js';

// Finite public-source observation, using the existing publisher-probe workflow.
// No credentials, redirects, source registration, publication or licence inference.
const startedAt=Date.now(),deadline=startedAt+75_000;
const limits={robots:1,agenda:1,page:2,image:2},attempts={robots:0,agenda:0,page:0,image:0};
const digest=value=>createHash('sha256').update(value).digest('hex');
async function get(url,kind) {
 if(attempts[kind]>=limits[kind]||Date.now()>=deadline)throw Error('LOCAL_PHOTO_PROBE_LIMIT');
 attempts[kind]++;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(12_000,deadline-Date.now()));
 try {
  const response=await fetch(url,{redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{'User-Agent':'DLKT-Info/0.9.46 (+https://www.dlkt.ee)','Accept-Encoding':'identity',Accept:kind==='robots'?'text/plain':kind==='image'?'image/jpeg,image/png,image/webp':'text/html'}});
  const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
  if(response.status!==200){await response.body?.cancel();if(kind==='robots'&&response.status===404)return{bytes:Buffer.alloc(0),status:404,type};throw Error('LOCAL_PHOTO_HTTP_'+response.status);}
  const accepted=kind==='robots'?['text/plain']:kind==='image'?['image/jpeg','image/png','image/webp']:['text/html','application/xhtml+xml'];
  if(!accepted.includes(type)){await response.body?.cancel();throw Error('LOCAL_PHOTO_MIME_'+kind);}
  const limit=kind==='robots'?65536:kind==='image'?1_572_864:1_048_576;
  if(Number(response.headers.get('content-length')??0)>limit){await response.body?.cancel();throw Error('LOCAL_PHOTO_BYTES');}
  if(!response.body)throw Error('LOCAL_PHOTO_EMPTY');
  const reader=response.body.getReader(),chunks=[];let total=0;
  try {for(;;){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.byteLength;if(total>limit)throw Error('LOCAL_PHOTO_BYTES');chunks.push(Buffer.from(chunk.value));}}
  finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  return {bytes:Buffer.concat(chunks),status:response.status,type};
 } finally {clearTimeout(timer);}
}
const attrs=element=>Object.fromEntries(Object.entries(element.attribs??{}).filter(([key])=>['src','srcset','alt','class','id','width','height','href','rel','property','name','content','type'].includes(key)).map(([key,value])=>[key,String(value).slice(0,3000)]));
function sourceImage(raw,page){
 try {const u=new URL(raw,page);return u.protocol==='https:'&&u.origin==='https://arcub.ro'&&!u.username&&!u.password&&!u.port&&!u.hash&&/^\/img\/[a-f0-9-]{36}\/[a-zA-Z0-9._-]+\.(?:jpe?g|png|webp)$/u.test(u.pathname)?u.href:null;}catch{return null;}
}
const report={probe:'dlkt-local-source-photos-1',commit:process.env.GITHUB_SHA??null,startedAt:new Date(startedAt).toISOString(),limits,attempts,pages:[]};
try {
 const robot=await get('https://arcub.ro/robots.txt','robots'),policy=robot.bytes.toString('utf8');
 report.robots={status:robot.status,type:robot.type,sha256:digest(robot.bytes),body:policy.slice(0,3000)};
 if(!robotsAllowed(policy,ARCUB_AGENDA))throw Error('LOCAL_PHOTO_ROBOTS_AGENDA');
 const agenda=await get(ARCUB_AGENDA,'agenda'),checkedAt=new Date().toISOString(),parsed=parseArcubAgenda({body:agenda.bytes.toString('utf8'),checkedAt},Date.now());
 report.agenda={url:ARCUB_AGENDA,sha256:digest(agenda.bytes),checkedAt,count:parsed.cards.length};
 const selected=parsed.cards.filter(card=>/Magia Cr|identitate prin tradi/iu.test(card.title)).slice(0,2);if(selected.length!==2)throw Error('LOCAL_PHOTO_TWO_EVENTS_REQUIRED');
 for(const card of selected){
  if(!robotsAllowed(policy,card.sourceUrl))throw Error('LOCAL_PHOTO_ROBOTS_PAGE');
  const response=await get(card.sourceUrl,'page'),html=response.bytes.toString('utf8'),document=parseDocument(html);
  const meta=DomUtils.getElementsByTagName('meta',document,true).filter(element=>/^(og:|article:)/u.test(element.attribs.property??element.attribs.name??'')).slice(0,24).map(attrs);
  const canonical=DomUtils.getElementsByTagName('link',document,true).filter(element=>(element.attribs.rel??'').split(/\s+/u).includes('canonical')).map(attrs);
  const structured=DomUtils.getElementsByTagName('script',document,true).filter(element=>element.attribs.type==='application/ld+json').slice(0,4).map(element=>DomUtils.textContent(element).slice(0,5000));
  const headings=DomUtils.getElementsByTagName('h1',document,true).map(element=>DomUtils.textContent(element).trim().slice(0,500));
  const images=DomUtils.getElementsByTagName('img',document,true).filter(element=>sourceImage(element.attribs.src,card.sourceUrl)).slice(0,8).map(element=>{const parents=[];for(let p=element.parent;p&&parents.length<5;p=p.parent)if(p.type==='tag')parents.push({tag:p.name,...attrs(p)});return {...attrs(element),parents};});
  const article={id:card.id,revision:card.context.documentHash,sourceUrl:card.sourceUrl,title:card.title,publisher:'ARCUB',publishedAt:'',validUntil:Date.now()+300000,documentKind:'local-event'};
  const photo=readArticlePhoto(html,article),candidate=photo?.imageUrl;
  if(!photo||photo.basis!=='local-event-hero')throw Error('LOCAL_PHOTO_EXACT_HERO_REQUIRED');
  const entry={id:card.id,title:card.title,url:card.sourceUrl,htmlSha256:digest(response.bytes),meta,canonical,headings,images,structured,publisher:photoPublisher(card.sourceUrl),parser:photo};
  report.pages.push(entry);
  if(!candidate)throw Error('LOCAL_PHOTO_SOURCE_IMAGE_MISSING');
  if(!robotsAllowed(policy,candidate))throw Error('LOCAL_PHOTO_ROBOTS_IMAGE');
  const image=await get(candidate,'image'),raster=inspectPhotoRaster(image.bytes);
  if(!raster||raster.mime!==image.type)throw Error('LOCAL_PHOTO_RASTER');
  entry.image={url:candidate,status:image.status,mime:image.type,...raster,bytes:image.bytes.length,sha256:digest(image.bytes)};
  if(photoPublisher(card.sourceUrl)&&!photo)throw Error('LOCAL_PHOTO_PARSER_REJECTED');
 }
 report.outcome='observed';
} catch(error){report.outcome='incomplete';report.error=error instanceof Error?error.message:'LOCAL_PHOTO_PROBE_FAILED';process.exitCode=1;}
report.finishedAt=new Date().toISOString();report.boundary='Public source observations; no licence claim, no generated or substituted image, no production write.';
console.log(JSON.stringify(report,null,2));
