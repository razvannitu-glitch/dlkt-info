import test from 'node:test';
import assert from 'node:assert/strict';
import {groupStories,storyThreadKey} from '../.build/src/iceo/story-grouping.js';
import {groupStories as browserGroups,storyThreadKey as browserKey} from '../public/story-grouping.js';
import {NewsPageService,parseNewsPageRequest} from '../.build/src/iceo/news-page.js';
import {NewsContinuation} from '../.build/src/iceo/news-continuation.js';
import {NewsContinuation as BrowserContinuation} from '../public/news-continuation.js';
import {validNewsPage} from '../.build/src/iceo/news-page-contracts.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {epoch,CorpusMemoryStore,hash} from './fixtures/news-corpus.mjs';
import {CROSS_PUBLISHER_ORIGINALS} from './fixtures/crosspublisher-events.mjs';

const NOW=Date.parse('2026-11-24T00:43:00.000Z');
const originals=()=>structuredClone(CROSS_PUBLISHER_ORIGINALS);
const byPublisher=publisher=>originals().find(card=>card.publisher===publisher);
const members=group=>[group.card,...group.related];
function changed(card,index,extra={}){
 const sourceUrl='https://www.dw.com/en/controlled-event-'+index+'/a-'+(12400000+index);
 const value={...card,...extra,sourceUrl,identity:sourceUrl,id:hash(sourceUrl).slice(0,24)};
 if(value.articleSubject)value.articleSubject={...value.articleSubject,articleUrl:sourceUrl};
 value.contentHash=hash(cardContent(value));return value;
}
test('the two observed cross-publisher events form two threads with all four originals unchanged',()=>{
 const cards=originals(),before=JSON.stringify(cards),groups=groupStories(cards);
 assert.equal(groups.length,2);assert.ok(groups.every(group=>group.basis==='shared-event'&&group.related.length===1));
 assert.deepEqual(new Set(groups.flatMap(members)),new Set(cards));
 assert.equal(browserGroups(cards).length,2);
 for(const card of cards)assert.equal(browserKey(card),storyThreadKey(card));
 assert.equal(JSON.stringify(cards),before);
});

test('the volcanic discovery needs one exact named trench from a headline or URL-bound original metadata',()=>{
 const first=byPublisher('New Scientist'),second=byPublisher('National Geographic');
 const missing={...second,articleSubject:undefined};
 const forged={...second,articleSubject:{...second.articleSubject,articleUrl:'https://www.nationalgeographic.com/science/article/unrelated'}};
 const ambiguous={...second,articleSubject:{...second.articleSubject,keywords:[...second.articleSubject.keywords,'Tonga trench']}};
 const another=changed(first,1900,{title:first.title.replace('Mariana','Tonga')});
 for(const negative of [missing,forged,ambiguous,another]){
  assert.equal(groupStories([first,negative]).length,2);
  assert.equal(browserGroups([first,negative]).length,2);
 }
 const otherPlace=changed(second,1901,{articleSubject:{...second.articleSubject,keywords:['Tonga trench','explosive volcanic eruptions']}});
 assert.equal(groupStories([another,otherPlace]).length,1,'a different explicit shared trench works without hardcoding Mariana');
 for(const descriptor of ['active','remote','unnamed','unknown','unidentified','deep-sea','active oceanic','remote underwater','unidentified deep-sea']){
  const printed=descriptor.replace(/\b\p{L}/gu,letter=>letter.toUpperCase());
  const generic=changed(second,1902,{title:"World's deepest explosive volcanic eruption discovered in an "+printed+' Trench',articleSubject:undefined});
  assert.equal(storyThreadKey(generic)?.includes('volcanic-discovery')??false,false,descriptor);
  const keyword=changed(second,1903,{articleSubject:{...second.articleSubject,keywords:[descriptor+' trench']}});
  assert.equal(storyThreadKey(keyword)?.includes('volcanic-discovery')??false,false,descriptor+' metadata');
 }
});

test('uncertain, negated, different records and later volcanic reports stay separate',()=>{
 const first=byPublisher('New Scientist'),second=byPublisher('National Geographic');
 const variants=[
  second.title.replace('Just Discovered','Not Discovered'),
  second.title.replace('Just Discovered','Possibly Discovered'),
  second.title.replace('Just Discovered','Claimed Discovered'),
  second.title.replace('Deepest','Largest'),
  second.title.replace('Explosive','Non-explosive'),
  second.title+' in a fictional simulation',
  second.title+' in 1996',second.title.replace('Just Discovered','Previously Discovered'),
 ];
 for(const [index,title]of variants.entries())assert.equal(groupStories([first,changed(second,1910+index,{title})]).length,2,title);
 const later=changed(second,1920,{date:'2026-11-26T05:00:00.000Z'});
 assert.equal(groupStories([first,later]).length,2);
});

