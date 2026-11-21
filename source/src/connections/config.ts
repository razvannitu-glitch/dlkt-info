import type {Environment} from '../account/http.js';
import {isUuid} from '../data/guards.js';
import type {WalletProviderId} from '../wallet/providers.js';
import {connectionCallbackPath, type ProviderConfiguration} from './types.js';

export const PROVIDER_IDS: readonly WalletProviderId[] = Object.freeze(['gmail', 'outlook', 'instagram', 'facebook-pages']);
const PREFIX: Readonly<Record<WalletProviderId, string>> = Object.freeze({gmail: 'GMAIL', outlook: 'OUTLOOK', instagram: 'INSTAGRAM', 'facebook-pages': 'FACEBOOK_PAGES'});
const credential = (value: string | undefined): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\s\u0000-\u001f\u007f]/u.test(value);

export function tokenKey(environment: Environment): string | null {
  const key = environment.DLKT_INFO_CONNECTIONS_TOKEN_KEY;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(key)) return null;
  const bytes = Buffer.from(key, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === key ? key : null;
}

/** Bind OAuth cookies and registered redirect URIs to one explicitly configured origin. */
export function connectionOrigin(environment: Environment, servedHost: string): string | null {
  const configured = environment.DLKT_INFO_CONNECTIONS_ORIGIN;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const allowed = new Set(['www.dlkt.ee', 'info.dlkt.ee']);
    if (environment.VERCEL_URL && /^[a-z0-9.-]+\.vercel\.app$/u.test(environment.VERCEL_URL)) allowed.add(environment.VERCEL_URL);
    if (url.protocol !== 'https:' || url.origin !== configured || !allowed.has(url.hostname) || url.hostname !== servedHost || url.username || url.password || url.port || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export function providerConfiguration(environment: Environment, providerId: WalletProviderId, origin: string): ProviderConfiguration | null {
  const prefix = `DLKT_INFO_${PREFIX[providerId]}_`;
  const clientId = environment[`${prefix}CLIENT_ID`];
  const clientSecret = environment[`${prefix}CLIENT_SECRET`];
  if (!credential(clientId) || !credential(clientSecret)) return null;
  const graphVersion = providerId === 'instagram' || providerId === 'facebook-pages' ? environment.DLKT_INFO_META_GRAPH_VERSION : null;
  if (graphVersion !== null && (typeof graphVersion !== 'string' || !/^v\d{1,2}\.\d{1,2}$/u.test(graphVersion))) return null;
  return Object.freeze({providerId, clientId, clientSecret, redirectUri: `${origin}${connectionCallbackPath(providerId)}`, graphVersion: graphVersion ?? null});
}

/** Testing access is explicit and owner-scoped; public readiness is a separate release decision. */
export function providerEnabled(environment: Environment, providerId: WalletProviderId, ownerId: string): boolean {
  const prefix = `DLKT_INFO_${PREFIX[providerId]}_`;
  if (environment[`${prefix}ENABLED`] !== '1') return false;
  if (environment[`${prefix}PUBLIC_READY`] === '1') return true;
  const value = environment.DLKT_INFO_CONNECTION_TEST_OWNER_IDS ?? '';
  if (value.length > 4096) return false;
  const owners = value.split(',').filter(Boolean);
  return owners.length <= 50 && owners.every(isUuid) && owners.includes(ownerId);
}
