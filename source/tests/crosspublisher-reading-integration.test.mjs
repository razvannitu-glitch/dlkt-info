import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NewsPageService,parseNewsPageRequest} from '../.build/src/iceo/news-page.js';
import {NewsContinuation} from '../.build/src/iceo/news-continuation.js';
import {NewsContinuation as BrowserContinuation} from '../public/news-continuation.js';
import {validNewsPage} from '../.build/src/iceo/news-page-contracts.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {epoch,local,CorpusMemoryStore,hash} from './fixtures/news-corpus.mjs';
import {CROSS_PUBLISHER_ORIGINALS} from './fixtures/crosspublisher-events.mjs';

const evidence=JSON.parse(readFileSync(new URL('./fixtures/romanian-incident-originals.json',import.meta.url),'utf8'));
const globals=evidence.records.filter(row=>row.kind==='global').map(row=>row.original);
const localRow=evidence.records.find(row=>row.kind==='local'),city=localRow.city;
const find=id=>structuredClone(globals.find(card=>card.id===id));
const fireComplete=()=>find('26b96c700db696d6a95645ae'),firePartial=()=>find('1bf2f186e12f58a0edfc6eb6');
const courtComplete=()=>find('5f3ceca9b5f185872c85563c'),courtPartial=()=>find('998218b980c65c3cc91d5abf');
const NOW=Date.parse('2026-11-24T00:46:54.000Z');
const KEY='incident-reading-integration-test-key-'.repeat(3);
const context={language:'ro',sourceScope:'all',cityId:city.id,city,filter:'all',period:'recent'};
const query={language:context.language,sourceScope:context.sourceScope,cityId:context.cityId,filter:'all',period:'recent',cursor:null};
const sources=item=>[{kind:item.kind,card:item.card},...(item.story?.related??[])];
function localCorpus(now=NOW){
 const value=local(0,{now});
 return {city:structuredClone(city),snapshot:{articles:[structuredClone(localRow.original)],
  sources:value.snapshot.sources.map(source=>({...source,count:source.sourceId===localRow.original.sourceId?1:0}))}};
}
function differentIncident(original,index,from,to){
 const sourceUrl='https://www.dw.com/en/controlled-incident-'+index+'/a-'+(12700000+index);
 const value={...structuredClone(original),id:hash(sourceUrl).slice(0,24),identity:sourceUrl,sourceUrl,publisher:'DW',
  attribution:'Source: DW. Controlled regression fixture.',title:original.title.replaceAll(from,to)};
 delete value.articleSubject;
 value.contentHash=hash(cardContent(value));return value;
}
function model(Controller,cards,locals=[]){
 let now=NOW;
 const first=epoch(cards,locals,{now,id:'1',revision:1}),store=new CorpusMemoryStore([first]);
 const service=new NewsPageService(store,KEY,()=>now);
 const controller=new Controller(async url=>new Response(JSON.stringify(await service.read(parseNewsPageRequest(new URL(url,'https://www.dlkt.ee')))),
  {headers:{'content-type':'application/json'}}),()=>now);
 let revision=1;
 return {controller,service,first,async replace(cards,nextLocals=[]){
  now+=1000;revision++;const id=String(revision);
  store.epochs.set(id,epoch(cards,nextLocals,{now,id,revision}));store.latest=id;
  await controller.start(context,true);assert.equal(controller.view().error,null);
 }};
}

test('actual page planning retains all seven Romanian originals in three subject cards with valid category totals',async()=>{
 const stored=epoch(structuredClone(globals),[localCorpus()],{now:NOW}),before=JSON.stringify(stored);
 const page=await new NewsPageService(new CorpusMemoryStore([stored]),KEY,()=>NOW).read(query);
 assert.ok(validNewsPage(page,NOW,city));assert.equal(page.total,3);assert.equal(page.articleTotal,7);assert.equal(page.nextCursor,null);
 assert.deepEqual(page.items.map(item=>item.story?.sourceTotal??1).sort(),[1,3,3]);
 assert.equal(Object.values(page.counts).reduce((sum,value)=>sum+value,0),3);
 const visible=page.items.flatMap(sources);
 for(const original of globals)assert.deepEqual(visible.find(source=>source.card.id===original.id).card,original);
 assert.deepEqual(visible.find(source=>source.kind==='local').card.news,localRow.original);
 assert.equal(JSON.stringify(stored),before);
});

