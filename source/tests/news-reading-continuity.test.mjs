import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {NewsContinuation,NEWS_READING_MAX_ITEMS,NEWS_REFRESH_MAX_PAGES} from '../.build/src/iceo/news-continuation.js';
import {NewsContinuation as BrowserContinuation} from '../public/news-continuation.js';
import {NewsPageService,parseNewsPageRequest} from '../.build/src/iceo/news-page.js';
import {validNewsPage,newsOriginalLanguage} from '../.build/src/iceo/news-page-contracts.js';
import {createNewsStorySourcesState} from '../.build/src/iceo/news-story-browser.js';
import {cardContent,safeLink} from '../.build/src/iceo/card-validation.js';
import {pressReviewCitation} from '../.build/src/iceo/source-links.js';
import {storyThreadKey} from '../.build/src/iceo/story-grouping.js';
import {NEWS_CATEGORIES} from '../.build/src/iceo/news-taxonomy.js';
import {findCity} from '../.build/src/local/cities.js';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {selectInlineKnowledge} from '../.build/src/iceo/knowledge-stream.js';
import {article,epoch,CorpusMemoryStore,hash} from './fixtures/news-corpus.mjs';

const NOW=Date.parse('2026-11-23T22:00:00.000Z'),iso=value=>new Date(value).toISOString();
const context={language:'en',sourceScope:'all',cityId:null,filter:'all',period:'recent'};
const KEY='reading-continuity-test-writer-key-'.repeat(3);
const token=offset=>'controlled'+offset+'.'+'a'.repeat(43);
const reply=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function entry(id,now=NOW,extra={}){
 const card={...article(id,{now,category:'04000000',published:now-60_000}),...extra};
 card.contentHash=hash(cardContent(card));
 return {kind:'global',key:'article:'+card.id,category:'04000000',card};
}
function page(offset=0,total=60,extra={}){
 const counts=Object.fromEntries(['other',...NEWS_CATEGORIES.map(category=>category.id)].map(id=>[id,id==='04000000'?total:0]));
 return {version:'dlkt-news-page-4',epoch:'1',revision:1,generatedAt:iso(NOW),startedAt:iso(NOW),expiresAt:iso(NOW+900_000),
  ...context,countryCode:null,day:null,coverage:{national:0,local:0,international:total},items:Array.from({length:Math.min(20,total-offset)},(_,index)=>entry(index+offset)),
  total,articleTotal:total,filteredTotal:total,counts,nextCursor:offset+20<total?token(offset+20):null,...extra};
}
const offsetOf=url=>Number(new URL(url,'https://www.dlkt.ee').searchParams.get('cursor')?.match(/^controlled(\d+)\./u)?.[1]??0);
const browserSource=()=>readFileSync('.build/src/iceo/browser.js','utf8');

