// Laboratory only; not imported by the production runtime.
import {StripeReadClient, STRIPE_BILLING_API_VERSION} from '../../source/src/billing/stripe-reader.js';
import {PREMIUM_PLANS} from '../../source/src/billing/catalog.js';
import {record,field,stripeId,unixSeconds} from '../../source/src/billing/records.js';

type CapturedCardObservation = Readonly<{
  kind:'captured_card_observation';
  accountId:string; customerId:string; subscriptionId:string; itemId:string; priceId:string;
  invoiceId:string; invoicePaymentId:string; paymentIntentId:string; chargeId:string;
  amountCents:number; currency:'eur'; periodStart:number; periodEnd:number; checkedAt:number;
  riskSignals:'none_observed'; fundsConfirmed:false; riskState:'unknown';
}>;
type Result = Readonly<{kind:'not_verified'}> | CapturedCardObservation;
const DENIED: Result = Object.freeze({kind:'not_verified'});
const origin='https://api.stripe.com';
const maxBytes=256*1024;
const reject=():never=>{throw Error('BILLING_PAYMENT_PROOF_REJECTED');};
const id=(v:unknown,prefix:string):v is string=>typeof v==='string' && v.length<=255
  && v.startsWith(prefix) && /^[A-Za-z0-9]+$/u.test(v.slice(prefix.length));
const get=(v:unknown,k:string):unknown=>field(record(v),k);
const empty=(v:unknown):boolean=>Array.isArray(v)&&v.length===0;
function list(v:unknown, count:number):unknown[] {
  const data=get(v,'data');
  if(get(v,'object')!=='list'||get(v,'has_more')!==false||!Array.isArray(data)||data.length!==count)return reject();
  return data;
}
const sameFields=(v:unknown, fields:Readonly<Record<string,unknown>>):boolean=>
  Object.entries(fields).every(([k,expected])=>get(v,k)===expected);

