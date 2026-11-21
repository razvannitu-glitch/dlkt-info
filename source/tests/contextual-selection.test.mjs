import test from 'node:test';
import assert from 'node:assert/strict';
import {groupRelatedListings,rankContextualCards} from '../.build/src/iceo/contextual.js';
import {contextFromPublisherCategories} from '../.build/src/iceo/context.js';

// Deliberately controlled records, not claims about current public events.
const now=Date.parse('2026-11-18T12:00:00Z');
const day=86_400_000;
const context=country=>contextFromPublisherCategories('gv-world',[country]);
const card=(id,topic='world',extra={})=>({
 id:String(id).padStart(24,'0'),identity:`fixture:${id}`,title:`Controlled publisher listing ${id}`,
 topic,kind:'publication',sourceUrl:`https://globalvoices.org/2026/11/18/fixture-${id}/`,publisher:`Publisher ${id}`,sourceIds:['gv-world'],
 date:'2026-11-18T10:00:00.000Z',dateLabel:'Published',observedAt:new Date(now).toISOString(),contentHash:String(id).padStart(64,'0'),
 boundary:'Controlled publisher fixture; no personal applicability asserted.',deadline:null,version:null,
 attribution:`Publisher ${id}`,sourceState:'verified',...extra,
});
const settings=(countryCode,topics=['world','culture','science'],extra={})=>({countryCode,topics,query:'',budget:5,...extra});
const headline='Scientists identify unusual atmospheric patterns near the northern pole of Jupiter';
const excerpt='Researchers report preliminary observations of atmospheric patterns using independent measurements from multiple instruments during the November observation campaign.';

