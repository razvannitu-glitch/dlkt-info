import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NewsContinuation,NEWS_READING_MAX_ITEMS} from '../.build/src/iceo/news-continuation.js';
import {NewsContinuation as BrowserContinuation} from '../public/news-continuation.js';
import {NewsPageService,parseNewsPageRequest} from '../.build/src/iceo/news-page.js';
import {validNewsPage} from '../.build/src/iceo/news-page-contracts.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {NEWS_CATEGORIES,newsCategory} from '../.build/src/iceo/news-taxonomy.js';
import {storyThreadKey} from '../.build/src/iceo/story-grouping.js';
import {article,epoch,CorpusMemoryStore,hash} from './fixtures/news-corpus.mjs';

const NOW=Date.parse('2026-11-23T22:00:00.000Z'),iso=value=>new Date(value).toISOString();
const context={language:'en',sourceScope:'all',cityId:null,filter:'all',period:'recent'};
const Controllers=[NewsContinuation,BrowserContinuation];
const reply=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const token='controlled-sources.'+'a'.repeat(43);
function changed(card,extra={}){
 const value={...structuredClone(card),...extra};value.contentHash=hash(cardContent(value));return value;
}
function original(id,extra={}){
 return changed(article(id,{now:NOW,category:'04000000',published:NOW-60_000}),extra);
}
function item(card){return {kind:'global',key:'article:'+card.id,category:newsCategory(card),card};}
function group(cards,{key='same checked event',sourceTotal=cards.length}={}){
 return {...item(cards[0]),story:{key:'story:'+hash(key),basis:'shared-event',related:cards.slice(1).map(card=>({kind:'global',card})),
  sourceTotal,nextSourcesCursor:sourceTotal>cards.length?token:null}};
}
function page(items,revision=1,at=NOW,extra={}){
 const counts=Object.fromEntries(['other',...NEWS_CATEGORIES.map(category=>category.id)].map(id=>[id,0]));
 for(const value of items)counts[value.category??'other']++;
 return {version:'dlkt-news-page-4',epoch:String(revision),revision,generatedAt:iso(at),startedAt:iso(at),expiresAt:iso(at+900_000),
  ...context,countryCode:null,day:null,coverage:{national:0,local:0,international:items.length},items,
  total:items.length,articleTotal:items.reduce((count,value)=>count+(value.story?.sourceTotal??1),0),filteredTotal:items.length,
  counts,nextCursor:null,...extra};
}
function checkedItem(value,at){
 return {...value,card:changed(value.card,{observedAt:iso(at)}),...(value.story?{story:{...value.story,related:value.story.related.map(source=>({...source,card:changed(source.card,{observedAt:iso(at)})}))}}:{})};
}
function rawReader(Controller,items){
 let clock=NOW,revision=1,payload=page(items);const requests=[];
 const model=new Controller(async(url,init)=>{requests.push({url,init});return reply(payload);},()=>clock);
 return {model,requests,get payload(){return payload;},async refresh(next,extra={},renewChecks=true){
  clock+=1000;revision++;payload=page(renewChecks?next.map(value=>checkedItem(value,clock)):next,revision,clock,extra);await model.start(context,true);
 },setPayload(value){payload=value;},setClock(value){clock=value;}};
}
// Observed publisher metadata; source clocks and releases below are controlled fixtures.
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
function actualReader(Controller,cards,{now=NOW,selected=context}={}){
 let clock=now,revision=1;
 const store=new CorpusMemoryStore([epoch(cards,[],{now,id:'1',revision})]);
 const service=new NewsPageService(store,'same-card-updates-regression-key-'.repeat(3),()=>clock);
 const model=new Controller(async url=>reply(await service.read(parseNewsPageRequest(new URL(url,'https://www.dlkt.ee')))),()=>clock);
 return {model,async refresh(next){
  clock+=1000;revision++;const id=String(revision);
  store.epochs.set(id,epoch(next.map(card=>changed(card,{observedAt:iso(clock)})),[],{now:clock,id,revision}));store.latest=id;
  await model.start(selected,true);assert.equal(model.view().error,null);
 }};
}

