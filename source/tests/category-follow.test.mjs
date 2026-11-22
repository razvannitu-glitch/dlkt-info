import test from 'node:test';
import assert from 'node:assert/strict';
import {CATEGORY_FOLLOW_VERSION,parseCategoryFollows,changeCategoryFollow,acknowledgeCategoryFollow,selectCategoryFollowReturn,nextCategoryFollowDelay,captureCategoryFollowBaseline} from '../.build/src/iceo/category-follow.js';
import {EDITORIAL_CATEGORIES_VERSION,EDITORIAL_CATEGORY_TOPICS} from '../.build/src/iceo/editorial-categories.js';
import {COMPARISON_MAX_AGE_MS} from '../.build/src/iceo/comparison.js';

const now=Date.parse('2026-11-22T10:00:00.000Z'),stamp=new Date(now).toISOString();
const rev=number=>`${number.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
function card(category,number=1,patch={}){
  return{id:number.toString(16).padStart(24,'0'),identity:`article-${number}`,title:`Original verified ${category} listing`,topic:EDITORIAL_CATEGORY_TOPICS[category],kind:'publication',
    sourceUrl:`https://www.theguardian.com/world/2026/nov/22/article-${number}`,publisher:'The Guardian',sourceIds:[`news-${category}`],date:'2026-11-22T09:00:00.000Z',dateLabel:'Published',observedAt:stamp,
    contentHash:'b'.repeat(64),boundary:'Verified original publisher metadata.',deadline:null,version:null,attribution:'The Guardian',sourceState:'verified',...patch};
}
function source(category,cards,patch={}){
  const id=patch.id??`news-${category}`;
  return{id,label:`Checked ${category} source`,publisher:'The Guardian',topic:EDITORIAL_CATEGORY_TOPICS[category],state:'verified',checkedAt:stamp,verifiedAt:stamp,
    count:cards.filter(item=>item.sourceIds.includes(id)).length,rejected:0,error:null,retryAt:null,scope:'Checked publisher listings',termsUrl:'https://www.theguardian.com/help/terms-of-service',windowed:true,...patch};
}
function snapshot(cards=[card('gaming')],sources){
  const feeds=sources??[...new Set(cards.flatMap(item=>item.sourceIds))].map(id=>source(id.slice(5),cards));
  return{version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.46',mode:'current-source-records',generatedAt:stamp,state:'ready',sources:feeds,cards,conflictCount:0,duplicateCount:0,
    deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:[...new Set(feeds.map(item=>item.topic))]};
}
const followed=(category='gaming',current=snapshot(),number=1)=>changeCategoryFollow(null,category,true,current,now,rev(number)).state;
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

test('displayed gaming, shopping, work, education and family are independent exact follow IDs',()=>{
  const categories=['gaming','shopping','work','education','family'],cards=categories.map((category,index)=>card(category,index+1)),current=snapshot(cards);
  let state=null;
  for(const [index,category]of categories.entries())state=changeCategoryFollow(state,category,true,current,now,rev(index+1)).state;
  assert.deepEqual(state.entries.map(entry=>entry.category),categories);
  for(const entry of state.entries){assert.equal(entry.baseline.records.length,1);assert.deepEqual(entry.baseline.records[0],cards.find(item=>item.sourceIds.includes(`news-${entry.category}`)));}
  assert.equal(state.entries.find(entry=>entry.category==='gaming').baseline.records[0].topic,'culture');
  assert.equal(state.entries.find(entry=>entry.category==='work').baseline.records[0].topic,'work-education');
  assert.equal(state.entries.find(entry=>entry.category==='education').baseline.records[0].topic,'work-education');
  assert.throws(()=>changeCategoryFollow(state,'work-education',true,current,now,rev(10)),/CATEGORY_FOLLOW_DATA_INVALID/u);
});

test('explicit follow captures only its actual category and excludes unrelated failed sources',()=>{
  const gaming=card('gaming'),culture=card('culture',2),current=snapshot([gaming,culture],[source('gaming',[gaming]),source('culture',[culture],{state:'unavailable',error:'OFFLINE',verifiedAt:null})]);
  const result=followed('gaming',current);assert.equal(result.entries[0].baseline.records.length,1);assert.deepEqual(result.entries[0].baseline.sources.map(item=>item.id),['news-gaming']);
  assert.equal(selectCategoryFollowReturn(result,current,now,true).state,'complete');
});

