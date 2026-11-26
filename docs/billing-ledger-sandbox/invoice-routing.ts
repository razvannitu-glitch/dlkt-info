// Laboratory candidate: no deployed worker or hosted database migration.
import type {StripeReadClient} from '../../source/src/billing/stripe-reader.js';
import {record,field,stripeId,unixSeconds} from '../../source/src/billing/records.js';
import {isUuid} from '../../source/src/data/guards.js';
const get=(v:unknown,k:string)=>field(record(v),k);
const id=(v:unknown,prefix:string):v is string=>typeof v==='string'&&v.length<=255&&v.startsWith(prefix)&&/^[A-Za-z0-9]+$/u.test(v.slice(prefix.length));
const no=Object.freeze({kind:'unresolved' as const});
export type InvoiceRoute=Readonly<{kind:'route';accountId:string;eventId:string;attempt:number;invoiceId:string;subscriptionId:string;ownerId:string;customerId:string;itemId:string;priceId:string}>;
export interface InvoiceBindingReader {readInvoiceBinding(accountId:string,subscriptionId:string):Promise<unknown>;}
/** The claim is read from a private, durable event lease. The reader is the
 * authenticated sandbox Stripe adapter. Never use request/webhook metadata as
 * the binding. No payment or entitlement result is emitted. */
export async function resolveInvoiceNotice(account:unknown,claim:unknown,store:InvoiceBindingReader,
 reader:Pick<StripeReadClient,'observeInvoiceLink'|'observeSubscription'>,clock:()=>number=Date.now):Promise<InvoiceRoute|typeof no>{
 try{
  const accountId=get(claim,'accountId'),eventId=get(claim,'eventId'),eventType=get(claim,'eventType'),invoiceId=get(claim,'objectId'),
   attempt=get(claim,'attempt'),created=get(claim,'created'),leaseUntil=get(claim,'leaseUntil');
  const now=clock();
  if(!stripeId(account,'acct')||accountId!==account||!id(eventId,'evt_')||!stripeId(invoiceId,'in')||
   (eventType!=='invoice.paid'&&eventType!=='invoice.payment_failed')||typeof attempt!=='number'||!Number.isInteger(attempt)||attempt<1||attempt>5||
   !unixSeconds(created)||!Number.isSafeInteger(now)||now<=0||created>Math.floor(now/1000)+300||
   typeof leaseUntil!=='number'||!Number.isSafeInteger(leaseUntil)||leaseUntil<=now||leaseUntil>now+30000)return no;
  const fresh=()=>{const t=clock();return Number.isSafeInteger(t)&&t>=now&&t<leaseUntil;};
  const link=await reader.observeInvoiceLink(invoiceId);
  if(!fresh()||link.accountId!==accountId||link.liveMode!==false||link.invoiceId!==invoiceId||
   !stripeId(link.customerId,'cus')||!stripeId(link.subscriptionId,'sub'))return no;
  const raw=await store.readInvoiceBinding(accountId,link.subscriptionId);
  if(!fresh()||get(raw,'accountId')!==accountId||get(raw,'liveMode')!==false||get(raw,'customerId')!==link.customerId||get(raw,'subscriptionId')!==link.subscriptionId)return no;
  const ownerId=get(raw,'ownerId'),itemId=get(raw,'itemId'),priceId=get(raw,'priceId');
  if(!isUuid(ownerId)||!id(itemId,'si_')||!stripeId(priceId,'price'))return no;
  const binding=Object.freeze({accountId,liveMode:false,ownerId,customerId:link.customerId,subscriptionId:link.subscriptionId,itemId,priceId});
  const observation=await reader.observeSubscription(ownerId,binding);
  if(!fresh()||observation.accountId!==accountId||observation.liveMode!==false||observation.subscriptionId!==link.subscriptionId||
   observation.customerId!==link.customerId||observation.itemId!==itemId||observation.priceId!==priceId||
   observation.fundsConfirmed!==false||observation.riskState!=='unknown')return no;
  return Object.freeze({kind:'route',accountId,eventId,attempt,invoiceId,subscriptionId:link.subscriptionId,ownerId,customerId:link.customerId,itemId,priceId});
 }catch{return no;}
}
