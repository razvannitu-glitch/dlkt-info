import test from 'node:test';
import assert from 'node:assert/strict';
import {PREMIUM_PLANS, verifyPremiumCatalog, premiumPlanForPrice} from '../.build/src/billing/catalog.js';
import {evaluatePremiumAccess} from '../.build/src/billing/entitlement.js';

const now = 1795695000, owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const cfg = {accountId:'acct_fixture',liveMode:false,productId:'prod_fixture',
 monthlyPriceId:'price_monthlyfixture',annualPriceId:'price_annualfixture',
 taxCode:'txcd_00000000',taxBehavior:'inclusive'}; // Synthetic ID/code; not fiscal advice or a real Stripe object.
const product = {object:'product',id:cfg.productId,active:true,livemode:false,tax_code:cfg.taxCode};
function price(plan) {
 const terms=PREMIUM_PLANS[plan];
 return {object:'price',id:plan==='monthly'?cfg.monthlyPriceId:cfg.annualPriceId,
 active:true,livemode:false,product:cfg.productId,type:'recurring',currency:'eur',
 unit_amount:terms.unitAmount,billing_scheme:'per_unit',lookup_key:terms.lookupKey,
 tax_behavior:'inclusive',transform_quantity:null,custom_unit_amount:null,
 recurring:{interval:terms.interval,interval_count:1,usage_type:'licensed'}};
}
function catalog(configuration=cfg,p=product,m=price('monthly'),a=price('annual'),account=cfg.accountId) {
 return verifyPremiumCatalog(configuration,account,p,m,a);
}
function fixtures(plan='monthly') {
 const c=catalog(), b={ownerId:owner,accountId:c.accountId,liveMode:false,customerId:'cus_fixture',subscriptionId:'sub_fixture'};
 const start=now-100,end=start+(plan==='monthly'?30:365)*86400,priceId=plan==='monthly'?c.monthlyPriceId:c.annualPriceId;
 const e={version:'dlkt-info-premium-evidence-1',accountId:c.accountId,liveMode:false,customerId:b.customerId,
 subscriptionId:b.subscriptionId,productId:c.productId,priceId,quantity:1,status:'active',collectionPaused:false,
 riskState:'clear',verifiedAt:now,periodStart:start,periodEnd:end,cancelAt:null,cancelAtPeriodEnd:false,
 payment:{invoiceId:'in_fixture',state:'paid',fundsConfirmed:true,currency:'eur',customerId:b.customerId,
 subscriptionId:b.subscriptionId,productId:c.productId,priceId,periodStart:start,periodEnd:end}};
 return {c,b,e};
}
const denied=(c,b,e,who=owner,mode=false,at=now)=>assert.deepEqual(evaluatePremiumAccess(who,mode,c,b,e,at),{state:'denied'});