test('aid pledges retain different quoted currencies and conflicting figures as attributed reports within the same event',()=>{
 const first=byPublisher('Al Jazeera'),second=byPublisher('Euronews'),before=JSON.stringify([first,second]);
 const group=groupStories([first,second])[0];assert.equal(group.related.length,1);assert.equal(group.basis,'shared-event');
 assert.ok(members(group).some(card=>card.title.includes('$1.6bn')));assert.ok(members(group).some(card=>card.title.includes('€1.4bn')));
 assert.equal(JSON.stringify([first,second]),before,'no currency conversion or rewritten numerical claim');
 const conflicting=changed(first,1930,{title:first.title.replace('$1.6bn','$1.8bn')});
 const conflicted=groupStories([first,conflicting]);assert.equal(conflicted.length,1);assert.equal(conflicted[0].basis,'shared-event');
 assert.deepEqual(new Set(members(conflicted[0]).map(card=>card.title)),new Set([first.title,conflicting.title]),'different figures remain visible in the event sources, not asserted equivalent');
 const donor=changed(first,1931,{title:first.title.replace('India','France').replace('Nepal','Pakistan')});
 const recipient=changed(second,1932,{title:second.title.replace('India','France').replace('Nepal','Pakistan')});
 assert.equal(groupStories([donor,recipient]).length,1,'parties are explicit grammar, not hardcoded countries');
 const anotherDonor=changed(first,1933,{title:first.title.replace('India','New Zealand').replace('Nepal','Fiji')});
 const anotherRecipient=changed(second,1934,{title:second.title.replace('India','New Zealand').replace('Nepal','Fiji')});
 assert.equal(groupStories([anotherDonor,anotherRecipient]).length,1,'New in an explicit party name is not a new funding round');
});

test('different parties, hazards, funding rounds, phases and days cannot borrow an aid-pledge event',()=>{
 const first=byPublisher('Al Jazeera'),second=byPublisher('Euronews');
 const variants=[
  second.title.replace('India','France'),second.title.replace('Nepal','Pakistan'),second.title.replace('glacier flood','earthquake'),
  second.title.replace('pledges','delivers'),second.title.replace('pledges','loans'),second.title.replace('pledges','does not pledge'),
  second.title.replace('€1.4bn','an additional €1.4bn'),second.title.replace('€1.4bn','a second €1.4bn'),
  second.title+' as a renewed pledge',second.title.replace('pledges','could pledge'),
 ];
 for(const [index,title]of variants.entries()){
  const value=changed(second,1940+index,{title});assert.equal(groupStories([first,value]).length,2,title);
  assert.equal(browserGroups([first,value]).length,2,title);
 }
 assert.equal(groupStories([first,changed(second,1950,{date:'2026-11-24T10:06:44.000Z'})]).length,2);
 const supplied=changed(second,1951,{summary:'A separate commitment for another district.'});
 assert.equal(groupStories([first,supplied]).length,2,'different supplied context is not discarded');
});

test('actual page planning exposes two event cards and all four attributed originals',async()=>{
 const cards=originals(),stored=epoch(cards,[],{now:NOW}),before=JSON.stringify(stored);
 const service=new NewsPageService(new CorpusMemoryStore([stored]),'cross-publisher-event-test-writer-key-'.repeat(3),()=>NOW+1000);
 const page=await service.read({language:'ro',sourceScope:'all',cityId:null,filter:'all',period:'recent',cursor:null});
 assert.ok(validNewsPage(page,NOW+1000));assert.equal(page.total,2);assert.equal(page.articleTotal,4);assert.equal(page.items.length,2);
 assert.equal(Object.values(page.counts).reduce((sum,count)=>sum+count,0),2);
 const visible=page.items.flatMap(item=>[item.card,...item.story.related.map(source=>source.card)]);
 assert.deepEqual(new Set(visible.map(card=>card.sourceUrl)),new Set(cards.map(card=>card.sourceUrl)));
 assert.equal(JSON.stringify(stored),before);
});

test('refresh with replacement publishers preserves both event cards and their original receipts in both controllers',async()=>{
 for(const Controller of [NewsContinuation,BrowserContinuation]){
  let now=NOW;const first=[byPublisher('New Scientist'),byPublisher('Euronews')];
  const store=new CorpusMemoryStore([epoch(first,[],{now:NOW,id:'1',revision:1})]);
  const service=new NewsPageService(store,'cross-publisher-continuation-test-key-'.repeat(3),()=>now);
  const controller=new Controller(async url=>new Response(JSON.stringify(await service.read(parseNewsPageRequest(new URL(url,'https://www.dlkt.ee')))),{headers:{'content-type':'application/json'}}),()=>now);
  const context={language:'ro',sourceScope:'all',cityId:null,filter:'all',period:'recent'};
  await controller.start(context);assert.equal(controller.view().error,null);
  const prefix=[...controller.view().items],receipts=prefix.map(item=>controller.editionFor(item.key));assert.equal(prefix.length,2);
  now+=2000;store.epochs.set('2',epoch([byPublisher('National Geographic'),byPublisher('Al Jazeera')],[],{now,id:'2',revision:2}));store.latest='2';
  await controller.start(context,true);assert.equal(controller.view().error,null);assert.deepEqual(controller.view().items,prefix);
  assert.equal(controller.view().activeReceivedCount,2);
  for(const [index,item]of prefix.entries())assert.strictEqual(controller.editionFor(item.key),receipts[index]);
 }
});