test('a second singleton publisher enriches the same reading card with its separate validated receipt',async()=>{
 for(const Controller of Controllers){
  const first=report(0),next=report(2,NOW+1000),third=report(1,NOW+2000),selected={...context,language:'ro'};
  assert.equal(storyThreadKey(first),storyThreadKey(next));
  const reading=actualReader(Controller,[first],{selected});await reading.model.start(selected);
  const prefix=reading.model.view().items,owner=prefix[0].key,receipt=reading.model.editionFor(owner),before=JSON.stringify(prefix);
  await reading.refresh([next]);
  assert.equal(reading.model.view().items.length,1);assert.strictEqual(reading.model.view().items[0],prefix[0]);
  assert.equal(JSON.stringify(prefix),before);assert.strictEqual(reading.model.editionFor(owner),receipt);
  const [update]=reading.model.updatesFor(owner);
  assert.equal(update.edition.epoch,'2');assert.notStrictEqual(update.edition,receipt);
  assert.deepEqual(update.edition.items,[]);assert.equal(update.edition.nextCursor,null);
  assert.equal(update.changes.length,1);assert.equal(update.changes[0].card.sourceUrl,next.sourceUrl);
  assert.equal(update.changes[0].card.date,next.date);assert.equal(update.changes[0].card.observedAt,next.observedAt);
  assert.equal(update.sourceCountIncreased,false);
  assert.ok(Object.isFrozen(update)&&Object.isFrozen(update.changes)&&Object.isFrozen(reading.model.updatesFor(owner)));
  await reading.refresh([first,next,third]);
  assert.equal(reading.model.view().items.length,1);
  assert.equal(reading.model.updatesFor(owner).length,2);
  assert.deepEqual(reading.model.updatesFor(owner)[1].changes.map(source=>source.card.id),[third.id]);
  assert.equal(reading.model.updatesFor(owner)[1].sourceCountIncreased,true);
  assert.equal(reading.model.updatesFor(owner)[0].edition.epoch,'2','earlier change keeps its own check');
 }
});

test('publisher wording changes are attached without rewriting the title, order or original check',async()=>{
 for(const Controller of Controllers){
  const first=original(1),other=original(2),reading=rawReader(Controller,[item(first),item(other)]);
  await reading.model.start(context);const prefix=reading.model.view().items,owner=prefix[0].key,receipt=reading.model.editionFor(owner);
  const corrected=changed(first,{title:'Inflation report corrects the earlier price changes',summary:'The publisher supplies a corrected explanation.',observedAt:iso(NOW+1000)});
  await reading.refresh([item(corrected),item(other)]);
  assert.equal(reading.model.view().error,null);assert.deepEqual(reading.model.view().items,prefix);
  assert.strictEqual(reading.model.editionFor(owner),receipt);assert.equal(prefix[0].card.title,first.title);
  const update=reading.model.updatesFor(owner)[0];
  assert.equal(update.changes[0].card.title,corrected.title);assert.equal(update.changes[0].card.summary,corrected.summary);
  assert.equal(update.item.card.observedAt,iso(NOW+1000));assert.equal(receipt.generatedAt,iso(NOW));
  const history=reading.model.updatesFor(owner);
  await reading.refresh([item(changed(corrected,{observedAt:iso(NOW+2000),date:iso(NOW-1000)})),item(other)]);
  assert.strictEqual(reading.model.updatesFor(owner),history,'date-only/check-only refresh creates no new notification or receipt');
  assert.equal(history[0].edition.epoch,'2');assert.equal(history[0].changes[0].card.observedAt,iso(NOW+1000));
 }
});