// Only observed headline/canonical metadata is reused; source checks and fixture clocks are controlled.
const observed=[
 {publisher:'Digi24',sourceUrl:'https://www.digi24.ro/stiri/externe/mapamond/o-cantareata-iraniana-si-membrii-trupei-sale-au-primit-74-de-lovituri-de-bici-din-cauza-unui-concert-pe-youtube-4049697',
  title:'O cântăreaţă iraniană şi membrii trupei sale au primit 74 de lovituri de bici din cauza unui concert pe YouTube',date:'2026-11-23T17:01:19.000Z'},
 {publisher:'HotNews.ro',sourceUrl:'https://hotnews.ro/o-cantareata-iraniana-si-membrii-trupei-sale-pedepsiti-cu-74-de-lovituri-de-bici-pentru-un-concert-2412112',
  title:'O cântăreață iraniană și membrii trupei sale, pedepsiți cu 74 de lovituri de bici pentru un concert - HotNews.ro',date:'2026-11-23T20:25:10.000Z'},
 {publisher:'Știrile ProTV',sourceUrl:'https://stirileprotv.ro/stiri/international/o-cantareata-iraniana-a-fost-pedepsita-cu-74-de-lovituri-de-bici-pentru-un-concert-fara-valul-islamic-video.html',
  title:'O cântăreață iraniană a fost pedepsită cu 74 de lovituri de bici pentru un concert fără vălul islamic. VIDEO',date:'2026-11-23T20:17:36.000Z'},
];
function report(index,observedAt=NOW,extra={}){
 const item=observed[index],card={...article(index+500,{now:NOW}),...item,topic:'culture',sourceIds:['news-culture'],observedAt:iso(observedAt),...extra};
 card.id=hash(card.sourceUrl).slice(0,24);card.identity=card.sourceUrl;card.attribution='Source: '+card.publisher+'. Open the original publication.';
 card.contentHash=hash(cardContent(card));return card;
}
function actualReader(cards,{now=NOW,Controller=NewsContinuation}={}){
 let clock=now,revision=1;
 const store=new CorpusMemoryStore([epoch(cards,[],{now,id:'1',revision})]),service=new NewsPageService(store,KEY,()=>clock),requests=[];
 const model=new Controller(async(url,init)=>{
  requests.push({url,init});
  try{return reply(await service.read(parseNewsPageRequest(new URL(url,'https://www.dlkt.ee'))));}
  catch(error){return new Response('',{status:/NEWS_EDITION_EXPIRED/u.test(error.message)?410:503});}
 },()=>clock);
 return {model,requests,store,setTime:value=>{clock=value;},publish(next,at=clock){
  clock=at;revision++;const id=String(revision);store.epochs.set(id,epoch(next,[],{now:clock,id,revision}));store.latest=id;
 }};
}

test('refresh retains the exact prefix, uses no-store and validates changed totals against only the new edition',async()=>{
 for(const Controller of [NewsContinuation,BrowserContinuation]){
  let edition=1;const requests=[];
  const model=new Controller(async(url,init)=>{
   requests.push({url,init});
   if(edition===1)return reply(page(0,20));
   const changed=entry(0,NOW+2000,{title:'Inflation report corrects the earlier price changes'});
   return reply(page(0,2,{epoch:'2',revision:2,generatedAt:iso(NOW+2000),startedAt:iso(NOW+2000),expiresAt:iso(NOW+902000),items:[changed,entry(999,NOW+2000)]}));
  },()=>NOW+2000);
  await model.start(context);const prefix=[...model.view().items],original=JSON.stringify(prefix),receipt=model.editionFor(prefix[0].key);
  edition=2;await model.start(context,true);
  assert.equal(model.view().error,null);assert.equal(model.view().items.length,21);
  assert.deepEqual(model.view().items.slice(0,20),prefix);assert.equal(JSON.stringify(prefix),original);
  assert.equal(model.view().activeReceivedCount,2);assert.equal(model.view().page.filteredTotal,2);assert.equal(model.view().retainedCount,20);
  assert.strictEqual(model.editionFor(prefix[0].key),receipt);assert.equal(receipt.epoch,'1');assert.deepEqual(receipt.items,[]);
  assert.equal(model.editionFor(model.view().items[20].key).epoch,'2');
  assert.equal(model.view().items[0].card.observedAt,iso(NOW),'old source checks are never restamped by a changed report');
  assert.equal(model.view().items[0].card.title,prefix[0].card.title,'material wording is retained as the earlier reading, not silently rewritten');
  assert.equal(requests[1].init.cache,'no-store');assert.equal(new URL(requests[1].url,'https://www.dlkt.ee').searchParams.has('cursor'),false);
 }
});

