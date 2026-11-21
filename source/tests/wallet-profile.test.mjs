import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WALLET_PROFILE_VERSION, WALLET_PROFILE_MEMORY_KEY, WALLET_PROFILE_MAX_BYTES,
  parseWalletProfile, parseWalletProfileState, parseWalletSnapshot, walletSnapshot,
} from '../.build/src/wallet/contracts.js';
import {WalletProfileStore} from '../.build/src/wallet/store.js';
import {DAILY_TOPICS} from '../.build/src/daily/contracts.js';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const REV = '33333333-3333-4333-8333-333333333333';
const NEXT = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-11-18T12:00:00.000Z';
const token = (sub = USER, role = 'authenticated') => [
  Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url'),
  Buffer.from(JSON.stringify({sub, role})).toString('base64url'),
  'testSignatureOnly00000000',
].join('.');
const TOKEN = token();
const config = {state: 'ready', url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_' + 'x'.repeat(30)};
const profile = {displayName: 'Razvan', locale: 'ro-RO', timezone: 'Europe/Bucharest', briefingTime: '08:30', interests: ['technology', 'digital-life'], personalPriority: 'balanced'};
const state = {version: WALLET_PROFILE_VERSION, revision: REV, updatedAt: NOW, value: profile};
const row = value => ({owner_id: USER, memory_key: WALLET_PROFILE_MEMORY_KEY, memory_type: 'preference', state: value});
const response = value => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}});

test('wallet profile has exactly six canonical immutable preference fields', () => {
  const value = parseWalletProfile({...profile, locale: 'ro-ro'});
  assert.deepEqual(value, profile);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.interests), true);
  assert.deepEqual(parseWalletProfile({...profile, displayName: null, interests: []}), {...profile, displayName: null, interests: []});
  assert.deepEqual(parseWalletProfile({...profile, interests: [...DAILY_TOPICS]}).interests, DAILY_TOPICS);
});

test('wallet profile rejects unknown ownership, connection, credential and schedule fields', () => {
  for (const key of ['owner_id', 'userId', 'connectedAccounts', 'accessToken', 'refreshToken', 'scheduleActive']) {
    assert.throws(() => parseWalletProfile({...profile, [key]: 'not-permitted'}), /WALLET_PROFILE_INVALID/);
  }
  for (const key of Object.keys(profile)) {
    const incomplete = {...profile}; delete incomplete[key];
    assert.throws(() => parseWalletProfile(incomplete), /WALLET_PROFILE_INVALID/);
  }
});

test('wallet profile rejects invalid names, locales, IANA zones, times and priorities', () => {
  const cases = [
    {displayName: 7}, {displayName: 'x'.repeat(81)}, {displayName: 'Alice\nBob'}, {displayName: 'Alice\u202eBob'},
    {locale: 'en_US'}, {locale: ''}, {locale: 'en-' + 'x'.repeat(34)}, {locale: null},
    {timezone: 'Mars/Olympus'}, {timezone: '+01:00'}, {timezone: ''}, {timezone: null},
    {briefingTime: '24:00'}, {briefingTime: '12:60'}, {briefingTime: '8:30'}, {briefingTime: '08:30:00'},
    {personalPriority: 'all'}, {personalPriority: null},
  ];
  for (const invalid of cases) assert.throws(() => parseWalletProfile({...profile, ...invalid}), /WALLET_PROFILE_INVALID/);
  assert.equal(parseWalletProfile({...profile, briefingTime: '00:00'}).briefingTime, '00:00');
  assert.equal(parseWalletProfile({...profile, briefingTime: '23:59', personalPriority: 'personal-first'}).personalPriority, 'personal-first');
});

test('wallet interests are bounded, unique canonical daily topics', () => {
  for (const interests of [['technology', 'technology'], ['private-messages'], [null], 'technology', Array(12).fill('science')]) {
    assert.throws(() => parseWalletProfile({...profile, interests}), /WALLET_PROFILE_INVALID/);
  }
});

