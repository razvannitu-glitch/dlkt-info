import test from 'node:test';
import assert from 'node:assert/strict';
import {SandboxHostedSessions} from '../.billing-build/docs/billing-ledger-sandbox/hosted-sessions.js';
import {STRIPE_BILLING_API_VERSION} from '../.billing-build/source/src/billing/stripe-reader.js';
const owner='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
const intentId='10000000-0000-4000-8000-000000000001',requestId='10000000-0000-4000-8000-000000000002';
const now=1795695000,readKey='rk_test_fixtureRead',writeKey='rk_test_fixtureWrite';
const cfg={accountId:'acct_fixture',liveMode:false,productId:'prod_fixture',monthlyPriceId:'price_month',annualPriceId:'price_year',taxCode:'txcd_10000000',taxBehavior:'inclusive'};
const config={sandboxOnly:true,returnOrigin:'https://sandbox.example.com',productionOrigin:'https://www.example.com',portalConfiguration:'bpc_fixture',checkoutEnabled:true,taxPolicy:'sandbox_no_tax_fixture'};
const unavailable={kind:'unavailable'};
function fixture(annual=false,patch={}){
 const priceId=annual?cfg.annualPriceId:cfg.monthlyPriceId,amount=annual?6900:699;
 const binding={ownerId:owner,accountId:cfg.accountId,liveMode:false,customerId:'cus_fixture'};
 const intent={...binding,intentId,priceId,createdAt:now-30,closedAt:null};
 const list=data=>({object:'list',has_more:false,data});
 const price=y=>({object:'price',id:y?cfg.annualPriceId:cfg.monthlyPriceId,active:true,livemode:false,product:cfg.productId,type:'recurring',currency:'eur',unit_amount:y?6900:699,billing_scheme:'per_unit',lookup_key:y?'dlkt_info_premium_annual_v1':'dlkt_info_premium_monthly_v1',tax_behavior:'inclusive',transform_quantity:null,custom_unit_amount:null,recurring:{interval:y?'year':'month',interval_count:1,usage_type:'licensed'}});
 const checkout={object:'checkout.session',id:'cs_test_fixture',livemode:false,mode:'subscription',ui_mode:'hosted_page',customer:binding.customerId,client_reference_id:intentId,status:'open',payment_status:'unpaid',currency:'eur',amount_total:amount,amount_subtotal:amount,expires_at:intent.createdAt+3600,success_url:config.returnOrigin+'/billing/return',cancel_url:config.returnOrigin+'/billing/cancel',allow_promotion_codes:false,subscription:null,payment_method_types:['card'],automatic_tax:{enabled:false},url:'https://checkout.stripe.com/c/pay/cs_test_fixture#fixture'};
 const portal={object:'billing_portal.session',id:'bps_fixture',livemode:false,customer:binding.customerId,configuration:'bpc_fixture',return_url:config.returnOrigin+'/billing',url:'https://billing.stripe.com/p/session/fixture'};
 const responses={'GET /v1/account':{object:'account',id:cfg.accountId},
 ['GET /v1/products/'+cfg.productId]:{object:'product',id:cfg.productId,active:true,livemode:false,tax_code:cfg.taxCode},['GET /v1/prices/'+cfg.monthlyPriceId]:price(false),['GET /v1/prices/'+cfg.annualPriceId]:price(true),
 'GET /v1/customers/cus_fixture':{object:'customer',id:'cus_fixture',livemode:false,metadata:{application:'dlkt_info',environment:'sandbox'}},
 'GET /v1/subscriptions?customer=cus_fixture&status=all&limit=100':list([]),
 'GET /v1/invoices?customer=cus_fixture&limit=100':list([]),
 'GET /v1/checkout/sessions?customer=cus_fixture&limit=100':list([]),
 'POST /v1/checkout/sessions':checkout,
 'GET /v1/checkout/sessions/cs_test_fixture/line_items?limit=2':list([{object:'item',quantity:1,currency:'eur',amount_total:amount,amount_subtotal:amount,price:price(annual)}]),
 'GET /v1/billing_portal/configurations/bpc_fixture':{object:'billing_portal.configuration',id:'bpc_fixture',active:true,livemode:false,metadata:{application:'dlkt_info',environment:'sandbox',configuration_version:'1'},login_page:{enabled:false},features:{customer_update:{enabled:false},invoice_history:{enabled:true},payment_method_update:{enabled:true},subscription_cancel:{enabled:true,mode:'at_period_end',proration_behavior:'none'},subscription_pause:{enabled:false},subscription_update:{enabled:false}}},
 'POST /v1/billing_portal/sessions':portal};
 const calls=[];
 const transport=async(url,options)=>{const u=new URL(url);calls.push({url,options});const v=responses[options.method+' '+u.pathname+u.search];if(v instanceof Response)return v;if(v===undefined)throw Error('unexpected route');return new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}})};
 return {binding,intent,responses,calls,transport,checkout,portal,client:new SandboxHostedSessions(cfg,readKey,writeKey,{...config,...patch},transport)};
}
const create=f=>f.client.createCheckout(owner,f.binding,f.intent,now),portal=f=>f.client.createPortal(owner,f.binding,requestId);
const posts=f=>f.calls.filter(x=>x.options.method==='POST');
for(const annual of [false,true])test('fixed '+(annual?'annual':'monthly')+' Checkout with reserved intent and exact provider response',async()=>{
 const f=fixture(annual),result=await create(f);assert.equal(result.kind,'checkout');assert.equal(result.sessionId,'cs_test_fixture');assert.equal(result.expiresAt,f.intent.createdAt+3600);
 const [p]=posts(f);assert.equal(posts(f).length,1);assert.equal(p.options.headers['Idempotency-Key'],'dlkt-sandbox-checkout-v1-'+intentId);assert.equal(p.options.headers.Authorization,'Bearer '+writeKey);
 const body=p.options.body;assert.equal(body.get('line_items[0][price]'),f.intent.priceId);assert.equal(body.get('line_items[0][quantity]'),'1');assert.equal(body.get('allowed_payment_method_types[0]'),'card');assert.equal(body.has('payment_method_types[0]'),false);assert.equal(body.get('automatic_tax[enabled]'),'false');assert.equal(body.get('expires_at'),String(f.intent.createdAt+3600));
 assert.equal(body.get('success_url'),config.returnOrigin+'/billing/return');assert.equal(body.has('subscription_data[trial_period_days]'),false);
 for(const {url,options} of f.calls){assert.equal(new URL(url).origin,'https://api.stripe.com');assert.equal(options.redirect,'error');assert.equal(options.headers['Stripe-Version'],STRIPE_BILLING_API_VERSION);assert.equal(options.headers['Stripe-Account'],undefined);}
 assert.equal(JSON.stringify(f.client),'{}');
});
test('Checkout disabled by default without explicit isolated tax fixture gate',async()=>{
 for(const patch of [{checkoutEnabled:false},{taxPolicy:'pending'},{taxPolicy:undefined}]){const f=fixture(false,patch);assert.deepEqual(await create(f),unavailable);assert.equal(f.calls.length,0);}
});
test('configuration requires sandbox and separate restricted keys and return origin',()=>{
 for(const patch of [{sandboxOnly:false},{returnOrigin:config.productionOrigin},{returnOrigin:'https://sandbox.example.com/path'},{returnOrigin:'http://sandbox.example.com'},{portalConfiguration:'bpc_bad/../x'}])assert.throws(()=>new SandboxHostedSessions(cfg,readKey,writeKey,{...config,...patch}));
 for(const key of ['rk_live_fixture','sk_test_fixture',readKey,'rk_test_bad\n'])assert.throws(()=>new SandboxHostedSessions(cfg,readKey,key,config));
});
test('owner, intent and mode mismatch fail without any provider request',async()=>{
 for(const patch of [{ownerId:other},{customerId:'cus_other'},{accountId:'acct_other'},{liveMode:true},{closedAt:now},{createdAt:now+1},{createdAt:now-601},{intentId:'not-a-uuid'}]){const f=fixture();Object.assign(f.intent,patch);assert.deepEqual(await create(f),unavailable);assert.equal(f.calls.length,0);}
});
test('foreign price and foreign customer marker rejected before POST',async()=>{
 const f=fixture();f.intent.priceId='price_other';assert.deepEqual(await create(f),unavailable);assert.equal(posts(f).length,0);
 const g=fixture();g.responses['GET /v1/customers/cus_fixture'].metadata.application='other';assert.deepEqual(await create(g),unavailable);assert.equal(posts(g).length,0);
});
test('retries use the same idempotency key, price and expiry',async()=>{
 const f=fixture();await create(f);await f.client.createCheckout(owner,f.binding,f.intent,now+5);assert.equal(posts(f).length,2);assert.equal(posts(f)[0].options.headers['Idempotency-Key'],posts(f)[1].options.headers['Idempotency-Key']);assert.equal(posts(f)[0].options.body.toString(),posts(f)[1].options.body.toString());
});
test('existing exact session is reused and other intent or completed session cannot be replaced',async()=>{
 const path='GET /v1/checkout/sessions?customer=cus_fixture&limit=100';
 const f=fixture();f.responses[path].data=[f.checkout];assert.equal((await create(f)).kind,'checkout');assert.equal(posts(f).length,0);
 for(const patch of [{client_reference_id:requestId},{status:'complete'},{livemode:true}]){const g=fixture();g.responses[path].data=[{...g.checkout,...patch}];assert.deepEqual(await create(g),unavailable);assert.equal(posts(g).length,0);}
});
test('existing subscription or incomplete provider list blocks another checkout',async()=>{
 const p='GET /v1/subscriptions?customer=cus_fixture&status=all&limit=100';
 for(const v of [{object:'list',has_more:true,data:[]},{object:'list',has_more:false,data:[{id:'sub_foreign'}]}]){const f=fixture();f.responses[p]=v;assert.deepEqual(await create(f),unavailable);assert.equal(posts(f).length,0);}
});
const checkoutCases=[
 ['live session',{livemode:true}],['foreign customer',{customer:'cus_other'}],['wrong mode',{mode:'payment'}],['other intent',{client_reference_id:requestId}],['amount changed',{amount_total:1}],['currency changed',{currency:'usd'}],['expiry changed',{expires_at:now+50}],['unsafe host',{url:'https://checkout.stripe.com.evil.example/c/pay/cs_test_fixture'}],['wrong session link',{url:'https://checkout.stripe.com/c/pay/cs_test_other'}],['session link suffix',{url:'https://checkout.stripe.com/c/pay/cs_test_fixtureOther'}],['URL credentials',{url:'https://user@checkout.stripe.com/c/pay/cs_test_fixture'}],['redirect substitution',{success_url:'https://evil.example'}],['tax not supported in pilot',{automatic_tax:{enabled:true}}],['unexpected methods',{payment_method_types:['card','sepa_debit']}],['promotions enabled',{allow_promotion_codes:true}],['completed checkout',{status:'complete'}]];
