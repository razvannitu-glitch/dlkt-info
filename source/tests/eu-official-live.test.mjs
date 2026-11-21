import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

const NOW = Date.parse('2026-11-13T15:20:00.000Z');
const xmlEscape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const item = ({ celex, title, creator, cellar, publishedAt }) => `
<item>
<title>CELEX:${xmlEscape(celex)}: ${xmlEscape(title)}</title>
<description/>
<link>https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELEX:${xmlEscape(celex)}</link>
<guid>https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELLAR:${xmlEscape(cellar)}</guid>
<category>Lex Alerts</category>
<pubDate>${xmlEscape(publishedAt)}</pubDate>
<dc:creator>${xmlEscape(creator)}</dc:creator>
</item>`;
const feed = (definition, entry, publishedAt) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel xmlns:dc="http://purl.org/dc/elements/1.1/">
<title>${xmlEscape(definition.expectedChannelTitle)}</title><pubDate>${xmlEscape(publishedAt)}</pubDate>
<description>Official deterministic test feed.</description><language>en</language><link>https://eur-lex.europa.eu/homepage.html</link>
${entry}</channel></rss>`;

const fixtures = async () => {
  const { EU_OFFICIAL_FEEDS } = await import('../.build/src/packs/eu-official/index.js');
  const proposal = feed(EU_OFFICIAL_FEEDS[0], item({ celex: '52026PC0613', title: 'Proposal for a synthetic regulation', creator: 'European Commission', cellar: '9502bac6-dcf8-11f1-8501-01aa75ed71a1', publishedAt: 'Fri, 13 Nov 2026 14:00:00 +0100' }), 'Fri, 13 Nov 2026 14:40:20 +0100');
  const legislation = feed(EU_OFFICIAL_FEEDS[1], item({ celex: '32026D2535', title: 'Synthetic decision of the European Parliament and Council', creator: 'European Parliament and Council', cellar: '8502bac6-dcf8-11f1-8501-01aa75ed71a2', publishedAt: 'Fri, 13 Nov 2026 15:00:00 +0100' }), 'Fri, 13 Nov 2026 15:10:00 +0100');
  return { EU_OFFICIAL_FEEDS, proposal, legislation };
};

const fetcher = (fixture, failingFeed = null) => async (url) => {
  const { EU_OFFICIAL_FEEDS, proposal, legislation } = fixture;
  const definition = EU_OFFICIAL_FEEDS.find((entry) => entry.url === String(url));
  if (!definition) return new Response('not found', { status: 404 });
  if (definition.id === failingFeed) return new Response('failed', { status: 503 });
  const body = definition.id === EU_OFFICIAL_FEEDS[0].id ? proposal : legislation;
  return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8', etag: `"${createHash('sha256').update(body).digest('hex')}"` } });
};

function request({ method = 'GET', origin = 'https://preview.example', marker = 'eu-live-v1', url = '/api/eu-official-live', etag } = {}) {
  const input = Readable.from([]);
  input.method = method;
  input.url = url;
  input.headers = {
    origin,
    host: 'preview.example',
    'x-forwarded-host': 'preview.example',
    'x-forwarded-proto': 'https',
    'x-dlkt-info-request': marker,
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    ...(etag ? { 'if-none-match': etag } : {}),
  };
  return input;
}
function response() {
  const headers = new Map(); let body = '';
  return { value: { statusCode: 0, setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); }, end(value = '') { body = String(value); } }, headers, body: () => body };
}

test('live official snapshot returns current authorized listings without pretending a delta', async () => {
  const fixture = await fixtures();
  const { buildLiveOfficialSnapshot } = await import('../.build/src/live-official/index.js');
  const snapshot = await buildLiveOfficialSnapshot({ fetchImplementation: fetcher(fixture), now: () => NOW });
  assert.equal(snapshot.version, 'dlkt-info-live-official-snapshot-1');
  assert.equal(snapshot.mode, 'live-read-only');
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.partial, false);
  assert.equal(snapshot.deltaAvailable, false);
  assert.equal(snapshot.databaseUsed, false);
  assert.equal(snapshot.persistenceUsed, false);
  assert.equal(snapshot.databaseChanged, false);
  assert.equal(snapshot.publicCardsCreated, false);
  assert.equal(snapshot.aiInterpretation, false);
  assert.equal(snapshot.feeds.length, 2);
  assert.equal(snapshot.cards.length, 2);
  assert.equal(snapshot.cards[0].celexId, '32026D2535');
  assert.equal(snapshot.cards[1].celexId, '52026PC0613');
  assert.ok(snapshot.cards.every((card) => card.source.authority === 'official' && card.source.attributionRequired === true));
  assert.ok(snapshot.cards.every((card) => card.deltaStatus === 'not-available-without-baseline'));
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot), 'utf8') <= 500_000);
});

test('live official snapshot remains usable when one official feed fails', async () => {
  const fixture = await fixtures();
  const { buildLiveOfficialSnapshot } = await import('../.build/src/live-official/index.js');
  const snapshot = await buildLiveOfficialSnapshot({ fetchImplementation: fetcher(fixture, fixture.EU_OFFICIAL_FEEDS[0].id), now: () => NOW });
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.cards.length, 1);
  assert.equal(snapshot.feeds.filter((entry) => entry.status === 'unavailable').length, 1);
  assert.equal(snapshot.feeds[0].errorCode, 'SOURCE_HTTP_ERROR');
});

test('live official snapshot fails closed when every official feed fails', async () => {
  const fixture = await fixtures();
  const { buildLiveOfficialSnapshot } = await import('../.build/src/live-official/index.js');
  const allFail = async () => new Response('failed', { status: 503 });
  await assert.rejects(buildLiveOfficialSnapshot({ fetchImplementation: allFail, now: () => NOW }), /LIVE_OFFICIAL_ALL_SOURCES_FAILED/u);
});

test('live API validates origin before private cache reuse and supports ETag revalidation', async () => {
  const fixture = await fixtures();
  const { handleEuOfficialLive } = await import('../.build/api/eu-official-live.js');
  const { buildLiveOfficialSnapshot } = await import('../.build/src/live-official/index.js');
  const { createPrivateSnapshotCache } = await import('../.build/src/http/private-snapshot-cache.js');
  const cache = createPrivateSnapshotCache(900_000);
  let builds = 0;
  const dependencies = {
    cache,
    cacheNow: () => NOW,
    buildSnapshot: async () => {
      builds += 1;
      return buildLiveOfficialSnapshot({ fetchImplementation: fetcher(fixture), now: () => NOW });
    },
  };

  const first = response();
  await handleEuOfficialLive(request(), first.value, dependencies);
  assert.equal(first.value.statusCode, 200);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  assert.equal(first.headers.get('x-dlkt-info-server-cache'), 'miss');
  assert.equal(first.headers.get('x-dlkt-info-live'), '1');
  assert.equal(first.headers.get('x-dlkt-info-delta'), '0');
  assert.equal(first.headers.get('x-dlkt-info-persistence'), '0');
  assert.equal(first.headers.get('x-dlkt-info-ai-interpretation'), '0');
  const payload = JSON.parse(first.body());
  assert.equal(payload.databaseChanged, false);
  const etag = first.headers.get('etag');
  assert.ok(etag);
  assert.equal(builds, 1);

  const second = response();
  await handleEuOfficialLive(request({ etag }), second.value, dependencies);
  assert.equal(second.value.statusCode, 304);
  assert.equal(second.body(), '');
  assert.equal(second.headers.get('cache-control'), 'private, no-store');
  assert.equal(second.headers.get('x-dlkt-info-server-cache'), 'hit');
  assert.equal(builds, 1);

  const foreign = response();
  await handleEuOfficialLive(request({ origin: 'https://attacker.example' }), foreign.value, dependencies);
  assert.equal(foreign.value.statusCode, 403);
  assert.equal(JSON.parse(foreign.body()).error, 'INVALID_REQUEST_ORIGIN');
  assert.equal(foreign.headers.get('cache-control'), 'private, no-store');
  assert.equal(builds, 1);

  const query = response();
  await handleEuOfficialLive(request({ url: '/api/eu-official-live?limit=6' }), query.value, dependencies);
  assert.equal(query.value.statusCode, 400);
  assert.equal(JSON.parse(query.body()).error, 'QUERY_NOT_ALLOWED');
  assert.equal(builds, 1);
});
