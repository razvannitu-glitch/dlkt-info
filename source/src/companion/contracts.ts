import type { Materiality } from '../core/contracts.js';

export const COMPANION_VERSION = 'dlkt-info-companion-1' as const;
export const COMPANION_TOPICS = Object.freeze([
  'technology',
  'business',
  'regulation',
  'opportunities',
  'supply',
] as const);
export const COMPANION_MATERIALITIES = Object.freeze([
  'low',
  'medium',
  'high',
  'critical',
] as const satisfies readonly Materiality[]);
export const COMPANION_ENTITY_MAX_LENGTH = 80 as const;

export type CompanionTopic = (typeof COMPANION_TOPICS)[number];

export interface CompanionPreferences {
  readonly topics: readonly CompanionTopic[];
  readonly entities: readonly string[];
  readonly timezone: string;
  readonly deliveryLocalTime: string;
  readonly maxCards: number;
  readonly minMateriality: Materiality;
  readonly onlyActionable: boolean;
}

export const DEFAULT_COMPANION_PREFERENCES: CompanionPreferences = Object.freeze({
  topics: COMPANION_TOPICS,
  entities: Object.freeze([]),
  timezone: 'Europe/Bucharest',
  deliveryLocalTime: '08:00',
  maxCards: 5,
  minMateriality: 'low',
  onlyActionable: false,
});
