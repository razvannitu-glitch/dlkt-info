import test from 'node:test';
import assert from 'node:assert/strict';
import {SandboxCardProofReader} from '../.billing-build/docs/billing-ledger-sandbox/payment-proof.js';
import {StripeReadClient,STRIPE_BILLING_API_VERSION} from '../.billing-build/source/src/billing/stripe-reader.js';
import {evaluatePremiumAccess} from '../.billing-build/source/src/billing/entitlement.js';

const now=1795695000,owner='00000000-0000-4000-8000-000000000001';
const cfg={accountId:'acct_fixture',liveMode:false,productId:'prod_fixture',monthlyPriceId:'price_month',annualPriceId:'price_year',taxCode:'txcd_10000000',taxBehavior:'inclusive'};
const key='rk_test_fixtureNotARealKey';
const fixture=(annual=false)=>{
 const priceId=annual?cfg.annualPriceId:cfg.monthlyPriceId,amount=annual?6900:699,start=now-30,end=start+(annual?365:30)*86400;
 const binding={ownerId:owner,accountId:cfg.accountId,liveMode:false,customerId:'cus_fixture',subscriptionId:'sub_fixture',itemId:'si_fixture',priceId};
 const price=y=>({object:'price',id:y?cfg.annualPriceId:cfg.monthlyPriceId,active:true,livemode:false,product:cfg.productId,type:'recurring',currency:'eur',unit_amount:y?6900:699,billing_scheme:'per_unit',lookup_key:y?'dlkt_info_premium_annual_v1':'dlkt_info_premium_monthly_v1',tax_behavior:'inclusive',transform_quantity:null,custom_unit_amount:null,recurring:{interval:y?'year':'month',interval_count:1,usage_type:'licensed'}});
 const list=data=>({object:'list',has_more:false,data});
 const payment={object:'invoice_payment',id:'inpay_fixture',invoice:'in_fixture',livemode:false,status:'paid',currency:'eur',amount_requested:amount,amount_paid:amount,payment:{type:'payment_intent',payment_intent:'pi_fixture'}};
 const line={object:'line_item',id:'il_fixture',invoice:'in_fixture',livemode:false,currency:'eur',quantity:1,amount,parent:{type:'subscription_item_details',subscription_item_details:{subscription:'sub_fixture',subscription_item:'si_fixture',proration:false}},pricing:{type:'price_details',price_details:{price:priceId,product:cfg.productId}},period:{start,end},discounts:[],discount_amounts:[],pretax_credit_amounts:[],taxes:[]};
 const invoice={object:'invoice',id:'in_fixture',livemode:false,customer:'cus_fixture',currency:'eur',status:'paid',collection_method:'charge_automatically',billing_reason:'subscription_create',amount_due:amount,amount_paid:amount,amount_remaining:0,total:amount,starting_balance:0,ending_balance:0,amount_paid_off_stripe:0,amount_shipping:0,pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0,discounts:[],total_discount_amounts:[],parent:{type:'subscription_details',subscription_details:{subscription:'sub_fixture'}},lines:list([line])};
 const responses={'/v1/account':{object:'account',id:cfg.accountId},['/v1/products/'+cfg.productId]:{object:'product',id:cfg.productId,active:true,livemode:false,tax_code:cfg.taxCode},
 ['/v1/prices/'+cfg.monthlyPriceId]:price(false),['/v1/prices/'+cfg.annualPriceId]:price(true),
 '/v1/subscriptions/sub_fixture':{object:'subscription',id:'sub_fixture',livemode:false,customer:'cus_fixture',status:'active',cancel_at:null,cancel_at_period_end:false,pause_collection:null,latest_invoice:'in_fixture',items:list([{object:'subscription_item',id:'si_fixture',subscription:'sub_fixture',quantity:1,price:price(annual),current_period_start:start,current_period_end:end}])},
 '/v1/invoices/in_fixture':invoice,'/v1/invoices/in_fixture?expand%5B%5D=amount_paid_off_stripe':structuredClone(invoice),
 '/v1/invoice_payments?invoice=in_fixture&limit=2':list([payment]),
 '/v1/invoice_payments?payment%5Btype%5D=payment_intent&payment%5Bpayment_intent%5D=pi_fixture&limit=2':list([structuredClone(payment)]),
 '/v1/payment_intents/pi_fixture':{object:'payment_intent',id:'pi_fixture',livemode:false,customer:'cus_fixture',currency:'eur',status:'succeeded',amount,amount_received:amount,amount_capturable:0,review:null,latest_charge:'ch_fixture',payment_method:'pm_fixture'},
 '/v1/charges/ch_fixture':{object:'charge',id:'ch_fixture',livemode:false,customer:'cus_fixture',currency:'eur',status:'succeeded',payment_intent:'pi_fixture',payment_method:'pm_fixture',paid:true,captured:true,amount,amount_captured:amount,amount_refunded:0,refunded:false,disputed:false,review:null,payment_method_details:{type:'card'},outcome:{type:'authorized',risk_level:'normal'}},
 '/v1/refunds?charge=ch_fixture&limit=1':list([]),'/v1/disputes?charge=ch_fixture&limit=1':list([]),'/v1/radar/early_fraud_warnings?charge=ch_fixture&limit=1':list([])};
 const calls=[];
 const transport=async(url,options)=>{const parsed=new URL(url);calls.push({url,options});const v=responses[parsed.pathname+parsed.search];if(v instanceof Response)return v;if(v===undefined)throw Error('unexpected route');return new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}})};
 return {binding,responses,calls,transport,reader:new SandboxCardProofReader(cfg,key,transport)};
};
const invoicePath='/v1/invoices/in_fixture?expand%5B%5D=amount_paid_off_stripe';
const payPath='/v1/invoice_payments?invoice=in_fixture&limit=2';
const allocationPath='/v1/invoice_payments?payment%5Btype%5D=payment_intent&payment%5Bpayment_intent%5D=pi_fixture&limit=2';
const chargePath='/v1/charges/ch_fixture',intentPath='/v1/payment_intents/pi_fixture',subPath='/v1/subscriptions/sub_fixture';
const deny=async f=>assert.deepEqual(await f.reader.inspect(owner,f.binding,now),{kind:'not_verified'});
for(const annual of [false,true])test('exact captured '+(annual?'annual':'monthly')+' invoice yields observation only',async()=>{
 const f=fixture(annual);const o=await f.reader.inspect(owner,f.binding,now);
 assert.equal(o.kind,'captured_card_observation');assert.equal(o.amountCents,annual?6900:699);assert.equal(o.riskSignals,'none_observed');
 assert.equal(o.fundsConfirmed,false);assert.equal(o.riskState,'unknown');assert.ok(Object.isFrozen(o));
 for(const {url,options} of f.calls){assert.equal(new URL(url).origin,'https://api.stripe.com');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers['Stripe-Version'],STRIPE_BILLING_API_VERSION);assert.equal(options.headers['Stripe-Account'],undefined);}
 const c=await new StripeReadClient(cfg,key,f.transport).loadCatalog();
 assert.deepEqual(evaluatePremiumAccess(owner,false,c,f.binding,o,now),{state:'denied'});
 assert.equal(JSON.stringify(f.reader),'{}');
});
test('live or malformed key, exclusive tax configuration rejected',()=>{
 for(const k of ['rk_live_fixture','sk_test_fixture','rk_test_','rk_test_bad\n'])assert.throws(()=>new SandboxCardProofReader(cfg,k));
 assert.throws(()=>new SandboxCardProofReader({...cfg,taxBehavior:'exclusive'},key));
});
const cases=[
 ['foreign account','/v1/account',v=>{v.id='acct_other'}],
 ['canceled subscription',subPath,v=>{v.status='canceled'}],
 ['paused collection',subPath,v=>{v.pause_collection={behavior:'void'}}],
 ['expired period',subPath,v=>{v.items.data[0].current_period_end=now}],
 ['foreign invoice customer',invoicePath,v=>{v.customer='cus_other'}],
 ['live invoice',invoicePath,v=>{v.livemode=true}],
 ['unpaid invoice',invoicePath,v=>{v.status='open'}],
 ['off-Stripe payment',invoicePath,v=>{v.amount_paid_off_stripe=699}],
 ['unverified off-Stripe amount',invoicePath,v=>{delete v.amount_paid_off_stripe}],
 ['partial payment',invoicePath,v=>{v.amount_paid=300}],
 ['credit balance',invoicePath,v=>{v.starting_balance=-699}],
 ['credit note',invoicePath,v=>{v.post_payment_credit_notes_amount=1}],
 ['manual invoice',invoicePath,v=>{v.billing_reason='manual'}],
 ['incomplete line pagination',invoicePath,v=>{v.lines.has_more=true}],
 ['multiple lines',invoicePath,v=>{v.lines.data.push(structuredClone(v.lines.data[0]))}],
 ['foreign subscription item',invoicePath,v=>{v.lines.data[0].parent.subscription_item_details.subscription_item='si_other'}],
 ['wrong period',invoicePath,v=>{v.lines.data[0].period.end--}],
 ['proration',invoicePath,v=>{v.lines.data[0].parent.subscription_item_details.proration=true}],
 ['discount',invoicePath,v=>{v.lines.data[0].discounts=['di_other']}],
 ['unsupported tax line',invoicePath,v=>{v.lines.data[0].taxes=[{amount:1}]}],
 ['foreign price',invoicePath,v=>{v.lines.data[0].pricing.price_details.price='price_other'}],
 ['foreign product',invoicePath,v=>{v.lines.data[0].pricing.price_details.product='prod_other'}],
 ['multiple invoice payments',payPath,v=>{v.data.push(structuredClone(v.data[0]))}],
 ['unpaid allocation',payPath,v=>{v.data[0].status='open'}],
 ['payment record instead of intent',payPath,v=>{v.data[0].payment={type:'payment_record',payment_record:'pr_other'}}],
 ['payment allocated elsewhere',allocationPath,v=>{v.data.push({...v.data[0],invoice:'in_other'})}],
 ['foreign allocation',allocationPath,v=>{v.data[0].invoice='in_other'}],
 ['wrong intent customer',intentPath,v=>{v.customer='cus_other'}],
 ['intent not succeeded',intentPath,v=>{v.status='requires_capture'}],
 ['incorrect charge intent',chargePath,v=>{v.payment_intent='pi_other'}],
 ['uncaptured charge',chargePath,v=>{v.captured=false}],
 ['charge partial capture',chargePath,v=>{v.amount_captured=600}],
 ['refunded amount',chargePath,v=>{v.amount_refunded=1}],
 ['disputed charge',chargePath,v=>{v.disputed=true}],
 ['manual review',chargePath,v=>{v.review='prv_fixture'}],
 ['elevated risk',chargePath,v=>{v.outcome.risk_level='elevated'}],
 ['noncard payment',chargePath,v=>{v.payment_method_details.type='sepa_debit'}],
 ['refund present','/v1/refunds?charge=ch_fixture&limit=1',v=>{v.data.push({id:'re_fixture'})}],
 ['dispute present','/v1/disputes?charge=ch_fixture&limit=1',v=>{v.data.push({id:'dp_fixture'})}],
 ['fraud warning present','/v1/radar/early_fraud_warnings?charge=ch_fixture&limit=1',v=>{v.data.push({id:'issfr_fixture'})}],
 ['incomplete fraud list','/v1/radar/early_fraud_warnings?charge=ch_fixture&limit=1',v=>{v.has_more=true}],
];
for(const [name,path,mutate] of cases)test(name+' fails closed',async()=>{const f=fixture();mutate(f.responses[path]);await deny(f)});
test('bound subscription item and price required',async()=>{for(const patch of [{itemId:'si_other'},{priceId:'price_other'},{ownerId:'00000000-0000-4000-8000-000000000002'},{liveMode:true}]){const f=fixture();Object.assign(f.binding,patch);await deny(f)}});
test('provider error, redirect, oversized body, and invalid JSON fail closed without leaked secrets',async()=>{
 for(const response of [new Response(key,{status:403}),new Response('',{status:302,headers:{location:'https://other.example/'} }),new Response('{}',{headers:{'content-type':'application/json','content-length':'999999'}}),new Response('{',{headers:{'content-type':'application/json'}}),new Response(new Uint8Array(270000),{headers:{'content-type':'application/json'}})]){const f=fixture();f.responses[chargePath]=response;await deny(f);}
});