test('reordered representatives, source checks and republication times do not invent updates',async()=>{
 for(const Controller of Controllers){
  const a=original(11),b=original(12),reading=rawReader(Controller,[group([a,b])]);await reading.model.start(context);
  const owner=reading.model.view().items[0].key;
  await reading.refresh([group([changed(b,{observedAt:iso(NOW+1000),date:iso(NOW-2000)}),changed(a,{observedAt:iso(NOW+1000)})])]);
  assert.equal(reading.model.view().error,null);assert.equal(reading.model.view().items.length,1);
  assert.deepEqual(reading.model.updatesFor(owner),[]);
 }
});

test('an increase behind an unchanged source preview exposes the new group once without fabricating originals',async()=>{
 for(const Controller of Controllers){
  const cards=[21,22,23,24].map(id=>original(id)),reading=rawReader(Controller,[group(cards)]);
  await reading.model.start(context);const owner=reading.model.view().items[0].key;
  await reading.refresh([group(cards,{sourceTotal:5})]);assert.equal(reading.model.view().error,null);
  const history=reading.model.updatesFor(owner);assert.equal(history.length,1);
  assert.deepEqual(history[0].changes,[]);assert.equal(history[0].sourceCountIncreased,true);
  assert.equal(history[0].item.story.sourceTotal,5);assert.equal(history[0].item.story.nextSourcesCursor,token);
  assert.ok(validNewsPage({...history[0].edition,items:[history[0].item]},NOW+1000));
  await reading.refresh([group(cards,{sourceTotal:5})]);assert.strictEqual(reading.model.updatesFor(owner),history);
  await reading.refresh([group(cards)]);await reading.refresh([group(cards,{sourceTotal:5})]);
  assert.strictEqual(reading.model.updatesFor(owner),history,'count churn does not repeatedly advertise the same maximum coverage');
 }
});

test('equivalent BBC hosts remain silent while the learned alternate identity can carry a later correction',async()=>{
 for(const Controller of Controllers){
  const make=host=>{
   const sourceUrl='https://'+host+'/news/articles/crgj38le4dz9o';
   return original(31,{id:hash(sourceUrl).slice(0,24),identity:sourceUrl,sourceUrl,publisher:'BBC',
    title:'Donegal: Pedestrian in his 40s dies in road crash',attribution:'Source: BBC. Open the original publication.'});
  };
  const first=make('www.bbc.com'),alternate=make('www.bbc.co.uk'),reading=rawReader(Controller,[item(first)]);
  assert.equal(storyThreadKey(first),storyThreadKey(alternate));await reading.model.start(context);
  const owner=reading.model.view().items[0].key;
  await reading.refresh([item(alternate)]);assert.equal(reading.model.view().error,null);assert.deepEqual(reading.model.updatesFor(owner),[]);
  const corrected=changed(alternate,{summary:'The publisher has added a verified location clarification.'});
  await reading.refresh([item(corrected)]);
  assert.equal(reading.model.view().items.length,1);assert.equal(reading.model.updatesFor(owner).length,1);
  assert.equal(reading.model.updatesFor(owner)[0].changes[0].card.sourceUrl,alternate.sourceUrl);
 }
});

test('a fresh group spanning two displayed owners cannot choose one arbitrarily or poison their established identities',async()=>{
 for(const Controller of Controllers){
  const a=original(41),b=original(42),reading=rawReader(Controller,[item(a),item(b)]);await reading.model.start(context);
  const prefix=reading.model.view().items;
  await reading.refresh([group([a,b],{key:'later combined report'})]);assert.equal(reading.model.view().error,null);
  assert.deepEqual(reading.model.view().items,prefix);
  for(const owner of prefix)assert.deepEqual(reading.model.updatesFor(owner.key),[]);
  const correction=changed(a,{summary:'A correction for the first original only.'});
  await reading.refresh([item(correction),item(b)]);
  assert.equal(reading.model.updatesFor(prefix[0].key).length,1);
  assert.deepEqual(reading.model.updatesFor(prefix[1].key),[]);
 }
});

