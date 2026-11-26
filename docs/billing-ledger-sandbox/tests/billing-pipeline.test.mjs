import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {acceptBillingDelivery,routeNextBillingNotice,reconcileNextBillingSubscription} from '../.billing-build/docs/billing-ledger-sandbox/billing-pipeline.js';
import {STRIPE_BILLING_API_VERSION} from '../.billing-build/source/src/billing/stripe-reader.js';
const now=1795695000000,clock=()=>now,account='acct_Pipeline',owner='00000000-0000-4000-8000-000000000018',secret='whsec_fixtureOnly';
const binding={account_id:account,owner_id:owner,customer_id:'cus_Pipeline',subscription_id:'sub_Pipeline',item_id:'si_Pipeline',price_id:'price_Pipeline',live_mode:false};
const observation={accountId:account,liveMode:false,customerId:binding.customer_id,subscriptionId:binding.subscription_id,itemId:binding.item_id,priceId:binding.price_id,status:'active',fundsConfirmed:false,riskState:'unknown'};
const event=(type='invoice.paid',object='invoice',objectId='in_Pipeline')=>Buffer.from(JSON.stringify({id:'evt_Pipeline',object:'event',livemode:false,api_version:STRIPE_BILLING_API_VERSION,created:now/1000,type,data:{object:{id:objectId,object,livemode:false,metadata:{ownerId:'untrusted'}}}}));
const sign=b=>'t='+now/1000+',v1='+createHmac('sha256',secret).update(now/1000+'.').update(b).digest('hex');
function fixture(type='invoice.paid',objectId='in_Pipeline'){
 const calls=[];
 const eventClaim={account_id:account,event_id:'evt_Pipeline',event_type:type,object_id:objectId,event_created:now/1000,attempt:1,lease_until:new Date(now+30000).toISOString()};
 const recClaim={...binding,generation:'1',fence:'2',lease_until:new Date(now+60000).toISOString()};
 const response=(role,sql)=>sql.includes('claim_notice')?[eventClaim]:sql.includes('read_invoice_binding')?[binding]:
  sql.includes('claim_subscription')?[recClaim]:sql.includes('ingest_notice')?[{outcome:'accepted'}]:[{ok:true}];
 const ports=Object.fromEntries(['ingress','worker','invoice','risk','reconcile'].map(role=>[role,{query:async(sql,args)=>{calls.push({role,sql,args});return response(role,sql);}}]));
 const reader={observeInvoiceLink:async id=>({accountId:account,liveMode:false,invoiceId:id,customerId:binding.customer_id,subscriptionId:binding.subscription_id}),
 observeSubscription:async()=>observation,
 observeFinancialRiskLink:async(type,id)=>({accountId:account,liveMode:false,eventType:type,objectId:id,chargeId:'ch_Pipeline',paymentIntentId:'pi_Pipeline',invoiceId:'in_Pipeline',customerId:binding.customer_id,subscriptionId:binding.subscription_id,riskState:'review_required'})};
 return {ports,reader,calls,eventClaim,recClaim};
}
test('verified raw delivery only persists exact minimal metadata; bad signatures and ignored events never reach store',async()=>{
 const f=fixture(),b=event();
 assert.deepEqual(await acceptBillingDelivery(account,b,sign(b),secret,f.ports.ingress,clock),{kind:'accepted'});
 assert.deepEqual(f.calls[0].args,[account,'evt_Pipeline','invoice.paid','in_Pipeline',String(now/1000)]);
 assert.deepEqual(await acceptBillingDelivery(account,b,'invalid',secret,f.ports.ingress,clock),{kind:'rejected'});
 const ignored=event('customer.updated','customer','cus_Pipeline');
 assert.deepEqual(await acceptBillingDelivery(account,ignored,sign(ignored),secret,f.ports.ingress,clock),{kind:'ignored'});
 assert.equal(f.calls.length,1);
});
test('invoice and risk use separate capability ports and exact bound identifiers',async()=>{
 for(const [type,obj,role] of [['invoice.paid','in_Pipeline','invoice'],['charge.dispute.created','du_Pipeline','risk']]){
  const f=fixture(type,obj);
  assert.deepEqual(await routeNextBillingNotice(account,f.ports,f.reader,clock),{kind:'routed'});
  assert.deepEqual(f.calls.map(c=>c.role),['worker',role,role]);
  assert.ok(f.calls[2].sql.includes(role==='invoice'?'route_invoice_notice':'route_risk_notice'));
 }
});
test('direct subscription route and unresolved checkout never share a terminal path',async()=>{
 const f=fixture('customer.subscription.updated','sub_Pipeline');
 assert.deepEqual(await routeNextBillingNotice(account,f.ports,f.reader,clock),{kind:'routed'});
 assert.ok(f.calls[1].sql.includes('route_subscription_notice'));
 const g=fixture('checkout.session.completed','cs_test_Pipeline');
 assert.deepEqual(await routeNextBillingNotice(account,g.ports,g.reader,clock),{kind:'retry_recorded'});
 assert.ok(g.calls[1].sql.includes('fail_notice'));assert.equal(g.calls[1].args.at(-1),'retry');
});
test('ambiguous route write never triggers a second mutation or success acknowledgement',async()=>{
 const f=fixture();const original=f.ports.invoice.query;
 f.ports.invoice.query=async(sql,args)=>{if(sql.includes('route_invoice_notice')){f.calls.push({role:'invoice',sql,args});throw Error('receipt lost');}return original(sql,args);};
 assert.deepEqual(await routeNextBillingNotice(account,f.ports,f.reader,clock),{kind:'unavailable'});
 assert.equal(f.calls.length,3);assert.ok(!f.calls.some(x=>x.sql.includes('fail_notice')));
});
test('fresh reconciliation persists only current non-authorizing observation with exact generation and fence',async()=>{
 const f=fixture();assert.deepEqual(await reconcileNextBillingSubscription(account,f.ports.reconcile,f.reader,clock),{kind:'observed'});
 assert.deepEqual(f.calls[1].args,[account,binding.subscription_id,'1','2',owner,binding.customer_id,binding.item_id,binding.price_id,'active']);
 for(const patch of [{riskState:'clear'},{fundsConfirmed:true},{customerId:'cus_other'},{priceId:'price_other'}]){
  const g=fixture();g.reader.observeSubscription=async()=>({...observation,...patch});
  assert.deepEqual(await reconcileNextBillingSubscription(account,g.ports.reconcile,g.reader,clock),{kind:'retry_recorded'});
  assert.ok(g.calls[1].sql.includes('fail_subscription'));
 }
});
test('malformed or expired claim fails closed with no follow-up SQL',async()=>{
 const f=fixture();f.eventClaim.lease_until=new Date(now).toISOString();
 assert.deepEqual(await routeNextBillingNotice(account,f.ports,f.reader,clock),{kind:'unavailable'});
 assert.equal(f.calls.length,1);
 const g=fixture();g.recClaim.generation='9223372036854775808';
 assert.deepEqual(await reconcileNextBillingSubscription(account,g.ports.reconcile,g.reader,clock),{kind:'unavailable'});assert.equal(g.calls.length,1);
});
