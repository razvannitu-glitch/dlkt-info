import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handleWallet} from '../.build/api/wallet.js';
import {WALLET_PROFILE_VERSION, WALLET_PROFILE_MAX_BYTES, parseWalletSnapshot} from '../.build/src/wallet/contracts.js';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const REV = '33333333-3333-4333-8333-333333333333';
const token = (sub = USER, role = 'authenticated') => [
  Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url'),
  Buffer.from(JSON.stringify({sub, role})).toString('base64url'),
  'testSignatureOnly00000000',
].join('.');
const TOKEN = token();
const profile = {displayName: 'Razvan', locale: 'ro-RO', timezone: 'Europe/Bucharest', briefingTime: '08:30', interests: ['technology'], personalPriority: 'personal-first'};
const state = {version: WALLET_PROFILE_VERSION, revision: REV, updatedAt: '2026-11-18T12:00:00.000Z', value: profile};
const env = {NODE_ENV: 'production', DLKT_INFO_ACCOUNT_BRIDGE_ENABLED: '1', DLKT_INFO_AUTH_EMAIL_READY: '1', DLKT_INFO_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', DLKT_INFO_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', DLKT_INFO_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'x'.repeat(30), DLKT_INFO_DATA_FOUNDATION_READY: '1', DLKT_INFO_AUTH_ENABLED: '1'};
const provisioning = {configured: true, schemaVerified: true, capabilities: {auth: true, persistence: true}};
const response = value => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}});
const row = value => ({owner_id: USER, memory_key: 'wallet-profile-v1', memory_type: 'preference', state: value});

function request(method = 'GET', body, headers = {}, raw) {
  const req = Readable.from(raw !== undefined ? [Buffer.from(raw)] : body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = '/api/wallet';
  req.headers = {host: 'www.dlkt.ee', origin: 'https://www.dlkt.ee', 'x-forwarded-proto': 'https', 'x-dlkt-info-request': 'wallet-v1', 'content-type': 'application/json', cookie: `__Host-dlkt_info_at=${TOKEN}`, ...headers};
  return req;
}

function result() {
  return {statusCode: 0, headers: {}, body: null, setHeader(key, value) {this.headers[key] = value;}, end(value) {this.body = JSON.parse(value);}};
}

async function run(req, dependencies = {}) {
  const res = result();
  await handleWallet(req, res, dependencies);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers.Vary, 'Cookie, Origin');
  return res;
}

function authenticated(storage) {
  return async (url, init) => {
    if (String(url).endsWith('/auth/v1/user')) {
      assert.equal(init.headers.Authorization, 'Bearer ' + TOKEN);
      return response({id: USER, email: 'reader@example.test'});
    }
    return storage(url, init);
  };
}

test('unconfigured wallet GET is an honest unavailable snapshot without I/O or PII', async () => {
  let calls = 0;
  const res = await run(request(), {environment: {}, fetch: async () => {calls++; throw new Error('forbidden network');}});
  assert.equal(res.statusCode, 200);
  assert.equal(parseWalletSnapshot(res.body).account, 'unavailable');
  assert.equal(res.body.profile, null);
  assert.deepEqual(res.body.activity, {state: 'unavailable', events: [], checkedAt: null});
  assert.equal(JSON.stringify(res.body).includes(USER), false);
  assert.equal(JSON.stringify(res.body).includes(profile.displayName), false);
  assert.equal(calls, 0);
});

test('closed account, email and schema gates cannot be bypassed by wallet', async () => {
  for (const dependencies of [
    {environment: {...env, DLKT_INFO_ACCOUNT_BRIDGE_ENABLED: '0'}, provisioning},
    {environment: {...env, DLKT_INFO_AUTH_EMAIL_READY: '0'}, provisioning},
    {environment: env, provisioning: {...provisioning, schemaVerified: false}},
    {environment: env, provisioning: {...provisioning, capabilities: {auth: true, persistence: false}}},
  ]) {
    let calls = 0;
    const res = await run(request(), {...dependencies, fetch: async () => {calls++; throw new Error('forbidden network');}});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.account, 'unavailable');
    assert.equal(calls, 0);
  }
});

