import {isRecord, isUuid} from '../data/guards.js';
import {isWalletProviderId} from './providers.js';
import type {WalletProviderId} from './providers.js';
import {isWalletInstant, personalEventKey, personalThreadKey, validatePersonalEvent} from './events.js';
import type {PersonalEvent} from './events.js';

export type PersonalSourceState = 'success' | 'partial' | 'failed' | 'unavailable' | 'not-connected';
export type PersonalSourceReason = 'limit' | 'rate-limited' | 'authorization' | 'network' | 'timeout' | 'invalid-response' | 'upstream' | 'not-configured';
export interface PersonalSourceResult {
  readonly ownerId: string;
  readonly connectionId: string;
  readonly providerId: WalletProviderId;
  readonly state: PersonalSourceState;
  readonly checkedAt: string | null;
  readonly events: readonly PersonalEvent[];
  readonly reason: PersonalSourceReason | null;
}
export interface PersonalDailyItem {
  readonly event: PersonalEvent;
  readonly relatedEventCount: number;
  /** An explicit ordering rule, never an AI claim that an event is objectively important. */
  readonly priorityReason: 'source-important' | 'unread-message' | 'direct-interaction' | 'recent-activity';
}
export interface PersonalDailySource {
  readonly connectionId: string;
  readonly providerId: WalletProviderId;
  readonly state: PersonalSourceState | 'stale';
  readonly checkedAt: string | null;
  readonly reason: PersonalSourceReason | null;
  readonly eventCount: number;
}
export interface PersonalDailyEdition {
  readonly ownerId: string;
  readonly generatedAt: string;
  readonly state: 'ready' | 'partial' | 'unavailable' | 'not-connected';
  readonly items: readonly PersonalDailyItem[];
  readonly sources: readonly PersonalDailySource[];
  readonly totalEventCount: number;
  readonly hasMore: boolean;
  /** True only when every supplied source was checked successfully and returned no daily events. */
  readonly confirmedEmpty: boolean;
}
export interface PersonalDailyOptions {
  readonly ownerId: string;
  readonly now: string;
  readonly sources: readonly PersonalSourceResult[];
  readonly maxItems?: number;
}
export const PERSONAL_DAILY_SOURCE_FRESHNESS_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
const SOURCE_KEYS = ['ownerId', 'connectionId', 'providerId', 'state', 'checkedAt', 'events', 'reason'];
const STATES: readonly string[] = ['success', 'partial', 'failed', 'unavailable', 'not-connected'];
const REASONS: readonly string[] = ['limit', 'rate-limited', 'authorization', 'network', 'timeout', 'invalid-response', 'upstream', 'not-configured'];

function invalid(): never { throw new Error('WALLET_DAILY_INVALID'); }

function validateSource(input: unknown, ownerId: string, now: string): PersonalSourceResult {
  if (!isRecord(input) || Object.keys(input).length !== SOURCE_KEYS.length || !Object.keys(input).every(key => SOURCE_KEYS.includes(key)) || input.ownerId !== ownerId || !isUuid(input.connectionId) || !isWalletProviderId(input.providerId) || typeof input.state !== 'string' || !STATES.includes(input.state) || !(input.reason === null || (typeof input.reason === 'string' && REASONS.includes(input.reason))) || !Array.isArray(input.events) || input.events.length > 100) invalid();
  const state = input.state as PersonalSourceState;
  const checkedAt = input.checkedAt;
  if (state === 'not-connected' || state === 'unavailable') {
    if (checkedAt !== null || input.events.length || (state === 'not-connected' ? input.reason !== null : input.reason !== 'not-configured')) invalid();
  } else {
    if (!isWalletInstant(checkedAt) || Date.parse(checkedAt) > Date.parse(now) + 60_000) invalid();
    if (state === 'success' && input.reason !== null) invalid();
    if (state !== 'success' && (input.reason === null || input.reason === 'not-configured')) invalid();
    if (state === 'failed' && input.events.length) invalid();
  }
  const connectionId = input.connectionId, providerId = input.providerId;
  const events = input.events.map((entry: unknown) => validatePersonalEvent(entry, {ownerId, connectionId, providerId, now}));
  if (checkedAt !== null && events.some(event => Date.parse(event.observedAt) > Date.parse(checkedAt as string) + 60_000)) invalid();
  return {ownerId, connectionId: input.connectionId, providerId: input.providerId, state, checkedAt: checkedAt as string | null, events, reason: input.reason as PersonalSourceReason | null};
}

