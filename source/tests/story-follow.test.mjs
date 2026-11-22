import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {changeCategoryFollow,acknowledgeCategoryFollow,parseCategoryFollows,selectCategoryFollowReturn} from '../.build/src/iceo/category-follow.js';
import {EDITORIAL_CATEGORY_TOPICS,editorialCategory} from '../.build/src/iceo/editorial-categories.js';
import {cardContent,validCard} from '../.build/src/iceo/card-validation.js';
import {COMPARISON_MAX_AGE_MS} from '../.build/src/iceo/comparison.js';

// Controlled publisher metadata exercises the public follow contract. These
// records are not fetched articles or a claim that either publisher ran them.
const now=Date.parse('2026-11-22T10:00:00.000Z'),stamp=new Date(now).toISOString();
const revision=number=>`${number.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const bbcTitle='COP31 new draft climate deal published as talks enter their final day';
const guardianTitle='World leaders at COP31 unveil a new draft climate deal after overnight negotiations';

function article(number,title,{category='environment',publisher='BBC News',...patch}={}){
  const sourceUrl=publisher==='BBC News'?`https://www.bbc.com/news/articles/controlled-story-${number}`:`https://www.theguardian.com/environment/2026/nov/22/controlled-story-${number}`;
  const value={id:number.toString(16).padStart(24,'0'),identity:sourceUrl,title,topic:EDITORIAL_CATEGORY_TOPICS[category],kind:'publication',
    sourceUrl,publisher,sourceIds:[`news-${category}`],date:'2026-11-22T09:00:00.000Z',dateLabel:'Published',observedAt:stamp,
    boundary:'Controlled original publisher metadata.',deadline:null,version:null,attribution:publisher,sourceState:'verified',...patch};
  value.contentHash=createHash('sha256').update(JSON.stringify(cardContent(value))).digest('hex');
  assert.ok(validCard(value),'test fixture must be a valid public evidence card');
  assert.equal(editorialCategory(value),category,'test fixture must retain its intended exact category');
  return value;
}
function health(category,cards,patch={}){
  const id=`news-${category}`;
  return{id,label:`Controlled ${category} discovery source`,publisher:'Reviewed publisher listings',topic:EDITORIAL_CATEGORY_TOPICS[category],
    state:'verified',checkedAt:stamp,verifiedAt:stamp,count:cards.filter(card=>card.sourceIds.includes(id)).length,
    rejected:0,error:null,retryAt:null,scope:'Controlled checked publisher listings',termsUrl:'https://www.theguardian.com/help/terms-of-service',windowed:true,...patch};
}
function snapshot(cards=[],categories=['environment'],patch={}){
  const sources=categories.map(category=>health(category,cards));
  return{version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.46',mode:'current-source-records',generatedAt:stamp,state:'ready',
    cards,sources,conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,
    coverage:[...new Set(sources.map(source=>source.topic))],...patch};
}
function follow(initial=snapshot(),categories=['environment']){
  let state=null;
  for(const [index,category]of categories.entries())state=changeCategoryFollow(state,category,true,initial,now,revision(index+1)).state;
  assert.ok(state);
  assert.ok(state.entries.every(entry=>entry.baseline!==null),'controlled fresh sources must establish actual baselines');
  return state;
}
function freeze(value){
  if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}
  return value;
}
function originals(entry,expected){
  assert.equal(typeof entry.storyKey,'string');assert.ok(entry.storyKey.length>0);
  assert.ok(Array.isArray(entry.related));
  const actual=[entry.card,...entry.related];
  assert.equal(new Set(actual.map(card=>card.id)).size,actual.length,'each publisher article appears once within the thread');
  assert.deepEqual(actual.map(card=>card.id).sort(),expected.map(card=>card.id).sort());
  for(const card of expected)assert.deepEqual(actual.find(candidate=>candidate.id===card.id),card,'title, language-bearing source, dates and provenance remain the original article');
}
const pair=()=>[article(1,bbcTitle),article(2,guardianTitle,{publisher:'The Guardian',date:'2026-11-22T09:30:00.000Z'})];

test('two new publisher reports of COP31 are one new followed thread with both originals',()=>{
  const state=freeze(follow()),records=pair(),current=freeze(snapshot(records));
  const beforeState=JSON.stringify(state),beforeSnapshot=JSON.stringify(current);
  const result=selectCategoryFollowReturn(state,current,now,true),item=result.items[0];
  assert.equal(result.state,'complete');assert.equal(result.newCount,1);assert.equal(result.updatedCount,0);
  assert.equal(item.newCount,1);assert.equal(item.cards.length,1);assert.equal(result.highlights.length,1);
  assert.equal(item.cards[0].kind,'not-in-saved-check');assert.equal(item.cards[0].coverageOnly,false);
  originals(item.cards[0],records);originals(result.highlights[0],records);
  assert.equal(item.comparison.cards.length,2,'the validated underlying article comparison is retained');
  assert.equal(JSON.stringify(state),beforeState);assert.equal(JSON.stringify(current),beforeSnapshot);
});

