import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const INSTANCE = '123e4567-e89b-42d3-a456-426614174000';
const SECRET = 'cron-secret-with-at-least-twenty-four-characters';
const ENV = Object.freeze({
  DLKT_INFO_OPERATIONAL_LEDGER_ENABLED: '1',
  DLKT_INFO_LEDGER_INSTANCE_ID: INSTANCE,
  DLKT_INFO_LEDGER_BLOB_TOKEN: ['vercel', 'blob', 'rw', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_'),
  CRON_SECRET: SECRET,
});
const NOW = Date.parse('2026-11-13T10:27:00.000Z');
const xml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const body = (definition, celex, cellar) => `<?xml version="1.0"?><rss version="2.0"><channel xmlns:dc="http://purl.org/dc/elements/1.1/"><title>${xml(definition.expectedChannelTitle)}</title><pubDate>Fri, 13 Nov 2026 10:00:00 +0000</pubDate><description>x</description><language>en</language><link>https://eur-lex.europa.eu/homepage.html</link><item><title>CELEX:${celex}: Operational API fixture</title><description/><link>https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELEX:${celex}</link><guid>https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELLAR:${cellar}</guid><category>Lex Alerts</category><pubDate>Fri, 13 Nov 2026 09:00:00 +0000</pubDate><dc:creator>European Commission</dc:creator></item></channel></rss>`;

const response = () => {
  const headers = new Map(); let value = '';
  return {
    value: { statusCode: 0, setHeader(name, item) { headers.set(String(name).toLowerCase(), String(item)); }, end(item = '') { value = String(item ?? ''); } },
    headers, body: () => value, json: () => JSON.parse(value),
  };
};
const request = ({ method = 'GET', url = '/api/operational-delta', origin = 'https://preview.example', marker = 'operational-delta-v1', authorization, etag } = {}) => ({
  method, url,
  headers: {
    host: 'preview.example', 'x-forwarded-host': 'preview.example', 'x-forwarded-proto': 'https',
    origin, 'sec-fetch-site': origin === 'https://preview.example' ? 'same-origin' : 'cross-site',
    'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'x-dlkt-info-request': marker,
    ...(authorization ? { authorization } : {}), ...(etag ? { 'if-none-match': etag } : {}),
  },
});

async function setup() {
  const ledger = await import('../.build/src/operational-ledger/index.js');
  const { EU_OFFICIAL_FEEDS } = await import('../.build/src/packs/eu-official/index.js');
  const storage = new ledger.InMemoryOperationalLedgerStorage();
  await ledger.bootstrapOperationalLedgerIdentity(storage, INSTANCE, NOW - 1000);
  const feeds = new Map([
    [EU_OFFICIAL_FEEDS[0].url, body(EU_OFFICIAL_FEEDS[0], '52026PC0001', '9502bac6-dcf8-11f1-8501-01aa75ed71a1')],
    [EU_OFFICIAL_FEEDS[1].url, body(EU_OFFICIAL_FEEDS[1], '32026D0001', '8502bac6-dcf8-11f1-8501-01aa75ed71a2')],
  ]);
  const fetchImplementation = async (input) => {
    const content = feeds.get(String(input));
    assert.equal(typeof content, 'string');
    return new Response(content, { status: 200, headers: { 'content-type': 'application/rss+xml', etag: `"${createHash('sha256').update(content).digest('hex')}"` } });
  };
  return { ledger, storage, fetchImplementation };
}

test('operational collector requires cron authorization and commits a private baseline', async () => {
  const { storage, fetchImplementation } = await setup();
  const { handleOperationalDeltaCollect } = await import('../.build/api/operational-delta-collect.js');
  const denied = response();
  await handleOperationalDeltaCollect(request({ url: '/api/operational-delta-collect', marker: '', authorization: 'Bearer wrong' }), denied.value, { environment: ENV, storage, fetchImplementation, now: () => NOW });
  assert.equal(denied.value.statusCode, 401);
  assert.equal(denied.headers.get('cache-control'), 'private, no-store');

  const accepted = response();
  await handleOperationalDeltaCollect(request({ url: '/api/operational-delta-collect', marker: '', authorization: `Bearer ${SECRET}` }), accepted.value, { environment: ENV, storage, fetchImplementation, now: () => NOW });
  assert.equal(accepted.value.statusCode, 200);
  assert.equal(accepted.json().status, 'initialized');
  assert.equal(accepted.json().sequence, 1);
  assert.equal(accepted.json().publicCardsCreated, false);
});

test('operational read API enforces same-origin, ETag and exact private state', async () => {
  const { ledger, storage, fetchImplementation } = await setup();
  await ledger.collectOperationalDelta({ storage, instanceId: INSTANCE, dependencies: { fetchImplementation, now: () => NOW } });
  const { handleOperationalDelta } = await import('../.build/api/operational-delta.js');

  const foreign = response();
  await handleOperationalDelta(request({ origin: 'https://attacker.example' }), foreign.value, { environment: ENV, storage });
  assert.equal(foreign.value.statusCode, 403);
  assert.equal(foreign.json().error, 'ORIGIN_REJECTED');

  const first = response();
  await handleOperationalDelta(request(), first.value, { environment: ENV, storage });
  assert.equal(first.value.statusCode, 200);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  assert.equal(first.headers.get('x-dlkt-info-ledger-state'), 'ready');
  assert.equal(first.json().mode, 'operational-consecutive-delta');
  assert.equal(first.json().baselineEstablished, true);
  assert.equal(first.json().cards.length, 0);
  const etag = first.headers.get('etag');
  assert.ok(etag);

  const second = response();
  await handleOperationalDelta(request({ etag }), second.value, { environment: ENV, storage });
  assert.equal(second.value.statusCode, 304);
  assert.equal(second.body(), '');
});

test('operational health exposes no credentials and remains truthful before activation', async () => {
  const { handleOperationalDeltaHealth } = await import('../.build/api/operational-delta-health.js');
  const disabled = response();
  await handleOperationalDeltaHealth(request({ url: '/api/operational-delta-health' }), disabled.value, { environment: {} });
  assert.equal(disabled.value.statusCode, 200);
  assert.equal(disabled.json().status, 'installed-not-activated');
  assert.equal(disabled.json().blocker, 'OPERATIONAL_LEDGER_DISABLED');
  assert.doesNotMatch(disabled.body(), /vercel_blob_rw_|oidc-token|123e4567/u);

  const { storage } = await setup();
  const ready = response();
  await handleOperationalDeltaHealth(request({ url: '/api/operational-delta-health' }), ready.value, { environment: ENV, storage });
  assert.equal(ready.value.statusCode, 200);
  assert.equal(ready.json().identityVerified, true);
  assert.equal(ready.json().ledgerState, 'empty');
  assert.doesNotMatch(ready.body(), /vercel_blob_rw_|cron-secret/u);
});
