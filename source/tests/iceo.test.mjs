import assert from 'node:assert/strict';
import test from 'node:test';
import { ICEO_SOURCES, sourceRequest } from '../.build/src/iceo/registry.js';
import { extract } from '../.build/src/iceo/extract.js';
import { acquire, readBounded, sourceRetryDelay } from '../.build/src/iceo/transport.js';
import { IceoEngine, reconcile } from '../.build/src/iceo/engine.js';
import { handleIceo } from '../.build/api/iceo.js';
const now=Date.parse('2026-11-14T12:00:00Z');
const source=ICEO_SOURCES.find(x=>x.id==='ecb-news');
const rss=(title='Official statement',link='https://www.ecb.europa.eu/press/test.html')=>`<?xml version="1.0"?><rss><channel><title>ECB - European Central Bank</title><item><title>${title}</title><link>${link}</link><pubDate>Fri, 13 Nov 2026 08:00:00 +0100</pubDate></item></channel></rss>`;
const http=(text=rss())=>new Response(text,{headers:{'content-type':'application/rss+xml',etag:'"one"'}});
function out(){const headers=new Map();let body='';return {res:{statusCode:0,setHeader:(k,v)=>headers.set(k.toLowerCase(),v),end:(v='')=>{body=v;}},headers,json:()=>JSON.parse(body),body:()=>body};}
test('ICEO registry blocks unknown endpoints and expires rights reviews',()=>{
 assert.throws(()=>sourceRequest({...source,endpoint:'http://127.0.0.1/'},now),/SOURCE_NOT_REGISTERED/);
 assert.throws(()=>sourceRequest(source,Date.parse('2027-02-15')),/RIGHTS_REVIEW_EXPIRED/);
 assert.equal(sourceRequest(ICEO_SOURCES[0],now).hostname,'publications.europa.eu');
});
test('ICEO transport rejects redirects and HTML instead of ingesting it',async()=>{
 await assert.rejects(()=>acquire(source,now,async()=>new Response(null,{status:302,headers:{location:'https://attacker.invalid/'}})),/SOURCE_REDIRECT_REJECTED/);
 await assert.rejects(()=>acquire(source,now,async()=>new Response('<html>wrong</html>',{headers:{'content-type':'text/html'}})),/SOURCE_CONTENT_TYPE_REJECTED/);
});
test('ICEO bounds streamed response size and cancels oversized input',async()=>{
 await assert.rejects(()=>readBounded(new Response('123456'),4),/SOURCE_TOO_LARGE/);
 await assert.rejects(()=>readBounded(new Response('1',{headers:{'content-length':'999'}}),4),/SOURCE_TOO_LARGE/);
});
test('ICEO preserves exact titles, canonical provenance and content hashes',()=>{
 const result=extract(rss('Rates &amp; figures'),source,now);
 assert.equal(result.cards[0].title,'Rates & figures');assert.match(result.cards[0].contentHash,/^[a-f0-9]{64}$/);
 assert.equal(result.cards[0].dateLabel,'Published');assert.equal(result.cards[0].sourceIds[0],source.id);
 const again=extract(rss('Rates &amp; figures'),source,now+1000);
 assert.equal(again.cards[0].contentHash,result.cards[0].contentHash);assert.notEqual(again.cards[0].observedAt,result.cards[0].observedAt);
});
test('ICEO rejects DTD, XML entities and unexpected publisher identity',()=>{
 assert.throws(()=>extract('<!DOCTYPE x>'+rss(),source,now),/SOURCE_XML_REJECTED/);
 assert.throws(()=>extract(rss().replace('ECB - European Central Bank','Fake publisher'),source,now),/SOURCE_IDENTITY_MISMATCH/);
});
test('ICEO quarantines hostile links and future records instead of publishing',()=>{
 for(const link of ['javascript:alert(1)','https://www.ecb.europa.eu.attacker.invalid/x','https://user:password@www.ecb.europa.eu/x']){
  const r=extract(rss('X',link),source,now);assert.equal(r.cards.length,0);assert.equal(r.rejected,1);
 }
 const r=extract(rss().replace('Fri, 13 Nov 2026 08:00:00 +0100','2030-01-01'),source,now);assert.equal(r.rejected,1);
});
test('ICEO distinguishes legal document date from publication and checks CELEX',()=>{
 const s=ICEO_SOURCES[0];const binding={work:{value:'http://publications.europa.eu/resource/cellar/889e26be-b31f-11f1-81de-01aa75ed71a1'},celex:{value:'32026R1234'},date:{value:'2026-11-13'},title:{value:'Official legal document','xml:lang':'en'}};
 const r=extract(JSON.stringify({results:{bindings:[binding]}}),s,now);assert.equal(r.cards[0].dateLabel,'Document date');assert.equal(r.cards[0].identity,'celex:32026R1234');
 binding.work.value='http://attacker.invalid/resource/cellar/889e26be-b31f-11f1-81de-01aa75ed71a1';assert.equal(extract(JSON.stringify({results:{bindings:[binding]}}),s,now).rejected,1);
});
test('ICEO excludes alpha releases even if publisher prerelease flag is false',()=>{
 const s=ICEO_SOURCES.find(x=>x.id==='nodejs');
 const row={draft:false,prerelease:false,tag_name:'v27.0.0-alpha.0',name:'Alpha',published_at:'2026-11-13T12:00:00Z',html_url:'https://github.com/nodejs/node/releases/tag/v27.0.0-alpha.0'};
 assert.equal(extract(JSON.stringify([row]),s,now).cards.length,0);
 row.tag_name='v26.0.0';row.html_url='https://github.com/nodejs/node/releases/tag/v26.0.0';assert.equal(extract(JSON.stringify([row]),s,now).cards.length,1);
});
test('ICEO coalesces concurrent reads without duplicating acquisition',async()=>{
 let calls=0;const engine=new IceoEngine(async()=>{calls++;await new Promise(r=>setTimeout(r,5));return http();},()=>now);
 const [a,b]=await Promise.all([engine.read(source),engine.read(source)]);assert.equal(calls,1);assert.deepEqual(a,b);await engine.read(source);assert.equal(calls,1);
});
test('ICEO retains dated stale evidence, backs off and expires it',async()=>{
 let clock=now,calls=0;const engine=new IceoEngine(async()=>{calls++;if(calls===1)return http();throw new Error('network');},()=>clock);
 const first=await engine.read(source);clock+=900001;const stale=await engine.read(source);
 assert.equal(stale.health.state,'stale');assert.equal(stale.health.verifiedAt,first.health.verifiedAt);assert.equal(stale.cards[0].sourceState,'stale');
 await engine.read(source);assert.equal(calls,2);clock+=86400001;const expired=await engine.read(source);assert.equal(expired.health.state,'unavailable');assert.equal(expired.cards.length,0);
});
test('ICEO recovers after backoff and does not cache initial failures as healthy',async()=>{
 let clock=now,calls=0;const engine=new IceoEngine(async()=>{if(++calls===1)throw new Error('fail');return http();},()=>clock);
 assert.equal((await engine.read(source)).health.state,'unavailable');clock+=60001;assert.equal((await engine.read(source)).health.state,'verified');assert.equal(calls,2);
});
test('ICEO refreshes provenance on valid upstream 304',async()=>{
 let clock=now,calls=0;const engine=new IceoEngine(async(_url,init)=>{calls++;if(calls===1)return http();assert.equal(init.headers['If-None-Match'],'"one"');return new Response(null,{status:304});},()=>clock);
 const a=await engine.read(source);clock+=900001;const b=await engine.read(source);assert.equal(b.health.state,'verified');assert.notEqual(a.health.verifiedAt,b.health.verifiedAt);assert.equal(a.cards[0].contentHash,b.cards[0].contentHash);
});
test('ICEO isolates duplicates from conflicting metadata and does not invent corroboration',async()=>{
 const engine=new IceoEngine(async()=>http(),()=>now);const a=await engine.read(source);
 const dup=reconcile([a,a]);assert.equal(dup.cards.length,1);assert.equal(dup.duplicateCount,1);
 const conflict=reconcile([a,{...a,cards:a.cards.map(c=>({...c,title:'Other',contentHash:'a'.repeat(64)}))}]);assert.equal(conflict.cards.length,0);assert.equal(conflict.conflictCount,1);assert.equal(conflict.state,'partial');
});
test('ICEO public API never accepts private filters or writes',async()=>{
 const engine=new IceoEngine(async()=>http(),()=>now);const snapshot=reconcile([await engine.read(source)]);const load=async()=>snapshot;
 const result=out();await handleIceo({method:'GET',url:'/api/iceo',headers:{}},result.res,load);assert.equal(result.res.statusCode,200);assert.match(result.headers.get('cache-control'),/^public/);assert.equal(result.json().mode,'current-official-records');assert.equal(result.json().deltaAvailable,false);
 const second=out();await handleIceo({method:'GET',url:'/api/iceo',headers:{'if-none-match':result.headers.get('etag')}},second.res,load);assert.equal(second.res.statusCode,304);
 for(const [method,url,status] of [['POST','/api/iceo',405],['GET','/api/iceo?private=1',400]]){const r=out();await handleIceo({method,url,headers:{}},r.res,load);assert.equal(r.res.statusCode,status);}
});
test('ICEO public API reports total source outage without claiming caught up',async()=>{
 const engine=new IceoEngine(async()=>{throw new Error('offline');},()=>now);const snapshot=await engine.snapshot();assert.equal(snapshot.state,'unavailable');assert.equal(snapshot.cards.length,0);assert.equal(snapshot.sources.length,ICEO_SOURCES.filter(source=>source.adapter!=='news-index').length);
 const r=out();await handleIceo({method:'HEAD',url:'/api/iceo',headers:{}},r.res,async()=>snapshot);assert.equal(r.body(),'');assert.equal(r.headers.get('retry-after'),'60');
});

