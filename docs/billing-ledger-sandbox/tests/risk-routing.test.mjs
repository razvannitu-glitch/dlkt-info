import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRiskNotice} from '../.billing-build/docs/billing-ledger-sandbox/risk-routing.js';
const now=1795695000000,account='acct_Risk',owner='00000000-0000-4000-8000-000000000017';
const claim={accountId:account,eventId:'evt_Risk',eventType:'charge.dispute.created',objectId:'du_Risk',attempt:1,created:now/1000-100,leaseUntil:now+30000};
const link={accountId:account,liveMode:false,eventType:claim.eventType,objectId:claim.objectId,chargeId:'ch_Risk',paymentIntentId:'pi_Risk',invoiceId:'in_Risk',subscriptionId:'sub_Risk',customerId:'cus_Risk',riskState:'review_required'};
const binding={accountId:account,liveMode:false,subscriptionId:link.subscriptionId,customerId:link.customerId,ownerId:owner,itemId:'si_Risk',priceId:'price_Risk'};
const fixture=(lp={},bp={})=>({reader:{observeFinancialRiskLink:async()=>({...link,...lp})},store:{readInvoiceBinding:async()=>({...binding,...bp})}});
test('only authenticated risk linkage and private exact binding yield review-required route',async()=>{
 const f=fixture();const x=await resolveRiskNotice(account,claim,f.store,f.reader,()=>now);
 assert.equal(x.kind,'risk_route');assert.equal(x.riskState,'review_required');assert.equal(x.ownerId,owner);assert.equal('premium' in x,false);
});
test('ambiguous or mismatched risk link and binding fail closed',async()=>{
 for(const [l,b] of [[{liveMode:true},{}],[{objectId:'du_Other'},{}],[{eventType:'charge.refunded'},{}],[{riskState:'clear'},{}],[{invoiceId:null},{}],[{paymentIntentId:'pi_/bad'},{}],[{}, {ownerId:null}],[{}, {customerId:'cus_Other'}],[{}, {subscriptionId:'sub_Other'}]]){
  const f=fixture(l,b);assert.deepEqual(await resolveRiskNotice(account,claim,f.store,f.reader,()=>now),{kind:'unresolved'});
 }
});
test('wrong event, wrong dispute prefix and expired claim cannot call provider',async()=>{
 const f=fixture();let calls=0;f.reader.observeFinancialRiskLink=async()=>{calls++;return link;};
 for(const p of [{eventType:'invoice.paid'},{objectId:'dp_Risk'},{leaseUntil:now},{attempt:6},{accountId:'acct_Other'}])
  assert.deepEqual(await resolveRiskNotice(account,{...claim,...p},f.store,f.reader,()=>now),{kind:'unresolved'});
 assert.equal(calls,0);
});
test('lease expiry after risk read and missing private binding deny',async()=>{
 let t=now;const f=fixture();f.reader.observeFinancialRiskLink=async()=>{t=now+30000;return link;};
 assert.deepEqual(await resolveRiskNotice(account,claim,f.store,f.reader,()=>t),{kind:'unresolved'});
 const g=fixture();g.store.readInvoiceBinding=async()=>null;
 assert.deepEqual(await resolveRiskNotice(account,claim,g.store,g.reader,()=>now),{kind:'unresolved'});
});
