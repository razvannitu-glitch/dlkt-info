import { isInstant, isUuid } from '../data/guards.js';
import { parseTrustPolicy } from '../trust/index.js';
import {
  PERSISTENCE_ADAPTER_VERSION,
  type CompanionPersistenceProjection,
} from './contracts.js';

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/u;
const TOPICS = new Set(['technology', 'business', 'regulation', 'opportunities', 'supply']);
const MATERIALITIES = new Set(['low', 'medium', 'high', 'critical']);
const PLANS = new Set(['free', 'pro', 'business', 'internal']);
const ONBOARDING = new Set(['new', 'configured', 'active', 'paused']);
const BRIEFING_STATES = new Set(['draft', 'active', 'paused', 'archived']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const validTimezone = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
};
const safeText = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum
  && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);

export function readCompanionPersistenceProjection(value: unknown): CompanionPersistenceProjection {
  if (!isRecord(value) || !exactKeys(value, ['version', 'profile', 'briefing', 'trustPolicy', 'rule'])
      || value.version !== PERSISTENCE_ADAPTER_VERSION || !isRecord(value.profile)
      || !exactKeys(value.profile, ['locale', 'timezone', 'plan', 'onboardingState'])
      || typeof value.profile.locale !== 'string' || !LOCALE.test(value.profile.locale)
      || !validTimezone(value.profile.timezone)
      || typeof value.profile.plan !== 'string' || !PLANS.has(value.profile.plan)
      || typeof value.profile.onboardingState !== 'string' || !ONBOARDING.has(value.profile.onboardingState)) {
    throw new Error('DLKT_INFO_PERSISTENCE_PROJECTION_INVALID');
  }

  let briefing: CompanionPersistenceProjection['briefing'] = null;
  if (value.briefing !== null) {
    if (!isRecord(value.briefing)
        || !exactKeys(value.briefing, ['id', 'name', 'timezone', 'deliveryLocalTime', 'weekdays', 'maxCards', 'status', 'version', 'nextDeliveryAt'])
        || !isUuid(value.briefing.id) || !safeText(value.briefing.name, 80)
        || !validTimezone(value.briefing.timezone)
        || typeof value.briefing.deliveryLocalTime !== 'string' || !TIME.test(value.briefing.deliveryLocalTime)
        || !Array.isArray(value.briefing.weekdays) || value.briefing.weekdays.length < 1 || value.briefing.weekdays.length > 7
        || value.briefing.weekdays.some((day) => !Number.isInteger(day) || Number(day) < 1 || Number(day) > 7)
        || new Set(value.briefing.weekdays).size !== value.briefing.weekdays.length
        || !Number.isSafeInteger(value.briefing.maxCards) || Number(value.briefing.maxCards) < 1 || Number(value.briefing.maxCards) > 2_147_483_647
        || typeof value.briefing.status !== 'string' || !BRIEFING_STATES.has(value.briefing.status)
        || !Number.isInteger(value.briefing.version) || Number(value.briefing.version) < 1
        || !(value.briefing.nextDeliveryAt === null || isInstant(value.briefing.nextDeliveryAt))) {
      throw new Error('DLKT_INFO_PERSISTENCE_PROJECTION_INVALID');
    }
    briefing = Object.freeze({
      id: value.briefing.id,
      name: value.briefing.name,
      timezone: value.briefing.timezone,
      deliveryLocalTime: value.briefing.deliveryLocalTime,
      weekdays: Object.freeze([...value.briefing.weekdays] as number[]),
      maxCards: Number(value.briefing.maxCards),
      status: value.briefing.status as NonNullable<CompanionPersistenceProjection['briefing']>['status'],
      version: Number(value.briefing.version),
      nextDeliveryAt: value.briefing.nextDeliveryAt,
    });
  }

  let trustPolicy: CompanionPersistenceProjection['trustPolicy'] = null;
  if (value.trustPolicy !== null) {
    try { trustPolicy = parseTrustPolicy(value.trustPolicy); }
    catch { throw new Error('DLKT_INFO_PERSISTENCE_PROJECTION_INVALID'); }
  }

  let rule: CompanionPersistenceProjection['rule'] = null;
  if (value.rule !== null) {
    if (!isRecord(value.rule) || !exactKeys(value.rule, ['topics', 'entities', 'minMateriality', 'onlyActionable'])
        || !Array.isArray(value.rule.topics) || value.rule.topics.length < 1 || value.rule.topics.length > TOPICS.size
        || value.rule.topics.some((topic) => typeof topic !== 'string' || !TOPICS.has(topic))
        || new Set(value.rule.topics).size !== value.rule.topics.length
        || !Array.isArray(value.rule.entities)
        || value.rule.entities.reduce((total, entity) => total + (typeof entity === 'string' ? entity.length : 0), 0) > 131_072
        || value.rule.entities.some((entity) => !safeText(entity, 80) || entity.includes('|'))
        || new Set(value.rule.entities.map((entity) => entity.toLocaleLowerCase('en-US'))).size !== value.rule.entities.length
        || typeof value.rule.minMateriality !== 'string' || !MATERIALITIES.has(value.rule.minMateriality)
        || typeof value.rule.onlyActionable !== 'boolean') {
      throw new Error('DLKT_INFO_PERSISTENCE_PROJECTION_INVALID');
    }
    rule = Object.freeze({
      topics: Object.freeze([...value.rule.topics] as string[]),
      entities: Object.freeze([...value.rule.entities] as string[]),
      minMateriality: value.rule.minMateriality as NonNullable<CompanionPersistenceProjection['rule']>['minMateriality'],
      onlyActionable: value.rule.onlyActionable,
    });
  }

  if ((briefing === null) !== (rule === null) || (briefing === null) !== (trustPolicy === null)) {
    throw new Error('DLKT_INFO_PERSISTENCE_PROJECTION_INVALID');
  }

  return Object.freeze({
    version: PERSISTENCE_ADAPTER_VERSION,
    profile: Object.freeze({
      locale: value.profile.locale,
      timezone: value.profile.timezone,
      plan: value.profile.plan as CompanionPersistenceProjection['profile']['plan'],
      onboardingState: value.profile.onboardingState as CompanionPersistenceProjection['profile']['onboardingState'],
    }),
    briefing,
    trustPolicy,
    rule,
  });
}
