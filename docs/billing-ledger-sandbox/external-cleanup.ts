// Isolated laboratory: no default network transport or deployed cleanup route.
import {isRecord,isUuid} from '../../source/src/data/guards.js';
import {isWalletProviderId,type WalletProviderId} from '../../source/src/wallet/providers.js';
import {parseGrant,unseal} from '../../source/src/connections/crypto.js';
import {providerConfiguration,tokenKey} from '../../source/src/connections/config.js';
import {revokeGrant} from '../../source/src/connections/providers.js';
import type {Environment} from '../../source/src/account/http.js';
import type {StripeReadClient} from '../../source/src/billing/stripe-reader.js';
import {stripeId,unixSeconds} from '../../source/src/billing/records.js';

type Claim=Readonly<{requestId:string;ownerId:string;connectionId:string;providerId:WalletProviderId;
 vaultRevision:string;sealedGrant:string|null;fence:string;leaseUntil:number}>;
type Outcome='provider_acknowledged'|'manual_revocation_required'|'provider_outcome_unknown'|'credential_unavailable';
type Result=Readonly<{kind:'unavailable'|'idle'}>|Readonly<{kind:'recorded';outcome:Outcome}>;
const FAILED:Result=Object.freeze({kind:'unavailable'});
const IDLE:Result=Object.freeze({kind:'idle'});
const clockNow=()=>Math.floor(Date.now()/1000);
export interface CleanupStore{
 claim(requestId:string):Promise<unknown>;
 markDispatched(requestId:string,connectionId:string,fence:string):Promise<unknown>;
 finish(requestId:string,connectionId:string,fence:string,outcome:Outcome):Promise<unknown>;
}
function claim(x:unknown,request:string,now:number):Claim|null{
 if(!isRecord(x)||x.requestId!==request||!isUuid(x.ownerId)||!isUuid(x.connectionId)||!isUuid(x.vaultRevision)
   ||!isWalletProviderId(x.providerId)||typeof x.fence!=='string'||!/^\d$/u.test(x.fence)||Number(x.fence)<1||Number(x.fence)>5
   ||!unixSeconds(x.leaseUntil)||x.leaseUntil<=now||x.leaseUntil>now+60)return null;
 const supported=x.providerId==='gmail'||x.providerId==='facebook-pages';
 if(supported?(typeof x.sealedGrant!=='string'||x.sealedGrant.length>65536||!/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/u.test(x.sealedGrant)):x.sealedGrant!==null)return null;
 return Object.freeze({requestId:request,ownerId:x.ownerId,connectionId:x.connectionId,providerId:x.providerId,
   vaultRevision:x.vaultRevision,sealedGrant:x.sealedGrant as string|null,fence:x.fence,leaseUntil:x.leaseUntil});
}
/** Requires explicit injected transport; the lab never constructs a live
 * network client. The SQL dispatch record, not a request timeout, is the
 * durable authority for crash recovery. No credential is deleted here. */
