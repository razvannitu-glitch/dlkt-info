import {parseDocument,DomUtils} from 'htmlparser2';
import {robotsAllowed} from '../source/.build/src/local/publications.js';
import {readBounded} from '../source/.build/src/iceo/transport.js';

const TARGETS=Object.freeze([
 {publisher:'Buletin de Bucuresti',url:'https://buletin.de/bucuresti/numarul-elevilor-din-sectorul-5-inclusi-in-programul-scoala-dupa-scoala-ar-putea-creste-doua-scoli-au-cerut-includerea-mai-multor-copii/'},
 {publisher:'B365',url:'https://b365.ro/se-opreste-apa-in-mai-multe-zone-din-bucuresti-saptamana-viitoare-bulevardele-carol-i-timisoara-gara-obor-si-ferdinand-i-pe-lista-celor-afectate-de-lucrari-apa-nova-629580/'},
 {publisher:'The Guardian',url:'https://www.theguardian.com/world/2026/nov/22/south-korea-education-minister-resigns-after-ai-cheating-scandal-engulfs-university-exams'},
]);
const ORIGINS=new Set(TARGETS.map(target=>new URL(target.url).origin));
const USER_AGENT='DLKT-Info/0.9.46 (+https://www.dlkt.ee)';
const clean=(value,max=400)=>typeof value==='string'&&value.length<=4000?value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/gu,' ').replace(/\s+/gu,' ').trim().slice(0,max):null;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>/^[1-9][0-9]{0,5}$/u.test(String(value??''))?Number(value):null;
function url(value,base){
 if(typeof value!=='string'||!value||value.length>2048||/[\u0000-\u0020\u007f<>\\]/u.test(value))return null;
 try{const parsed=new URL(value,base);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port)return null;parsed.hash='';return parsed.href;}catch{return null;}
}
function articleKey(value,base){
 const parsed=url(value,base);if(!parsed)return null;
 const u=new URL(parsed);return u.origin+u.pathname.replace(/\/+$/u,'')+u.search;
}
async function fetchText(start,robots,policy=null){
 const origin=new URL(start).origin;if(!ORIGINS.has(origin))throw Error('PROBE_ORIGIN_NOT_AUTHORIZED');
 const signal=AbortSignal.timeout(8000);let current=start;
 for(let hop=0;hop<=2;hop++){
  if(!robots&&!robotsAllowed(policy??'',current))return{status:null,url:current,error:'ROBOTS_REDIRECT_DENIED'};
  const response=await fetch(current,{method:'GET',credentials:'omit',redirect:'manual',signal,headers:{
   Accept:robots?'text/plain':'text/html','Accept-Encoding':'identity','User-Agent':USER_AGENT,
  }});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');await response.body?.cancel();
   const next=url(location,current);
   if(!next||new URL(next).origin!==origin||hop===2)return{status:response.status,url:current,error:'REDIRECT_REJECTED'};
   current=next;continue;
  }
  const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
  if(response.status!==200){await response.body?.cancel();return{status:response.status,url:current,type,error:'HTTP_'+response.status};}
  if(!(robots?['text/plain']:['text/html','application/xhtml+xml']).includes(type)){await response.body?.cancel();return{status:response.status,url:current,type,error:'CONTENT_TYPE_REJECTED'};}
  const limit=robots?65536:1048576,declared=response.headers.get('content-length');
  if(declared!==null&&Number(declared)>limit){await response.body?.cancel();return{status:response.status,url:current,type,error:'BODY_LIMIT'};}
  return{status:response.status,url:current,type,body:await readBounded(response,limit)};
 }
 throw Error('REDIRECT_LIMIT');
}
function extract(html,requested,finalUrl){
 if(Buffer.byteLength(html,'utf8')>1048576||/<!\s*(?:ENTITY|DOCTYPE[^>]*\[)/iu.test(html))throw Error('DOCUMENT_REJECTED');
 const doc=parseDocument(html,{decodeEntities:true});
 const head=DomUtils.findOne(node=>node.name==='head',doc.children);
 if(!head)return{state:'HEAD_MISSING'};
 const metas=DomUtils.findAll(node=>node.name==='meta',head.children).slice(0,500);
 const field=name=>metas.filter(node=>(node.attribs.property??node.attribs.name??'').toLowerCase()===name).map(node=>clean(node.attribs.content,2048)).filter(Boolean);
 const canonicalValues=DomUtils.findAll(node=>node.name==='link'&&(node.attribs.rel??'').toLowerCase().split(/\s+/u).includes('canonical'),head.children).map(node=>url(node.attribs.href,finalUrl));
 const canonicals=[...new Set(canonicalValues.filter(Boolean))];
 const canonical=canonicals.length===1?canonicals[0]:null;
 const exact=canonical!==null&&articleKey(canonical,finalUrl)===articleKey(requested,requested)&&canonicalValues.every(Boolean);
 const h1=DomUtils.findOne(node=>node.name==='h1',doc.children);
 const common={canonical,canonicalMatchesRequested:exact,headline:field('og:title')[0]??(h1?clean(DomUtils.textContent(h1)):null),date:field('article:published_time')[0]??null};
 if(!exact)return{...common,state:'CANONICAL_NOT_EXACT'};
 const declaredOgUrls=field('og:url');
 if(declaredOgUrls.some(value=>articleKey(value,finalUrl)!==articleKey(canonical,finalUrl)))return{...common,state:'OG_URL_CONFLICT'};
 const nodes=[],ids=new Map();let visited=0;
 function walk(value,depth=0){
  if(depth>8||++visited>300)return;
  if(Array.isArray(value)){for(const child of value.slice(0,60))walk(child,depth+1);return;}
  if(!object(value))return;
  nodes.push(value);if(typeof value['@id']==='string'){const previous=ids.get(value['@id']);if(!previous||Object.keys(value).length>Object.keys(previous).length)ids.set(value['@id'],value);}
  for(const key of ['@graph','mainEntity','image','primaryImageOfPage'])if(value[key]!==undefined)walk(value[key],depth+1);
 }
 for(const node of DomUtils.findAll(node=>node.name==='script'&&(node.attribs.type??'').toLowerCase()==='application/ld+json',doc.children).slice(0,20)){
  const raw=DomUtils.textContent(node);if(raw.length>200000)continue;
  try{walk(JSON.parse(raw));}catch{/* Invalid structured data is not evidence. */}
 }
 const articleTypes=new Set(['Article','NewsArticle','ReportageNewsArticle','AnalysisNewsArticle','BlogPosting']);
 const articles=nodes.filter(value=>{
  if(!(Array.isArray(value['@type'])?value['@type']:[value['@type']]).some(type=>articleTypes.has(type)))return false;
  const entity=value.mainEntityOfPage;
  if(entity!==undefined&&typeof entity!=='string'&&!object(entity))return false;
  const bindings=[value.url,value['@id'],typeof entity==='string'?entity:object(entity)?entity['@id']:undefined,object(entity)?entity.url:undefined].filter(value=>value!==undefined);
  return bindings.length>0&&bindings.every(value=>articleKey(value,finalUrl)===articleKey(canonical,finalUrl));
 }).slice(0,8);
 function imageRecords(value,seen=new Set(),depth=0){
  if(depth>5)return[];
  if(Array.isArray(value))return value.slice(0,6).flatMap(item=>imageRecords(item,seen,depth+1));
  if(typeof value==='string'){
   if(ids.has(value)&&!seen.has(value)){const next=new Set(seen);next.add(value);return imageRecords(ids.get(value),next,depth+1);}
   const resolved=url(value,finalUrl);return resolved?[{url:resolved,credit:null,caption:null,width:null,height:null}]:[];
  }
  if(!object(value))return[];
  if(typeof value['@id']==='string'&&ids.has(value['@id'])&&ids.get(value['@id'])!==value&&!seen.has(value['@id'])){
   const next=new Set(seen);next.add(value['@id']);return imageRecords(ids.get(value['@id']),next,depth+1);
  }
  const resolved=url(value.contentUrl??value.url,finalUrl);if(!resolved)return[];
  const creator=object(value.creator)?value.creator.name:typeof value.creator==='string'?value.creator:object(value.author)?value.author.name:null;
  return[{url:resolved,credit:clean(value.creditText??value.copyrightNotice??creator,300),caption:clean(value.caption,300),width:positive(value.width),height:positive(value.height)}];
 }
 const articleImages=articles.flatMap(article=>imageRecords(article.image).map(image=>({...image,binding:'same-Article',headline:clean(article.headline??article.name),date:clean(article.datePublished,80)}))).slice(0,8);
 const ogImages=[];let image=null;
 for(const meta of metas){
  const key=(meta.attribs.property??meta.attribs.name??'').toLowerCase(),value=meta.attribs.content;
  if(key==='og:image'||key==='og:image:url'){
   const resolved=url(value,finalUrl);image=resolved?{url:resolved,binding:'exact-canonical-page-head',alt:null,width:null,height:null}:null;
   if(image&&ogImages.length<8)ogImages.push(image);
  }else if(image&&key==='og:image:secure_url'){const resolved=url(value,finalUrl);if(resolved)image.url=resolved;}
  else if(image&&key==='og:image:alt')image.alt=clean(value,300);
  else if(image&&key==='og:image:width')image.width=positive(value);
  else if(image&&key==='og:image:height')image.height=positive(value);
 }
 const candidates=[...articleImages,...ogImages],candidateUrls=new Set(candidates.map(value=>value.url));
 const figures=[];
 const imgs=DomUtils.findAll(node=>node.name==='img',doc.children).slice(0,500);
 for(const img of imgs){
  const declared=[img.attribs.src,img.attribs['data-src'],img.attribs['data-lazy-src'],...(img.attribs.srcset??'').split(',').map(entry=>entry.trim().split(/\s+/u)[0])].map(value=>url(value,finalUrl)).filter(Boolean);
  const matched=declared.filter(value=>candidateUrls.has(value));if(!matched.length)continue;
  let parent=img.parent,caption=null,credit=null;
  for(let depth=0;parent&&depth<4;depth++,parent=parent.parent){
   if(parent.type!=='tag'||['body','article','main'].includes(parent.name))break;
   const captions=DomUtils.findAll(node=>node.name==='figcaption'||/\b(?:[a-z-]*(?:caption|credit)[a-z-]*)\b/iu.test(node.attribs.class??''),parent.children).slice(0,4);
   for(const node of captions){const text=clean(DomUtils.textContent(node),300);if(text){caption??=text;if(/\b(?:foto|photo|credit|sursa|sursă|copyright)\b/iu.test(text))credit??=text;}}
   if(caption)break;
  }
  for(const matchedUrl of [...new Set(matched)])figures.push({url:matchedUrl,binding:'matching-image-element',alt:clean(img.attribs.alt,300),caption,credit,width:positive(img.attribs.width),height:positive(img.attribs.height)});
  if(figures.length>=8)break;
 }
 return{...common,state:'METADATA_READ',articleImages,ogImages,figures:figures.slice(0,8),mediaHosts:[...new Set(candidates.map(value=>new URL(value.url).hostname))].sort()};
}
for(const target of TARGETS){
 const result={publisher:target.publisher,sourceUrl:target.url,checkedAt:new Date().toISOString()};
 try{
  const robots=await fetchText(new URL(target.url).origin+'/robots.txt',true);
  result.robotsStatus=robots.status;
  if(robots.status!==404&&(robots.status!==200||typeof robots.body!=='string')){result.state='ROBOTS_UNAVAILABLE';result.error=robots.error??'ROBOTS_UNAVAILABLE';}
  else{
   const policy=robots.status===404?'':robots.body;
   result.robotsAllowed=robotsAllowed(policy,target.url);
   if(!result.robotsAllowed)result.state='ROBOTS_DENIED';
   else{
    const page=await fetchText(target.url,false,policy);result.status=page.status;
    if(page.error||typeof page.body!=='string'){result.state='ARTICLE_UNAVAILABLE';result.error=page.error??'ARTICLE_UNAVAILABLE';}
    else Object.assign(result,extract(page.body,target.url,page.url));
   }
  }
 }catch(error){result.state='PROBE_UNAVAILABLE';result.error=error?.name==='TimeoutError'||error?.name==='AbortError'?'REQUEST_TIMEOUT':/^[A-Z][A-Z0-9_]+$/u.test(error?.message??'')?error.message:'REQUEST_OR_PARSE_FAILED';}
 console.log('DLKT_ARTICLE_PHOTO_PROBE '+JSON.stringify(result));
}
