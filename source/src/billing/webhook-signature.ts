import {createHmac, timingSafeEqual} from 'node:crypto';
import {field, record, stripeId, unixSeconds} from './records.js';
import {STRIPE_BILLING_API_VERSION} from './stripe-reader.js';

const MAX_BODY_BYTES = 512 * 1024;
const MAX_SIGNATURE_BYTES = 8192;
const TOLERANCE = 300;
const eventRoutes = Object.freeze({
  'checkout.session.completed': ['checkout.session','cs_test_'],
  'checkout.session.async_payment_succeeded': ['checkout.session','cs_test_'],
  'checkout.session.async_payment_failed': ['checkout.session','cs_test_'],
  'checkout.session.expired': ['checkout.session','cs_test_'],
  'customer.subscription.created': ['subscription','sub_'],
  'customer.subscription.updated': ['subscription','sub_'],
  'customer.subscription.deleted': ['subscription','sub_'],
  'customer.subscription.paused': ['subscription','sub_'],
  'customer.subscription.resumed': ['subscription','sub_'],
  'invoice.paid': ['invoice','in_'],
  'invoice.payment_failed': ['invoice','in_'],
  'charge.refunded': ['charge','ch_'],
  'charge.dispute.created': ['dispute','dp_'],
  'radar.early_fraud_warning.created': ['radar.early_fraud_warning','issfr_'],
} as const);
type RoutedEventType = keyof typeof eventRoutes;
export type VerifiedStripeNotice =
  | Readonly<{kind:'ignored';eventId:string;created:number}>
  | Readonly<{kind:'reconcile';eventId:string;created:number;type:RoutedEventType;objectId:string}>;
const fail = (): never => { throw new Error('STRIPE_WEBHOOK_REJECTED'); };
const eventIdValid = (v:unknown):v is string => typeof v === 'string' && /^evt_[A-Za-z0-9]{1,251}$/u.test(v);

/** Signature verification of an exact raw body for a dedicated sandbox-only, direct-account endpoint.
 * The signing secret must be configured by the server for this specific endpoint and never derived
 * from the incoming header. No payment status, metadata, or entitlement is trusted from the payload.
 * The caller still needs a durable event ledger, transactional reconciliation and risk resolution.
 * Old event.created values are allowed on retries; the signed delivery timestamp controls freshness.
 */
export function verifySandboxStripeNotice(body:unknown,signature:unknown,secret:unknown,expectedAccount:unknown,now:unknown):VerifiedStripeNotice {
  try {
    if (!Buffer.isBuffer(body) || body.length === 0 || body.length > MAX_BODY_BYTES
      || typeof signature !== 'string' || signature.length === 0 || signature.length > MAX_SIGNATURE_BYTES
      || typeof secret !== 'string' || !/^whsec_[A-Za-z0-9]{1,500}$/u.test(secret)
      || !stripeId(expectedAccount,'acct') || !unixSeconds(now)) return fail();
    let timestamp: string | null = null;
    const candidates: string[] = [];
    for (const part of signature.split(',')) {
      const pair = part.trim(), split = pair.indexOf('=');
      if (split <= 0) return fail();
      const key = pair.slice(0,split), value = pair.slice(split+1);
      if (key === 't') {
        if (timestamp !== null || !/^\d{1,12}$/u.test(value) || !unixSeconds(Number(value)) || String(Number(value)) !== value) return fail();
        timestamp = value;
      } else if (key === 'v1') {
        if (!/^[a-f0-9]{64}$/u.test(value) || candidates.length >= 8) return fail();
        candidates.push(value);
      }
      // Unknown signature schemes and debugging fields are ignored; never use a secret from the header.
    }
    if (timestamp === null || candidates.length === 0 || Math.abs(now-Number(timestamp)) > TOLERANCE) return fail();
    const expected = createHmac('sha256',secret).update(timestamp+'.','utf8').update(body).digest();
    let valid = false;
    for (const candidate of candidates) valid = timingSafeEqual(expected,Buffer.from(candidate,'hex')) || valid;
    if (!valid) return fail();
    const e = record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)) as unknown);
    const id = field(e,'id'), created = field(e,'created'), type = field(e,'type'), account = field(e,'account');
    const context = field(e,'context');
    if (field(e,'object') !== 'event' || !eventIdValid(id) || !unixSeconds(created) || created > now + TOLERANCE
      || field(e,'livemode') !== false || field(e,'api_version') !== STRIPE_BILLING_API_VERSION
      || (account !== undefined && account !== null && account !== expectedAccount)
      || (context !== undefined && context !== null) || typeof type !== 'string' || type.length > 128) return fail();
    if (!Object.hasOwn(eventRoutes,type)) return Object.freeze({kind:'ignored',eventId:id,created});
    const routeType = type as RoutedEventType, [object,prefix] = eventRoutes[routeType];
    const payload = record(field(record(field(e,'data')),'object')), objectId = field(payload,'id');
    const resourceMode = field(payload,'livemode');
    if (field(payload,'object') !== object || typeof objectId !== 'string' || objectId.length > 255
      || !objectId.startsWith(prefix) || !/^[A-Za-z0-9]+$/u.test(objectId.slice(prefix.length))
      || (resourceMode !== undefined && resourceMode !== false)) return fail();
    return Object.freeze({kind:'reconcile',eventId:id,created,type:routeType,objectId});
  } catch { return fail(); }
}
