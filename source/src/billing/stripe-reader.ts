import {isUuid} from '../data/guards.js';
import {PREMIUM_PLANS, premiumPlanForPrice, verifyPremiumCatalog, type PremiumCatalog, type PremiumPlan} from './catalog.js';
import {field, record, stripeId, unixSeconds} from './records.js';

export const STRIPE_BILLING_API_VERSION = '2026-11-18.endive';
const ORIGIN = 'https://api.stripe.com';
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 8000;
const fail = (): never => { throw new Error('STRIPE_BILLING_READ_REJECTED'); };
const subscriptionStatuses = new Set(['active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused']);
const invoiceStatuses = new Set(['draft','open','paid','uncollectible','void']);
const cents = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const subscriptionItemId = (value: unknown): value is string => typeof value === 'string' && /^si_[A-Za-z0-9]{1,252}$/u.test(value);
const providerId=(v:unknown,prefix:string):v is string=>typeof v==='string'&&v.length<=255&&v.startsWith(prefix)&&/^[A-Za-z0-9]+$/u.test(v.slice(prefix.length));
export type FinancialRiskType='charge.refunded'|'charge.dispute.created'|'radar.early_fraud_warning.created';
export interface FinancialRiskLink {
 readonly accountId:string; readonly liveMode:false; readonly eventType:FinancialRiskType;
 readonly objectId:string; readonly chargeId:string; readonly paymentIntentId:string;
 readonly invoiceId:string; readonly customerId:string; readonly subscriptionId:string;
 readonly riskState:'review_required';
}

export interface CheckoutLink {
 readonly accountId:string; readonly liveMode:false; readonly sessionId:string; readonly intentId:string; readonly customerId:string;
}
export type CheckoutTerminalObservation=Readonly<CheckoutLink & {
 priceId:string; ownerId:string; expiresAt:number;
} & ({status:'complete';paymentStatus:'paid';subscriptionId:string;itemId:string}
 | {status:'expired';paymentStatus:'unpaid';subscriptionId:null;itemId:null})>;

export interface StripeSubscriptionObservation {
  readonly accountId: string;
  readonly liveMode: false;
  readonly customerId: string;
  readonly subscriptionId: string;
  readonly itemId: string;
  readonly plan: PremiumPlan;
  readonly priceId: string;
  readonly productId: string;
  readonly status: string;
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly collectionPaused: boolean;
  readonly cancelAt: number | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly latestInvoice: Readonly<{id: string; status: string; amountDue: number; amountPaid: number; amountRemaining: number}> | null;
  readonly fundsConfirmed: false;
  readonly riskState: 'unknown';
}

/** A sandbox-only authenticated HTTPS reader. No mutation, arbitrary URL, account switching, or caller-provided headers.
 * The restricted key is held in a private field and is never returned or logged. The production runtime must use
 * a separate secret/configuration and an explicit release decision. This class deliberately cannot read live Stripe.
 */
export class StripeReadClient {
  readonly #key: string;
  readonly #catalog: PremiumCatalog;
  readonly #fetch: typeof fetch;

  constructor(configuration: unknown, restrictedKey: unknown, fetchImpl: typeof fetch = fetch) {
    const c = record(configuration);
    const accountId = field(c,'accountId'), productId = field(c,'productId');
    const monthlyPriceId = field(c,'monthlyPriceId'), annualPriceId = field(c,'annualPriceId');
    const taxCode = field(c,'taxCode'), taxBehavior = field(c,'taxBehavior');
    if (!stripeId(accountId,'acct') || field(c,'liveMode') !== false || !stripeId(productId,'prod')
      || !stripeId(monthlyPriceId,'price') || !stripeId(annualPriceId,'price') || monthlyPriceId === annualPriceId
      || typeof taxCode !== 'string' || !/^txcd_[0-9]{8}$/u.test(taxCode)
      || (taxBehavior !== 'inclusive' && taxBehavior !== 'exclusive')
      || typeof restrictedKey !== 'string' || !/^rk_test_[A-Za-z0-9]{1,500}$/u.test(restrictedKey)) throw new Error('STRIPE_BILLING_READ_REJECTED');
    this.#catalog = Object.freeze({accountId,liveMode:false,productId,monthlyPriceId,annualPriceId,taxCode,taxBehavior});
    this.#key = restrictedKey;
    this.#fetch = fetchImpl;
  }