test('a partial original reused for two explicit courts cannot attach an unqualified correction to the first owner',async()=>{
 const evidence=JSON.parse(readFileSync(new URL('./fixtures/romanian-incident-originals.json',import.meta.url),'utf8'));
 const globals=evidence.records.filter(row=>row.kind==='global').map(row=>row.original);
 const get=id=>structuredClone(globals.find(card=>card.id===id));
 const complete=get('5f3ceca9b5f185872c85563c'),partial=get('998218b980c65c3cc91d5abf');
 const sourceUrl='https://www.dw.com/en/controlled-incident-update-2102/a-12702102';
 const other=changed(complete,{id:hash(sourceUrl).slice(0,24),identity:sourceUrl,sourceUrl,publisher:'DW',
  title:complete.title.replaceAll('București','Cluj Napoca'),attribution:'Source: DW. Controlled regression fixture.'});
 delete other.articleSubject;other.contentHash=hash(cardContent(other));
 const selected={...context,language:'ro'},now=Date.parse('2026-11-24T00:46:54.000Z');
 for(const Controller of Controllers){
  const reading=actualReader(Controller,[complete,partial],{now,selected});await reading.model.start(selected);
  assert.equal(reading.model.view().error,null);const first=reading.model.view().items[0];assert.equal(first.card.id,complete.id);
  await reading.refresh([other,partial]);const second=reading.model.view().items[1];assert.ok(second);assert.equal(second.card.id,other.id);
  await reading.refresh([changed(partial,{summary:'A later clarification still does not identify the court.'})]);
  assert.equal(reading.model.view().items.length,2);
  assert.deepEqual(reading.model.updatesFor(first.key),[]);assert.deepEqual(reading.model.updatesFor(second.key),[]);
  await reading.refresh([changed(other,{summary:'A correction explicitly about the named second court.'})]);
  assert.equal(reading.model.updatesFor(second.key).length,1);assert.deepEqual(reading.model.updatesFor(first.key),[]);
 }
});

test('different explicit penalty numbers remain separate events with separate update ownership',async()=>{
 for(const Controller of Controllers){
  const a=report(0),sourceUrl='https://stirileprotv.ro/stiri/international/controlled-different-penalty.html';
  const b=report(2,NOW+1000,{sourceUrl,title:observed[2].title.replace('74','75')});
  assert.notEqual(storyThreadKey(a),storyThreadKey(b));const selected={...context,language:'ro'},reading=actualReader(Controller,[a],{selected});
  await reading.model.start(selected);const first=reading.model.view().items[0];
  await reading.refresh([b]);assert.equal(reading.model.view().items.length,2);
  const second=reading.model.view().items[1];assert.deepEqual(reading.model.updatesFor(first.key),[]);
  await reading.refresh([changed(b,{summary:'A correction for the separately printed penalty.'})]);
  assert.equal(reading.model.updatesFor(second.key).length,1);assert.deepEqual(reading.model.updatesFor(first.key),[]);
 }
});

test('a rejected page cannot partially attach a correction or teach an update alias',async()=>{
 for(const Controller of Controllers){
  const a=original(51),foreign=original(52),reading=rawReader(Controller,[item(a)]);await reading.model.start(context);
  const owner=reading.model.view().items[0].key,receipt=reading.model.editionFor(owner);
  const joined=group([changed(a,{summary:'Unaccepted correction.'}),foreign],{key:'rejected group'});
  const bad={...joined,privateContext:'must not pass the public allowlist'};
  await reading.refresh([bad]);assert.equal(reading.model.view().error,'invalid');
  assert.deepEqual(reading.model.updatesFor(owner),[]);assert.strictEqual(reading.model.editionFor(owner),receipt);
  await reading.refresh([item(foreign)]);assert.equal(reading.model.view().error,null);
  assert.equal(reading.model.view().items.length,2,'the rejected foreign alias was not retained');
  assert.deepEqual(reading.model.updatesFor(owner),[]);
 }
});