test('the same common collection produces justified country and topic selections for two profiles',()=>{
 const ro=card(1,'culture',{context:context('Romania')}),gb=card(2,'culture',{context:context('United Kingdom')}),
  science=card(3,'science',{sourceIds:['nasa-news']}),world=card(4,'world',{context:context('Japan')});
 const corpus=[world,science,gb,ro],before=JSON.stringify(corpus);
 const bucharest=rankContextualCards(corpus,settings('RO',['culture','science']),now);
 const london=rankContextualCards(corpus,settings('GB',['culture','science']),now);
 assert.equal(bucharest[0].card.id,ro.id);assert.equal(london[0].card.id,gb.id);
 assert.equal(bucharest[0].localMatch,true);assert.match(bucharest[0].reason,/Publisher-tagged Romania coverage/u);
 assert.equal(london[0].localMatch,true);assert.match(london[0].reason,/selected city's country/u);
 assert.ok(bucharest.some(item=>item.card.id===science.id));assert.ok(london.some(item=>item.card.id===science.id));
 assert.ok(!bucharest.some(item=>item.card.id===world.id));
 assert.deepEqual(rankContextualCards(corpus,settings('RO',['science']),now).map(item=>item.card.id),[science.id]);
 assert.equal(JSON.stringify(corpus),before);
});

test('a temporary city/topic/text choice is a pure filter and never overwrites a saved profile',()=>{
 const saved=Object.freeze(settings('RO',['culture'],{query:'',budget:4}));
 const london=card(1,'world',{title:'London community publishes its independent local arts programme',context:context('United Kingdom')}),
  ro=card(2,'culture',{context:context('Romania')});
 const preview=rankContextualCards([ro,london],settings('GB',['world'],{query:'London'}),now);
 assert.deepEqual(preview.map(item=>item.card.id),[london.id]);
 assert.equal(saved.countryCode,'RO');assert.deepEqual(saved.topics,['culture']);
 assert.equal(rankContextualCards([ro,london],settings('GB',[],{query:'London'}),now).length,0);
});

test('country coverage boosts are not inferred from headlines, publisher addresses or unknown locations',()=>{
 const named=card(1,'world',{title:'Romania appears in a headline but the publisher supplies no location category'}),
  nasa=card(2,'science',{sourceIds:['nasa-news']}),uk=card(3,'public-affairs',{sourceIds:['govuk-news']});
 const ro=rankContextualCards([named,nasa,uk],settings('RO',['world','science','public-affairs']),now);
 assert.ok(ro.every(item=>!item.localMatch));
 assert.ok(rankContextualCards([named,nasa],settings('US',['world','science']),now).every(item=>!item.localMatch));
 assert.ok(rankContextualCards([named,nasa,uk],settings('XX',['world','science','public-affairs']),now).every(item=>!item.localMatch));
 const gb=rankContextualCards([named,nasa,uk],settings('GB',['world','science','public-affairs']),now);
 assert.equal(gb[0].card.id,uk.id);assert.match(gb[0].reason,/United Kingdom source scope/u);
 assert.doesNotMatch(gb[0].reason,/affects you|confirmed local|applies to you/iu);
});

test('matching informative headlines and excerpts retain each publisher record without a corroboration claim',()=>{
 const a=card(1,'science',{title:headline,summary:excerpt}),
  b=card(2,'science',{title:headline.toUpperCase(),summary:excerpt,date:'2026-11-18T09:00:00.000Z'});
 const grouped=groupRelatedListings([b,a],now);
 assert.equal(grouped.length,1);assert.equal(grouped[0].grouping,'matching-headlines');
 assert.equal(grouped[0].card.id,a.id);assert.equal(grouped[0].related[0].sourceUrl,b.sourceUrl);
 assert.equal(grouped[0].related[0].summary,b.summary);
 const chosen=rankContextualCards([a,b],settings(null,['science']),now);
 assert.equal(chosen.length,1);assert.equal(chosen[0].grouping,'matching-headlines');assert.equal(chosen[0].related.length,1);
 assert.doesNotMatch(chosen[0].reason,/independent|corroborat|confirmed by/iu);
});

test('a matching title cannot collapse absent, generic, different or disagreeing excerpts',()=>{
 const a=card(1,'science',{title:headline,summary:excerpt});
 for(const summary of [undefined,'Read the full article for more information and the complete details.',excerpt.replace('preliminary','confirmed'),excerpt.replace('report','do not report')]){
  const b=card(2,'science',{title:headline,...(summary===undefined?{}:{summary})});
  assert.equal(groupRelatedListings([a,b],now).length,2);
  assert.equal(rankContextualCards([a,b],settings(null,['science']),now).length,2);
 }
});

test('generic headlines, negations, different numbers and incompatible locations stay separate',()=>{
 const generics=[card(1,'world',{title:'Annual report on the state of the world'}),card(2,'world',{title:'Annual report on the state of the world'})];
 assert.equal(groupRelatedListings(generics,now).length,2);
 const negated=[card(3,'science',{title:headline,summary:excerpt}),card(4,'science',{title:headline.replace('identify','do not identify'),summary:excerpt})];
 assert.equal(groupRelatedListings(negated,now).length,2);
 const numbered=[card(5,'science',{title:headline+' in 2026',summary:excerpt}),card(6,'science',{title:headline+' in 2025',summary:excerpt})];
 assert.equal(groupRelatedListings(numbered,now).length,2);
 const places=[card(7,'world',{title:headline,summary:excerpt,context:context('Romania')}),card(8,'world',{title:headline,summary:excerpt,context:context('Japan')})];
 assert.equal(groupRelatedListings(places,now).length,2);
 assert.equal(groupRelatedListings([places[0],card(9,'world',{title:headline,summary:excerpt})],now).length,2);
});

test('a matching headline from another time is not merged into the current listing',()=>{
 const recent=card(1,'science',{title:headline,summary:excerpt}),earlier=card(2,'science',{title:headline,summary:excerpt,date:new Date(now-4*day).toISOString()});
 assert.equal(groupRelatedListings([recent,earlier],now).length,2);
});

test('expired checks, stale sources, future publications and out-of-window stories never fill a selection',()=>{
 const expired=card(1,'world',{observedAt:new Date(now-3_600_000).toISOString()}),
  stale=card(2,'world',{sourceState:'stale'}),future=card(3,'world',{date:new Date(now+1).toISOString()}),
  skewed=card(4,'world',{observedAt:new Date(now+300001).toISOString()}),old=card(5,'world',{date:new Date(now-14*day).toISOString()});
 assert.equal(rankContextualCards([expired,stale,future,skewed,old],settings(null,['world']),now).length,0);
 assert.equal(groupRelatedListings([expired,stale,future,skewed,old],now).length,0);
 const current=card(6,'world',{observedAt:new Date(now-3_600_000+1).toISOString()});
 assert.equal(rankContextualCards([current],settings(null,['world']),now).length,1);
 assert.equal(rankContextualCards([],settings(null,['world']),now).length,0);
});

test('explicit professional editions retain older eligible records without restoring closed notices',()=>{
 const legal=card(1,'regulation',{kind:'legal-document',date:'2026-10-01T12:00:00.000Z'}),
  open=card(2,'opportunities',{kind:'procurement-notice',title:'Contract notice: Independent translation services',deadline:'2026-11-25',date:'2026-10-01T12:00:00.000Z'}),
  closed=card(3,'opportunities',{kind:'procurement-notice',title:'Contract award notice: Independent translation services',deadline:'2026-11-25'});
 const topics=['regulation','opportunities'];
 assert.equal(rankContextualCards([legal,open,closed],settings(null,topics),now).length,0);
 assert.deepEqual(new Set(rankContextualCards([legal,open,closed],settings(null,topics,{publicationWindowMs:null}),now).map(item=>item.card.id)),new Set([legal.id,open.id]));
});

test('existing software version grouping remains inspectable',()=>{
 const newest=card(1,'technology',{kind:'software-release',sourceIds:['nodejs'],version:'22.20.0'}),
  older=card(2,'technology',{kind:'software-release',sourceIds:['nodejs'],version:'22.19.0',date:'2026-11-17T12:00:00.000Z'});
 const selected=rankContextualCards([older,newest],settings(null,['technology']),now);
 assert.equal(selected.length,1);assert.equal(selected[0].grouping,'software-versions');assert.equal(selected[0].related[0].id,older.id);
});

test('selection remains diverse, bounded and deterministic under source reordering',()=>{
 const records=[...Array.from({length:12},(_,index)=>card(index+1,'world',{publisher:'Large publisher',context:context('Romania')})),
  card(40,'science',{publisher:'Science publisher',sourceIds:['nasa-news']}),card(41,'culture',{publisher:'Culture publisher',context:context('Spain')})];
 const config=settings('RO',['world','culture','science'],{budget:5});
 const a=rankContextualCards(records,config,now),b=rankContextualCards([...records].reverse(),config,now);
 assert.equal(a.length,5);assert.equal(a[0].localMatch,true);assert.equal(new Set(a.slice(0,3).map(item=>item.card.topic)).size,3);
 assert.deepEqual(a.map(item=>item.card.id),b.map(item=>item.card.id));
 assert.equal(new Set(a.map(item=>item.card.id)).size,a.length);
});

test('repeated identical input is collapsed while contradictory identities are withheld',()=>{
 const a=card(1),conflict={...a,contentHash:'f'.repeat(64)};
 assert.equal(groupRelatedListings([a,a],now).length,1);
 assert.equal(groupRelatedListings([a,conflict],now).length,0);
});

test('invalid selector settings fail explicitly',()=>{
 for(const extra of [{budget:0},{budget:5001},{countryCode:'Romania'},{topics:['unknown']},{topics:['world','world']},{publicationWindowMs:0},{publicationWindowMs:Infinity},{query:'x'.repeat(201)}]){
  assert.throws(()=>rankContextualCards([],settings(null,['world'],extra),now),/CONTEXTUAL/);
 }
 assert.throws(()=>rankContextualCards([],settings(null,['world']),NaN),/CONTEXTUAL/);
 assert.throws(()=>groupRelatedListings([],NaN),/CONTEXTUAL/);
});