test('same desired follow state is a no-write no-op and cannot acknowledge newer metadata',()=>{
  const state=followed(),next=snapshot([card('gaming',1,{title:'Changed original gaming title'})]);
  const repeated=changeCategoryFollow(state,'gaming',true,next,now+1000,rev(2));
  assert.equal(repeated.changed,false);assert.deepEqual(repeated.state,state);
  const removed=changeCategoryFollow(state,'gaming',false,next,now+1000,rev(3));assert.equal(removed.changed,true);assert.equal(removed.state.entries.length,0);assert.equal(removed.state.revision,rev(3));
  assert.deepEqual(changeCategoryFollow(removed.state,'gaming',false,next,now+2000,rev(4)),{changed:false,state:removed.state});
  assert.deepEqual(changeCategoryFollow(null,'gaming',false,null,now,rev(5)),{changed:false,state:null});
});

test('absence of follows, absence of a baseline and failed refresh are distinct',()=>{
  assert.equal(selectCategoryFollowReturn(null,snapshot(),now,true).state,'empty');
  const missing=followed('gaming',null);assert.equal(missing.entries[0].baseline,null);
  assert.equal(selectCategoryFollowReturn(missing,snapshot(),now,true).state,'baseline-required');
  assert.equal(selectCategoryFollowReturn(missing,snapshot(),now,true).items[0].canAcknowledge,true);
  const unavailable=selectCategoryFollowReturn(followed(),snapshot(),now,false);assert.equal(unavailable.state,'unavailable');assert.equal(unavailable.items[0].comparison,null);assert.equal(unavailable.items[0].canAcknowledge,false);
  const initialized=acknowledgeCategoryFollow(missing,'gaming',snapshot(),now,rev(2));assert.equal(selectCategoryFollowReturn(initialized,snapshot(),now,true).state,'complete');
});

test('return counts original metadata changes and older new-to-check listings without rewriting the baseline',()=>{
  const state=freeze(followed()),before=JSON.stringify(state);
  const current=freeze(snapshot([card('gaming',1,{title:'Corrected publisher wording: offer does not include travel'}),card('gaming',2,{date:'2024-01-01'}),card('culture',3)]));
  for(let index=0;index<3;index++){
    const result=selectCategoryFollowReturn(state,current,now,true);
    assert.equal(result.state,'complete');assert.equal(result.newCount,1);assert.equal(result.updatedCount,1);
    assert.equal(result.items[0].cards[0].changes[0].after,'Corrected publisher wording: offer does not include travel');
    assert.equal(result.highlights[1].kind,'not-in-saved-check');assert.equal(result.highlights[1].card.date,'2024-01-01');assert.equal(result.highlights[1].category,'gaming');
    assert.equal(JSON.stringify(state),before);
  }
  const transport=selectCategoryFollowReturn(state,snapshot([card('gaming',1,{contentHash:'c'.repeat(64),observedAt:new Date(now+1000).toISOString()})]),now+1000,true);
  assert.equal(transport.newCount+transport.updatedCount,0);
});

test('acknowledgement advances only the selected category, retaining all other baselines',()=>{
  const current=snapshot([card('gaming'),card('education',2)]);
  const one=followed('gaming',current),both=changeCategoryFollow(one,'education',true,current,now,rev(2)).state;
  const changed=snapshot([card('gaming',1,{title:'Publisher revised gaming listing'}),card('education',2,{title:'Publisher revised education listing'})]);
  const priorEducation=JSON.stringify(both.entries.find(entry=>entry.category==='education'));
  const acknowledged=acknowledgeCategoryFollow(both,'gaming',changed,now+1000,rev(3));
  assert.equal(JSON.stringify(acknowledged.entries.find(entry=>entry.category==='education')),priorEducation);
  const result=selectCategoryFollowReturn(acknowledged,changed,now+1000,true);
  assert.equal(result.items.find(item=>item.category==='gaming').updatedCount,0);assert.equal(result.items.find(item=>item.category==='education').updatedCount,1);
});