test('an expired response cannot replace an earlier update receipt',async()=>{
 for(const Controller of Controllers){
  const a=original(61),reading=rawReader(Controller,[item(a)]);await reading.model.start(context);const owner=reading.model.view().items[0].key;
  await reading.refresh([item(changed(a,{summary:'The accepted clarification.'}))]);const history=reading.model.updatesFor(owner);
  await reading.refresh([item(changed(a,{summary:'An expired clarification must stay absent.'}))],{expiresAt:iso(NOW+1500)});
  assert.equal(reading.model.view().error,'expired');assert.strictEqual(reading.model.updatesFor(owner),history);
  assert.equal(history[0].changes[0].card.summary,'The accepted clarification.');
 }
});

test('a late aborted generation cannot add changes or owners to the replacement context',async()=>{
 for(const Controller of Controllers){
  const a=original(71),foreign=original(72);let resolveOld,requests=0;
  const model=new Controller(async url=>{
   requests++;if(requests===2)return new Promise(resolve=>{resolveOld=resolve;});
   const query=new URL(url,'https://www.dlkt.ee').searchParams;
   return reply(page([item(a)],requests,NOW,{language:query.get('lang')}));
  },()=>NOW);
  await model.start(context);const owner=model.view().items[0].key;
  const pending=model.start(context,true);assert.equal(typeof resolveOld,'function');
  await model.start({...context,language:'ro'});
  const originalReceipt=model.editionFor(owner);
  resolveOld(reply(page([group([changed(a,{summary:'Late unaccepted wording.'}),foreign])],2,NOW)));
  await pending;assert.equal(model.view().error,null);assert.equal(model.view().items.length,1);
  assert.deepEqual(model.updatesFor(owner),[]);assert.strictEqual(model.editionFor(owner),originalReceipt);
  assert.equal(model.view().page.language,'ro');
 }
});

test('a failed refresh preserves accepted changes and a successful retry attaches the new wording once',async()=>{
 for(const Controller of Controllers){
  const a=original(81);let revision=1,fail=false;
  const model=new Controller(async()=>{
   if(fail){fail=false;return new Response('',{status:503});}
   return reply(page([item(revision===1?a:changed(a,{summary:'Correction '+revision,observedAt:iso(NOW+revision)}))],revision));
  },()=>NOW);
  await model.start(context);const owner=model.view().items[0].key;
  revision=2;await model.start(context,true);const history=model.updatesFor(owner);
  revision=3;fail=true;await model.start(context,true);
  assert.equal(model.view().error,'unavailable');assert.strictEqual(model.updatesFor(owner),history);
  await model.next(true);assert.equal(model.view().error,null);assert.equal(model.updatesFor(owner).length,2);
  assert.equal(model.updatesFor(owner)[1].changes[0].card.summary,'Correction 3');
  await model.start(context,true);assert.equal(model.updatesFor(owner).length,2);
 }
});

test('a context change and an explicit reset clear updates together with their old ownership',async()=>{
 for(const Controller of Controllers){
  const a=original(91);let corrected=false,checked=NOW;
  const model=new Controller(async url=>{
   const query=new URL(url,'https://www.dlkt.ee').searchParams;
   return reply(page([item(changed(a,{...(corrected?{summary:'Context-specific correction.'}:{}),observedAt:iso(++checked)}))],corrected?2:1,NOW,{language:query.get('lang')}));
  },()=>NOW);
  await model.start(context);const owner=model.view().items[0].key;corrected=true;await model.start(context,true);
  assert.equal(model.updatesFor(owner).length,1);
  await model.start({...context,language:'ro'});assert.deepEqual(model.updatesFor(owner),[]);
  corrected=false;await model.start({...context,language:'ro'},true);assert.equal(model.updatesFor(owner).length,1);
  await model.reset();assert.deepEqual(model.updatesFor(owner),[]);assert.equal(model.view().retainedCount,0);
 }
});

