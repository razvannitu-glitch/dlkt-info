import { isUuid } from '../data/guards.js';
import type { IdentitySessionTokens, IdentityUser } from './contracts.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const OTP = /^\d{6,10}$/u;
const ACCESS_TOKEN = /^[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,2048}$/u;
// Supabase Auth also issues 12-character opaque refresh tokens.
const REFRESH_TOKEN = /^[A-Za-z0-9._~-]{12,4096}$/u;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function normalizeIdentityEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('DLKT_INFO_EMAIL_INVALID');
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 254 || !EMAIL.test(normalized)
      || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error('DLKT_INFO_EMAIL_INVALID');
  }
  return normalized;
}

export function readIdentityOtp(value: unknown): string {
  if (typeof value !== 'string') throw new Error('DLKT_INFO_OTP_INVALID');
  const normalized = value.replace(/[\s-]+/gu, '');
  if (!OTP.test(normalized)) throw new Error('DLKT_INFO_OTP_INVALID');
  return normalized;
}

export function readIdentityLocale(value: unknown): string {
  // Preserve bounded BCP47 script/region variants; malformed metadata retains the existing English fallback.
  if (typeof value !== 'string' || value.length > 80 || !LOCALE.test(value)) return 'en';
  try { new Intl.Locale(value); return value; } catch { return 'en'; }
}

export function readIdentityTimezone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return value;
  } catch {
    return 'UTC';
  }
}

export function isAccessToken(value: unknown): value is string {
  return typeof value === 'string' && ACCESS_TOKEN.test(value);
}

export function isRefreshToken(value: unknown): value is string {
  return typeof value === 'string' && REFRESH_TOKEN.test(value);
}

export function readIdentityUser(value: unknown): IdentityUser {
  if (!isRecord(value) || !isUuid(value.id) || typeof value.email !== 'string') {
    throw new Error('DLKT_INFO_IDENTITY_USER_INVALID');
  }
  return Object.freeze({ id: value.id, email: normalizeIdentityEmail(value.email) });
}

export function readIdentitySessionTokens(value: unknown): IdentitySessionTokens {
  if (!isRecord(value) || !isAccessToken(value.access_token) || !isRefreshToken(value.refresh_token)
      || !Number.isInteger(value.expires_in) || Number(value.expires_in) < 60 || Number(value.expires_in) > 604800) {
    throw new Error('DLKT_INFO_IDENTITY_SESSION_INVALID');
  }
  return Object.freeze({
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresIn: Number(value.expires_in),
    user: readIdentityUser(value.user),
  });
}
