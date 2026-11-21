import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createNewsBackoffFetch,newsBackoffKey,NEWS_BACKOFF_NAMESPACE,NEWS_BACKOFF_IO_TIMEOUT_MS} from '../.build/src/iceo/news-backoff.js';

const start=Date.parse('2026-11-20T12:00:00Z');
function cache(){
  const values=new Map(),writes=[];
  return {values,writes,read:async key=>values.get(key),write:async(key,value,ttl)=>{values.set(key,structuredClone(value));writes.push({key,value,ttl});}};
}
const limited=(status=429,retry='3600')=>new Response('publisher unavailable',{status,headers:retry===null?{}:{'Retry-After':retry}});

test('keys contain only a hashed origin and the production namespace is project-specific',()=>{
  assert.equal(newsBackoffKey('https://publisher.example'),'origin:'+createHash('sha256').update('https://publisher.example').digest('hex'));
  assert.match(NEWS_BACKOFF_NAMESPACE,/^prj_3JKAWw8EvzWKNPqFNFxk4iDL2l7P:/u);assert.equal(NEWS_BACKOFF_IO_TIMEOUT_MS,500);
});

test('a different worker honors an hour backoff at the next fifteen-minute refresh and resumes after expiry',async()=>{
  const store=cache();let now=start,calls=0;
  const origin=async()=>{calls++;return calls===1?limited():new Response('fresh publisher metadata');};
  const first=createNewsBackoffFetch(origin,store,()=>now);
  assert.equal((await first('https://publisher.example/first')).status,429);assert.equal(calls,1);assert.equal(store.writes[0].ttl,3600);
  now+=15*60_000;
  const second=createNewsBackoffFetch(origin,store,()=>now),blocked=await second('https://publisher.example/other-story');
  assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'2700');assert.equal(calls,1);
  now=start+3_600_001;
  const third=createNewsBackoffFetch(origin,store,()=>now);assert.equal((await third('https://publisher.example/latest')).status,200);assert.equal(calls,2);
});

test('HTTP-date retry-after is retained for503 and long valid instructions are not silently shortened',async()=>{
  for(const duration of [3_600_000,3*86_400_000]){
    const store=cache(),fetcher=createNewsBackoffFetch(async()=>limited(503,new Date(start+duration).toUTCString()),store,()=>start);
    assert.equal((await fetcher('https://publisher.example/article')).status,503);
    assert.equal(store.writes[0].value.blockedUntil,start+duration);assert.equal(store.writes[0].ttl,duration/1000);
  }
});

test('malformed retry-after uses the bounded default; zero never causes a rapid retry loop',async()=>{
  for(const value of [null,'later','-5','1.5','Infinity','2026-11-21','999999999999999999999']){
    const store=cache(),fetcher=createNewsBackoffFetch(async()=>limited(429,value),store,()=>start);
    await fetcher('https://publisher.example/article');assert.equal(store.writes[0].value.blockedUntil,start+60_000,String(value));
  }
  const store=cache();await createNewsBackoffFetch(async()=>limited(429,'0'),store,()=>start)('https://publisher.example/article');
  assert.equal(store.writes[0].value.blockedUntil,start+1000);
});

test('authentication and payment refusals receive at least one hour without hammering the publisher',async()=>{
  for(const status of [401,402,403]){
    const store=cache();let calls=0;
    const fetcher=createNewsBackoffFetch(async()=>{calls++;return limited(status,'30');},store,()=>start);
    assert.equal((await fetcher('https://publisher.example/article')).status,status);
    assert.equal((await fetcher('https://publisher.example/another')).headers.get('retry-after'),'3600');assert.equal(calls,1);
    const later=createNewsBackoffFetch(async()=>{calls++;return new Response('ok');},store,()=>start+900_000);
    const response=await later('https://publisher.example/next-refresh');
    assert.equal(response.status,status);assert.equal(response.headers.get('retry-after'),'2700');assert.equal(calls,1);
  }
});

test('an origin gate covers all its paths but does not block another publisher',async()=>{
  const store=cache(),calls=[];
  const fetcher=createNewsBackoffFetch(async input=>{calls.push(String(input));return String(input).includes('first.example')?limited():new Response('ok');},store,()=>start);
  await fetcher('https://first.example/a');assert.equal((await fetcher('https://first.example/b')).status,429);
  assert.equal((await fetcher('https://second.example/a')).status,200);assert.equal(calls.length,2);
  assert.equal(store.writes.length,1);assert.equal(store.writes[0].value.origin,'https://first.example');
  assert.ok(!JSON.stringify(store.writes).includes('/a'));
});