test('one original from the same reported event cannot reappear after a different singleton publisher',async()=>{
 for(const Controller of [NewsContinuation,BrowserContinuation]){
  const first=report(0),second=report(2,NOW+2000);assert.equal(storyThreadKey(first),storyThreadKey(second));
  const reading=actualReader([first],{Controller}),selected={...context,language:'ro'};
  await reading.model.start(selected);const prefix=[...reading.model.view().items];assert.equal(prefix.length,1);assert.equal(prefix[0].story,undefined);
  reading.publish([second],NOW+2000);await reading.model.start(selected,true);
  assert.equal(reading.model.view().error,null);assert.deepEqual(reading.model.view().items,prefix);assert.equal(reading.model.view().activeReceivedCount,1);
  const separate=report(2,NOW+4000,{sourceUrl:'https://stirileprotv.ro/stiri/international/controlled-different-penalty.html',title:observed[2].title.replace('74','75')});
  reading.publish([second,separate],NOW+4000);await reading.model.start(selected,true);
  assert.equal(reading.model.view().items.length,2);assert.equal(reading.model.view().items[1].card.title,separate.title,'different explicit penalty stays a distinct event');
 }
});

test('three originals becoming one keep the original expired source context and all previously shown links',async()=>{
 const originals=observed.map((_,index)=>report(index,NOW-3_599_000)),reading=actualReader(originals),selected={...context,language:'ro'};
 await reading.model.start(selected);const first=reading.model.view().items[0],receipt=reading.model.editionFor(first.key);
 assert.equal(reading.model.view().error,null);assert.equal(reading.model.view().items.length,1);assert.equal(first.story.sourceTotal,3);
 assert.equal(receipt.expiresAt,iso(NOW+1000));
 const replacement=originals.find(card=>card.id!==first.card.id);assert.ok(replacement);
 reading.publish([{...replacement,observedAt:iso(NOW+2000)}].map(card=>({...card,contentHash:hash(cardContent(card))})),NOW+2000);
 await reading.model.start(selected,true);assert.equal(reading.model.view().error,null);
 assert.strictEqual(reading.model.view().items[0],first);assert.equal(reading.model.view().items.length,1);
 assert.strictEqual(reading.model.editionFor(first.key),receipt);assert.equal(receipt.epoch,'1');assert.equal(reading.model.view().page.epoch,'2');
 assert.equal(createNewsStorySourcesState(first,receipt,NOW+2000),null,'an old source cursor does not inherit the new expiry');
 const source=browserSource(),start=source.indexOf('function retainedNewsSourcesNode('),end=source.indexOf('function renderDiscovery()',start);assert.ok(start>=0&&end>start);
 class Element{
  constructor(tag){this.tag=tag;this.dataset={};this.children=[];this.attributes={};this.textContent='';}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(name,value){this.attributes[name]=value;}
 }
 const environment={item:first,page:receipt,language:'ro',Intl,Date:class extends Date{static now(){return NOW+2000;}},safeLink,pressReviewCitation,newsOriginalLanguage,
  tr:()=> 'Surse',document:{createElement:tag=>new Element(tag),createTextNode:text=>({tag:'#text',textContent:text})},
  make:(tag,className,text)=>Object.assign(new Element(tag),{className,textContent:text})};
 runInNewContext(source.slice(start,end)+'\nthis.result=retainedNewsSourcesNode(item,page,language);',environment);
 const flatten=node=>[node,...(node.children??[]).flatMap(flatten)],nodes=flatten(environment.result),links=nodes.filter(node=>node.tag==='a'),dates=nodes.filter(node=>node.tag==='time');
 assert.equal(links.length,3);assert.deepEqual(new Set(links.map(link=>link.href)),new Set(originals.map(card=>card.sourceUrl)));
 assert.deepEqual(new Set(links.map(link=>link.textContent)),new Set(originals.map(card=>card.title)));
 assert.deepEqual(new Set(dates.map(date=>date.dateTime)),new Set(originals.map(card=>card.date)));
 assert.equal(nodes.some(node=>node.tag==='button'),false,'reconstructed historical links never fetch an expired cursor');
 assert.ok(nodes.some(node=>/a expirat/u.test(node.textContent??'')));
});