// Narrow additional transport. It accepts only paths formed by this class from
// verified provider IDs; callers cannot provide URLs, headers or query parameters.
// Future canonical refactoring should consolidate with StripeReadClient's GET transport.
export class SandboxCardProofReader {
  readonly #reader:StripeReadClient;
  readonly #key:string;
  readonly #fetch:typeof fetch;
  constructor(configuration:unknown,key:unknown,fetchImpl:typeof fetch=fetch) {
    if(typeof key!=='string'||!/^rk_test_[A-Za-z0-9]{1,500}$/u.test(key))throw Error('BILLING_PAYMENT_PROOF_REJECTED');
    // This pilot supports only the inclusive, fixed-price sandbox catalog.
    if(get(configuration,'taxBehavior')!=='inclusive')throw Error('BILLING_PAYMENT_PROOF_REJECTED');
    this.#reader=new StripeReadClient(configuration,key,fetchImpl);
    this.#key=key;
    this.#fetch=fetchImpl;
  }
  async #read(path:string,query?:URLSearchParams):Promise<unknown> {
    if(!/^\/v1\/(?:invoices\/in_[A-Za-z0-9]+|payment_intents\/pi_[A-Za-z0-9]+|charges\/ch_[A-Za-z0-9]+|invoice_payments|refunds|disputes|radar\/early_fraud_warnings)$/u.test(path))return reject();
    const url=origin+path+(query?'?'+query.toString():'');
    const response=await this.#fetch(url,{method:'GET',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+this.#key,'Stripe-Version':STRIPE_BILLING_API_VERSION,Accept:'application/json'},
      signal:AbortSignal.timeout(8000)});
    const length=response.headers.get('content-length');
    if(response.status!==200||response.redirected||(response.url!==''&&response.url!==url)
      ||!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type')??'')
      ||(length!==null&&(!/^\d{1,10}$/u.test(length)||Number(length)>maxBytes))||!response.body) {
      await response.body?.cancel().catch(()=>{});return reject();
    }
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    try{
      for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;
        if(size>maxBytes){await reader.cancel().catch(()=>{});return reject();}chunks.push(next.value);}
    }finally{reader.releaseLock();}
    if(size===0)return reject();
    const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size))) as unknown;
    return record(v)?v:reject();
  }

  // owner and binding are exclusively server-owned. This method cannot prove
  // authorization or payment settlement, and never yields a Premium grant.
  async inspect(owner:unknown,binding:unknown,now:unknown):Promise<Result> {
    try {
      if(!unixSeconds(now))return DENIED;
      const o=await this.#reader.observeSubscription(owner,binding);
      const expected=PREMIUM_PLANS[o.plan].unitAmount;
      const invoiceId=o.latestInvoice?.id;
      if(o.status!=='active'||o.collectionPaused||o.periodStart>now||o.periodEnd<=now
        ||(o.cancelAt!==null&&o.cancelAt<=now)||o.periodEnd-o.periodStart>(o.plan==='monthly'?32:367)*86400
        ||get(binding,'itemId')!==o.itemId||get(binding,'priceId')!==o.priceId
        ||!stripeId(invoiceId,'in')||o.latestInvoice?.status!=='paid'
        ||o.latestInvoice.amountDue!==expected||o.latestInvoice.amountPaid!==expected||o.latestInvoice.amountRemaining!==0)return DENIED;
      const invoice=await this.#read('/v1/invoices/'+invoiceId,new URLSearchParams({'expand[]':'amount_paid_off_stripe'}));
      const parent=get(invoice,'parent');
      const billingReason=get(invoice,'billing_reason');
      if(!sameFields(invoice,{object:'invoice',id:invoiceId,livemode:false,customer:o.customerId,currency:'eur',
        status:'paid',collection_method:'charge_automatically',amount_due:expected,amount_paid:expected,
        amount_remaining:0,total:expected,starting_balance:0,ending_balance:0,amount_paid_off_stripe:0,
        amount_shipping:0,pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0})
        ||(billingReason!=='subscription_create'&&billingReason!=='subscription_cycle')
        ||get(parent,'type')!=='subscription_details'||get(get(parent,'subscription_details'),'subscription')!==o.subscriptionId
        ||!empty(get(invoice,'discounts'))||!empty(get(invoice,'total_discount_amounts')))return DENIED;
      const line=list(get(invoice,'lines'),1)[0];
      const lineParent=get(line,'parent'), detail=get(lineParent,'subscription_item_details');
      const pricing=get(line,'pricing'), priceDetails=get(pricing,'price_details');
      if(!id(get(line,'id'),'il_')||!sameFields(line,{object:'line_item',invoice:invoiceId,livemode:false,currency:'eur',
        quantity:1,amount:expected})||get(lineParent,'type')!=='subscription_item_details'
        ||!sameFields(detail,{subscription:o.subscriptionId,subscription_item:o.itemId,proration:false})
        ||get(pricing,'type')!=='price_details'||!sameFields(priceDetails,{price:o.priceId,product:o.productId})
        ||!sameFields(get(line,'period'),{start:o.periodStart,end:o.periodEnd})
        ||!empty(get(line,'discounts'))||!empty(get(line,'discount_amounts'))||!empty(get(line,'pretax_credit_amounts'))
        ||!empty(get(line,'taxes')))return DENIED;
      const payment=list(await this.#read('/v1/invoice_payments',new URLSearchParams({invoice:invoiceId,limit:'2'})),1)[0];
      const invoicePaymentId=get(payment,'id'), paymentDetails=get(payment,'payment'), intentId=get(paymentDetails,'payment_intent');
      if(!id(invoicePaymentId,'inpay_')||!sameFields(payment,{object:'invoice_payment',invoice:invoiceId,livemode:false,
        status:'paid',currency:'eur',amount_requested:expected,amount_paid:expected})
        ||get(paymentDetails,'type')!=='payment_intent'||!id(intentId,'pi_'))return DENIED;
      // Prove the same payment is not allocated to another invoice.
      const allocations=list(await this.#read('/v1/invoice_payments',new URLSearchParams({
        'payment[type]':'payment_intent','payment[payment_intent]':intentId,limit:'2'})),1)[0];
      if(!sameFields(allocations,{id:invoicePaymentId,object:'invoice_payment',invoice:invoiceId,livemode:false,
        status:'paid',currency:'eur',amount_requested:expected,amount_paid:expected})
        ||!sameFields(get(allocations,'payment'),{type:'payment_intent',payment_intent:intentId}))return DENIED;
      const intent=await this.#read('/v1/payment_intents/'+intentId);
      const chargeId=get(intent,'latest_charge'),methodId=get(intent,'payment_method');
      if(!sameFields(intent,{object:'payment_intent',id:intentId,livemode:false,customer:o.customerId,currency:'eur',
        status:'succeeded',amount:expected,amount_received:expected,amount_capturable:0,review:null})
        ||!id(chargeId,'ch_')||!id(methodId,'pm_'))return DENIED;
      const charge=await this.#read('/v1/charges/'+chargeId);
      if(!sameFields(charge,{object:'charge',id:chargeId,livemode:false,customer:o.customerId,currency:'eur',
        payment_intent:intentId,payment_method:methodId,status:'succeeded',paid:true,captured:true,amount:expected,
        amount_captured:expected,amount_refunded:0,refunded:false,disputed:false,review:null})
        ||get(get(charge,'payment_method_details'),'type')!=='card'
        ||!sameFields(get(charge,'outcome'),{type:'authorized',risk_level:'normal'}))return DENIED;
      for(const path of ['/v1/refunds','/v1/disputes','/v1/radar/early_fraud_warnings']){
        list(await this.#read(path,new URLSearchParams({charge:chargeId,limit:'1'})),0);
      }
      // No grant is produced, even with an observed successful capture and no
      // current risk signals. A later refund/dispute may arrive asynchronously.
      return Object.freeze({kind:'captured_card_observation',accountId:o.accountId,customerId:o.customerId,
        subscriptionId:o.subscriptionId,itemId:o.itemId,priceId:o.priceId,invoiceId,invoicePaymentId,
        paymentIntentId:intentId,chargeId,amountCents:expected,currency:'eur',periodStart:o.periodStart,
        periodEnd:o.periodEnd,checkedAt:now,riskSignals:'none_observed',fundsConfirmed:false,riskState:'unknown'});
    }catch{return DENIED;}
  }
}
