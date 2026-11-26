import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {StripeReadClient,STRIPE_BILLING_API_VERSION} from '../.build/src/billing/stripe-reader.js';
import {verifySandboxStripeNotice} from '../.build/src/billing/webhook-signature.js';
import {evaluatePremiumAccess} from '../.build/src/billing/entitlement.js';

// Catalog fields transcribed from the direct sandbox GET readback on 2026-11-26;
// customer, subscription, invoice, signature and transport below are synthetic fixtures.
const cfg={accountId:'acct_1Ug2Sh77EKtnzo3p',liveMode:false,productId:'prod_VhRhJqxfqwsphh',
 monthlyPriceId:'price_1Ug2no77EKtnzo3pFonO3DoN',annualPriceId:'price_1Ug2nq77EKtnzo3pu9VDFjZ7',
 taxCode:'txcd_10000000',taxBehavior:'inclusive'};
const key='rk_test_fixtureNotARealKey',secret='whsec_fixtureNotARealSecret',now=1795695000;
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const b={ownerId:owner,accountId:cfg.accountId,liveMode:false,customerId:'cus_fixture',subscriptionId:'sub_fixture'};
const product={object:'product',id:cfg.productId,active:true,livemode:false,tax_code:cfg.taxCode,default_price:cfg.monthlyPriceId,name:'DLKT Premium'};
function price(annual=false){return {object:'price',id:annual?cfg.annualPriceId:cfg.monthlyPriceId,active:true,livemode:false,
 product:cfg.productId,type:'recurring',currency:'eur',unit_amount:annual?6900:699,billing_scheme:'per_unit',
 lookup_key:annual?'dlkt_info_premium_annual_v1':'dlkt_info_premium_monthly_v1',tax_behavior:'inclusive',
 transform_quantity:null,custom_unit_amount:null,recurring:{interval:annual?'year':'month',interval_count:1,usage_type:'licensed',meter:null,trial_period_days:null}}}
const account={object:'account',id:cfg.accountId};
function sub(annual=false){return {object:'subscription',id:b.subscriptionId,livemode:false,customer:b.customerId,status:'active',
 cancel_at:null,cancel_at_period_end:false,pause_collection:null,latest_invoice:'in_fixture',
 items:{object:'list',has_more:false,data:[{object:'subscription_item',id:'si_fixture',subscription:b.subscriptionId,
 quantity:1,price:price(annual),current_period_start:now-30,current_period_end:now+(annual?365:30)*86400-30}]}}}
function invoice(annual=false){return {object:'invoice',id:'in_fixture',livemode:false,customer:b.customerId,currency:'eur',
 status:'paid',amount_due:annual?6900:699,amount_paid:annual?6900:699,amount_remaining:0,
 parent:{type:'subscription_details',subscription_details:{subscription:b.subscriptionId}}}}