test('refresh scans at most three duplicate pages and continues only from the new edition cursor',async()=>{
 let edition=1;const requests=[];
 const model=new NewsContinuation(async(url,init)=>{requests.push({url,init});return reply(page(offsetOf(url),edition===1?80:100,{epoch:String(edition),revision:edition}));},()=>NOW);
 await model.start(context);for(let index=0;index<3;index++)await model.next();
 const prefix=[...model.view().items];assert.equal(prefix.length,80);const before=requests.length;
 edition=2;await model.start(context,true);
 assert.equal(requests.length-before,NEWS_REFRESH_MAX_PAGES);assert.equal(model.view().activeReceivedCount,60);
 assert.equal(model.view().manualContinuation,true);assert.deepEqual(model.view().items,prefix);assert.equal(model.view().canContinue,true);
 assert.deepEqual(requests.slice(before).map(request=>offsetOf(request.url)),[0,20,40]);
 const paused=requests.length;await model.start(context);assert.equal(requests.length,paused,'rendering does not restart an already initialized context');
 await model.next();assert.equal(requests.length-paused,2);assert.equal(model.view().items.length,100);
 assert.deepEqual(model.view().items.slice(0,80),prefix);assert.equal(model.view().activeReceivedCount,100);assert.equal(model.view().manualContinuation,false);
});

test('a failed page after a duplicate-only first page retries its new cursor and preserves old cards',async()=>{
 let edition=1,fail=true;const requests=[];
 const model=new NewsContinuation(async(url,init)=>{
  requests.push({url,init});const offset=offsetOf(url);
  if(edition===2&&offset===20&&fail){fail=false;return new Response('',{status:503});}
  return reply(page(offset,40,{epoch:String(edition),revision:edition}));
 },()=>NOW);
 await model.start(context);const prefix=[...model.view().items];edition=2;await model.start(context,true);
 assert.equal(model.view().error,'unavailable');assert.equal(model.view().activeReceivedCount,20);assert.deepEqual(model.view().items,prefix);
 const failed=requests.at(-1).url;await model.next();
 assert.equal(requests.at(-1).url,failed);assert.equal(model.view().error,null);assert.equal(model.view().items.length,40);assert.deepEqual(model.view().items.slice(0,20),prefix);
});

test('a refresh failure after an exhausted edition remains retryable through the actual browser action',async()=>{
 let fail=false,edition=1;const requests=[];
 const model=new NewsContinuation(async(url,init)=>{
  requests.push({url,init});if(fail){fail=false;return new Response('',{status:503});}
  return reply(page(0,1,{epoch:String(edition),revision:edition,items:[entry(edition)]}));
 },()=>NOW);
 await model.start(context);const prefix=[...model.view().items];edition=2;fail=true;await model.start(context,true);
 assert.equal(model.view().error,'unavailable');assert.equal(model.view().page.nextCursor,null);assert.equal(model.view().activeReceivedCount,0);assert.equal(model.view().canContinue,true);
 const source=browserSource(),start=source.indexOf('async function showNewsPage('),end=source.indexOf("required('#discovery').addEventListener('click'",start);assert.ok(start>=0&&end>start);
 const environment={document:{visibilityState:'visible',body:{dataset:{entryView:'start'}}},newsContinuation:model,newsSourceScope:'all',newsFilter:'all',newsPeriod:'recent',
  getLocale:()=> 'en',contextualCity:null,newsInteractionRevision:0,announcement:{textContent:''},required:()=>({querySelectorAll:()=>[]}),renderDiscovery(){}};
 runInNewContext(source.slice(start,end)+'\nthis.work=showNewsPage(true);',environment);await environment.work;
 assert.equal(model.view().error,null);assert.equal(model.view().items.length,2);assert.deepEqual(model.view().items.slice(0,1),prefix);
 assert.ok(environment.announcement.textContent.length>0,'the real focused continuation announces its completed reading');
 assert.equal(requests.at(-1).init.cache,'no-store');
});

