import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NewsContinuation,continuationItems} from '../.build/src/iceo/news-continuation.js';
import {NEWS_CATEGORIES} from '../.build/src/iceo/news-taxonomy.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
const now=Date.parse('2026-11-22T20:00:00.000Z'),iso=new Date(now).toISOString();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const context={language:'en',cityId:null,filter:'all'};
const cursor=n=>'page'+n+'.'+'a'.repeat(43);
function item(index){
 const url='https://www.theguardian.com/business/2026/nov/22/company-'+index;
 const card={identity:url,title:'Company '+index+' reports annual profits',sourceUrl:url,date:new Date(now-60000).toISOString(),dateLabel:'Published',
  publisher:'The Guardian',deadline:null,version:null,id:hash(url).slice(0,24),topic:'business',kind:'publication',sourceIds:['news-business'],
  observedAt:iso,contentHash:'',boundary:'Publisher reporting.',attribution:'Source: The Guardian.',sourceState:'verified'};
 card.contentHash=hash(cardContent(card));
 return {kind:'global',key:'article:'+card.id,category:'04000000',card};
}
function page(offset=0,total=60,overrides={}){
 const counts=Object.fromEntries(['other',...NEWS_CATEGORIES.map(c=>c.id)].map(id=>[id,id==='04000000'?total:0]));
 return {version:'dlkt-news-page-1',epoch:'101',revision:3,generatedAt:iso,startedAt:iso,expiresAt:new Date(now+900000).toISOString(),
  language:'en',cityId:null,filter:'all',items:Array.from({length:Math.min(20,total-offset)},(_,i)=>item(offset+i)),total,filteredTotal:total,counts,
  nextCursor:offset+20<total?cursor(offset+20):null,...overrides};
}
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
test('receiver-sensitive browser fetch is called without binding the news controller',async()=>{
 const requests=[],receivers=[];
 const fetcher=async function(url,init){
  receivers.push(this);
  if(this!==undefined&&this!==globalThis)throw new TypeError('Illegal invocation');
  requests.push({url,init});return response(page((requests.length-1)*20,40));
 };
 const model=new NewsContinuation(fetcher,()=>now);
 await model.start(context);
 assert.equal(model.view().error,null);assert.equal(model.view().items.length,20);
 const prefix=[...model.view().items];
 await model.next();
 assert.equal(model.view().error,null);assert.equal(model.view().items.length,40);
 assert.deepEqual(model.view().items.slice(0,20),prefix);
 assert.equal(requests.length,2);assert.deepEqual(receivers,[undefined,undefined]);
 assert.equal(new URL(requests[1].url,'https://www.dlkt.ee').searchParams.get('cursor'),cursor(20));
 assert.equal(requests.every(request=>request.init.method==='GET'&&request.init.credentials==='omit'&&request.init.cache==='no-store'),true);
});
test('three server pages preserve the exact prefix and fetch continuation only on demand',async()=>{
 const requests=[];const model=new NewsContinuation(async(url,init)=>{requests.push({url,init});return response(page((requests.length-1)*20));},()=>now);
 await model.start(context);const first=[...model.view().items];
 assert.equal(first.length,20);assert.equal(requests.length,1);
 await model.start(context);assert.equal(requests.length,1);
 await model.next();assert.deepEqual(model.view().items.slice(0,20),first);
 await model.next();assert.equal(model.view().items.length,60);assert.equal(model.view().error,null);
 assert.deepEqual(continuationItems(model.view().items,now).map(v=>v.key),model.view().items.map(v=>v.key));
 assert.equal(new URL(requests[1].url,'https://www.dlkt.ee').searchParams.get('cursor'),cursor(20));
 assert.equal(new URL(requests[1].url,'https://www.dlkt.ee').searchParams.get('lang'),'en');
 assert.equal(requests.every(r=>r.init.credentials==='omit'),true);
 await model.next();assert.equal(requests.length,3);
});
test('a network failure keeps the page and retries the same cursor without duplicates',async()=>{
 const requests=[];const model=new NewsContinuation(async url=>{
  requests.push(url);if(requests.length===2)return new Response('',{status:503});
  return response(page(requests.length===1?0:20,40));
 },()=>now);
 await model.start(context);const prefix=[...model.view().items];await model.next();
 assert.equal(model.view().error,'unavailable');assert.deepEqual(model.view().items,prefix);
 await model.next();assert.equal(model.view().error,null);assert.equal(model.view().items.length,40);
 assert.equal(requests[1],requests[2]);assert.deepEqual(model.view().items.slice(0,20),prefix);
});
test('context changes and explicit restarts cancel old requests and ignore their late responses',async()=>{
 const jobs=[];const model=new NewsContinuation((url,init)=>new Promise(resolve=>jobs.push({url,signal:init.signal,resolve})),()=>now);
 const first=model.start(context);const changed=model.start({language:'ro',cityId:null,filter:'all'});
 assert.equal(jobs[0].signal.aborted,true);
 jobs[1].resolve(response(page(0,0,{language:'ro'})));await changed;
 jobs[0].resolve(response(page()));await first;
 assert.equal(model.view().page.language,'ro');assert.equal(model.view().items.length,0);
 const started=model.start(context);assert.equal(jobs.length,3);
 const restarted=model.start(context,true);assert.equal(jobs[2].signal.aborted,true);assert.equal(jobs.length,4);
 jobs[3].resolve(response(page(0,20,{epoch:'102',revision:4})));await restarted;
 jobs[2].resolve(response(page()));await started;
 assert.equal(model.view().page.epoch,'102');assert.equal(model.view().items.length,20);
});
test('an expired cursor preserves the displayed edition until an explicit restart',async()=>{
 let calls=0;const model=new NewsContinuation(async()=>{calls++;return calls===2?new Response('',{status:410}):response(page());},()=>now);
 await model.start(context);const prefix=[...model.view().items];await model.next();assert.equal(model.view().error,'expired');
 await model.next();assert.equal(calls,2);assert.deepEqual(model.view().items,prefix);
 await model.start(context,true);assert.equal(calls,3);assert.equal(model.view().error,null);
});
test('mixed editions, changed context and duplicate pages fail closed without discarding the prefix',async()=>{
 for(const bad of [page(20,60,{epoch:'102'}),page(20,60,{startedAt:new Date(now+1000).toISOString()}),
   page(20,60,{filter:'04000000'}),page(0,60,{nextCursor:cursor(40)})]){
  let calls=0;const model=new NewsContinuation(async()=>response(calls++===0?page():bad),()=>now);
  await model.start(context);const prefix=[...model.view().items];await model.next();
  assert.equal(model.view().error,'invalid');assert.deepEqual(model.view().items,prefix);
 }
});
test('oversized and private-field responses are rejected before any card is rendered',async()=>{
 for(const result of [new Response('{}',{headers:{'content-type':'application/json','content-length':'1048577'}}),
  response({...page(),writerKey:'private'})]){
  const model=new NewsContinuation(async()=>result,()=>now);await model.start(context);
  assert.equal(model.view().error,'invalid');assert.equal(model.view().items.length,0);
 }
});
