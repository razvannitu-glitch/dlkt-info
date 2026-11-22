import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

const REF = 'abcdefghijklmnopqrst';
const URL = `https://${REF}.supabase.co`;
const KEY = `sb_publishable_${'a'.repeat(32)}`;
const ACCESS_ONE = 'abcdefgh.ijklmnop.qrstuvwx';
const ACCESS_TWO = 'mnopqrst.uvwxyzAB.CDEFGHIJ';
const REFRESH_ONE = 'refresh_token_value_00000001';
const REFRESH_TWO = 'refresh_token_value_00000002';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const USER = Object.freeze({ id: USER_ID, email: 'person@example.com' });
const BRIEFING_ID = '33333333-3333-4333-8333-333333333333';
const TRUST_POLICY = Object.freeze({
  minimumTrust: 'corroborated',
  conflictPolicy: 'exclude',
  authorityRequirement: 'primary',
  minimumSources: 2,
  maximumEvidenceAgeHours: 72,
  requireOfficialForHighImpact: true,
});
const READY_ENV = Object.freeze({
  DLKT_INFO_SUPABASE_PROJECT_REF: REF,
  DLKT_INFO_SUPABASE_URL: URL,
  DLKT_INFO_SUPABASE_PUBLISHABLE_KEY: KEY,
  DLKT_INFO_DATA_FOUNDATION_READY: '1',
  DLKT_INFO_AUTH_ENABLED: '1',
  DLKT_INFO_REAL_DATA_ENABLED: '0',
  DLKT_INFO_SOURCE_ACQUISITION_ENABLED: '0',
  DLKT_INFO_DELIVERY_WORKERS_ENABLED: '0',
  DLKT_INFO_DATABASE_INSTANCE_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
});
const READY_PROVISIONING = Object.freeze({
  version: 'dlkt-info-provisioning-control-2',
  configuration: 'ready',
  configured: true,
  instanceBound: true,
  identityState: 'verified',
  identityVerified: true,
  readinessState: 'verified',
  schemaVerified: true,
  schemaFingerprint: 'ef03f90d229d089f8871c64b996994c79c65d0e1e3a0f8e2b0bb08dc2d6f6dec',
  activationReceipt: 'a'.repeat(64),
  capabilities: Object.freeze({
    identity: true,
    foundation: true,
    auth: true,
    persistence: true,
    realData: false,
    sourceAcquisition: false,
    deliveryWorkers: false,
  }),
  blocker: null,
  failClosed: true,
  environmentFlagsAreInsufficient: true,
  secretsExposed: false,
});

const PROJECTION = Object.freeze({
  version: 'dlkt-info-persistence-2',
  profile: { locale: 'en', timezone: 'Europe/Bucharest', plan: 'free', onboardingState: 'new' },
  briefing: { id: BRIEFING_ID, name: 'Personal Briefing', timezone: 'Europe/Bucharest', deliveryLocalTime: '08:00', weekdays: [1,2,3,4,5,6,7], maxCards: 5, status: 'active', version: 1, nextDeliveryAt: '2026-11-12T06:00:00.000Z' },
  trustPolicy: TRUST_POLICY,
  rule: { topics: ['technology'], entities: ['OpenAI'], minMateriality: 'high', onlyActionable: true },
});

function request({
  method = 'GET',
  body = null,
  origin = 'https://preview.example',
  host = 'preview.example',
  marker = 'persistence-v1',
  cookie = `__Host-dlkt_info_at=${ACCESS_ONE}; __Host-dlkt_info_rt=${REFRESH_ONE}`,
  authorization,
  contentType = 'application/json',
  fetchSite = 'same-origin',
  fetchMode = 'cors',
  fetchDest = 'empty',
} = {}) {
  const stream = Readable.from(body === null ? [] : [JSON.stringify(body)]);
  stream.method = method;
  stream.headers = {
    ...(origin === null ? {} : { origin }),
    host,
    'x-forwarded-host': host,
    'x-forwarded-proto': 'https',
    'x-dlkt-info-request': marker,
    'content-type': contentType,
    'sec-fetch-site': fetchSite,
    'sec-fetch-mode': fetchMode,
    'sec-fetch-dest': fetchDest,
    ...(cookie ? { cookie } : {}),
    ...(authorization ? { authorization } : {}),
  };
  return stream;
}