function fixture(overrides={}) {
 const calls=[], base={'/v1/account':account,['/v1/products/'+cfg.productId]:product,
 ['/v1/prices/'+cfg.monthlyPriceId]:price(),['/v1/prices/'+cfg.annualPriceId]:price(true),
 '/v1/subscriptions/sub_fixture':sub(),'/v1/invoices/in_fixture':invoice(),...overrides};
 const transport=async(url,options)=>{calls.push({url,options});const v=base[new URL(url).pathname];
  if(v instanceof Response)return v;if(v===undefined)throw Error('Unexpected fixture request');
  return new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
 };
 return {calls,reader:new StripeReadClient(cfg,key,transport)};
}
test('authenticated catalog read uses only the sandbox account and exact prices',async()=>{
 const {calls,reader}=fixture();const c=await reader.loadCatalog();
 assert.equal(c.monthlyPriceId,cfg.monthlyPriceId);assert.equal(c.annualPriceId,cfg.annualPriceId);
 assert.equal(calls.length,4);assert.equal(calls[0].url,'https://api.stripe.com/v1/account');
 for(const {url,options} of calls){assert.equal(new URL(url).origin,'https://api.stripe.com');assert.equal(options.method,'GET');
 assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+key);
 assert.equal(options.headers['Stripe-Version'],STRIPE_BILLING_API_VERSION);assert.equal(options.headers['Stripe-Account'],undefined);}
 assert.equal(JSON.stringify(reader),'{}');
});
test('client rejects live keys, generic secret keys, live mode and malformed paths before transport',()=>{
 for(const bad of ['rk_live_fixture','sk_test_fixture','rk_test_foo\n','rk_test_',''])assert.throws(()=>new StripeReadClient(cfg,bad),/STRIPE_BILLING_READ_REJECTED/u);
 for(const patch of [{liveMode:true},{accountId:'acct_bad/../x'},{monthlyPriceId:'price_bad?x=1'},{annualPriceId:cfg.monthlyPriceId}])assert.throws(()=>new StripeReadClient({...cfg,...patch},key),/STRIPE_BILLING_READ_REJECTED/u);
});
test('mismatched authenticated account prevents any product, price or subscription read',async()=>{
 const {calls,reader}=fixture({'/v1/account':{...account,id:'acct_wrong'}});
 await assert.rejects(reader.observeSubscription(owner,b),/STRIPE_BILLING_READ_REJECTED/u);assert.equal(calls.length,1);
});
test('transport errors do not expose provider response or credentials',async()=>{
 const reader=new StripeReadClient(cfg,key,async()=>{throw Error(key)});
 await assert.rejects(reader.loadCatalog(),{message:'STRIPE_BILLING_READ_REJECTED'});
 const {reader:r}=fixture({'/v1/account':new Response(JSON.stringify({error:key}),{status:403,headers:{'content-type':'application/json'}})});
 await assert.rejects(r.loadCatalog(),{message:'STRIPE_BILLING_READ_REJECTED'});
});
test('redirect, HTML, malformed JSON, invalid UTF8 and unbounded bodies fail closed',async()=>{
 const json={'content-type':'application/json'};
 const responses=[new Response('',{status:302,headers:{location:'https://other.example/','content-type':'application/json'}}),
 new Response('<html>',{headers:{'content-type':'text/html'}}),new Response('{',{headers:json}),
 new Response(Uint8Array.from([255]),{headers:json}),
 new Response('{}',{headers:{...json,'content-length':'999999'}}),
 new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(270000));c.close()}}),{headers:json})];
 for(const response of responses){const {reader}=fixture({'/v1/account':response});await assert.rejects(reader.loadCatalog(),/STRIPE_BILLING_READ_REJECTED/u);}
});
test('altered catalog price and live objects are rejected after account confirmation',async()=>{
 for(const patch of [{unit_amount:700},{livemode:true},{product:'prod_other'},{tax_behavior:'unspecified'}]){
 const {reader}=fixture({['/v1/prices/'+cfg.monthlyPriceId]:{...price(),...patch}});
 await assert.rejects(reader.loadCatalog(),/PREMIUM_CATALOG_INVALID/u);}
});
test('owner and mode binding failures cause zero Stripe calls',async()=>{
 for(const binding of [{...b,ownerId:other},{...b,liveMode:true},{...b,accountId:'acct_other'},{...b,subscriptionId:'sub_../x'}]){
 const {calls,reader}=fixture();await assert.rejects(reader.observeSubscription(owner,binding),/STRIPE_BILLING_READ_REJECTED/u);assert.equal(calls.length,0);}
});
test('monthly and annual observations resolve exact subscription and invoice without granting Premium',async()=>{
 for(const annual of [false,true]){
 const {reader,calls}=fixture({'/v1/subscriptions/sub_fixture':sub(annual),'/v1/invoices/in_fixture':invoice(annual)});
 const o=await reader.observeSubscription(owner,b);
 assert.equal(o.plan,annual?'annual':'monthly');assert.equal(o.latestInvoice.amountPaid,annual?6900:699);
 assert.equal(o.fundsConfirmed,false);assert.equal(o.riskState,'unknown');assert.equal(calls.length,6);
 const c=await reader.loadCatalog();assert.deepEqual(evaluatePremiumAccess(owner,false,c,b,o,now),{state:'denied'});
 assert.ok(Object.isFrozen(o));assert.ok(Object.isFrozen(o.latestInvoice));}
});
test('wrong customer, subscription, mode, item count, quantity, and price deny observation',async()=>{
 const s=sub();
 for(const value of [{...s,customer:'cus_other'},{...s,id:'sub_other'},{...s,livemode:true},
 {...s,items:{...s.items,has_more:true}},{...s,items:{...s.items,data:[]}},
 {...s,items:{...s.items,data:[{...s.items.data[0],quantity:2}]}},
 {...s,items:{...s.items,data:[{...s.items.data[0],price:{...price(),id:'price_other'}}]}}]){
 const {reader}=fixture({'/v1/subscriptions/sub_fixture':value});await assert.rejects(reader.observeSubscription(owner,b),/STRIPE_BILLING_READ_REJECTED/u);}
});
test('invoice cannot be substituted across customer, subscription, currency or mode',async()=>{
 for(const patch of [{customer:'cus_other'},{livemode:true},{currency:'usd'},{id:'in_other'},
 {parent:{type:'subscription_details',subscription_details:{subscription:'sub_other'}}},{amount_paid:-1}]){
 const {reader}=fixture({'/v1/invoices/in_fixture':{...invoice(),...patch}});await assert.rejects(reader.observeSubscription(owner,b),/STRIPE_BILLING_READ_REJECTED/u);}
});
test('canceled or incomplete observation remains informational; missing invoice is not payment',async()=>{
 const {reader}=fixture({'/v1/subscriptions/sub_fixture':{...sub(),status:'incomplete',latest_invoice:null}});
 const o=await reader.observeSubscription(owner,b);assert.equal(o.status,'incomplete');assert.equal(o.latestInvoice,null);assert.equal(o.fundsConfirmed,false);
});
const event=(type='invoice.paid',object='invoice',id='in_fixture')=>({id:'evt_fixture',object:'event',
 created:now-3600,livemode:false,api_version:STRIPE_BILLING_API_VERSION,type,data:{object:{object,id,livemode:false,metadata:{ownerId:other},paid:true}}});
