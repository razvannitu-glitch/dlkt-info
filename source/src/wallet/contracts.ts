import {isRecord, isUuid} from '../data/guards.js';
import {DAILY_TOPICS, validTime} from '../daily/contracts.js';
import type {Topic} from '../iceo/contracts.js';
import {LOCAL_NEEDS, type LocalNeed} from '../personal/contracts.js';
import {getWalletProviders, type WalletProvider} from './providers.js';

export const WALLET_VERSION = 'dlkt-info-wallet-1' as const;
export const WALLET_PROFILE_VERSION = 'dlkt-info-wallet-profile-2' as const;
const LEGACY_PROFILE_VERSION = 'dlkt-info-wallet-profile-1';
export const WALLET_PROFILE_MEMORY_KEY = 'wallet-profile-v1';
export const WALLET_PROFILE_MAX_BYTES = 16_384;

/** Preferences only. No provider credentials, connection claims, or scheduled jobs. */
export interface WalletProfile {
  readonly displayName: string | null;
  readonly locale: string;
  readonly timezone: string;
  readonly briefingTime: string;
  readonly interests: readonly Topic[];
  readonly personalPriority: 'personal-first' | 'balanced';
  readonly cityId: string | null;
  readonly localNeeds: readonly LocalNeed[];
}

export interface WalletProfileState {
  readonly version: typeof WALLET_PROFILE_VERSION;
  readonly revision: string;
  readonly updatedAt: string;
  readonly value: WalletProfile;
}

export interface WalletActivity {
  readonly state: 'unavailable' | 'not-connected';
  readonly events: readonly [];
  readonly checkedAt: null;
}

export interface WalletSnapshot {
  readonly version: typeof WALLET_VERSION;
  readonly account: 'unavailable' | 'signed-out' | 'signed-in';
  readonly profile: WalletProfileState | null;
  readonly providers: readonly WalletProvider[];
  readonly activity: WalletActivity;
}

const CONTROL = /[\p{Cc}\p{Cf}]/u;
const EMPTY_EVENTS: readonly [] = Object.freeze([]);
const LEGACY_PROFILE_KEYS = ['displayName', 'locale', 'timezone', 'briefingTime', 'interests', 'personalPriority'] as const;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

export function isWalletRevision(value: unknown): value is string {
  return isUuid(value) && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function withinLimit(value: unknown): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > WALLET_PROFILE_MAX_BYTES) {
    throw new Error('WALLET_PROFILE_TOO_LARGE');
  }
}

function profileLocale(value: unknown): string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 35 || CONTROL.test(value)) {
    throw new Error('WALLET_PROFILE_INVALID');
  }
  try {
    const locale = new Intl.Locale(value).toString();
    if (locale.length > 35) throw new Error('WALLET_PROFILE_INVALID');
    return locale;
  } catch {
    throw new Error('WALLET_PROFILE_INVALID');
  }
}

function profileTimezone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80
      || !/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/u.test(value)) {
    throw new Error('WALLET_PROFILE_INVALID');
  }
  try {
    return new Intl.DateTimeFormat('en', {timeZone: value}).resolvedOptions().timeZone;
  } catch {
    throw new Error('WALLET_PROFILE_INVALID');
  }
}

function preferenceSet<T extends string>(value: unknown, known: readonly T[]): value is readonly T[] {
  if (!Array.isArray(value) || value.length > known.length || Object.keys(value).length !== value.length) return false;
  const entries: readonly unknown[] = value;
  for (let index = 0; index < entries.length; index++) {
    if (!Object.hasOwn(entries, index) || !known.some(item => item === entries[index])) return false;
  }
  return new Set(entries).size === entries.length;
}

/** V2 writes require all eight fields; cached v1 clients must reload before saving. */
export function parseWalletProfile(value: unknown): WalletProfile {
  if (!isRecord(value) || !exactKeys(value, [
    ...LEGACY_PROFILE_KEYS, 'cityId', 'localNeeds',
  ]) || (value.displayName !== null && (typeof value.displayName !== 'string'
    || value.displayName.length > 80 || CONTROL.test(value.displayName)))
    || typeof value.briefingTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value.briefingTime)
    || !preferenceSet(value.interests, DAILY_TOPICS)
    || (value.personalPriority !== 'personal-first' && value.personalPriority !== 'balanced')
    || (value.cityId !== null && (typeof value.cityId !== 'string' || !/^\d{1,12}$/u.test(value.cityId)))
    || !preferenceSet(value.localNeeds, LOCAL_NEEDS)) {
    throw new Error('WALLET_PROFILE_INVALID');
  }
  const profile: WalletProfile = Object.freeze({
    displayName: value.displayName,
    locale: profileLocale(value.locale),
    timezone: profileTimezone(value.timezone),
    briefingTime: value.briefingTime,
    interests: Object.freeze([...value.interests]),
    personalPriority: value.personalPriority,
    cityId: value.cityId,
    localNeeds: Object.freeze([...value.localNeeds]),
  });
  withinLimit(profile);
  return profile;
}

