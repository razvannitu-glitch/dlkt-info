import test from 'node:test';
import assert from 'node:assert/strict';
import {balanceNewsEdition} from '../.build/src/iceo/news-edition-order.js';

const order=items=>balanceNewsEdition(items,item=>item.category,item=>item.publisher,item=>item.band);
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
const row=(id,category,publisher,band='international')=>({id,category,publisher,band,title:'Original headline '+id});

test('publisher balance spans page boundaries and preserves every original in publisher order',()=>{
 const input=[...Array.from({length:35},(_,i)=>row('national-'+i,'science','National','national')),
  ...Array.from({length:35},(_,i)=>row('world-'+i,'science','International'))],before=JSON.stringify(input);
 const items=order(input);
 assert.equal(items[0],input[0]);assert.equal(items.length,70);
 for(let index=1;index<items.length;index++)assert.notEqual(items[index].publisher,items[index-1].publisher);
 assert.notEqual(items[19].publisher,items[20].publisher);
 assert.notEqual(items[39].publisher,items[40].publisher);
 for(const publisher of ['National','International'])assert.deepEqual(items.filter(item=>item.publisher===publisher),input.filter(item=>item.publisher===publisher));
 assert.deepEqual(order(input),items);assert.equal(JSON.stringify(input),before);
 assert.ok(Object.isFrozen(items));
 assert.deepEqual(new Set(items),new Set(input),'ordering preserves the same objects, not rewritten articles');
});

test('all categories and publishers participate in complete cycles across a whole edition',()=>{
 const categories=Array.from({length:18},(_,index)=>'category-'+index);
 const input=categories.flatMap((category,index)=>Array.from({length:4},(_,position)=>
  row(index+'-'+position,category,['A','B','C','A'][position],position===0?'national':'international')));
 const items=order(input);
 assert.equal(items.length,72);cycles(items);
 assert.equal(new Set(items.slice(0,18).map(item=>item.category)).size,18);
 assert.deepEqual(new Set(items.slice(0,18).map(item=>item.publisher)),new Set(['A','B','C']));
 assert.equal(new Set(items.map(item=>item.id)).size,72);
 for(const category of categories)for(const publisher of ['A','B','C']){
  assert.deepEqual(items.filter(item=>item.category===category&&item.publisher===publisher),
   input.filter(item=>item.category===category&&item.publisher===publisher),'editorial order remains intact inside each publisher/category queue');
 }
 let prefix=[];
 for(const count of [20,40,60,80]){
  const page=items.slice(0,count);assert.deepEqual(page.slice(0,prefix.length),prefix);prefix=page;
 }
 assert.deepEqual(prefix,items);
});

test('one verified local or national opening does not create geographic blocks',()=>{
 const input=[...Array.from({length:24},(_,index)=>row('world-'+index,'science','World')),
  ...Array.from({length:24},(_,index)=>row('national-'+index,'science','National','national')),
  ...Array.from({length:24},(_,index)=>row('local-'+index,'science','City','local'))];
 const items=order(input);
 assert.equal(items[0].band,'local');
 assert.deepEqual(new Set(items.slice(0,3).map(item=>item.band)),new Set(['local','national','international']));
 assert.ok(items.slice(20).some(item=>item.band==='local'));
 assert.equal(items.length,input.length);
 assert.equal(order(input.filter(item=>item.band!=='local'))[0].band,'national');
 assert.equal(order(input.filter(item=>item.band==='international'))[0],input[0]);
});

test('scarce categories and a single-publisher tail stay complete when alternation is impossible',()=>{
 const input=[...Array.from({length:45},(_,index)=>row('science-'+index,'science','A')),
  ...Array.from({length:4},(_,index)=>row('sport-'+index,'sport','B')),
  ...Array.from({length:2},(_,index)=>row('weather-'+index,'weather','C'))];
 const items=order(input);
 assert.equal(items.length,51);cycles(items);
 assert.equal(new Set(items.map(item=>item.id)).size,51);
 assert.equal(items.slice(-20).every(item=>item.category==='science'&&item.publisher==='A'),true);
 assert.deepEqual(items.filter(item=>item.category==='science'),input.filter(item=>item.category==='science'));
 assert.deepEqual(order([]),[]);
 const only=input.filter(item=>item.publisher==='B');assert.deepEqual(order(only),only);
});

test('publisher label normalization does not create false alternatives or rewrite source attribution',()=>{
 const input=[...Array.from({length:6},(_,index)=>row('alias-'+index,'science',index%2?' example NEWS ':'Example News')),
  ...Array.from({length:6},(_,index)=>row('independent-'+index,'science','Independent'))];
 const items=order(input),owner=item=>item.publisher.normalize('NFKC').trim().toLowerCase();
 for(let index=1;index<items.length;index++)assert.notEqual(owner(items[index]),owner(items[index-1]));
 assert.deepEqual(new Set(items),new Set(input));
 assert.ok(items.some(item=>item.publisher===' example NEWS '),'the original attribution is retained');
});

test('the edition ordering boundary rejects unsupported size, publisher and scope inputs',()=>{
 assert.throws(()=>order(null),/NEWS_EDITION_ORDER_INPUT_INVALID/);
 assert.throws(()=>order(Array(5001).fill(row('large','science','A'))),/NEWS_EDITION_ORDER_INPUT_INVALID/);
 assert.throws(()=>order([row('category','  ','A')]),/NEWS_EDITION_ORDER_IDENTITY_INVALID/);
 assert.throws(()=>order([row('publisher','science','')]),/NEWS_EDITION_ORDER_IDENTITY_INVALID/);
 assert.throws(()=>order([row('scope','science','A','invented')]),/NEWS_EDITION_ORDER_SCOPE_INVALID/);
});