test('a locally expired cursor recovers once in the same action without requesting the stale cursor',async()=>{
 let time=NOW,edition=1;const requests=[];
 const model=new NewsContinuation(async(url,init)=>{
  requests.push({url,init});
  return reply(page(offsetOf(url),40,{epoch:String(edition),revision:edition,generatedAt:iso(time),startedAt:iso(time),expiresAt:iso(time+(edition===1?1000:900000))}));
 },()=>time);
 await model.start(context);const prefix=[...model.view().items];time+=2000;edition=2;assert.equal(model.view().error,'expired');
 const before=requests.length;await model.next(true);
 assert.equal(requests.length-before,2);assert.deepEqual(requests.slice(before).map(request=>offsetOf(request.url)),[0,20]);
 assert.equal(new URL(requests[before].url,'https://www.dlkt.ee').searchParams.has('cursor'),false);
 assert.equal(model.view().error,null);assert.equal(model.view().items.length,40);assert.deepEqual(model.view().items.slice(0,20),prefix);
 assert.ok(requests.slice(before).every(request=>request.init.cache==='no-store'));
});

test('a second expiry stops one recovery and cannot cause an automatic request loop',async()=>{
 let calls=0;
 const model=new NewsContinuation(async()=>{calls++;return calls===1?reply(page()):new Response('',{status:410});},()=>NOW);
 await model.start(context);const prefix=[...model.view().items];await model.next(true);
 assert.equal(calls,3,'one stale continuation and one fresh attempt only');assert.equal(model.view().error,'expired');
 assert.equal(model.view().manualContinuation,true);assert.deepEqual(model.view().items,prefix);
 const source=browserSource(),start=source.indexOf('if (sentinel &&'),end=source.indexOf('const publicationState',start);assert.ok(start>=0&&end>start);
 let observed=0;const environment={sentinel:{},server:model.view(),observeNewsStream(){observed++;return()=>{};},showNewsPage(){throw Error('Unexpected automatic retry');}};
 runInNewContext(source.slice(start,end),environment);assert.equal(observed,0);
 await model.next();assert.equal(calls,3,'ordinary next cannot silently renew an expired cursor');
});

test('a late aborted response cannot append cards or poison the new reading deduplication keys',async()=>{
 const jobs=[];let immediate=true;
 const model=new NewsContinuation((url,init)=>{
  if(immediate){immediate=false;return Promise.resolve(reply(page(0,1)));}
  return new Promise(resolve=>jobs.push({url,init,resolve}));
 },()=>NOW);
 await model.start(context);const prefix=[...model.view().items];
 const older=model.start(context,true),newer=model.start(context,true);assert.equal(jobs[0].init.signal.aborted,true);
 jobs[1].resolve(reply(page(0,1,{epoch:'3',revision:3,items:[entry(2)]})));await newer;
 jobs[0].resolve(reply(page(0,1,{epoch:'2',revision:2,items:[entry(999)]})));await older;
 assert.equal(model.view().page.epoch,'3');assert.equal(model.view().items.length,2);assert.deepEqual(model.view().items.slice(0,1),prefix);
 const fresh=model.start(context,true);jobs[2].resolve(reply(page(0,1,{epoch:'4',revision:4,items:[entry(999)]})));await fresh;
 assert.equal(model.view().items.length,3,'the rejected late item remained unseen');assert.equal(model.view().items[2].card.id,entry(999).card.id);
});

