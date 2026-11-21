import {randomUUID} from 'node:crypto';
import type {Environment} from '../account/http.js';
import {isRecord, isUuid} from '../data/guards.js';
import type {WalletProviderId} from '../wallet/providers.js';
import {CONNECTIONS_VERSION} from './types.js';
import type {ConnectionStore, ConnectionsSnapshot, ProviderConfiguration, ProviderDependencies, ProviderGrant, ProviderSync, StoredConnection} from './types.js';
import {PROVIDER_IDS, providerConfiguration, providerEnabled, tokenKey} from './config.js';
import {digest, equalToken, opaqueToken, parseGrant, seal, unseal} from './crypto.js';
import * as providers from './providers.js';

export interface ProviderOperations {
  authorizationUrl(config: ProviderConfiguration, state: string, challenge: string): string;
  exchangeCode(config: ProviderConfiguration, code: string, verifier: string, deps?: ProviderDependencies): Promise<ProviderGrant>;
  refreshGrant(config: ProviderConfiguration, grant: ProviderGrant, deps?: ProviderDependencies): Promise<ProviderGrant>;
  revokeGrant(config: ProviderConfiguration, grant: ProviderGrant, deps?: ProviderDependencies): Promise<'revoked' | 'manual-required'>;
  syncProvider(config: ProviderConfiguration, grant: ProviderGrant, context: {ownerId: string; connectionId: string}, deps?: ProviderDependencies): Promise<ProviderSync>;
}
export class ConnectionError extends Error {
  constructor(readonly code: 'CONNECTION_UNAVAILABLE' | 'CONNECTION_NOT_FOUND' | 'CONNECTION_RECONNECT_REQUIRED' | 'CONNECTION_BUSY' | 'CONNECTION_STATE_INVALID' | 'CONNECTION_STATE_EXPIRED' | 'CONNECTION_CANCELLED' | 'CONNECTION_CONFLICT') { super(code); this.name = 'ConnectionError'; }
}
const context = (owner: string, provider: WalletProviderId, id: string): string => `grant:${owner}:${provider}:${id}`;

export class ConnectionService {
  private readonly drivers: ProviderOperations;
  private readonly now: () => Date;
  private readonly providerDeps: ProviderDependencies;
  constructor(private readonly ownerId: string, private readonly sessionHash: string, private readonly store: ConnectionStore, private readonly environment: Environment, private readonly origin: string | null, deps: ProviderDependencies & {drivers?: ProviderOperations} = {}) {
    if (!isUuid(ownerId) || !/^[A-Za-z0-9_-]{43}$/u.test(sessionHash)) throw new Error('CONNECTION_SESSION_INVALID');
    this.drivers = deps.drivers ?? providers; this.now = deps.now ?? (() => new Date());
    this.providerDeps = {now: this.now, ...(deps.fetchImpl ? {fetchImpl: deps.fetchImpl} : {})};
  }
  private configuration(providerId: WalletProviderId, requireEnabled = true): ProviderConfiguration {
    const config = this.origin ? providerConfiguration(this.environment, providerId, this.origin) : null;
    if (!config || !tokenKey(this.environment) || (requireEnabled && !providerEnabled(this.environment, providerId, this.ownerId))) throw new ConnectionError('CONNECTION_UNAVAILABLE');
    return config;
  }
  private key(): string { const key = tokenKey(this.environment); if (!key) throw new ConnectionError('CONNECTION_UNAVAILABLE'); return key; }
  private assertOwned(value: StoredConnection, providerId: WalletProviderId): void {
    if (value.ownerId !== this.ownerId || value.providerId !== providerId || !isUuid(value.id)) throw new Error('CONNECTION_DATA_INVALID');
  }
  private grant(value: StoredConnection): ProviderGrant { return parseGrant(unseal(value.sealedGrant, this.key(), context(this.ownerId, value.providerId, value.id))); }
  private busy(value: StoredConnection): boolean { return value.operationExpiresAt !== null && Date.parse(value.operationExpiresAt) > this.now().getTime(); }
  private async claim(value: StoredConnection): Promise<StoredConnection> {
    if (this.busy(value)) throw new ConnectionError('CONNECTION_BUSY');
    const leased = Object.freeze({...value, revision: randomUUID(), operationExpiresAt: new Date(this.now().getTime() + 120_000).toISOString()});
    await this.store.save(leased, value.revision); return leased;
  }
  private async release(value: StoredConnection, reconnect: boolean): Promise<void> {
    await this.store.save(Object.freeze({...value, revision: randomUUID(), operationExpiresAt: null, status: reconnect ? 'reconnect-required' : value.status}), value.revision);
  }

