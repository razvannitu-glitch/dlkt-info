import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveInvoiceNotice} from '../.billing-build/docs/billing-ledger-sandbox/invoice-routing.js';
const now=1795695000000,account='acct_Invoice',owner='00000000-0000-4000-8000-000000000015';
const claim={accountId:account,eventId:'evt_Invoice',eventType:'invoice.paid',objectId:'in_Historical',attempt:1,created:now/1000-500,leaseUntil:now+30000};
const link={accountId:account,liveMode:false,invoiceId:claim.objectId,customerId:'cus_Invoice',subscriptionId:'sub_Invoice'};
const binding={accountId:account,liveMode:false,ownerId:owner,customerId:link.customerId,subscriptionId:link.subscriptionId,itemId:'si_Invoice',priceId:'price_Invoice'};
const observation={...binding,status:'canceled',latestInvoice:{id:'in_Newer'},fundsConfirmed:false,riskState:'unknown'};
function f(opts={}){
 const calls=[],reader={observeInvoiceLink:async x=>{calls.push(['invoice',x]);return {...link,...opts.link};},observeSubscription:async(...x)=>{calls.push(['subscription',...x]);return {...observation,...opts.observation};}};
 const store={readInvoiceBinding:async(...x)=>{calls.push(['binding',...x]);return opts.raw===null?null:{...binding,...opts.binding};}};
 return {calls,reader,store};
}
test('historical invoice maps through authenticated account, exact durable binding and current subscription; no entitlement',async()=>{
 const x=f(),v=await resolveInvoiceNotice(account,claim,x.store,x.reader,()=>now);
 assert.deepEqual(v,{kind:'route',accountId:account,eventId:claim.eventId,attempt:1,invoiceId:claim.objectId,subscriptionId:link.subscriptionId,ownerId:owner,customerId:link.customerId,itemId:binding.itemId,priceId:binding.priceId});
 assert.deepEqual(x.calls.map(v=>v[0]),['invoice','binding','subscription']);
 assert.equal('fundsConfirmed' in v,false);assert.equal('premium' in v,false);
});
test('wrong claim, expired/future lease, unaccepted event or identifier deny before reading provider',async()=>{
 for(const patch of [{accountId:'acct_Wrong'},{eventId:'evt_../x'},{eventType:'charge.refunded'},{objectId:'in_../x'},{attempt:0},{attempt:6},{leaseUntil:now},{leaseUntil:now+30001},{created:now/1000+301}]){
 const x=f();assert.deepEqual(await resolveInvoiceNotice(account,{...claim,...patch},x.store,x.reader,()=>now),{kind:'unresolved'});assert.equal(x.calls.length,0);}
});
test('foreign invoice/account/mode or malformed parent stops before binding lookup',async()=>{
 for(const patch of [{accountId:'acct_Wrong'},{liveMode:true},{invoiceId:'in_Other'},{customerId:'cus_wrong/path'},{subscriptionId:'sub_wrong/path'}]){
 const x=f({link:patch});assert.deepEqual(await resolveInvoiceNotice(account,claim,x.store,x.reader,()=>now),{kind:'unresolved'});assert.equal(x.calls.length,1);}
});
test('unknown owner and mismatched binding deny before subscription observation',async()=>{
 for(const opts of [{raw:null},{binding:{ownerId:null}},{binding:{customerId:'cus_Other'}},{binding:{subscriptionId:'sub_Other'}},{binding:{priceId:'price_/bad'}},{binding:{itemId:'si_/bad'}},{binding:{liveMode:true}}]){
 const x=f(opts);assert.deepEqual(await resolveInvoiceNotice(account,claim,x.store,x.reader,()=>now),{kind:'unresolved'});assert.equal(x.calls.length,2);}
});
test('current subscription mismatch, ambiguous funds or risk cannot authorize routing',async()=>{
 for(const patch of [{customerId:'cus_Other'},{subscriptionId:'sub_Other'},{priceId:'price_Other'},{itemId:'si_Other'},{accountId:'acct_Wrong'},{liveMode:true},{fundsConfirmed:true},{riskState:'clear'}]){
 const x=f({observation:patch});assert.deepEqual(await resolveInvoiceNotice(account,claim,x.store,x.reader,()=>now),{kind:'unresolved'});}
});
test('deadline and errors deny even after provider lookup',async()=>{
 let t=now;const x=f();x.reader.observeInvoiceLink=async()=>{t=now+30000;return link;};
 assert.deepEqual(await resolveInvoiceNotice(account,claim,x.store,x.reader,()=>t),{kind:'unresolved'});assert.equal(x.calls.length,0);
 const y=f();y.reader.observeSubscription=async()=>{throw Error('provider outage')};
 assert.deepEqual(await resolveInvoiceNotice(account,claim,y.store,y.reader,()=>now),{kind:'unresolved'});
});