test('Today crossing local midnight keeps the previous day only as explicitly retained reading',async()=>{
 const city=findCity('683506');assert.ok(city);
 const before=Date.parse('2026-11-23T21:59:59.000Z'),first=article(800,{now:before,language:'ro',published:before-5000});
 const reading=actualReader([first],{now:before}),selected={...context,language:'ro',cityId:city.id,city,period:'today'};
 await reading.model.start(selected);const old=reading.model.view().items[0];assert.ok(old);
 const receipt=reading.model.editionFor(old.key);assert.equal(receipt.day.date,'2026-11-23');
 const after=before+2000;reading.publish([article(801,{now:after,language:'ro',published:after-500})],after);await reading.model.start(selected,true);
 assert.equal(reading.model.view().error,null);assert.equal(reading.model.view().items.length,2);assert.strictEqual(reading.model.view().items[0],old);
 assert.equal(reading.model.view().retainedCount,1);assert.equal(reading.model.view().activeReceivedCount,1);
 assert.equal(reading.model.view().page.day.date,'2026-11-24');assert.equal(reading.model.editionFor(old.key).day.date,'2026-11-23');
 const source=browserSource(),start=source.indexOf('const progressCopy ='),end=source.indexOf('if (progress.textContent',start);
 const environment={server:reading.model.view(),visible:reading.model.view().items,topCount:1,language:'ro',format:new Intl.NumberFormat('ro')};
 runInNewContext(source.slice(start,end)+'\nthis.copy=progressCopy;',environment);
 assert.match(environment.copy,/2 subiecte in lectura.*1 din 1.*editia curenta/u);
 assert.match(source,/Lectura pastrata.*Verificarile originale raman neschimbate/u);
});

test('an unseen calendar fact is revalidated after midnight while a displayed fact keeps its original copy',()=>{
 const prototype=KNOWLEDGE_CARDS.find(card=>card.format==='on-this-day');assert.ok(prototype);
 const card={...prototype,id:'controlled-calendar-continuity',calendarDay:'11-23',geography:undefined,reviewedAt:'2026-11-22T00:00:00.000Z',reviewBy:'2026-11-25T00:00:00.000Z'};
 const source=browserSource(),start=source.indexOf("if (entry.kind === 'knowledge')"),end=source.indexOf('const item = entry.item',start);assert.ok(start>=0&&end>start);
 const block='for(const entry of entries){'+source.slice(start,end)+'}';
 const draw=(now,seen)=>{
  const shown=[],writes=[],environment={entries:[{kind:'knowledge',item:{card,scope:'global'}}],now,inlineKnowledgeSeen:new Set(seen),
   inlinePage:{cityId:null,countryCode:null,day:{timeZone:'UTC'}},Intl,Date,selectInlineKnowledge,
   document:{body:{dataset:{}}},host:{append:value=>shown.push(value)},knowledgeCardNode:record=>record,writeKnowledgeSeen:value=>writes.push([...value])};
  runInNewContext(block,environment);return {shown,writes};
 };
 const before=draw(Date.parse('2026-11-23T23:59:59Z'),[]);assert.equal(before.shown.length,1);assert.equal(before.writes.length,1);
 const unseen=draw(Date.parse('2026-11-24T00:00:01Z'),[]);assert.equal(unseen.shown.length,0);assert.equal(unseen.writes.length,0);
 const retained=draw(Date.parse('2026-11-24T00:00:01Z'),[card.id]);assert.equal(retained.shown.length,1);assert.strictEqual(retained.shown[0],card);assert.equal(retained.writes.length,0);
 const expired=draw(Date.parse(card.reviewBy),[card.id]);assert.equal(expired.shown.length,0,'the source review boundary is never extended');
});

test('context changes reset seen identities and original source receipts normally',async()=>{
 const model=new NewsContinuation(async url=>{
  const query=new URL(url,'https://www.dlkt.ee').searchParams;
  return reply(page(0,1,{language:query.get('lang'),sourceScope:query.get('sourceScope'),filter:query.get('category')}));
 },()=>NOW);
 await model.start(context);const first=model.view().items[0];await model.start(context,true);assert.equal(model.view().items.length,1);assert.equal(model.view().retainedCount,1);
 await model.start({...context,filter:'04000000'});
 assert.equal(model.view().error,null);assert.equal(model.view().items.length,1);assert.equal(model.view().retainedCount,0);
 assert.equal(model.editionFor(first.key).filter,'04000000');
});

