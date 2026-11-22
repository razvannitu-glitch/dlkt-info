import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveEdition,editionChanges,editionCardSignature,editionUpdateLabel,publicEditionPollDelay,PUBLIC_EDITION_POLL_MS} from '../.build/src/iceo/live-edition.js';
import {selectContextualToday} from '../.build/src/iceo/contextual-today.js';

const now=Date.parse('2026-11-21T08:00:00.000Z');
const card=(id,patch={})=>({id:String(id).padStart(24,'0'),identity:`controlled:${id}`,title:`Research agency announces discovery ${id}`,
  topic:'science',kind:'publication',sourceUrl:`https://www.nasa.gov/news/controlled-${id}/`,publisher:`Controlled publisher ${id}`,
  sourceIds:['news-science'],date:new Date(now-600_000).toISOString(),dateLabel:'Published',observedAt:new Date(now).toISOString(),
  contentHash:'a'.repeat(64),boundary:'Synthetic fixture only.',deadline:null,version:null,attribution:'Synthetic fixture',sourceState:'verified',...patch});
const select=(cards,at=now)=>selectContextualToday(cards,{countryCode:null,preferredTopics:[]},at);

test('first visit presents the finite selection immediately',()=>{
  const live=new LiveEdition(),selection=select([card(1),card(2)]),result=live.present(selection,'global',now);
  assert.equal(result.selection,selection);assert.equal(result.changes.total,0);
});
test('automatic recovery after an empty first load shows the first real edition immediately',()=>{
  const live=new LiveEdition();live.present(select([]),'global',now);
  const recovered=live.present(select([card(1)]),'global',now+30_000);
  assert.equal(recovered.selection.first.length,1);assert.equal(recovered.changes.total,0);
});
test('new information is staged and never displaces the article being read',()=>{
  const live=new LiveEdition();live.present(select([card(1)]),'global',now);
  const result=live.present(select([card(1),card(2)]),'global',now);
  assert.deepEqual(result.selection.first.map(view=>view.card.id),[card(1).id]);
  assert.deepEqual(result.changes,{added:1,updated:0,removed:0,total:1});
  const applied=live.present(select([card(1),card(2)]),'global',now,true);
  assert.equal(applied.selection.first.length,2);assert.equal(applied.changes.total,0);
});
test('a same-size replacement reports added and removed independently',()=>{
  const result=editionChanges(select([card(1)]),select([card(2)]));
  assert.deepEqual(result,{added:1,updated:0,removed:1,total:2});
  assert.match(editionUpdateLabel(result),/1 new.*1 no longer selected/);
});
test('changed publisher wording stays staged until explicit application',()=>{
  const live=new LiveEdition(),original=card(1),changed=card(1,{title:'Research agency corrects the announced discovery'});
  live.present(select([original]),'global',now);
  const staged=live.present(select([changed]),'global',now);
  assert.equal(staged.selection.first[0].card.title,original.title);assert.equal(staged.changes.updated,1);
  assert.equal(live.present(select([changed]),'global',now,true).selection.first[0].card.title,changed.title);
});
test('new source checks and internal hashes do not manufacture news',()=>{
  const live=new LiveEdition(),original=card(1),checked=card(1,{observedAt:new Date(now+30_000).toISOString(),contentHash:'b'.repeat(64)});
  assert.equal(editionCardSignature(original),editionCardSignature(checked));
  live.present(select([original]),'global',now);
  const next=live.present(select([checked],now+30_000),'global',now+30_000);
  assert.equal(next.changes.total,0);assert.equal(next.selection.first[0].card.observedAt,checked.observedAt);
});
test('publisher reordering does not rotate identical information on every poll',()=>{
  const live=new LiveEdition(),first=select([card(1),card(2)]),reordered={...first,first:[...first.first].reverse()};
  live.present(first,'global',now);
  const next=live.present(reordered,'global',now+1_000);
  assert.deepEqual(next.selection.first.map(view=>view.card.id),first.first.map(view=>view.card.id));assert.equal(next.changes.total,0);
});
test('a different explicit reader context applies its selection immediately',()=>{
  const live=new LiveEdition();live.present(select([card(1)]),'country:RO',now);
  const next=live.present(select([card(2)]),'city:Paris:FR',now);
  assert.equal(next.selection.first[0].card.id,card(2).id);assert.equal(next.changes.total,0);
});
test('publication expiry removes retained cards even without accepting pending news',()=>{
  const live=new LiveEdition(),expiring=card(1,{date:new Date(now-86_399_000).toISOString()});
  live.present(select([expiring]),'global',now);
  const next=live.present(select([card(2)],now+1_000),'global',now+1_000);
  assert.equal(next.selection.first.length,0);assert.equal(next.changes.added,1);
  assert.equal(next.selection.daily.belowMinimum,true);assert.equal(next.selection.daily.selectedCategories.length,0);
});
test('an unrechecked retained source expires after an hour with no fresh label',()=>{
  const live=new LiveEdition();live.present(select([card(1)]),'global',now);
  const next=live.present(select([],now+3_600_000),'global',now+3_600_000);
  assert.equal(next.selection.first.length,0);assert.equal(next.changes.total,0);
});
test('poll failures use bounded backoff and a successful check restores30seconds',()=>{
  assert.equal(PUBLIC_EDITION_POLL_MS,30_000);
  assert.deepEqual([0,1,2,10].map(publicEditionPollDelay),[30_000,60_000,120_000,120_000]);
  assert.equal(publicEditionPollDelay(0),30_000);
});

test('continuation items are retained, rechecked and staged without changing the reading order',()=>{
  const one=select([card(1)]).first[0],two=select([card(2)]).first[0],three=select([card(3)]).first[0];
  const live=new LiveEdition();live.present({first:[one],more:[two]},'global',now);
  const checked={...two,card:{...two.card,observedAt:new Date(now+30_000).toISOString()}};
  const candidate={first:[one],more:[three,checked]};
  const staged=live.present(candidate,'global',now+30_000);
  assert.deepEqual(staged.selection.more.map(view=>view.card.id),[two.card.id]);
  assert.equal(staged.selection.more[0].card.observedAt,checked.card.observedAt);
  assert.equal(staged.changes.added,1);
  const applied=live.present(candidate,'global',now+30_000,true);
  assert.deepEqual(applied.selection.more.map(view=>view.card.id),[three.card.id,two.card.id]);
});
test('a continuation-only edition stays stable and expires its source evidence',()=>{
  const one=select([card(1)]).first[0],two=select([card(2)]).first[0];
  const live=new LiveEdition();live.present({first:[],more:[one]},'global',now);
  const staged=live.present({first:[],more:[two,one]},'global',now+30_000);
  assert.deepEqual(staged.selection.more.map(view=>view.card.id),[one.card.id]);
  assert.equal(staged.changes.added,1);
  const expired=live.present({first:[],more:[]},'global',now+3_600_000);
  assert.deepEqual(expired.selection.more,[]);
});

test('an already-visible local edition can defer the first global response without changing normal empty recovery',()=>{
 const live=new LiveEdition();live.present(select([]),'global',now);
 const candidate=select([card(1)]),staged=live.present(candidate,'global',now+1000,false,true);
 assert.equal(staged.selection.first.length,0);assert.equal(staged.changes.added,1);
 const applied=live.present(candidate,'global',now+1000,true,true);assert.strictEqual(applied.selection,candidate);assert.equal(applied.changes.total,0);
 const changed=new LiveEdition();changed.present(select([]),'ro',now);
 assert.strictEqual(changed.present(candidate,'en',now+1000,false,true).selection,candidate,'an explicit context change still adopts immediately');
});