  async snapshot(): Promise<ConnectionsSnapshot> {
    const rows = await this.store.list();
    if (rows.length > 4 || new Set(rows.map(row => row.providerId)).size !== rows.length) throw new Error('CONNECTION_DATA_INVALID');
    const views = PROVIDER_IDS.map(providerId => {
      const row = rows.find(item => item.providerId === providerId) ?? null;
      if (row) this.assertOwned(row, providerId);
      let available = true; try { this.configuration(providerId); } catch { available = false; }
      const connection = row ? Object.freeze({id: row.id, accountLabel: row.accountLabel, connectedAt: row.connectedAt, lastSyncAt: row.lastSyncAt, status: row.status}) : null;
      return Object.freeze({providerId, status: available ? row?.status ?? 'available' : 'unavailable', connection});
    });
    return Object.freeze({version: CONNECTIONS_VERSION, providers: Object.freeze(views)});
  }

  async begin(providerId: WalletProviderId): Promise<{authorizationUrl: string; state: string}> {
    const config = this.configuration(providerId), existing = await this.store.read(providerId);
    if (existing) { this.assertOwned(existing, providerId); if (this.busy(existing)) throw new ConnectionError('CONNECTION_BUSY'); }
    const state = opaqueToken(), verifier = opaqueToken(), stateHash = digest(state);
    const payload = {verifier, connectionId: existing?.id ?? randomUUID(), expectedRevision: existing?.revision ?? null};
    const sealedVerifier = seal(payload, this.key(), `oauth:${this.ownerId}:${providerId}:${stateHash}`);
    const authorizationUrl = this.drivers.authorizationUrl(config, state, digest(verifier));
    await this.store.createAuthorization({stateHash, ownerId: this.ownerId, sessionHash: this.sessionHash, providerId, sealedVerifier, expiresAt: new Date(this.now().getTime() + 600_000).toISOString()});
    return Object.freeze({authorizationUrl, state});
  }

  async complete(providerId: WalletProviderId, state: string, cookieState: string, code: string | null, denied: boolean): Promise<void> {
    const config = this.configuration(providerId);
    if (!equalToken(state, cookieState)) throw new ConnectionError('CONNECTION_STATE_INVALID');
    const stateHash = digest(state), pending = await this.store.consumeAuthorization(stateHash);
    if (!pending || pending.ownerId !== this.ownerId || pending.providerId !== providerId || pending.sessionHash !== this.sessionHash || pending.stateHash !== stateHash) throw new ConnectionError('CONNECTION_STATE_INVALID');
    const expires = Date.parse(pending.expiresAt), now = this.now().getTime();
    if (!Number.isFinite(expires) || expires <= now || expires > now + 600_000) throw new ConnectionError('CONNECTION_STATE_EXPIRED');
    if (denied) throw new ConnectionError('CONNECTION_CANCELLED');
    if (!code || code.length > 4096 || /[\u0000-\u0020\u007f]/u.test(code)) throw new ConnectionError('CONNECTION_STATE_INVALID');
    const payload = unseal(pending.sealedVerifier, this.key(), `oauth:${this.ownerId}:${providerId}:${stateHash}`);
    if (!isRecord(payload) || Object.keys(payload).sort().join(',') !== 'connectionId,expectedRevision,verifier' || typeof payload.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(payload.verifier) || !isUuid(payload.connectionId) || (payload.expectedRevision !== null && !isUuid(payload.expectedRevision))) throw new Error('CONNECTION_DATA_INVALID');
    const current = await this.store.read(providerId);
    if ((current?.revision ?? null) !== payload.expectedRevision || (current && (current.id !== payload.connectionId || this.busy(current)))) throw new ConnectionError('CONNECTION_CONFLICT');
    if (current) this.assertOwned(current, providerId);
    // Reserve before contacting the provider. Concurrent callbacks, refresh and
    // disconnect cannot obtain or revoke a competing grant during exchange.
    const reservation: StoredConnection = current ? await this.claim(current) : Object.freeze({id: payload.connectionId, ownerId: this.ownerId, providerId, accountLabel: 'Authorization in progress', status: 'reconnect-required', sealedGrant: seal({pending: true}, this.key(), context(this.ownerId, providerId, payload.connectionId)), connectedAt: this.now().toISOString(), lastSyncAt: null, revision: randomUUID(), operationExpiresAt: new Date(this.now().getTime() + 120_000).toISOString()});
    if (!current) await this.store.save(reservation, null);
    try {
      const grant = parseGrant(await this.drivers.exchangeCode(config, code, payload.verifier, this.providerDeps));
      const value: StoredConnection = Object.freeze({...reservation, accountLabel: grant.accountLabel, status: 'connected', sealedGrant: seal(grant, this.key(), context(this.ownerId, providerId, payload.connectionId)), connectedAt: current?.connectedAt ?? this.now().toISOString(), lastSyncAt: null, revision: randomUUID(), operationExpiresAt: null});
      await this.store.save(value, reservation.revision);
    } catch (error) {
      try { if (current) await this.release(reservation, false); else await this.store.remove(providerId, reservation.revision); } catch { /* Only this reservation may be removed; a newer revision always wins. */ }
      throw error;
    }
  }