const bytes=v=>Buffer.from(JSON.stringify(v));
const digest=(body,t=now,k=secret)=>createHmac('sha256',k).update(t+'.').update(body).digest('hex');
const sign=(body,t=now,k=secret)=>'t='+t+',v1='+digest(body,t,k);
const verify=(body,header)=>verifySandboxStripeNotice(body,header,secret,cfg.accountId,now);
test('valid signed delivery is only a reconciliation notice; old created timestamp is accepted',()=>{
 const body=bytes(event());assert.deepEqual(verify(body,sign(body)),{kind:'reconcile',eventId:'evt_fixture',created:now-3600,type:'invoice.paid',objectId:'in_fixture'});
});
test('accepts multiple v1 signatures and ignores debugging fields and v0',()=>{
 const body=bytes(event());assert.equal(verify(body,'t='+now+',v0=ignore,v1='+'a'.repeat(64)+',secret=nottrusted,v1='+digest(body)+',destination=we_fixture').kind,'reconcile');
});
test('raw body mutation, incorrect key, missing timestamp, duplicate timestamp and unsigned inputs reject',()=>{
 const body=bytes(event());for(const [payload,header] of [[Buffer.concat([body,Buffer.from(' ')]),sign(body)],[body,sign(body,now,'whsec_other')],[body,'v1='+digest(body)],[body,sign(body)+',t='+now],[body,'t='+now+',v0='+digest(body)],[body.toString(),sign(body)]]){
 assert.throws(()=>verify(payload,header),/STRIPE_WEBHOOK_REJECTED/u);}
});
test('signature time has symmetric bounded tolerance; future event time is rejected',()=>{
 const body=bytes(event());for(const t of [now-301,now+301])assert.throws(()=>verify(body,sign(body,t)),/STRIPE_WEBHOOK_REJECTED/u);
 for(const t of [now-300,now+300])assert.equal(verify(body,sign(body,t)).kind,'reconcile');
 const future=bytes({...event(),created:now+301});assert.throws(()=>verify(future,sign(future)),/STRIPE_WEBHOOK_REJECTED/u);
});
test('verified wrong-mode, wrong-account, organization context, and version-mismatched events reject',()=>{
 for(const patch of [{livemode:true},{account:'acct_wrong'},{context:'acct_other'},{api_version:'old-version'}]){
 const body=bytes({...event(),...patch});assert.throws(()=>verify(body,sign(body)),/STRIPE_WEBHOOK_REJECTED/u);}
 const body=bytes({...event(),account:cfg.accountId});assert.equal(verify(body,sign(body)).kind,'reconcile');
});
test('routed event types must match their resource type and identifier',()=>{
 for(const v of [event('invoice.paid','subscription','sub_fixture'),event('invoice.paid','invoice','sub_fixture'),event('checkout.session.completed','checkout.session','cs_live_fixture')]){
 const body=bytes(v);assert.throws(()=>verify(body,sign(body)),/STRIPE_WEBHOOK_REJECTED/u);}
});
test('subscription, checkout, refund, dispute and fraud events produce exact minimal reconciliation targets',()=>{
 for(const [type,obj,id] of [['customer.subscription.deleted','subscription','sub_fixture'],['checkout.session.async_payment_succeeded','checkout.session','cs_test_fixture'],
 ['charge.refunded','charge','ch_fixture'],['charge.dispute.created','dispute','dp_fixture'],['radar.early_fraud_warning.created','radar.early_fraud_warning','issfr_fixture']]){
 const body=bytes(event(type,obj,id));assert.deepEqual(verify(body,sign(body)),{kind:'reconcile',eventId:'evt_fixture',created:now-3600,type,objectId:id});}
});
test('unsupported authenticated event is ignored; malformed or oversized bodies are rejected',()=>{
 const body=bytes(event('product.updated','product','prod_fixture'));assert.deepEqual(verify(body,sign(body)),{kind:'ignored',eventId:'evt_fixture',created:now-3600});
 for(const bad of [Buffer.from('{'),Buffer.alloc(513*1024),Buffer.from([255])])assert.throws(()=>verify(bad,sign(bad)),/STRIPE_WEBHOOK_REJECTED/u);
});