test('shared broad feeds validate original counts then retain established zero-result checks',()=>{
  const gaming=card('gaming',1,{sourceIds:['editorial-frontpage'],title:'Nintendo announces a new video game'}),culture=card('culture',2,{sourceIds:['editorial-frontpage'],title:'Museum opens a new art exhibition'});
  const broad=source('world',[gaming,culture],{id:'editorial-frontpage'}),initial=snapshot([gaming,culture],[broad]),state=followed('gaming',initial);
  assert.equal(state.entries[0].baseline.records.length,1);assert.equal(state.entries[0].baseline.sources[0].recordCount,1);
  const empty=snapshot([culture],[{...broad,count:1}]),result=selectCategoryFollowReturn(state,empty,now,true);
  assert.equal(result.state,'complete');assert.equal(result.newCount+result.updatedCount,0);assert.equal(result.items[0].comparison.comparableSources,1);
  const acknowledged=acknowledgeCategoryFollow(state,'gaming',empty,now+1000,rev(2));assert.equal(acknowledged.entries[0].baseline.records.length,0);assert.equal(acknowledged.entries[0].baseline.sources[0].recordCount,0);
  const returned=selectCategoryFollowReturn(acknowledged,initial,now+1000,true);assert.equal(returned.newCount,1);
  assert.equal(followed('gaming',snapshot([gaming,culture],[{...broad,count:7}])).entries[0].baseline,null);
});

test('fresh explicit empty category sources can establish a baseline without inventing coverage from a coarse topic',()=>{
  const empty=snapshot([],[source('gaming',[])]),state=followed('gaming',empty);assert.equal(state.entries[0].baseline.records.length,0);
  assert.equal(selectCategoryFollowReturn(state,snapshot(),now,true).newCount,1);
  const ambiguous=snapshot([],[source('culture',[],{id:'editorial-frontpage',topic:'culture'})]);
  assert.equal(followed('gaming',ambiguous).entries[0].baseline,null);
});

test('partial source checks remain partial after refresh and become complete only after explicit fresh acknowledgement',()=>{
  const partial=snapshot([card('gaming')],[source('gaming',[card('gaming')],{state:'partial',rejected:2})]);partial.state='partial';
  const state=followed('gaming',partial);assert.equal(selectCategoryFollowReturn(state,snapshot(),now,true).state,'partial');
  assert.equal(selectCategoryFollowReturn(followed(),partial,now,true).state,'partial');
  const accepted=acknowledgeCategoryFollow(state,'gaming',snapshot(),now+1000,rev(2));assert.equal(selectCategoryFollowReturn(accepted,snapshot(),now+1000,true).state,'complete');
});

test('freshness is inclusive at the existing limit and becomes explicit stale immediately after it',()=>{
  const state=followed();assert.equal(nextCategoryFollowDelay(state,snapshot(),now),COMPARISON_MAX_AGE_MS+1);
  assert.equal(selectCategoryFollowReturn(state,snapshot(),now+COMPARISON_MAX_AGE_MS,true).state,'complete');
  assert.equal(nextCategoryFollowDelay(state,snapshot(),now+COMPARISON_MAX_AGE_MS),1);
  const stale=selectCategoryFollowReturn(state,snapshot(),now+COMPARISON_MAX_AGE_MS+1,true);assert.equal(stale.state,'stale');assert.equal(stale.items[0].canAcknowledge,false);
  assert.equal(nextCategoryFollowDelay(state,snapshot(),now+COMPARISON_MAX_AGE_MS+1),null);
  assert.equal(followed('gaming',snapshot([card('gaming')],[source('gaming',[card('gaming')],{state:'stale'})])).entries[0].baseline,null);
});

test('regressed, future, inconsistent and unavailable observations cannot replace a category baseline',()=>{
  const state=followed(),before=JSON.stringify(state);
  for(const patch of [{verifiedAt:new Date(now-1).toISOString()},{verifiedAt:new Date(now+300001).toISOString()},{count:8},{state:'unavailable',verifiedAt:null,error:'OFFLINE'}]){
    const current=snapshot([card('gaming')],[source('gaming',[card('gaming')],patch)]);
    assert.throws(()=>acknowledgeCategoryFollow(state,'gaming',current,now,rev(2)));
    const result=selectCategoryFollowReturn(state,current,now,true);assert.equal(result.state,'unavailable');assert.equal(result.items[0].canAcknowledge,false);assert.equal(JSON.stringify(state),before);
  }
  assert.throws(()=>acknowledgeCategoryFollow(state,'gaming',snapshot(),now-1,rev(2)),/OLDER_OBSERVATION/u);
  assert.equal(selectCategoryFollowReturn(state,snapshot(),now-300001,true).state,'unavailable');
});