test('ICEO quarantines unresolved upstream title placeholders',()=>{
 const result=extract(rss('__[unreferenced:arret-c-ii-ext]__ of 12 November'),source,now);
 assert.equal(result.cards.length,0);assert.equal(result.rejected,1);
});

test('ICEO rejects publication timestamps beyond clock-skew tolerance',()=>{
 const future=new Date(now+3600000).toUTCString();
 assert.equal(extract(rss().replace('Fri, 13 Nov 2026 08:00:00 +0100',future),source,now).rejected,1);
});
test('ICEO fresh duplicate keeps its actual observation time and source state together',async()=>{
 const engine=new IceoEngine(async()=>http(),()=>now);const initial=await engine.read(source);
 const older={...initial,cards:initial.cards.map(c=>({...c,observedAt:new Date(now-3600000).toISOString(),sourceState:'stale'}))};
 const merged=reconcile([older,initial]);
 assert.equal(merged.cards[0].observedAt,initial.cards[0].observedAt);
 assert.equal(merged.cards[0].sourceState,'verified');assert.equal(merged.duplicateCount,1);
 const reversed=reconcile([initial,older]);assert.deepEqual(reversed.cards,merged.cards);
});
test('ICEO rejects malformed Cellar authority and UUID even with valid CELEX',()=>{
 const s=ICEO_SOURCES[0];
 for(const work of ['http://publications.europa.eu:8080/resource/cellar/889e26be-b31f-11f1-81de-01aa75ed71a1','http://publications.europa.eu/resource/cellar/------------------------------------','http://publications.europa.eu/resource/cellar/889e26be-b31f-11f1-81de-01aa75ed71a1?rewrite=1']){
  const binding={work:{value:work},celex:{value:'32026R1234'},date:{value:'2026-11-13'},title:{value:'Official legal document','xml:lang':'en'}};
  const parsed=extract(JSON.stringify({results:{bindings:[binding]}}),s,now);
  assert.equal(parsed.rejected,1);assert.equal(parsed.cards.length,0);
 }
});
test('ICEO honours Retry-After dates and exhausted GitHub quotas',async()=>{
 assert.equal(sourceRetryDelay(new Headers({'retry-after':'120'}),now),120);
 assert.equal(sourceRetryDelay(new Headers({'retry-after':new Date(now+120000).toUTCString()}),now),120);
 assert.equal(sourceRetryDelay(new Headers({'x-ratelimit-remaining':'0','x-ratelimit-reset':String(now/1000+1800)}),now),1800);
 assert.equal(sourceRetryDelay(new Headers({'retry-after':'garbage'}),now),null);
 const limited=async()=>new Response(null,{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':String(now/1000+1800)}});
 await assert.rejects(()=>acquire(source,now,limited),e=>e.code==='SOURCE_RATE_LIMITED'&&e.retryAfterSeconds===1800);
});
