import assert from 'node:assert/strict';
import test from 'node:test';
import {ConnectionService} from '../.build/src/connections/service.js';
import {ProviderError} from '../.build/src/connections/providers.js';
import {digest, equalToken, parseGrant, seal, unseal, verifiedSessionHash} from '../.build/src/connections/crypto.js';
import {connectionOrigin, providerConfiguration, providerEnabled, tokenKey} from '../.build/src/connections/config.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-11-20T12:00:00.000Z';
const KEY = Buffer.alloc(32, 17).toString('base64url');
const ORIGIN = 'https://info.dlkt.ee';
const environment = {DLKT_INFO_CONNECTIONS_TOKEN_KEY: KEY, DLKT_INFO_CONNECTIONS_ORIGIN: ORIGIN,
  DLKT_INFO_GMAIL_CLIENT_ID: 'test-client', DLKT_INFO_GMAIL_CLIENT_SECRET: 'test-secret', DLKT_INFO_GMAIL_ENABLED: '1', DLKT_INFO_GMAIL_PUBLIC_READY: '1'};
const grant = (changes = {}) => ({accountId: 'provider-account', accountLabel: 'qa@example.test', accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: '2026-11-20T13:00:00.000Z', scopes: ['openid', 'email'], resources: [], ...changes});
const context = row => `grant:${row.ownerId}:${row.providerId}:${row.id}`;

