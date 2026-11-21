import {createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {isRecord, isUuid} from '../data/guards.js';
import type {ProviderGrant} from './types.js';

export function opaqueToken(): string { return randomBytes(32).toString('base64url'); }
export function digest(value: string): string { return createHash('sha256').update(value).digest('base64url'); }
export function equalToken(left: string, right: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/u.test(left) && /^[A-Za-z0-9_-]{43}$/u.test(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function seal(value: unknown, key: string, context: string): string {
  const plain = Buffer.from(JSON.stringify(value), 'utf8');
  const bytes = Buffer.from(key, 'base64url');
  if (bytes.length !== 32 || plain.length > 48_000 || context.length > 512) throw new Error('CONNECTION_DATA_INVALID');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', bytes, nonce);
  cipher.setAAD(Buffer.from(`dlkt-info-connections:v1:${context}`));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function unseal(value: string, key: string, context: string): unknown {
  try {
    if (value.length > 65_536 || !/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/u.test(value)) throw new Error();
    const parts = value.split('.');
    const nonce = Buffer.from(parts[1] ?? '', 'base64url'), tag = Buffer.from(parts[2] ?? '', 'base64url'), encrypted = Buffer.from(parts[3] ?? '', 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), nonce);
    decipher.setAAD(Buffer.from(`dlkt-info-connections:v1:${context}`)); decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as unknown;
  } catch { throw new Error('CONNECTION_DATA_INVALID'); }
}

const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
const instant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value));
export function parseGrant(value: unknown): ProviderGrant {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'accessToken,accountId,accountLabel,expiresAt,refreshToken,resources,scopes' || !text(value.accountId, 256) || !text(value.accountLabel, 200) || !text(value.accessToken, 8192) || (value.refreshToken !== null && !text(value.refreshToken, 8192)) || !instant(value.expiresAt) || !Array.isArray(value.scopes) || value.scopes.length > 32 || !value.scopes.every(item => text(item, 256)) || !Array.isArray(value.resources) || value.resources.length > 20) throw new Error('CONNECTION_DATA_INVALID');
  const resources = value.resources.map((item: unknown) => {
    if (!isRecord(item) || Object.keys(item).sort().join(',') !== 'accessToken,id,label' || !text(item.id, 256) || !text(item.label, 200) || (item.accessToken !== null && !text(item.accessToken, 8192))) throw new Error('CONNECTION_DATA_INVALID');
    return Object.freeze({id: item.id, label: item.label, accessToken: item.accessToken});
  });
  return Object.freeze({accountId: value.accountId, accountLabel: value.accountLabel, accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt, scopes: Object.freeze(value.scopes as string[]), resources: Object.freeze(resources)});
}

/** Called only after Supabase verifies this access token; bind to its stable session, not a rotating JWT. */
export function verifiedSessionHash(accessToken: string, ownerId: string): string {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload || payload.length > 16_384) throw new Error();
    const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!isRecord(value) || value.sub !== ownerId || value.role !== 'authenticated' || !isUuid(value.session_id)) throw new Error();
    return digest(`${ownerId}:${value.session_id}`);
  } catch { throw new Error('CONNECTION_SESSION_INVALID'); }
}