test('update history shares the reading bound and an over-budget page is rejected atomically',async()=>{
 for(const Controller of Controllers){
  const originals=Array.from({length:20},(_,index)=>original(index+101)),reading=rawReader(Controller,originals.map(item));
  await reading.model.start(context);const owners=reading.model.view().items.map(value=>value.key);
  // Each accepted singleton change retains one update record plus one original.
  const accepted=Math.floor((NEWS_READING_MAX_ITEMS-originals.length)/(originals.length*2));
  for(let revision=1;revision<=accepted;revision++){
   await reading.refresh(originals.map(card=>item(changed(card,{summary:'Correction '+revision}))));
   assert.equal(reading.model.view().error,null);assert.equal(reading.model.view().limitReached,false);
  }
  const prior=owners.map(owner=>reading.model.updatesFor(owner)),receipt=reading.model.view().page;
  await reading.refresh(originals.map(card=>item(changed(card,{summary:'Over-budget correction.'}))));
  assert.equal(reading.model.view().limitReached,true);assert.equal(reading.model.view().items.length,20);
  assert.strictEqual(reading.model.view().page,receipt);
  for(const [index,owner]of owners.entries()){
   assert.strictEqual(reading.model.updatesFor(owner),prior[index]);assert.equal(prior[index].length,accepted);
   assert.equal(prior[index].at(-1).changes[0].card.summary,'Correction '+accepted);
  }
  const count=reading.requests.length;await reading.model.next(true);assert.equal(reading.requests.length,count);
  reading.setPayload(page(originals.map(item)));await reading.model.reset();
  assert.equal(reading.model.view().limitReached,false);assert.deepEqual(reading.model.updatesFor(owners[0]),[]);
 }
});

test('older or equal checked conflicting wording cannot undo a newer correction or teach its extra aliases',async()=>{
 for(const Controller of Controllers){
  const a=original(201),foreign=original(202),reading=rawReader(Controller,[item(a)]);
  await reading.model.start(context);const owner=reading.model.view().items[0].key;
  await reading.refresh([item(changed(a,{summary:'Newer verified wording.'}))]);
  const history=reading.model.updatesFor(owner),current=reading.model.currentSourcesFor(owner);
  await reading.refresh([group([a,foreign])],{},false);
  assert.equal(reading.model.view().error,null);assert.strictEqual(reading.model.updatesFor(owner),history);
  assert.strictEqual(reading.model.currentSourcesFor(owner),current);
  await reading.refresh([item(changed(a,{summary:'Equal-check conflicting wording.',observedAt:iso(NOW+1000)}))],{},false);
  assert.strictEqual(reading.model.updatesFor(owner),history);
  await reading.refresh([item(foreign)]);
  assert.equal(reading.model.view().items.length,2,'an older conflicting group cannot teach an unseen original alias');
  await reading.refresh([item(a)]);
  assert.equal(reading.model.updatesFor(owner).length,2,'a genuinely newer checked revert remains accessible');
  assert.equal(reading.model.updatesFor(owner)[1].changes[0].card.summary,undefined);
 }
});

