// Laboratory only: verified terminal checkout event; no payment authorization.
import type {StripeReadClient,CheckoutTerminalObservation} from '../../source/src/billing/stripe-reader.js';
import {record,field,stripeId,unixSeconds} from '../../source/src/billing/records.js';
import {isUuid} from '../../source/src/data/guards.js';
const get=(v:unknown,k:string)=>field(record(v),k);
const session=(v:unknown):v is string=>typeof v==='string'&&/^cs_test_[A-Za-z0-9]{1,247}$/u.test(v);
const event=(v:unknown):v is string=>typeof v==='string'&&/^evt_[A-Za-z0-9]{1,251}$/u.test(v);
const item=(v:unknown):v is string=>typeof v==='string'&&/^si_[A-Za-z0-9]{1,252}$/u.test(v);
const types=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired']);
const unresolved=Object.freeze({kind:'unresolved' as const});
export interface CheckoutNoticeStore {
 readCheckoutBinding(account:string,eventId:string,attempt:number,intentId:string,sessionId:string,customerId:string):Promise<unknown>;
}
export type CheckoutRoute=Readonly<CheckoutTerminalObservation & {kind:'checkout_route';eventId:string;attempt:number}>;
export async function resolveCheckoutNotice(account:unknown,claim:unknown,store:CheckoutNoticeStore,
 reader:Pick<StripeReadClient,'observeCheckoutLink'|'observeCheckoutTerminal'>,returnOrigin:string,clock:()=>number=Date.now):Promise<CheckoutRoute|typeof unresolved>{
 try{
  const a=get(claim,'accountId'),e=get(claim,'eventId'),t=get(claim,'eventType'),s=get(claim,'objectId'),attempt=get(claim,'attempt'),
    created=get(claim,'created'),lease=get(claim,'leaseUntil'),now=clock();
  if(!stripeId(account,'acct')||a!==account||!event(e)||typeof t!=='string'||!types.has(t)||!session(s)||
    typeof attempt!=='number'||!Number.isInteger(attempt)||attempt<1||attempt>5||
    !Number.isSafeInteger(now)||now<=0||!unixSeconds(created)||created>Math.floor(now/1000)+300||
    typeof lease!=='number'||!Number.isSafeInteger(lease)||lease<=now||lease>now+30000)return unresolved;
  const fresh=()=>{const t=clock();return Number.isSafeInteger(t)&&t>=now&&t<lease;};
  const l=await reader.observeCheckoutLink(s);
  if(!fresh()||l.accountId!==account||l.liveMode!==false||l.sessionId!==s||!isUuid(l.intentId)||!stripeId(l.customerId,'cus'))return unresolved;
  const b=await store.readCheckoutBinding(account,e,attempt,l.intentId,s,l.customerId);
  const owner=get(b,'ownerId'),price=get(b,'priceId'),known=get(b,'sessionId'),state=get(b,'state'),expiry=get(b,'expiresAt'),start=get(b,'createdAt'),existing=get(b,'completedSubscriptionId');
  if(!fresh()||get(b,'accountId')!==account||get(b,'liveMode')!==false||get(b,'intentId')!==l.intentId||get(b,'customerId')!==l.customerId||
    !isUuid(owner)||!stripeId(price,'price')||!unixSeconds(start)||!unixSeconds(expiry)||expiry!==start+3600||
    !((state==='reserved'&&known===null&&existing===null)||(state==='attached'&&known===s&&existing===null)||
      (state==='expired'&&known===s&&existing===null)||(state==='complete'&&known===s&&stripeId(existing,'sub'))))return unresolved;
  const v=await reader.observeCheckoutTerminal(b,s,returnOrigin);
  if(!fresh()||v.accountId!==account||v.liveMode!==false||v.sessionId!==s||v.intentId!==l.intentId||
    v.customerId!==l.customerId||v.ownerId!==owner||v.priceId!==price||v.expiresAt!==expiry)return unresolved;
  if(v.status==='complete'){
   if(v.paymentStatus!=='paid'||!stripeId(v.subscriptionId,'sub')||!item(v.itemId)||state==='expired'||(state==='complete'&&existing!==v.subscriptionId))return unresolved;
  }else if(v.status==='expired'){
   if(v.paymentStatus!=='unpaid'||v.subscriptionId!==null||v.itemId!==null||state==='complete')return unresolved;
  }else return unresolved;
  return Object.freeze({...v,kind:'checkout_route',eventId:e,attempt});
 }catch{return unresolved;}
}
