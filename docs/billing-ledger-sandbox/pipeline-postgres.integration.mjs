// Disposable GitHub Actions service container ONLY. No hosted credentials or connection.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {acceptBillingDelivery,routeNextBillingNotice,reconcileNextBillingSubscription} from './.billing-build/docs/billing-ledger-sandbox/billing-pipeline.js';
import {StripeReadClient,STRIPE_BILLING_API_VERSION} from './.billing-build/source/src/billing/stripe-reader.js';

if(process.env.GITHUB_ACTIONS!=='true'||!/^[a-f0-9]{64}$/u.test(process.env.TEST_CONTAINER??''))throw Error('DISPOSABLE_FIXTURE_REQUIRED');
const container=process.env.TEST_CONTAINER;
const account='acct_PipelineIntegration',customer='cus_PipelineIntegration',sub='sub_PipelineIntegration',item='si_PipelineIntegration';
const owner='00000000-0000-4000-8000-000000000018';
const catalog={accountId:account,productId:'prod_PipelineIntegration',monthlyPriceId:'price_PipelineMonth',annualPriceId:'price_PipelineYear',liveMode:false,taxBehavior:'inclusive',taxCode:'txcd_10000000'};
const roleFunctions={
 dlkt_pipeline_fixture_ingress:['ingest_notice'],
 dlkt_billing_worker:['claim_notice','route_subscription_notice','fail_notice'],
 dlkt_billing_invoice_router:['read_invoice_binding','route_invoice_notice'],
 dlkt_billing_risk_router:['read_invoice_binding','route_risk_notice'],
 dlkt_billing_reconciler:['claim_subscription','record_subscription_observation','fail_subscription']
};
function sqlFixture(sql,vars=[]){
 // All input is a fixed fixture command or fixture-validated parameter.
 // This is not a runtime query adapter and never connects to a hosted host.
 const raw=execFileSync('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','billing_test',...vars],{input:sql,encoding:'utf8',timeout:8000});
 return raw.trim();
}
function port(role){
 return {async query(statement,params){
  const m=statement.match(/^SELECT (?:\* FROM )?dlkt_info_billing\.([a-z_]+)\(\$\d+::[a-z]+(?:,\$\d+::[a-z]+)*\)(?: AS (?:ok|outcome))?$/u);
  if(!m||!roleFunctions[role]?.includes(m[1])||params.some(v=>typeof v!=='string'||!/^[A-Za-z0-9_\-]+$/u.test(v)))throw Error('FIXTURE_QUERY_REJECTED');
  const args=params.map((v,i)=>'--set=p'+(i+1)+'='+v);
  const q=statement.replace(/\$(\d+)/gu,(_,n)=>":'p"+n+"'");
  const out=sqlFixture('SET ROLE '+role+';\nSELECT coalesce(jsonb_agg(to_jsonb(x)),\'[]\'::jsonb)::text FROM ('+q+') x;\n',args);
  return JSON.parse(out);
 }};
}
const ports={ingress:port('dlkt_pipeline_fixture_ingress'),worker:port('dlkt_billing_worker'),invoice:port('dlkt_billing_invoice_router'),risk:port('dlkt_billing_risk_router'),reconcile:port('dlkt_billing_reconciler')};
const price=annual=>({object:'price',id:annual?catalog.annualPriceId:catalog.monthlyPriceId,active:true,livemode:false,product:catalog.productId,type:'recurring',currency:'eur',unit_amount:annual?6900:699,billing_scheme:'per_unit',lookup_key:annual?'dlkt_info_premium_annual_v1':'dlkt_info_premium_monthly_v1',tax_behavior:'inclusive',transform_quantity:null,custom_unit_amount:null,recurring:{interval:annual?'year':'month',interval_count:1,usage_type:'licensed'}});
const invoice={object:'invoice',id:'in_PipelineIntegration',livemode:false,customer,currency:'eur',status:'paid',amount_due:699,amount_paid:699,amount_remaining:0,parent:{type:'subscription_details',subscription_details:{subscription:sub}}};
const now=Math.floor(Date.now()/1000);
const remote={
 '/v1/account':{object:'account',id:account},
 ['/v1/products/'+catalog.productId]:{object:'product',id:catalog.productId,active:true,livemode:false,tax_code:catalog.taxCode},
 ['/v1/prices/'+catalog.monthlyPriceId]:price(false),['/v1/prices/'+catalog.annualPriceId]:price(true),
 ['/v1/subscriptions/'+sub]:{object:'subscription',id:sub,livemode:false,customer,status:'active',cancel_at:null,cancel_at_period_end:false,pause_collection:null,latest_invoice:invoice.id,items:{object:'list',has_more:false,data:[{object:'subscription_item',id:item,subscription:sub,quantity:1,price:price(false),current_period_start:now-60,current_period_end:now+2592000}]}},
 ['/v1/invoices/'+invoice.id]:invoice,
 '/v1/charges/ch_PipelineIntegration':{object:'charge',id:'ch_PipelineIntegration',livemode:false,currency:'eur',customer,payment_intent:'pi_PipelineIntegration',paid:true,captured:true,status:'succeeded',amount_captured:699,amount_refunded:199},
 '/v1/payment_intents/pi_PipelineIntegration':{object:'payment_intent',id:'pi_PipelineIntegration',livemode:false,currency:'eur',customer,latest_charge:'ch_PipelineIntegration',amount_received:699},
 '/v1/invoice_payments':{object:'list',has_more:false,data:[{object:'invoice_payment',id:'inpay_PipelineIntegration',livemode:false,status:'paid',currency:'eur',amount_paid:699,invoice:invoice.id,payment:{type:'payment_intent',payment_intent:'pi_PipelineIntegration'}}]}
};
const reader=new StripeReadClient(catalog,'rk_test_fixtureOnly',async(url,options)=>{
 const u=new URL(url);assert.equal(u.origin,'https://api.stripe.com');assert.equal(options.method,'GET');
 if(!Object.hasOwn(remote,u.pathname))throw Error('UNEXPECTED_FIXTURE_READ');
 return new Response(JSON.stringify(remote[u.pathname]),{headers:{'content-type':'application/json'}});
});
const secret='whsec_fixtureOnly';
function signed(id,type,object,objectId){
 const seconds=Math.floor(Date.now()/1000);
 const body=Buffer.from(JSON.stringify({id,object:'event',livemode:false,api_version:STRIPE_BILLING_API_VERSION,created:seconds,type,data:{object:{object,id:objectId,livemode:false,metadata:{ownerId:'untrusted'}}}}));
 const sig='t='+seconds+',v1='+createHmac('sha256',secret).update(seconds+'.').update(body).digest('hex');
 return [body,sig];
}
async function accept(event){return acceptBillingDelivery(account,event[0],event[1],secret,ports.ingress);}
const paid=signed('evt_PipelineInvoice','invoice.paid','invoice',invoice.id);
assert.deepEqual(await accept(paid),{kind:'accepted'});
assert.deepEqual(await accept(paid),{kind:'duplicate'});
assert.deepEqual(await acceptBillingDelivery(account,paid[0],'invalid',secret,ports.ingress),{kind:'rejected'});
assert.deepEqual(await routeNextBillingNotice(account,ports,reader),{kind:'routed'});
assert.deepEqual(await reconcileNextBillingSubscription(account,ports.reconcile,reader),{kind:'observed'});
assert.deepEqual(await accept(signed('evt_PipelineRisk','charge.refunded','charge','ch_PipelineIntegration')),{kind:'accepted'});
assert.deepEqual(await routeNextBillingNotice(account,ports,reader),{kind:'routed'});
assert.deepEqual(await reconcileNextBillingSubscription(account,ports.reconcile,reader),{kind:'observed'});
assert.deepEqual(await accept(signed('evt_PipelineCheckout','checkout.session.completed','checkout.session','cs_test_PipelineIntegration')),{kind:'accepted'});
assert.deepEqual(await routeNextBillingNotice(account,ports,reader),{kind:'retry_recorded'});
const receipt=JSON.parse(sqlFixture(`SELECT jsonb_build_object(
 'notices',(select count(*) from dlkt_info_billing.event_notices where account_id='acct_PipelineIntegration'),
 'routed',(select count(*) from dlkt_info_billing.event_jobs where account_id='acct_PipelineIntegration' and state='routed'),
 'checkout_retry',(select count(*) from dlkt_info_billing.event_jobs where account_id='acct_PipelineIntegration' and event_id='evt_PipelineCheckout' and state='pending' and outcome='retry'),
 'invoice_links',(select count(*) from dlkt_info_billing.invoice_links where account_id='acct_PipelineIntegration'),
 'risk_receipts',(select count(*) from dlkt_info_billing.risk_notice_routes where account_id='acct_PipelineIntegration'),
 'generation',(select generation from dlkt_info_billing.subscription_reconcile where account_id='acct_PipelineIntegration'),
 'funds_confirmed',(select funds_confirmed from dlkt_info_billing.subscription_reconcile where account_id='acct_PipelineIntegration'),
 'risk_state',(select risk_state from dlkt_info_billing.subscription_reconcile where account_id='acct_PipelineIntegration'),
 'fixture_grants',(select count(*) from dlkt_info_billing.entitlement_fixture_candidates where account_id='acct_PipelineIntegration')
 )::text;\n`));
assert.deepEqual(receipt,{notices:3,routed:2,checkout_retry:1,invoice_links:1,risk_receipts:1,generation:2,funds_confirmed:false,risk_state:'unknown',fixture_grants:0});
console.log('DLKT_INTEGRATED_BILLING_SQL_OK '+JSON.stringify(receipt));
