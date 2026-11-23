import test from 'node:test';
import assert from 'node:assert/strict';
import {balanceGeoBands,balanceGeoCategoryRounds} from '../.build/src/iceo/geo-balance.js';
test('verified local reports lead, with bounded national and global discoveries',()=>{
 const inputs=[
 ...Array.from({length:7},(_,i)=>({id:'l'+i,band:'local'})),
 ...Array.from({length:6},(_,i)=>({id:'n'+i,band:'national'})),
 ...Array.from({length:5},(_,i)=>({id:'g'+i,band:'international'})),
 ];
 const result=balanceGeoBands(inputs,item=>item.band);
 assert.deepEqual(result.slice(0,6).map(x=>x.band),['local','local','local','national','national','international']);
 assert.equal(result.length,inputs.length);
 assert.equal(new Set(result.map(x=>x.id)).size,inputs.length);
 assert.ok(result.every(item=>inputs.includes(item)));
});
test('missing local evidence does not invent local cards or exclude global news',()=>{
 const inputs=[{scope:'international',id:'g'},{scope:'national',id:'n'}];
 assert.deepEqual(balanceGeoBands(inputs,x=>x.scope).map(x=>x.id),['n','g']);
});
test('ordering is deterministic and input references stay untouched',()=>{
 const input=Object.freeze([{id:'a',scope:'national'},{id:'b',scope:'international'},{id:'c',scope:'local'}]);
 const before=JSON.stringify(input);
 assert.deepEqual(balanceGeoBands(input,x=>x.scope),balanceGeoBands(input,x=>x.scope));
 assert.equal(JSON.stringify(input),before);
 assert.throws(()=>balanceGeoBands(input,()=> 'street'),/GEO_FEED_SCOPE_INVALID/);
});

test('local prioritization preserves category rounds and original report identity',()=>{
 const categories=Array.from({length:18},(_,i)=>'cat-'+i);
 const items=[
  ...categories.map((category,i)=>({key:'a'+i,category,band:i%3===0?'local':'international'})),
  ...categories.map((category,i)=>({key:'b'+i,category,band:i%3===1?'national':'international'})),
 ];
 const rounds=balanceGeoCategoryRounds(items,x=>x.category,x=>x.band);
 assert.equal(rounds.length,items.length);
 assert.equal(new Set(rounds.slice(0,18).map(x=>x.category)).size,18);
 assert.equal(new Set(rounds.slice(18,36).map(x=>x.category)).size,18);
 assert.notEqual(rounds[17].category,rounds[18].category);
 assert.ok(rounds.slice(0,3).every(x=>x.band==='local'));
 assert.equal(new Set(rounds.map(x=>x.key)).size,items.length);
});
