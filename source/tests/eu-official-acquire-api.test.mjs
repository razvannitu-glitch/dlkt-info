import assert from 'node:assert/strict';
import test from 'node:test';

const REF = 'abcdefghijklmnopqrst';
const URL = `https://${REF}.supabase.co`;
const SECRET = `sb_secret_${'s'.repeat(32)}`;
const CRON = 'cron_secret_value_0123456789abcdef';
const NOW = Date.parse('2026-11-11T20:00:00.000Z');
const ENV = Object.freeze({
  DLKT_INFO_SUPABASE_PROJECT_REF: REF,
  DLKT_INFO_SUPABASE_URL: URL,
  DLKT_INFO_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(32)}`,
  DLKT_INFO_DATA_FOUNDATION_READY: '1',
  DLKT_INFO_AUTH_ENABLED: '0',
  DLKT_INFO_REAL_DATA_ENABLED: '1',
  DLKT_INFO_SOURCE_ACQUISITION_ENABLED: '1',
  DLKT_INFO_DELIVERY_WORKERS_ENABLED: '0',
  DLKT_INFO_SUPABASE_SECRET_KEY: SECRET,
  CRON_SECRET: CRON,
});

const feed = (kind) => {
  const commission = kind === 'commission';
  const title = commission ? '4 - Commission proposals and related documents' : '1 - All Parliament and Council legislation';
  const celex = commission ? '52026PC0001' : '32026R0001';
  const cellar = commission ? '9502bac6-dcf8-11f1-8501-01aa75ed71a1' : '11111111-2222-3333-4444-555555555555';
  return `<?xml version="1.0"?><rss version="2.0"><channel xmlns:dc="http://purl.org/dc/elements/1.1/"><title>${title}</title><pubDate>Wed, 11 Nov 2026 20:30:00 +0100</pubDate><description>x</description><language>en</language><link>https://eur-lex.europa.eu/homepage.html</link><item><title>CELEX:${celex}: Synthetic official item</title><description/><link>https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELEX:${celex}</link><guid>https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELLAR:${cellar}</guid><category>Lex Alerts</category><dc:creator>${commission ? 'European Commission' : 'Council of the European Union'}</dc:creator></item></channel></rss>`;
};

function response() {
  const headers = new Map();
  let body = '';
  return {
    value: { statusCode: 0, setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); }, end(value = '') { body = String(value); } },
    headers,
    json: () => JSON.parse(body),
    text: () => body,
  };
}

function request({ method = 'GET', authorization = `Bearer ${CRON}` } = {}) {
  return { method, headers: authorization === null ? {} : { authorization } };
}

function transport() {
  const calls = [];
  const states = new Map();
  let attemptIndex = 0;
  return {
    calls,
    value: { call: async (name, parameters) => {
      calls.push({ name, parameters });
      const source = parameters.p_source_key;
      const current = states.get(source) ?? { version: 0, checkpoint: null, bodyHash: null };
      if (name === 'dlkt_info_reserve_source_acquisition') {
        attemptIndex += 1;
        return [{ allowed: true, reason: 'reserved', attempt_id: `11111111-1111-4111-8111-${String(attemptIndex).padStart(12, '0')}`,
          source_key: source, attempt_no: attemptIndex, checkpoint_version: current.version, checkpoint: current.checkpoint,
          body_hash: current.bodyHash, etag: null, last_modified: null, lease_expires_at: '2026-11-11T20:02:00.000Z' }];
      }
      if (name === 'dlkt_info_commit_source_acquisition') {
        const next = { version: parameters.p_checkpoint_version, checkpoint: parameters.p_checkpoint, bodyHash: parameters.p_body_hash };
        states.set(source, next);
        return [{ source_key: source, checkpoint_version: next.version, checkpoint: next.checkpoint, body_hash: next.bodyHash,
          etag: parameters.p_etag, last_modified: parameters.p_last_modified, last_attempt_at: '2026-11-11T20:00:00.000Z',
          last_success_at: '2026-11-11T20:00:00.000Z', next_eligible_at: '2026-11-11T20:30:00.000Z',
          attempts_today: 1, total_attempts: 1, consecutive_failures: 0, last_error_code: null,
          batch_id: `22222222-2222-4222-8222-${String(attemptIndex).padStart(12, '0')}`,
          claim_count: parameters.p_claims.length, inserted_claims: parameters.p_claims.length, existing_claims: 0 }];
      }
      if (name === 'dlkt_info_complete_source_acquisition') {
        return [{ source_key: source, checkpoint_version: current.version, checkpoint: current.checkpoint, body_hash: current.bodyHash,
          etag: null, last_modified: null, last_attempt_at: '2026-11-11T20:00:00.000Z', last_success_at: null,
          next_eligible_at: '2026-11-11T20:30:00.000Z', attempts_today: 1, total_attempts: 1,
          consecutive_failures: 1, last_error_code: parameters.p_error_code }];
      }
      throw new Error(`UNEXPECTED_RPC:${name}`);
    }},
  };
}