test('check-only refresh renews full-source access separately while the meaningful change keeps its original receipt',async()=>{
 for(const Controller of Controllers){
  const cards=[211,212,213,214].map(id=>original(id)),reading=rawReader(Controller,[group(cards,{sourceTotal:5})]);
  await reading.model.start(context);const owner=reading.model.view().items[0].key,baseReceipt=reading.model.editionFor(owner);
  const revised=[changed(cards[0],{summary:'A checked summary correction.'}),...cards.slice(1)];
  await reading.refresh([group(revised,{sourceTotal:5})]);
  const history=reading.model.updatesFor(owner),firstContext=reading.model.currentSourcesFor(owner);
  assert.equal(history.length,1);assert.equal(history[0].changes[0].card.summary,'A checked summary correction.');
  const nextTime=Date.parse(firstContext.edition.expiresAt)+1;reading.setClock(nextTime);
  const freshGroup=group(revised,{sourceTotal:5});freshGroup.story.nextSourcesCursor='renewed-source-access.'+'b'.repeat(43);
  await reading.refresh([freshGroup]);
  assert.equal(reading.model.view().error,null);assert.strictEqual(reading.model.updatesFor(owner),history);
  assert.strictEqual(reading.model.editionFor(owner),baseReceipt);
  const fresh=reading.model.currentSourcesFor(owner);
  assert.ok(Object.isFrozen(fresh));assert.notStrictEqual(fresh,firstContext);
  assert.equal(fresh.item.story.nextSourcesCursor,freshGroup.story.nextSourcesCursor);
  assert.ok(validNewsPage({...fresh.edition,items:[fresh.item]},nextTime+1000));
  assert.equal(validNewsPage({...history[0].edition,items:[history[0].item]},nextTime+1000),false);
  assert.equal(history[0].edition.epoch,'2');assert.equal(fresh.edition.epoch,'3');
 }
});

test('a stable original repurposed to another explicit incident cannot enrich its former owner or teach that incident alias',async()=>{
 const evidence=JSON.parse(readFileSync(new URL('./fixtures/romanian-incident-originals.json',import.meta.url),'utf8'));
 const court=evidence.records.find(row=>row.kind==='global'&&row.original.id==='5f3ceca9b5f185872c85563c').original;
 const courtAt=Date.parse('2026-11-24T00:46:54.000Z');
 const scenarios=[
  {original:report(0),replacement:changed(report(0),{title:observed[0].title.replace('74','75')}),now:NOW},
  {original:court,replacement:changed(court,{title:court.title.replaceAll('București','Cluj Napoca')}),now:courtAt},
 ];
 for(const Controller of Controllers)for(const scenario of scenarios){
  const selected={...context,language:'ro'},reading=actualReader(Controller,[scenario.original],{now:scenario.now,selected});
  await reading.model.start(selected);const owner=reading.model.view().items[0],receipt=reading.model.editionFor(owner.key);
  const before=reading.model.currentSourcesFor(owner.key);
  const replacement=changed(scenario.replacement,{});delete replacement.articleSubject;replacement.contentHash=hash(cardContent(replacement));
  assert.notEqual(storyThreadKey(scenario.original),storyThreadKey(replacement));
  await reading.refresh([replacement]);
  assert.equal(reading.model.view().items.length,1,'the established reading prefix remains unchanged');
  assert.strictEqual(reading.model.view().items[0],owner);assert.strictEqual(reading.model.editionFor(owner.key),receipt);
  assert.deepEqual(reading.model.updatesFor(owner.key),[]);
  assert.strictEqual(reading.model.currentSourcesFor(owner.key),before);
  const sourceUrl='https://www.dw.com/ro/controlled-repurposed-incident/a-12999999';
  const independentlyPublished=changed(replacement,{sourceUrl,identity:sourceUrl,id:hash(sourceUrl).slice(0,24),publisher:'DW',
   attribution:'Source: DW. Controlled regression fixture.'});
  await reading.refresh([independentlyPublished]);
  assert.equal(reading.model.view().items.length,2,'the rejected replacement cannot teach a new incident alias to the old card');
  assert.deepEqual(reading.model.updatesFor(owner.key),[]);
  await reading.refresh([changed(scenario.original,{summary:'A newer summary correction for the original explicit incident.'})]);
  assert.equal(reading.model.updatesFor(owner.key).length,1,'a summary-only correction for the original incident remains eligible');
  assert.equal(reading.model.updatesFor(owner.key)[0].changes[0].card.summary,'A newer summary correction for the original explicit incident.');
 }
});
