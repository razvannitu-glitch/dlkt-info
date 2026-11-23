import assert from 'node:assert/strict';
import test from 'node:test';
import {retainedEditorialCards} from '../.build/src/iceo/editorial-engine.js';

test('no eligible previous snapshot triggers no costly corpus read',async()=>{
 let calls=0;
 const controller=new AbortController();
 const retained=await retainedEditorialCards(undefined,controller.signal,async()=>{calls++;throw Error('unnecessary backend access');});
 assert.equal(retained,undefined);
 assert.equal(calls,0);
});
test('an eligible previous snapshot retains full verified article originals',async()=>{
 const previous={cards:[{id:'first'}]};
 const corpus={corpus:{cards:[{id:'first'},{id:'second'}]}};
 let calls=0;
 const retained=await retainedEditorialCards(previous,new AbortController().signal,async()=>{calls++;return corpus;});
 assert.equal(calls,1);
 assert.deepEqual(retained?.cards,corpus.corpus.cards);
});
test('a transient corpus-store outage preserves the eligible prior snapshot',async()=>{
 const previous={cards:[{id:'eligible'}]};
 const retained=await retainedEditorialCards(previous,new AbortController().signal,async()=>{throw Error('private provider failure');});
 assert.equal(retained,previous);
 const unavailable=await retainedEditorialCards(previous,new AbortController().signal,async()=>null);
 assert.equal(unavailable,previous);
});
test('abort before or during optional retained read never proceeds to publication',async()=>{
 const early=new AbortController();
 early.abort(new Error('COLLECTOR_CANCELLED'));
 let calls=0;
 await assert.rejects(retainedEditorialCards(undefined,early.signal,async()=>{calls++;return null;}),/COLLECTOR_CANCELLED/);
 assert.equal(calls,0);
 const during=new AbortController();
 const previous={cards:[{id:'old'}]};
 await assert.rejects(retainedEditorialCards(previous,during.signal,async()=>{during.abort(new Error('COLLECTOR_CANCELLED'));return null;}),/COLLECTOR_CANCELLED/);
});