export async function runGrantCleanup(requestId:unknown,mode:unknown,store:CleanupStore,environment:Environment,
 origin:string,fixtureFetch:typeof fetch,clock:()=>number=clockNow):Promise<Result>{
 try{
   if(mode!=='isolated_fixture_only'||!isUuid(requestId)||typeof fixtureFetch!=='function')return FAILED;
   const raw=await store.claim(requestId),now=clock();
   if(raw===null)return IDLE;
   if(!unixSeconds(now))return FAILED;
   const job=claim(raw,requestId,now);if(!job)return FAILED;
   const finish=async(outcome:Outcome):Promise<Result>=>{
     const t=clock();
     if(!unixSeconds(t)||t<now||t>=job.leaseUntil)return FAILED;
     return await store.finish(requestId,job.connectionId,job.fence,outcome)===true?Object.freeze({kind:'recorded',outcome}):FAILED;
   };
   if(job.providerId==='outlook'||job.providerId==='instagram')return await finish('manual_revocation_required');
   const key=tokenKey(environment),config=providerConfiguration(environment,job.providerId,origin);
   if(!key||!config||!job.sealedGrant)return await finish('credential_unavailable');
   let grant;
   try{grant=parseGrant(unseal(job.sealedGrant,key,'grant:'+job.ownerId+':'+job.providerId+':'+job.connectionId));}
   catch{return await finish('credential_unavailable');}
   // Leave enough time for the existing provider driver's bounded 12s deadline.
   const before=clock();if(!unixSeconds(before)||before<now||job.leaseUntil-before<15)return FAILED;
   if(await store.markDispatched(requestId,job.connectionId,job.fence)!==true)return FAILED;
   const dispatched=clock();if(!unixSeconds(dispatched)||dispatched<before||job.leaseUntil-dispatched<15)return FAILED;
   // Tighten the existing revoke transport's accepted acknowledgement status.
   // No access-token refresh or user content retrieval is permitted here.
   let calls=0;
   const transport:typeof fetch=async(input,init)=>{
     const u=new URL(input instanceof Request?input.url:String(input));
     const expected=job.providerId==='gmail'?'https://oauth2.googleapis.com/revoke':
       'https://graph.facebook.com/'+config.graphVersion+'/'+grant.accountId+'/permissions';
     if(++calls!==1||u.href!==expected||init?.method!==(job.providerId==='gmail'?'POST':'DELETE'))throw Error('CLEANUP_PROVIDER_REJECTED');
     const res=await fixtureFetch(input,init);
     if(res.status!==200||res.redirected||(res.url!==''&&res.url!==expected)){
       await res.body?.cancel().catch(()=>{});throw Error('CLEANUP_PROVIDER_REJECTED');
     }
     return res;
   };
   let outcome:Outcome='provider_outcome_unknown';
   try{if(await revokeGrant(config,grant,{fetchImpl:transport})==='revoked'&&calls===1)outcome='provider_acknowledged';}
   catch{/* Unknown remote outcome; never retry a dispatched revocation automatically. */}
   return await finish(outcome);
 }catch{return FAILED;}
}

type BillingReview=Readonly<{kind:'unavailable'}>|Readonly<{kind:'observed';subscriptionState:'ended'|'scheduled_end'|'unresolved';latestInvoice:'unresolved'|'no_balance_reported'|'not_observed';requiresReview:true}>;
const BILLING_FAILED:BillingReview=Object.freeze({kind:'unavailable'});
/** Read-only classification; neither cancellation nor settlement is inferred
 * from a zero amount or a terminal subscription. No write API is used. */
export async function inspectSubscriptionCleanup(ownerId:unknown,binding:unknown,reader:Pick<StripeReadClient,'observeSubscription'>,now:unknown):Promise<BillingReview>{
 try{
   if(!isUuid(ownerId)||!isRecord(binding)||binding.ownerId!==ownerId||binding.liveMode!==false||!stripeId(binding.accountId,'acct')
      ||!stripeId(binding.customerId,'cus')||!stripeId(binding.subscriptionId,'sub')||!stripeId(binding.priceId,'price')
      ||typeof binding.itemId!=='string'||!/^si_[A-Za-z0-9]{1,252}$/u.test(binding.itemId)||!unixSeconds(now))return BILLING_FAILED;
   const o=await reader.observeSubscription(ownerId,binding);
   if(o.liveMode!==false||o.accountId!==binding.accountId||o.customerId!==binding.customerId||o.subscriptionId!==binding.subscriptionId||
      o.priceId!==binding.priceId||o.itemId!==binding.itemId||o.fundsConfirmed!==false||o.riskState!=='unknown')return BILLING_FAILED;
   const subscriptionState=o.status==='canceled'||o.status==='incomplete_expired'?'ended':
     o.cancelAtPeriodEnd===true&&o.cancelAt!==null&&o.cancelAt>now?'scheduled_end':'unresolved';
   const invoice=o.latestInvoice;
   const latestInvoice=invoice===null?'not_observed':invoice.amountRemaining===0&&(invoice.status==='paid'||invoice.status==='void')?'no_balance_reported':'unresolved';
   return Object.freeze({kind:'observed',subscriptionState,latestInvoice,requiresReview:true});
 }catch{return BILLING_FAILED;}
}
