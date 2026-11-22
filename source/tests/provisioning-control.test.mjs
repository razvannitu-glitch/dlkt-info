import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

const REF = 'abcdefghijklmnopqrst';
const URL = `https://${REF}.supabase.co`;
const KEY = `sb_publishable_${'a'.repeat(32)}`;
const INSTANCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_INSTANCE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FINGERPRINT = '453dbf1779705cff24a46781bbdae8871db5d24af5c3b16a1c85d65af4fc19db';
const READINESS_MIGRATION = '20261122174603_dlkt_info_news_coverage';
const RECEIPT = createHash('sha256').update(`${INSTANCE}:${FINGERPRINT}:${READINESS_MIGRATION}`).digest('hex');
const READY_ENV = Object.freeze({
  DLKT_INFO_SUPABASE_PROJECT_REF: REF,
  DLKT_INFO_SUPABASE_URL: URL,
  DLKT_INFO_SUPABASE_PUBLISHABLE_KEY: KEY,
  DLKT_INFO_DATABASE_INSTANCE_ID: INSTANCE,
  DLKT_INFO_DATA_FOUNDATION_READY: '1',
  DLKT_INFO_AUTH_ENABLED: '1',
  DLKT_INFO_REAL_DATA_ENABLED: '0',
  DLKT_INFO_SOURCE_ACQUISITION_ENABLED: '0',
  DLKT_INFO_DELIVERY_WORKERS_ENABLED: '0',
});
const IDENTITY = Object.freeze({
  version: 'dlkt-info-system-identity-1',
  instanceId: INSTANCE,
  productId: 'dlkt-info',
  engineId: 'dlkt-info-inphocore-engine-orchestra',
  dataFoundationVersion: 'dlkt-info-data-1',
  persistenceVersion: 'dlkt-info-persistence-2',
  schemaRevision: '20261113115256_dlkt_info_provisioning_identity_guard',
  dataRegion: 'eu-central-1',
  dedicated: true,
  automaticExecution: false,
  publicCardsEnabled: false,
});
const COUNTS = Object.freeze({
  relationsExpected: 32, relationsPresent: 32, relationsTotal: 32,
  functionsExpected: 58, functionsPresent: 58, functionsTotal: 58,
  rlsExpected: 20, rlsPresent: 20, rlsTotal: 20,
  policiesExpected: 29, policiesPresent: 29, policiesTotal: 29,
  triggersExpected: 34, triggersPresent: 34, triggersTotal: 34,
});
const CHECKS = Object.freeze({
  identity: true, relations: true, functions: true, rls: true, policies: true, triggers: true,
  privateSchema: true, privateTables: true, publicDataPermissions: true, publicRpcPermissions: true,
  privateFunctionPermissions: true, securityDefiner: true, searchPath: true, noUnexpectedObjects: true,
});
const READINESS = Object.freeze({
  version: 'dlkt-info-database-readiness-2',
  instanceId: INSTANCE,
  schemaRevision: READINESS_MIGRATION,
  schemaFingerprint: FINGERPRINT,
  activationReceipt: RECEIPT,
  ready: true,
  counts: COUNTS,
  checks: CHECKS,
  automaticExecution: false,
  publicCardsEnabled: false,
});

const LEGACY_FINGERPRINT = '474afcf3e10614cc4bb7c6c25531a37d118bdae5dcf65beb4287ecf0d0918b83';
const LEGACY_MIGRATION = '20261113125146_dlkt_info_database_readiness_attestation';
const LEGACY_CHECKS = Object.freeze(Object.fromEntries(Object.entries(CHECKS).filter(([key]) => key !== 'publicDataPermissions')));
const LEGACY_READINESS = Object.freeze({
  ...READINESS,
  version: 'dlkt-info-database-readiness-1',
  schemaRevision: LEGACY_MIGRATION,
  schemaFingerprint: LEGACY_FINGERPRINT,
  activationReceipt: createHash('sha256').update(`${INSTANCE}:${LEGACY_FINGERPRINT}:${LEGACY_MIGRATION}`).digest('hex'),
  checks: LEGACY_CHECKS,
});

const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers });

function apiRequest({ method = 'GET', marker, body = null, cookie } = {}) {
  const request = Readable.from(body === null ? [] : [JSON.stringify(body)]);
  request.method = method;
  request.headers = {
    origin: 'https://preview.example', host: 'preview.example', 'x-forwarded-host': 'preview.example',
    'x-forwarded-proto': 'https', 'x-dlkt-info-request': marker, 'content-type': 'application/json',
    'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty',
    ...(cookie ? { cookie } : {}),
  };
  return request;
}

function response() {
  const headers = new Map(); let body = '';
  return {
    value: { statusCode: 0, setHeader(name, value) { headers.set(String(name).toLowerCase(), value); }, end(value = '') { body = String(value); } },
    headers,
    json: () => JSON.parse(body),
  };
}

function attestationFetch(calls, identity = IDENTITY, readiness = READINESS) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/dlkt_info_read_system_identity')) return json(identity);
    if (String(url).endsWith('/dlkt_info_read_database_readiness')) return json(readiness);
    throw new Error(`UNEXPECTED_URL:${String(url)}`);
  };
}

test('manifest v6 fingerprint is reproducible from its exact versioned serialization', async () => {
  const {
    DATABASE_READINESS_VERSION, DATABASE_READINESS_MIGRATION, SCHEMA_MANIFEST_VERSION,
    EXPECTED_SCHEMA_MANIFEST, EXPECTED_SCHEMA_FINGERPRINT, serializeSchemaManifest,
  } = await import('../.build/src/provisioning/readiness-manifest.js');
  assert.equal(DATABASE_READINESS_VERSION, 'dlkt-info-database-readiness-2');
  assert.equal(DATABASE_READINESS_MIGRATION, READINESS_MIGRATION);
  assert.equal(SCHEMA_MANIFEST_VERSION, 'dlkt-info-schema-manifest-7');
  const bytes = JSON.stringify({ version: SCHEMA_MANIFEST_VERSION, manifest: EXPECTED_SCHEMA_MANIFEST });
  assert.equal(serializeSchemaManifest(), bytes);
  assert.equal(createHash('sha256').update(bytes, 'utf8').digest('hex'), FINGERPRINT);
  assert.equal(EXPECTED_SCHEMA_FINGERPRINT, FINGERPRINT);
  const changedManifest = structuredClone(EXPECTED_SCHEMA_MANIFEST);
  changedManifest.publicDataPermissions.authenticatedTables['public.dlkt_info_profiles'].push('TRUNCATE');
  assert.notEqual(createHash('sha256').update(JSON.stringify({ version: SCHEMA_MANIFEST_VERSION, manifest: changedManifest })).digest('hex'), FINGERPRINT);
  assert.notEqual(createHash('sha256').update(JSON.stringify({ version: 'dlkt-info-schema-manifest-2', manifest: EXPECTED_SCHEMA_MANIFEST })).digest('hex'), FINGERPRINT);
});

test('system identity and database readiness parsers are exact and immutable', async () => {
  const { readDatabaseReadiness, readSystemIdentity } = await import('../.build/src/provisioning/index.js');
  assert.deepEqual(readSystemIdentity(IDENTITY), IDENTITY);
  assert.deepEqual(readDatabaseReadiness(READINESS), READINESS);
  assert.equal(Object.isFrozen(readDatabaseReadiness(READINESS)), true);
  for (const malformed of [
    { ...IDENTITY, extra: true },
    { ...IDENTITY, productId: 'veciniada' },
  ]) assert.throws(() => readSystemIdentity(malformed), /SYSTEM_IDENTITY_INVALID/u);
  for (const malformed of [
    { ...READINESS, extra: true },
    { ...READINESS, schemaFingerprint: '0'.repeat(64) },
    { ...READINESS, activationReceipt: null },
    { ...READINESS, counts: { ...COUNTS, functionsTotal: COUNTS.functionsTotal + 1 } },
    { ...READINESS, checks: { ...CHECKS, rls: false } },
    LEGACY_READINESS,
    { ...READINESS, version: 'dlkt-info-database-readiness-1' },
    { ...READINESS, schemaRevision: LEGACY_MIGRATION },
    { ...READINESS, schemaFingerprint: LEGACY_FINGERPRINT },
    { ...READINESS, checks: LEGACY_CHECKS },
    { ...READINESS, checks: { ...CHECKS, publicDataPermissions: false } },
    { ...READINESS, checks: { ...CHECKS, publicDataPermissions: 'true' } },
  ]) assert.throws(() => readDatabaseReadiness(malformed), /DATABASE_READINESS_INVALID/u);
});