test('another publisher covering an established event updates coverage instead of adding a new event',()=>{
  const [bbc,guardian]=pair(),state=freeze(follow(snapshot([bbc]))),current=freeze(snapshot([bbc,guardian]));
  const result=selectCategoryFollowReturn(state,current,now,true),entry=result.items[0].cards[0];
  assert.equal(result.newCount,0);assert.equal(result.updatedCount,1);assert.equal(result.items[0].cards.length,1);
  assert.equal(entry.kind,'listing-updated');assert.equal(entry.coverageOnly,true);assert.deepEqual(entry.changes,[]);
  originals(entry,[bbc,guardian]);
  const first=selectCategoryFollowReturn(follow(),snapshot([bbc]),now,true).items[0].cards[0];
  assert.equal(entry.storyKey,first.storyKey,'an added source cannot change the event identity');
  assert.deepEqual(state.entries[0].baseline.records,[bbc],'reading coverage never acknowledges or rewrites the baseline');
});

test('explicit ACK, reload and article order changes leave the same thread at zero new and updated',()=>{
  const records=pair(),current=freeze(snapshot(records));
  let state=follow();
  for(const number of [10,11]){
    state=parseCategoryFollows(acknowledgeCategoryFollow(state,'environment',current,now,revision(number)));
    assert.ok(state);assert.deepEqual(state.entries[0].baseline.records,records);
    for(const candidate of [current,snapshot([...records].reverse())]){
      const result=selectCategoryFollowReturn(state,candidate,now,true);
      assert.equal(result.state,'complete');assert.equal(result.newCount,0);assert.equal(result.updatedCount,0);
      assert.deepEqual(result.items[0].cards,[]);assert.deepEqual(result.highlights,[]);
    }
  }
});

test('a real original-title correction stays attributed to the changed publisher within its thread',()=>{
  const [bbc,guardian]=pair(),state=freeze(follow(snapshot([bbc,guardian])));
  const corrected=article(1,'COP31 new draft climate deal removes a fossil fuel deadline after talks');
  const result=selectCategoryFollowReturn(state,freeze(snapshot([corrected,guardian])),now,true),entry=result.items[0].cards[0];
  assert.equal(result.newCount,0);assert.equal(result.updatedCount,1);assert.equal(entry.coverageOnly,false);
  assert.equal(entry.card.id,corrected.id,'a BBC metadata delta cannot be attached to the unchanged Guardian representative');
  assert.deepEqual(entry.changes,[{field:'title',before:bbc.title,after:corrected.title}]);
  originals(entry,[corrected,guardian]);
  assert.deepEqual(state.entries[0].baseline.records,[bbc,guardian]);
});

test('one event present in two followed categories is counted once in the aggregate',()=>{
  const bbc=article(1,bbcTitle),guardian=article(2,guardianTitle,{category:'world',publisher:'The Guardian'});
  const categories=['environment','world'],state=freeze(follow(snapshot([],categories),categories));
  const result=selectCategoryFollowReturn(state,freeze(snapshot([bbc,guardian],categories)),now,true);
  assert.equal(result.state,'complete');assert.equal(result.items.length,2);
  assert.ok(result.items.every(item=>item.newCount===1&&item.updatedCount===0));
  assert.equal(result.items[0].cards[0].storyKey,result.items[1].cards[0].storyKey);
  assert.equal(result.newCount,1);assert.equal(result.updatedCount,0);assert.equal(result.highlights.length,1);
  originals(result.highlights[0],[bbc,guardian]);
});

test('an event already known in another followed category is not globally new coverage',()=>{
  const bbc=article(1,bbcTitle),guardian=article(2,guardianTitle,{category:'world',publisher:'The Guardian'});
  const categories=['environment','world'],state=freeze(follow(snapshot([bbc],categories),categories));
  const result=selectCategoryFollowReturn(state,freeze(snapshot([bbc,guardian],categories)),now,true);
  assert.equal(result.items.find(item=>item.category==='environment').newCount,0);
  assert.equal(result.newCount,0,'a new category placement does not make the known event new again');
  assert.equal(result.updatedCount,1);assert.equal(result.highlights.length,1);
  assert.equal(result.highlights[0].coverageOnly,true);originals(result.highlights[0],[bbc,guardian]);
});

