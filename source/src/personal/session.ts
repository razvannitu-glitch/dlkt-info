import {isRecord, isUuid} from '../data/guards.js';

export type PersonalSession = {readonly status: 'signed-in'; readonly userId: string}
  | {readonly status: 'signed-out' | 'unavailable'; readonly userId: null};

/** Reduce the existing identity receipt to its owner. Never retain the email. */
export function parsePersonalSession(value: unknown): PersonalSession {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'authenticated,blocker,configured,enabled,user,version'
    || value.version !== 'dlkt-info-identity-1' || typeof value.configured !== 'boolean'
    || typeof value.enabled !== 'boolean' || typeof value.authenticated !== 'boolean'
    || (value.blocker !== null && typeof value.blocker !== 'string')) throw new Error('PERSONAL_SESSION_INVALID');
  if (!value.enabled) {
    if (value.authenticated || value.user !== null) throw new Error('PERSONAL_SESSION_INVALID');
    return {status: 'unavailable', userId: null};
  }
  if (!value.configured || value.blocker !== null) throw new Error('PERSONAL_SESSION_INVALID');
  if (!value.authenticated) {
    if (value.user !== null) throw new Error('PERSONAL_SESSION_INVALID');
    return {status: 'signed-out', userId: null};
  }
  if (!isRecord(value.user) || Object.keys(value.user).sort().join(',') !== 'email,id'
    || !isUuid(value.user.id) || typeof value.user.email !== 'string' || value.user.email.length > 254
    || /[\u0000-\u001f\u007f]/u.test(value.user.email)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.user.email)) throw new Error('PERSONAL_SESSION_INVALID');
  return {status: 'signed-in', userId: value.user.id};
}