function response() {
  const headers = new Map();
  let body = '';
  return {
    value: {
      statusCode: 0,
      setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
      end(value = '') { body = String(value); },
    },
    headers,
    json: () => JSON.parse(body),
  };
}

const json = (value, status = 200) => Response.json(value, { status });

function session(access = ACCESS_ONE, refresh = REFRESH_ONE) {
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: 3600,
    token_type: 'bearer',
    user: USER,
  };
}

function persistenceFetch(calls, projection = PROJECTION) {
  return async (url, init) => {
    const entry = { url: String(url), init, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(entry);
    if (entry.url === `${URL}/auth/v1/user`) {
      assert.equal(init.headers.Authorization, `Bearer ${ACCESS_ONE}`);
      return json(USER);
    }
    if (entry.url.includes('/rest/v1/rpc/')) return json(projection);
    throw new Error(`UNEXPECTED_URL:${entry.url}`);
  };
}

test('persistence configuration never falls back to another project environment', async () => {
  const { readPersistenceConfiguration } = await import('../.build/src/persistence/index.js');
  assert.deepEqual(readPersistenceConfiguration({
    SUPABASE_URL: 'https://wrong.supabase.co',
    SUPABASE_ANON_KEY: 'wrong',
    NEXT_PUBLIC_SUPABASE_URL: 'https://wrong.supabase.co',
  }), { state: 'missing', code: 'DLKT_INFO_SUPABASE_NOT_CONFIGURED' });
});

test('persistence configuration binds URL, project ref, publishable key and readiness gates', async () => {
  const { readPersistenceConfiguration, persistenceRuntimeProjection } = await import('../.build/src/persistence/index.js');
  const ready = readPersistenceConfiguration(READY_ENV);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.projectRef, REF);
  assert.equal(ready.url, URL);
  assert.equal(ready.authEnabled, true);
  assert.equal(ready.realDataEnabled, false);
  assert.equal(persistenceRuntimeProjection(ready).authEnabled, true);
  assert.equal(readPersistenceConfiguration({ ...READY_ENV, DLKT_INFO_SUPABASE_PROJECT_REF: 'zzzzzzzzzzzzzzzzzzzz' }).code, 'DLKT_INFO_SUPABASE_URL_PROJECT_MISMATCH');
  assert.equal(readPersistenceConfiguration({ ...READY_ENV, DLKT_INFO_SUPABASE_PUBLISHABLE_KEY: `sb_secret_${'a'.repeat(32)}` }).code, 'DLKT_INFO_SUPABASE_PUBLISHABLE_KEY_INVALID');
  assert.equal(readPersistenceConfiguration({ ...READY_ENV, DLKT_INFO_DATA_FOUNDATION_READY: '0', DLKT_INFO_AUTH_ENABLED: '1' }).code, 'DLKT_INFO_AUTH_REQUIRES_FOUNDATION');
  assert.equal(readPersistenceConfiguration({ ...READY_ENV, DLKT_INFO_DATA_FOUNDATION_READY: '0', DLKT_INFO_AUTH_ENABLED: '0', DLKT_INFO_REAL_DATA_ENABLED: '1' }).code, 'DLKT_INFO_REAL_DATA_REQUIRES_FOUNDATION');
  assert.equal(readPersistenceConfiguration({ ...READY_ENV, DLKT_INFO_AUTH_ENABLED: 'yes' }).code, 'DLKT_INFO_AUTH_FLAG_INVALID');
});