  async sync(providerId: WalletProviderId): Promise<ProviderSync> {
    const config = this.configuration(providerId), existing = await this.store.read(providerId);
    if (!existing) throw new ConnectionError('CONNECTION_NOT_FOUND');
    this.assertOwned(existing, providerId);
    if (existing.status !== 'connected') throw new ConnectionError('CONNECTION_RECONNECT_REQUIRED');
    let leased = await this.claim(existing);
    try {
      const grant = this.grant(leased), refreshed = parseGrant(await this.drivers.refreshGrant(config, grant, this.providerDeps));
      if (refreshed.accountId !== grant.accountId) throw new Error('CONNECTION_DATA_INVALID');
      // Persist rotated refresh tokens before any activity request can fail.
      const renewed = Object.freeze({...leased, revision: randomUUID(), sealedGrant: seal(refreshed, this.key(), context(this.ownerId, providerId, leased.id)), accountLabel: refreshed.accountLabel});
      await this.store.save(renewed, leased.revision); leased = renewed;
      const result = await this.drivers.syncProvider(config, refreshed, {ownerId: this.ownerId, connectionId: leased.id}, this.providerDeps);
      const done = Object.freeze({...leased, revision: randomUUID(), lastSyncAt: result.checkedAt, operationExpiresAt: null});
      await this.store.save(done, leased.revision);
      return result;
    } catch (error) {
      const reconnect = error instanceof providers.ProviderError && ['authorization', 'scope-denied', 'reauthorization-required'].includes(error.code);
      try { await this.release(leased, reconnect); } catch { /* A concurrent change wins; never overwrite a newer grant. */ }
      if (reconnect) throw new ConnectionError('CONNECTION_RECONNECT_REQUIRED');
      throw error;
    }
  }

  async disconnect(providerId: WalletProviderId): Promise<{disconnected: true; revocation: 'revoked' | 'manual-required'}> {
    const existing = await this.store.read(providerId);
    if (!existing) return Object.freeze({disconnected: true, revocation: 'manual-required'});
    this.assertOwned(existing, providerId);
    const leased = await this.claim(existing);
    let revocation: 'revoked' | 'manual-required' = 'manual-required';
    try { revocation = await this.drivers.revokeGrant(this.configuration(providerId, false), this.grant(leased), this.providerDeps); } catch { /* Local removal remains possible when provider access is disabled or revoked. */ }
    try { await this.store.remove(providerId, leased.revision); }
    catch (error) {
      try { await this.release(leased, revocation === 'revoked'); } catch { /* A newer revision or completed removal wins. */ }
      throw error;
    }
    return Object.freeze({disconnected: true, revocation});
  }
}