test('provisioning transport uses publishable apikey only and reads both attestations', async () => {
  const { SupabaseProvisioningTransport } = await import('../.build/src/provisioning/index.js');
  const { readPersistenceConfiguration } = await import('../.build/src/persistence/index.js');
  const configuration = readPersistenceConfiguration(READY_ENV);
  assert.equal(configuration.state, 'ready');
  const calls = [];
  const transport = new SupabaseProvisioningTransport(configuration, attestationFetch(calls));
  assert.deepEqual(await transport.readIdentity(), IDENTITY);
  assert.deepEqual(await transport.readReadiness(), READINESS);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.init.headers.apikey, KEY);
    assert.equal(Object.hasOwn(call.init.headers, 'Authorization'), false);
    assert.equal(call.init.body, '{}');
  }
  assert.doesNotMatch(JSON.stringify(calls), /sb_secret_|service_role|Bearer/u);
});

test('provisioning is fail-closed before configuration or instance binding without network access', async () => {
  const { projectProvisioningControl } = await import('../.build/src/provisioning/index.js');
  let calls = 0;
  const missing = await projectProvisioningControl({ environment: {}, fetch: async () => { calls++; throw new Error('must not run'); } });
  assert.equal(missing.blocker, 'DEDICATED_SUPABASE_PROJECT_REQUIRED');
  assert.equal(missing.schemaVerified, false);
  const unbound = await projectProvisioningControl({ environment: { ...READY_ENV, DLKT_INFO_DATABASE_INSTANCE_ID: '' }, fetch: async () => { calls++; throw new Error('must not run'); } });
  assert.equal(unbound.blocker, 'DLKT_INFO_DATABASE_INSTANCE_BINDING_REQUIRED');
  assert.equal(unbound.schemaVerified, false);
  assert.equal(calls, 0);
});

test('verified identity plus exact schema receipt unlock only explicitly enabled capabilities', async () => {
  const { projectProvisioningControl } = await import('../.build/src/provisioning/index.js');
  const calls = [];
  const result = await projectProvisioningControl({ environment: READY_ENV, fetch: attestationFetch(calls) });
  assert.equal(result.blocker, null);
  assert.equal(result.identityVerified, true);
  assert.equal(result.schemaVerified, true);
  assert.equal(result.schemaFingerprint, FINGERPRINT);
  assert.equal(result.activationReceipt, RECEIPT);
  assert.deepEqual(result.capabilities, {
    identity: true, foundation: true, auth: true, persistence: true,
    realData: false, sourceAcquisition: false, deliveryWorkers: false,
  });
  assert.equal(calls.length, 2);
});

test('wrong instance, missing readiness migration, schema drift and invalid receipt stay blocked', async () => {
  const { projectProvisioningControl } = await import('../.build/src/provisioning/index.js');
  const wrong = await projectProvisioningControl({ environment: READY_ENV, fetch: attestationFetch([], { ...IDENTITY, instanceId: OTHER_INSTANCE }) });
  assert.equal(wrong.blocker, 'DLKT_INFO_DATABASE_INSTANCE_MISMATCH');

  const missingReadiness = await projectProvisioningControl({ environment: READY_ENV, fetch: async (url) => {
    if (String(url).endsWith('/dlkt_info_read_system_identity')) return json(IDENTITY);
    return json({ message: 'missing' }, 404);
  } });
  assert.equal(missingReadiness.blocker, 'DLKT_INFO_DATABASE_READINESS_MIGRATION_REQUIRED');

  const drifted = await projectProvisioningControl({ environment: READY_ENV, fetch: attestationFetch([], IDENTITY, {
    ...READINESS, ready: false, activationReceipt: null, checks: { ...CHECKS, rls: false },
  }) });
  assert.equal(drifted.blocker, 'DLKT_INFO_DATABASE_NOT_READY');

  const wrongReceipt = await projectProvisioningControl({ environment: READY_ENV, fetch: attestationFetch([], IDENTITY, {
    ...READINESS, activationReceipt: 'f'.repeat(64),
  }) });
  assert.equal(wrongReceipt.blocker, 'DLKT_INFO_DATABASE_ACTIVATION_RECEIPT_INVALID');
});

