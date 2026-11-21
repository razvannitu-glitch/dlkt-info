import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

const search = '?bridge=companion-v1&topics=regulation&tz=Europe%2FBucharest&at=08%3A00&max=6&min=low&actionable=0&trust=trust-v1&level=confirmed&conflicts=exclude&authority=official&sources=2&age=24&officialHigh=1';
const sourceBundle = Object.freeze({
  checkedAt: '2026-11-13T16:30:00.000Z', baselineAt: '2026-11-13T15:49:44.186Z', baselineHash: 'a'.repeat(64),
  delta: Object.freeze({ version: 'dlkt-info-eu-release-delta-1', product: 'dlkt-info', productVersion: '0.8.8', pack: 'eu-official-change-radar', packVersion: '0.1.1', mode: 'release-baseline-delta', baselineVersion: 'dlkt-info-eu-release-baseline-1', baselineAt: '2026-11-13T15:49:44.186Z', baselineHash: 'a'.repeat(64), generatedAt: '2026-11-13T16:30:00.000Z', complete: true, partial: false, feeds: [], baselineEntryCount: 200, currentEntryCount: 200, newCount: 0, changedCount: 0, unchangedCount: 200, rolledOffIgnoredCount: 0, availableCardCount: 0, returnedCardCount: 0, truncatedByPayloadBudget: false, cards: [], deltaAvailable: true, baselinePersistence: 'immutable-release-artifact', databaseUsed: false, persistenceUsed: true, databaseChanged: false, automaticPublication: false, publicCardsCreated: false, aiInterpretation: false, rolloffResolutionDisabled: true, legalBoundary: 'Boundary.' }),
  live: Object.freeze({ version: 'dlkt-info-live-official-snapshot-1', product: 'dlkt-info', productVersion: '0.8.8', pack: 'eu-official-change-radar', packVersion: '0.1.1', mode: 'live-read-only', generatedAt: '2026-11-13T16:30:00.000Z', complete: true, partial: false, deltaAvailable: false, databaseUsed: false, persistenceUsed: false, databaseChanged: false, automaticPublication: false, publicCardsCreated: false, aiInterpretation: false, availableCardCount: 200, returnedCardCount: 200, truncatedByPayloadBudget: false, feeds: [], cards: [], boundaries: [] }),
  deltaError: null, liveError: null,
});

function request({ origin = 'https://preview.example', marker = 'companion-v1', method = 'POST', body = { search }, contentType = 'application/json', url = '/api/companion', etag } = {}) {
  const stream = Readable.from(body === null ? [] : [JSON.stringify(body)]);
  stream.method = method; stream.url = url;
  stream.headers = { origin, host: 'preview.example', 'x-forwarded-host': 'preview.example', 'x-forwarded-proto': 'https', 'x-dlkt-info-request': marker, 'sec-fetch-site': origin === 'https://preview.example' ? 'same-origin' : 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'content-type': contentType, ...(etag ? { 'if-none-match': etag } : {}) };
  return stream;
}
function response() { const headers = new Map(); let body = ''; return { value: { statusCode: 0, setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); }, end(value = '') { body = String(value ?? ''); } }, headers, body: () => body, json: () => JSON.parse(body) }; }

test('real companion API returns caught-up with no synthetic field and private cache boundary', async () => {
  const { handleRealCompanion } = await import('../.build/api/companion.js');
  const { createPrivateSnapshotCache } = await import('../.build/src/http/private-snapshot-cache.js');
  let builds = 0;
  const cache = createPrivateSnapshotCache(60_000);
  const first = response();
  await handleRealCompanion(request(), first.value, { cache, buildSources: async () => { builds += 1; return sourceBundle; } });
  assert.equal(first.value.statusCode, 200);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  assert.equal(first.headers.get('x-dlkt-info-companion'), 'real');
  assert.equal(first.headers.get('x-dlkt-info-synthetic'), '0');
  assert.equal(first.headers.get('x-dlkt-info-server-cache'), 'miss');
  const payload = first.json();
  assert.equal(payload.resultState, 'caught-up');
  assert.equal(payload.cards.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'synthetic'), false);
  const etag = first.headers.get('etag');
  const second = response();
  await handleRealCompanion(request({ etag }), second.value, { cache, buildSources: async () => { builds += 1; return sourceBundle; } });
  assert.equal(second.value.statusCode, 304);
  assert.equal(builds, 1);
});

test('real companion validates origin before a warm private cache is used', async () => {
  const { handleRealCompanion } = await import('../.build/api/companion.js');
  const { createPrivateSnapshotCache } = await import('../.build/src/http/private-snapshot-cache.js');
  let builds = 0;
  const cache = createPrivateSnapshotCache(60_000);
  const warm = response();
  await handleRealCompanion(request(), warm.value, { cache, buildSources: async () => { builds += 1; return sourceBundle; } });
  const foreign = response();
  await handleRealCompanion(request({ origin: 'https://attacker.example' }), foreign.value, { cache, buildSources: async () => { builds += 1; return sourceBundle; } });
  assert.equal(foreign.value.statusCode, 403);
  assert.equal(foreign.json().error, 'ORIGIN_REJECTED');
  assert.equal(builds, 1);
});

test('real companion API rejects invalid transport and configuration', async () => {
  const { handleRealCompanion } = await import('../.build/api/companion.js');
  const invoke = async (input) => { const res = response(); await handleRealCompanion(request(input), res.value, { buildSources: async () => sourceBundle }); return res; };
  assert.equal((await invoke({ method: 'GET' })).value.statusCode, 405);
  assert.equal((await invoke({ url: '/api/companion?unsafe=1' })).value.statusCode, 400);
  assert.equal((await invoke({ contentType: 'text/plain' })).value.statusCode, 415);
  assert.equal((await invoke({ marker: 'wrong' })).value.statusCode, 403);
  assert.equal((await invoke({ body: { search, extra: true } })).value.statusCode, 400);
  assert.equal((await invoke({ body: { search: '?bridge=companion-v1&topics=unknown' } })).value.statusCode, 400);
});

test('real companion represents official-source outage as a valid HTTP 200 product state', async () => {
  const { handleRealCompanion } = await import('../.build/api/companion.js');
  const { createPrivateSnapshotCache } = await import('../.build/src/http/private-snapshot-cache.js');
  const unavailableBundle = Object.freeze({
    checkedAt: '2026-11-13T18:30:00.000Z',
    baselineAt: '2026-11-13T15:49:44.186Z',
    baselineHash: 'a'.repeat(64),
    delta: null,
    live: null,
    deltaError: 'ALL_OFFICIAL_SOURCES_UNAVAILABLE',
    liveError: 'ALL_OFFICIAL_SOURCES_UNAVAILABLE',
  });
  const output = response();
  await handleRealCompanion(request(), output.value, {
    cache: createPrivateSnapshotCache(60_000),
    buildSources: async () => unavailableBundle,
  });
  assert.equal(output.value.statusCode, 200);
  assert.equal(output.headers.get('x-dlkt-info-source-state'), 'unavailable');
  assert.equal(output.headers.get('cache-control'), 'private, no-store');
  const payload = output.json();
  assert.equal(payload.resultState, 'unavailable');
  assert.equal(payload.generatedAt, unavailableBundle.checkedAt);
  assert.equal(payload.baselineAt, unavailableBundle.baselineAt);
  assert.equal(payload.baselineHash, unavailableBundle.baselineHash);
  assert.equal(payload.counts.returnedCardCount, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'synthetic'), false);
});
