import test from 'node:test';
import assert from 'node:assert/strict';
import {checkEntitlementFixture} from '../.billing-build/docs/billing-ledger-sandbox/entitlement-gate.js';
import {verifyPremiumCatalog} from '../.billing-build/source/src/billing/catalog.js';
const now=1795695000,owner='00000000-0000-4000-8000-000000000004',other='00000000-0000-4000-8000-000000000005';
const mode='synthetic_fixture_only',denied={state:'denied'};
function fixture(annual=false){
 const priceId=annual?'price_year':'price_month';
 const c={accountId:'acct_fixture',productId:'prod_fixture',liveMode:false,monthlyPriceId:'price_month',annualPriceId:'price_year',taxCode:'txcd_10000000',taxBehavior:'inclusive'};
 const price=y=>({object:'price',id:y?c.annualPriceId:c.monthlyPriceId,active:true,livemode:false,product:c.productId,type:'recurring',currency:'eur',unit_amount:y?6900:699,billing_scheme:'per_unit',lookup_key:y?'dlkt_info_premium_annual_v1':'dlkt_info_premium_monthly_v1',tax_behavior:'inclusive',transform_quantity:null,custom_unit_amount:null,recurring:{interval:y?'year':'month',interval_count:1,usage_type:'licensed'}});
 const catalog=verifyPremiumCatalog(c,c.accountId,{object:'product',id:c.productId,active:true,livemode:false,tax_code:c.taxCode},price(false),price(true));
 const receipt={accountId:c.accountId,ownerId:owner,customerId:'cus_fixture',subscriptionId:'sub_fixture',itemId:'si_fixture',priceId,productId:c.productId,invoiceId:'in_fixture',
 generation:2,fence:3,epoch:1,verifiedAt:now-20,periodStart:now-60,periodEnd:now+(annual?365:30)*86400-60,cancelAt:null,validUntil:now+280,source:'synthetic_fixture'};
 const calls=[],store={read:async(a,o)=>{calls.push(['read',a,o]);return receipt}},reader={loadCatalog:async()=>{calls.push(['catalog']);return catalog}};
 return {c,receipt,store,reader,calls};
}
const check=(f,clock=()=>now)=>checkEntitlementFixture(f.c.accountId,owner,mode,f.store,f.reader,clock);
for(const annual of [false,true])test('canonical policy yields sandbox eligibility only, '+(annual?'annual':'monthly'),async()=>{
 const f=fixture(annual);assert.deepEqual(await check(f),{state:'sandbox_eligible',plan:annual?'annual':'monthly',validUntil:now+280});
 assert.deepEqual(f.calls.map(c=>c[0]),['read','catalog','read']);
});
test('lab gate and server identity required before database reads',async()=>{
 const f=fixture();for(const m of [true,'live','sandbox',null])assert.deepEqual(await checkEntitlementFixture(f.c.accountId,owner,m,f.store,f.reader,()=>now),denied);
 assert.deepEqual(await checkEntitlementFixture(f.c.accountId,'invalid',mode,f.store,f.reader,()=>now),denied);assert.equal(f.calls.length,0);
});
test('current captured-card observation or completed Checkout cannot authorize',async()=>{
 for(const value of [{kind:'captured_card_observation',fundsConfirmed:false,riskState:'unknown'},{kind:'terminal',status:'complete',paymentStatus:'paid'},null]){
  const f=fixture();f.store.read=async()=>value;assert.deepEqual(await check(f),denied);
 }
});
const cases=[{ownerId:other},{accountId:'acct_other'},{source:'stripe'},{priceId:'price_other'},{productId:'prod_other'},{invoiceId:'in_../bad'},
 {customerId:'cus_../bad'},{subscriptionId:'sub_../bad'},{itemId:'bad'},{generation:0},{fence:0},{epoch:-1},{epoch:'1'},{verifiedAt:now+1,validUntil:now+301},
 {validUntil:now+300},{periodStart:now+1},{periodEnd:now-1},{periodEnd:now+999*86400}];
for(const patch of cases)test('invalid receipt '+JSON.stringify(patch)+' denied',async()=>{const f=fixture();Object.assign(f.receipt,patch);assert.deepEqual(await check(f),denied)});
test('exact cancellation cutoff enforced',async()=>{
 const f=fixture();f.receipt.cancelAt=now+30;f.receipt.validUntil=now+30;
 assert.deepEqual(await check(f),{state:'sandbox_eligible',plan:'monthly',validUntil:now+30});
 assert.deepEqual(await check(f,()=>now+30),denied);
});
test('expired paid period or evidence never returns a positive result',async()=>{
 const f=fixture();assert.deepEqual(await check(f,()=>now+281),denied);
 const g=fixture();g.receipt.periodEnd=now-1;g.receipt.validUntil=now-1;assert.deepEqual(await check(g),denied);
});
test('new epoch, generation, fence, owner or removal during catalog read invalidates',async()=>{
 for(const patch of [{epoch:2},{generation:3},{fence:4},{ownerId:other},null]){
  const f=fixture();let n=0;f.store.read=async()=>++n===1?structuredClone(f.receipt):patch===null?null:{...f.receipt,...patch};
  assert.deepEqual(await check(f),denied);
 }
});
test('catalog mismatch and unverified catalog fail closed',async()=>{
 for(const result of [null,{accountId:'acct_fixture',liveMode:false}]){const f=fixture();f.reader.loadCatalog=async()=>result;assert.deepEqual(await check(f),denied)}
});
test('store or provider failure and time rollback or expiry during validation deny',async()=>{
 for(const target of ['store','reader']){const f=fixture();if(target==='store')f.store.read=async()=>{throw Error('db')};else f.reader.loadCatalog=async()=>{throw Error('provider')};assert.deepEqual(await check(f),denied);}
 for(const times of [[now,now-1],[now,now+281]]){const f=fixture();let i=0;assert.deepEqual(await check(f,()=>times[i++]),denied);}
});
