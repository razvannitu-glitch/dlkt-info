import {isUuid} from '../data/guards.js';
import {isVerifiedPremiumCatalog, premiumPlanForPrice, type PremiumPlan} from './catalog.js';
import {field, record, stripeId, unixSeconds} from './records.js';

/** Draft fail-closed policy. Not a provider adapter, session verifier or persistence layer. */
export const PREMIUM_EVIDENCE_MAX_AGE_SECONDS = 300;
export type PremiumAccess =
  | Readonly<{state: 'denied'}>
  | Readonly<{state: 'premium'; plan: PremiumPlan; validUntil: number}>;
const DENIED: PremiumAccess = Object.freeze({state: 'denied'});

/**
 * Evaluate only server-owned binding and normalized evidence from a future authenticated
 * Stripe reconciliation adapter. Never pass browser bodies, metadata, redirect state, or
 * an unverified webhook directly. The adapter must establish paid invoice coverage of the
 * exact subscription item and investigate refund/dispute/fraud state before marking it clear.
 * A fresh DB/Stripe check and atomic enforcement are still required at the real access boundary.
 * Current proposal: no trial, grace period, or access on an unknown payment/risk state.
 */
export function evaluatePremiumAccess(ownerId: unknown, expectedLiveMode: unknown, catalog: unknown,
  binding: unknown, evidence: unknown, now: unknown): PremiumAccess {
  try {
    if (!isUuid(ownerId) || typeof expectedLiveMode !== 'boolean' || !unixSeconds(now)
      || !isVerifiedPremiumCatalog(catalog) || catalog.liveMode !== expectedLiveMode) return DENIED;
    const b = record(binding), e = record(evidence), payment = record(field(e, 'payment'));
    const customerId = field(b, 'customerId'), subscriptionId = field(b, 'subscriptionId');
    if (field(b, 'ownerId') !== ownerId || field(b, 'accountId') !== catalog.accountId
      || field(b, 'liveMode') !== expectedLiveMode || !stripeId(customerId, 'cus') || !stripeId(subscriptionId, 'sub')
      || field(e, 'version') !== 'dlkt-info-premium-evidence-1'
      || field(e, 'accountId') !== catalog.accountId || field(e, 'liveMode') !== expectedLiveMode
      || field(e, 'customerId') !== customerId || field(e, 'subscriptionId') !== subscriptionId
      || field(e, 'productId') !== catalog.productId || field(e, 'quantity') !== 1
      || field(e, 'status') !== 'active' || field(e, 'collectionPaused') !== false
      || field(e, 'riskState') !== 'clear') return DENIED;

    const priceId = field(e, 'priceId'), plan = premiumPlanForPrice(catalog, priceId);
    const verifiedAt = field(e, 'verifiedAt'), start = field(e, 'periodStart'), end = field(e, 'periodEnd');
    const cancelAt = field(e, 'cancelAt'), cancelAtPeriodEnd = field(e, 'cancelAtPeriodEnd');
    if (!plan || !unixSeconds(verifiedAt) || verifiedAt > now || now - verifiedAt > PREMIUM_EVIDENCE_MAX_AGE_SECONDS
      || !unixSeconds(start) || !unixSeconds(end) || start > now || end <= now || start > verifiedAt
      || end - start > (plan === 'monthly' ? 32 : 367) * 86400
      || typeof cancelAtPeriodEnd !== 'boolean'
      || (cancelAt !== null && (!unixSeconds(cancelAt) || cancelAt <= now))) return DENIED;

    if (!stripeId(field(payment, 'invoiceId'), 'in') || field(payment, 'state') !== 'paid'
      || field(payment, 'fundsConfirmed') !== true || field(payment, 'currency') !== 'eur'
      || field(payment, 'customerId') !== customerId || field(payment, 'subscriptionId') !== subscriptionId
      || field(payment, 'priceId') !== priceId || field(payment, 'productId') !== catalog.productId
      || field(payment, 'periodStart') !== start || field(payment, 'periodEnd') !== end) return DENIED;

    const until = Math.min(end, verifiedAt + PREMIUM_EVIDENCE_MAX_AGE_SECONDS,
      typeof cancelAt === 'number' ? cancelAt : end);
    return until > now ? Object.freeze({state: 'premium', plan, validUntil: until}) : DENIED;
  } catch { return DENIED; }
}