for(const [name,patch] of checkoutCases)test(name+' rejected',async()=>{const f=fixture();Object.assign(f.checkout,patch);assert.deepEqual(await create(f),unavailable)});
test('line-item mismatch or incomplete page denies session URL',async()=>{
 for(const patch of [{quantity:2},{price:{id:'price_other'}}]){const f=fixture();Object.assign(f.responses['GET /v1/checkout/sessions/cs_test_fixture/line_items?limit=2'].data[0],patch);assert.deepEqual(await create(f),unavailable);}
 const f=fixture();f.responses['GET /v1/checkout/sessions/cs_test_fixture/line_items?limit=2'].has_more=true;assert.deepEqual(await create(f),unavailable);
});
test('dedicated portal uses verified customer and explicit configuration',async()=>{
 const f=fixture(false,{checkoutEnabled:false,taxPolicy:'pending'});const result=await portal(f);assert.equal(result.kind,'portal');
 const [p]=posts(f);assert.equal(posts(f).length,1);assert.equal(p.options.body.get('customer'),'cus_fixture');assert.equal(p.options.body.get('configuration'),'bpc_fixture');assert.equal(p.options.body.get('return_url'),config.returnOrigin+'/billing');assert.equal(p.options.headers['Idempotency-Key'],'dlkt-sandbox-portal-v1-'+requestId);
});
test('portal blocks public login, foreign config, plan changes, immediate cancel and unknown enabled feature',async()=>{
 const path='GET /v1/billing_portal/configurations/bpc_fixture';
 for(const mutate of [v=>v.login_page.enabled=true,v=>v.id='bpc_other',v=>v.livemode=true,v=>v.features.subscription_update.enabled=true,v=>v.features.subscription_cancel.mode='immediately',v=>v.features.unknown={enabled:true}]){
 const f=fixture();mutate(f.responses[path]);assert.deepEqual(await portal(f),unavailable);assert.equal(posts(f).length,0);}
});
test('portal denies customer with unrelated invoices or incomplete history',async()=>{
 const p='GET /v1/invoices?customer=cus_fixture&limit=100';
 for(const value of [{object:'list',has_more:true,data:[]},{object:'list',has_more:false,data:[{object:'invoice',customer:'cus_fixture',livemode:false,parent:{type:'subscription_details',subscription_details:{subscription:'sub_other'}}}]}]){const f=fixture();f.responses[p]=value;assert.deepEqual(await portal(f),unavailable);assert.equal(posts(f).length,0);}
});
test('portal rejects malicious URL, foreign customer, live session or missing URL',async()=>{
 for(const patch of [{url:'https://billing.stripe.com.evil.example/p/session/fixture'},{customer:'cus_other'},{configuration:'bpc_other'},{livemode:true},{url:null}]){const f=fixture();Object.assign(f.portal,patch);assert.deepEqual(await portal(f),unavailable);}
});
test('wrong write account prevents either session even with correct read account',async()=>{
 const f=fixture();f.client=new SandboxHostedSessions(cfg,readKey,writeKey,config,async(url,opts)=>{if(url==='https://api.stripe.com/v1/account'&&opts.headers.Authorization==='Bearer '+writeKey)return new Response(JSON.stringify({object:'account',id:'acct_other'}),{headers:{'content-type':'application/json'}});return f.transport(url,opts)});
 assert.deepEqual(await create(f),unavailable);assert.deepEqual(await portal(f),unavailable);assert.equal(posts(f).length,0);
});
test('provider failures and invalid body fail without leaking credentials',async()=>{
 for(const response of [new Response(writeKey,{status:403}),new Response('',{status:302,headers:{location:'https://evil.example'}}),new Response('{',{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'999999'}})]){const f=fixture();f.responses['POST /v1/checkout/sessions']=response;assert.deepEqual(await create(f),unavailable);}
});

