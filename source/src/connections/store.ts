import {boundedJson} from '../account/http.js';
import {isRecord, isUuid} from '../data/guards.js';
import {isAccessToken} from '../identity/guards.js';
import type {ReadyPersistenceConfiguration} from '../persistence/contracts.js';
import {isWalletProviderId, WALLET_PROVIDER_IDS, type WalletProviderId} from '../wallet/providers.js';
import type {ConnectionStore, PendingAuthorization, StoredConnection} from './types.js';

const MEMORY_TABLE = 'dlkt_info_user_memory';
const MEMORY_COLUMNS = 'owner_id,memory_key,memory_type,state,expires_at';
const CONNECTION_PREFIX = 'wallet-connection:';
const AUTHORIZATION_PREFIX = 'wallet-oauth:';
const HASH = /^[A-Za-z0-9_-]{43}$/u;
const REVISION = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const CONTROL = /[\p{Cc}\p{Cf}]/u;

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d(?::?\d\d)?)$/u.test(value)
      || !Number.isFinite(Date.parse(value))) throw new Error('CONNECTION_INPUT_INVALID');
  return new Date(value).toISOString();
}
function sealed(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length >= 32 && value.length <= maximum && /^[\x21-\x7e]+$/u.test(value);
}
function revision(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !REVISION.test(value)) throw new Error('CONNECTION_REVISION_INVALID');
}
function provider(value: unknown): asserts value is WalletProviderId {
  if (!isWalletProviderId(value)) throw new Error('CONNECTION_PROVIDER_INVALID');
}
function ownerToken(token: unknown, ownerId: string): token is string {
  if (!isAccessToken(token)) return false;
  try {
    const claims: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return isRecord(claims) && claims.role === 'authenticated' && claims.sub === ownerId;
  } catch { return false; }
}
function projectUrl(value: string, projectRef: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === `${projectRef}.supabase.co` && url.port === ''
      && url.username === '' && url.password === '' && (url.pathname === '' || url.pathname === '/') && url.search === '' && url.hash === '';
  } catch { return false; }
}
function connection(value: unknown, ownerId: string): StoredConnection {
  if (!isRecord(value) || !exact(value, ['id', 'ownerId', 'providerId', 'accountLabel', 'status', 'sealedGrant', 'connectedAt', 'lastSyncAt', 'operationExpiresAt', 'revision'])
      || !isUuid(value.id) || value.ownerId !== ownerId || !isWalletProviderId(value.providerId)
      || typeof value.accountLabel !== 'string' || value.accountLabel.length < 1 || value.accountLabel.length > 200 || CONTROL.test(value.accountLabel)
      || (value.status !== 'connected' && value.status !== 'reconnect-required') || !sealed(value.sealedGrant, 65_536)) throw new Error('CONNECTION_INPUT_INVALID');
  revision(value.revision);
  return Object.freeze({id: value.id, ownerId, providerId: value.providerId, accountLabel: value.accountLabel, status: value.status,
    sealedGrant: value.sealedGrant, connectedAt: timestamp(value.connectedAt), lastSyncAt: value.lastSyncAt === null ? null : timestamp(value.lastSyncAt),
    operationExpiresAt: value.operationExpiresAt === null ? null : timestamp(value.operationExpiresAt), revision: value.revision});
}
function pending(value: unknown, ownerId: string): PendingAuthorization {
  if (!isRecord(value) || !exact(value, ['stateHash', 'ownerId', 'sessionHash', 'providerId', 'sealedVerifier', 'expiresAt'])
      || value.ownerId !== ownerId || typeof value.stateHash !== 'string' || !HASH.test(value.stateHash)
      || typeof value.sessionHash !== 'string' || !HASH.test(value.sessionHash)
      || !isWalletProviderId(value.providerId) || !sealed(value.sealedVerifier, 4096)) throw new Error('CONNECTION_AUTHORIZATION_INVALID');
  return Object.freeze({stateHash: value.stateHash, ownerId, sessionHash: value.sessionHash, providerId: value.providerId,
    sealedVerifier: value.sealedVerifier, expiresAt: timestamp(value.expiresAt)});
}
function connectionRow(row: unknown, ownerId: string): StoredConnection {
  if (!isRecord(row) || !exact(row, MEMORY_COLUMNS.split(',')) || row.owner_id !== ownerId || row.memory_type !== 'preference' || row.expires_at !== null) throw new Error('CONNECTION_UPSTREAM_INVALID');
  try {
    const value = connection(row.state, ownerId);
    if (row.memory_key !== CONNECTION_PREFIX + value.providerId) throw new Error('CONNECTION_UPSTREAM_INVALID');
    return value;
  }
  catch { throw new Error('CONNECTION_UPSTREAM_INVALID'); }
}
function authorizationRow(row: unknown, ownerId: string): PendingAuthorization {
  if (!isRecord(row) || !exact(row, MEMORY_COLUMNS.split(',')) || row.owner_id !== ownerId || row.memory_type !== 'preference') throw new Error('CONNECTION_UPSTREAM_INVALID');
  try {
    const value = pending(row.state, ownerId);
    if (row.memory_key !== AUTHORIZATION_PREFIX + value.providerId || timestamp(row.expires_at) !== value.expiresAt) throw new Error('CONNECTION_UPSTREAM_INVALID');
    return value;
  }
  catch { throw new Error('CONNECTION_UPSTREAM_INVALID'); }
}
function toRow(value: StoredConnection): Record<string, unknown> {
  return {owner_id: value.ownerId, memory_key: CONNECTION_PREFIX + value.providerId, memory_type: 'preference', state: value, expires_at: null};
}