test('old ready:true attestation and missing ACL checks cannot activate any capability', async () => {
  const { projectProvisioningControl } = await import('../.build/src/provisioning/index.js');
  for (const readiness of [LEGACY_READINESS, { ...READINESS, checks: LEGACY_CHECKS }]) {
    const result = await projectProvisioningControl({ environment: READY_ENV, fetch: attestationFetch([], IDENTITY, readiness) });
    assert.equal(result.blocker, 'DLKT_INFO_DATABASE_READINESS_INVALID');
    assert.equal(result.schemaVerified, false);
    assert.equal(result.activationReceipt, null);
    assert.equal(Object.values(result.capabilities).every((enabled) => enabled === false), true);
  }
  const result = await projectProvisioningControl({ environment: READY_ENV, fetch: attestationFetch([], IDENTITY, {
    ...READINESS, ready: false, activationReceipt: null, checks: { ...CHECKS, publicDataPermissions: false },
  }) });
  assert.equal(result.blocker, 'DLKT_INFO_DATABASE_NOT_READY');
  assert.equal(result.schemaVerified, false);
  assert.equal(result.activationReceipt, null);
  assert.equal(Object.values(result.capabilities).every((enabled) => enabled === false), true);
});

test('provisioning health is private, bounded and exposes no database credential', async () => {
  const { handleProvisioningHealth } = await import('../.build/api/provisioning-health.js');
  const res = response();
  await handleProvisioningHealth(apiRequest(), res.value, { environment: READY_ENV, fetch: attestationFetch([]) });
  assert.equal(res.value.statusCode, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const body = res.json();
  assert.equal(body.provisioning.schemaVerified, true);
  assert.equal(body.provisioning.schemaFingerprint, FINGERPRINT);
  assert.equal(body.provisioning.activationReceipt, RECEIPT);
  assert.doesNotMatch(JSON.stringify(body), /sb_publishable_|supabase\.co|service_role|sb_secret_/u);
});

test('Auth and Persistence reject a different or unready database before user-data access', async () => {
  const { handleIdentityRequest } = await import('../.build/api/auth.js');
  const { handlePersistenceRequest } = await import('../.build/api/persistence.js');
  const foreignIdentity = { ...IDENTITY, instanceId: OTHER_INSTANCE };
  const authCalls = [];
  const authResponse = response();
  await handleIdentityRequest(apiRequest({ method: 'POST', marker: 'identity-v1', body: {
    action: 'request-code', email: 'person@example.com', timezone: 'Europe/Bucharest', locale: 'en',
  } }), authResponse.value, { environment: READY_ENV, fetch: async (url) => { authCalls.push(String(url)); return json(foreignIdentity); } });
  assert.equal(authResponse.value.statusCode, 503);
  assert.equal(authResponse.json().reason, 'DLKT_INFO_DATABASE_INSTANCE_MISMATCH');
  assert.equal(authCalls.length, 1);

  const persistenceCalls = [];
  const persistenceResponse = response();
  await handlePersistenceRequest(apiRequest({ marker: 'persistence-v1', cookie: '__Host-dlkt_info_at=aaaaaaaa.bbbbbbbb.cccccccc' }), persistenceResponse.value, {
    environment: READY_ENV,
    fetch: async (url) => {
      persistenceCalls.push(String(url));
      if (String(url).endsWith('/dlkt_info_read_system_identity')) return json(IDENTITY);
      if (String(url).endsWith('/dlkt_info_read_database_readiness')) return json({ ...READINESS, ready: false, activationReceipt: null, checks: { ...CHECKS, policies: false } });
      throw new Error('user data must not be touched');
    },
  });
  assert.equal(persistenceResponse.value.statusCode, 503);
  assert.equal(persistenceResponse.json().reason, 'DLKT_INFO_DATABASE_NOT_READY');
  assert.equal(persistenceCalls.length, 2);
});
