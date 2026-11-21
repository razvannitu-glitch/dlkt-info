import type { ServerResponse } from 'node:http';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  type IdentitySessionTokens,
} from './contracts.js';
import { isAccessToken, isRefreshToken } from './guards.js';

const MAX_COOKIE_HEADER = 16_384;
const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function parseCookies(value: string | string[] | undefined): ReadonlyMap<string, string> {
  const header = Array.isArray(value) ? value.join(';') : (value ?? '');
  if (!header || header.length > MAX_COOKIE_HEADER) return new Map();
  const entries = new Map<string, string>();
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    if (!name || !raw || entries.has(name)) continue;
    try { entries.set(name, decodeURIComponent(raw)); } catch { /* Invalid cookie is ignored. */ }
  }
  return entries;
}

export function readIdentityCookies(value: string | string[] | undefined): {
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
} {
  const cookies = parseCookies(value);
  const access = cookies.get(ACCESS_COOKIE);
  const refresh = cookies.get(REFRESH_COOKIE);
  return Object.freeze({
    accessToken: isAccessToken(access) ? access : null,
    refreshToken: isRefreshToken(refresh) ? refresh : null,
  });
}

function sessionCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function expiredCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}

export function writeIdentityCookies(response: ServerResponse, tokens: IdentitySessionTokens): void {
  const accessMaxAge = Math.max(60, Math.min(3600, tokens.expiresIn - 30));
  response.setHeader('Set-Cookie', [
    sessionCookie(ACCESS_COOKIE, tokens.accessToken, accessMaxAge),
    sessionCookie(REFRESH_COOKIE, tokens.refreshToken, REFRESH_MAX_AGE_SECONDS),
  ]);
}

export function clearIdentityCookies(response: ServerResponse): void {
  response.setHeader('Set-Cookie', [expiredCookie(ACCESS_COOKIE), expiredCookie(REFRESH_COOKIE)]);
}