test('profile state accepts real ISO instants and UUID revisions only', () => {
  assert.deepEqual(parseWalletProfileState(state), state);
  for (const invalid of [
    {version: 'other'}, {revision: '*'}, {revision: '33333333-3333-1333-8333-333333333333'},
    {updatedAt: 'yesterday'}, {updatedAt: '2026-02-30T12:00:00.000Z'}, {updatedAt: '2026-11-18'}, {owner_id: USER},
  ]) assert.throws(() => parseWalletProfileState({...state, ...invalid}), /WALLET_PROFILE_STATE_INVALID/);
});

test('wallet snapshots never imply providers are connected or activity checked', () => {
  for (const account of ['unavailable', 'signed-out', 'signed-in']) {
    const snapshot = walletSnapshot(account, account === 'signed-in' ? state : null);
    assert.deepEqual(parseWalletSnapshot(snapshot), snapshot);
    assert.equal(snapshot.activity.checkedAt, null);
    assert.deepEqual(snapshot.activity.events, []);
    assert.equal(snapshot.activity.state, account === 'signed-in' ? 'not-connected' : 'unavailable');
    assert.equal(snapshot.providers.every(provider => provider.status === 'unavailable' && provider.connectionAvailable === false), true);
  }
  assert.throws(() => walletSnapshot('signed-out', state), /WALLET_SNAPSHOT_INVALID/);
});

test('snapshot parser rejects forged connection, activity, owner and signed-out PII', () => {
  const base = walletSnapshot('signed-in', state);
  const mutations = [
    {...base, owner_id: USER}, {...base, account: 'signed-out'},
    {...base, activity: {...base.activity, checkedAt: NOW}},
    {...base, activity: {...base.activity, events: [{kind: 'email'}]}},
    {...base, activity: {...base.activity, state: 'connected'}},
    {...base, providers: base.providers.map((provider, index) => index ? provider : {...provider, connectionAvailable: true})},
    {...base, providers: base.providers.map((provider, index) => index ? provider : {...provider, status: 'connected'})},
    {...base, providers: base.providers.map(() => base.providers[0])},
    {...base, providers: []},
  ];
  for (const mutation of mutations) assert.throws(() => parseWalletSnapshot(mutation));
});

test('profile store reads with a publishable key and verified user JWT under RLS', async () => {
  let url, init;
  const store = new WalletProfileStore(config, USER, TOKEN, async (u, i) => {url = new URL(u); init = i; return response([row(state)]);});
  assert.deepEqual(await store.read(), state);
  assert.equal(url.pathname, '/rest/v1/dlkt_info_user_memory');
  assert.equal(url.searchParams.get('owner_id'), 'eq.' + USER);
  assert.equal(url.searchParams.get('memory_key'), 'eq.wallet-profile-v1');
  assert.equal(url.searchParams.get('memory_type'), 'eq.preference');
  assert.equal(init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(init.headers.apikey, config.publishableKey);
  assert.equal(init.cache, 'no-store');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.Prefer, 'return=representation');
});

test('profile store rejects admin, anonymous, malformed and foreign-user tokens before I/O', () => {
  let calls = 0;
  const request = async () => {calls++; throw new Error('must not call');};
  for (const invalid of [token(USER, 'service_role'), token(USER, 'anon'), token(OTHER), 'bad-token', 'aaaaaaaa.bbbbbbbb.cccccccc']) {
    assert.throws(() => new WalletProfileStore(config, USER, invalid, request), /WALLET_SESSION_INVALID/);
  }
  assert.throws(() => new WalletProfileStore({...config, publishableKey: 'sb_secret_' + 'x'.repeat(30)}, USER, TOKEN, request), /WALLET_SESSION_INVALID/);
  assert.equal(calls, 0);
});

