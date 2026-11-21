import {isRecord, isUuid} from '../data/guards.js';
import {isWalletProviderId} from './providers.js';
import type {WalletProviderId} from './providers.js';

export const PERSONAL_EVENT_KINDS = Object.freeze(['email.received', 'message.received', 'comment.received', 'mention.received', 'share.received', 'metrics.updated'] as const);
export type PersonalEventKind = (typeof PERSONAL_EVENT_KINDS)[number];
export type PersonalMetricName = 'views' | 'shares' | 'comments' | 'reactions';
export interface PersonalMetric { readonly name: PersonalMetricName; readonly count: number }
export interface PersonalActor {
  readonly providerId: WalletProviderId;
  readonly providerActorId: string;
  readonly displayName: string | null;
  /** An email From header is a sender claim, not a verified identity. */
  readonly provenance: 'provider-identity' | 'sender-header';
}
export interface PersonalEvent {
  readonly ownerId: string;
  readonly connectionId: string;
  readonly providerId: WalletProviderId;
  readonly providerEventId: string;
  readonly providerThreadId: string | null;
  readonly kind: PersonalEventKind;
  readonly occurredAt: string;
  readonly observedAt: string;
  readonly actor: PersonalActor | null;
  /** Untrusted source text. Consumers must render text, never HTML or instructions. */
  readonly title: string;
  readonly excerpt: string | null;
  readonly sourceUrl: string;
  readonly sourceUrlOrigin: 'provider-supplied' | 'provider-generated';
  readonly unread: boolean | null;
  readonly importance: 'normal' | 'source-important';
  readonly metrics: readonly PersonalMetric[];
  readonly visibility: 'private';
}
export interface PersonalEventContext {
  readonly ownerId: string;
  readonly connectionId: string;
  readonly providerId: WalletProviderId;
  readonly now: string;
}

export type WalletEventErrorCode = 'WALLET_EVENT_INVALID' | 'WALLET_EVENT_OWNER_MISMATCH' | 'WALLET_EVENT_CONNECTION_MISMATCH' | 'WALLET_EVENT_TIME_INVALID' | 'WALLET_EVENT_SOURCE_INVALID';
export class WalletEventError extends Error {
  constructor(readonly code: WalletEventErrorCode) { super(code); this.name = 'WalletEventError'; }
}

const DAY = 86_400_000;
const CLOCK_SKEW_MS = 60_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:@+=/-]{0,255}$/u;
const ACTOR_ID = /^[^\s\u0000-\u001f\u007f<>"\\]{1,320}$/u;
const KEYS = ['ownerId', 'connectionId', 'providerId', 'providerEventId', 'providerThreadId', 'kind', 'occurredAt', 'observedAt', 'actor', 'title', 'excerpt', 'sourceUrl', 'sourceUrlOrigin', 'unread', 'importance', 'metrics', 'visibility'] as const;
const METRIC_NAMES: readonly string[] = ['views', 'shares', 'comments', 'reactions'];

export function isWalletInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function isWalletMailbox(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 254 || value !== value.trim()) return false;
  const at = value.lastIndexOf('@');
  if (at < 1 || at > 64) return false;
  const local = value.slice(0, at), domain = value.slice(at + 1), labels = domain.split('.');
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(local) && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') && labels.length >= 2 && labels.every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u.test(label)) && /^[A-Za-z]{2,63}$/u.test(labels.at(-1) ?? '');
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function textWithin(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Only reviewed display destinations. This function never fetches the URL. */
export function isPersonalSourceUrl(providerId: WalletProviderId, value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_048 || /[^\x21-\x7e]|\\|%(?![0-9a-f]{2})|%(?:0[0-9a-f]|1[0-9a-f]|7f|25)/iu.test(value)) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href !== value) return false;
  const params = [...url.searchParams.keys()];
  if (new Set(params).size !== params.length) return false;
  if (providerId === 'gmail') {
    return url.hostname === 'mail.google.com' && url.pathname === '/mail/' && params.length === 1 && params[0] === 'authuser' && isWalletMailbox(url.searchParams.get('authuser')) && /^#all\/[a-f0-9]{1,64}$/u.test(url.hash);
  }
  if (providerId === 'outlook') {
    if (!['outlook.office.com', 'outlook.live.com', 'outlook.office365.com'].includes(url.hostname) || url.hash) return false;
    if (!url.search && /^\/mail\/(?:\d+\/)?deeplink\/read\/[A-Za-z0-9_%=+-]{1,1024}$/u.test(url.pathname)) return true;
    // Microsoft Graph's documented message.webLink uses this exact OWA shape.
    return url.pathname === '/owa/' && params.sort().join(',') === 'ItemID,exvsurl,viewmodel'
      && /^[A-Za-z0-9_+/=-]{1,1024}$/u.test(url.searchParams.get('ItemID') ?? '')
      && url.searchParams.get('exvsurl') === '1' && url.searchParams.get('viewmodel') === 'ReadMessageItem';
  }
  if (providerId === 'instagram') {
    return url.hostname === 'www.instagram.com' && !url.search && !url.hash && (/^\/(?:p|reel|tv)\/[A-Za-z0-9_-]{1,128}\/$/u.test(url.pathname) || /^\/direct\/t\/\d{1,64}\/$/u.test(url.pathname));
  }
  if (providerId === 'facebook-pages') {
    return url.hostname === 'www.facebook.com' && !url.hash && /^\/[A-Za-z0-9.]{1,128}\/(?:posts|videos)\/[A-Za-z0-9]{1,128}\/?$/u.test(url.pathname) && params.every(key => ['comment_id', 'reply_comment_id'].includes(key) && /^\d{1,64}$/u.test(url.searchParams.get(key) ?? ''));
  }
  return false;
}

