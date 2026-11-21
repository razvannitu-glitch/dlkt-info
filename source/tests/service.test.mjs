import assert from 'node:assert/strict';
import test from 'node:test';

const REF = 'abcdefghijklmnopqrst';
const URL = `https://${REF}.supabase.co`;
const PUBLISHABLE = `sb_publishable_${'p'.repeat(32)}`;
const SECRET = `sb_secret_${'s'.repeat(32)}`;
const CRON = 'cron_secret_value_0123456789abcdef';
const READY_ENV = Object.freeze({
  DLKT_INFO_SUPABASE_PROJECT_REF: REF,
  DLKT_INFO_SUPABASE_URL: URL,
  DLKT_INFO_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  DLKT_INFO_DATA_FOUNDATION_READY: '1',
  DLKT_INFO_AUTH_ENABLED: '0',
  DLKT_INFO_REAL_DATA_ENABLED: '1',
  DLKT_INFO_SOURCE_ACQUISITION_ENABLED: '1',
  DLKT_INFO_DELIVERY_WORKERS_ENABLED: '0',
  DLKT_INFO_SUPABASE_SECRET_KEY: SECRET,
  CRON_SECRET: CRON,
});

test('service configuration activates only for the dedicated project and explicit acquisition gates', async () => {
  const { readServiceConfiguration } = await import('../.build/src/service/index.js');
  const ready = readServiceConfiguration(READY_ENV);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.persistence.projectRef, REF);
  assert.equal(ready.secretKey, SECRET);
  assert.equal(ready.cronSecret, CRON);
  assert.deepEqual(readServiceConfiguration({ SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: SECRET }),
    { state: 'missing', code: 'DLKT_INFO_SUPABASE_NOT_CONFIGURED' });
  assert.equal(readServiceConfiguration({ ...READY_ENV, DLKT_INFO_SOURCE_ACQUISITION_ENABLED: '0' }).code,
    'DLKT_INFO_SOURCE_ACQUISITION_NOT_ENABLED');
  assert.equal(readServiceConfiguration({ ...READY_ENV, DLKT_INFO_SUPABASE_SECRET_KEY: `sb_publishable_${'x'.repeat(32)}` }).code,
    'DLKT_INFO_SECRET_KEY_INVALID');
  assert.equal(readServiceConfiguration({ ...READY_ENV, CRON_SECRET: 'short' }).code,
    'DLKT_INFO_CRON_SECRET_INVALID');
});

test('service RPC transport sends the secret only as apikey and enforces a strict RPC allowlist', async () => {
  const { readServiceConfiguration, SupabaseServiceRpcTransport } = await import('../.build/src/service/index.js');
  const configuration = readServiceConfiguration(READY_ENV);
  assert.equal(configuration.state, 'ready');
  const calls = [];
  const transport = new SupabaseServiceRpcTransport(configuration, async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json([{ ok: true }]);
  });
  assert.deepEqual(await transport.call('dlkt_info_read_source_acquisition', { p_source_key: 'eu-eurlex-legislation' }), [{ ok: true }]);
  assert.equal(calls[0].url, `${URL}/rest/v1/rpc/dlkt_info_read_source_acquisition`);
  assert.equal(calls[0].init.headers.apikey, SECRET);
  assert.equal('Authorization' in calls[0].init.headers, false);
  assert.doesNotMatch(String(calls[0].init.body), /sb_secret_/u);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.cache, 'no-store');
  await assert.rejects(() => transport.call('dlkt_info_read_companion_configuration', {}), /DLKT_INFO_SERVICE_RPC_NOT_ALLOWED/u);
});

test('service transport rejects oversized or malformed provider responses', async () => {
  const { readServiceConfiguration, SupabaseServiceRpcTransport } = await import('../.build/src/service/index.js');
  const configuration = readServiceConfiguration(READY_ENV);
  assert.equal(configuration.state, 'ready');
  const wrongType = new SupabaseServiceRpcTransport(configuration, async () => new Response('not json', {
    status: 200, headers: { 'content-type': 'text/plain' },
  }));
  await assert.rejects(() => wrongType.call('dlkt_info_read_source_acquisition', { p_source_key: 'eu-eurlex-legislation' }),
    /DLKT_INFO_SERVICE_RESPONSE_CONTENT_TYPE_INVALID/u);
  const tooLarge = new SupabaseServiceRpcTransport(configuration, async () => new Response('{}', {
    status: 200, headers: { 'content-type': 'application/json', 'content-length': '3000000' },
  }));
  await assert.rejects(() => tooLarge.call('dlkt_info_read_source_acquisition', { p_source_key: 'eu-eurlex-legislation' }),
    /DLKT_INFO_SERVICE_RESPONSE_TOO_LARGE/u);
});