test('a different conference edition and an unrelated environmental event remain separate',()=>{
  const records=[...pair(),article(3,'COP32 new draft climate deal published as talks enter their final day'),
    article(4,'National park launches a wetland restoration project')];
  const result=selectCategoryFollowReturn(follow(),freeze(snapshot(records)),now,true);
  assert.equal(result.newCount,3);assert.equal(result.updatedCount,0);assert.equal(result.items[0].cards.length,3);
  const cop31=result.items[0].cards.find(entry=>[entry.card,...entry.related].some(card=>card.id===records[0].id));
  originals(cop31,records.slice(0,2));
  assert.equal(new Set(result.items[0].cards.map(entry=>entry.storyKey)).size,3);
  assert.deepEqual(result.items[0].cards.flatMap(entry=>[entry.card,...entry.related]).map(card=>card.id).sort(),records.map(card=>card.id).sort());
});

test('grouping retains partial source coverage and the excluded-conflict baseline limitation',()=>{
  const records=pair(),partial=freeze(snapshot(records,['environment'],{state:'partial',sources:[health('environment',records,{state:'partial',rejected:1})]}));
  const limited=selectCategoryFollowReturn(follow(),partial,now,true);
  assert.equal(limited.state,'partial');assert.equal(limited.items[0].comparison.state,'partial');assert.equal(limited.newCount,1);
  const quarantined=freeze(snapshot(records,['environment'],{state:'partial',conflictCount:1})),state=freeze(follow(quarantined));
  const clean=freeze(snapshot(records)),before=JSON.stringify(state),same=selectCategoryFollowReturn(state,clean,now,true);
  assert.equal(same.state,'partial');assert.equal(same.excludedConflicts,true);assert.equal(same.items[0].comparison.state,'partial');
  assert.equal(same.newCount,0);assert.equal(same.updatedCount,0);assert.equal(JSON.stringify(state),before);
  const accepted=acknowledgeCategoryFollow(state,'environment',clean,now,revision(12));
  assert.equal(selectCategoryFollowReturn(accepted,clean,now,true).state,'complete');
});

test('stale, unavailable and malformed catalogs never acquire usable changes through grouping',()=>{
  const records=pair(),state=freeze(follow()),current=freeze(snapshot(records));
  const boundary=selectCategoryFollowReturn(state,current,now+COMPARISON_MAX_AGE_MS,true);
  assert.equal(boundary.state,'complete');assert.equal(boundary.newCount,1,'grouping preserves the existing inclusive comparison freshness limit');
  for(const [candidate,at,available,expected]of [
    [current,now+COMPARISON_MAX_AGE_MS+1,true,'stale'],
    [current,now,false,'unavailable'],
    [snapshot(records,['environment'],{state:'unavailable',sources:[health('environment',records,{state:'unavailable',verifiedAt:null,error:'OFFLINE'})]}),now,true,'unavailable'],
    [snapshot(records,['environment'],{conflictCount:1}),now,true,'unavailable'],
    [snapshot(records,['environment'],{sources:[health('environment',records,{count:42})]}),now,true,'unavailable'],
    [snapshot([records[0],{...records[1],identity:records[0].identity}]),now,true,'unavailable'],
  ]){
    const before=JSON.stringify(candidate),result=selectCategoryFollowReturn(state,freeze(candidate),at,available);
    assert.equal(result.state,expected);assert.equal(result.newCount,0);assert.equal(result.updatedCount,0);
    assert.deepEqual(result.highlights,[]);assert.deepEqual(result.items[0].cards,[]);assert.equal(result.items[0].canAcknowledge,false);
    assert.equal(JSON.stringify(candidate),before);
  }
});

test('a current followed thread does not disclose expired, future or unavailable related observations',()=>{
  const bbc=article(1,bbcTitle),state=freeze(follow());
  const cases=[
    [{observedAt:new Date(now-COMPARISON_MAX_AGE_MS-1).toISOString()},{}],
    [{observedAt:new Date(now+300_001).toISOString()},{}],
    [{sourceState:'stale'},{}],
    [{},{state:'unavailable',verifiedAt:null,error:'OFFLINE'}],
    [{},{state:'stale'}],
  ];
  for(const [recordPatch,sourcePatch]of cases){
    const guardian=article(2,guardianTitle,{category:'world',publisher:'The Guardian',...recordPatch});
    const records=[bbc,guardian],current=freeze(snapshot(records,['environment','world'],{state:'partial',
      sources:[health('environment',records),health('world',records,sourcePatch)]}));
    const before=JSON.stringify(current),result=selectCategoryFollowReturn(state,current,now,true);
    assert.equal(result.state,'complete','an unrelated failed source does not invalidate the healthy followed category');
    assert.equal(result.newCount,1);assert.equal(result.updatedCount,0);assert.equal(result.items[0].cards.length,1);
    originals(result.items[0].cards[0],[bbc]);assert.equal(JSON.stringify(current),before);
  }
});
