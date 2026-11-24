import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {NewsContinuation,continuationItems} from '../.build/src/iceo/news-continuation.js';
import {NEWS_CATEGORIES} from '../.build/src/iceo/news-taxonomy.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {findCity} from '../.build/src/local/cities.js';
import {newsDayWindow} from '../.build/src/iceo/news-day.js';
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
 return {version:'dlkt-news-page-4',epoch:'101',revision:3,generatedAt:iso,startedAt:iso,expiresAt:new Date(now+900000).toISOString(),
  language:'en',cityId:null,countryCode:null,period:'recent',day:null,coverage:{national:0,local:0,international:total},filter:'all',items:Array.from({length:Math.min(20,total-offset)},(_,i)=>item(offset+i)),total,articleTotal:total,filteredTotal:total,counts,
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
 assert.equal(requests.every(request=>request.init.method==='GET'&&request.init.credentials==='omit'),true);
 assert.deepEqual(requests.map(request=>request.init.cache),['default','no-store']);
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
 let calls=0;const model=new NewsContinuation(async()=>{calls++;return calls===2?new Response('',{status:410}):response(page(0,calls>=3?20:60));},()=>now);
 await model.start(context);const prefix=[...model.view().items];await model.next();assert.equal(model.view().error,'expired');
 await model.next();assert.equal(calls,2);assert.deepEqual(model.view().items,prefix);
 await model.start(context,true);assert.equal(calls,3);assert.equal(model.view().error,null);assert.deepEqual(model.view().items,prefix);assert.equal(model.view().activeReceivedCount,20);
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

test('a country change starts a new edition and cannot reuse country coverage or a previous cursor',async()=>{
 const london=findCity('2643743'),torino=findCity('3165524');assert.ok(london);assert.ok(torino);
 const requests=[];const model=new NewsContinuation(async url=>{
  requests.push(new URL(url,'https://www.dlkt.ee'));
  const city=requests.at(-1).searchParams.get('city');
  return response(page(0,20,{cityId:city,countryCode:city===london.id?'GB':'IT',coverage:{national:city===london.id?20:0,local:0,international:city===london.id?0:20}}));
 },()=>now);
 await model.start({...context,cityId:london.id,city:london});
 assert.equal(model.view().error,null);assert.equal(model.view().page.coverage.national,20);
 await model.start({...context,cityId:torino.id,city:torino});
 assert.equal(model.view().error,null);assert.equal(model.view().page.countryCode,'IT');
 assert.equal(model.view().page.coverage.national,0);assert.equal(requests.length,2);
 assert.equal(requests[1].searchParams.has('cursor'),false);
});
test('country and full-edition coverage are immutable across continuation pages',async()=>{
 const london=findCity('2643743');assert.ok(london);
 const valid=offset=>page(offset,40,{cityId:london.id,countryCode:'GB',coverage:{national:40,local:0,international:0}});
 for(const bad of [
  {...valid(20),countryCode:'US'},
  {...valid(20),coverage:{national:20,local:0,international:20}}
 ]){
  let calls=0;const model=new NewsContinuation(async()=>response(calls++===0?valid(0):bad),()=>now);
  await model.start({...context,cityId:london.id,city:london});const prefix=[...model.view().items];
  assert.equal(model.view().error,null);await model.next();
  assert.equal(model.view().error,'invalid');assert.deepEqual(model.view().items,prefix);
 }
 const noCity=new NewsContinuation(async()=>response(valid(0)),()=>now);
 await noCity.start({...context,cityId:london.id});assert.equal(noCity.view().error,'invalid');
});

test('Today and Recent are separate contexts; changing period cancels the old request and resets the cursor',async()=>{
 const jobs=[];const model=new NewsContinuation((url,init)=>new Promise(resolve=>jobs.push({url,signal:init.signal,resolve})),()=>now);
 const today={...context,period:'today'},day=newsDayWindow(now);
 const pending=model.start(today);assert.equal(new URL(jobs[0].url,'https://www.dlkt.ee').searchParams.get('period'),'today');
 const changed=model.start({...context,period:'recent'});assert.equal(jobs[0].signal.aborted,true);
 assert.equal(new URL(jobs[1].url,'https://www.dlkt.ee').searchParams.has('cursor'),false);
 jobs[1].resolve(response(page(0,40)));await changed;
 jobs[0].resolve(response(page(0,20,{period:'today',day})));await pending;
 assert.equal(model.view().page.period,'recent');assert.equal(model.view().items.length,20);
 const next=model.next();assert.equal(new URL(jobs[2].url,'https://www.dlkt.ee').searchParams.get('cursor'),cursor(20));
 jobs[2].resolve(response(page(20,40)));await next;assert.equal(model.view().items.length,40);
 const reset=model.start(today);assert.equal(new URL(jobs[3].url,'https://www.dlkt.ee').searchParams.has('cursor'),false);
 jobs[3].resolve(response(page(0,20,{period:'today',day})));await reset;
 assert.equal(model.view().error,null);assert.equal(model.view().page.period,'today');assert.equal(model.view().items.length,20);
});
test('a mismatched period response cannot replace or append to the selected Today edition',async()=>{
 const today={...context,period:'today'},day=newsDayWindow(now);
 let calls=0;const model=new NewsContinuation(async()=>response(calls++===0?page(0,40,{period:'today',day}):page(20,40)),()=>now);
 await model.start(today);const prefix=[...model.view().items];assert.equal(model.view().error,null);
 await model.next();assert.equal(model.view().error,'invalid');assert.deepEqual(model.view().items,prefix);
});

/** Execute the compiled UI bindings and actual controller, not a copy of the refresh action. */
function continuationActions(model,selected){
 const reader=readFileSync('.build/src/iceo/browser.js','utf8');
 const actionStart=reader.indexOf('function refreshNewsEdition()'),clickStart=reader.indexOf("required('#discovery').addEventListener('click'",actionStart);
 const changeStart=reader.indexOf("required('#discovery').addEventListener('change'",clickStart);
 const header=reader.match(/required\('#discovery-refresh'\)\.addEventListener\('click', refreshNewsEdition\);/u)?.[0];
 const start=reader.indexOf('void newsContinuation.start('),end=reader.indexOf('const server =',start);
 const footerStart=reader.indexOf("const streamEnd = document.createElement('div');"),footerEnd=reader.indexOf('controls.replaceChildren(...streamEnd.childNodes);',footerStart);
 assert.ok(actionStart>=0&&clickStart>actionStart&&changeStart>clickStart&&header);
 assert.ok(start>=0&&end>start&&footerStart>=0&&footerEnd>footerStart);
 const beginEdition=reader.slice(start,end),footer=reader.slice(footerStart,footerEnd+'controls.replaceChildren(...streamEnd.childNodes);'.length);
 const listeners=new Map(),pending=[],accepted=[];let sourceChecks=0,localChecks=0;
 class Element {
  constructor(tag='button'){this.tag=tag;this.dataset={};this.childNodes=[];}
  append(...nodes){this.childNodes.push(...nodes);}
  replaceChildren(...nodes){this.childNodes=[...nodes];}
  closest(selector){return selector==='[data-news-restart]'&&this.dataset.newsRestart?this:selector==='[data-public-more]'&&this.dataset.publicMore?this:null;}
 }
 const controls=new Element('div');
 const environment={Element,language:selected.language,getLocale:()=>selected.language,newsInteractionRevision:0,announcement:{textContent:''},newsSourceScope:selected.sourceScope??'edition',newsFilter:selected.filter,newsPeriod:selected.period??'recent',
  contextualCity:selected.city??null,contextualLocalState:'loaded',restartNewsEdition:false,applyPublicUpdate:false,
  document:{visibilityState:'visible',body:{dataset:{entryView:'start'}},createElement:tag=>new Element(tag)},
  controls,make:(tag,_class,text)=>Object.assign(new Element(tag),{textContent:text}),
  required:selector=>({querySelectorAll:()=>[],addEventListener:(type,callback)=>listeners.set(selector+':'+type,callback),click:()=>{assert.equal(selector,'#refresh-local');localChecks++;}}),
  load:async()=>{sourceChecks++;},
  newsContinuation:{view:()=>model.view(),start:(...args)=>{const job=model.start(...args);pending.push(job);return job;},next:(...args)=>{const job=model.next(...args);pending.push(job);return job;}},
 };
 environment.renderDiscovery=()=>{accepted.push(environment.applyPublicUpdate);runInNewContext(beginEdition,environment);};
 runInNewContext(reader.slice(actionStart,changeStart)+'\n'+header,environment);
 return {
  clickFooter(){
   environment.server=model.view();environment.visible=model.view().items;environment.remainingCount=Math.max(0,(model.view().page?.filteredTotal??0)-model.view().activeReceivedCount);
   runInNewContext(footer,environment);
   const button=controls.childNodes.find(node=>node.tag==='button'&&(node.dataset.newsRestart==='true'||node.dataset.publicMore==='true'));
   assert.ok(button,'the actual terminal/expired UI offers the explicit update action');
   listeners.get('#discovery:click')({target:button});
  },
  clickHeader(){listeners.get('#discovery-refresh:click')();},
  automatic(){return environment.showNewsPage(false);},
  finish(){return Promise.all(pending);},
  checks:()=>({sourceChecks,localChecks,accepted}),
 };
}
test('header and footer updates keep the reading prefix while adopting a fresh cursor',async()=>{
 const city=findCity('683506');assert.ok(city);
 const selected={...context,cityId:city.id,city,period:'recent'};
 for(const trigger of ['exhausted footer','expired footer','header']){
  let time=now,release;
  const requests=[];
  const edition=(offset,total,extra={})=>page(offset,total,{cityId:city.id,countryCode:city.countryCode,...extra});
  const model=new NewsContinuation(async(url,init)=>{
   requests.push({url,init});
   if(requests.length<=2)return response(edition(requests.length===1?0:20,31));
   const updated={epoch:'102',revision:4,generatedAt:new Date(time).toISOString(),startedAt:new Date(time).toISOString(),expiresAt:new Date(time+900000).toISOString()};
   if(requests.length===3)return new Promise(resolve=>{release=()=>resolve(response(edition(0,40,updated)));});
   return response(edition(20,40,updated));
  },()=>time);
  await model.start(selected);await model.next();
  assert.equal(model.view().items.length,31);assert.equal(model.view().page.nextCursor,null);
  if(trigger==='expired footer'){time+=900001;assert.equal(model.view().error,'expired');}
  const actions=continuationActions(model,selected),before=[...model.view().items];
  await actions.automatic();
  assert.deepEqual(model.view().items,before,'automatic continuation cannot restart a completed or expired edition');
  assert.equal(requests.length,2);assert.deepEqual(actions.checks(),{sourceChecks:0,localChecks:0,accepted:[]});
  if(trigger==='header')actions.clickHeader();else actions.clickFooter();
  assert.equal(requests.length,3,trigger);assert.equal(model.view().loading,true);assert.deepEqual(model.view().items,before);
  assert.equal(actions.checks().sourceChecks,trigger==='expired footer'?0:1);assert.equal(actions.checks().localChecks,trigger==='expired footer'?0:1);
  if(trigger!=='expired footer')assert.equal(actions.checks().accepted[0],true);
  const query=new URL(requests[2].url,'https://www.dlkt.ee').searchParams;
  assert.equal(query.has('cursor'),false);assert.equal(query.get('lang'),selected.language);
  assert.equal(query.get('city'),city.id);assert.equal(query.get('category'),'all');assert.equal(query.get('period'),'recent');
  assert.equal(requests[2].init.credentials,'omit');assert.equal(requests[2].init.cache,'no-store');
  release();await actions.finish();
  assert.equal(model.view().page.epoch,'102');assert.equal(model.view().items.length,40);assert.equal(model.view().error,null);
  assert.deepEqual(model.view().items.slice(0,before.length),before);assert.equal(model.view().activeReceivedCount,40);assert.equal(requests.length,4);
 }
});

test('source scope changes cancel pending requests and cannot reuse a previous cursor or late page',async()=>{
 const jobs=[],model=new NewsContinuation((url,init)=>new Promise(resolve=>jobs.push({url:new URL(url,'https://www.dlkt.ee'),signal:init.signal,resolve})),()=>now);
 const first=model.start({...context,sourceScope:'all'});
 assert.equal(jobs[0].url.searchParams.get('sourceScope'),'all');
 const selected=model.start({...context,sourceScope:'edition'});
 assert.equal(jobs[0].signal.aborted,true);assert.equal(jobs[1].url.searchParams.has('cursor'),false);
 jobs[1].resolve(response(page(0,40,{sourceScope:'edition'})));await selected;
 jobs[0].resolve(response(page(0,60,{sourceScope:'all'})));await first;
 assert.equal(model.view().page.sourceScope,'edition');assert.equal(model.view().page.total,40);
 const again=model.start({...context,sourceScope:'all'});
 assert.equal(jobs[2].url.searchParams.has('cursor'),false);
 jobs[2].resolve(response(page(0,40,{sourceScope:'all'})));await again;
 const prefix=[...model.view().items],next=model.next();
 assert.equal(jobs[3].url.searchParams.get('sourceScope'),'all');assert.equal(jobs[3].url.searchParams.get('cursor'),cursor(20));
 jobs[3].resolve(response(page(20,40,{sourceScope:'all'})));await next;
 assert.deepEqual(model.view().items.slice(0,20),prefix);assert.equal(model.view().items.length,40);
});

test('scope defaults are edition-compatible and explicit all never accepts an edition response',async()=>{
 for(const [sourceScope,returnedScope] of [['all',undefined],['all','edition'],['edition','all']]){
  const changed=returnedScope===undefined?{}:{sourceScope:returnedScope};
  const first=new NewsContinuation(async()=>response(page(0,20,changed)),()=>now);
  await first.start({...context,sourceScope});assert.equal(first.view().error,'invalid');assert.equal(first.view().items.length,0);
  let calls=0;
  const append=new NewsContinuation(async()=>response(calls++===0?page(0,40,{sourceScope}):page(20,40,changed)),()=>now);
  await append.start({...context,sourceScope});const prefix=[...append.view().items];assert.equal(append.view().error,null);
  await append.next();assert.equal(append.view().error,'invalid');assert.deepEqual(append.view().items,prefix);
 }
 const queries=[],legacy=new NewsContinuation(async url=>{queries.push(new URL(url,'https://www.dlkt.ee'));return response(page(0,20));},()=>now);
 await legacy.start(context);assert.equal(legacy.view().error,null);assert.equal(queries[0].searchParams.get('sourceScope'),'edition');
 await legacy.start({...context,sourceScope:'edition'});assert.equal(queries.length,1,'missing scope and explicit edition share the compatible context');
});

test('category changes and explicit refresh preserve all scope while resetting their page identity',async()=>{
 const queries=[],model=new NewsContinuation(async url=>{
  const query=new URL(url,'https://www.dlkt.ee').searchParams;queries.push(query);
  return response(page(0,20,{sourceScope:query.get('sourceScope'),filter:query.get('category'),epoch:String(100+queries.length)}));
 },()=>now);
 const selected={...context,sourceScope:'all'};
 await model.start(selected);assert.equal(model.view().error,null);assert.equal(model.view().page.epoch,'101');
 await model.start({...selected,filter:'04000000'});assert.equal(model.view().error,null);assert.equal(model.view().page.epoch,'102');
 await model.start({...selected,filter:'04000000'},true);assert.equal(model.view().error,null);assert.equal(model.view().page.epoch,'103');
 assert.equal(queries.length,3);assert.ok(queries.every(query=>query.get('sourceScope')==='all'&&!query.has('cursor')));
 assert.equal(model.view().items.length,20);
});