test('upstream owner, namespace, type and cardinality mismatches cannot leak profile data', async () => {
  for (const rows of [[{...row(state), owner_id: OTHER}], [{...row(state), memory_key: 'reader-account-v1'}], [{...row(state), memory_type: 'context'}], [row(state), row(state)]]) {
    const store = new WalletProfileStore(config, USER, TOKEN, async () => response(rows));
    await assert.rejects(store.read(), /WALLET_(?:OWNER_MISMATCH|UPSTREAM_INVALID)/);
  }
});

test('profile create uses only the server owner and confirms exact canonical returned value', async () => {
  const store = new WalletProfileStore(config, USER, TOKEN, async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(init.method, 'POST');
    assert.equal(body.owner_id, USER);
    assert.equal(body.memory_key, 'wallet-profile-v1');
    assert.equal(body.memory_type, 'preference');
    assert.equal(new URL(url).searchParams.has('state->>revision'), false);
    assert.deepEqual(Object.keys(body.state.value).sort(), Object.keys(profile).sort());
    return response([body]);
  }, () => Date.parse(NOW));
  const saved = await store.save(profile, null);
  assert.equal(saved.updatedAt, NOW);
  assert.notEqual(saved.revision, REV);
  assert.deepEqual(saved.value, profile);
});

test('profile updates use exact revision matching and stale matches are conflicts', async () => {
  const store = new WalletProfileStore(config, USER, TOKEN, async (url, init) => {
    assert.equal(init.method, 'PATCH');
    assert.equal(new URL(url).searchParams.get('state->>revision'), 'eq.' + REV);
    assert.deepEqual(Object.keys(JSON.parse(init.body)), ['state']);
    return response([]);
  });
  await assert.rejects(store.save(profile, REV), /WALLET_CONFLICT/);
});

test('unique conflicts and changed write acknowledgments cannot silently overwrite or report success', async () => {
  const duplicate = new WalletProfileStore(config, USER, TOKEN, async () => new Response('{}', {status: 409}));
  await assert.rejects(duplicate.save(profile, null), /WALLET_CONFLICT/);
  const modified = new WalletProfileStore(config, USER, TOKEN, async (url, init) => response([row({...JSON.parse(init.body).state, value: {...profile, displayName: null}})]));
  await assert.rejects(modified.save(profile, null), /WALLET_WRITE_NOT_CONFIRMED/);
});

test('profile deletion uses an exact revision and verifies the returned deletion', async () => {
  const store = new WalletProfileStore(config, USER, TOKEN, async (url, init) => {
    assert.equal(init.method, 'DELETE');
    assert.equal(init.body, undefined);
    assert.equal(new URL(url).searchParams.get('state->>revision'), 'eq.' + REV);
    return response([row(state)]);
  });
  await store.remove(REV);
  const stale = new WalletProfileStore(config, USER, TOKEN, async () => response([]));
  await assert.rejects(stale.remove(REV), /WALLET_CONFLICT/);
  const wrong = new WalletProfileStore(config, USER, TOKEN, async () => response([row({...state, revision: NEXT})]));
  await assert.rejects(wrong.remove(REV), /WALLET_WRITE_NOT_CONFIRMED/);
  await assert.rejects(store.remove('*'), /WALLET_REVISION_INVALID/);
});

test('profile storage responses have conservative byte and JSON bounds', async () => {
  for (const upstream of [
    () => new Response('x', {headers: {'content-type': 'text/html'}}),
    () => new Response('{', {headers: {'content-type': 'application/json'}}),
    () => new Response(' '.repeat(WALLET_PROFILE_MAX_BYTES + 1_025), {headers: {'content-type': 'application/json'}}),
    () => new Response('[]', {headers: {'content-type': 'application/json', 'content-length': '90000000'}}),
    () => response([row({...state, value: {...profile, accessToken: TOKEN}})]),
  ]) await assert.rejects(new WalletProfileStore(config, USER, TOKEN, async () => upstream()).read(), /WALLET_UPSTREAM_INVALID/);
});
