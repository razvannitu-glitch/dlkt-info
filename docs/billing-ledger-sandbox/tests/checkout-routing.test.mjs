import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCheckoutNotice} from '../.billing-build/docs/billing-ledger-sandbox/checkout-routing.js';
import {StripeReadClient} from '../.billing-build/source/src/billing/stripe-reader.js';
const now=1795695000000,account='acct_Notice',owner='00000000-0000-4000-8000-000000000020',intent='20000000-0000-4000-8000-000000000020',customer='cus_Notice',session='cs_test_Notice',sub='sub_Notice',item='si_Notice',priceId='price_Notice',origin='https://sandbox.example.test';
const claim={accountId:account,eventId:'evt_Notice',eventType:'checkout.session.completed',objectId:session,attempt:1,created:now/1000,leaseUntil:now+30000};
const b={accountId:account,liveMode:false,ownerId:owner,intentId:intent,customerId:customer,priceId,sessionId:null,state:'reserved',createdAt:now/1000-120,expiresAt:now/1000+3480,completedSubscriptionId:null};
const l={accountId:account,liveMode:false,sessionId:session,intentId:intent,customerId:customer};
const v={...l,ownerId:owner,priceId,expiresAt:b.expiresAt,status:'complete',paymentStatus:'paid',subscriptionId:sub,itemId:item};
const make=(binding={},link={},terminal={})=>({store:{readCheckoutBinding:async()=>({...b,...binding})},reader:{observeCheckoutLink:async()=>({...l,...link}),observeCheckoutTerminal:async()=>({...v,...terminal})}});
test('unattached reservation can be recovered from verified current terminal session',async()=>{const f=make();const r=await resolveCheckoutNotice(account,claim,f.store,f.reader,origin,()=>now);assert.equal(r.kind,'checkout_route');assert.equal(r.subscriptionId,sub);assert.equal(r.ownerId,owner);});
test('old event is not a state transition; terminal reservation cannot be reversed',async()=>{
 const old={...claim,eventType:'checkout.session.async_payment_failed'};
 const f=make({state:'complete',sessionId:session,completedSubscriptionId:sub});
 assert.equal((await resolveCheckoutNotice(account,old,f.store,f.reader,origin,()=>now)).kind,'checkout_route');
 const g=make({state:'complete',sessionId:session,completedSubscriptionId:sub},{},{status:'expired',paymentStatus:'unpaid',subscriptionId:null,itemId:null});
 assert.deepEqual(await resolveCheckoutNotice(account,old,g.store,g.reader,origin,()=>now),{kind:'unresolved'});
});
test('foreign owner, malformed private reference, wrong session or unpaid completion rejected',async()=>{
 for(const [binding,link,terminal] of [[{ownerId:null},{},{}],[{customerId:'cus_Other'},{},{}],[{sessionId:'cs_test_Other',state:'attached'},{},{}],[{}, {sessionId:'cs_test_Other'},{}],[{},{},{paymentStatus:'unpaid'}],[{},{},{subscriptionId:'sub_/bad'}],[{},{},{priceId:'price_Other'}]]){
 const f=make(binding,link,terminal);assert.deepEqual(await resolveCheckoutNotice(account,claim,f.store,f.reader,origin,()=>now),{kind:'unresolved'});}
});
test('expired lease prevents provider calls and a lease lost during lookup prevents terminal route',async()=>{
 const f=make();let count=0;f.reader.observeCheckoutLink=async()=>{count++;return l;};
 assert.deepEqual(await resolveCheckoutNotice(account,{...claim,leaseUntil:now},f.store,f.reader,origin,()=>now),{kind:'unresolved'});assert.equal(count,0);
 let clock=now;f.reader.observeCheckoutLink=async()=>{clock=now+30000;return l;};
 assert.deepEqual(await resolveCheckoutNotice(account,claim,f.store,f.reader,origin,()=>clock),{kind:'unresolved'});
});
const catalog={accountId:account,productId:'prod_Notice',monthlyPriceId:priceId,annualPriceId:'price_NoticeYear',liveMode:false,taxBehavior:'inclusive',taxCode:'txcd_10000000'};
const price=(year=false)=>({object:'price',id:year?catalog.annualPriceId:priceId,product:catalog.productId,active:true,livemode:false,type:'recurring',currency:'eur',unit_amount:year?6900:699,billing_scheme:'per_unit',lookup_key:year?'dlkt_info_premium_annual_v1':'dlkt_info_premium_monthly_v1',tax_behavior:'inclusive',transform_quantity:null,custom_unit_amount:null,recurring:{interval:year?'year':'month',interval_count:1,usage_type:'licensed'}});
const list=data=>({object:'list',has_more:false,data});
const paid={object:'checkout.session',id:session,livemode:false,mode:'subscription',ui_mode:'hosted_page',customer,client_reference_id:intent,currency:'eur',amount_total:699,amount_subtotal:699,created:b.createdAt+1,expires_at:b.expiresAt,success_url:origin+'/billing/return',cancel_url:origin+'/billing/cancel',allow_promotion_codes:false,payment_method_types:['card'],automatic_tax:{enabled:false},status:'complete',payment_status:'paid',subscription:sub};
const subData={object:'subscription',id:sub,livemode:false,customer,status:'active',cancel_at:null,cancel_at_period_end:false,pause_collection:null,latest_invoice:null,items:list([{object:'subscription_item',id:item,subscription:sub,quantity:1,price:price(),current_period_start:b.createdAt,current_period_end:b.createdAt+2592000}])};
function reader(patch={},expired=false){
 const s=expired?{...paid,status:'expired',payment_status:'unpaid',subscription:null}:paid;
 const map={'/v1/account':{object:'account',id:account},['/v1/products/'+catalog.productId]:{object:'product',id:catalog.productId,livemode:false,active:true,tax_code:catalog.taxCode},
 ['/v1/prices/'+priceId]:price(),['/v1/prices/'+catalog.annualPriceId]:price(true),
 ['/v1/checkout/sessions/'+session]:s,['/v1/customers/'+customer]:{object:'customer',id:customer,livemode:false,metadata:{application:'dlkt_info',environment:'sandbox'}},
 '/v1/checkout/sessions':list([s]),['/v1/checkout/sessions/'+session+'/line_items']:list([{object:'item',quantity:1,currency:'eur',amount_total:699,amount_subtotal:699,price:price()}]),
 '/v1/subscriptions':list(expired?[]:[subData]),['/v1/subscriptions/'+sub]:subData,...patch};
 const calls=[];
 return {calls,reader:new StripeReadClient(catalog,'rk_test_fixtureOnly',async(url,opts)=>{const u=new URL(url);calls.push(u);assert.equal(opts.method,'GET');assert.equal(u.origin,'https://api.stripe.com');if(!Object.hasOwn(map,u.pathname))throw Error('fixture endpoint');return new Response(JSON.stringify(map[u.pathname]),{headers:{'content-type':'application/json'}});})};
}
test('real read-only adapter verifies exact complete and expired session; no hosted URL returned',async()=>{
 for(const expired of [false,true]){const f=reader({},expired);assert.deepEqual(await f.reader.observeCheckoutLink(session),l);
 const x=await f.reader.observeCheckoutTerminal(b,session,origin);assert.equal(x.status,expired?'expired':'complete');assert.equal(x.subscriptionId,expired?null:sub);assert.equal('url' in x,false);assert.equal('fundsConfirmed' in x,false);
 const listCall=f.calls.find(u=>u.pathname==='/v1/subscriptions');assert.equal(listCall.searchParams.get('customer'),customer);assert.equal(listCall.searchParams.get('status'),'all');}
});
test('real adapter rejects open/unpaid, altered amount, incomplete listing or extra subscription',async()=>{
 for(const p of [{['/v1/checkout/sessions/'+session]:{...paid,status:'open',payment_status:'unpaid'}},{['/v1/checkout/sessions/'+session]:{...paid,amount_total:1}},
 {'/v1/checkout/sessions':{...list([paid]),has_more:true}},{'/v1/subscriptions':list([subData,subData])},
 {['/v1/checkout/sessions/'+session+'/line_items']:list([{object:'item',quantity:2}])}])
 await assert.rejects(reader(p).reader.observeCheckoutTerminal(b,session,origin),/STRIPE_BILLING_READ_REJECTED/);
});
