// Isolated orchestration candidate. No network listeners, live keys or deployed scheduler.
import {verifySandboxStripeNotice,type VerifiedStripeNotice} from '../../source/src/billing/webhook-signature.js';
import {record,field,stripeId,unixSeconds} from '../../source/src/billing/records.js';
import {isUuid} from '../../source/src/data/guards.js';
import type {StripeReadClient,StripeSubscriptionObservation} from '../../source/src/billing/stripe-reader.js';
import {resolveInvoiceNotice,type InvoiceRoute,type InvoiceBindingReader} from './invoice-routing.js';
import {resolveRiskNotice,type RiskRoute} from './risk-routing.js';

import {resolveCheckoutNotice,type CheckoutNoticeStore} from './checkout-routing.js';

const get=(x:unknown,k:string)=>field(record(x),k);
const id=(x:unknown,prefix:string):x is string=>typeof x==='string'&&x.length<=255&&x.startsWith(prefix)&&/^[A-Za-z0-9]+$/u.test(x.slice(prefix.length));
type Notice=Extract<VerifiedStripeNotice,{kind:'reconcile'}>;
type Claim=Readonly<{accountId:string;eventId:string;eventType:Notice['type'];objectId:string;created:number;attempt:number;leaseUntil:number}>;
type ReconcileClaim=Readonly<{accountId:string;ownerId:string;customerId:string;subscriptionId:string;itemId:string;priceId:string;liveMode:false;generation:string;fence:string;leaseUntil:number}>;
type Outcome=Readonly<{kind:'idle'|'routed'|'retry_recorded'|'observed'|'unavailable'}>;
type IntakeOutcome=Readonly<{kind:'accepted'|'duplicate'|'ignored'|'rejected'|'unavailable'}>;
const result=<T extends string>(kind:T)=>Object.freeze({kind});
const unavailable=result('unavailable');
const types:Readonly<Record<Notice['type'],string>>=Object.freeze({
 'checkout.session.completed':'cs_test_','checkout.session.async_payment_succeeded':'cs_test_',
 'checkout.session.async_payment_failed':'cs_test_','checkout.session.expired':'cs_test_',
 'customer.subscription.created':'sub_','customer.subscription.updated':'sub_','customer.subscription.deleted':'sub_',
 'customer.subscription.paused':'sub_','customer.subscription.resumed':'sub_','invoice.paid':'in_',
 'invoice.payment_failed':'in_','charge.refunded':'ch_','charge.dispute.created':'du_','radar.early_fraud_warning.created':'issfr_'
});
const statuses=new Set(['active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused']);
function validClock(t:unknown):t is number{return typeof t==='number'&&Number.isSafeInteger(t)&&t>0;}
function fresh(clock:()=>number,started:number,until:number):boolean{const t=clock();return validClock(t)&&t>=started&&t<until;}
function safeInteger(v:unknown):number|null{
 if(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)return v;
 if(typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/u.test(v)&&Number.isSafeInteger(Number(v)))return Number(v);
 return null;
}
function fence(v:unknown):string|null{
 const s=typeof v==='number'&&Number.isSafeInteger(v)?String(v):v;
 if(typeof s!=='string'||!/^[1-9][0-9]{0,18}$/u.test(s)||BigInt(s)>9223372036854775807n)return null;
 return s;
}
function dateMillis(v:unknown):number|null{
 if(v instanceof Date){const n=v.getTime();return validClock(n)?n:null;}
 if(typeof v==='string'&&v.length<=48&&/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d(?::?\d\d)?)$/u.test(v)){
  const n=Date.parse(v);return validClock(n)?n:null;
 }
 return null;
}
function claim(x:unknown,account:string,now:number):Claim|null{
 const a=get(x,'account_id'),e=get(x,'event_id'),t=get(x,'event_type'),o=get(x,'object_id'),created=safeInteger(get(x,'event_created')),
 attempt=safeInteger(get(x,'attempt')),until=dateMillis(get(x,'lease_until'));
 if(a!==account||!id(e,'evt_')||typeof t!=='string'||!Object.hasOwn(types,t)||!id(o,types[t as Notice['type']])||
 !unixSeconds(created)||created>Math.floor(now/1000)+300||attempt===null||attempt<1||attempt>5||
 until===null||until<=now||until>now+30000)return null;
 return Object.freeze({accountId:account,eventId:e,eventType:t as Notice['type'],objectId:o,created,attempt,leaseUntil:until});
}
function reconcileClaim(x:unknown,account:string,now:number):ReconcileClaim|null{
 const owner=get(x,'owner_id'),customer=get(x,'customer_id'),subscription=get(x,'subscription_id'),item=get(x,'item_id'),price=get(x,'price_id'),
 generation=fence(get(x,'generation')),f=fence(get(x,'fence')),until=dateMillis(get(x,'lease_until'));
 if(get(x,'account_id')!==account||!isUuid(owner)||!stripeId(customer,'cus')||!stripeId(subscription,'sub')||!id(item,'si_')||
 !stripeId(price,'price')||generation===null||f===null||until===null||until<=now||until>now+60000)return null;
 return Object.freeze({accountId:account,ownerId:owner,customerId:customer,subscriptionId:subscription,itemId:item,priceId:price,liveMode:false,generation,fence:f,leaseUntil:until});
}
/** Role-specific private query ports; never expose to request/client code.
 * Every SQL statement below is fixed. The SQL functions themselves must
 * enforce current lease, exact binding, atomic receipt, and role ACL. */