async function invoke(input = {}, dependencies = {}) {
  const { handleEuOfficialAcquisition } = await import('../.build/api/eu-official-acquire.js');
  const res = response();
  await handleEuOfficialAcquisition(request(input), res.value, { environment: ENV, now: () => NOW, ...dependencies });
  return res;
}

test('private acquisition endpoint creates two private baselines and exposes only bounded diagnostics', async () => {
  const rpc = transport();
  const res = await invoke({}, { transport: rpc.value, fetchImplementation: async (url) => new Response(
    feed(String(url).includes('rssId=161') ? 'commission' : 'legislation'),
    { status: 200, headers: { 'content-type': 'application/xml' } },
  ) });
  const payload = res.json();
  assert.equal(res.value.statusCode, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(payload.ok, true);
  assert.equal(payload.feeds.length, 2);
  assert.ok(payload.feeds.every((row) => row.status === 'modified' && row.reason === 'baseline-established'
    && row.entryCount === 1 && row.ingestedClaimCount === 1 && row.insertedClaimCount === 1));
  assert.equal(payload.publicCardsCreated, false);
  assert.equal(rpc.calls.filter((call) => call.name === 'dlkt_info_commit_source_acquisition').length, 2);
  assert.doesNotMatch(res.text(), /52026PC0001|32026R0001|Synthetic official item|sb_secret_/u);
});

test('endpoint rejects unauthorized and unavailable execution before network or RPC access', async () => {
  let touched = 0;
  const unauthorized = await invoke({ authorization: 'Bearer wrong_secret_value_0123456789abcdef' }, {
    transport: { call: async () => { touched += 1; throw new Error('UNEXPECTED_RPC'); } },
    fetchImplementation: async () => { touched += 1; throw new Error('UNEXPECTED_FETCH'); },
  });
  assert.equal(unauthorized.value.statusCode, 401);
  assert.deepEqual(unauthorized.json(), { ok: false, error: 'UNAUTHORIZED' });
  assert.equal(touched, 0);

  const { handleEuOfficialAcquisition } = await import('../.build/api/eu-official-acquire.js');
  const unavailable = response();
  await handleEuOfficialAcquisition(request(), unavailable.value, { environment: {}, now: () => NOW,
    transport: { call: async () => { touched += 1; throw new Error('UNEXPECTED_RPC'); } },
    fetchImplementation: async () => { touched += 1; throw new Error('UNEXPECTED_FETCH'); } });
  assert.equal(unavailable.value.statusCode, 503);
  assert.deepEqual(unavailable.json(), { ok: false, error: 'SOURCE_ACQUISITION_NOT_AVAILABLE' });
  assert.equal(touched, 0);
});

test('one provider failure is recorded privately and returns a bounded partial-failure response', async () => {
  const rpc = transport();
  const res = await invoke({}, { transport: rpc.value, fetchImplementation: async (url) => {
    if (String(url).includes('rssId=162')) return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(feed('commission'), { status: 200, headers: { 'content-type': 'application/xml' } });
  }});
  const payload = res.json();
  assert.equal(res.value.statusCode, 502);
  assert.equal(payload.ok, false);
  assert.equal(payload.failedFeeds, 1);
  assert.equal(payload.feeds.filter((row) => row.status === 'failed').length, 1);
  assert.equal(rpc.calls.filter((call) => call.name === 'dlkt_info_complete_source_acquisition'
    && call.parameters.p_outcome === 'failed').length, 1);
  assert.doesNotMatch(res.text(), /PROVIDER_PAYLOAD_INVALID|application\/json|Synthetic official item/u);
});

test('endpoint accepts GET only', async () => {
  const res = await invoke({ method: 'POST' });
  assert.equal(res.value.statusCode, 405);
  assert.equal(res.headers.get('allow'), 'GET');
  assert.deepEqual(res.json(), { ok: false, error: 'METHOD_NOT_ALLOWED' });
});