test('the four observed duplicate groups coexist without losing a source or merging the separate exit reaction',async()=>{
 const cards=[...structuredClone(globals),...structuredClone(CROSS_PUBLISHER_ORIGINALS)];
 const page=await new NewsPageService(new CorpusMemoryStore([epoch(cards,[localCorpus()],{now:NOW})]),KEY,()=>NOW).read(query);
 assert.ok(validNewsPage(page,NOW,city));assert.equal(page.total,5);assert.equal(page.articleTotal,11);
 assert.deepEqual(page.items.map(item=>item.story?.sourceTotal??1).sort(),[1,2,2,3,3]);
 assert.equal(Object.values(page.counts).reduce((sum,value)=>sum+value,0),5);
 const visible=page.items.flatMap(sources);assert.equal(new Set(visible.map(source=>source.card.sourceUrl)).size,11);
 assert.deepEqual(new Set(visible.map(source=>source.card.sourceUrl)),new Set([...cards.map(card=>card.sourceUrl),localRow.original.url]));
 assert.equal(page.items.find(item=>item.card.id==='e5d91e6399db1f3598eba0a7').story,undefined);
});

test('both controllers retain a local singleton when the next edition has only a complete global original of that incident',async()=>{
 for(const Controller of [NewsContinuation,BrowserContinuation]){
  const value=model(Controller,[],[localCorpus()]);await value.controller.start(context);assert.equal(value.controller.view().error,null);
  const prefix=[...value.controller.view().items];assert.equal(prefix.length,1);assert.equal(prefix[0].kind,'local');assert.equal(prefix[0].story,undefined);
  const receipt=value.controller.editionFor(prefix[0].key),before=JSON.stringify(prefix);
  await value.replace([courtComplete()]);
  assert.deepEqual(value.controller.view().items,prefix);assert.equal(value.controller.view().activeReceivedCount,1);
  assert.strictEqual(value.controller.editionFor(prefix[0].key),receipt);assert.equal(JSON.stringify(prefix),before);
 }
});

test('a reused incomplete original cannot hide another explicitly named hotel or court in either controller',async()=>{
 for(const Controller of [NewsContinuation,BrowserContinuation])for(const order of ['partial-first','complete-first']){
  for(const [partial,complete,next]of [
   [firePartial(),fireComplete(),differentIncident(fireComplete(),2101,'Alpin','Bradul')],
   [courtPartial(),courtComplete(),differentIncident(courtComplete(),2102,'București','Cluj Napoca')],
  ]){
   const ordered=card=>order==='partial-first'?[partial,card]:[card,partial];
   const value=model(Controller,ordered(complete));await value.controller.start(context);assert.equal(value.controller.view().error,null);
   const prefix=[...value.controller.view().items];assert.equal(prefix.length,1);assert.equal(prefix[0].card.id,complete.id);
   const receipt=value.controller.editionFor(prefix[0].key),before=JSON.stringify(prefix);
   await value.replace(ordered(next));
   const items=value.controller.view().items;assert.equal(items.length,2);assert.deepEqual(items.slice(0,1),prefix);
   assert.equal(items[1].card.id,next.id);assert.equal(new Set(items.map(item=>item.card.title)).size,2);
   assert.equal(value.controller.view().page.articleTotal,2);assert.equal(value.controller.view().activeReceivedCount,1);
   assert.strictEqual(value.controller.editionFor(prefix[0].key),receipt);assert.equal(JSON.stringify(prefix),before);
   await value.replace([next]);assert.equal(value.controller.view().items.length,2,'a later singleton keeps its own complete alias');
  }
 }
});

test('a complete local primary and a reused partial cannot suppress a different explicit global court in the next edition',async()=>{
 for(const Controller of [NewsContinuation,BrowserContinuation]){
  const partial=courtPartial(),next=differentIncident(courtComplete(),2110,'București','Cluj Napoca');
  const value=model(Controller,[partial],[localCorpus()]);await value.controller.start(context);assert.equal(value.controller.view().error,null);
  const prefix=[...value.controller.view().items];assert.equal(prefix.length,1);assert.equal(prefix[0].kind,'local');
  assert.equal(prefix[0].card.id,localRow.original.id);assert.equal(prefix[0].story.sourceTotal,2);
  assert.equal(prefix[0].story.related[0].card.id,partial.id);
  const receipt=value.controller.editionFor(prefix[0].key),before=JSON.stringify(prefix);
  await value.replace([partial,next]);
  const items=value.controller.view().items;assert.equal(items.length,2);assert.equal(items[1].card.id,next.id);
  assert.equal(items[1].story.sourceTotal,2);assert.equal(value.controller.view().page.articleTotal,2);
  assert.deepEqual(items.slice(0,1),prefix);assert.strictEqual(value.controller.editionFor(prefix[0].key),receipt);assert.equal(JSON.stringify(prefix),before);
 }
});