export interface BillingQueryPort{query(sql:string,params:readonly (string|null)[]):Promise<unknown>;}
export type BillingPorts=Readonly<{ingress:BillingQueryPort;worker:BillingQueryPort;invoice:BillingQueryPort;risk:BillingQueryPort;reconcile:BillingQueryPort;checkout?:Readonly<{port:BillingQueryPort;returnOrigin:string;reader:Pick<StripeReadClient,'observeCheckoutLink'|'observeCheckoutTerminal'>}>}>;
const SQL=Object.freeze({
 ingest:'SELECT dlkt_info_billing.ingest_notice($1::text,$2::text,$3::text,$4::text,$5::bigint) AS outcome',
 claim:'SELECT * FROM dlkt_info_billing.claim_notice($1::text)',
 direct:'SELECT dlkt_info_billing.route_subscription_notice($1::text,$2::text,$3::integer) AS ok',
 fail:'SELECT dlkt_info_billing.fail_notice($1::text,$2::text,$3::integer,$4::text) AS ok',
 binding:'SELECT * FROM dlkt_info_billing.read_invoice_binding($1::text,$2::text)',
 invoice:'SELECT dlkt_info_billing.route_invoice_notice($1::text,$2::text,$3::integer,$4::text,$5::text,$6::uuid,$7::text,$8::text,$9::text) AS ok',
 risk:'SELECT dlkt_info_billing.route_risk_notice($1::text,$2::text,$3::integer,$4::text,$5::text,$6::text,$7::text,$8::text,$9::uuid,$10::text,$11::text,$12::text) AS ok',
 checkoutBinding:'SELECT * FROM dlkt_info_billing.read_checkout_notice_binding($1::text,$2::text,$3::integer,$4::uuid,$5::text,$6::text)',
 checkout:'SELECT dlkt_info_billing.route_checkout_notice($1::text,$2::text,$3::integer,$4::uuid,$5::uuid,$6::text,$7::text,$8::text,$9::bigint,$10::text,$11::text,$12::text,$13::text) AS ok',
 reconcile:'SELECT * FROM dlkt_info_billing.claim_subscription($1::text)',
 observe:'SELECT dlkt_info_billing.record_subscription_observation($1::text,$2::text,$3::bigint,$4::bigint,$5::uuid,$6::text,$7::text,$8::text,$9::text) AS ok',
 failReconcile:'SELECT dlkt_info_billing.fail_subscription($1::text,$2::text,$3::bigint,$4::bigint,$5::text) AS ok'
});
async function one(port:BillingQueryPort,sql:string,args:readonly (string|null)[]):Promise<unknown>{
 const rows=await port.query(sql,args);
 if(!Array.isArray(rows)||rows.length>1||(rows.length===1&&!record(rows[0])))throw Error('BILLING_DB_RESULT_INVALID');
 return rows.length===0?null:rows[0];
}
async function ok(port:BillingQueryPort,sql:string,args:readonly (string|null)[]):Promise<boolean>{
 const x=get(await one(port,sql,args),'ok');if(typeof x!=='boolean')throw Error('BILLING_DB_RESULT_INVALID');return x;
}
function bindingReader(port:BillingQueryPort):InvoiceBindingReader{
 return {async readInvoiceBinding(a,s){
  const x=await one(port,SQL.binding,[a,s]);if(x===null)return null;
  return {accountId:get(x,'account_id'),ownerId:get(x,'owner_id'),customerId:get(x,'customer_id'),subscriptionId:get(x,'subscription_id'),
    itemId:get(x,'item_id'),priceId:get(x,'price_id'),liveMode:get(x,'live_mode')};
 }};
}
function checkoutBindingReader(port:BillingQueryPort):CheckoutNoticeStore{
 return {async readCheckoutBinding(a,e,n,i,s,c){
  const x=await one(port,SQL.checkoutBinding,[a,e,String(n),i,s,c]);if(x===null)return null;
  return {accountId:get(x,'account_id'),intentId:get(x,'intent_id'),ownerId:get(x,'owner_id'),customerId:get(x,'customer_id'),
   priceId:get(x,'price_id'),sessionId:get(x,'session_id'),liveMode:get(x,'live_mode'),state:get(x,'state'),
   createdAt:safeInteger(get(x,'created_at')),expiresAt:safeInteger(get(x,'expires_at')),completedSubscriptionId:get(x,'completed_subscription_id')};
 }};
}
export async function acceptBillingDelivery(account:unknown,body:unknown,signature:unknown,secret:unknown,port:BillingQueryPort,clock:()=>number=Date.now):Promise<IntakeOutcome>{
 let n:VerifiedStripeNotice;
 try{const t=clock();if(!stripeId(account,'acct')||!validClock(t))return result('rejected');
  n=verifySandboxStripeNotice(body,signature,secret,account,Math.floor(t/1000));}
 catch{return result('rejected');}
 if(n.kind==='ignored')return result('ignored');
 try{
  // Never acknowledge acceptance on a lost/ambiguous commit receipt.
  const row=await one(port,SQL.ingest,[account,n.eventId,n.type,n.objectId,String(n.created)]);
  const outcome=get(row,'outcome');
  return outcome==='accepted'||outcome==='duplicate'?result(outcome):unavailable;
 }catch{return unavailable;}
}
type Reader=Pick<StripeReadClient,'observeInvoiceLink'|'observeFinancialRiskLink'|'observeSubscription'>;
export async function routeNextBillingNotice(account:unknown,ports:BillingPorts,reader:Reader,clock:()=>number=Date.now):Promise<Outcome>{
 try{
  if(!stripeId(account,'acct'))return unavailable;
  const raw=await one(ports.worker,SQL.claim,[account]),now=clock();
  if(raw===null)return result('idle');if(!validClock(now))return unavailable;
  const c=claim(raw,account,now);if(!c)return unavailable;
  const args=[account,c.eventId,String(c.attempt)];
  let routed=false;
  if(c.eventType.startsWith('customer.subscription.')){
   if(!fresh(clock,now,c.leaseUntil))return unavailable;
   routed=await ok(ports.worker,SQL.direct,args);
  }else if(c.eventType.startsWith('invoice.')){
   const r=await resolveInvoiceNotice(account,c,bindingReader(ports.invoice),reader,clock);
   if(r.kind==='route'&&fresh(clock,now,c.leaseUntil)){
    const v:InvoiceRoute=r;routed=await ok(ports.invoice,SQL.invoice,[...args,v.invoiceId,v.subscriptionId,v.ownerId,v.customerId,v.itemId,v.priceId]);
   }
  }else if(c.eventType==='charge.refunded'||c.eventType==='charge.dispute.created'||c.eventType==='radar.early_fraud_warning.created'){
   const r=await resolveRiskNotice(account,c,bindingReader(ports.risk),reader,clock);
   if(r.kind==='risk_route'&&fresh(clock,now,c.leaseUntil)){
    const v:RiskRoute=r;routed=await ok(ports.risk,SQL.risk,[...args,v.objectId,v.chargeId,v.paymentIntentId,v.invoiceId,v.subscriptionId,v.ownerId,v.customerId,v.itemId,v.priceId]);
   }
  }else if(c.eventType.startsWith('checkout.session.')&&ports.checkout){
   const checkout=ports.checkout;
   const v=await resolveCheckoutNotice(account,c,checkoutBindingReader(checkout.port),checkout.reader,checkout.returnOrigin,clock);
   if(v.kind==='checkout_route'&&fresh(clock,now,c.leaseUntil))
    routed=await ok(checkout.port,SQL.checkout,[...args,v.intentId,v.ownerId,v.customerId,v.priceId,v.sessionId,String(v.expiresAt),v.status,v.paymentStatus,v.subscriptionId,v.itemId]);
  }
  // Open, unpaid/ambiguous or unbound sessions remain retryable. No
  // terminal transition is inferred from an event name or missing response.
  if(routed)return result('routed');
  if(!fresh(clock,now,c.leaseUntil))return unavailable;
  return await ok(ports.worker,SQL.fail,[...args,'retry'])?result('retry_recorded'):unavailable;
 }catch{return unavailable;} // ambiguous mutation outcome: no second write
}
export async function reconcileNextBillingSubscription(account:unknown,port:BillingQueryPort,reader:Pick<StripeReadClient,'observeSubscription'>,clock:()=>number=Date.now):Promise<Outcome>{
 try{
  if(!stripeId(account,'acct'))return unavailable;
  const raw=await one(port,SQL.reconcile,[account]),now=clock();
  if(raw===null)return result('idle');if(!validClock(now))return unavailable;
  const c=reconcileClaim(raw,account,now);if(!c)return unavailable;
  const args=[account,c.subscriptionId,c.generation,c.fence];
  let observation:StripeSubscriptionObservation|null=null;
  try{observation=await reader.observeSubscription(c.ownerId,c);}catch{/* retry if still leased */}
  if(!fresh(clock,now,c.leaseUntil))return unavailable;
  if(observation&&observation.accountId===account&&observation.liveMode===false&&observation.customerId===c.customerId&&
   observation.subscriptionId===c.subscriptionId&&observation.itemId===c.itemId&&observation.priceId===c.priceId&&
   statuses.has(observation.status)&&observation.fundsConfirmed===false&&observation.riskState==='unknown'){
    return await ok(port,SQL.observe,[...args,c.ownerId,c.customerId,c.itemId,c.priceId,observation.status])?result('observed'):unavailable;
  }
  return await ok(port,SQL.failReconcile,[...args,'retry'])?result('retry_recorded'):unavailable;
 }catch{return unavailable;}
}