test('approved monthly and annual variants use exact cents and one product',()=>{
 assert.equal(PREMIUM_PLANS.monthly.unitAmount,699);assert.equal(PREMIUM_PLANS.annual.unitAmount,6900);
 assert.equal(PREMIUM_PLANS.monthly.interval,'month');assert.equal(PREMIUM_PLANS.annual.interval,'year');
 const c=catalog();assert.equal(premiumPlanForPrice(c,cfg.monthlyPriceId),'monthly');
 assert.equal(premiumPlanForPrice(c,cfg.annualPriceId),'annual');assert.equal(premiumPlanForPrice(c,'price_foreign'),null);
 assert.ok(Object.isFrozen(c));assert.ok(Object.isFrozen(PREMIUM_PLANS.monthly));
});
test('catalog rejects missing tax decisions, foreign account, reused IDs and unconfigured mode',()=>{
 for(const patch of [{taxCode:undefined},{taxBehavior:'unspecified'},{liveMode:undefined},{monthlyPriceId:cfg.annualPriceId},{productId:'prod_other'}]){
  assert.throws(()=>catalog({...cfg,...patch}),/PREMIUM_CATALOG_INVALID/u);
 }
 assert.throws(()=>catalog(cfg,product,price('monthly'),price('annual'),'acct_other'),/PREMIUM_CATALOG_INVALID/u);
});
test('catalog rejects inactive, foreign, wrong-mode and wrong-tax products',()=>{
 for(const patch of [{active:false},{id:'prod_other'},{livemode:true},{tax_code:'txcd_00000001'},{object:'price'}])
  assert.throws(()=>catalog(cfg,{...product,...patch}),/PREMIUM_CATALOG_INVALID/u);
});
test('catalog rejects altered monthly prices and all billing-shape mismatches',()=>{
 for(const patch of [{active:false},{livemode:true},{product:'prod_other'},{unit_amount:700},{currency:'usd'},
 {type:'one_time'},{billing_scheme:'tiered'},{lookup_key:'other_app'},{tax_behavior:'exclusive'},
 {custom_unit_amount:{}},{transform_quantity:{}},{recurring:{interval:'year',interval_count:1,usage_type:'licensed'}},
 {recurring:{interval:'month',interval_count:2,usage_type:'licensed'}},{recurring:{interval:'month',interval_count:1,usage_type:'metered'}}])
  assert.throws(()=>catalog(cfg,product,{...price('monthly'),...patch}),/PREMIUM_CATALOG_INVALID/u);
 assert.throws(()=>catalog(cfg,product,price('monthly'),{...price('annual'),unit_amount:699}),/PREMIUM_CATALOG_INVALID/u);
});
test('both validated paid variants yield a bounded authorization, never an annual cached grant',()=>{
 for(const plan of ['monthly','annual']){
  const {c,b,e}=fixtures(plan);
  assert.deepEqual(evaluatePremiumAccess(owner,false,c,b,e,now),{state:'premium',plan,validUntil:now+300});
 }
});
test('unverified or cloned catalog and wrong request mode cannot authorize',()=>{
 const {c,b,e}=fixtures();denied({...c},b,e);denied(c,b,e,owner,true);denied(null,b,e);
});
test('customer, subscription, user and Stripe account are bound independently of metadata',()=>{
 const {c,b,e}=fixtures();denied(c,b,e,other);denied(c,b,e,'');
 for(const patch of [{ownerId:other},{accountId:'acct_foreign'},{liveMode:true},{customerId:'cus_foreign'},{subscriptionId:'sub_foreign'}]) denied(c,{...b,...patch},e);
 for(const patch of [{accountId:'acct_foreign'},{liveMode:true},{customerId:'cus_foreign'},{subscriptionId:'sub_foreign'},
 {productId:'prod_foreign'},{priceId:'price_foreign'},{quantity:2}]) denied(c,b,{...e,...patch,metadata:{ownerId:owner}});
});
test('only active, unpaused subscriptions with clear risk can qualify',()=>{
 const {c,b,e}=fixtures();
 for(const status of ['trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused',undefined]) denied(c,b,{...e,status});
 for(const riskState of ['unknown','blocked',undefined]) denied(c,b,{...e,riskState});
 denied(c,b,{...e,collectionPaused:true});denied(c,b,{...e,collectionPaused:undefined});
});
test('paid evidence must match exact invoice coverage and ownership',()=>{
 const {c,b,e}=fixtures();
 for(const patch of [{invoiceId:'evt_forged'},{state:'open'},{fundsConfirmed:false},{currency:'usd'},
 {customerId:'cus_foreign'},{subscriptionId:'sub_foreign'},{priceId:'price_foreign'},{productId:'prod_foreign'},
 {periodStart:e.periodStart+1},{periodEnd:e.periodEnd-1}]) denied(c,b,{...e,payment:{...e.payment,...patch}});
 denied(c,b,{...e,payment:null});denied(c,b,{...e,checkoutSuccess:true,payment:undefined});
});
test('stale, future, malformed or expired evidence denies even if status is active',()=>{
 const {c,b,e}=fixtures();
 for(const verifiedAt of [now-301,now+1,NaN,String(now),undefined]) denied(c,b,{...e,verifiedAt});
 denied(c,b,e,owner,false,now+300);denied(c,b,e,owner,false,e.periodEnd);
 denied(c,b,{...e,periodStart:now+1});denied(c,b,{...e,periodEnd:e.periodStart+400*86400});
 denied(c,b,e,owner,false,NaN);
});
test('scheduled cancellation preserves paid access until the earliest verified cutoff',()=>{
 const {c,b,e}=fixtures();
 assert.deepEqual(evaluatePremiumAccess(owner,false,c,b,{...e,cancelAtPeriodEnd:true,cancelAt:e.periodEnd},now),
 {state:'premium',plan:'monthly',validUntil:now+300});
 assert.deepEqual(evaluatePremiumAccess(owner,false,c,b,{...e,cancelAt:now+60},now),{state:'premium',plan:'monthly',validUntil:now+60});
 denied(c,b,{...e,cancelAt:now});denied(c,b,{...e,cancelAtPeriodEnd:'true'});
});
test('never invoke accessors or trust inherited provider values',()=>{
 const {c,b,e}=fixtures();let called=0;
 const forged={...e};Object.defineProperty(forged,'status',{get(){called++;return 'active';}});
 denied(c,b,forged);denied(c,b,Object.create(e));
 const badPrice={...price('monthly')};Object.defineProperty(badPrice,'unit_amount',{get(){called++;return 699;}});
 assert.throws(()=>catalog(cfg,product,badPrice),/PREMIUM_CATALOG_INVALID/u);assert.equal(called,0);
});
test('verified catalog is detached from mutable inputs and no billing IDs leak in access response',()=>{
 const conf={...cfg},m=price('monthly'),c=catalog(conf,product,m);conf.monthlyPriceId='price_foreign';m.unit_amount=1;
 const {b,e}=fixtures();const result=evaluatePremiumAccess(owner,false,c,b,e,now);
 assert.equal(result.state,'premium');assert.ok(Object.isFrozen(result));assert.deepEqual(Object.keys(result).sort(),['plan','state','validUntil']);
});