test('the bounded reading stops at one corpus limit and only an explicit reset discards its memory',async()=>{
 const requests=[];
 const model=new NewsContinuation(async(url,init)=>{requests.push({url,init});return reply(page(offsetOf(url),NEWS_READING_MAX_ITEMS));},()=>NOW);
 await model.start(context);
 for(let index=1;index<NEWS_READING_MAX_ITEMS/20;index++)await model.next();
 assert.equal(model.view().error,null);assert.equal(model.view().items.length,NEWS_READING_MAX_ITEMS);assert.equal(model.view().limitReached,true);
 const before=requests.length,prefix=model.view().items;
 await model.next(true);await model.start(context,true);assert.equal(requests.length,before);assert.strictEqual(model.view().items,prefix);
 await model.reset();assert.equal(model.view().error,null);assert.equal(model.view().items.length,20);assert.equal(model.view().retainedCount,0);assert.equal(model.view().limitReached,false);
 assert.equal(requests.length,before+1);assert.equal(requests.at(-1).init.cache,'no-store');
});

test('all-sources location copy names the context country without describing the whole feed as national',()=>{
 const source=browserSource(),start=source.indexOf("required('#home-location').textContent ="),end=source.indexOf('const discoveryDelay',start);assert.ok(start>=0&&end>start);
 const label={textContent:''},environment={server:{page:{}},coverage:{national:20},editionCountry:'Romania',nationalLabel:'surse nationale',internationalLabel:'surse internationale',
  newsSourceScope:'all',originalSourcesLabel:'Toate sursele · limbi originale',language:'ro',languageLabel:()=> 'romana',required:()=>label};
 runInNewContext(source.slice(start,end),environment);assert.equal(label.textContent,'Romania · Toate sursele · limbi originale');
 environment.newsSourceScope='edition';runInNewContext(source.slice(start,end),environment);assert.equal(label.textContent,'Romania · surse nationale · romana');
});

test('the public continuation mirror matches the compiled controller exactly',()=>{
 const compiled=readFileSync('.build/src/iceo/news-continuation.js','utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'');
 assert.equal(readFileSync('public/news-continuation.js','utf8'),compiled);
});

test('a checked BBC article cannot reappear when its alternate publisher host replaces the earlier singleton',async()=>{
 for(const Controller of [NewsContinuation,BrowserContinuation]){
  const make=host=>{
   const sourceUrl='https://'+host+'/news/articles/crgj38le4dz9o';
   const card={...article(1801,{now:NOW}),id:hash(sourceUrl).slice(0,24),identity:sourceUrl,sourceUrl,publisher:'BBC',
    title:'Donegal: Pedestrian in his 40s dies in road crash',date:'2026-11-23T08:50:10.599Z',
    attribution:'Source: BBC. Open the original publication.'};
   card.contentHash=hash(cardContent(card));return card;
  };
  const first=make('www.bbc.com'),alternate=make('www.bbc.co.uk');
  assert.ok(storyThreadKey(first));assert.equal(storyThreadKey(first),storyThreadKey(alternate));
  const reading=actualReader([first],{Controller});
  await reading.model.start(context);const prefix=[...reading.model.view().items],receipt=reading.model.editionFor(prefix[0].key);
  assert.equal(prefix.length,1);assert.equal(prefix[0].story,undefined);
  const refreshed={...alternate,observedAt:iso(NOW+2000)};refreshed.contentHash=hash(cardContent(refreshed));
  reading.publish([refreshed],NOW+2000);await reading.model.start(context,true);
  assert.equal(reading.model.view().error,null);assert.deepEqual(reading.model.view().items,prefix);
  assert.strictEqual(reading.model.editionFor(prefix[0].key),receipt);
  assert.equal(reading.model.view().activeReceivedCount,1);
  reading.publish([first,alternate,article(1802,{now:NOW+4000})],NOW+4000);await reading.model.start(context,true);
  assert.equal(reading.model.view().error,null);assert.equal(reading.model.view().items.length,2);
  assert.deepEqual(reading.model.view().items.slice(0,1),prefix);
  assert.equal(reading.model.view().items.filter(item=>item.card.title===first.title).length,1);
 }
});

