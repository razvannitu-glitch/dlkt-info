import test from 'node:test';
import assert from 'node:assert/strict';
import {balanceNewsEdition} from '../.build/src/iceo/news-edition-order.js';

const BANDS=['local','national','international'];
const rank=new Map(BANDS.map((band,index)=>[band,index]));
const owner=item=>item.publisher.normalize('NFKC').trim().toLowerCase();
const order=items=>balanceNewsEdition(items,item=>item.category,item=>item.publisher,item=>item.band);
const row=(id,category,publisher,band='international')=>({id,category,publisher,band,title:'Original headline '+id});

function cycles(items){
 const remaining=new Map();
 for(const item of items)remaining.set(item.category,(remaining.get(item.category)??0)+1);
 let offset=0;
 while(offset<items.length){
  const active=[...remaining].filter(([,count])=>count>0).map(([category])=>category),cycle=items.slice(offset,offset+active.length);
  assert.deepEqual(new Set(cycle.map(item=>item.category)),new Set(active));
  if(offset&&active.length>1)assert.notEqual(items[offset-1].category,cycle[0].category);
  for(const item of cycle)remaining.set(item.category,remaining.get(item.category)-1);
  offset+=active.length;
 }
}
function geographicOrder(items){
 for(let index=1;index<items.length;index++)assert.ok(rank.get(items[index-1].band)<=rank.get(items[index].band),
  'a later geographic band never precedes an unfinished earlier band');
}
function stableQueues(input,items){
 const key=item=>JSON.stringify([item.band,item.category,owner(item)]);
 for(const identity of new Set(input.map(key)))assert.deepEqual(items.filter(item=>key(item)===identity),input.filter(item=>key(item)===identity),
  'original order remains intact inside each category/publisher/band queue');
}

test('complete geographic bands span pages while scarce education and science remain visible in every band',()=>{
 const makeBand=band=>[
  ...Array.from({length:36},(_,index)=>row(band+'-a-'+index,'economy','Shared A',band)),
  ...Array.from({length:36},(_,index)=>row(band+'-b-'+index,'economy','Shared B',band)),
  row(band+'-education','education','Shared A',band),row(band+'-science','science','Shared B',band),
 ];
 // Deliberately place international records ahead of matching local queues.
 const input=Object.freeze(['international','national','local'].flatMap(makeBand).map(item=>Object.freeze(item)));
 const before=JSON.stringify(input),items=order(input);
 assert.equal(items.length,222);assert.ok(items.length>3*20);
 assert.deepEqual(items.map(item=>item.band),BANDS.flatMap(band=>Array(74).fill(band)));geographicOrder(items);
 for(const band of BANDS){
  const within=items.filter(item=>item.band===band);cycles(within);
  assert.deepEqual(new Set(within.slice(0,3).map(item=>item.category)),new Set(['economy','education','science']));
  assert.deepEqual(new Set(within.map(owner)),new Set(['shared a','shared b']));
 }
 for(let boundary=20;boundary<items.length;boundary+=20)if(items[boundary-1].band===items[boundary].band){
  assert.notEqual(owner(items[boundary-1]),owner(items[boundary]),'publisher alternation crosses page boundaries within the band');
 }
 stableQueues(input,items);assert.deepEqual(order(input),items);assert.equal(JSON.stringify(input),before);
 assert.ok(Object.isFrozen(items));assert.deepEqual(new Set(items),new Set(input),'original source objects stay intact');
 const economy=items.filter(item=>item.category==='economy');
 assert.equal(economy.length,216);assert.deepEqual(economy.map(item=>item.band),BANDS.flatMap(band=>Array(72).fill(band)));
 stableQueues(input.filter(item=>item.category==='economy'),economy);
 const pages=[];for(let offset=0;offset<economy.length;offset+=20)pages.push(economy.slice(offset,offset+20));
 assert.ok(pages.length>3);assert.deepEqual(pages.flat(),economy);geographicOrder(pages.flat());
});

test('all active categories and publishers participate in complete cycles independently within each band',()=>{
 const categories=Array.from({length:18},(_,index)=>'category-'+index);
 const input=['international','national','local'].flatMap(band=>categories.flatMap((category,index)=>
  Array.from({length:4},(_,position)=>row(band+'-'+index+'-'+position,category,['A','B','C','A'][position],band))));
 const items=order(input);assert.equal(items.length,216);geographicOrder(items);
 for(const band of BANDS){
  const within=items.filter(item=>item.band===band);assert.equal(within.length,72);cycles(within);
  assert.equal(new Set(within.slice(0,18).map(item=>item.category)).size,18);
  assert.deepEqual(new Set(within.slice(0,18).map(item=>item.publisher)),new Set(['A','B','C']));
 }
 assert.equal(new Set(items.map(item=>item.id)).size,input.length);stableQueues(input,items);
 let prefix=[];for(let count=20;count<items.length+20;count+=20){const visible=items.slice(0,count);assert.deepEqual(visible.slice(0,prefix.length),prefix);prefix=visible;}
 assert.deepEqual(prefix,items);
});