function parseActor(value: unknown, providerId: WalletProviderId): PersonalActor | null {
  if (value === null) return null;
  if (!isRecord(value) || !exactKeys(value, ['providerId', 'providerActorId', 'displayName', 'provenance']) || value.providerId !== providerId || typeof value.providerActorId !== 'string' || !ACTOR_ID.test(value.providerActorId) || !(value.displayName === null || textWithin(value.displayName, 160)) || !['provider-identity', 'sender-header'].includes(String(value.provenance))) throw new WalletEventError('WALLET_EVENT_INVALID');
  if (value.provenance === 'sender-header' && (!['gmail', 'outlook'].includes(providerId) || !value.providerActorId.startsWith('email:') || !isWalletMailbox(value.providerActorId.slice(6)))) throw new WalletEventError('WALLET_EVENT_INVALID');
  return Object.freeze({providerId, providerActorId: value.providerActorId, displayName: value.displayName, provenance: value.provenance as PersonalActor['provenance']});
}

/** Fail closed at ingestion: no extra fields, raw payload, token or public visibility. */
export function validatePersonalEvent(value: unknown, context: PersonalEventContext): PersonalEvent {
  if (!isUuid(context.ownerId) || !isUuid(context.connectionId) || !isWalletProviderId(context.providerId) || !isWalletInstant(context.now)) throw new WalletEventError('WALLET_EVENT_INVALID');
  if (!isRecord(value) || !exactKeys(value, KEYS)) throw new WalletEventError('WALLET_EVENT_INVALID');
  if (value.ownerId !== context.ownerId) throw new WalletEventError('WALLET_EVENT_OWNER_MISMATCH');
  if (value.connectionId !== context.connectionId || value.providerId !== context.providerId) throw new WalletEventError('WALLET_EVENT_CONNECTION_MISMATCH');
  if (typeof value.providerEventId !== 'string' || !ID.test(value.providerEventId) || !(value.providerThreadId === null || (typeof value.providerThreadId === 'string' && ID.test(value.providerThreadId))) || typeof value.kind !== 'string' || !(PERSONAL_EVENT_KINDS as readonly string[]).includes(value.kind) || !textWithin(value.title, 240) || !(value.excerpt === null || textWithin(value.excerpt, 500)) || !(value.unread === null || typeof value.unread === 'boolean') || !['normal', 'source-important'].includes(String(value.importance)) || value.visibility !== 'private' || !['provider-supplied', 'provider-generated'].includes(String(value.sourceUrlOrigin))) throw new WalletEventError('WALLET_EVENT_INVALID');
  if (!isWalletInstant(value.occurredAt) || !isWalletInstant(value.observedAt)) throw new WalletEventError('WALLET_EVENT_TIME_INVALID');
  const now = Date.parse(context.now), occurred = Date.parse(value.occurredAt), observed = Date.parse(value.observedAt);
  if (occurred > now + CLOCK_SKEW_MS || observed > now + CLOCK_SKEW_MS || occurred > observed + CLOCK_SKEW_MS || occurred < now - 30 * DAY || observed < now - 2 * DAY) throw new WalletEventError('WALLET_EVENT_TIME_INVALID');
  if (!isPersonalSourceUrl(context.providerId, value.sourceUrl)) throw new WalletEventError('WALLET_EVENT_SOURCE_INVALID');
  if (context.providerId === 'gmail' && (value.kind !== 'email.received' || typeof value.providerThreadId !== 'string' || new URL(value.sourceUrl).hash !== `#all/${value.providerThreadId}`)) throw new WalletEventError('WALLET_EVENT_SOURCE_INVALID');
  if (context.providerId === 'outlook' && value.kind !== 'email.received') throw new WalletEventError('WALLET_EVENT_INVALID');
  if (['instagram', 'facebook-pages'].includes(context.providerId) && value.kind === 'email.received') throw new WalletEventError('WALLET_EVENT_INVALID');
  const actor = parseActor(value.actor, context.providerId);
  if (!Array.isArray(value.metrics) || value.metrics.length > 4) throw new WalletEventError('WALLET_EVENT_INVALID');
  const metricNames = new Set<string>();
  const metrics: PersonalMetric[] = value.metrics.map((entry: unknown) => {
    if (!isRecord(entry) || !exactKeys(entry, ['name', 'count']) || typeof entry.name !== 'string' || !METRIC_NAMES.includes(entry.name) || metricNames.has(entry.name) || !Number.isSafeInteger(entry.count) || typeof entry.count !== 'number' || entry.count < 0) throw new WalletEventError('WALLET_EVENT_INVALID');
    metricNames.add(entry.name);
    return Object.freeze({name: entry.name as PersonalMetricName, count: entry.count});
  });
  if (value.kind === 'metrics.updated' ? actor !== null || metrics.length === 0 || value.unread !== null || value.importance !== 'normal' : metrics.length !== 0) throw new WalletEventError('WALLET_EVENT_INVALID');
  if (value.kind === 'share.received' && actor === null) throw new WalletEventError('WALLET_EVENT_INVALID');
  return Object.freeze({ownerId: context.ownerId, connectionId: context.connectionId, providerId: context.providerId, providerEventId: value.providerEventId, providerThreadId: value.providerThreadId, kind: value.kind as PersonalEventKind, occurredAt: value.occurredAt, observedAt: value.observedAt, actor, title: value.title, excerpt: value.excerpt, sourceUrl: value.sourceUrl, sourceUrlOrigin: value.sourceUrlOrigin as PersonalEvent['sourceUrlOrigin'], unread: value.unread, importance: value.importance as PersonalEvent['importance'], metrics: Object.freeze(metrics), visibility: 'private'});
}

/** Tuple encoding prevents cross-owner, cross-account and delimiter collisions. */
export function personalEventKey(event: Pick<PersonalEvent, 'ownerId' | 'connectionId' | 'providerId' | 'providerEventId'>): string {
  return JSON.stringify([event.ownerId, event.connectionId, event.providerId, event.providerEventId]);
}

export function personalThreadKey(event: Pick<PersonalEvent, 'ownerId' | 'connectionId' | 'providerId' | 'providerThreadId' | 'providerEventId'>): string {
  return JSON.stringify([event.ownerId, event.connectionId, event.providerId, event.providerThreadId ?? event.providerEventId]);
}