test('disabled wallet writes do not consume private body or call identity/storage', async () => {
  for (const method of ['PUT', 'DELETE']) {
    let bodyReads = 0, calls = 0;
    const req = Readable.from((async function* () {bodyReads++; yield Buffer.from(JSON.stringify({value: profile}));})());
    const template = request(method); req.method = method; req.url = template.url; req.headers = template.headers;
    const res = await run(req, {environment: {}, fetch: async () => {calls++; throw new Error('forbidden network');}});
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'WALLET_UNAVAILABLE');
    assert.equal(bodyReads, 0);
    assert.equal(calls, 0);
  }
});

test('signed-out GET returns a private empty snapshot and mutations require authentication', async () => {
  let calls = 0;
  const dependencies = {environment: env, provisioning, fetch: async () => {calls++; throw new Error('forbidden network');}};
  const res = await run(request('GET', undefined, {cookie: ''}), dependencies);
  assert.equal(res.statusCode, 200);
  assert.equal(parseWalletSnapshot(res.body).account, 'signed-out');
  assert.equal(res.body.profile, null);
  for (const method of ['PUT', 'DELETE']) {
    const denied = await run(request(method, {expectedRevision: REV, value: profile}, {cookie: ''}), dependencies);
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.body.error, 'AUTHENTICATION_REQUIRED');
  }
  assert.equal(calls, 0);
});

test('expired session without refresh cannot fetch wallet profile', async () => {
  let calls = 0;
  const res = await run(request(), {environment: env, provisioning, fetch: async url => {
    calls++; assert.equal(String(url).endsWith('/auth/v1/user'), true);
    return new Response('{}', {status: 401, headers: {'content-type': 'application/json'}});
  }});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.account, 'signed-out');
  assert.equal(calls, 1);
  assert.equal(res.headers['Set-Cookie'].every(cookie => cookie.includes('Max-Age=0')), true);
});

test('wallet resolves verified session ownership and exposes no session or email fields', async () => {
  let storageReads = 0;
  const res = await run(request(), {environment: env, provisioning, fetch: authenticated(async (url, init) => {
    storageReads++;
    assert.equal(new URL(url).searchParams.get('owner_id'), 'eq.' + USER);
    assert.equal(init.headers.Authorization, 'Bearer ' + TOKEN);
    return response([row(state)]);
  })});
  assert.equal(res.statusCode, 200);
  assert.equal(parseWalletSnapshot(res.body).account, 'signed-in');
  assert.deepEqual(res.body.profile, state);
  assert.equal(storageReads, 1);
  assert.equal(JSON.stringify(res.body).includes(TOKEN), false);
  assert.equal(JSON.stringify(res.body).includes('reader@example.test'), false);
});

test('same-origin marker, allowed host, fetch metadata and no-query guard run before I/O', async () => {
  let calls = 0;
  const dependencies = {environment: env, provisioning, fetch: async () => {calls++; throw new Error('forbidden network');}};
  const requests = [
    request('GET', undefined, {origin: 'https://evil.example'}),
    request('GET', undefined, {origin: 'https://www.dlkt.ee/path'}),
    request('GET', undefined, {host: 'evil.example', origin: 'https://evil.example'}),
    request('GET', undefined, {'x-dlkt-info-request': 'account-v1'}),
    request('GET', undefined, {'sec-fetch-site': 'cross-site'}),
  ];
  for (const req of requests) assert.equal((await run(req, dependencies)).statusCode, 403);
  for (const url of ['/api/wallet?owner_id=' + OTHER, '/api/wallet#profile']) {
    const req = request(); req.url = url;
    const res = await run(req, dependencies);
    assert.equal(res.statusCode, 400); assert.equal(res.body.error, 'QUERY_NOT_ALLOWED');
  }
  assert.equal((await run(request('POST', profile), dependencies)).statusCode, 405);
  assert.equal(calls, 0);
});

test('wallet create and update persist only profile preferences then return honest snapshots', async () => {
  for (const revision of [null, REV]) {
    let writes = 0;
    const res = await run(request('PUT', {expectedRevision: revision, value: profile}), {environment: env, provisioning, fetch: authenticated(async (url, init) => {
      writes++;
      assert.equal(init.method, revision === null ? 'POST' : 'PATCH');
      assert.equal(new URL(url).searchParams.get('state->>revision'), revision === null ? null : 'eq.' + REV);
      const body = JSON.parse(init.body);
      assert.deepEqual(body.state.value, profile);
      assert.equal('accessToken' in body, false);
      return response([revision === null ? body : row(body.state)]);
    })});
    assert.equal(res.statusCode, 200);
    assert.equal(writes, 1);
    assert.deepEqual(parseWalletSnapshot(res.body).profile.value, profile);
    assert.equal(res.body.activity.state, 'not-connected');
    assert.equal(res.body.providers.every(provider => provider.status === 'unavailable' && !provider.connectionAvailable), true);
  }
});