class MemoryStore {
  connections = new Map(); pending = new Map(); writes = []; removes = [];
  async list() { return [...this.connections.values()]; }
  async read(provider) { return this.connections.get(provider) ?? null; }
  async save(row, expected) {
    if ((this.connections.get(row.providerId)?.revision ?? null) !== expected) throw new Error('CONNECTION_CONFLICT');
    this.connections.set(row.providerId, structuredClone(row)); this.writes.push(structuredClone(row));
  }
  async remove(provider, expected) {
    if (this.connections.get(provider)?.revision !== expected) throw new Error('CONNECTION_CONFLICT');
    this.connections.delete(provider); this.removes.push(provider);
  }
  async createAuthorization(row) { this.pending.set(row.providerId, structuredClone(row)); }
  async consumeAuthorization(hash) {
    const row = [...this.pending.values()].find(value => value.stateHash === hash);
    if (!row) return null;
    this.pending.delete(row.providerId); return row;
  }
}
function fixture(overrides = {}) {
  const store = overrides.store ?? new MemoryStore();
  const calls = [];
  const drivers = {
    authorizationUrl(config, state, challenge) { calls.push({kind: 'authorize', state, challenge}); return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`; },
    async exchangeCode(config, code, verifier) { calls.push({kind: 'exchange', verifier}); return grant(); },
    async refreshGrant(config, old) { calls.push({kind: 'refresh'}); return old; },
    async syncProvider() { calls.push({kind: 'sync'}); return {events: [], state: 'available', checkedAt: NOW}; },
    async revokeGrant() { calls.push({kind: 'revoke'}); return 'revoked'; },
    ...overrides.drivers,
  };
  const service = new ConnectionService(overrides.owner ?? OWNER, overrides.session ?? digest(`${OWNER}:${SESSION}`), store,
    overrides.environment ?? environment, Object.hasOwn(overrides, 'origin') ? overrides.origin : ORIGIN,
    {drivers, now: () => new Date(NOW)});
  return {store, calls, drivers, service};
}
async function connected(f = fixture()) { const start = await f.service.begin('gmail'); await f.service.complete('gmail', start.state, start.state, 'fixture-code', false); return f; }

test('Encryption authenticates owner/provider/connection context and rejects tampering or another key', () => {
  const encrypted = seal(grant(), KEY, `grant:${OWNER}:gmail:${SESSION}`);
  assert.deepEqual(parseGrant(unseal(encrypted, KEY, `grant:${OWNER}:gmail:${SESSION}`)), grant());
  assert.ok(!encrypted.includes('fixture-access') && !encrypted.includes('fixture-refresh'));
  for (const wrong of [`grant:${OTHER}:gmail:${SESSION}`, `grant:${OWNER}:outlook:${SESSION}`, `grant:${OWNER}:gmail:${OTHER}`]) assert.throws(() => unseal(encrypted, KEY, wrong), /CONNECTION_DATA_INVALID/u);
  const parts = encrypted.split('.'); parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
  assert.throws(() => unseal(parts.join('.'), KEY, `grant:${OWNER}:gmail:${SESSION}`), /CONNECTION_DATA_INVALID/u);
  assert.throws(() => unseal(encrypted, Buffer.alloc(32, 18).toString('base64url'), `grant:${OWNER}:gmail:${SESSION}`));
});

test('Verified session binding is stable through access-token rotation and rejects another owner or privileged role', () => {
  const jwt = claims => ['fixtureheader', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'fixturesignature'].join('.');
  const claims = {sub: OWNER, role: 'authenticated', session_id: SESSION};
  assert.equal(verifiedSessionHash(jwt({...claims, exp: 1}), OWNER), verifiedSessionHash(jwt({...claims, exp: 2}), OWNER));
  assert.notEqual(verifiedSessionHash(jwt({...claims, session_id: OTHER}), OWNER), verifiedSessionHash(jwt(claims), OWNER));
  for (const changed of [{...claims, role: 'service_role'}, {...claims, sub: OTHER}, {...claims, session_id: null}]) assert.throws(() => verifiedSessionHash(jwt(changed), OWNER), /CONNECTION_SESSION_INVALID/u);
  assert.equal(equalToken('A'.repeat(43), 'B'.repeat(43)), false);
  assert.equal(equalToken('bad', 'bad'), false);
});

test('Configuration requires canonical key, exact served origin and explicit public readiness or owner pilot', () => {
  assert.equal(tokenKey(environment), KEY);
  assert.equal(tokenKey({...environment, DLKT_INFO_CONNECTIONS_TOKEN_KEY: `${KEY}=`}), null);
  assert.equal(connectionOrigin(environment, 'info.dlkt.ee'), ORIGIN);
  for (const bad of ['https://attacker.invalid', `${ORIGIN}/`, 'http://info.dlkt.ee', 'https://info.dlkt.ee:444']) assert.equal(connectionOrigin({...environment, DLKT_INFO_CONNECTIONS_ORIGIN: bad}, 'info.dlkt.ee'), null);
  assert.equal(connectionOrigin(environment, 'www.dlkt.ee'), null);
  const pilot = {...environment, DLKT_INFO_GMAIL_PUBLIC_READY: '0', DLKT_INFO_CONNECTION_TEST_OWNER_IDS: OWNER};
  assert.equal(providerEnabled(pilot, 'gmail', OWNER), true);
  assert.equal(providerEnabled(pilot, 'gmail', OTHER), false);
  assert.equal(providerEnabled({...pilot, DLKT_INFO_GMAIL_ENABLED: '0'}, 'gmail', OWNER), false);
  assert.equal(providerEnabled({...pilot, DLKT_INFO_CONNECTION_TEST_OWNER_IDS: `${OWNER},invalid`}, 'gmail', OWNER), false);
  assert.equal(providerConfiguration(environment, 'gmail', ORIGIN).redirectUri, `${ORIGIN}/api/connections?provider=gmail`);
  assert.equal(providerConfiguration({...environment, DLKT_INFO_GMAIL_CLIENT_SECRET: ''}, 'gmail', ORIGIN), null);
});

test('Disabled provider/key/origin fails closed before an authorization request is stored', async () => {
  for (const changes of [{environment: {...environment, DLKT_INFO_GMAIL_ENABLED: '0'}}, {environment: {...environment, DLKT_INFO_GMAIL_PUBLIC_READY: '0'}}, {environment: {...environment, DLKT_INFO_CONNECTIONS_TOKEN_KEY: ''}}, {origin: null}]) {
    const f = fixture(changes);
    await assert.rejects(f.service.begin('gmail'), /CONNECTION_UNAVAILABLE/u);
    assert.equal(f.store.pending.size, 0); assert.equal(f.calls.length, 0);
    assert.equal((await f.service.snapshot()).providers.find(p => p.providerId === 'gmail').status, 'unavailable');
  }
});

test('Authorization stores encrypted verifier and hash, binds PKCE and can be consumed once', async () => {
  const f = fixture(); const begin = await f.service.begin('gmail'); const pending = f.store.pending.get('gmail');
  assert.equal(pending.stateHash, digest(begin.state));
  assert.ok(!JSON.stringify(pending).includes(begin.state));
  await f.service.complete('gmail', begin.state, begin.state, 'fixture-code', false);
  const exchanged = f.calls.find(call => call.kind === 'exchange');
  assert.equal(f.calls.find(call => call.kind === 'authorize').challenge, digest(exchanged.verifier));
  assert.equal(f.store.pending.size, 0);
  assert.equal(f.store.connections.get('gmail').status, 'connected');
  await assert.rejects(f.service.complete('gmail', begin.state, begin.state, 'fixture-code', false), /CONNECTION_STATE_INVALID/u);
  assert.equal(f.calls.filter(call => call.kind === 'exchange').length, 1);
  const safe = JSON.stringify(await f.service.snapshot());
  assert.doesNotMatch(safe, /fixture-access|fixture-refresh|sealedGrant|operationExpiresAt|sessionHash/u);
});

test('Cookie mismatch does not consume state; another session cannot complete authorization', async () => {
  const f = fixture(); const begin = await f.service.begin('gmail');
  await assert.rejects(f.service.complete('gmail', begin.state, 'B'.repeat(43), 'fixture-code', false), /CONNECTION_STATE_INVALID/u);
  assert.equal(f.store.pending.size, 1);
  const another = fixture({store: f.store, session: digest('different-session')});
  await assert.rejects(another.service.complete('gmail', begin.state, begin.state, 'fixture-code', false), /CONNECTION_STATE_INVALID/u);
  assert.equal(another.calls.filter(call => call.kind === 'exchange').length, 0);
});

test('Denied and expired authorization do not exchange codes, and denial preserves an existing grant', async () => {
  const f = await connected(); const original = structuredClone(f.store.connections.get('gmail'));
  const cancelled = await f.service.begin('gmail');
  await assert.rejects(f.service.complete('gmail', cancelled.state, cancelled.state, null, true), /CONNECTION_CANCELLED/u);
  assert.deepEqual(f.store.connections.get('gmail'), original);
  const expired = await f.service.begin('gmail'); f.store.pending.get('gmail').expiresAt = NOW;
  await assert.rejects(f.service.complete('gmail', expired.state, expired.state, 'fixture-code', false), /CONNECTION_STATE_EXPIRED/u);
  assert.equal(f.calls.filter(call => call.kind === 'exchange').length, 1);
});

test('Newer authorization replaces the old pending state without a second active authorization', async () => {
  const f = fixture(); const older = await f.service.begin('gmail'); const newer = await f.service.begin('gmail');
  assert.equal(f.store.pending.size, 1);
  await assert.rejects(f.service.complete('gmail', older.state, older.state, 'fixture-code', false), /CONNECTION_STATE_INVALID/u);
  await f.service.complete('gmail', newer.state, newer.state, 'fixture-code', false);
});

test('Refresh rotation is durably saved before a failed activity request and its lease is released', async () => {
  const f = await connected();
  const rotated = grant({accessToken: 'rotated-access', refreshToken: 'rotated-refresh'});
  f.drivers.refreshGrant = async () => rotated;
  f.drivers.syncProvider = async () => {
    const saved = f.store.connections.get('gmail');
    assert.equal(parseGrant(unseal(saved.sealedGrant, KEY, context(saved))).refreshToken, rotated.refreshToken);
    throw new ProviderError('network');
  };
  await assert.rejects(f.service.sync('gmail'), /NETWORK/u);
  const row = f.store.connections.get('gmail');
  assert.equal(row.operationExpiresAt, null); assert.equal(row.status, 'connected');
  assert.equal(parseGrant(unseal(row.sealedGrant, KEY, context(row))).refreshToken, rotated.refreshToken);
  assert.equal(row.lastSyncAt, null);
});

test('An active lease prevents a concurrent refresh or disconnect and clears on successful sync', async () => {
  const f = await connected(); let release; let entered;
  const started = new Promise(resolve => {entered = resolve;});
  f.drivers.refreshGrant = async (config, old) => {entered(); await new Promise(resolve => {release = resolve;}); return old;};
  const first = f.service.sync('gmail'); await started;
  const other = fixture({store: f.store});
  await assert.rejects(other.service.sync('gmail'), /CONNECTION_BUSY/u);
  await assert.rejects(other.service.disconnect('gmail'), /CONNECTION_BUSY/u);
  release(); await first;
  assert.equal(f.store.connections.get('gmail').operationExpiresAt, null);
  assert.equal(f.store.connections.get('gmail').lastSyncAt, NOW);
});

test('Provider authorization rejection marks reconnect; transient failures do not invent it', async () => {
  const f = await connected(); f.drivers.refreshGrant = async () => {throw new ProviderError('authorization');};
  await assert.rejects(f.service.sync('gmail'), /CONNECTION_RECONNECT_REQUIRED/u);
  assert.equal(f.store.connections.get('gmail').status, 'reconnect-required');
  assert.equal(f.store.connections.get('gmail').operationExpiresAt, null);
});

test('Ownership mismatch or provider account substitution cannot replace a stored grant', async () => {
  const f = await connected();
  const original = f.store.connections.get('gmail');
  f.store.connections.set('gmail', {...original, ownerId: OTHER});
  await assert.rejects(f.service.snapshot(), /CONNECTION_DATA_INVALID/u);
  await assert.rejects(f.service.sync('gmail'), /CONNECTION_DATA_INVALID/u);
  f.store.connections.set('gmail', original);
  f.drivers.refreshGrant = async () => grant({accountId: 'another-provider-account'});
  await assert.rejects(f.service.sync('gmail'), /CONNECTION_DATA_INVALID/u);
  const after = f.store.connections.get('gmail');
  assert.equal(parseGrant(unseal(after.sealedGrant, KEY, context(after))).accountId, 'provider-account');
});

test('Provider-side revocation failure still removes the local grant with an honest manual-required result', async () => {
  const f = await connected(); f.drivers.revokeGrant = async () => {throw new ProviderError('network');};
  assert.deepEqual(await f.service.disconnect('gmail'), {disconnected: true, revocation: 'manual-required'});
  assert.equal(f.store.connections.size, 0);
});

test('Disabled provider can still be disconnected locally without enabling access', async () => {
  const f = await connected();
  const disabled = fixture({store: f.store, environment: {...environment, DLKT_INFO_GMAIL_ENABLED: '0'}});
  assert.equal((await disabled.service.snapshot()).providers.find(p => p.providerId === 'gmail').status, 'unavailable');
  await assert.rejects(disabled.service.sync('gmail'), /CONNECTION_UNAVAILABLE/u);
  assert.equal((await disabled.service.disconnect('gmail')).disconnected, true);
  assert.equal(f.store.connections.size, 0);
});

test('Authorization exchange holds a lease so concurrent actions cannot issue a competing grant', async () => {
  const f = fixture(); const begun = await f.service.begin('gmail');
  let entered, release;
  const started = new Promise(resolve => {entered = resolve;});
  let exchanges = 0;
  f.drivers.exchangeCode = async () => {exchanges++; entered(); await new Promise(resolve => {release = resolve;}); return grant();};
  const completing = f.service.complete('gmail', begun.state, begun.state, 'fixture-code', false);
  await started;
  const second = fixture({store: f.store});
  try {
    assert.equal(f.store.pending.size, 0);
    assert.equal(f.store.connections.size, 1);
    const reserved = f.store.connections.get('gmail');
    assert.throws(() => parseGrant(unseal(reserved.sealedGrant, KEY, context(reserved))), /CONNECTION_DATA_INVALID/u);
    await assert.rejects(second.service.complete('gmail', begun.state, begun.state, 'second-code', false), /CONNECTION_STATE_INVALID/u);
    await assert.rejects(second.service.sync('gmail'), /CONNECTION_BUSY|CONNECTION_RECONNECT_REQUIRED/u);
    await assert.rejects(second.service.begin('gmail'), /CONNECTION_BUSY/u);
    await assert.rejects(second.service.disconnect('gmail'), /CONNECTION_BUSY/u);
  } finally { release(); await completing; }
  assert.equal(exchanges, 1);
  assert.equal(second.calls.filter(call => call.kind === 'exchange').length, 0);
  assert.equal(f.store.connections.get('gmail').status, 'connected');
  assert.equal(f.store.connections.get('gmail').operationExpiresAt, null);
});

test('A failed first authorization removes its reservation and permits a fresh attempt', async () => {
  const f = fixture(); const begun = await f.service.begin('gmail');
  f.drivers.exchangeCode = async () => {throw new ProviderError('authorization');};
  await assert.rejects(f.service.complete('gmail', begun.state, begun.state, 'fixture-code', false));
  assert.equal(f.store.connections.size, 0);
  assert.ok((await f.service.begin('gmail')).state);
});

test('A failed local removal releases its lease so the user can retry disconnect', async () => {
  const f = await connected();
  f.store.remove = async () => {throw new Error('CONNECTION_UPSTREAM_UNAVAILABLE');};
  await assert.rejects(f.service.disconnect('gmail'), /CONNECTION_UPSTREAM_UNAVAILABLE/u);
  assert.equal(f.store.connections.get('gmail').operationExpiresAt, null);
});

test('Failed reconnect releases the lease while preserving the existing encrypted grant', async () => {
  const f = await connected(); const original = structuredClone(f.store.connections.get('gmail'));
  const begun = await f.service.begin('gmail');
  f.drivers.exchangeCode = async () => {throw new ProviderError('network');};
  await assert.rejects(f.service.complete('gmail', begun.state, begun.state, 'fixture-code', false), /NETWORK/u);
  const after = f.store.connections.get('gmail');
  assert.equal(after.operationExpiresAt, null);
  assert.equal(after.sealedGrant, original.sealedGrant);
  assert.equal(after.status, original.status);
  assert.equal(after.id, original.id);
  assert.ok((await f.service.begin('gmail')).state);
});


test('Microsoft personal account configuration has a queryless registered callback', () => {
  const configured = providerConfiguration({...environment, DLKT_INFO_OUTLOOK_CLIENT_ID: 'fixture-client', DLKT_INFO_OUTLOOK_CLIENT_SECRET: 'fixture-secret'}, 'outlook', ORIGIN);
  assert.equal(configured.redirectUri, `${ORIGIN}/api/connections`);
  assert.equal(new URL(configured.redirectUri).search, '');
});
