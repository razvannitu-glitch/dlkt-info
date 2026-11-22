import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {robotsAllowed} from '../source/.build/src/local/publications.js';
import {readBounded} from '../source/.build/src/iceo/transport.js';

const TARGETS=Object.freeze([
 {publisher:'Digi24',url:'https://www.digi24.ro/rss'},
 {publisher:'HotNews',url:'https://hotnews.ro/feed'},
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
   Accept:robots?'text/plain':'application/rss+xml,application/xml,text/xml','Accept-Encoding':'identity','User-Agent':USER_AGENT,
  }});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');await response.body?.cancel();
   const next=url(location,current);
   if(!next||new URL(next).origin!==origin||hop===2)return{status:response.status,url:current,error:'REDIRECT_REJECTED'};
   current=next;continue;
  }
  const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
  if(response.status!==200){await response.body?.cancel();return{status:response.status,url:current,type,error:'HTTP_'+response.status};}
  if(!(robots?['text/plain']:['application/rss+xml','application/xml','text/xml']).includes(type)){await response.body?.cancel();return{status:response.status,url:current,type,error:'CONTENT_TYPE_REJECTED'};}
  const limit=robots?65536:1048576,declared=response.headers.get('content-length');
  if(declared!==null&&Number(declared)>limit){await response.body?.cancel();return{status:response.status,url:current,type,error:'BODY_LIMIT'};}
  const body=await readBounded(response,limit);return{status:response.status,url:current,type,body,bodyBytes:Buffer.byteLength(body,'utf8'),complete:true};
 }
 throw Error('REDIRECT_LIMIT');
}

const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',trimValues:true,parseTagValue:false,processEntities:true});
const scalar=value=>typeof value==='string'?clean(value,600):object(value)&&typeof value['#text']==='string'?clean(value['#text'],600):null;
function extract(xml){
 if(/<!\s*(?:ENTITY|DOCTYPE[^>]*\[)/iu.test(xml)||XMLValidator.validate(xml)!==true)throw Error('INVALID_XML');
 const parsed=parser.parse(xml),channel=parsed?.rss?.channel;
 if(!object(channel))throw Error('RSS_CHANNEL_MISSING');
 const items=channel.item===undefined?[]:Array.isArray(channel.item)?channel.item:[channel.item];
 return{state:'FEED_METADATA_READ',feedTitle:scalar(channel.title),feedHome:scalar(channel.link),language:scalar(channel.language),copyright:scalar(channel.copyright),
  lastBuildDate:scalar(channel.lastBuildDate),itemCount:items.length,items:items.slice(0,3).map(item=>({title:scalar(item.title),link:scalar(item.link),pubDate:scalar(item.pubDate)}))};
}
for(const target of TARGETS){
 const result={publisher:target.publisher,sourceUrl:target.url,checkedAt:new Date().toISOString()};
 try{
  const robots=await fetchText(new URL(target.url).origin+'/robots.txt',true);
  result.robotsStatus=robots.status;
  if(robots.status!==404&&(robots.status!==200||typeof robots.body!=='string')){result.state='ROBOTS_UNAVAILABLE';result.error=robots.error??'ROBOTS_UNAVAILABLE';}
  else{
   const policy=robots.status===404?'':robots.body;result.robotsAllowed=robotsAllowed(policy,target.url);
   if(!result.robotsAllowed)result.state='ROBOTS_DENIED';
   else{
    const response=await fetchText(target.url,false,policy);result.status=response.status;result.finalUrl=response.url;result.contentType=response.type;
    if(response.error||typeof response.body!=='string'){result.state='FEED_UNAVAILABLE';result.error=response.error??'FEED_UNAVAILABLE';}
    else Object.assign(result,{bodyBytes:response.bodyBytes,complete:response.complete},extract(response.body));
   }
  }
 }catch(error){result.state='PROBE_UNAVAILABLE';result.error=error?.name==='TimeoutError'||error?.name==='AbortError'?'REQUEST_TIMEOUT':/^[A-Z][A-Z0-9_]+$/u.test(error?.message??'')?error.message:'REQUEST_OR_PARSE_FAILED';}
 console.log('DLKT_RO_FEED_PROBE '+JSON.stringify(result));
}