test('rapid same-origin calls queue behind the first refusal instead of issuing ten HTTP requests',async()=>{
  const store=cache();let calls=0,release,markStarted;
  const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{markStarted=resolve;});
  const fetcher=createNewsBackoffFetch(async()=>{calls++;markStarted();await gate;return limited();},store,()=>start);
  const requests=Array.from({length:10},(_,index)=>fetcher(`https://publisher.example/article-${index}`));
  await started;release();const responses=await Promise.all(requests);
  assert.equal(calls,1);assert.ok(responses.every(response=>response.status===429));assert.equal(store.writes.length,1);
});

test('different origins remain concurrent and successful responses are not incorrectly shared between articles',async()=>{
  const store=cache();let active=0,maximum=0;const calls=[];
  const fetcher=createNewsBackoffFetch(async input=>{calls.push(String(input));active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,10));active--;return new Response(String(input));},store,()=>start);
  const urls=['https://one.example/a','https://one.example/b','https://two.example/c'];
  const responses=await Promise.all(urls.map(url=>fetcher(url)));assert.deepEqual(await Promise.all(responses.map(response=>response.text())),urls);
  assert.equal(calls.length,3);assert.equal(maximum,2);
});

test('an aborted queued request cannot later contact the origin',async()=>{
  const store=cache();let calls=0,release,markStarted;
  const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{markStarted=resolve;});
  const fetcher=createNewsBackoffFetch(async()=>{calls++;markStarted();await gate;return new Response('ok');},store,()=>start);
  const first=fetcher('https://publisher.example/first');await started;
  const controller=new AbortController(),queued=fetcher('https://publisher.example/queued',{signal:controller.signal});controller.abort();
  await assert.rejects(queued,error=>error.name==='AbortError');release();await first;await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,1);
});

test('cache failure fails closed and an already known memory block stays enforced',async()=>{
  let calls=0,reads=0;const failing={read:async()=>{reads++;throw Error('cache unavailable');},write:async()=>{throw Error('cache unavailable');}};
  const fetcher=createNewsBackoffFetch(async()=>{calls++;return new Response('must not happen');},failing,()=>start);
  assert.equal((await fetcher('https://publisher.example/a')).status,503);assert.equal((await fetcher('https://publisher.example/b')).status,503);
  assert.equal(calls,0);assert.equal(reads,1);
  const store=cache(),known=createNewsBackoffFetch(async()=>{calls++;return limited();},store,()=>start);
  await known('https://known.example/a');store.read=async()=>{throw Error('later outage');};
  assert.equal((await known('https://known.example/b')).status,429);assert.equal(calls,1);
});

test('write failure does not erase the observed publisher backoff or expose a successful result',async()=>{
  let calls=0;const store={read:async()=>undefined,write:async()=>{throw Error('write failed');}};
  const fetcher=createNewsBackoffFetch(async()=>{calls++;return limited();},store,()=>start);
  assert.equal((await fetcher('https://publisher.example/a')).status,503);assert.equal((await fetcher('https://publisher.example/b')).status,429);assert.equal(calls,1);
});

test('unavailable or malformed shared gates cannot grant permission to fetch',async()=>{
  for(const value of [{private:'unexpected'}, {version:'news-origin-backoff-1',origin:'https://other.example',recordedAt:start,blockedUntil:start+60_000,status:429}]){
    let calls=0;const fetcher=createNewsBackoffFetch(async()=>{calls++;return new Response('no');},{read:async()=>value,write:async()=>{}},()=>start);
    assert.equal((await fetcher('https://publisher.example/a')).status,503);assert.equal(calls,0);
  }
});

test('cache reads and writes each have a finite500ms ceiling',async()=>{
  let calls=0;const never=()=>new Promise(()=>{}),began=performance.now();
  const read=createNewsBackoffFetch(async()=>{calls++;return new Response('no');},{read:never,write:async()=>{}},()=>start);
  assert.equal((await read('https://read.example/a')).status,503);assert.equal(calls,0);assert.ok(performance.now()-began<2000);
  const second=performance.now(),write=createNewsBackoffFetch(async()=>{calls++;return limited();},{read:async()=>undefined,write:never},()=>start);
  assert.equal((await write('https://write.example/a')).status,503);assert.equal(calls,1);assert.ok(performance.now()-second<2000);
});

test('the wrapper never sends a mutation or an unsafe outbound URL',async()=>{
  let calls=0;const fetcher=createNewsBackoffFetch(async()=>{calls++;return new Response('no');},cache(),()=>start);
  for(const url of ['http://publisher.example/a','https://user:pass@publisher.example/a','https://publisher.example:8443/a'])await assert.rejects(fetcher(url),/NEWS_BACKOFF_URL_INVALID/u);
  await assert.rejects(fetcher('https://publisher.example/a',{method:'POST',body:'private'}),/NEWS_BACKOFF_READ_ONLY/u);assert.equal(calls,0);
});
