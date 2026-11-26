import {field, record, stripeId} from './records.js';

export const PREMIUM_PLANS = Object.freeze({
  monthly: Object.freeze({currency: 'eur', unitAmount: 699, interval: 'month', lookupKey: 'dlkt_info_premium_monthly_v1'}),
  annual: Object.freeze({currency: 'eur', unitAmount: 6900, interval: 'year', lookupKey: 'dlkt_info_premium_annual_v1'}),
} as const);
export type PremiumPlan = keyof typeof PREMIUM_PLANS;
export type TaxBehavior = 'inclusive' | 'exclusive';

export interface PremiumCatalog {
  readonly accountId: string;
  readonly liveMode: boolean;
  readonly productId: string;
  readonly monthlyPriceId: string;
  readonly annualPriceId: string;
  readonly taxCode: string;
  readonly taxBehavior: TaxBehavior;
}

const verified = new WeakSet<PremiumCatalog>();
const invalid = (): never => { throw new Error('PREMIUM_CATALOG_INVALID'); };

function matchesPrice(raw: unknown, plan: PremiumPlan, priceId: string, catalog: PremiumCatalog): boolean {
  const value = record(raw), recurring = record(field(value, 'recurring')), terms = PREMIUM_PLANS[plan];
  return field(value, 'object') === 'price' && field(value, 'id') === priceId
    && field(value, 'active') === true && field(value, 'livemode') === catalog.liveMode
    && field(value, 'product') === catalog.productId && field(value, 'type') === 'recurring'
    && field(value, 'currency') === terms.currency && field(value, 'unit_amount') === terms.unitAmount
    && field(value, 'billing_scheme') === 'per_unit' && field(value, 'lookup_key') === terms.lookupKey
    && field(value, 'tax_behavior') === catalog.taxBehavior && field(value, 'transform_quantity') === null
    && field(value, 'custom_unit_amount') === null
    && field(recurring, 'interval') === terms.interval && field(recurring, 'interval_count') === 1
    && field(recurring, 'usage_type') === 'licensed';
}

/**
 * Validates an explicitly selected server-side catalog against fresh, decoded Stripe GET responses.
 * verifiedAccountId must come from the same authenticated Stripe client, not a request or metadata.
 * No default fiscal code, tax behavior, Stripe ID or live mode is inferred.
 * This function does not authenticate Stripe responses or enable Checkout.
 */
export function verifyPremiumCatalog(configuration: unknown, verifiedAccountId: unknown, product: unknown,
  monthly: unknown, annual: unknown): PremiumCatalog {
  try {
    const input = record(configuration);
    const accountId = field(input, 'accountId'), liveMode = field(input, 'liveMode'), productId = field(input, 'productId');
    const monthlyPriceId = field(input, 'monthlyPriceId'), annualPriceId = field(input, 'annualPriceId');
    const taxCode = field(input, 'taxCode'), taxBehavior = field(input, 'taxBehavior');
    if (!stripeId(accountId, 'acct') || accountId !== verifiedAccountId || typeof liveMode !== 'boolean'
      || !stripeId(productId, 'prod') || !stripeId(monthlyPriceId, 'price') || !stripeId(annualPriceId, 'price')
      || monthlyPriceId === annualPriceId || typeof taxCode !== 'string' || !/^txcd_[0-9]{8}$/u.test(taxCode)
      || (taxBehavior !== 'inclusive' && taxBehavior !== 'exclusive')) return invalid();
    const catalog: PremiumCatalog = Object.freeze({accountId, liveMode, productId, monthlyPriceId, annualPriceId, taxCode, taxBehavior});
    const item = record(product);
    if (field(item, 'object') !== 'product' || field(item, 'id') !== productId
      || field(item, 'active') !== true || field(item, 'livemode') !== liveMode
      || field(item, 'tax_code') !== taxCode || !matchesPrice(monthly, 'monthly', monthlyPriceId, catalog)
      || !matchesPrice(annual, 'annual', annualPriceId, catalog)) return invalid();
    verified.add(catalog);
    return catalog;
  } catch { return invalid(); }
}

export function isVerifiedPremiumCatalog(value: unknown): value is PremiumCatalog {
  return typeof value === 'object' && value !== null && verified.has(value as PremiumCatalog);
}
export function premiumPlanForPrice(catalog: PremiumCatalog, priceId: unknown): PremiumPlan | null {
  if (!isVerifiedPremiumCatalog(catalog)) return null;
  return priceId === catalog.monthlyPriceId ? 'monthly' : priceId === catalog.annualPriceId ? 'annual' : null;
}