/** Reuses the attested private-memory table; opaque grants stay encrypted, with user-token RLS.
 * Four fixed provider keys bound each namespace. New OAuth attempts replace that provider's old attempt.
 * Schema stays unchanged; exact DTO and expiry bounds are enforced here and by the connection service.
 * Construction requires an already provider-verified session.
 */
export class SupabaseConnectionStore implements ConnectionStore {
  constructor(private readonly configuration: ReadyPersistenceConfiguration, private readonly ownerId: string,
    private readonly accessToken: string, private readonly fetchImpl: typeof fetch = fetch) {
    if (!isUuid(ownerId) || !ownerToken(accessToken, ownerId)
        || !/^sb_publishable_[A-Za-z0-9_-]{20,240}$/u.test(configuration.publishableKey)
        || !/^[a-z0-9]{20}$/u.test(configuration.projectRef) || !projectUrl(configuration.url, configuration.projectRef)) {
      throw new Error('CONNECTION_SESSION_INVALID');
    }
  }
  private url(prefix: typeof CONNECTION_PREFIX | typeof AUTHORIZATION_PREFIX, providerId?: WalletProviderId, expectedRevision?: string): URL {
    const url = new URL(`/rest/v1/${MEMORY_TABLE}`, this.configuration.url);
    url.searchParams.set('select', MEMORY_COLUMNS);
    url.searchParams.set('owner_id', `eq.${this.ownerId}`);
    url.searchParams.set('memory_type', 'eq.preference');
    if (providerId !== undefined) { provider(providerId); url.searchParams.set('memory_key', `eq.${prefix}${providerId}`); }
    else url.searchParams.set('memory_key', `in.(${WALLET_PROVIDER_IDS.map(id => prefix + id).join(',')})`);
    if (expectedRevision !== undefined) { revision(expectedRevision); url.searchParams.set('state->>revision', `eq.${expectedRevision}`); }
    return url;
  }
  private async call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: URL, body?: unknown, replacePending = false): Promise<readonly unknown[]> {
    const res = await this.fetchImpl(url, {method, headers: {Accept: 'application/json', 'Content-Type': 'application/json',
      apikey: this.configuration.publishableKey, Authorization: `Bearer ${this.accessToken}`, Prefer: replacePending ? 'resolution=merge-duplicates,return=representation' : 'return=representation'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000)});
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(res.status === 409 ? 'CONNECTION_CONFLICT' : res.status === 401 ? 'CONNECTION_SESSION_INVALID'
        : res.status === 403 ? 'CONNECTION_FORBIDDEN' : 'CONNECTION_UPSTREAM_UNAVAILABLE');
    }
    let rows: unknown;
    try { rows = await boundedJson(res, WALLET_PROVIDER_IDS.length * 140_000); }
    catch { throw new Error('CONNECTION_UPSTREAM_INVALID'); }
    if (!Array.isArray(rows) || rows.length > WALLET_PROVIDER_IDS.length) throw new Error('CONNECTION_UPSTREAM_INVALID');
    return rows;
  }
  async list(): Promise<readonly StoredConnection[]> {
    const rows = (await this.call('GET', this.url(CONNECTION_PREFIX))).map(row => connectionRow(row, this.ownerId));
    if (new Set(rows.map(row => row.providerId)).size !== rows.length) throw new Error('CONNECTION_UPSTREAM_INVALID');
    return Object.freeze(rows);
  }
  async read(providerId: WalletProviderId): Promise<StoredConnection | null> {
    provider(providerId);
    const rows = await this.call('GET', this.url(CONNECTION_PREFIX, providerId));
    if (rows.length > 1) throw new Error('CONNECTION_UPSTREAM_INVALID');
    const value = rows.length ? connectionRow(rows[0], this.ownerId) : null;
    if (value && value.providerId !== providerId) throw new Error('CONNECTION_UPSTREAM_INVALID');
    return value;
  }
  async save(value: StoredConnection, expectedRevision: string | null): Promise<void> {
    const valid = connection(value, this.ownerId);
    if (expectedRevision !== null) {
      revision(expectedRevision);
      if (expectedRevision === valid.revision) throw new Error('CONNECTION_REVISION_INVALID');
    }
    const rows = await this.call(expectedRevision === null ? 'POST' : 'PATCH',
      this.url(CONNECTION_PREFIX, valid.providerId, expectedRevision ?? undefined), expectedRevision === null ? toRow(valid) : {state: valid, expires_at: null});
    if (rows.length === 0) throw new Error('CONNECTION_CONFLICT');
    if (rows.length !== 1 || JSON.stringify(connectionRow(rows[0], this.ownerId)) !== JSON.stringify(valid)) throw new Error('CONNECTION_WRITE_NOT_CONFIRMED');
  }
  async remove(providerId: WalletProviderId, expectedRevision: string): Promise<void> {
    provider(providerId); revision(expectedRevision);
    const rows = await this.call('DELETE', this.url(CONNECTION_PREFIX, providerId, expectedRevision));
    if (!rows.length) throw new Error('CONNECTION_CONFLICT');
    if (rows.length !== 1) throw new Error('CONNECTION_UPSTREAM_INVALID');
    const removed = connectionRow(rows[0], this.ownerId);
    if (removed.providerId !== providerId || removed.revision !== expectedRevision) throw new Error('CONNECTION_WRITE_NOT_CONFIRMED');
  }
  async createAuthorization(value: PendingAuthorization): Promise<void> {
    const valid = pending(value, this.ownerId);
    const remaining = Date.parse(valid.expiresAt) - Date.now();
    if (remaining <= 0 || remaining > 600_000) throw new Error('CONNECTION_AUTHORIZATION_INVALID');
    const url = this.url(AUTHORIZATION_PREFIX, valid.providerId);
    url.searchParams.set('on_conflict', 'owner_id,memory_key');
    const rows = await this.call('POST', url, {owner_id: this.ownerId, memory_key: AUTHORIZATION_PREFIX + valid.providerId,
      memory_type: 'preference', state: valid, expires_at: valid.expiresAt}, true);
    if (rows.length !== 1 || JSON.stringify(authorizationRow(rows[0], this.ownerId)) !== JSON.stringify(valid)) throw new Error('CONNECTION_WRITE_NOT_CONFIRMED');
  }
  async consumeAuthorization(stateHash: string): Promise<PendingAuthorization | null> {
    if (typeof stateHash !== 'string' || !HASH.test(stateHash)) throw new Error('CONNECTION_AUTHORIZATION_INVALID');
    const url = this.url(AUTHORIZATION_PREFIX);
    url.searchParams.set('state->>stateHash', `eq.${stateHash}`);
    url.searchParams.set('expires_at', `gt.${new Date().toISOString()}`);
    const rows = await this.call('DELETE', url);
    if (rows.length > 1) throw new Error('CONNECTION_UPSTREAM_INVALID');
    if (!rows.length) return null;
    const value = authorizationRow(rows[0], this.ownerId);
    if (value.stateHash !== stateHash || Date.parse(value.expiresAt) <= Date.now()) throw new Error('CONNECTION_AUTHORIZATION_INVALID');
    return value;
  }
}
