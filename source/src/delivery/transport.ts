import type { ActionType } from '../actions/contracts.js';
import {
  DEFAULT_DELIVERY_POLICY,
  assertDeliveryPolicy,
} from './policy.js';
import {
  DELIVERY_CONTROL_MARKER,
  DELIVERY_CONTROL_QUERY_KEYS,
  type DeliveryMode,
  type DeliveryPolicy,
  type DeliverySearchParseResult,
} from './contracts.js';

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const MODE_KEY: Readonly<Record<string, ActionType>> = Object.freeze({
  dw: 'watch-change', dr: 'remind-next-briefing', dc: 'compare-next', dx: 'mark-resolved', di: 'ignore-pattern',
});
const TYPE_KEY: Readonly<Record<ActionType, string>> = Object.freeze({
  'watch-change': 'dw', 'remind-next-briefing': 'dr', 'compare-next': 'dc', 'mark-resolved': 'dx', 'ignore-pattern': 'di',
});
const FOREIGN_KEYS = new Set([
  'bridge', 'topics', 'entities', 'tz', 'at', 'max', 'min', 'actionable',
  'trust', 'level', 'conflicts', 'authority', 'sources', 'age', 'officialHigh',
  'actions', 'watch', 'remind', 'compare', 'resolved', 'ignore', '_vercel_share',
]);

function one(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  if (values.length > 1) throw new Error('DELIVERY_QUERY_DUPLICATE');
  return values[0] ?? null;
}

function parseInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/u.test(value)) throw new Error('DELIVERY_QUERY_INTEGER');
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error('DELIVERY_QUERY_RANGE');
  return parsed;
}

function parseMode(value: string | null, fallback: DeliveryMode): DeliveryMode {
  if (value === null) return fallback;
  if (!['alert', 'briefing', 'off'].includes(value)) throw new Error('DELIVERY_QUERY_MODE');
  return value as DeliveryMode;
}

export function parseDeliverySearch(search: string): DeliverySearchParseResult {
  if (typeof search !== 'string' || search.length > 2_048) return Object.freeze({ state: 'invalid', policy: DEFAULT_DELIVERY_POLICY, reason: 'DELIVERY_QUERY_LENGTH' });
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  const hasDelivery = keys.some((key) => DELIVERY_CONTROL_QUERY_KEYS.includes(key as typeof DELIVERY_CONTROL_QUERY_KEYS[number]));
  if (!hasDelivery) {
    const timezone = params.get('tz') ?? DEFAULT_DELIVERY_POLICY.timezone;
    const policy = Object.freeze({ ...DEFAULT_DELIVERY_POLICY, timezone, actionModes: DEFAULT_DELIVERY_POLICY.actionModes });
    try { assertDeliveryPolicy(policy); return Object.freeze({ state: 'absent', policy }); } catch { return Object.freeze({ state: 'absent', policy: DEFAULT_DELIVERY_POLICY }); }
  }
  if (keys.some((key) => !DELIVERY_CONTROL_QUERY_KEYS.includes(key as typeof DELIVERY_CONTROL_QUERY_KEYS[number]) && !FOREIGN_KEYS.has(key))) {
    return Object.freeze({ state: 'invalid', policy: DEFAULT_DELIVERY_POLICY, reason: 'DELIVERY_QUERY_UNKNOWN' });
  }
  try {
    if (one(params, 'delivery') !== DELIVERY_CONTROL_MARKER) throw new Error('DELIVERY_QUERY_MARKER');
    const actionModes = { ...DEFAULT_DELIVERY_POLICY.actionModes };
    for (const [key, type] of Object.entries(MODE_KEY)) actionModes[type] = parseMode(one(params, key), actionModes[type]);
    const timezone = one(params, 'tz') ?? DEFAULT_DELIVERY_POLICY.timezone;
    const quietStart = one(params, 'qs') ?? DEFAULT_DELIVERY_POLICY.quietStart;
    const quietEnd = one(params, 'qe') ?? DEFAULT_DELIVERY_POLICY.quietEnd;
    if (!TIME.test(quietStart) || !TIME.test(quietEnd)) throw new Error('DELIVERY_QUERY_TIME');
    const policy: DeliveryPolicy = Object.freeze({
      timezone,
      channel: (one(params, 'channel') ?? DEFAULT_DELIVERY_POLICY.channel) as DeliveryPolicy['channel'],
      actionModes: Object.freeze(actionModes),
      quietHoursEnabled: (one(params, 'qh') ?? (DEFAULT_DELIVERY_POLICY.quietHoursEnabled ? 'on' : 'off')) === 'on',
      quietStart,
      quietEnd,
      dailyAlertCap: parseInteger(one(params, 'cap'), DEFAULT_DELIVERY_POLICY.dailyAlertCap, 1, 12),
      minimumGapMinutes: parseInteger(one(params, 'gap'), DEFAULT_DELIVERY_POLICY.minimumGapMinutes, 15, 720),
      quietHoursBypass: (one(params, 'bypass') ?? DEFAULT_DELIVERY_POLICY.quietHoursBypass) as DeliveryPolicy['quietHoursBypass'],
      conflictMode: (one(params, 'conflict') ?? DEFAULT_DELIVERY_POLICY.conflictMode) as DeliveryPolicy['conflictMode'],
      minimumAlertTrust: (one(params, 'trustFloor') ?? DEFAULT_DELIVERY_POLICY.minimumAlertTrust) as DeliveryPolicy['minimumAlertTrust'],
      minimumAlertMateriality: (one(params, 'materialityFloor') ?? DEFAULT_DELIVERY_POLICY.minimumAlertMateriality) as DeliveryPolicy['minimumAlertMateriality'],
      requireOfficialForHighImpact: true,
    });
    if (one(params, 'qh') !== null && !['on', 'off'].includes(one(params, 'qh') ?? '')) throw new Error('DELIVERY_QUERY_QUIET');
    assertDeliveryPolicy(policy);
    return Object.freeze({ state: 'valid', policy });
  } catch (error) {
    return Object.freeze({ state: 'invalid', policy: DEFAULT_DELIVERY_POLICY, reason: error instanceof Error ? error.message : 'DELIVERY_QUERY_INVALID' });
  }
}

export function buildDeliverySearch(policy: DeliveryPolicy, existingSearch = ''): string {
  assertDeliveryPolicy(policy);
  const params = new URLSearchParams(existingSearch);
  for (const key of DELIVERY_CONTROL_QUERY_KEYS) params.delete(key);
  params.set('delivery', DELIVERY_CONTROL_MARKER);
  for (const [type, key] of Object.entries(TYPE_KEY) as [ActionType, string][]) params.set(key, policy.actionModes[type]);
  params.set('qh', policy.quietHoursEnabled ? 'on' : 'off');
  params.set('qs', policy.quietStart);
  params.set('qe', policy.quietEnd);
  params.set('cap', String(policy.dailyAlertCap));
  params.set('gap', String(policy.minimumGapMinutes));
  params.set('bypass', policy.quietHoursBypass);
  params.set('conflict', policy.conflictMode);
  params.set('trustFloor', policy.minimumAlertTrust);
  params.set('materialityFloor', policy.minimumAlertMateriality);
  params.set('channel', policy.channel);
  if (!params.has('tz')) params.set('tz', policy.timezone);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function buildDeliveryUrl(policy: DeliveryPolicy, existingSearch = '', route = '/delivery'): string {
  return `${route}${buildDeliverySearch(policy, existingSearch)}`;
}
