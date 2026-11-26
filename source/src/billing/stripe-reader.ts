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

  async #read(path: string): Promise<unknown> {
    try {
      // Paths are composed exclusively from private literals and strictly validated Stripe IDs.
      if (!/^\/v1\/(?:account|products\/prod_[A-Za-z0-9]+|prices\/price_[A-Za-z0-9]+|subscriptions\/sub_[A-Za-z0-9]+|invoices\/in_[A-Za-z0-9]+)$/u.test(path)) return fail();
      const url = ORIGIN + path;
      const response = await this.#fetch(url,{method:'GET',redirect:'error',cache:'no-store',
        headers:{Authorization:'Bearer '+this.#key,'Stripe-Version':STRIPE_BILLING_API_VERSION,Accept:'application/json'},
        signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
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

  async loadCatalog(): Promise<PremiumCatalog> {
    const configuration = this.#catalog;
    const account = record(await this.#read('/v1/account'));
    if (field(account,'object') !== 'account' || field(account,'id') !== configuration.accountId) return fail();
    const [product,monthly,annual] = await Promise.all([
      this.#read('/v1/products/'+configuration.productId),
      this.#read('/v1/prices/'+configuration.monthlyPriceId),
      this.#read('/v1/prices/'+configuration.annualPriceId),
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

  /** The owner and binding must come from an authenticated session and private server-owned store.
   * This is an observation, not authorization. It cannot assert payment funding, invoice-line coverage
   * or risk clearance, and it cannot grant access even when Stripe reports an active subscription.
   */
  async observeSubscription(ownerId: unknown, binding: unknown): Promise<StripeSubscriptionObservation> {
    const b = record(binding), c = this.#catalog;
    const customerId = field(b,'customerId'), subscriptionId = field(b,'subscriptionId');
    if (!isUuid(ownerId) || field(b,'ownerId') !== ownerId || field(b,'accountId') !== c.accountId
      || field(b,'liveMode') !== false || !stripeId(customerId,'cus') || !stripeId(subscriptionId,'sub')) return fail();
    const catalog = await this.loadCatalog();
    const s = record(await this.#read('/v1/subscriptions/'+subscriptionId));
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
      const i = record(await this.#read('/v1/invoices/'+invoiceId));
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
