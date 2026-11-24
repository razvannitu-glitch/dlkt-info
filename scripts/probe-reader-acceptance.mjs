import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {findCity} from '../source/.build/src/local/cities.js';
import {parseNewsPageRequest,parseNewsSourcesRequest} from '../source/.build/src/iceo/news-page.js';
import {validNewsPage,validNewsStorySourcesPage,newsOriginalLanguage,NEWS_MAX_RESPONSE_BYTES,NEWS_SERVER_PAGE_SIZE} from '../source/.build/src/iceo/news-page-contracts.js';
import {cardContent} from '../source/.build/src/iceo/card-validation.js';
import {NEWS_CATEGORIES,newsCategoryLabel} from '../source/.build/src/iceo/news-taxonomy.js';

// Public corpus reads only. No publisher requests, credentials, account routes,
// database access, refresh requests, redirects, automatic retries or URL inputs.
const ORIGIN='https://www.dlkt.ee',API='/api/news-page',RECEIPT='/release.json';
export const LIMITS=Object.freeze({requests:8,durationMs:60_000,requestMs:8_000,bodyBytes:NEWS_MAX_RESPONSE_BYTES,pagesPerEdition:3});
const EXPECTED=Object.freeze({language:'ro',cityId:'683506',countryCode:'RO',filter:'all',period:'recent'});
const OBSERVED_EVENT=Object.freeze([
 {url:'https://hotnews.ro/o-cantareata-iraniana-si-membrii-trupei-sale-pedepsiti-cu-74-de-lovituri-de-bici-pentru-un-concert-2412112',publishedAt:'2026-11-23T20:25:10.000Z'},
 {url:'https://stirileprotv.ro/stiri/international/o-cantareata-iraniana-a-fost-pedepsita-cu-74-de-lovituri-de-bici-pentru-un-concert-fara-valul-islamic-video.html',publishedAt:'2026-11-23T20:17:36.000Z'},
 {url:'https://www.digi24.ro/stiri/externe/mapamond/o-cantareata-iraniana-si-membrii-trupei-sale-au-primit-74-de-lovituri-de-bici-din-cauza-unui-concert-pe-youtube-4049697',publishedAt:'2026-11-23T17:01:19.000Z'},
]);
const OBSERVED_BBC_ALIASES=Object.freeze(['https://www.bbc.com/news/articles/crgj38le4dz9o','https://www.bbc.co.uk/news/articles/crgj38le4dz9o']);
// Independently observed same-event originals from production revision1602; product matching rules are not imported.
const OBSERVED_EVENT_THREADS=Object.freeze([
 {
  "id": "deep-ocean-discovery",
  "originals": [
   {
    "url": "https://www.newscientist.com/article/2599436-submarine-finds-worlds-deepest-explosive-volcanic-activity-in-mariana-trench/",
    "publishedAt": "2026-11-23T17:00:00.000Z"
   },
   {
    "url": "https://www.nationalgeographic.com/science/article/challenger-deep-explosive-volcanic-eruption-discovery",
    "publishedAt": "2026-11-23T05:00:00.000Z"
   }
  ]
 },
 {
  "id": "disaster-aid-pledge",
  "originals": [
   {
    "url": "https://www.euronews.com/2026/11/23/india-pledges-14bn-to-help-nepal-rebuild-after-deadly-glacier-flood",
    "publishedAt": "2026-11-23T10:06:44.000Z"
   },
   {
    "url": "https://www.aljazeera.com/news/2026/11/23/india-pledges-1-6bn-in-flood-relief-for-nepal",
    "publishedAt": "2026-11-23T18:12:55.000Z"
   }
  ]
 },
 {
  "id": "hotel-fire",
  "originals": [
   {
    "url": "https://stirileprotv.ro/stiri/actualitate/hotelul-alpin-din-poiana-brasov-inca-arde-dupa-18-ore-de-ce-se-chinuie-pompierii-sa-stinga-incendiul.html",
    "publishedAt": "2026-11-23T15:16:35.000Z"
   },
   {
    "url": "https://www.digi24.ro/stiri/actualitate/incendiu-puternic-la-un-hotel-din-poiana-brasov-intervin-pompieri-din-patru-judete-4048199",
    "publishedAt": "2026-11-23T10:43:18.000Z"
   },
   {
    "url": "https://hotnews.ro/incendiu-la-un-hotel-din-poiana-brasov-intervin-pompieri-din-patru-judete-2411165",
    "publishedAt": "2026-11-23T05:53:00.000Z"
   }
  ]
 },
 {
  "id": "house-arrest-decision",
  "originals": [
   {
    "url": "https://buletin.de/bucuresti/calin-georgescu-plasat-in-arest-la-domiciliu-curtea-de-apel-bucuresti-a-respins-contestatia-diicot/",
    "publishedAt": "2026-11-23T16:05:35.000Z"
   },
   {
    "url": "https://stirileprotv.ro/stiri/actualitate/calin-georgescu-va-intra-in-arest-la-domiciliu-curtea-de-apel-a-decis-definitiv.html",
    "publishedAt": "2026-11-23T14:04:23.000Z"
   },
   {
    "url": "https://stirileprotv.ro/stiri/actualitate/cab-asteptata-sa-decida-luni-daca-inlocuieste-arestul-preventiv-cu-arestul-la-domiciliu-in-cazul-lui-calin-georgescu.html",
    "publishedAt": "2026-11-23T05:13:09.000Z"
   }
  ]
 }
]);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const iso=value=>new Date(value).toISOString();
class ProbeError extends Error {
 constructor(code,kind='integrity',detail={}){super(code);this.name='ProbeError';this.code=code;this.kind=kind;this.detail=detail;}
}
const ensure=(condition,code,detail={})=>{if(!condition)throw new ProbeError(code,'integrity',detail);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const errorRecord=error=>error instanceof ProbeError?{code:error.code,kind:error.kind,...error.detail}:{code:'PROBE_UNEXPECTED_ERROR',kind:'incomplete',name:error instanceof Error?error.name:'unknown'};
function editionContext(page){
 return {version:page.version,epoch:page.epoch,revision:page.revision,generatedAt:page.generatedAt,startedAt:page.startedAt,expiresAt:page.expiresAt,
  language:page.language,sourceScope:page.sourceScope,cityId:page.cityId,countryCode:page.countryCode,period:page.period,day:page.day,filter:page.filter,
  total:page.total,articleTotal:page.articleTotal,filteredTotal:page.filteredTotal,
  coverage:{national:page.coverage.national,local:page.coverage.local,international:page.coverage.international},
  counts:Object.fromEntries([...NEWS_CATEGORIES.map(category=>category.id),'other'].map(id=>[id,page.counts[id]]))};
}
function sourceContext(page){
 return Object.fromEntries(['epoch','revision','generatedAt','startedAt','expiresAt','language','sourceScope','cityId','countryCode','period','day','filter'].map(key=>[key,page[key]]));
}
function pageUrl(sourceScope,cursor=null){
 const url=new URL(API,ORIGIN);
 for(const [key,value] of Object.entries({lang:EXPECTED.language,city:EXPECTED.cityId,category:EXPECTED.filter,period:EXPECTED.period,sourceScope}))url.searchParams.set(key,value);
 if(cursor!==null)url.searchParams.set('cursor',cursor);
 const parsed=parseNewsPageRequest(url);
 ensure(parsed.language===EXPECTED.language&&parsed.cityId===EXPECTED.cityId&&parsed.filter===EXPECTED.filter&&parsed.period===EXPECTED.period&&parsed.sourceScope===sourceScope&&parsed.cursor===cursor,'REQUEST_CONTEXT_INVALID');
 return url;
}
function sourcesUrl(cursor){
 const url=new URL(API,ORIGIN);url.searchParams.set('sources',cursor);
 ensure(parseNewsSourcesRequest(url)===cursor,'SOURCE_REQUEST_CURSOR_INVALID');return url;
}
export function createBudgetReader(fetcher=globalThis.fetch,clock=Date.now){
 const startedAt=clock(),deadline=startedAt+LIMITS.durationMs,requests=[];
 async function read(url,kind,maxBytes=LIMITS.bodyBytes){
  ensure(Number.isSafeInteger(maxBytes)&&maxBytes>=1&&maxBytes<=LIMITS.bodyBytes,'RESPONSE_LIMIT_INVALID');
  ensure(url instanceof URL&&url.origin===ORIGIN&&!url.username&&!url.password&&!url.hash
   &&(url.pathname===API||url.pathname===RECEIPT&&!url.search),'UNAPPROVED_REQUEST_TARGET');
  if(requests.length>=LIMITS.requests||clock()>=deadline)throw new ProbeError('PROBE_RESOURCE_LIMIT','incomplete');
  const entry={number:requests.length+1,kind,path:url.pathname,queryKeys:[...url.searchParams.keys()].sort(),startedAt:iso(clock()),status:null,bytes:0,sha256:null};
  requests.push(entry);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(LIMITS.requestMs,deadline-clock())));
  let reader;
  try{
   const response=await fetcher(url.href,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,
    headers:{Accept:'application/json','User-Agent':'DLKT-Info-Reader-Acceptance/1.0 (+https://www.dlkt.ee)'}});
   entry.status=response.status;
   entry.headers=Object.fromEntries(['content-type','date','last-modified','x-dlkt-news-epoch','x-dlkt-news-revision','x-dlkt-news-expires-at'].map(name=>[name,response.headers.get(name)]));
   if(response.status>=300&&response.status<400){await response.body?.cancel();throw new ProbeError('REDIRECT_NOT_FOLLOWED','incomplete',{status:response.status});}
   const declared=response.headers.get('content-length');
   if(declared!==null&&/^\d+$/u.test(declared)&&Number(declared)>maxBytes){await response.body?.cancel();throw new ProbeError('RESPONSE_BODY_LIMIT','integrity');}
   if(!response.body)throw new ProbeError('EMPTY_RESPONSE','incomplete',{status:response.status});
   reader=response.body.getReader();const chunks=[];
   while(true){
    if(clock()>=deadline){await reader.cancel();throw new ProbeError('PROBE_DEADLINE','incomplete');}
    const part=await reader.read();if(part.done)break;
    entry.bytes+=part.value.byteLength;
    if(entry.bytes>maxBytes){await reader.cancel();throw new ProbeError('RESPONSE_BODY_LIMIT','integrity');}
    chunks.push(part.value);
   }
   const bytes=Buffer.concat(chunks);entry.sha256=hash(bytes);
   let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
   catch{throw new ProbeError('RESPONSE_JSON_INVALID',response.ok?'integrity':'incomplete',{status:response.status});}
   if(!response.ok){
    const apiCode=object(value)&&typeof value.error==='string'&&/^[A-Z_]{1,100}$/u.test(value.error)?value.error:null;
    const invalidContext=response.status===400&&['NEWS_CURSOR_INVALID','NEWS_CONTEXT_MISMATCH','NEWS_PAGE_QUERY_INVALID'].includes(apiCode);
    throw new ProbeError(invalidContext?apiCode:response.status===410?'EDITION_EXPIRED':'HTTP_ERROR',invalidContext?'integrity':'incomplete',{status:response.status,apiCode});
   }
   ensure((response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase()==='application/json','RESPONSE_CONTENT_TYPE_INVALID');
   entry.completedAt=iso(clock());return {value,entry,receivedAt:clock()};
  }catch(error){
   const failure=controller.signal.aborted?new ProbeError('REQUEST_TIMEOUT','incomplete'):error;
   entry.error=errorRecord(failure);throw failure;
  }finally{if(reader)reader.releaseLock();clearTimeout(timer);controller.abort();entry.completedAt??=iso(clock());}
 }
 return {startedAt,deadline,requests,read,clock};
}
function stateFor(scope){return {scope,context:null,pages:[],items:[],records:[],pending:[],sourcesPages:[],keys:new Set(),storyKeys:new Set(),ids:new Set(),urls:new Set(),identities:new Set(),cursors:new Set(),nextCursor:null,failures:[],sampleComplete:false};}
function checkExpiry(value,now){
 if(object(value)&&typeof value.expiresAt==='string'&&Number.isFinite(Date.parse(value.expiresAt))&&Date.parse(value.expiresAt)<=now)
  throw new ProbeError('EDITION_EXPIRED_ON_ARRIVAL','incomplete',{expiresAt:value.expiresAt,receivedAt:iso(now)});
}
function originalRecord(source,storyKey,rank){
 const card=source.card;
 if(source.kind==='global'){
  ensure(card.contentHash===hash(JSON.stringify(cardContent(card))),'ORIGINAL_CONTENT_HASH_MISMATCH',{id:card.id});
  ensure(card.id===hash(JSON.stringify(card.identity)).slice(0,24),'ORIGINAL_IDENTITY_HASH_MISMATCH',{id:card.id});
 }
 return {storyKey,rank,kind:source.kind,id:card.id,identity:source.kind==='global'?card.identity:card.sourceUrl,url:card.sourceUrl,title:card.title,publisher:card.publisher,
  originalLanguage:newsOriginalLanguage(source),publishedAt:source.kind==='global'?card.date:card.news.publishedAt,
  publicationField:source.kind==='global'?'card.date':'card.news.publishedAt',dateLabel:source.kind==='global'?card.dateLabel:'Published',
  checkedAt:source.kind==='global'?card.observedAt:card.news.checkedAt,contentHash:source.kind==='global'?card.contentHash:null};
}
function addOriginal(state,source,storyKey,rank){
 const record=originalRecord(source,storyKey,rank);
 ensure(!state.ids.has(record.id)&&!state.urls.has(record.url)&&!state.identities.has(record.identity),'DUPLICATE_ORIGINAL',{scope:state.scope,id:record.id,storyKey});
 state.ids.add(record.id);state.urls.add(record.url);state.identities.add(record.identity);state.records.push(record);
}
export function acceptPage(state,response,city){
 const {value:page,receivedAt,entry}=response;checkExpiry(page,receivedAt);
 ensure(validNewsPage(page,receivedAt,city),'NEWS_PAGE_CONTRACT_INVALID',{scope:state.scope});
 ensure(page.sourceScope===state.scope&&page.language===EXPECTED.language&&page.cityId===EXPECTED.cityId&&page.countryCode===EXPECTED.countryCode&&page.filter===EXPECTED.filter&&page.period===EXPECTED.period&&page.day===null,'RESPONSE_CONTEXT_MISMATCH',{scope:state.scope});
 const context=editionContext(page);
 if(state.context!==null)ensure(same(context,state.context),'PAGINATION_CONTEXT_CHANGED',{scope:state.scope});
 const offset=state.items.length;
 ensure(page.items.length===Math.min(NEWS_SERVER_PAGE_SIZE,page.filteredTotal-offset),'PAGE_LENGTH_MISMATCH',{scope:state.scope,offset});
 ensure((page.nextCursor!==null)===(offset+page.items.length<page.filteredTotal),'PAGE_CONTINUATION_MISMATCH',{scope:state.scope,offset});
 if(page.nextCursor!==null){ensure(!state.cursors.has(page.nextCursor),'REPEATED_PAGE_CURSOR',{scope:state.scope});state.cursors.add(page.nextCursor);}
 for(const [name,wanted] of [['x-dlkt-news-epoch',page.epoch],['x-dlkt-news-revision',String(page.revision)],['x-dlkt-news-expires-at',page.expiresAt]]){
  const actual=entry.headers[name];ensure(actual===null||actual===wanted,'RESPONSE_HEADER_CONTEXT_MISMATCH',{name});
 }
 // A validated page is committed only after all its originals pass cross-page checks.
 const draft={...state,ids:new Set(state.ids),urls:new Set(state.urls),identities:new Set(state.identities),records:[...state.records]};
 const newItems=[],newPending=[],keys=new Set(state.keys),storyKeys=new Set(state.storyKeys);
 for(const item of page.items){
  const storyKey=item.story?.key??item.key,rank=offset+newItems.length+1;
  ensure(!keys.has(item.key)&&!storyKeys.has(storyKey),'DUPLICATE_STORY_KEY',{scope:state.scope,storyKey});keys.add(item.key);storyKeys.add(storyKey);
  const originals=[{kind:item.kind,card:item.card},...(item.story?.related??[])];
  for(const source of originals)addOriginal(draft,source,storyKey,rank);
  newItems.push({key:item.key,storyKey,rank,category:item.category??'other',publisher:item.card.publisher,originalLanguage:newsOriginalLanguage(originals[0]),sourceTotal:item.story?.sourceTotal??1,previewOriginals:originals.length});
  if(item.story?.nextSourcesCursor)newPending.push({storyKey,rank,sourceTotal:item.story.sourceTotal,offset:originals.length,cursor:item.story.nextSourcesCursor,
   observedExample:originals.some(source=>OBSERVED_EVENT.some(known=>known.url===source.card.sourceUrl))});
 }
 Object.assign(state,{context,keys,storyKeys,ids:draft.ids,urls:draft.urls,identities:draft.identities,records:draft.records,nextCursor:page.nextCursor});
 state.items.push(...newItems);state.pending.push(...newPending);
 state.pages.push({page:state.pages.length+1,request:entry.number,offset,items:page.items.length,nextCursorSha256:page.nextCursor===null?null:hash(page.nextCursor),bodySha256:entry.sha256,receivedAt:iso(receivedAt)});
}
async function collectEdition(state,budget,city){
 let cursor=null;
 for(let index=0;index<LIMITS.pagesPerEdition;index++){
  const response=await budget.read(pageUrl(state.scope,cursor),'page-'+state.scope);
  acceptPage(state,response,city);cursor=state.nextCursor;
  if(cursor===null)break;
 }
 state.sampleComplete=true;
}
async function continueSources(state,pending,budget,city){
 const response=await budget.read(sourcesUrl(pending.cursor),'story-sources-'+state.scope),page=response.value;checkExpiry(page,response.receivedAt);
 ensure(validNewsStorySourcesPage(page,response.receivedAt,city),'NEWS_SOURCES_CONTRACT_INVALID');
 ensure(same(sourceContext(page),sourceContext(state.context))&&page.storyKey===pending.storyKey&&page.sourceTotal===pending.sourceTotal&&page.offset===pending.offset,'SOURCE_CONTINUATION_CONTEXT_CHANGED');
 ensure(page.nextCursor!==pending.cursor,'REPEATED_SOURCE_CURSOR',{scope:state.scope,storyKey:pending.storyKey});
 const draft={...state,ids:new Set(state.ids),urls:new Set(state.urls),identities:new Set(state.identities),records:[...state.records]};
 for(const source of page.sources)addOriginal(draft,source,pending.storyKey,pending.rank);
 Object.assign(state,{ids:draft.ids,urls:draft.urls,identities:draft.identities,records:draft.records});
 state.sourcesPages.push({request:response.entry.number,storyKey:page.storyKey,offset:page.offset,sources:page.sources.length,sourceTotal:page.sourceTotal,nextCursorSha256:page.nextCursor===null?null:hash(page.nextCursor),bodySha256:response.entry.sha256});
}
function publisherWindow(items,requested){
 const sample=items.slice(0,requested),counts=new Map();
 for(const item of sample)counts.set(item.publisher,(counts.get(item.publisher)??0)+1);
 return {requestedStories:requested,observedStories:sample.length,distinctPublishers:counts.size,
  mostFrequent:[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'en')).slice(0,10).map(([publisher,count])=>({publisher,count}))};
}
function eventEvidence(state){
 const matches=state.records.filter(record=>OBSERVED_EVENT.some(known=>known.url===record.url)),groups=[...new Set(matches.map(record=>record.storyKey))];
 return {knownOriginals:3,observedOriginals:matches.length,observedGroupKeys:groups,
  status:matches.length===0?'not-observed-in-sample':groups.length>1?'split-groups':matches.length===3?'three-originals-one-group':'partially-observed',
  originals:matches.map(record=>({url:record.url,publisher:record.publisher,storyKey:record.storyKey,publishedAt:record.publishedAt,
   matchesHistoricalPublicationTime:record.publishedAt===OBSERVED_EVENT.find(known=>known.url===record.url).publishedAt}))};
}
function bbcAliasEvidence(state){
 const matches=state.records.filter(record=>OBSERVED_BBC_ALIASES.includes(record.url)),groups=[...new Set(matches.map(record=>record.storyKey))];
 return {knownOriginals:2,observedOriginals:matches.length,observedGroupKeys:groups,
  status:matches.length===0?'not-observed-in-sample':groups.length>1?'split-groups':matches.length===2?'two-originals-one-group':'partially-observed',
  originals:matches.map(({url,publisher,title,storyKey,publishedAt})=>({url,publisher,title,storyKey,publishedAt}))};
}
function observedThreadEvidence(state){
 return OBSERVED_EVENT_THREADS.map(known=>{
  const matches=state.records.filter(record=>known.originals.some(original=>original.url===record.url));
  const groups=[...new Set(matches.map(record=>record.storyKey))];
  return {id:known.id,knownOriginals:known.originals.length,observedOriginals:matches.length,observedGroupKeys:groups,
   status:matches.length===0?'not-observed-in-sample':groups.length>1?'split-groups':matches.length===known.originals.length?'all-originals-one-group':'partially-observed',
   originals:matches.map(({url,publisher,title,storyKey,publishedAt})=>({url,publisher,title,storyKey,publishedAt,
    matchesHistoricalPublicationTime:publishedAt===known.originals.find(original=>original.url===url).publishedAt}))};
 });
}
function repeatedHeadlineCandidates(state){
 const byHeadline=new Map();
 for(const record of state.records){const key=record.title.normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase('en');
  const group=byHeadline.get(key)??[];group.push(record);byHeadline.set(key,group);}
 return [...byHeadline.values()].filter(records=>new Set(records.map(record=>record.storyKey)).size>1)
  .map(records=>({title:records[0].title,storyKeys:[...new Set(records.map(record=>record.storyKey))],originals:records.map(({url,publisher,publishedAt})=>({url,publisher,publishedAt}))}));
}
function editionReport(state){
 const context=state.context,event=eventEvidence(state);
 const status=state.failures.some(error=>error.kind==='integrity')?'fail':!state.sampleComplete||state.failures.length?'incomplete':'sample-integrity-pass';
 return {sourceScope:state.scope,status,context,pages:state.pages,sourcePages:state.sourcesPages,
  sample:{stories:state.items.length,originals:state.records.length,completeEdition:state.sampleComplete&&state.nextCursor===null,
   moreStoriesRemain:state.nextCursor!==null,maximumStories:LIMITS.pagesPerEdition*NEWS_SERVER_PAGE_SIZE,
   declaredOriginalsInSample:state.items.reduce((sum,item)=>sum+item.sourceTotal,0)},
  publisherDiversity:{first20:publisherWindow(state.items,20),first60:publisherWindow(state.items,60),originalPublishersObserved:new Set(state.records.map(record=>record.publisher)).size},
  categoriesBelow7:context===null?null:NEWS_CATEGORIES.filter(category=>context.counts[category.id]<7).map(category=>({id:category.id,label:newsCategoryLabel(category.id,'ro'),count:context.counts[category.id],minimum:7,shortfall:7-context.counts[category.id]})),
  categoriesBelow10:context===null?null:NEWS_CATEGORIES.filter(category=>context.counts[category.id]<10).map(category=>({id:category.id,count:context.counts[category.id],target:10,shortfall:10-context.counts[category.id]})),
  unclassified:context?.counts.other??null,observedPenaltyExample:event,observedBbcAliasExample:bbcAliasEvidence(state),observedEventThreads:observedThreadEvidence(state),repeatedHeadlineCandidates:repeatedHeadlineCandidates(state),items:state.items,originals:state.records,failures:state.failures};
}
function compareDates(all,edition){
 const sameEpoch=all.context!==null&&edition.context!==null&&all.context.epoch===edition.context.epoch&&all.context.revision===edition.context.revision;
 const byUrl=new Map(all.records.map(record=>[record.url,record]));let compared=0;const changed=[];
 for(const record of edition.records){const previous=byUrl.get(record.url);if(previous){compared++;if(record.publishedAt!==previous.publishedAt)changed.push({url:record.url,allPublishedAt:previous.publishedAt,editionPublishedAt:record.publishedAt});}}
 return {sameEpoch,comparedOriginals:compared,changedDates:changed,
  method:'Exact public original date fields across scopes; global card dates also participate in the verified content hash. No publisher was queried.'};
}
async function readReceipt(budget){
 // Route established by source/scripts/prepare-public-release.mjs, not guessed.
 try{
  const {value,entry}=await budget.read(new URL(RECEIPT,ORIGIN),'public-build-receipt',32_768);
  const keys=['format','product','version','revision','manifestSha256','gitCommitSha','indexability','runtimeVerification'];
  ensure(object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))
   &&value.format==='dlkt-info-public-build-1'&&value.product==='dlkt-info'&&typeof value.version==='string'&&/^\d+\.\d+\.\d+$/u.test(value.version)
   &&typeof value.revision==='string'&&/^[a-z0-9][a-z0-9-]{2,100}$/u.test(value.revision)&&/^[a-f0-9]{64}$/u.test(value.manifestSha256)
   &&(value.gitCommitSha===null||typeof value.gitCommitSha==='string'&&/^[a-f0-9]{40}$/u.test(value.gitCommitSha))
   &&value.indexability==='prelaunch-noindex'&&value.runtimeVerification==='not-attested-by-receipt','BUILD_RECEIPT_INVALID');
  return {status:'observed',request:entry.number,path:RECEIPT,bodySha256:entry.sha256,receipt:value,deploymentTimestamp:null,
   boundary:'The receipt identifies the public build. It contains no deployment timestamp and does not attest runtime health; correlate the alias with Vercel deployment evidence.'};
 }catch(error){return {status:error instanceof ProbeError&&error.kind==='integrity'?'invalid':'unavailable',path:RECEIPT,error:errorRecord(error),deploymentTimestamp:null};}
}
export async function runProbe({fetcher=globalThis.fetch,clock=Date.now}={}){
 const budget=createBudgetReader(fetcher,clock),states=[stateFor('all'),stateFor('edition')],failures=[];
 const city=findCity(EXPECTED.cityId);
 ensure(city!==null&&city.id===EXPECTED.cityId&&city.countryCode===EXPECTED.countryCode&&city.timezone==='Europe/Bucharest','CITY_CATALOG_CONTEXT_INVALID');
 for(const state of states){
  try{await collectEdition(state,budget,city);}catch(error){state.failures.push(errorRecord(error));}
 }
 const build=await readReceipt(budget);
 // One optional original-source continuation stays inside the same eight-read budget.
 const candidates=states.filter(state=>state.failures.length===0&&state.context!==null&&Date.parse(state.context.expiresAt)>clock()).flatMap(state=>state.pending.map(pending=>({state,pending}))).sort((a,b)=>Number(b.pending.observedExample)-Number(a.pending.observedExample));
 if(candidates.length&&budget.requests.length<LIMITS.requests&&clock()<budget.deadline){
  const {state,pending}=candidates[0];
  try{await continueSources(state,pending,budget,city);}catch(error){state.failures.push(errorRecord(error));}
 }
 const dates=compareDates(states[0],states[1]);
 if(dates.sameEpoch&&dates.changedDates.length)failures.push({code:'ORIGINAL_DATES_CHANGED_WITHIN_EPOCH',kind:'integrity',changed:dates.changedDates.length});
 for(const state of states){
  const observed=eventEvidence(state);
  if(bbcAliasEvidence(state).status==='split-groups')state.failures.push({code:'OBSERVED_BBC_ALIAS_SPLIT',kind:'integrity'});
  for(const thread of observedThreadEvidence(state)){
   if(thread.status==='split-groups')state.failures.push({code:'OBSERVED_EVENT_THREAD_SPLIT',kind:'integrity',eventId:thread.id});
   for(const original of thread.originals)if(!original.matchesHistoricalPublicationTime)state.failures.push({
    code:'OBSERVED_EVENT_DATE_CHANGED',kind:'integrity',eventId:thread.id,url:original.url,publishedAt:original.publishedAt,
   });
  }
  if(observed.status==='split-groups')state.failures.push({code:'OBSERVED_PENALTY_EVENT_SPLIT',kind:'integrity'});
  for(const original of observed.originals)if(!original.matchesHistoricalPublicationTime)state.failures.push({
   code:'OBSERVED_ORIGINAL_PUBLICATION_DATE_CHANGED',kind:'integrity',url:original.url,publishedAt:original.publishedAt,
   expectedPublishedAt:OBSERVED_EVENT.find(known=>known.url===original.url).publishedAt,
  });
 }
 if(build.status==='invalid')failures.push(build.error);
 const editions=states.map(editionReport);
 const failed=failures.some(error=>error.kind==='integrity')||editions.some(edition=>edition.status==='fail');
 const incomplete=editions.some(edition=>edition.status==='incomplete');
 return {format:'dlkt-reader-acceptance-1',status:failed?'fail':incomplete?'incomplete':'sample-integrity-pass',
  startedAt:iso(budget.startedAt),completedAt:iso(clock()),elapsedMs:clock()-budget.startedAt,
  probeGitCommitSha:/^[a-f0-9]{40}$/iu.test(process.env.GITHUB_SHA??'')?process.env.GITHUB_SHA.toLowerCase():null,
  target:{origin:ORIGIN,path:API,...EXPECTED},limits:LIMITS,requestsMade:budget.requests.length,requests:budget.requests,build,
  checksEnabled:{realCompiledPageAndSourceValidators:true,reviewedCityCatalog:true,sourceScopeRequiredExplicitly:true,stableContextWithinEachEdition:true,
   uniquenessBoundary:'Each edition separately, across its sampled story pages and optional source page. Overlap between all and Romanian edition is expected.',
   originalDateEvidence:dates,volumeShortfallsAreInformational:true,publisherOrAccountOrDatabaseRequests:0,redirectsFollowed:0,retries:0},
  editions,failures,
  boundary:'This is a bounded sample of the current public corpus. Category counts describe the full API edition; publisher diversity and duplicate checks cover only sampled pages and visible or explicitly continued originals. Unfetched originals, absent examples and later refreshes are not attested.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let result;
 try{
  ensure(process.argv.length===2,'PROBE_ARGUMENTS_NOT_ALLOWED');
  result=await runProbe();
 }catch(error){result={format:'dlkt-reader-acceptance-1',status:error instanceof ProbeError&&error.kind==='integrity'?'fail':'incomplete',error:errorRecord(error)};}
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(result.status!=='sample-integrity-pass')process.exitCode=result.status==='fail'?1:2;
}

