import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NewsDiagnosticsBuilder,validNewsDiagnostics,newsDiagnosticReason,NEWS_DIAGNOSTIC_COUNTERS,NEWS_DIAGNOSTIC_MAX_BYTES,NEWS_DIAGNOSTIC_EMIT_BYTES,NEWS_DIAGNOSTIC_MAX_GROUPS} from '../.build/src/iceo/news-diagnostics.js';
import {discoverNews,discoverNewsWithDiagnostics} from '../.build/src/iceo/news-discovery.js';
import {NEWS_INDEX_URL,NEWS_DISCOVERY_INDEXES,NEWS_PUBLISHERS,NEWS_SOURCE_LANGUAGES,NEWS_SOURCES} from '../.build/src/iceo/news-sources.js';
import {classifyNewsHeadline} from '../.build/src/iceo/editorial-categories.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';

const now=Date.parse('2026-11-22T17:00:00.000Z'),checkedAt=new Date(now).toISOString(),date=new Date(now-60_000).toISOString();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function candidate(id,publisher='Reuters',sourceUrl='https://www.reuters.com/technology/controlled-source-'+String(id).padStart(5,'0')){
 const title='New artificial intelligence software launches for laptops';
 return {sourceUrl,title,publisher,indexedAt:checkedAt,category:classifyNewsHeadline(title,sourceUrl)};
}
const gal=rows=>'<rss><channel><title>GDELT Article List RSS Feed</title><link>'+NEWS_INDEX_URL+'</link><lastBuildDate>'+new Date(now).toUTCString()+'</lastBuildDate>'+rows.map(row=>'<item><title>'+escape(row.title)+'</title><link>'+escape(row.sourceUrl)+'</link></item>').join('')+'</channel></rss>';
const html=row=>'<html><head><link rel="canonical" href="'+row.sourceUrl+'"><script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',url:row.sourceUrl,headline:row.title,datePublished:date})+'</script></head><body>Not part of diagnostics.</body></html>';
const options={publisherIndexes:false,frontpageHighlights:false};
const response=(body,type='text/html',status=200)=>new Response(body,{status,headers:{'content-type':type}});
function fetcher(rows,{invalid=new Set(),calls=[]}={}){
 const byUrl=new Map(rows.map(row=>[row.sourceUrl,row]));
 return async input=>{
  const url=String(input);if(url===NEWS_INDEX_URL)return response(gal(rows),'application/rss+xml');
  calls.push(url);const row=byUrl.get(url);assert.ok(row,'original requests remain inside the controlled candidate list');
  return response(invalid.has(url)?'<html><head></head></html>':html(row));
 };
}
function clean(report){
 assert.equal(validNewsDiagnostics(report,now),true);
 assert.ok(Buffer.byteLength(JSON.stringify(report))<=NEWS_DIAGNOSTIC_EMIT_BYTES);
 const serialized=JSON.stringify(report);assert.doesNotMatch(serialized,/https?:|controlled-source|laptops|Bearer|PRIVATE_SENTINEL/u);
 for(const row of report.groups){
  const c=row.counts;assert.equal(c.pool,c.scheduled+c.deferredCapacity);assert.equal(c.scheduled,c.attempted+c.deferredBeforeAttempt);
  assert.equal(c.attempted,c.verifiedNow+c.rejected+c.duplicates);
 }
 for(const counter of NEWS_DIAGNOSTIC_COUNTERS)assert.equal(report.totals[counter],report.groups.reduce((sum,row)=>sum+row.counts[counter],0));
}
test('diagnostics preserve the compatibility results and distinguish reviewed native editions from unknown language',async()=>{
 const rows=[candidate(1),candidate(2,'The Guardian','https://www.theguardian.com/technology/2026/nov/22/controlled-original'),
  candidate(3,'Digi24','https://www.digi24.ro/stiri/actualitate/controlled-original-300')];
 const collected=await discoverNewsWithDiagnostics(fetcher([...rows,rows[0]]),now,[],undefined,options);
 const legacy=await discoverNews(fetcher([...rows,rows[0]]),now,[],undefined,options);
 assert.deepEqual(collected.sources,legacy);clean(collected.diagnostics);
 const d=collected.diagnostics;assert.equal(d.totals.freshDiscovered,3);assert.equal(d.totals.pool,3);assert.equal(d.totals.verifiedNow,3);
 assert.equal(d.groups.find(row=>row.publisherId==='reuters').language,null,'unknown provenance never becomes English');
 assert.equal(d.groups.find(row=>row.publisherId==='guardian').language,'en');assert.equal(d.groups.find(row=>row.publisherId==='digi24').language,'ro');
 assert.deepEqual(d.indexes,[{indexId:'gdelt-gal',publisherId:null,language:null,attempted:true,state:'verified',checkedAt,reason:null}]);
});
test('request capacity, metadata rejection and successful original checks are counted independently',async()=>{
 const rows=Array.from({length:5},(_,i)=>candidate(i+10)),calls=[];
 const result=await discoverNewsWithDiagnostics(fetcher(rows,{calls,invalid:new Set([rows[0].sourceUrl])}),now,[],undefined,{...options,maxArticleRequests:2,concurrency:1});
 const d=result.diagnostics;clean(d);assert.equal(calls.length,2);
 assert.deepEqual(d.totals,{freshDiscovered:5,pool:5,scheduled:2,attempted:2,requestAttempts:2,verifiedNow:1,rejected:1,duplicates:0,deferredCapacity:3,deferredBeforeAttempt:0,retained:0});
 assert.deepEqual(d.groups[0].reasons,[{code:'metadata-unverified',count:1},{code:'request-capacity',count:3}]);
 assert.equal(d.groups[0].lastAttemptAt,checkedAt);assert.equal(d.groups[0].lastVerifiedAt,checkedAt);
});
test('an origin blocked before fetch is deferred without inventing an original request or verification',async()=>{
 const rows=[candidate(20)],calls=[];
 const result=await discoverNewsWithDiagnostics(fetcher(rows,{calls}),now,[],undefined,{...options,originBackoff:new Map([['https://www.reuters.com',new Date(now+60_000).toISOString()]])});
 const d=result.diagnostics;clean(d);assert.equal(calls.length,0);assert.equal(d.totals.scheduled,0);
 assert.equal(d.totals.attempted,0);assert.equal(d.totals.requestAttempts,0);assert.equal(d.totals.deferredBeforeAttempt,0);assert.equal(d.totals.deferredCapacity,1);
 assert.deepEqual(d.groups[0].reasons,[{code:'origin-backoff',count:1}]);assert.equal(d.groups[0].lastAttemptAt,null);assert.equal(d.groups[0].lastVerifiedAt,null);
});
test('redirects consume request attempts while the next unattempted original is reported as deferred',async()=>{
 const rows=[candidate(30),candidate(31)],redirect='https://www.reuters.com/technology/redirected-original',calls=[];
 const network=async input=>{
  const url=String(input);if(url===NEWS_INDEX_URL)return response(gal(rows),'application/rss+xml');calls.push(url);
  if(url===rows[0].sourceUrl)return new Response(null,{status:302,headers:{location:redirect}});
  if(url===redirect)return response(html(rows[0]));
  assert.fail('the second original must remain behind the two-request budget');
 };
 const result=await discoverNewsWithDiagnostics(network,now,[],undefined,{...options,maxArticleRequests:2,concurrency:1});
 const d=result.diagnostics;clean(d);assert.deepEqual(calls,[rows[0].sourceUrl,redirect]);
 assert.equal(d.totals.scheduled,2);assert.equal(d.totals.attempted,1);assert.equal(d.totals.requestAttempts,2);
 assert.equal(d.totals.verifiedNow,1);assert.equal(d.totals.deferredBeforeAttempt,1);assert.equal(d.totals.rejected,0);
});
test('retained evidence keeps its original check time and is never labelled newly verified',async()=>{
 const rows=[candidate(40)],first=await discoverNewsWithDiagnostics(fetcher(rows),now,[],undefined,options);
 const old=first.sources.flatMap(source=>source.cards)[0];assert.ok(old);
 const later=now+120_000,result=await discoverNewsWithDiagnostics(fetcher([]),later,[],undefined,{...options,retainedCards:[old]});
 const d=result.diagnostics;assert.equal(validNewsDiagnostics(d,later),true);
 assert.deepEqual(result.sources.flatMap(source=>source.cards),[old]);assert.equal(d.totals.retained,1);assert.equal(d.totals.verifiedNow,0);
 assert.equal(d.totals.attempted,0);assert.equal(d.groups[0].lastAttemptAt,null);assert.equal(d.groups[0].lastVerifiedAt,old.observedAt);
 assert.notEqual(d.checkedAt,old.observedAt);assert.equal(old.contentHash,digest(cardContent(old)));
});
test('failed indexes remain attributable even with zero candidates and store failures expose no exception text',async()=>{
 const network=async input=>String(input)===NEWS_INDEX_URL?response(gal([]),'application/rss+xml'):response('unavailable','text/plain',503);
 const result=await discoverNewsWithDiagnostics(network,now,[],undefined,{frontpageHighlights:false});
 const d=result.diagnostics;clean(d);assert.equal(d.indexes.length,NEWS_DISCOVERY_INDEXES.length+1);assert.equal(d.totals.pool,0);
 const digi=d.indexes.find(row=>row.indexId==='digi24-ro-news');assert.equal(digi.publisherId,'digi24');assert.equal(digi.language,'ro');
 assert.equal(digi.attempted,true);assert.equal(digi.state,'unavailable');assert.equal(digi.reason,'http-unavailable');
 assert.equal(d.groups.find(row=>row.publisherId==='digi24'&&row.language==='ro').counts.verifiedNow,0);
 const failed=await discoverNewsWithDiagnostics(fetcher([]),now,[],async()=>{throw Error('PRIVATE_SENTINEL');},options);
 clean(failed.diagnostics);assert.deepEqual(failed.diagnostics.issues,['candidate-store']);
});
test('an expired rights review produces a bounded policy receipt without any network call',async()=>{
 const expired=Date.parse(NEWS_SOURCES.map(source=>source.rightsReviewBy).sort()[0]+'T00:00:00.000Z')+86_400_000;
 const result=await discoverNewsWithDiagnostics(async()=>{assert.fail('expired review cannot invoke fetch');},expired,[],undefined,options);
 const d=result.diagnostics;assert.equal(validNewsDiagnostics(d,expired),true);assert.equal(d.totals.requestAttempts,0);
 assert.deepEqual(d.issues,['rights-review-expired']);assert.equal(d.indexes[0].attempted,false);assert.equal(d.indexes[0].state,'deferred');
 assert.ok(result.sources.every(source=>source.health.state==='unavailable'&&source.cards.length===0));
});
test('late identity conflicts undo a prior success and duplicate originals have a separate terminal count',()=>{
 const rows=[candidate(50),candidate(51),candidate(52)],builder=new NewsDiagnosticsBuilder(now);
 builder.discovered([...rows,rows[0]]);builder.pool(rows);builder.scheduled(rows.slice(0,2));
 builder.request(rows[0].sourceUrl);builder.verified(rows[0].sourceUrl);builder.failed(rows[0].sourceUrl,'NEWS_IDENTITY_CONFLICT');
 builder.request(rows[1].sourceUrl);builder.duplicate(rows[1].sourceUrl);
 const d=builder.finish();clean(d);assert.equal(d.totals.freshDiscovered,3);assert.equal(d.totals.verifiedNow,0);
 assert.equal(d.totals.rejected,1);assert.equal(d.totals.duplicates,1);assert.equal(d.totals.deferredCapacity,1);
 assert.equal(d.groups[0].lastVerifiedAt,null);
});
test('canonical aliases reclassify the original candidate checks when a later identity conflicts',async()=>{
 const rows=[candidate(53),candidate(54)],canonical='https://www.reuters.com/technology/shared-canonical';
 for(const conflict of [false,true]){
  const result=await discoverNewsWithDiagnostics(async input=>{
   const url=String(input);if(url===NEWS_INDEX_URL)return response(gal(rows),'application/rss+xml');
   const original=rows.find(row=>row.sourceUrl===url);assert.ok(original);
   const body=html({...original,sourceUrl:canonical});
   return response(conflict&&original===rows[1]?body.replace(date,new Date(now-120_000).toISOString()):body);
  },now,[],undefined,{...options,maxArticleRequests:2,concurrency:1});
  clean(result.diagnostics);assert.equal(result.diagnostics.totals.attempted,2);
  assert.equal(result.diagnostics.totals.verifiedNow,conflict?0:1);
  assert.equal(result.diagnostics.totals.rejected,conflict?2:0);
  assert.equal(result.diagnostics.totals.duplicates,conflict?0:1);
  const cards=result.sources.flatMap(source=>source.cards);assert.equal(cards.length,conflict?0:1);
  if(!conflict)assert.equal(cards[0].sourceUrl,canonical);
 }
});
test('completion order cannot change aggregate receipt ordering or counts',()=>{
 const rows=[candidate(60),candidate(61,'The Guardian','https://www.theguardian.com/technology/2026/nov/22/controlled-second')];
 const reports=[false,true].map(reverse=>{
  const builder=new NewsDiagnosticsBuilder(now),ordered=reverse?[...rows].reverse():rows;
  builder.discovered(ordered);builder.pool(ordered);builder.scheduled(ordered);
  for(const row of ordered){builder.request(row.sourceUrl);builder.verified(row.sourceUrl);}
  return builder.finish();
 });
 assert.deepEqual(reports[0],reports[1]);clean(reports[0]);
});
test('validator rejects unknown fields, fabricated identities, broken equations, unknown reasons and future receipts',()=>{
 const row=candidate(70),builder=new NewsDiagnosticsBuilder(now);builder.pool([row]);builder.scheduled([row]);builder.request(row.sourceUrl);builder.verified(row.sourceUrl);
 const report=builder.finish(),copy=()=>JSON.parse(JSON.stringify(report));clean(report);
 const invalid=[];
 let value=copy();value.version=null;invalid.push(value);
 value=copy();value.secret='PRIVATE_SENTINEL';invalid.push(value);
 value=copy();value.groups[0].publisherId='invented-publisher';invalid.push(value);
 value=copy();value.groups[0].language='invented-language';invalid.push(value);
 value=copy();value.groups[0].counts.pool++;invalid.push(value);
 value=copy();value.totals.verifiedNow++;invalid.push(value);
 value=copy();value.groups[0].reasons=[{code:'https://private.invalid',count:1}];invalid.push(value);
 value=copy();value.groups[0].lastAttemptAt=null;invalid.push(value);
 value=copy();value.groups.push({...value.groups[0]});invalid.push(value);
 value=copy();value.indexes=[{indexId:'forged-index',publisherId:'reuters',language:null,attempted:true,state:'verified',checkedAt,reason:null}];invalid.push(value);
 value=copy();value.indexes=[{indexId:'gdelt-gal',publisherId:null,language:null,attempted:false,state:null,checkedAt,reason:'deadline'}];invalid.push(value);
 value=copy();value.checkedAt=new Date(now+300001).toISOString();invalid.push(value);
 for(const rejected of invalid)assert.equal(validNewsDiagnostics(rejected,now),false);
 assert.equal(validNewsDiagnostics(report,Number.NaN),false);
});
test('diagnostic group and byte limits are explicit and unfinished scheduled work cannot masquerade as complete',()=>{
 assert.equal(NEWS_DIAGNOSTIC_MAX_GROUPS,256);assert.equal(NEWS_DIAGNOSTIC_MAX_BYTES,65536);assert.equal(NEWS_DIAGNOSTIC_EMIT_BYTES,49152);
 const row=candidate(80),builder=new NewsDiagnosticsBuilder(now);builder.pool([row]);builder.scheduled([row]);
 assert.throws(()=>builder.finish(),/NEWS_DIAGNOSTICS_INCOMPLETE/u);
 const report=new NewsDiagnosticsBuilder(now).finish(),counts={...report.totals},groups=[];
 collect:for(const publisher of NEWS_PUBLISHERS)for(const language of [null,...NEWS_SOURCE_LANGUAGES]){
  groups.push({publisherId:publisher.id,language,counts:{...counts},reasons:[],lastAttemptAt:null,lastVerifiedAt:null});
  if(groups.length===257)break collect;
 }
 assert.equal(validNewsDiagnostics({...report,groups:groups.slice(0,257)},now),false);
 const oversized={...report,groups:groups.slice(0,256)};
 assert.ok(Buffer.byteLength(JSON.stringify(oversized))>NEWS_DIAGNOSTIC_MAX_BYTES);
 assert.equal(validNewsDiagnostics(oversized,now),false);
 assert.throws(()=>new NewsDiagnosticsBuilder(now).pool([{sourceUrl:'https://private.invalid/secret'}]),/NEWS_DIAGNOSTICS_IDENTITY_INVALID/u);
});
test('reason normalization retains useful bounded causes without copying remote error content',()=>{
 for(const [code,expected] of [['NEWS_HTTP_403','access-denied'],['NEWS_HTTP_429','rate-limited'],['NEWS_HTTP_503','http-unavailable'],
  ['NEWS_INDEX_IDENTITY_INVALID','index-identity'],['NEWS_GLOBAL_DEADLINE','deadline'],['NEWS_REQUEST_TIMEOUT','timeout'],
  ['NEWS_PUBLICATION_METADATA_UNVERIFIED','metadata-unverified'],['Bearer PRIVATE_SENTINEL','request-unavailable']])assert.equal(newsDiagnosticReason(code),expected);
});

test('blocked pool candidates preserve their reason without occupying the finite schedule',()=>{
 const builder=new NewsDiagnosticsBuilder(now);
 const blocked=Array.from({length:100},(_,index)=>candidate(800+index));
 const available=candidate(999,'The Guardian','https://www.theguardian.com/technology/available-original');
 builder.pool([...blocked,available]);
 for(const row of blocked)builder.deferBeforeScheduling(row.sourceUrl,'origin-backoff');
 builder.scheduled([available]);builder.request(available.sourceUrl);builder.verified(available.sourceUrl);
 const report=builder.finish();clean(report);
 assert.equal(report.totals.pool,101);assert.equal(report.totals.scheduled,1);assert.equal(report.totals.requestAttempts,1);
 assert.equal(report.totals.deferredCapacity,100);
 assert.deepEqual(report.groups.find(group=>group.publisherId==='reuters').reasons,[{code:'origin-backoff',count:100}]);
 assert.throws(()=>builder.scheduled([blocked[0]]),/NEWS_DIAGNOSTICS_SEQUENCE_INVALID/u);
});
