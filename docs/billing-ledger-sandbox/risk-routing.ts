// Laboratory-only routing boundary. No live worker, no grant, no automatic risk clearance.
import type {StripeReadClient,FinancialRiskType} from '../../source/src/billing/stripe-reader.js';
import {record,field,stripeId,unixSeconds} from '../../source/src/billing/records.js';
import {isUuid} from '../../source/src/data/guards.js';
import type {InvoiceBindingReader} from './invoice-routing.js';
const get=(v:unknown,k:string)=>field(record(v),k);
const id=(v:unknown,prefix:string):v is string=>typeof v==='string'&&v.length<=255&&v.startsWith(prefix)&&/^[A-Za-z0-9]+$/u.test(v.slice(prefix.length));
const unresolved=Object.freeze({kind:'unresolved' as const});
export type RiskRoute=Readonly<{kind:'risk_route';accountId:string;eventId:string;eventType:FinancialRiskType;attempt:number;
 objectId:string;chargeId:string;paymentIntentId:string;invoiceId:string;subscriptionId:string;ownerId:string;customerId:string;itemId:string;priceId:string;riskState:'review_required'}>;
export async function resolveRiskNotice(account:unknown,claim:unknown,store:InvoiceBindingReader,
 reader:Pick<StripeReadClient,'observeFinancialRiskLink'>,clock:()=>number=Date.now):Promise<RiskRoute|typeof unresolved>{
 try{
  const accountId=get(claim,'accountId'),eventId=get(claim,'eventId'),eventType=get(claim,'eventType'),objectId=get(claim,'objectId'),
   attempt=get(claim,'attempt'),created=get(claim,'created'),leaseUntil=get(claim,'leaseUntil'),now=clock();
  if(eventType!=='charge.refunded'&&eventType!=='charge.dispute.created'&&eventType!=='radar.early_fraud_warning.created')return unresolved;
  const prefix=eventType==='charge.refunded'?'ch_':eventType==='charge.dispute.created'?'du_':'issfr_';
  if(!stripeId(account,'acct')||accountId!==account||!id(eventId,'evt_')||!id(objectId,prefix)||
   typeof attempt!=='number'||!Number.isInteger(attempt)||attempt<1||attempt>5||!unixSeconds(created)||
   !Number.isSafeInteger(now)||now<=0||created>Math.floor(now/1000)+300||
   typeof leaseUntil!=='number'||!Number.isSafeInteger(leaseUntil)||leaseUntil<=now||leaseUntil>now+30000)return unresolved;
  const fresh=()=>{const t=clock();return Number.isSafeInteger(t)&&t>=now&&t<leaseUntil;};
  const l=await reader.observeFinancialRiskLink(eventType,objectId);
  if(!fresh()||l.accountId!==accountId||l.liveMode!==false||l.eventType!==eventType||l.objectId!==objectId||
    l.riskState!=='review_required'||!id(l.chargeId,'ch_')||!id(l.paymentIntentId,'pi_')||
    (eventType==='charge.refunded'&&l.chargeId!==objectId)||!stripeId(l.invoiceId,'in')||!stripeId(l.customerId,'cus')||!stripeId(l.subscriptionId,'sub'))return unresolved;
  const b=await store.readInvoiceBinding(accountId,l.subscriptionId);
  const ownerId=get(b,'ownerId'),itemId=get(b,'itemId'),priceId=get(b,'priceId');
  if(!fresh()||get(b,'accountId')!==accountId||get(b,'liveMode')!==false||get(b,'subscriptionId')!==l.subscriptionId||get(b,'customerId')!==l.customerId||
   !isUuid(ownerId)||!id(itemId,'si_')||!stripeId(priceId,'price'))return unresolved;
  return Object.freeze({kind:'risk_route',accountId,eventId,eventType,attempt,objectId,chargeId:l.chargeId,paymentIntentId:l.paymentIntentId,
   invoiceId:l.invoiceId,subscriptionId:l.subscriptionId,ownerId,customerId:l.customerId,itemId,priceId,riskState:'review_required'});
 }catch{return unresolved;}
}
