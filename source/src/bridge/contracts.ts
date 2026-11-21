import type { CompanionPreferences } from '../companion/contracts.js';

export const COMPANION_BRIDGE_VERSION = 'dlkt-info-companion-bridge-1' as const;
export const COMPANION_BRIDGE_ROUTE = '/today' as const;
export const COMPANION_BRIDGE_MARKER = 'companion-v1' as const;
export const COMPANION_BRIDGE_QUERY_KEYS = Object.freeze([
  'bridge', 'topics', 'entities', 'tz', 'at', 'max', 'min', 'actionable',
] as const);

export interface CompanionBridgeDefinition extends CompanionPreferences {
  readonly bridgeVersion: typeof COMPANION_BRIDGE_VERSION;
}

export type CompanionBridgeParseResult =
  | Readonly<{ state: 'absent'; definition: null }>
  | Readonly<{ state: 'invalid'; definition: null; reason: string }>
  | Readonly<{ state: 'valid'; definition: CompanionBridgeDefinition }>;

export const companionBridgeContract = Object.freeze({
  version: COMPANION_BRIDGE_VERSION,
  route: COMPANION_BRIDGE_ROUTE,
  marker: COMPANION_BRIDGE_MARKER,
  transport: 'strict-query',
  entityCapacity: 'payload-bounded',
  cardBudget: 'user-defined-positive-integer',
  browserStorage: false,
  unknownParameters: 'reject',
  invalidState: 'safe-preview',
  zeroResultState: 'explicit',
} as const);