export function parseWalletProfileState(value: unknown): WalletProfileState {
  if (!isRecord(value) || !exactKeys(value, ['version', 'revision', 'updatedAt', 'value'])
    || (value.version !== WALLET_PROFILE_VERSION && value.version !== LEGACY_PROFILE_VERSION) || !isWalletRevision(value.revision)
    || !validTime(value.updatedAt)) {
    throw new Error('WALLET_PROFILE_STATE_INVALID');
  }
  // Legacy values are accepted only inside their explicit v1 envelope; reading never writes or infers preferences.
  let profileInput: unknown = value.value;
  if (value.version === LEGACY_PROFILE_VERSION) {
    if (!isRecord(profileInput) || !exactKeys(profileInput, LEGACY_PROFILE_KEYS)) throw new Error('WALLET_PROFILE_INVALID');
    profileInput = {...profileInput, cityId: null, localNeeds: []};
  }
  const state: WalletProfileState = Object.freeze({
    version: WALLET_PROFILE_VERSION,
    revision: value.revision,
    updatedAt: value.updatedAt,
    value: parseWalletProfile(profileInput),
  });
  withinLimit(state);
  return state;
}

function textList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 24
    && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 1_000 && !CONTROL.test(item));
}

function parseProvider(value: unknown): WalletProvider {
  if (!isRecord(value) || !exactKeys(value, [
    'id', 'name', 'accountType', 'status', 'capabilities', 'limitations', 'connectionAvailable',
  ]) || typeof value.id !== 'string' || typeof value.name !== 'string' || value.name.length < 1
    || value.name.length > 100 || CONTROL.test(value.name)
    || typeof value.accountType !== 'string' || value.accountType.length < 1
    || value.accountType.length > 300 || CONTROL.test(value.accountType)
    || value.status !== 'unavailable' || value.connectionAvailable !== false
    || !textList(value.capabilities) || !textList(value.limitations)) {
    throw new Error('WALLET_SNAPSHOT_INVALID');
  }
  const known = getWalletProviders().find(provider => provider.id === value.id);
  if (!known) throw new Error('WALLET_SNAPSHOT_INVALID');
  return Object.freeze({
    id: known.id,
    name: value.name,
    accountType: value.accountType,
    status: 'unavailable',
    capabilities: Object.freeze([...value.capabilities]),
    limitations: Object.freeze([...value.limitations]),
    connectionAvailable: false,
  });
}

export function walletSnapshot(account: WalletSnapshot['account'], profile: WalletProfileState | null = null): WalletSnapshot {
  if (account !== 'signed-in' && profile !== null) throw new Error('WALLET_SNAPSHOT_INVALID');
  return Object.freeze({
    version: WALLET_VERSION,
    account,
    profile,
    providers: getWalletProviders(),
    activity: Object.freeze({
      state: account === 'signed-in' ? 'not-connected' : 'unavailable',
      events: EMPTY_EVENTS,
      checkedAt: null,
    }),
  });
}

export function parseWalletSnapshot(value: unknown): WalletSnapshot {
  if (!isRecord(value) || !exactKeys(value, ['version', 'account', 'profile', 'providers', 'activity'])
    || value.version !== WALLET_VERSION
    || (value.account !== 'unavailable' && value.account !== 'signed-out' && value.account !== 'signed-in')
    || !Array.isArray(value.providers) || value.providers.length !== getWalletProviders().length
    || !isRecord(value.activity) || !exactKeys(value.activity, ['state', 'events', 'checkedAt'])
    || value.activity.state !== (value.account === 'signed-in' ? 'not-connected' : 'unavailable')
    || !Array.isArray(value.activity.events) || value.activity.events.length !== 0
    || value.activity.checkedAt !== null || (value.account !== 'signed-in' && value.profile !== null)) {
    throw new Error('WALLET_SNAPSHOT_INVALID');
  }
  const providers = value.providers.map(parseProvider);
  if (new Set(providers.map(provider => provider.id)).size !== providers.length) {
    throw new Error('WALLET_SNAPSHOT_INVALID');
  }
  return Object.freeze({
    version: WALLET_VERSION,
    account: value.account,
    profile: value.profile === null ? null : parseWalletProfileState(value.profile),
    providers: Object.freeze(providers),
    activity: Object.freeze({
      state: value.account === 'signed-in' ? 'not-connected' : 'unavailable',
      events: EMPTY_EVENTS,
      checkedAt: null,
    }),
  });
}
