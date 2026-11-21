import {
  COMPANION_ENTITY_MAX_LENGTH,
  COMPANION_MATERIALITIES,
  COMPANION_TOPICS,
  type CompanionPreferences,
  type CompanionTopic,
} from './contracts.js';

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const TIMEZONE = /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+$/u;
const ENTITY = /^[\p{L}\p{M}\p{N} .,&+'’()/_:–—-]+$/u;
const CONFIGURATION_TEXT_BUDGET = 131_072;
const DATABASE_INTEGER_MAX = 2_147_483_647;
const ALLOWED_KEYS = Object.freeze([
  'topics',
  'entities',
  'timezone',
  'deliveryLocalTime',
  'maxCards',
  'minMateriality',
  'onlyActionable',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 || !TIMEZONE.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function isTopic(value: unknown): value is CompanionTopic {
  return typeof value === 'string' && (COMPANION_TOPICS as readonly string[]).includes(value);
}

export function normalizeCompanionEntity(value: unknown): string {
  if (typeof value !== 'string') throw new Error('COMPANION_ENTITY_INVALID');
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (normalized.length < 2 || normalized.length > COMPANION_ENTITY_MAX_LENGTH
      || normalized.includes('|') || /[\u0000-\u001f\u007f]/u.test(normalized)
      || !ENTITY.test(normalized)) {
    throw new Error('COMPANION_ENTITY_INVALID');
  }
  return normalized;
}

function normalizeEntities(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new Error('COMPANION_ENTITY_INVALID');
  const normalized = value.map(normalizeCompanionEntity);
  const identities = normalized.map((entry) => entry.toLocaleLowerCase('en-US'));
  if (new Set(identities).size !== identities.length
      || normalized.reduce((total, entry) => total + entry.length, 0) > CONFIGURATION_TEXT_BUDGET) {
    throw new Error('COMPANION_ENTITY_INVALID');
  }
  return Object.freeze(normalized);
}

export function parseCompanionPreferences(value: unknown): CompanionPreferences {
  if (!isRecord(value)) throw new Error('COMPANION_INPUT_INVALID');
  const keys = Object.keys(value);
  if (keys.some((key) => !ALLOWED_KEYS.includes(key))) throw new Error('COMPANION_INPUT_UNKNOWN_FIELD');

  let entities: readonly string[];
  try {
    entities = normalizeEntities(value.entities);
  } catch {
    throw new Error('COMPANION_INPUT_INVALID');
  }

  if (!Array.isArray(value.topics) || value.topics.length < 1 || value.topics.length > COMPANION_TOPICS.length
    || !value.topics.every(isTopic) || new Set(value.topics).size !== value.topics.length
    || !isTimezone(value.timezone)
    || typeof value.deliveryLocalTime !== 'string' || !TIME.test(value.deliveryLocalTime)
    || !Number.isSafeInteger(value.maxCards) || Number(value.maxCards) < 1 || Number(value.maxCards) > DATABASE_INTEGER_MAX
    || typeof value.minMateriality !== 'string'
    || !(COMPANION_MATERIALITIES as readonly string[]).includes(value.minMateriality)
    || typeof value.onlyActionable !== 'boolean') {
    throw new Error('COMPANION_INPUT_INVALID');
  }

  return Object.freeze({
    topics: Object.freeze([...value.topics]),
    entities,
    timezone: value.timezone,
    deliveryLocalTime: value.deliveryLocalTime,
    maxCards: Number(value.maxCards),
    minMateriality: value.minMateriality as CompanionPreferences['minMateriality'],
    onlyActionable: value.onlyActionable,
  });
}