test('user RPC transport calls only the dedicated project and never exposes a secret key', async () => {
  const { readPersistenceConfiguration, SupabaseUserRpcTransport } = await import('../.build/src/persistence/index.js');
  const configuration = readPersistenceConfiguration(READY_ENV);
  assert.equal(configuration.state, 'ready');
  const calls = [];
  const transport = new SupabaseUserRpcTransport(configuration, async (url, init) => {
    calls.push({ url: String(url), init });
    return json(PROJECTION);
  });
  const result = await transport.call('dlkt_info_read_companion_configuration', {}, ACCESS_ONE);
  assert.deepEqual(result, PROJECTION);
  assert.equal(calls[0].url, `${URL}/rest/v1/rpc/dlkt_info_read_companion_configuration`);
  assert.equal(calls[0].init.headers.apikey, KEY);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${ACCESS_ONE}`);
  assert.doesNotMatch(JSON.stringify(calls[0]), /service_role|sb_secret_/u);
  await assert.rejects(() => transport.call('unknown_rpc', {}, ACCESS_ONE), /RPC_FORBIDDEN/u);
});

test('persistence readiness is explicit and fail-closed before provisioning', async () => {
  const { handlePersistenceHealth } = await import('../.build/api/persistence-health.js');
  const res = response();
  await handlePersistenceHealth(request(), res.value, {});
  assert.equal(res.value.statusCode, 503);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.json().blocker, 'DEDICATED_SUPABASE_PROJECT_REQUIRED');
  assert.equal(res.json().authEnabled, false);
  assert.equal(res.json().configured, false);
});

test('persistence API blocks missing dedicated configuration before any upstream request', async () => {
  const { handlePersistenceRequest } = await import('../.build/api/persistence.js');
  let calls = 0;
  const res = response();
  await handlePersistenceRequest(request(), res.value, {
    environment: {},
    fetch: async () => { calls++; throw new Error('must not run'); },
  });
  assert.equal(res.value.statusCode, 503);
  assert.deepEqual(res.json(), { error: 'PERSISTENCE_NOT_PROVISIONED', reason: 'DEDICATED_SUPABASE_PROJECT_REQUIRED' });
  assert.equal(calls, 0);
});

test('authenticated GET and PUT use server-side HttpOnly session and bounded RPCs', async () => {
  const { handlePersistenceRequest } = await import('../.build/api/persistence.js');
  const calls = [];

  const get = response();
  await handlePersistenceRequest(request(), get.value, { environment: READY_ENV, provisioning: READY_PROVISIONING, fetch: persistenceFetch(calls) });
  assert.equal(get.value.statusCode, 200);
  assert.deepEqual(get.json(), PROJECTION);
  assert.equal(get.headers.get('cache-control'), 'private, no-store');

  const put = response();
  await handlePersistenceRequest(request({
    method: 'PUT',
    body: {
      briefingId: BRIEFING_ID,
      topics: ['regulation', 'opportunities'],
      entities: ['OpenAI', 'EU AI Act'],
      timezone: 'Europe/Bucharest',
      deliveryLocalTime: '06:30',
      maxCards: 3,
      minMateriality: 'high',
      onlyActionable: true,
      trustPolicy: TRUST_POLICY,
    },
  }), put.value, { environment: READY_ENV, provisioning: READY_PROVISIONING, fetch: persistenceFetch(calls) });
  assert.equal(put.value.statusCode, 200);
  assert.deepEqual(put.json(), PROJECTION);

  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, `${URL}/auth/v1/user`);
  assert.match(calls[1].url, /dlkt_info_read_companion_configuration$/u);
  assert.equal(calls[2].url, `${URL}/auth/v1/user`);
  assert.match(calls[3].url, /dlkt_info_save_companion_configuration$/u);
  assert.deepEqual(calls[3].body.p_topics, ['regulation', 'opportunities']);
  assert.deepEqual(calls[3].body.p_entities, ['OpenAI', 'EU AI Act']);
  assert.equal(calls[3].body.p_briefing_id, BRIEFING_ID);
  assert.equal(calls[3].body.p_minimum_trust, TRUST_POLICY.minimumTrust);
  assert.equal(calls[3].body.p_conflict_policy, TRUST_POLICY.conflictPolicy);
  assert.equal(calls[3].body.p_authority_requirement, TRUST_POLICY.authorityRequirement);
  assert.equal(calls[3].body.p_minimum_sources, TRUST_POLICY.minimumSources);
  assert.equal(calls[3].body.p_maximum_evidence_age_hours, TRUST_POLICY.maximumEvidenceAgeHours);
  assert.equal(calls[3].body.p_require_official_for_high_impact, true);
  assert.equal(calls[3].init.headers.apikey, KEY);
});

test('persistence ignores browser Authorization and requires the HttpOnly session cookie', async () => {
  const { handlePersistenceRequest } = await import('../.build/api/persistence.js');
  let calls = 0;
  const res = response();
  await handlePersistenceRequest(request({ cookie: '', authorization: `Bearer ${ACCESS_ONE}` }), res.value, {
    environment: READY_ENV,
    provisioning: READY_PROVISIONING,
    fetch: async () => { calls++; throw new Error('must not run'); },
  });
  assert.equal(res.value.statusCode, 401);
  assert.deepEqual(res.json(), { error: 'AUTHENTICATION_REQUIRED' });
  assert.equal(calls, 0);
});

test('persistence refreshes an expired access cookie before calling the RPC', async () => {
  const { handlePersistenceRequest } = await import('../.build/api/persistence.js');
  const calls = [];
  const res = response();
  await handlePersistenceRequest(request(), res.value, {
    environment: READY_ENV,
    provisioning: READY_PROVISIONING,
    fetch: async (url, init) => {
      const entry = { url: String(url), init, body: init?.body ? JSON.parse(String(init.body)) : null };
      calls.push(entry);
      if (entry.url === `${URL}/auth/v1/user`) return json({ message: 'expired' }, 401);
      if (entry.url === `${URL}/auth/v1/token?grant_type=refresh_token`) return json(session(ACCESS_TWO, REFRESH_TWO));
      if (entry.url.includes('/rest/v1/rpc/')) {
        assert.equal(init.headers.Authorization, `Bearer ${ACCESS_TWO}`);
        return json(PROJECTION);
      }
      throw new Error(`UNEXPECTED_URL:${entry.url}`);
    },
  });
  assert.equal(res.value.statusCode, 200);
  assert.equal(calls.length, 3);
  const cookies = res.headers.get('set-cookie');
  assert.ok(Array.isArray(cookies));
  assert.equal(cookies.length, 2);
});

test('persistence API rejects foreign origins, missing marker, missing session and malformed configuration', async () => {
  const { handlePersistenceRequest } = await import('../.build/api/persistence.js');
  const cases = [
    [request({ origin: 'https://attacker.example' }), 403],
    [request({ marker: '' }), 403],
    [request({ cookie: '' }), 401],
  ];
  for (const [req, status] of cases) {
    const res = response();
    await handlePersistenceRequest(req, res.value, { environment: READY_ENV, provisioning: READY_PROVISIONING, fetch: async () => { throw new Error('unexpected'); } });
    assert.equal(res.value.statusCode, status);
  }

  const malformed = response();
  await handlePersistenceRequest(request({ method: 'PUT', body: { topics: [] } }), malformed.value, {
    environment: READY_ENV,
    provisioning: READY_PROVISIONING,
    fetch: persistenceFetch([]),
  });
  assert.equal(malformed.value.statusCode, 400);
  assert.deepEqual(malformed.json(), { error: 'INVALID_CONFIGURATION' });
});

test('persistence projection rejects malformed or over-broad upstream payloads', async () => {
  const { readCompanionPersistenceProjection } = await import('../.build/src/persistence/index.js');
  assert.deepEqual(readCompanionPersistenceProjection(PROJECTION), PROJECTION);
  assert.throws(() => readCompanionPersistenceProjection({ ...PROJECTION, secret: 'must-not-pass' }), /PROJECTION_INVALID/u);
  assert.throws(() => readCompanionPersistenceProjection({ ...PROJECTION, rule: null }), /PROJECTION_INVALID/u);
  assert.throws(() => readCompanionPersistenceProjection({ ...PROJECTION, trustPolicy: { ...TRUST_POLICY, minimumTrust: 'invented' } }), /PROJECTION_INVALID/u);
  assert.throws(() => readCompanionPersistenceProjection({ ...PROJECTION, briefing: { ...PROJECTION.briefing, id: 'not-a-uuid' } }), /PROJECTION_INVALID/u);
});

test('persistence API rejects malformed successful upstream response', async () => {
  const { handlePersistenceRequest } = await import('../.build/api/persistence.js');
  const res = response();
  await handlePersistenceRequest(request(), res.value, {
    environment: READY_ENV,
    provisioning: READY_PROVISIONING,
    fetch: async (url, init) => {
      if (String(url) === `${URL}/auth/v1/user`) return json(USER);
      return json({ ...PROJECTION, extra: true });
    },
  });
  assert.equal(res.value.statusCode, 502);
  assert.deepEqual(res.json(), { error: 'PERSISTENCE_UPSTREAM_FAILED' });
});