function priority(event: PersonalEvent): {rank: number; reason: PersonalDailyItem['priorityReason']} {
  if (event.importance === 'source-important') return {rank: 0, reason: 'source-important'};
  if (event.unread === true && (event.kind === 'email.received' || event.kind === 'message.received')) return {rank: 1, reason: 'unread-message'};
  if (event.kind !== 'metrics.updated') return {rank: 2, reason: 'direct-interaction'};
  return {rank: 3, reason: 'recent-activity'};
}

/** Finite, private projection. Incomplete/stale/failed sources never become a zero-activity claim. */
export function buildPersonalDailyEdition(options: PersonalDailyOptions): PersonalDailyEdition {
  const maxItems = options.maxItems ?? 8;
  if (!isUuid(options.ownerId) || !isWalletInstant(options.now) || !Array.isArray(options.sources) || options.sources.length > 16 || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 20) invalid();
  const sourceKeys = new Set<string>();
  const seen = new Map<string, PersonalEvent>();
  const summaries: PersonalDailySource[] = [];
  const now = Date.parse(options.now);
  for (const input of options.sources) {
    const source = validateSource(input, options.ownerId, options.now);
    const sourceKey = JSON.stringify([source.ownerId, source.connectionId]);
    if (sourceKeys.has(sourceKey)) invalid();
    sourceKeys.add(sourceKey);
    const stale = source.checkedAt !== null && now - Date.parse(source.checkedAt) > PERSONAL_DAILY_SOURCE_FRESHNESS_MS;
    const localKeys = new Set<string>();
    const events = stale ? [] : source.events.filter(event => Date.parse(event.occurredAt) >= now - DAY_MS);
    for (const event of events) {
      const key = personalEventKey(event);
      localKeys.add(key);
      const previous = seen.get(key);
      // A later provider observation updates state; it does not create another event.
      if (!previous || Date.parse(event.observedAt) > Date.parse(previous.observedAt)) seen.set(key, event);
      else if (event.observedAt === previous.observedAt && JSON.stringify(event) !== JSON.stringify(previous)) invalid();
    }
    summaries.push(Object.freeze({connectionId: source.connectionId, providerId: source.providerId, state: stale ? 'stale' : source.state, checkedAt: source.checkedAt, reason: source.reason, eventCount: localKeys.size}));
  }
  const groups = new Map<string, {event: PersonalEvent; count: number}>();
  for (const event of seen.values()) {
    const key = personalThreadKey(event), group = groups.get(key);
    if (!group) groups.set(key, {event, count: 1});
    else {
      group.count += 1;
      const eventPriority = priority(event).rank, groupPriority = priority(group.event).rank;
      if (eventPriority < groupPriority || (eventPriority === groupPriority && Date.parse(event.occurredAt) > Date.parse(group.event.occurredAt))) group.event = event;
    }
  }
  const ordered = [...groups.values()].sort((a, b) => priority(a.event).rank - priority(b.event).rank || Date.parse(b.event.occurredAt) - Date.parse(a.event.occurredAt) || personalEventKey(a.event).localeCompare(personalEventKey(b.event)));
  const useful = summaries.some(source => source.state === 'success' || source.state === 'partial');
  const allSucceeded = summaries.length > 0 && summaries.every(source => source.state === 'success');
  const allNotConnected = summaries.every(source => source.state === 'not-connected');
  const state = allSucceeded ? 'ready' : allNotConnected ? 'not-connected' : useful ? 'partial' : 'unavailable';
  return Object.freeze({ownerId: options.ownerId, generatedAt: options.now, state, items: Object.freeze(ordered.slice(0, maxItems).map(group => Object.freeze({event: group.event, relatedEventCount: group.count, priorityReason: priority(group.event).reason}))), sources: Object.freeze(summaries), totalEventCount: seen.size, hasMore: ordered.length > maxItems || summaries.some(source => source.state === 'partial'), confirmedEmpty: allSucceeded && seen.size === 0});
}