test('earlier records in another band cannot hide local entries from the same publisher and category',()=>{
 const input=[
  row('world-a','science','Shared A','international'),row('world-b','science','Shared B','international'),
  row('national-a','science','Shared A','national'),row('national-b','science','Shared B','national'),
  row('local-a','science','Shared A','local'),row('local-b','science','Shared B','local'),
 ];
 const items=order(input);
 assert.deepEqual(items.map(item=>item.id),['local-a','local-b','national-a','national-b','world-a','world-b']);
 stableQueues(input,items);assert.deepEqual(new Set(items),new Set(input));
 assert.equal(order(input.filter(item=>item.band!=='local'))[0].band,'national');
 const worldOnly=input.filter(item=>item.band==='international');assert.deepEqual(order(worldOnly),worldOnly);
});

test('publisher exposure resets for the next band instead of carrying earlier publisher dominance',()=>{
 const national=['A','B','C'].flatMap(publisher=>Array.from({length:12},(_,index)=>row('national-'+publisher+'-'+index,'science',publisher,'national')));
 const local=Array.from({length:40},(_,index)=>row('local-'+index,'science','A','local'));
 const input=[...national,...local],items=order(input);assert.deepEqual(items.slice(0,local.length),local);
 const next=items.slice(local.length);assert.equal(next.length,36);
 assert.deepEqual(new Set(next.slice(0,3).map(item=>item.publisher)),new Set(['A','B','C']));
 for(const publisher of ['A','B','C'])assert.equal(next.slice(0,12).filter(item=>item.publisher===publisher).length,4);
 stableQueues(input,items);
});

test('cycle and band edges prefer a different category and publisher when alternatives are compatible',()=>{
 const input=[
  row('national-repeat','science','A','national'),row('national-alternative','education','B','national'),
  row('local-science-1','science','A','local'),row('local-science-2','science','A','local'),
  row('local-education-1','education','B','local'),row('local-education-2','education','B','local'),
  row('local-culture-1','culture','C','local'),row('local-culture-2','culture','C','local'),
 ];
 const items=order(input),local=items.filter(item=>item.band==='local');cycles(local);
 for(let index=1;index<local.length;index++){assert.notEqual(local[index].category,local[index-1].category);assert.notEqual(owner(local[index]),owner(local[index-1]));}
 const boundary=order([row('national-repeat','science','A','national'),row('national-alternative','education','B','national'),row('local-only','science','A','local')]);
 assert.deepEqual(boundary.map(item=>item.id),['local-only','national-alternative','national-repeat']);
 geographicOrder(items);stableQueues(input,items);
});

test('scarce categories and single-publisher tails remain complete when alternation is impossible',()=>{
 const input=['international','national','local'].flatMap(band=>[
  ...Array.from({length:45},(_,index)=>row(band+'-science-'+index,'science','A',band)),
  ...Array.from({length:4},(_,index)=>row(band+'-sport-'+index,'sport','B',band)),
  ...Array.from({length:2},(_,index)=>row(band+'-weather-'+index,'weather','C',band)),
 ]);
 const items=order(input);assert.equal(items.length,153);geographicOrder(items);
 for(const band of BANDS){const within=items.filter(item=>item.band===band);cycles(within);assert.equal(within.length,51);assert.equal(within.slice(-20).every(item=>item.category==='science'&&item.publisher==='A'),true);}
 assert.equal(new Set(items.map(item=>item.id)).size,input.length);stableQueues(input,items);
 const empty=order([]);assert.deepEqual(empty,[]);assert.ok(Object.isFrozen(empty));
 const only=input.filter(item=>item.band==='national'&&item.publisher==='B');assert.deepEqual(order(only),only);
});

test('publisher normalization remains band-local and never rewrites original attribution',()=>{
 const labels=['Example News',' example NEWS ','Ｅｘａｍｐｌｅ Ｎｅｗｓ'];
 const input=['international','national','local'].flatMap(band=>[
  ...Array.from({length:6},(_,index)=>row(band+'-alias-'+index,'science',labels[index%labels.length],band)),
  ...Array.from({length:6},(_,index)=>row(band+'-independent-'+index,'science','Independent',band)),
 ]);
 const items=order(input);geographicOrder(items);
 for(const band of BANDS){const within=items.filter(item=>item.band===band);for(let index=1;index<within.length;index++)assert.notEqual(owner(within[index]),owner(within[index-1]));}
 stableQueues(input,items);assert.deepEqual(new Set(items),new Set(input));
 for(const label of labels)assert.ok(items.some(item=>item.publisher===label));
});

test('the ordering boundary preserves the supported maximum and rejects invalid identities and scopes',()=>{
 for(const input of [null,undefined,{},'not-an-array'])assert.throws(()=>order(input),/NEWS_EDITION_ORDER_INPUT_INVALID/);
 const record=row('capacity','science','A','local'),accepted=order(Array(5000).fill(record));
 assert.equal(accepted.length,5000);assert.ok(accepted.every(item=>item===record));assert.ok(Object.isFrozen(accepted));
 assert.throws(()=>order(Array(5001).fill(record)),/NEWS_EDITION_ORDER_INPUT_INVALID/);
 for(const category of ['', '  ', null, 12])assert.throws(()=>order([row('category',category,'A')]),/NEWS_EDITION_ORDER_IDENTITY_INVALID/);
 for(const publisher of ['', '  ', null, 12])assert.throws(()=>order([row('publisher','science',publisher)]),/NEWS_EDITION_ORDER_IDENTITY_INVALID/);
 for(const band of ['invented','LOCAL','',null,12])assert.throws(()=>order([row('scope','science','A',band)]),/NEWS_EDITION_ORDER_SCOPE_INVALID/);
});
