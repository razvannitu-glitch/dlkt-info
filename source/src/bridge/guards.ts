import { parseCompanionPreferences, type CompanionPreferences } from '../companion/index.js';
import { TRUST_CONTROL_QUERY_KEYS } from '../trust/contracts.js';
import { ACTION_CONTROL_QUERY_KEYS } from '../actions/contracts.js';
import {
  COMPANION_BRIDGE_MARKER,
  COMPANION_BRIDGE_QUERY_KEYS,
  COMPANION_BRIDGE_ROUTE,
  COMPANION_BRIDGE_VERSION,
  type CompanionBridgeDefinition,
  type CompanionBridgeParseResult,
} from './contracts.js';

const DELIVERY_QUERY_KEYS = Object.freeze(['delivery', 'dw', 'dr', 'dc', 'dx', 'di', 'qh', 'qs', 'qe', 'cap', 'gap', 'bypass', 'conflict', 'trustFloor', 'materialityFloor', 'channel'] as const);
const ALLOWED_EXTRA_QUERY_KEYS = Object.freeze([...TRUST_CONTROL_QUERY_KEYS, ...ACTION_CONTROL_QUERY_KEYS, ...DELIVERY_QUERY_KEYS, '_vercel_share'] as const);

function one(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] ?? null : null;
}

function optionalOne(params: URLSearchParams, key: string): string | null | undefined {
  const values = params.getAll(key);
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] ?? null : null;
}

function definition(preferences: CompanionPreferences): CompanionBridgeDefinition {
  return Object.freeze({ ...preferences, bridgeVersion: COMPANION_BRIDGE_VERSION });
}

export function buildCompanionBridgeSearch(preferences: unknown): string {
  const parsed = parseCompanionPreferences(preferences);
  const params = new URLSearchParams();
  params.set('bridge', COMPANION_BRIDGE_MARKER);
  params.set('topics', parsed.topics.join(','));
  if (parsed.entities.length) params.set('entities', parsed.entities.join('|'));
  params.set('tz', parsed.timezone);
  params.set('at', parsed.deliveryLocalTime);
  params.set('max', String(parsed.maxCards));
  params.set('min', parsed.minMateriality);
  params.set('actionable', parsed.onlyActionable ? '1' : '0');
  return `?${params.toString()}`;
}

export function buildCompanionBridgeUrl(preferences: unknown): string {
  return `${COMPANION_BRIDGE_ROUTE}${buildCompanionBridgeSearch(preferences)}`;
}

export function parseCompanionBridgeSearch(search: string): CompanionBridgeParseResult {
  if (typeof search !== 'string' || search.length > 32_768) {
    return Object.freeze({ state: 'invalid', definition: null, reason: 'SEARCH_INVALID' });
  }
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (!params.has('bridge')) return Object.freeze({ state: 'absent', definition: null });

  const allowed = new Set<string>([...COMPANION_BRIDGE_QUERY_KEYS, ...ALLOWED_EXTRA_QUERY_KEYS]);
  for (const key of params.keys()) {
    if (!allowed.has(key)) return Object.freeze({ state: 'invalid', definition: null, reason: 'UNKNOWN_PARAMETER' });
  }
  if (one(params, 'bridge') !== COMPANION_BRIDGE_MARKER) {
    return Object.freeze({ state: 'invalid', definition: null, reason: 'MARKER_INVALID' });
  }

  const topics = one(params, 'topics');
  const entities = optionalOne(params, 'entities');
  const timezone = one(params, 'tz');
  const deliveryLocalTime = one(params, 'at');
  const maximum = one(params, 'max');
  const minimum = one(params, 'min');
  const actionable = one(params, 'actionable');
  if (topics === null || entities === null || timezone === null || deliveryLocalTime === null || maximum === null
      || minimum === null || actionable === null || !/^(?:0|1)$/u.test(actionable)
      || !/^[1-9]\d*$/u.test(maximum) || !Number.isSafeInteger(Number(maximum)) || Number(maximum) > 2_147_483_647) {
    return Object.freeze({ state: 'invalid', definition: null, reason: 'PARAMETER_INVALID' });
  }

  try {
    return Object.freeze({
      state: 'valid',
      definition: definition(parseCompanionPreferences({
        topics: topics.split(','),
        entities: entities ? entities.split('|') : [],
        timezone,
        deliveryLocalTime,
        maxCards: Number(maximum),
        minMateriality: minimum,
        onlyActionable: actionable === '1',
      })),
    });
  } catch {
    return Object.freeze({ state: 'invalid', definition: null, reason: 'DEFINITION_INVALID' });
  }
}
