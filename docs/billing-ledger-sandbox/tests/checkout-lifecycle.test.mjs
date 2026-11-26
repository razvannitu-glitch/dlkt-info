import test from 'node:test';
import assert from 'node:assert/strict';
import {beginCheckout,recoverCheckout} from '../.billing-build/docs/billing-ledger-sandbox/checkout-lifecycle.js';
const now=1795695000,owner='00000000-0000-4000-8000-000000000004',intentId='20000000-0000-4000-8000-000000000004',requestId='30000000-0000-4000-8000-000000000004';
const failed={kind:'unavailable'};
function fixture(){
 const i={accountId:'acct_fixture',ownerId:owner,customerId:'cus_fixture',intentId,priceId:'price_month',liveMode:false,createdAt:now-30,expiresAt:now-30+3600,closedAt:null,state:'reserved',sessionId:null};
 const checkout={kind:'checkout',sessionId:'cs_test_fixture',url:'https://checkout.stripe.com/c/pay/cs_test_fixture',expiresAt:i.expiresAt};
 const terminal={kind:'terminal',status:'complete',paymentStatus:'paid',sessionId:'cs_test_fixture',expiresAt:i.expiresAt,subscriptionId:'sub_fixture',itemId:'si_fixture'};
 const calls=[];const store={reserve:async(...args)=>{calls.push(['reserve',...args]);return i},load:async(...args)=>{calls.push(['load',...args]);return i},
 attach:async a=>{calls.push(['attach',a]);return true},finish:async a=>{calls.push(['finish',a]);return true}};
 const provider={createCheckout:async(...args)=>{calls.push(['create',...args]);return checkout},observeCheckout:async(...args)=>{calls.push(['observe',...args]);return terminal}};
 return {i,checkout,terminal,calls,store,provider};
}
const begin=(f,clock=()=>now)=>beginCheckout('acct_fixture',owner,'monthly',requestId,f.store,f.provider,clock);
const recover=(f,clock=()=>now)=>recoverCheckout('acct_fixture',intentId,f.store,f.provider,clock);
test('checkout redirect is returned only after successful durable attachment',async()=>{
 const f=fixture();assert.deepEqual(await begin(f),f.checkout);assert.deepEqual(f.calls.map(c=>c[0]),['reserve','create','attach']);
 assert.equal(f.calls[2][1].intentId,intentId);assert.equal(f.calls[2][1].sessionId,'cs_test_fixture');assert.equal(f.calls[2][1].url,undefined);
});
test('database outage or rejected attachment never exposes the URL',async()=>{
 for(const fn of [async()=>false,async()=>undefined,async()=>{throw Error('database down')}]){const f=fixture();f.store.attach=fn;assert.deepEqual(await begin(f),failed);}
});
test('ambiguous POST keeps the reservation and never tries another creation',async()=>{
 const f=fixture();f.provider.createCheckout=async()=>{f.calls.push(['create']);throw Error('response lost')};assert.deepEqual(await begin(f),failed);
 assert.deepEqual(f.calls.map(c=>c[0]),['reserve','create']);
 f.provider.observeCheckout=async()=>f.checkout;
 assert.deepEqual(await recover(f),{kind:'attached'});assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
});
test('attached or aged reservation uses read-only recovery',async()=>{
 for(const modify of [i=>{i.state='attached';i.sessionId='cs_test_fixture'},i=>{i.createdAt-=700;i.expiresAt-=700}]){
 const f=fixture();modify(f.i);f.checkout.expiresAt=f.i.expiresAt;f.provider.observeCheckout=async()=>{f.calls.push(['observe']);return f.checkout};
 assert.deepEqual(await begin(f),f.checkout);assert.deepEqual(f.calls.map(c=>c[0]),['reserve','observe','attach']);}
});
test('foreign binding, malformed state, changed expiry and expired reservation rejected',async()=>{
 for(const patch of [{ownerId:'00000000-0000-4000-8000-000000000005'},{accountId:'acct_other'},{state:'complete'},{liveMode:true},{expiresAt:now+10},{sessionId:'cs_test_other'}]){
 const f=fixture();Object.assign(f.i,patch);assert.deepEqual(await begin(f),failed);assert.equal(f.calls.length,1);}
 const f=fixture();assert.deepEqual(await begin(f,()=>now+4000),failed);assert.equal(f.calls.length,1);
});
test('session expiry during external call or after attachment cannot expose URL',async()=>{
 for(const times of [[now,now+4000],[now,now+1,now+4000]]){const f=fixture();let k=0;assert.deepEqual(await begin(f,()=>times[k++]),failed);}
});
test('provider session cannot be substituted or returned with different expiry',async()=>{
 for(const patch of [{sessionId:'cs_live_other'},{expiresAt:now+200}]){const f=fixture();Object.assign(f.checkout,patch);assert.deepEqual(await begin(f),failed);assert.equal(f.calls.filter(c=>c[0]==='attach').length,0);}
});
test('recovery persists terminal binding and returns no redirect or entitlement',async()=>{
 const f=fixture();assert.deepEqual(await recover(f),{kind:'complete'});assert.deepEqual(f.calls.map(c=>c[0]),['load','observe','finish']);
 assert.equal(f.calls[2][1].subscriptionId,'sub_fixture');assert.equal(f.calls[2][1].paymentStatus,'paid');assert.equal(f.calls[2][1].fundsConfirmed,undefined);
});
test('expired terminal and unknown provider state do not create a replacement',async()=>{
 const f=fixture();f.provider.observeCheckout=async()=>({...f.terminal,status:'expired',paymentStatus:'unpaid',subscriptionId:null,itemId:null});
 assert.deepEqual(await recover(f,()=>now+4000),{kind:'expired'});assert.equal(f.calls.filter(c=>c[0]==='create').length,0);
 const g=fixture();g.provider.observeCheckout=async()=>failed;assert.deepEqual(await recover(g),failed);assert.equal(g.calls.filter(c=>c[0]==='finish').length,0);
});
test('recovery refuses mismatched intent or session, and failed terminal persistence',async()=>{
 const f=fixture();f.i.intentId=requestId;assert.deepEqual(await recover(f),failed);assert.deepEqual(f.calls.map(c=>c[0]),['load']);
 const g=fixture();g.i.state='attached';g.i.sessionId='cs_test_other';assert.deepEqual(await recover(g),failed);assert.equal(g.calls.filter(c=>c[0]==='finish').length,0);
 const h=fixture();h.store.finish=async()=>false;assert.deepEqual(await recover(h),failed);
});