test('new sources without a baseline are partial, and missing established sources block acknowledgement',()=>{
  const initialCard=card('gaming',1,{sourceIds:['editorial-frontpage'],title:'Nintendo announces a video game'}),initialSource=source('world',[initialCard],{id:'editorial-frontpage'}),state=followed('gaming',snapshot([initialCard],[initialSource]));
  const extra=card('gaming',2),expanded=snapshot([initialCard,extra],[initialSource,source('gaming',[extra])]);
  const result=selectCategoryFollowReturn(state,expanded,now,true);assert.equal(result.state,'partial');assert.equal(result.newCount,0);
  const accepted=acknowledgeCategoryFollow(state,'gaming',expanded,now,rev(2));assert.equal(selectCategoryFollowReturn(accepted,expanded,now,true).state,'complete');
  const missing=snapshot([extra],[source('gaming',[extra])]);assert.equal(selectCategoryFollowReturn(accepted,missing,now,true).state,'partial');
  assert.throws(()=>acknowledgeCategoryFollow(accepted,'gaming',missing,now,rev(3)),/SOURCE_CHECK_REQUIRED/u);
});

test('classifier revision changes require explicit re-baselining and never create a false new spike',()=>{
  const state=followed();const older={...state,entries:state.entries.map(entry=>({...entry,classifierVersion:'dlkt-public-editorial-categories-0'}))};
  assert.ok(parseCategoryFollows(older));const next=snapshot([card('gaming'),card('gaming',2)]),result=selectCategoryFollowReturn(older,next,now,true);
  assert.equal(result.state,'baseline-required');assert.equal(result.newCount,0);assert.deepEqual(result.highlights,[]);assert.equal(result.items[0].canAcknowledge,true);
  const acknowledged=acknowledgeCategoryFollow(older,'gaming',next,now,rev(2));assert.equal(acknowledged.entries[0].classifierVersion,EDITORIAL_CATEGORIES_VERSION);assert.equal(selectCategoryFollowReturn(acknowledged,next,now,true).newCount,0);
});

test('stored follows reject duplicate IDs, unsafe records and malformed revisions while copying only known fields',()=>{
  const state=followed(),entry=state.entries[0];
  for(const patch of [{version:'other'},{revision:'bad'},{entries:[entry,entry]},{entries:[{...entry,category:'work-education'}]},{entries:[{...entry,followedAt:'2026-02-30T10:00:00.000Z'}]},
    {entries:[{...entry,classifierVersion:'<script>'}]},{entries:[{...entry,baseline:{...entry.baseline,records:[{...entry.baseline.records[0],sourceUrl:'javascript:alert(1)'}]}}]},
    {entries:[{...entry,category:'culture'}]}])assert.equal(parseCategoryFollows({...state,...patch}),null);
  const safe=parseCategoryFollows({...state,token:'never-retain',entries:[{...entry,privateEmail:'never-retain',baseline:{...entry.baseline,secret:'never-retain',records:[{...entry.baseline.records[0],accessToken:'never-retain'}]}}]});
  assert.deepEqual(safe,state);assert.notEqual(safe.entries[0].baseline.records[0].sourceIds,entry.baseline.records[0].sourceIds);
  assert.equal(selectCategoryFollowReturn({...state,revision:'bad'},snapshot(),now,true).state,'invalid');
  assert.equal(parseCategoryFollows({version:CATEGORY_FOLLOW_VERSION,revision:rev(2),entries:[]}).entries.length,0);
});

test('highlights are deterministic and bounded while full scoped counts remain available',()=>{
  const state=followed('gaming',snapshot([],[source('gaming',[])])),cards=Array.from({length:12},(_,index)=>card('gaming',index+1));
  const result=selectCategoryFollowReturn(state,snapshot(cards),now,true);assert.equal(result.newCount,12);assert.equal(result.items[0].cards.length,12);assert.equal(result.highlights.length,6);
  assert.deepEqual(result.highlights.map(item=>item.card.id),cards.slice(0,6).map(item=>item.id));
  assert.throws(()=>captureCategoryFollowBaseline({...snapshot(),conflictCount:1},'gaming',now,rev(2)));
});
