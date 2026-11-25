import {object, validCity, type LocalCard} from '../local/contracts.js';
import {selectHomeLocal} from './home-local.js';

export const PERSONAL_LOCAL_VERSION = 'dlkt-personal-local-1' as const;
const NEEDS = ['weather','mobility','utilities','culture','administration','local-reporting'] as const;
export type LocalNeed = typeof NEEDS[number];
export interface PersonalLocalProfile {
  readonly version: typeof PERSONAL_LOCAL_VERSION;
  readonly cityId: string;
  readonly needs: readonly LocalNeed[];
}
function isNeed(value: unknown): value is LocalNeed {
  return NEEDS.some(need => need === value);
}
/** Explicitly confirmed preferences only; no address, inferred interests or entitlement. */
export function parsePersonalLocalProfile(value: unknown): PersonalLocalProfile {
  if (!object(value) || Object.keys(value).length !== 3 ||
      !Object.hasOwn(value, 'version') || !Object.hasOwn(value, 'cityId') || !Object.hasOwn(value, 'needs') ||
      value.version !== PERSONAL_LOCAL_VERSION ||
      typeof value.cityId !== 'string' || !/^\d{1,12}$/u.test(value.cityId) ||
      !Array.isArray(value.needs) || value.needs.length > NEEDS.length ||
      !Array.from(value.needs).every(isNeed) || new Set(value.needs).size !== value.needs.length) {
    throw new Error('PERSONAL_LOCAL_PROFILE_INVALID');
  }
  return Object.freeze({version: PERSONAL_LOCAL_VERSION, cityId: value.cityId,
    needs: Object.freeze([...value.needs])});
}
const KIND_NEED: Readonly<Record<LocalCard['kind'], LocalNeed>> = {
  forecast:'weather', transport:'mobility', 'transport-notice':'mobility',
  'utility-notice':'utilities', event:'culture', 'municipal-news':'administration',
  'local-news':'local-reporting',
};
export interface PersonalLocalMatch {
  readonly card: LocalCard;
  readonly reason: 'confirmed-city-and-declared-need';
  readonly need: LocalNeed;
  readonly applicability: 'city-context-only';
}
/**
 * Applies declared needs to the existing homepage selection and its display caps;
 * this is not an enumeration of every relevant local match.
 * Reuses source, geography and kind-specific time gates: a valid forecast may
 * start at the next full hour. Never claims that a household is affected.
 */
export function selectPersonalLocal(profileInput: unknown, snapshot: unknown,
  city: unknown, now: number): readonly PersonalLocalMatch[] {
  const profile = parsePersonalLocalProfile(profileInput);
  if (!validCity(city) || city.id !== profile.cityId || !Number.isFinite(now)) return [];
  const selected = selectHomeLocal(snapshot, city, now);
  return Object.freeze(selected.cards.filter(card =>
    profile.needs.includes(KIND_NEED[card.kind])
  ).map((card): PersonalLocalMatch => Object.freeze({
    card, reason:'confirmed-city-and-declared-need', need:KIND_NEED[card.kind],
    applicability:'city-context-only',
  })));
}
