import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeCurrentCity,coarseLocationRequest} from '../.build/src/local/startup.js';

const bucharest=Object.freeze({id:'683506',name:'Bucharest',countryCode:'RO',country:'Romania',region:'Bucharest',lat:44.4323,lon:26.1063,timezone:'Europe/Bucharest'});
const london=Object.freeze({id:'2643743',name:'London',countryCode:'GB',country:'United Kingdom',region:'England',lat:51.5085,lon:-0.1257,timezone:'Europe/London'});
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};};

test('startup selects the current connection city through exactly one bounded hint request',async()=>{
  const reads=[],selected=[];
  const result=await initializeCurrentCity({readHint:async()=>{reads.push('hint');return{city:bucharest,estimated:true};},maySelect:()=>true,select:async city=>{selected.push(city);}});
  assert.equal(result,'selected');
  assert.deepEqual(reads,['hint']);
  assert.deepEqual(selected,[bucharest]);
});

test('a manual choice made before startup prevents an automatic request or replacement',async()=>{
  let current=london,requests=0;
  const result=await initializeCurrentCity({readHint:async()=>{requests++;return{city:bucharest,estimated:true};},maySelect:()=>false,select:async city=>{current=city;}});
  assert.equal(result,'superseded');
  assert.equal(requests,0);
  assert.equal(current,london);
});

test('manual city selection wins when the current-location response arrives later',async()=>{
  const pending=deferred();let manual=false,current=null,automaticSelections=0;
  const startup=initializeCurrentCity({readHint:()=>pending.promise,maySelect:()=>!manual,select:async city=>{automaticSelections++;current=city;}});
  manual=true;current=london;
  pending.resolve({city:bucharest,estimated:true});
  assert.equal(await startup,'superseded');
  assert.equal(current,london);
  assert.equal(automaticSelections,0);
});

test('a failed location lookup has no retry and does not manufacture a saved or current city',async()=>{
  let requests=0,selections=0;
  const result=await initializeCurrentCity({readHint:async()=>{requests++;throw Error('NETWORK_UNAVAILABLE');},maySelect:()=>true,select:async()=>{selections++;}});
  assert.equal(result,'unavailable');
  assert.equal(requests,1);
  assert.equal(selections,0);
});

test('a late failed lookup cannot turn an existing manual choice into an unavailable location',async()=>{
  const pending=deferred();let manual=false,current=null;
  const startup=initializeCurrentCity({readHint:()=>pending.promise,maySelect:()=>!manual,select:async city=>{current=city;}});
  manual=true;current=london;pending.reject(Error('NETWORK_UNAVAILABLE'));
  assert.equal(await startup,'superseded');
  assert.equal(current,london);
});

test('unknown, country-only, malformed and non-estimated hints never become a current city',async()=>{
  const invalid=[null,[],{}, {city:null,estimated:true}, {countryCode:'RO',estimated:true}, {city:bucharest}, {city:bucharest,estimated:false}, {city:{...bucharest,timezone:'Invalid/Zone'},estimated:true}, {city:{...bucharest,lat:120},estimated:true}, {city:{...bucharest,id:'not-canonical'},estimated:true}];
  for(const hint of invalid){
    let selected=false;
    const result=await initializeCurrentCity({readHint:async()=>hint,maySelect:()=>true,select:async()=>{selected=true;}});
    assert.equal(result,'unavailable');assert.equal(selected,false);
  }
});

test('a selection failure is not reported as a completed location selection',async()=>{
  await assert.rejects(initializeCurrentCity({readHint:async()=>({city:bucharest,estimated:true}),maySelect:()=>true,select:async()=>{throw Error('SELECTION_FAILED');}}),/SELECTION_FAILED/u);
});

test('conflicting connection country and city fail closed rather than changing the edition',async()=>{
 for(const countryCode of ['GB',null,'ro']){
  let selected=false;
  const result=await initializeCurrentCity({readHint:async()=>({city:bucharest,countryCode,estimated:true}),maySelect:()=>true,select:async()=>{selected=true;}});
  assert.equal(result,'unavailable');assert.equal(selected,false);
 }
});
test('coarse device suggestions conservatively account for rounding and retain only necessary fields',()=>{
 const now=Date.parse('2026-11-28T12:00:00Z');
 const result=coarseLocationRequest(44.4349,26.1049,100,now,now);
 assert.deepEqual(Object.keys(result).sort(),['accuracy','lat','lon','timestamp']);
 assert.equal(result.lat,44.43);assert.equal(result.lon,26.1);
 assert.ok(result.accuracy>=100+112000*(0.0049+0.0049));
 assert.deepEqual(coarseLocationRequest(result.lat,result.lon,result.accuracy,result.timestamp,now),result,'already coarsened coordinates must not be inflated twice');
 for(const args of [[44.4349,26.1049,4999,now,now],[44,26,-1,now,now],[44,26,100,now-120001,now],[44,26,100,now+5001,now],[91,26,100,now,now],[44,181,100,now,now],[NaN,26,100,now,now],[44,26,100,now,NaN]]){
  assert.equal(coarseLocationRequest(...args),null);
 }
});
