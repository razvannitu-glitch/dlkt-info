import test from 'node:test';
import assert from 'node:assert/strict';
import {currentConnectionAccess,sameConnectionAccess} from '../.build/src/connections/premium-access.js';
const owner='11111111-1111-4111-8111-111111111111',session='B'.repeat(43),now=1795695000,clock=()=>new Date(now*1000);
const evidence={state:'premium',source:'stripe_reconciled',liveMode:true,ownerId:owner,sessionHash:session,
 accountId:'acct_fixture',subscriptionId:'sub_fixture',generation:'1',fence:'1',epoch:'0',verifiedAt:now-10,validUntil:now+100};
const read=x=>currentConnectionAccess({read:async()=>x},owner,session,clock);
test('Exact server receipt yields a frozen access stamp only',async()=>{
 const s=await read(evidence);assert.deepEqual(s,{accountId:'acct_fixture',subscriptionId:'sub_fixture',generation:'1',fence:'1',epoch:'0',verifiedAt:now-10,validUntil:now+100});assert.ok(Object.isFrozen(s));
 assert.equal(sameConnectionAccess(s,{...s,epoch:'1'}),false);assert.equal(sameConnectionAccess(s,{...s}),true);
});
for(const patch of [{state:'sandbox_eligible'},{source:'synthetic_fixture'},{liveMode:false},{ownerId:'22222222-2222-4222-8222-222222222222'},
 {sessionHash:'A'.repeat(43)},{verifiedAt:now+1},{validUntil:now},{validUntil:now+301},{generation:1},{fence:'0'},{epoch:'-1'},{epoch:'9223372036854775808'},
 {accountId:'acct_../bad'},{subscriptionId:'sub_../bad'}]){
 test('reject '+JSON.stringify(patch),async()=>assert.equal(await read({...evidence,...patch}),null));
}
test('Getter and missing, failed or malformed reader deny without exposing errors',async()=>{
 const x={...evidence};Object.defineProperty(x,'state',{get(){throw Error('secret');}});
 for(const value of [x,null,true,{}])assert.equal(await read(value),null);
 assert.equal(await currentConnectionAccess(undefined,owner,session,clock),null);
 assert.equal(await currentConnectionAccess({read:async()=>{throw Error('secret')}},owner,session,clock),null);
});