test('wallet delete removes the exact owned revision and returns no cached profile', async () => {
  const res = await run(request('DELETE', {expectedRevision: REV}), {environment: env, provisioning, fetch: authenticated(async (url, init) => {
    assert.equal(init.method, 'DELETE');
    assert.equal(new URL(url).searchParams.get('state->>revision'), 'eq.' + REV);
    return response([row(state)]);
  })});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.account, 'signed-in');
  assert.equal(res.body.profile, null);
});

test('owner, provider, unknown and invalid fields cannot enter wallet storage', async () => {
  let writes = 0;
  const dependencies = {environment: env, provisioning, fetch: authenticated(async () => {writes++; throw new Error('forbidden write');})};
  for (const body of [
    {expectedRevision: null, value: profile, owner_id: OTHER},
    {expectedRevision: null, value: {...profile, owner_id: OTHER}},
    {expectedRevision: null, value: {...profile, connectedAccounts: ['gmail']}},
    {expectedRevision: '*', value: profile},
    {value: profile}, {expectedRevision: null},
    {expectedRevision: null, value: {...profile, timezone: 'not/a-zone'}},
    {expectedRevision: null, value: {...profile, interests: ['technology', 'technology']}},
    null, [],
  ]) assert.equal((await run(request('PUT', body), dependencies)).statusCode, 400);
  for (const body of [{expectedRevision: null}, {expectedRevision: REV, owner_id: USER}, {expectedRevision: REV, value: profile}, {}]) {
    assert.equal((await run(request('DELETE', body), dependencies)).statusCode, 400);
  }
  assert.equal(writes, 0);
});

test('wallet request JSON type, empty/malformed body and 16KiB stream cap are enforced', async () => {
  let writes = 0;
  const dependencies = {environment: env, provisioning, fetch: authenticated(async () => {writes++; throw new Error('forbidden write');})};
  assert.equal((await run(request('PUT', {expectedRevision: null, value: profile}, {'content-type': 'text/plain'}), dependencies)).statusCode, 415);
  assert.equal((await run(request('PUT'), dependencies)).statusCode, 400);
  assert.equal((await run(request('PUT', undefined, {}, '{'), dependencies)).statusCode, 400);
  assert.equal((await run(request('PUT', undefined, {}, ' '.repeat(WALLET_PROFILE_MAX_BYTES + 1)), dependencies)).statusCode, 413);
  assert.equal(writes, 0);
});

test('revision conflicts cannot be reported as successful updates or deletions', async () => {
  const dependencies = {environment: env, provisioning, fetch: authenticated(async () => response([]))};
  for (const [method, body] of [['PUT', {expectedRevision: REV, value: profile}], ['DELETE', {expectedRevision: REV}]]) {
    const res = await run(request(method, body), dependencies);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'WALLET_CONFLICT');
  }
});

test('upstream corruption or foreign owner data is a sanitized failure with no private payload', async () => {
  for (const upstream of [
    () => response([{...row(state), owner_id: OTHER}]),
    () => response([row({...state, value: {...profile, accessToken: TOKEN}})]),
    () => new Response('{', {headers: {'content-type': 'application/json'}}),
    () => new Response('upstream private detail', {status: 500}),
  ]) {
    const res = await run(request(), {environment: env, provisioning, fetch: authenticated(async () => upstream())});
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, {error: 'WALLET_UPSTREAM_UNAVAILABLE'});
  }
});

test('an admin JWT or secret key cannot become a wallet data credential', async () => {
  let writes = 0;
  const res = await run(request('GET', undefined, {cookie: `__Host-dlkt_info_at=${token(USER, 'service_role')}`}), {
    environment: env, provisioning, fetch: async url => {
      if (String(url).endsWith('/auth/v1/user')) return response({id: USER, email: 'reader@example.test'});
      writes++; throw new Error('forbidden write');
    },
  });
  assert.equal(res.statusCode, 401);
  const secret = await run(request(), {environment: {...env, DLKT_INFO_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_' + 'x'.repeat(30)}, provisioning, fetch: async () => {writes++; throw new Error('forbidden network');}});
  assert.equal(secret.body.account, 'unavailable');
  assert.equal(writes, 0);
});