test('expired reservation is recovered by exact authenticated GET, without POST',async()=>{
 const f=fixture();const list='GET /v1/checkout/sessions?customer=cus_fixture&limit=100';
 f.responses[list].data=[{...f.checkout,status:'expired',url:null}];
 f.responses['GET /v1/checkout/sessions/cs_test_fixture']={...f.checkout,status:'expired',url:null};
 const result=await f.client.observeCheckout(owner,f.binding,f.intent,now+4000);
 assert.deepEqual(result,{kind:'terminal',status:'expired',paymentStatus:'unpaid',sessionId:'cs_test_fixture',expiresAt:f.intent.createdAt+3600,subscriptionId:null,itemId:null});
 assert.equal(posts(f).length,0);
});
test('open recovery accepts a matching session after the creation window, not after expiry',async()=>{
 const f=fixture();f.responses['GET /v1/checkout/sessions?customer=cus_fixture&limit=100'].data=[f.checkout];
 f.responses['GET /v1/checkout/sessions/cs_test_fixture']=f.checkout;
 assert.equal((await f.client.observeCheckout(owner,f.binding,f.intent,now+700)).kind,'checkout');
 assert.deepEqual(await f.client.observeCheckout(owner,f.binding,f.intent,now+4000),unavailable);
 assert.equal(posts(f).length,0);
});
test('attached session cannot be recreated on missing or foreign provider list',async()=>{
 const f=fixture();f.intent.sessionId='cs_test_existing';assert.deepEqual(await create(f),unavailable);assert.equal(posts(f).length,0);
 f.responses['GET /v1/checkout/sessions?customer=cus_fixture&limit=100'].data=[f.checkout];
 assert.deepEqual(await create(f),unavailable);assert.equal(posts(f).length,0);
});
test('complete recovery binds exact subscription item without authorizing payment',async()=>{
 const f=fixture();const price=f.responses['GET /v1/prices/price_month'],sub={object:'subscription',id:'sub_fixture',livemode:false,customer:'cus_fixture',status:'active',cancel_at:null,cancel_at_period_end:false,pause_collection:null,latest_invoice:null,
 items:{object:'list',has_more:false,data:[{object:'subscription_item',id:'si_fixture',subscription:'sub_fixture',quantity:1,price,current_period_start:now-30,current_period_end:now+86400*30-30}]}};
 const session={...f.checkout,status:'complete',payment_status:'paid',subscription:'sub_fixture',url:null};
 f.responses['GET /v1/checkout/sessions?customer=cus_fixture&limit=100'].data=[session];
 f.responses['GET /v1/checkout/sessions/cs_test_fixture']=session;
 f.responses['GET /v1/subscriptions?customer=cus_fixture&status=all&limit=100'].data=[sub];
 f.responses['GET /v1/subscriptions/sub_fixture']=sub;
 const result=await f.client.observeCheckout(owner,f.binding,f.intent,now);
 assert.deepEqual(result,{kind:'terminal',status:'complete',paymentStatus:'paid',sessionId:'cs_test_fixture',expiresAt:f.intent.createdAt+3600,subscriptionId:'sub_fixture',itemId:'si_fixture'});
 assert.equal(posts(f).length,0);
 f.responses['GET /v1/checkout/sessions/cs_test_fixture']={...session,payment_status:'unpaid'};
 assert.deepEqual(await f.client.observeCheckout(owner,f.binding,f.intent,now),unavailable);
 f.responses['GET /v1/checkout/sessions/cs_test_fixture']=session;
 f.responses['GET /v1/subscriptions/sub_fixture']={...sub,customer:'cus_other'};
 assert.deepEqual(await f.client.observeCheckout(owner,f.binding,f.intent,now),unavailable);
});
test('recovery refuses missing, partial, wrong or different attached session and does not create',async()=>{
 const list='GET /v1/checkout/sessions?customer=cus_fixture&limit=100';
 for(const mutate of [f=>{},f=>{f.responses[list].has_more=true},f=>{f.responses[list].data=[{...f.checkout,client_reference_id:requestId}]},
 f=>{f.responses[list].data=[f.checkout];f.intent.sessionId='cs_test_other'},
 f=>{f.responses[list].data=[f.checkout];f.responses['GET /v1/checkout/sessions/cs_test_fixture']={...f.checkout,id:'cs_test_other'}}]){
   const f=fixture();mutate(f);assert.deepEqual(await f.client.observeCheckout(owner,f.binding,f.intent,now),unavailable);assert.equal(posts(f).length,0);
 }
});
