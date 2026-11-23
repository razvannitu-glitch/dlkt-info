import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {XMLParser, XMLValidator} from 'fast-xml-parser';
import {parseDocument, DomUtils} from 'htmlparser2';
import {readNewsArticleMetadata, readPublisherNewsCandidates} from '../source/.build/src/iceo/news-discovery.js';
import {NEWS_DISCOVERY_INDEXES, publisherForNewsUrl} from '../source/.build/src/iceo/news-sources.js';

// Observational evidence only. Never changes a registry, publishes a card,
// follows a redirect, bypasses a denial or uses credentials.
// Exact primary RSS declarations observed in Actions45285237202 on 2026-11-23.
const SOURCES=Object.freeze([
  {id:'prosport',origin:'https://www.prosport.ro',productionRequired:true,primaryFeed:'https://www.prosport.ro/feed',knownOriginals:[
    'https://www.prosport.ro/fotbal-extern/campionate-externe/italia/radu-dragusin-nota-monza-fiorentina-3-0-integralist-serie-a-dezastru-20576187',
    'https://www.prosport.ro/fotbal-intern/superliga/anunt-venire-mirel-radoi-u-cluj-20576183',
  ]},
]);
const USER_AGENT='DLKT-Info-ICEO/1.0 (+https://www.dlkt.ee)';
const BYTE_LIMIT=1_048_576,DAY=86_400_000;
const DEADLINE_MS=60_000;
const startedAt=Date.now(),deadline=startedAt+DEADLINE_MS;
const attempts={robots:0,homepage:0,feed:0,article:0},limits={robots:1,homepage:1,feed:1,article:2};
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
  if(!SOURCES.some(source=>source.origin===new URL(url).origin))throw new Error('PROBE_ORIGIN_OUT_OF_SCOPE');
  if(attempts[kind]>=limits[kind]||Date.now()>=deadline)throw new Error('PROBE_RESOURCE_LIMIT');
  attempts[kind]++;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(10_000,deadline-Date.now()));
  let reader;
  try{
    const response=await fetch(url,{redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,
      headers:{'User-Agent':USER_AGENT,Accept:['article','homepage'].includes(kind)?'text/html, application/xhtml+xml':kind==='robots'?'text/plain':'application/rss+xml, application/xml, text/xml'}});
    const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
    const base={url,status:response.status,contentType:type};
    if(response.status>=300&&response.status<400){await response.body?.cancel();return {...base,ok:false,error:'redirect-not-followed'};}
    if(!response.ok){await response.body?.cancel();return {...base,ok:false,error:'http-status'};}
    const accepted=['article','homepage'].includes(kind)?['text/html','application/xhtml+xml']:kind==='robots'?['text/plain']:['application/rss+xml','application/xml','text/xml'];
    if(kind!=='robots'&&!accepted.includes(type)){await response.body?.cancel();return {...base,ok:false,error:'content-type'};}
    if(!response.body)return {...base,ok:false,error:'empty-body'};
    const max=BYTE_LIMIT,declared=response.headers.get('content-length');
    if(!['article','homepage'].includes(kind)&&declared&&Number(declared)>max){await response.body.cancel();return {...base,ok:false,error:'body-limit'};}
    reader=response.body.getReader();
    const chunks=[];let bytes=0,partial=false;
    while(true){
      const part=await reader.read();if(part.done)break;
      const remaining=max-bytes;
      if(part.value.byteLength>remaining){
        await reader.cancel();
        if(!['article','homepage'].includes(kind))return {...base,ok:false,error:'body-limit'};
        chunks.push(part.value.subarray(0,remaining));bytes+=remaining;partial=true;break;
      }
      chunks.push(part.value);bytes+=part.value.byteLength;
      if(['article','homepage'].includes(kind)&&bytes===max){await reader.cancel();partial=true;break;}
    }
    if(!bytes)return {...base,ok:false,error:'empty-body'};
    const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks),{stream:partial});
    return {...base,ok:true,bytes,partial,sha256:digest(text),text};
  }catch(error){
    return {url,ok:false,error:controller.signal.aborted?'timeout':'request-failed',errorName:clean(error instanceof Error?error.name:'unknown',80)};
  }finally{if(reader)reader.releaseLock();clearTimeout(timer);controller.abort();}
}
function publicResponse(response){const {text,...metadata}=response;return metadata;}
function robotsBodyEvidence(response){
  if(!response.ok||typeof response.text!=='string')return null;
  const text=response.text.replace(/^\uFEFF/u,''),root=/^\s*(?:<\?xml[^>]*\?>\s*)?<([A-Za-z][A-Za-z0-9:_-]*)\b/u.exec(text)?.[1]?.toLowerCase()??null;
  const kind=root==='rss'?'rss':root==='feed'?'atom':root?'markup':/^\s*<!doctype\s+html/iu.test(text)?'html':'text';
  return {declaredContentType:response.contentType,conformingMediaType:response.contentType==='text/plain',
    completeBody:response.partial===false,bodyKind:kind,rootElement:root,lineCount:text.split(/\r\n|\n|\r/u).length,
    bodyPrefix:clean(text.slice(0,500),500)};
}
function robotsPolicy(response){
  if(response.status===404)return {state:'absent',rules:[],crawlDelay:null};
  if(!response.ok||response.partial)return {state:'unavailable',rules:[],crawlDelay:null};
  const text=response.text.replace(/^\uFEFF/u,''),bodyEvidence=robotsBodyEvidence(response);
  const lines=text.split(/\r\n|\n|\r/u),groups=[];
  let group={agents:[],rules:[],crawlDelay:null},hasRules=false,malformedDirectives=0,recognizedLines=0;
  const directiveEvidence=[];
  const push=()=>{if(group.agents.length)groups.push(group);group={agents:[],rules:[],crawlDelay:null};hasRules=false;};
  // RFC 9309 sections 2.3.1.1 and 2.3.1.5 require every line to be
  // examined and parseable rules to be honored. A wrong MIME is evidence
  // of publisher nonconformance, not grounds to skip a successful body.
  for(let index=0;index<lines.length;index++){
    const line=lines[index].replace(/#.*/u,'').trim(),at=line.indexOf(':');if(at<0)continue;
    const key=line.slice(0,at).trim().toLowerCase(),value=line.slice(at+1).trim();
    if(!['user-agent','allow','disallow','crawl-delay'].includes(key))continue;
    recognizedLines++;
    if(directiveEvidence.length<40)directiveEvidence.push({line:index+1,name:key,value:clean(value,512)});
    if(key==='user-agent'){
      if(!/^(?:[A-Za-z_-]+|\*)$/u.test(value)){malformedDirectives++;continue;}
      if(hasRules)push();group.agents.push(value.toLowerCase());continue;
    }
    if(!group.agents.length)continue;
    if(key==='allow'||key==='disallow'){
      hasRules=true;
      if(!value)continue;
      if(!/^[/*]/u.test(value)||/[\u0000-\u0020\u007f]/u.test(value)){malformedDirectives++;continue;}
      group.rules.push({allow:key==='allow',path:value});continue;
    }
    if(key==='crawl-delay'){
      if(/^\d+(?:\.\d+)?$/u.test(value))group.crawlDelay=Math.max(group.crawlDelay??0,Number(value));
      else malformedDirectives++;
    }
    // Unknown/extension records never terminate a group (RFC 9309 2.2.4).
  }
  push();
  const named=groups.filter(g=>g.agents.some(agent=>agent!=='*'&&'dlkt-info-iceo'.includes(agent)));
  const chosen=named.length?named:groups.filter(g=>g.agents.includes('*'));
  const rules=chosen.flatMap(g=>g.rules);
  const parsing={bodyEvidence,recognizedLines,malformedDirectives,groupCount:groups.length,applicableGroupCount:chosen.length,
    totalRuleCount:groups.reduce((count,g)=>count+g.rules.length,0),directiveEvidence};
  const denialBody=/^\s*(?:access denied|forbidden|unauthorized|too many requests)\b/iu.test(text)
    ||(/^(?:error)$/iu.test(bodyEvidence?.rootElement??'')&&/<(?:Code|code)>\s*(?:AccessDenied|Forbidden|Unauthorized|TooManyRequests)\s*</u.test(text))
    ||(bodyEvidence?.bodyKind==='html'||bodyEvidence?.rootElement==='html')&&/<title[^>]*>\s*(?:just a moment|access denied|attention required|forbidden|sign in|log in)\b/iu.test(text);
  if(denialBody||malformedDirectives||rules.length>200)return {state:'unavailable',rules,crawlDelay:null,
    reason:denialBody?'denial-body':malformedDirectives?'ambiguous-robots-directive':'robots-rule-limit',...parsing};
  // Only a fully read, decoded and line-parsed body can establish no
  // applicable groups (RFC 9309 2.2.1). XML MIME alone never allows a URL.
  return {state:'observed',rules,crawlDelay:chosen.some(g=>g.crawlDelay!==null)?Math.max(...chosen.map(g=>g.crawlDelay??0)):null,...parsing};
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
    const score=Buffer.byteLength(body.replaceAll('*',''),'utf8');
    if(!winner||score>winner.score||score===winner.score&&rule.allow)winner={...rule,score};
  }
  return {allowed:winner?.allow??true,reason:winner?(winner.allow?'allow-rule':'disallow-rule'):policy.applicableGroupCount===0?'complete-body-no-applicable-robots-group':'no-matching-disallow'};
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
        alternativeHeadline:clean(value.alternativeHeadline),alternativeHeadlineLength:typeof value.alternativeHeadline==='string'?value.alternativeHeadline.length:null,
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
  const result={id:source.id,productionRequired:source.productionRequired===true,status:'incomplete',observedAt:new Date().toISOString(),articles:[]};
  const robotResponse=await boundedGet(source.origin+'/robots.txt','robots'),policy=robotsPolicy(robotResponse);
  result.robots={...publicResponse(robotResponse),policy:{...policy,rules:policy.rules.slice(0,40),omittedRules:Math.max(0,policy.rules.length-40)}};
  if(policy.state==='unavailable'){result.error='original-robots-unavailable';return result;}
  const homeDecision=robotsDecision(policy,source.origin+'/');
  if(!homeDecision.allowed){result.error=homeDecision.reason;return result;}
  const homepage=await boundedGet(source.origin+'/','homepage');result.homepage=publicResponse(homepage);
  if(!homepage.ok){result.error='homepage-request-failed';return result;}
  const document=parseDocument(homepage.text,{decodeEntities:true,withStartIndices:true,withEndIndices:true}),feeds=[];
  for(const node of DomUtils.getElementsByTagName('link',document,true)){
    if(node.startIndex===null||node.endIndex===null||!homepage.text.slice(node.startIndex,node.endIndex+1).endsWith('>'))continue;
    if(!(node.attribs.rel??'').toLowerCase().split(/\s+/u).includes('alternate')||(node.attribs.type??'').toLowerCase()!=='application/rss+xml')continue;
    let url;try{url=new URL(node.attribs.href,source.origin+'/');}catch{continue;}
    if(url.origin!==source.origin||url.username||url.password||url.search||url.hash)continue;
    if(/comment/iu.test(node.attribs.title??'')||/comments/iu.test(url.pathname))continue;
    if(!feeds.some(feed=>feed.url===url.href))feeds.push({url:url.href,title:clean(node.attribs.title)});
  }
  result.declaredFeeds=feeds.slice(0,8);
  result.feedDeclarationScope=homepage.partial?'bounded-homepage-prefix':'complete-homepage';
  const primary=feeds.find(feed=>feed.url===source.primaryFeed);
  if(!primary){
    result.error=homepage.partial?'reviewed-primary-feed-not-observed-in-bounded-prefix':'reviewed-primary-feed-not-declared';return result;
  }
  result.selectedFeed={...primary,basis:'exact-primary-rss-declaration-observed-in-prior-probe-and-current-homepage'};
  source={...source,feed:primary.url,format:'rss',articlePath:'/'};result.feedUrl=source.feed;
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
function verifyRobotsParsing(){
  const response=text=>({status:200,ok:true,partial:false,contentType:'application/xml',text});
  const decide=(text,url='https://rss.stirileprotv.ro/')=>robotsDecision(robotsPolicy(response(text)),url);
  assert.equal(decide('User-agent: *\nDisallow: /').allowed,false,'XML MIME never discards a disallow');
  assert.equal(decide('<rss>\nUser-agent: *\nDisallow: /\n</rss>').allowed,false,'parseable rules survive mixed malformed content');
  assert.equal(decide('User-agent: DLKT-Info-ICEO\n<not-a-robots-line/>\nUser-agent: *\nDisallow: /').allowed,false,'unknown records do not split a group');
  assert.equal(decide('User-agent: *\rDisallow: /private\rAllow: /private/public','https://rss.stirileprotv.ro/private/a').allowed,false,'CR-only lines are parsed');
  assert.equal(decide('User-agent: *\rDisallow: /private\rAllow: /private/public','https://rss.stirileprotv.ro/private/public/a').allowed,true,'longest matching allow is retained');
  assert.equal(decide('User-agent: DLKT-Info-ICEO\nDisallow: /a\nUser-agent: dlkt-info-iceo\nDisallow: /b','https://rss.stirileprotv.ro/b').allowed,false,'all matching groups are combined');
  assert.equal(decide('User-agent: *\nDisallow: /hidden\nMalformed: ignored\nAllow: /public','https://rss.stirileprotv.ro/hidden').allowed,false,'unknown lines never erase a prior disallow');
  assert.equal(decide('User-agent: *\nDisallow: invalid-path').allowed,false,'ambiguous recognizable directives fail closed');
  const empty=robotsPolicy(response('<?xml version="1.0"?><rss><channel><title>Example</title></channel></rss>'));
  assert.equal(empty.bodyEvidence.bodyKind,'rss');assert.equal(empty.groupCount,0);assert.equal(empty.recognizedLines,0);
  assert.equal(decide('<Error><Code>AccessDenied</Code></Error>').allowed,false,'successful HTTP denial bodies still block');
  for(const status of [401,402,403,429,500,503])assert.equal(robotsDecision(robotsPolicy({status,ok:false}),'https://rss.stirileprotv.ro/').allowed,false,'HTTP denial/server failure remains blocked');
  return {state:'passed',cases:16};
}
const robotsParserChecks=verifyRobotsParsing();
const reports=[];
for(const source of SOURCES){
  try{reports.push(await inspectSource(source));}
  catch(error){reports.push({id:source.id,status:'incomplete',error:clean(error instanceof Error?error.message:'unknown')});}
}
const incomplete=reports.some(report=>report.status!=='observed'||report.error||report.articles.length!==2
  ||report.articles.some(article=>!article.request?.ok)
  ||report.productionRequired&&(report.productionFeedParser?.state!=='accepted'||report.articles.some(article=>article.productionArticleParser?.state!=='accepted')));
console.log(JSON.stringify({probe:'dlkt-prosport-production-1',commit:process.env.GITHUB_SHA??null,
  startedAt:new Date(startedAt).toISOString(),finishedAt:new Date().toISOString(),attempts,limits,
  deadlineMs:DEADLINE_MS,requestTimeoutMs:10_000,bodyLimitBytes:BYTE_LIMIT,robotsParserChecks,
  outcome:incomplete?'incomplete-evidence':'observations-collected',
  boundary:'Metadata observations only. This script changes no source registry, publishes no content and makes no assertion of publisher reuse rights.',
  reports},null,2));
if(incomplete)process.exitCode=1;
