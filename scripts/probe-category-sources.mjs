import {createHash} from 'node:crypto';
import {XMLParser, XMLValidator} from 'fast-xml-parser';
import {parseDocument, DomUtils} from 'htmlparser2';
import {readNewsArticleMetadata, readPublisherNewsCandidates} from '../source/.build/src/iceo/news-discovery.js';
import {NEWS_DISCOVERY_INDEXES, publisherForNewsUrl} from '../source/.build/src/iceo/news-sources.js';

// Observational evidence only. Never changes a registry, publishes a card,
// follows a redirect, bypasses a denial or uses credentials.
const SOURCES=Object.freeze([
  {id:'digi24-ro-news',feed:'https://www.digi24.ro/rss',format:'rss',
    origin:'https://www.digi24.ro',articlePath:'/stiri/',robots:'https://www.digi24.ro/robots.txt',
    productionRequired:true,knownOriginals:["https://www.digi24.ro/stiri/actualitate/sanatate/ce-scade-cu-adevarat-tensiunea-arteriala-cercetatorii-au-analizat-efectele-cafelei-sarii-alimentatiei-si-exercitiilor-fizice-4050049","https://www.digi24.ro/stiri/sci-tech/lumea-digitala/seful-onu-cere-un-mecanism-international-pentru-controlul-riscurilor-inteligentei-artificiale-trebuie-sa-actionam-pana-anul-viitor-4050023"]},
  {id:'protv-ro-news',feed:'https://rss.stirileprotv.ro/',format:'rss',
    origin:'https://stirileprotv.ro',articlePath:'/stiri/',robots:'https://stirileprotv.ro/robots.txt',
    feedRobots:'https://rss.stirileprotv.ro/robots.txt',productionRequired:true},
  // Official /rss page declares /rss.xml. Article paths are read from that feed;
  // /stiri is an editorial listing, not an assumed article URL prefix.
  {id:'doxologia-ro-diagnostic',feed:'https://doxologia.ro/rss.xml',format:'rss',
    origin:'https://doxologia.ro',articlePath:'/',robots:'https://doxologia.ro/robots.txt',
    productionRequired:false},
]);
const USER_AGENT='DLKT-Info-ICEO/1.0 (+https://www.dlkt.ee)';
const BYTE_LIMIT=1_048_576,DAY=86_400_000;
const startedAt=Date.now(),deadline=startedAt+210_000;
const attempts={robots:0,feed:0,article:0},limits={robots:4,feed:3,article:6};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const list=value=>value===undefined?[]:Array.isArray(value)?value:[value];
const plain=value=>typeof value==='string'?value:object(value)&&typeof value['#text']==='string'?value['#text']:null;
const clean=(value,max=500)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/gu,' ').slice(0,max):null;
const digest=text=>createHash('sha256').update(text).digest('hex');
function safeUrl(raw,origin,path='/'){
  if(typeof raw!=='string'||raw.length>3000||/[\u0000-\u0020\u007f<>\\]/u.test(raw))return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password||url.port)return null;
    for(const key of [...url.searchParams.keys()])if(key.toLowerCase().startsWith('utm_')||['fbclid','gclid'].includes(key.toLowerCase()))url.searchParams.delete(key);
    if(url.search||url.hash||url.pathname==='/'||!url.pathname.startsWith(path)||/\/(?:login|signin|account|subscribe|api|wp-admin)(?:\/|$)/iu.test(url.pathname))return null;
    return url.href;
  }catch{return null;}
}
function timestamp(raw){
  const explicit=typeof raw==='string'&&/(?:Z|[+-]\d\d:?\d\d|\bGMT|\bUTC)$/iu.test(raw.trim());
  const ms=explicit?Date.parse(raw):NaN;
  return {raw:clean(raw,100),explicitTimezone:explicit,iso:Number.isFinite(ms)?new Date(ms).toISOString():null};
}
async function boundedGet(url,kind){
  if(attempts[kind]>=limits[kind]||Date.now()>=deadline)throw new Error('PROBE_RESOURCE_LIMIT');
  attempts[kind]++;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(10_000,deadline-Date.now()));
  let reader;
  try{
    const response=await fetch(url,{redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,
      headers:{'User-Agent':USER_AGENT,Accept:kind==='article'?'text/html, application/xhtml+xml':kind==='robots'?'text/plain':'application/rss+xml, application/xml, text/xml'}});
    const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
    const base={url,status:response.status,contentType:type};
    if(response.status>=300&&response.status<400){await response.body?.cancel();return {...base,ok:false,error:'redirect-not-followed'};}
    if(!response.ok){await response.body?.cancel();return {...base,ok:false,error:'http-status'};}
    const accepted=kind==='article'?['text/html','application/xhtml+xml']:kind==='robots'?['text/plain']:['application/rss+xml','application/xml','text/xml'];
    if(!accepted.includes(type)){await response.body?.cancel();return {...base,ok:false,error:'content-type'};}
    if(!response.body)return {...base,ok:false,error:'empty-body'};
    const max=kind==='robots'?65_536:BYTE_LIMIT,declared=response.headers.get('content-length');
    if(kind!=='article'&&declared&&Number(declared)>max){await response.body.cancel();return {...base,ok:false,error:'body-limit'};}
    reader=response.body.getReader();
    const chunks=[];let bytes=0,partial=false;
    while(true){
      const part=await reader.read();if(part.done)break;
      const remaining=max-bytes;
      if(part.value.byteLength>remaining){
        await reader.cancel();
        if(kind!=='article')return {...base,ok:false,error:'body-limit'};
        chunks.push(part.value.subarray(0,remaining));bytes+=remaining;partial=true;break;
      }
      chunks.push(part.value);bytes+=part.value.byteLength;
      if(kind==='article'&&bytes===max){await reader.cancel();partial=true;break;}
    }
    if(!bytes)return {...base,ok:false,error:'empty-body'};
    const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks),{stream:partial});
    return {...base,ok:true,bytes,partial,sha256:digest(text),text};
  }catch(error){
    return {url,ok:false,error:controller.signal.aborted?'timeout':'request-failed',errorName:clean(error instanceof Error?error.name:'unknown',80)};
  }finally{if(reader)reader.releaseLock();clearTimeout(timer);controller.abort();}
}
function publicResponse(response){const {text,...metadata}=response;return metadata;}
function robotsPolicy(response){
  if(response.status===404)return {state:'absent',rules:[],crawlDelay:null};
  if(!response.ok)return {state:'unavailable',rules:[],crawlDelay:null};
  const groups=[];let group={agents:[],rules:[],crawlDelay:null},hasDirectives=false;
  const push=()=>{if(group.agents.length)groups.push(group);group={agents:[],rules:[],crawlDelay:null};hasDirectives=false;};
  for(const raw of response.text.split(/\r?\n/u)){
    const line=raw.replace(/#.*/u,'').trim(),at=line.indexOf(':');if(at<0)continue;
    const key=line.slice(0,at).trim().toLowerCase(),value=line.slice(at+1).trim();
    if(key==='user-agent'){if(hasDirectives)push();if(value)group.agents.push(value.toLowerCase());continue;}
    if(!group.agents.length)continue;
    hasDirectives=true;
    if((key==='allow'||key==='disallow')&&value)group.rules.push({allow:key==='allow',path:value});
    if(key==='crawl-delay'&&/^\d+(?:\.\d+)?$/u.test(value))group.crawlDelay=Number(value);
  }
  push();
  const matches=groups.map(g=>({group:g,specificity:Math.max(-1,...g.agents.map(a=>a==='*'?0:'dlkt-info-iceo'.includes(a)?a.length:-1))})).filter(m=>m.specificity>=0);
  const best=Math.max(-1,...matches.map(m=>m.specificity)),chosen=matches.filter(m=>m.specificity===best).map(m=>m.group);
  if(chosen.reduce((total,g)=>total+g.rules.length,0)>200)return {state:'unavailable',rules:[],crawlDelay:null};
  return {state:'observed',rules:chosen.flatMap(g=>g.rules),crawlDelay:chosen.some(g=>g.crawlDelay!==null)?Math.max(...chosen.map(g=>g.crawlDelay??0)):null};
}
function robotsDecision(policy,url){
  if(policy.state==='unavailable')return {allowed:false,reason:'robots-unavailable'};
  if(policy.crawlDelay>0)return {allowed:false,reason:'crawl-delay-requires-separate-review'};
  const target=new URL(url).pathname+new URL(url).search;
  let winner=null;
  for(const rule of policy.rules){
    const end=rule.path.endsWith('$'),body=end?rule.path.slice(0,-1):rule.path;
    if(body.length>2048)return {allowed:false,reason:'robots-pattern-limit'};
    // Greedy wildcard matching avoids executing a publisher-controlled regex.
    const pattern=end?body:body+'*';let p=0,t=0,star=-1,backtrack=0;
    while(t<target.length){
      if(p<pattern.length&&pattern[p]===target[t]){p++;t++;}
      else if(pattern[p]==='*'){star=p++;backtrack=t;}
      else if(star>=0){p=star+1;t=++backtrack;}
      else break;
    }
    while(pattern[p]==='*')p++;
    const matches=t===target.length&&p===pattern.length;
    if(!matches)continue;
    const score=body.replaceAll('*','').length;
    if(!winner||score>winner.score||score===winner.score&&rule.allow)winner={...rule,score};
  }
  return {allowed:winner?.allow??true,reason:winner?(winner.allow?'allow-rule':'disallow-rule'):'no-matching-disallow'};
}
function parseFeed(xml,source,now){
  if(/<!\s*(?:DOCTYPE|ENTITY)/iu.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('PROBE_XML_INVALID');
  const parsed=new XMLParser({ignoreAttributes:false,removeNSPrefix:source.format!=='rss',parseTagValue:false,parseAttributeValue:false,trimValues:true}).parse(xml);
  let entries,identity,rawRows;
  if(source.format==='rss'){
    if(!object(parsed)||!object(parsed.rss)||!object(parsed.rss.channel))throw new Error('PROBE_RSS_SCHEMA');
    const channel=parsed.rss.channel;entries=list(channel.item);
    identity={title:clean(plain(channel.title)),link:clean(plain(channel.link)),language:clean(plain(channel.language),100),lastBuildDate:clean(plain(channel.lastBuildDate),100)};
    rawRows=entries.filter(object).map(row=>({url:plain(row.link),title:plain(row.title),date:plain(row.pubDate)}));
  }else{
    if(!object(parsed)||!object(parsed.urlset))throw new Error('PROBE_SITEMAP_SCHEMA');
    entries=list(parsed.urlset.url);
    identity={publications:[...new Set(entries.filter(object).map(row=>object(row.news)&&object(row.news.publication)?clean(plain(row.news.publication.name)):null).filter(Boolean))].slice(0,10),
      languages:[...new Set(entries.filter(object).map(row=>object(row.news)&&object(row.news.publication)?clean(plain(row.news.publication.language),100):null).filter(Boolean))].slice(0,10)};
    rawRows=entries.filter(object).filter(row=>object(row.news)).map(row=>({url:plain(row.loc),title:plain(row.news.title),date:plain(row.news.publication_date)}));
  }
  if(entries.length>5000)throw new Error('PROBE_FEED_ITEM_LIMIT');
  const rows=rawRows.map(row=>({...row,url:safeUrl(row.url,source.origin,source.articlePath),stamp:timestamp(row.date)}));
  const recent=rows.filter(row=>row.url&&row.title&&row.stamp.iso&&Date.parse(row.stamp.iso)>now-DAY&&Date.parse(row.stamp.iso)<=now+300_000);
  const unique=[...new Map(recent.map(row=>[row.url,row])).values()].sort((a,b)=>b.stamp.iso.localeCompare(a.stamp.iso));
  return {identity,entryCount:entries.length,currentUniqueCandidates:unique.length,timestamps:rows.slice(0,3).map(row=>row.stamp),samples:source.knownOriginals?source.knownOriginals.flatMap(url=>unique.filter(row=>row.url===url)).slice(0,2):unique.slice(0,2)};
}
function metadataEvidence(html){
  const document=parseDocument(html,{decodeEntities:true,withStartIndices:true,withEndIndices:true});
  const complete=(node,script=false)=>node.startIndex!==null&&node.endIndex!==null&&(script?/<\/script\s*>$/iu.test(html.slice(node.startIndex,node.endIndex+1)):html.slice(node.startIndex,node.endIndex+1).endsWith('>'));
  const inHead=node=>node.parent?.type==='tag'&&node.parent.name==='head'&&node.parent.parent?.type==='tag'&&node.parent.parent.name==='html'&&node.parent.parent.parent?.type==='root';
  const fields=[];
  for(const node of DomUtils.getElementsByTagName('meta',document,true).filter(node=>complete(node))){
    const name=(node.attribs.property??node.attribs.name??'').toLowerCase();
    if(['og:title','og:url','article:published_time','article:modified_time','publish-date','date','article:section'].includes(name))fields.push({name,value:clean(node.attribs.content),inHead:inHead(node)});
  }
  const canonicals=DomUtils.getElementsByTagName('link',document,true).filter(node=>complete(node)&&(node.attribs.rel??'').toLowerCase().split(/\s+/u).includes('canonical')).map(node=>clean(node.attribs.href)).slice(0,5);
  const articles=[];let nodes=0;
  const walk=(value,depth=0)=>{
    if(depth>8||++nodes>200||articles.length>=12)return;
    if(Array.isArray(value)){for(const item of value.slice(0,100))walk(item,depth+1);return;}
    if(!object(value))return;
    const types=list(value['@type']);
    if(types.some(type=>typeof type==='string'&&/^(?:NewsArticle|Article|ReportageNewsArticle|AnalysisNewsArticle|BlogPosting|TechArticle|ScholarlyArticle|MedicalScholarlyArticle|LiveBlogPosting)$/u.test(type))){
      const entity=value.mainEntityOfPage;
      articles.push({types:types.map(type=>clean(type,100)),headline:clean(value.headline??value.name),headlineLength:typeof (value.headline??value.name)==='string'?(value.headline??value.name).length:null,
        datePublished:timestamp(value.datePublished),dateModified:timestamp(value.dateModified),url:clean(value.url),id:clean(value['@id']),
        mainEntityOfPage:clean(typeof entity==='string'?entity:object(entity)?entity['@id']??entity.url:null),
        articleSection:list(value.articleSection).slice(0,8).map(section=>clean(section,100))});
    }
    if(value['@graph']!==undefined)walk(value['@graph'],depth+1);
    if(value.mainEntity!==undefined)walk(value.mainEntity,depth+1);
  };
  for(const node of DomUtils.getElementsByTagName('script',document,true).slice(0,150)){
    if((node.attribs.type??'').toLowerCase()!=='application/ld+json'||!complete(node,true))continue;
    const raw=DomUtils.textContent(node);if(raw.length>200_000)continue;
    try{walk(JSON.parse(raw));}catch{/* Report only other complete metadata declarations. */}
  }
  return {canonical:canonicals,meta:fields.slice(0,24),jsonLdArticles:articles};
}
async function inspectSource(source){
  const result={id:source.id,productionRequired:source.productionRequired,status:'incomplete',feedUrl:source.feed,observedAt:new Date().toISOString(),articles:[]};
  const robotResponse=await boundedGet(source.robots,'robots'),policy=robotsPolicy(robotResponse);
  result.robots={...publicResponse(robotResponse),policy:{...policy,rules:policy.rules.slice(0,40),omittedRules:Math.max(0,policy.rules.length-40)}};
  if(policy.state==='unavailable'){result.error='original-robots-unavailable';return result;}
  const sameFeedOrigin=new URL(source.feed).origin===source.origin;
  let feedPolicy=policy;
  if(!sameFeedOrigin){
    if(!source.feedRobots||new URL(source.feedRobots).origin!==new URL(source.feed).origin){result.error='feed-origin-robots-not-declared';return result;}
    const response=await boundedGet(source.feedRobots,'robots');feedPolicy=robotsPolicy(response);
    result.feedRobots={...publicResponse(response),policy:{...feedPolicy,rules:feedPolicy.rules.slice(0,40),omittedRules:Math.max(0,feedPolicy.rules.length-40)}};
  }
  const feedDecision=robotsDecision(feedPolicy,source.feed);
  result.feedRobotsDecision=feedDecision;
  if(!feedDecision.allowed){result.error=feedDecision.reason;return result;}
  const feedResponse=await boundedGet(source.feed,'feed');result.feed=publicResponse(feedResponse);
  if(!feedResponse.ok){result.error='feed-request-failed';return result;}
  const now=Date.now();let feed;
  try{feed=parseFeed(feedResponse.text,source,now);}catch(error){result.error=error instanceof Error?error.message:'feed-parse-failed';return result;}
  result.feedIdentity=feed.identity;result.entryCount=feed.entryCount;result.currentUniqueCandidates=feed.currentUniqueCandidates;result.feedTimestampSamples=feed.timestamps;
  const registered=NEWS_DISCOVERY_INDEXES.find(index=>index.url===source.feed);
  let productionCandidates=[];
  if(registered){
    try{
      productionCandidates=readPublisherNewsCandidates(feedResponse.text,registered,now);
      result.productionFeedParser={state:productionCandidates.length?'accepted':'rejected',candidateCount:productionCandidates.length};
    }catch(error){result.productionFeedParser={state:'rejected',error:clean(error instanceof Error?error.message:'unknown')};}
  }else result.productionFeedParser={state:'not-registered',note:'Probe metadata only; production allowlist remains unchanged.'};
  for(const row of feed.samples){
    const decision=robotsDecision(policy,row.url);
    if(!decision.allowed){result.articles.push({url:row.url,status:'not-requested',robotsDecision:decision});continue;}
    const response=await boundedGet(row.url,'article');
    const observation={url:row.url,candidateTitle:clean(row.title),candidateTitleLength:row.title.length,feedPublished:row.stamp,request:publicResponse(response),robotsDecision:decision};
    if(response.ok){
      observation.metadata=metadataEvidence(response.text);
      const publisher=publisherForNewsUrl(row.url);
      if(publisher){
        const candidate=productionCandidates.find(entry=>entry.sourceUrl===row.url);
        if(candidate){
          const parsed=readNewsArticleMetadata(response.text,candidate,row.url,now);
          observation.productionArticleParser=parsed?{state:'accepted',sourceUrl:parsed.sourceUrl,title:clean(parsed.title),date:parsed.date,articleSubject:parsed.articleSubject??null}:{state:'rejected'};
        }else observation.productionArticleParser={state:'candidate-not-admitted',note:'No original metadata admission attempted without the production feed candidate.'};
      }else observation.productionArticleParser={state:'publisher-not-registered',note:'Observed declarations do not establish production admission.'};
    }
    result.articles.push(observation);
    if([401,402,403,429].includes(response.status))break;
  }
  result.status='observed';
  if(feed.samples.length!==2)result.error='two-current-reviewed-samples-unavailable';
  return result;
}
const reports=[];
for(const source of SOURCES){
  try{reports.push(await inspectSource(source));}
  catch(error){reports.push({id:source.id,status:'incomplete',error:clean(error instanceof Error?error.message:'unknown')});}
}
const incomplete=reports.some(report=>report.status!=='observed'||report.error||report.articles.length!==2
  ||report.articles.some(article=>!article.request?.ok)
  ||report.productionRequired&&(report.productionFeedParser?.state!=='accepted'||report.articles.some(article=>article.productionArticleParser?.state!=='accepted')));
console.log(JSON.stringify({probe:'dlkt-category-source-compatibility-2',commit:process.env.GITHUB_SHA??null,
  startedAt:new Date(startedAt).toISOString(),finishedAt:new Date().toISOString(),attempts,limits,
  outcome:incomplete?'incomplete-evidence':'observations-collected',
  boundary:'Metadata observations only. This script changes no source registry, publishes no content and makes no assertion of publisher reuse rights.',
  reports},null,2));
if(incomplete)process.exitCode=1;
