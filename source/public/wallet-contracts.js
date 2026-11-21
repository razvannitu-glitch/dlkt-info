import { isRecord, isUuid } from './data-guards.js';
import { DAILY_TOPICS, validTime } from './daily-contracts.js';
import { getWalletProviders } from './wallet-providers.js';
export const WALLET_VERSION = 'dlkt-info-wallet-1';
export const WALLET_PROFILE_VERSION = 'dlkt-info-wallet-profile-1';
export const WALLET_PROFILE_MEMORY_KEY = 'wallet-profile-v1';
export const WALLET_PROFILE_MAX_BYTES = 16_384;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const EMPTY_EVENTS = Object.freeze([]);
function exactKeys(value, expected) {
    const keys = Object.keys(value);
    return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
export function isWalletRevision(value) {
    return isUuid(value) && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}
function withinLimit(value) {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > WALLET_PROFILE_MAX_BYTES) {
        throw new Error('WALLET_PROFILE_TOO_LARGE');
    }
}
function profileLocale(value) {
    if (typeof value !== 'string' || value.length < 2 || value.length > 35 || CONTROL.test(value)) {
        throw new Error('WALLET_PROFILE_INVALID');
    }
    try {
        const locale = new Intl.Locale(value).toString();
        if (locale.length > 35)
            throw new Error('WALLET_PROFILE_INVALID');
        return locale;
    }
    catch {
        throw new Error('WALLET_PROFILE_INVALID');
    }
}
function profileTimezone(value) {
    if (typeof value !== 'string' || value.length > 80
        || !/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/u.test(value)) {
        throw new Error('WALLET_PROFILE_INVALID');
    }
    try {
        return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
    }
    catch {
        throw new Error('WALLET_PROFILE_INVALID');
    }
}
function isTopic(value) {
    return typeof value === 'string' && DAILY_TOPICS.some(topic => topic === value);
}
export function parseWalletProfile(value) {
    if (!isRecord(value) || !exactKeys(value, [
        'displayName', 'locale', 'timezone', 'briefingTime', 'interests', 'personalPriority',
    ]) || (value.displayName !== null && (typeof value.displayName !== 'string'
        || value.displayName.length > 80 || CONTROL.test(value.displayName)))
        || typeof value.briefingTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value.briefingTime)
        || !Array.isArray(value.interests) || value.interests.length > DAILY_TOPICS.length
        || !value.interests.every(isTopic) || new Set(value.interests).size !== value.interests.length
        || (value.personalPriority !== 'personal-first' && value.personalPriority !== 'balanced')) {
        throw new Error('WALLET_PROFILE_INVALID');
    }
    const profile = Object.freeze({
        displayName: value.displayName,
        locale: profileLocale(value.locale),
        timezone: profileTimezone(value.timezone),
        briefingTime: value.briefingTime,
        interests: Object.freeze([...value.interests]),
        personalPriority: value.personalPriority,
    });
    withinLimit(profile);
    return profile;
}
export function parseWalletProfileState(value) {
    if (!isRecord(value) || !exactKeys(value, ['version', 'revision', 'updatedAt', 'value'])
        || value.version !== WALLET_PROFILE_VERSION || !isWalletRevision(value.revision)
        || !validTime(value.updatedAt)) {
        throw new Error('WALLET_PROFILE_STATE_INVALID');
    }
    const state = Object.freeze({
        version: WALLET_PROFILE_VERSION,
        revision: value.revision,
        updatedAt: value.updatedAt,
        value: parseWalletProfile(value.value),
    });
    withinLimit(state);
    return state;
}
function textList(value) {
    return Array.isArray(value) && value.length <= 24
        && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 1_000 && !CONTROL.test(item));
}
function parseProvider(value) {
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
    if (!known)
        throw new Error('WALLET_SNAPSHOT_INVALID');
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
export function walletSnapshot(account, profile = null) {
    if (account !== 'signed-in' && profile !== null)
        throw new Error('WALLET_SNAPSHOT_INVALID');
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
export function parseWalletSnapshot(value) {
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
