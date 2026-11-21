import {randomUUID} from 'node:crypto';
import {boundedJson} from '../account/http.js';
import {isRecord, isUuid} from '../data/guards.js';
import {isAccessToken} from '../identity/guards.js';
import type {ReadyPersistenceConfiguration} from '../persistence/contracts.js';
import {
  WALLET_PROFILE_MEMORY_KEY, WALLET_PROFILE_MAX_BYTES, WALLET_PROFILE_VERSION,
  isWalletRevision, parseWalletProfile, parseWalletProfileState,
  type WalletProfile, type WalletProfileState,
} from './contracts.js';

/** Defense in depth; the identity transport verifies the token before this store is constructed. */
function belongsToAuthenticatedUser(token: unknown, userId: string): token is string {
  if (!isAccessToken(token)) return false;
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return isRecord(claims) && claims.role === 'authenticated' && claims.sub === userId;
  } catch {
    return false;
  }
}

/** Every query retains user-token RLS and the verified owner's private profile namespace. */
export class WalletProfileStore {
  constructor(
    private readonly config: ReadyPersistenceConfiguration,
    private readonly userId: string,
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {
    if (!isUuid(userId) || !belongsToAuthenticatedUser(token, userId)
      || !/^sb_publishable_[A-Za-z0-9_-]{20,240}$/u.test(config.publishableKey)) {
      throw new Error('WALLET_SESSION_INVALID');
    }
  }

  private url(revision?: string): string {
    const url = new URL('/rest/v1/dlkt_info_user_memory', this.config.url);
    url.searchParams.set('select', 'owner_id,memory_key,memory_type,state');
    url.searchParams.set('owner_id', `eq.${this.userId}`);
    url.searchParams.set('memory_key', `eq.${WALLET_PROFILE_MEMORY_KEY}`);
    url.searchParams.set('memory_type', 'eq.preference');
    if (revision !== undefined) {
      if (!isWalletRevision(revision)) throw new Error('WALLET_REVISION_INVALID');
      url.searchParams.set('state->>revision', `eq.${revision}`);
    }
    return url.href;
  }

  private async call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, data?: unknown): Promise<readonly WalletProfileState[]> {
    const response = await this.request(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apikey: this.config.publishableKey,
        Authorization: `Bearer ${this.token}`,
        Prefer: 'return=representation',
      },
      ...(data === undefined ? {} : {body: JSON.stringify(data)}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 409 ? 'WALLET_CONFLICT'
        : response.status === 401 ? 'WALLET_SESSION_INVALID'
          : response.status === 403 ? 'WALLET_FORBIDDEN' : 'WALLET_UPSTREAM_UNAVAILABLE');
    }
    let rows: unknown;
    try {
      rows = await boundedJson(response, WALLET_PROFILE_MAX_BYTES + 1_024);
    } catch {
      throw new Error('WALLET_UPSTREAM_INVALID');
    }
    if (!Array.isArray(rows) || rows.length > 1) throw new Error('WALLET_UPSTREAM_INVALID');
    return rows.map((row: unknown) => {
      if (!isRecord(row) || row.owner_id !== this.userId
        || row.memory_key !== WALLET_PROFILE_MEMORY_KEY || row.memory_type !== 'preference') {
        throw new Error('WALLET_OWNER_MISMATCH');
      }
      try {
        return parseWalletProfileState(row.state);
      } catch {
        throw new Error('WALLET_UPSTREAM_INVALID');
      }
    });
  }

  async read(): Promise<WalletProfileState | null> {
    const rows = await this.call('GET', this.url());
    return rows[0] ?? null;
  }

  async save(value: WalletProfile, expectedRevision: string | null): Promise<WalletProfileState> {
    const canonical = parseWalletProfile(value);
    if (expectedRevision !== null && !isWalletRevision(expectedRevision)) throw new Error('WALLET_REVISION_INVALID');
    const state: WalletProfileState = parseWalletProfileState({
      version: WALLET_PROFILE_VERSION,
      revision: randomUUID(),
      updatedAt: new Date(this.clock()).toISOString(),
      value: canonical,
    });
    const rows = await this.call(expectedRevision === null ? 'POST' : 'PATCH', this.url(expectedRevision ?? undefined),
      expectedRevision === null ? {
        owner_id: this.userId,
        memory_key: WALLET_PROFILE_MEMORY_KEY,
        memory_type: 'preference',
        state,
      } : {state});
    if (!rows[0]) throw new Error('WALLET_CONFLICT');
    if (JSON.stringify(rows[0]) !== JSON.stringify(state)) throw new Error('WALLET_WRITE_NOT_CONFIRMED');
    return rows[0];
  }

  async remove(expectedRevision: string): Promise<void> {
    const rows = await this.call('DELETE', this.url(expectedRevision));
    if (rows.length !== 1) throw new Error('WALLET_CONFLICT');
    if (rows[0]?.revision !== expectedRevision) throw new Error('WALLET_WRITE_NOT_CONFIRMED');
  }
}
