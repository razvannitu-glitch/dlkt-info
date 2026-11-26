// Synthetic-only laboratory. No production authorization, bearer token or API route.
import {evaluatePremiumAccess} from '../../source/src/billing/entitlement.js';
import {record,field,stripeId,unixSeconds} from '../../source/src/billing/records.js';
import {isUuid} from '../../source/src/data/guards.js';
import type {StripeReadClient} from '../../source/src/billing/stripe-reader.js';
import type {PremiumPlan} from '../../source/src/billing/catalog.js';

const DENIED=Object.freeze({state:'denied'} as const);
type Eligibility=typeof DENIED|Readonly<{state:'sandbox_eligible';plan:PremiumPlan;validUntil:number}>;
const get=(x:unknown,k:string):unknown=>field(record(x),k);
const id=(x:unknown,prefix:string):x is string=>typeof x==='string'&&x.length<=255&&x.startsWith(prefix)&&/^[A-Za-z0-9]+$/u.test(x.slice(prefix.length));
const integer=(x:unknown,min:number):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min;
type Receipt=Readonly<{accountId:string;ownerId:string;customerId:string;subscriptionId:string;itemId:string;priceId:string;productId:string;invoiceId:string;
 generation:number;fence:number;epoch:number;verifiedAt:number;periodStart:number;periodEnd:number;cancelAt:number|null;validUntil:number;source:'synthetic_fixture'}>;
/** Trusted persistence port: read_entitlement_fixture, current transaction snapshot.
 * Adapter must strictly convert PostgreSQL bigint fields, never accept browser JSON.
 * Real runtime must separately authenticate and recheck the current user session.
 */
export interface EntitlementFixtureStore {
  read(accountId:string,ownerId:string):Promise<unknown>;
}
function receipt(x:unknown,account:string,owner:string):Receipt|null {
  const customerId=get(x,'customerId'),subscriptionId=get(x,'subscriptionId'),itemId=get(x,'itemId'),priceId=get(x,'priceId'),
    productId=get(x,'productId'),invoiceId=get(x,'invoiceId'),generation=get(x,'generation'),fence=get(x,'fence'),epoch=get(x,'epoch'),
    verifiedAt=get(x,'verifiedAt'),periodStart=get(x,'periodStart'),periodEnd=get(x,'periodEnd'),cancelAt=get(x,'cancelAt'),validUntil=get(x,'validUntil');
  if(get(x,'accountId')!==account||get(x,'ownerId')!==owner||get(x,'source')!=='synthetic_fixture'
    ||!stripeId(customerId,'cus')||!stripeId(subscriptionId,'sub')||!id(itemId,'si_')||!stripeId(priceId,'price')
    ||!stripeId(productId,'prod')||!stripeId(invoiceId,'in')||!integer(generation,1)||!integer(fence,1)||!integer(epoch,0)
    ||!unixSeconds(verifiedAt)||!unixSeconds(periodStart)||!unixSeconds(periodEnd)||!unixSeconds(validUntil)
    ||(cancelAt!==null&&!unixSeconds(cancelAt))||periodStart>verifiedAt||verifiedAt>=validUntil
    ||validUntil!==Math.min(periodEnd,verifiedAt+300,cancelAt??periodEnd))return null;
  return Object.freeze({accountId:account,ownerId:owner,customerId,subscriptionId,itemId,priceId,productId,invoiceId,
    generation,fence,epoch,verifiedAt,periodStart,periodEnd,cancelAt,validUntil,source:'synthetic_fixture'});
}
function same(a:Receipt,b:Receipt):boolean {
  return Object.keys(a).every(k=>get(a,k)===get(b,k));
}
/**
 * Exercise the canonical entitlement policy against a durable synthetic receipt.
 * The positive fixture branch is intentionally labeled sandbox_eligible; it
 * cannot satisfy the application's PremiumAccess discriminator. It never
 * upgrades actual SandboxCardProofReader observations to confirmed funds.
 */
export async function checkEntitlementFixture(accountId:unknown,ownerId:unknown,labMode:unknown,store:EntitlementFixtureStore,
  reader:Pick<StripeReadClient,'loadCatalog'>,clock:()=>number=()=>Math.floor(Date.now()/1000)):Promise<Eligibility>{
  try{
    if(labMode!=='synthetic_fixture_only'||!stripeId(accountId,'acct')||!isUuid(ownerId))return DENIED;
    const first=receipt(await store.read(accountId,ownerId),accountId,ownerId);
    const started=clock();
    if(!first||!unixSeconds(started)||started<first.verifiedAt||started>=first.validUntil)return DENIED;
    const catalog=await reader.loadCatalog();
    // Re-read after the external call. A new notice, lease, ownership change
    // or expiry must invalidate the decision before returning it.
    const current=receipt(await store.read(accountId,ownerId),accountId,ownerId);
    const now=clock();
    if(!current||!same(first,current)||!unixSeconds(now)||now<started||now>=current.validUntil)return DENIED;
    const binding={ownerId,accountId,liveMode:false,customerId:current.customerId,subscriptionId:current.subscriptionId,
      priceId:current.priceId,itemId:current.itemId};
    const evidence={version:'dlkt-info-premium-evidence-1',accountId,liveMode:false,
      customerId:current.customerId,subscriptionId:current.subscriptionId,productId:current.productId,priceId:current.priceId,
      quantity:1,status:'active',collectionPaused:false,riskState:'clear',verifiedAt:current.verifiedAt,
      periodStart:current.periodStart,periodEnd:current.periodEnd,cancelAt:current.cancelAt,cancelAtPeriodEnd:false,
      payment:{invoiceId:current.invoiceId,state:'paid',fundsConfirmed:true,currency:'eur',
        customerId:current.customerId,subscriptionId:current.subscriptionId,priceId:current.priceId,productId:current.productId,
        periodStart:current.periodStart,periodEnd:current.periodEnd}};
    // The above positive fields are synthetic by construction, never derived
    // from a paid invoice, a Checkout receipt or an unverified payment.
    const decision=evaluatePremiumAccess(ownerId,false,catalog,binding,evidence,now);
    if(decision.state!=='premium'||decision.validUntil!==current.validUntil)return DENIED;
    return Object.freeze({state:'sandbox_eligible',plan:decision.plan,validUntil:decision.validUntil});
  }catch{return DENIED;}
}