  async #read(path: string, filterId?: string, deadline?: AbortSignal): Promise<unknown> {
    try {
      // Paths are composed exclusively from private literals and strictly validated Stripe IDs.
      if (!/^\/v1\/(?:account|products\/prod_[A-Za-z0-9]+|prices\/price_[A-Za-z0-9]+|subscriptions\/sub_[A-Za-z0-9]+|invoices\/in_[A-Za-z0-9]+|charges\/ch_[A-Za-z0-9]+|payment_intents\/pi_[A-Za-z0-9]+|disputes\/du_[A-Za-z0-9]+|radar\/early_fraud_warnings\/issfr_[A-Za-z0-9]+|invoice_payments|checkout\/sessions(?:\/cs_test_[A-Za-z0-9]+(?:\/line_items)?)?|customers\/cus_[A-Za-z0-9]+|subscriptions)$/u.test(path)) return fail();
      let params:URLSearchParams|undefined;
      if(path==='/v1/invoice_payments'){
        if(!providerId(filterId,'pi_'))return fail();
        params=new URLSearchParams({'payment[type]':'payment_intent','payment[payment_intent]':filterId,limit:'2'});
      }else if(path==='/v1/checkout/sessions'||path==='/v1/subscriptions'){
        if(!stripeId(filterId,'cus'))return fail();
        params=new URLSearchParams({customer:filterId,limit:'2'});
        if(path==='/v1/subscriptions')params.set('status','all');
      }else{
        if(filterId!==undefined)return fail();
        if(path.endsWith('/line_items'))params=new URLSearchParams({limit:'2'});
      }
      const query=params?'?'+params.toString():'';
      const url = ORIGIN + path + query;
      const response = await this.#fetch(url,{method:'GET',redirect:'error',cache:'no-store',
        headers:{Authorization:'Bearer '+this.#key,'Stripe-Version':STRIPE_BILLING_API_VERSION,Accept:'application/json'},
        signal:deadline?AbortSignal.any([deadline,AbortSignal.timeout(REQUEST_TIMEOUT_MS)]):AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
      const length = response.headers.get('content-length');
      if (response.status !== 200 || response.redirected || (response.url !== '' && response.url !== url)
        || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')
        || (length !== null && (!/^\d{1,10}$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES))
        || !response.body) { await response.body?.cancel().catch(()=>{}); return fail(); }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel().catch(()=>{}); return fail(); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      if (bytes === 0) return fail();
      const value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes))) as unknown;
      if (!record(value)) return fail();
      return value;
    } catch { return fail(); }
  }

  async loadCatalog(deadline?: AbortSignal): Promise<PremiumCatalog> {
    const configuration = this.#catalog;
    const account = record(await this.#read('/v1/account',undefined,deadline));
    if (field(account,'object') !== 'account' || field(account,'id') !== configuration.accountId) return fail();
    const [product,monthly,annual] = await Promise.all([
      this.#read('/v1/products/'+configuration.productId,undefined,deadline),
      this.#read('/v1/prices/'+configuration.monthlyPriceId,undefined,deadline),
      this.#read('/v1/prices/'+configuration.annualPriceId,undefined,deadline),
    ]);
    return verifyPremiumCatalog(configuration,field(account,'id'),product,monthly,annual);
  }

  /** Resolve an arbitrary historical invoice to its subscription. The signed
   * event contains only the invoice ID; neither event metadata nor invoice
   * payment status is authorization evidence. Account identity is checked
   * directly; the caller must verify the immutable binding separately. */
  async observeInvoiceLink(invoiceId: unknown): Promise<Readonly<{
    accountId:string; liveMode:false; invoiceId:string; customerId:string; subscriptionId:string;
  }>> {
    if(!stripeId(invoiceId,'in')) return fail();
    const account=record(await this.#read('/v1/account'));
    if(field(account,'object')!=='account'||field(account,'id')!==this.#catalog.accountId) return fail();
    const invoice=record(await this.#read('/v1/invoices/'+invoiceId));
    const parent=record(field(invoice,'parent')), details=record(field(parent,'subscription_details'));
    const customerId=field(invoice,'customer'), subscriptionId=field(details,'subscription');
    if(field(invoice,'object')!=='invoice'||field(invoice,'id')!==invoiceId||
       field(invoice,'livemode')!==false||field(invoice,'currency')!=='eur'||
       !stripeId(customerId,'cus')||field(parent,'type')!=='subscription_details'||
       !stripeId(subscriptionId,'sub')) return fail();
    return Object.freeze({accountId:this.#catalog.accountId,liveMode:false,invoiceId,customerId,subscriptionId});
  }

  /** A negative risk observation, never a payment or entitlement proof.
   * Re-read exact Stripe resources; require one unambiguous paid allocation
   * from charge -> intent -> invoice -> subscription. Historical disputes
   * and warnings remain review-required even if no longer actionable. */
  async observeFinancialRiskLink(eventType:unknown,objectId:unknown):Promise<FinancialRiskLink>{
    const expected=eventType==='charge.refunded'?'ch_':eventType==='charge.dispute.created'?'du_':eventType==='radar.early_fraud_warning.created'?'issfr_':null;
    if(!expected||!providerId(objectId,expected))return fail();
    const signal=AbortSignal.timeout(18000);
    const read=async(path:string,paymentIntent?:string)=>record(await this.#read(path,paymentIntent,signal));
    const account=await read('/v1/account');
    if(field(account,'object')!=='account'||field(account,'id')!==this.#catalog.accountId)return fail();
    let chargeId:unknown=objectId,disputeIntent:unknown=null;
    if(eventType!=='charge.refunded'){
      const dispute=eventType==='charge.dispute.created';
      const resource=await read((dispute?'/v1/disputes/':'/v1/radar/early_fraud_warnings/')+objectId);
      if(field(resource,'id')!==objectId||field(resource,'object')!==(dispute?'dispute':'radar.early_fraud_warning')||field(resource,'livemode')!==false)return fail();
      if(dispute){
        const amount=field(resource,'amount');
        if(field(resource,'currency')!=='eur'||!cents(amount)||amount<=0)return fail();
        disputeIntent=field(resource,'payment_intent');
        if(disputeIntent!==null&&!providerId(disputeIntent,'pi_'))return fail();
      }else if(typeof field(resource,'actionable')!=='boolean')return fail();
      chargeId=field(resource,'charge');
    }
    if(!providerId(chargeId,'ch_'))return fail();
    const charge=await read('/v1/charges/'+chargeId);
    const customerId=field(charge,'customer'),intentId=field(charge,'payment_intent');
    const captured=field(charge,'amount_captured'),refunded=field(charge,'amount_refunded');
    if(field(charge,'object')!=='charge'||field(charge,'id')!==chargeId||field(charge,'livemode')!==false||
       field(charge,'currency')!=='eur'||field(charge,'paid')!==true||field(charge,'captured')!==true||field(charge,'status')!=='succeeded'||
       !stripeId(customerId,'cus')||!providerId(intentId,'pi_')||!cents(captured)||captured<=0||!cents(refunded)||refunded>captured||
       (eventType==='charge.refunded'&&refunded===0)||(disputeIntent!==null&&disputeIntent!==intentId))return fail();
    const intent=await read('/v1/payment_intents/'+intentId);
    if(field(intent,'object')!=='payment_intent'||field(intent,'id')!==intentId||field(intent,'livemode')!==false||
       field(intent,'customer')!==customerId||field(intent,'currency')!=='eur'||field(intent,'latest_charge')!==chargeId||
       field(intent,'amount_received')!==captured)return fail();
    const allocation=await read('/v1/invoice_payments',intentId),data=field(allocation,'data');
    if(field(allocation,'object')!=='list'||field(allocation,'has_more')!==false||!Array.isArray(data)||data.length!==1)return fail();
    const payment=record(data[0]),details=record(field(payment,'payment')),invoiceId=field(payment,'invoice');
    if(field(payment,'object')!=='invoice_payment'||!providerId(field(payment,'id'),'inpay_')||field(payment,'livemode')!==false||
       field(payment,'status')!=='paid'||field(payment,'currency')!=='eur'||field(payment,'amount_paid')!==captured||
       field(details,'type')!=='payment_intent'||field(details,'payment_intent')!==intentId||!stripeId(invoiceId,'in'))return fail();
    const invoice=await read('/v1/invoices/'+invoiceId),parent=record(field(invoice,'parent'));
    const subscriptionId=field(record(field(parent,'subscription_details')),'subscription');
    if(field(invoice,'object')!=='invoice'||field(invoice,'id')!==invoiceId||field(invoice,'livemode')!==false||
       field(invoice,'currency')!=='eur'||field(invoice,'customer')!==customerId||
       field(parent,'type')!=='subscription_details'||!stripeId(subscriptionId,'sub')||signal.aborted)return fail();
    if(eventType!=='charge.refunded'&&eventType!=='charge.dispute.created'&&eventType!=='radar.early_fraud_warning.created')return fail();
    return Object.freeze({accountId:this.#catalog.accountId,liveMode:false,eventType,objectId,chargeId,paymentIntentId:intentId,
      invoiceId,customerId,subscriptionId,riskState:'review_required'});
  }

  /** Exact authenticated Checkout reference. Its intent reference is only
   * a candidate lookup key; durable owner/intent binding must be read next. */
  async observeCheckoutLink(sessionId:unknown):Promise<CheckoutLink>{
    if(!providerId(sessionId,'cs_test_'))return fail();
    const signal=AbortSignal.timeout(8000);
    const account=record(await this.#read('/v1/account',undefined,signal));
    if(field(account,'object')!=='account'||field(account,'id')!==this.#catalog.accountId)return fail();
    const s=record(await this.#read('/v1/checkout/sessions/'+sessionId,undefined,signal));
    const intentId=field(s,'client_reference_id'),customerId=field(s,'customer');
    if(field(s,'object')!=='checkout.session'||field(s,'id')!==sessionId||field(s,'livemode')!==false||
       field(s,'mode')!=='subscription'||!isUuid(intentId)||!stripeId(customerId,'cus')||signal.aborted)return fail();
    return Object.freeze({accountId:this.#catalog.accountId,liveMode:false,sessionId,intentId,customerId});
  }

  /** Read-only terminal reconciliation for the first-purchase sandbox. No
   * write key, create/expire call, hosted URL return or entitlement proof. */
  async observeCheckoutTerminal(binding:unknown,sessionId:unknown,returnOrigin:unknown):Promise<CheckoutTerminalObservation>{
    const b=record(binding),ownerId=field(b,'ownerId'),intentId=field(b,'intentId'),customerId=field(b,'customerId'),priceId=field(b,'priceId'),
      createdAt=field(b,'createdAt'),expiresAt=field(b,'expiresAt'),known=field(b,'sessionId');
    if(field(b,'accountId')!==this.#catalog.accountId||field(b,'liveMode')!==false||!isUuid(ownerId)||!isUuid(intentId)||
      !stripeId(customerId,'cus')||!stripeId(priceId,'price')||!providerId(sessionId,'cs_test_')||
      !unixSeconds(createdAt)||!unixSeconds(expiresAt)||expiresAt!==createdAt+3600||
      (known!==null&&known!==sessionId)||typeof returnOrigin!=='string'||returnOrigin.length>253)return fail();
    let origin:URL;
    try{origin=new URL(returnOrigin);}catch{return fail();}
    if(origin.protocol!=='https:'||origin.origin!==returnOrigin||origin.username||origin.password||origin.port||!origin.hostname.includes('.'))return fail();
    const signal=AbortSignal.timeout(18000);
    const read=async(path:string,filter?:string)=>record(await this.#read(path,filter,signal));
    const catalog=await this.loadCatalog(signal),plan=premiumPlanForPrice(catalog,priceId);
    if(!plan||catalog.taxBehavior!=='inclusive')return fail();
    const amount=PREMIUM_PLANS[plan].unitAmount;
    const [s,customer,sessions,lines,subscriptions]=await Promise.all([
      read('/v1/checkout/sessions/'+sessionId),read('/v1/customers/'+customerId),
      read('/v1/checkout/sessions',customerId),read('/v1/checkout/sessions/'+sessionId+'/line_items'),read('/v1/subscriptions',customerId)
    ]);
    const same=(v:Record<string,unknown>|null,values:Readonly<Record<string,unknown>>)=>Object.entries(values).every(([k,x])=>field(v,k)===x);
    const list=(v:Record<string,unknown>|null,count:number):unknown[]=>{
      const d=field(v,'data');
      if(field(v,'object')!=='list'||field(v,'has_more')!==false||!Array.isArray(d)||d.length!==count)return fail();
      return d;
    };
    const pm=field(s,'payment_method_types'),created=field(s,'created');
    if(!same(s,{object:'checkout.session',id:sessionId,livemode:false,mode:'subscription',ui_mode:'hosted_page',customer:customerId,
      client_reference_id:intentId,currency:'eur',amount_total:amount,amount_subtotal:amount,expires_at:expiresAt,
      success_url:returnOrigin+'/billing/return',cancel_url:returnOrigin+'/billing/cancel',allow_promotion_codes:false})||
      !unixSeconds(created)||created<createdAt||created>createdAt+600||
      !Array.isArray(pm)||pm.length!==1||pm[0]!=='card'||field(record(field(s,'automatic_tax')),'enabled')!==false||
      !same(customer,{object:'customer',id:customerId,livemode:false})||field(customer,'deleted')===true||
      !same(record(field(customer,'metadata')),{application:'dlkt_info',environment:'sandbox'}))return fail();
    const listed=record(list(sessions,1)[0]),line=record(list(lines,1)[0]);
    if(!same(listed,{id:sessionId,object:'checkout.session',livemode:false,customer:customerId,client_reference_id:intentId})||
      !same(line,{object:'item',quantity:1,currency:'eur',amount_total:amount,amount_subtotal:amount})||
      !same(record(field(line,'price')),{id:priceId,product:catalog.productId,livemode:false,currency:'eur',unit_amount:amount}))return fail();
    const common={accountId:catalog.accountId,liveMode:false as const,sessionId,intentId,customerId,ownerId,priceId,expiresAt};
    if(same(s,{status:'expired',payment_status:'unpaid',subscription:null})){
      list(subscriptions,0);if(signal.aborted)return fail();
      return Object.freeze({...common,status:'expired',paymentStatus:'unpaid',subscriptionId:null,itemId:null});
    }
    const subscriptionId=field(s,'subscription');
    if(field(s,'status')!=='complete'||field(s,'payment_status')!=='paid'||!stripeId(subscriptionId,'sub')||
      !same(record(list(subscriptions,1)[0]),{id:subscriptionId,object:'subscription',livemode:false,customer:customerId}))return fail();
    const observation=await this.observeSubscription(ownerId,{accountId:catalog.accountId,liveMode:false,customerId,subscriptionId,ownerId},signal);
    if(signal.aborted||observation.priceId!==priceId||observation.customerId!==customerId||observation.subscriptionId!==subscriptionId||
       observation.fundsConfirmed!==false||observation.riskState!=='unknown')return fail();
    return Object.freeze({...common,status:'complete',paymentStatus:'paid',subscriptionId,itemId:observation.itemId});
  }

  /** The owner and binding must come from an authenticated session and private server-owned store.
   * This is an observation, not authorization. It cannot assert payment funding, invoice-line coverage
   * or risk clearance, and it cannot grant access even when Stripe reports an active subscription.
   */
  async observeSubscription(ownerId: unknown, binding: unknown, deadline?:AbortSignal): Promise<StripeSubscriptionObservation> {
    const b = record(binding), c = this.#catalog;
    const customerId = field(b,'customerId'), subscriptionId = field(b,'subscriptionId');
    if (!isUuid(ownerId) || field(b,'ownerId') !== ownerId || field(b,'accountId') !== c.accountId
      || field(b,'liveMode') !== false || !stripeId(customerId,'cus') || !stripeId(subscriptionId,'sub')) return fail();
    const catalog = await this.loadCatalog(deadline);
    const s = record(await this.#read('/v1/subscriptions/'+subscriptionId,undefined,deadline));
    const status = field(s,'status'), cancelAt = field(s,'cancel_at'), cancelAtPeriodEnd = field(s,'cancel_at_period_end');
    const paused = field(s,'pause_collection'), list = record(field(s,'items')), items = field(list,'data');
    if (field(s,'object') !== 'subscription' || field(s,'id') !== subscriptionId
      || field(s,'livemode') !== false || field(s,'customer') !== customerId
      || typeof status !== 'string' || !subscriptionStatuses.has(status)
      || (cancelAt !== null && !unixSeconds(cancelAt)) || typeof cancelAtPeriodEnd !== 'boolean'
      || (paused !== null && !record(paused)) || field(list,'object') !== 'list'
      || field(list,'has_more') !== false || !Array.isArray(items) || items.length !== 1) return fail();
    const item = record(items[0]), price = record(field(item,'price')), priceId = field(price,'id'), itemId = field(item,'id');
    const periodStart = field(item,'current_period_start'), periodEnd = field(item,'current_period_end');
    const plan = premiumPlanForPrice(catalog,priceId);
    if (!plan || !stripeId(priceId,'price') || !subscriptionItemId(itemId)
      || field(item,'object') !== 'subscription_item' || field(item,'subscription') !== subscriptionId
      || field(item,'quantity') !== 1 || field(price,'object') !== 'price'
      || field(price,'product') !== catalog.productId || field(price,'livemode') !== false
      || field(price,'currency') !== 'eur' || field(price,'unit_amount') !== PREMIUM_PLANS[plan].unitAmount
      || !unixSeconds(periodStart) || !unixSeconds(periodEnd) || periodEnd <= periodStart) return fail();
    const invoiceId = field(s,'latest_invoice');
    let latestInvoice: StripeSubscriptionObservation['latestInvoice'] = null;
    if (invoiceId !== null) {
      if (!stripeId(invoiceId,'in')) return fail();
      const i = record(await this.#read('/v1/invoices/'+invoiceId,undefined,deadline));
      const parent = record(field(i,'parent')), details = record(field(parent,'subscription_details'));
      const invoiceStatus = field(i,'status'), amountDue = field(i,'amount_due'), amountPaid = field(i,'amount_paid'), amountRemaining = field(i,'amount_remaining');
      if (field(i,'object') !== 'invoice' || field(i,'id') !== invoiceId || field(i,'livemode') !== false
        || field(i,'customer') !== customerId || field(i,'currency') !== 'eur'
        || field(parent,'type') !== 'subscription_details' || field(details,'subscription') !== subscriptionId
        || typeof invoiceStatus !== 'string' || !invoiceStatuses.has(invoiceStatus)
        || !cents(amountDue) || !cents(amountPaid) || !cents(amountRemaining)) return fail();
      latestInvoice = Object.freeze({id:invoiceId,status:invoiceStatus,amountDue,amountPaid,amountRemaining});
    }
    return Object.freeze({accountId:catalog.accountId,liveMode:false,customerId,subscriptionId,itemId,plan,priceId,
      productId:catalog.productId,status,periodStart,periodEnd,collectionPaused:paused !== null,cancelAt,cancelAtPeriodEnd,
      latestInvoice,fundsConfirmed:false,riskState:'unknown'});
  }
}
