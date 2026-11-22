import {parseDocument,DomUtils} from 'htmlparser2';
import {robotsAllowed} from '../source/.build/src/local/publications.js';
import {readBounded} from '../source/.build/src/iceo/transport.js';

const TARGETS=Object.freeze([
 {
  "publisher": "Digi24",
  "url": "https://www.digi24.ro/stiri/externe/mesajul-sefului-serviciilor-de-informatii-americane-despre-putin-dupa-ce-trump-l-a-numit-prieten-4048107"
 }
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
  const body=await readBounded(response,limit);return{status:response.status,url:current,type,body,bodyBytes:Buffer.byteLength(body,'utf8'),complete:true};
 }
 throw Error('REDIRECT_LIMIT');
}
function extract(html,requested,finalUrl){
 const doc=parseDocument(html,{decodeEntities:true}),head=DomUtils.findOne(node=>node.name==='head',doc.children);
 if(!head)return{state:'HEAD_MISSING'};
 const meta=DomUtils.findAll(node=>node.name==='meta',head.children).slice(0,500);
 const canonicalNodes=DomUtils.findAll(node=>node.name==='link'&&(node.attribs.rel??'').toLowerCase().split(/\s+/u).includes('canonical'),head.children);
 const canonicals=[...new Set(canonicalNodes.map(node=>url(node.attribs.href,finalUrl)).filter(Boolean))];
 const canonical=canonicals.length===1?canonicals[0]:null,exact=canonical!==null&&articleKey(canonical,finalUrl)===articleKey(requested,requested);
 const dateMeta=meta.filter(node=>/(?:date|time|publish|modified)/iu.test([node.attribs.name,node.attribs.property,node.attribs.itemprop].filter(Boolean).join(' ')))
  .map(node=>({name:clean(node.attribs.name??node.attribs.property??node.attribs.itemprop,100),content:clean(node.attribs.content,150)})).slice(0,30);
 const timeElements=DomUtils.findAll(node=>node.name==='time',doc.children).slice(0,20).map(node=>({
  datetime:clean(node.attribs.datetime,150),itemprop:clean(node.attribs.itemprop,100),text:clean(DomUtils.textContent(node),150),
 }));
 const attributes=[];
 for(const node of DomUtils.findAll(node=>Boolean(node.attribs),doc.children).slice(0,5000)){
  for(const [name,value] of Object.entries(node.attribs)){
   if(!/^(?:data-|content|datetime|value)/u.test(name)||!/(?:date|time|publish|modified)/iu.test(name)||typeof value!=='string'||value.length>150)continue;
   if(/^\d{4}[-/.]\d{2}[-/.]\d{2}|^\d{9,13}$/u.test(value)||/[+-]\d{2}:?\d{2}$|Z$/u.test(value))attributes.push({tag:node.name,name,value:clean(value,150)});
   if(attributes.length>=20)break;
  }if(attributes.length>=20)break;
 }
 const articles=[];let visits=0;
 function walk(value,depth=0){
  if(depth>8||++visits>300)return;if(Array.isArray(value)){for(const entry of value.slice(0,100))walk(entry,depth+1);return;}if(!object(value))return;
  const types=Array.isArray(value['@type'])?value['@type']:[value['@type']];
  if(types.some(type=>['Article','NewsArticle','ReportageNewsArticle','AnalysisNewsArticle','BlogPosting'].includes(type))){
   const entity=value.mainEntityOfPage,bindings=[value.url,value['@id'],typeof entity==='string'?entity:object(entity)?entity['@id']:undefined,object(entity)?entity.url:undefined].filter(entry=>entry!==undefined);
   const bound=bindings.length>0&&bindings.every(entry=>articleKey(entry,finalUrl)===articleKey(canonical,finalUrl));
   articles.push({type:types,canonicalBound:exact&&bound,headline:clean(value.headline??value.name,200),bindings:bindings.map(entry=>clean(entry,2048)),
    datePublished:clean(value.datePublished,100),dateCreated:clean(value.dateCreated,100),dateModified:clean(value.dateModified,100),datePublishedType:typeof value.datePublished});
  }
  for(const key of ['@graph','mainEntity'])if(value[key]!==undefined)walk(value[key],depth+1);
 }
 for(const node of DomUtils.findAll(node=>node.name==='script'&&(node.attribs.type??'').toLowerCase()==='application/ld+json',doc.children).slice(0,20)){
  const raw=DomUtils.textContent(node);if(raw.length>200000)continue;try{walk(JSON.parse(raw));}catch{}
 }
 return{state:'DATE_METADATA_READ',canonical,canonicalMatchesRequested:exact,dateMeta,timeElements,explicitDateAttributes:attributes,articles:articles.slice(0,10)};
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
    const page=await fetchText(target.url,false,policy);result.status=page.status;result.finalUrl=page.url;result.bodyBytes=page.bodyBytes;result.complete=page.complete;
    if(page.error||typeof page.body!=='string'){result.state='ARTICLE_UNAVAILABLE';result.error=page.error??'ARTICLE_UNAVAILABLE';}
    else Object.assign(result,extract(page.body,target.url,page.url));
   }
  }
 }catch(error){result.state='PROBE_UNAVAILABLE';result.error=error?.name==='TimeoutError'||error?.name==='AbortError'?'REQUEST_TIMEOUT':/^[A-Z][A-Z0-9_]+$/u.test(error?.message??'')?error.message:'REQUEST_OR_PARSE_FAILED';}
 console.log('DLKT_DIGI24_DATE_PROBE '+JSON.stringify(result));
}
