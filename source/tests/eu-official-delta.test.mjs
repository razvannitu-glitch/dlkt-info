import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const BASELINE_TIME = '2026-11-13T12:00:00.000Z';
const CURRENT_TIME = '2026-11-13T15:00:00.000Z';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

const itemXml = ({ celex, title, creator, cellar, publishedAt }) => `
<item>
  <title>CELEX:${escapeXml(celex)}: ${escapeXml(title)}</title>
  <description/>
  <link>https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELEX:${escapeXml(celex)}</link>
  <guid>https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELLAR:${escapeXml(cellar)}</guid>
  <category>Lex Alerts</category>
  <pubDate>${escapeXml(publishedAt)}</pubDate>
  <dc:creator>${escapeXml(creator)}</dc:creator>
</item>`;

const feedXml = (definition, items, publishedAt) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel xmlns:dc="http://purl.org/dc/elements/1.1/">
<title>${escapeXml(definition.expectedChannelTitle)}</title>
<pubDate>${escapeXml(publishedAt)}</pubDate>
<description>Deterministic delta test feed.</description><language>en</language>
<link>https://eur-lex.europa.eu/homepage.html</link>${items.join('\n')}
</channel></rss>`;

const entry = (celex, title, creator, cellar, publishedAt = 'Fri, 13 Nov 2026 12:00:00 +0000') =>
  ({ celex, title, creator, cellar, publishedAt });

async function fixture() {
  const pack = await import('../.build/src/packs/eu-official/index.js');
  const delta = await import('../.build/src/delta-official/index.js');
  const [commission, legislation] = pack.EU_OFFICIAL_FEEDS;
  assert.ok(commission && legislation);
  const baselineBodies = new Map([
    [commission.id, feedXml(commission, [
      itemXml(entry('52026PC1001', 'Unchanged proposal', 'European Commission', '11111111-1111-1111-8111-111111111111')),
      itemXml(entry('52026PC1002', 'Original proposal title', 'European Commission', '22222222-2222-1222-8222-222222222222')),
      itemXml(entry('52026PC1003', 'Rolling window item', 'European Commission', '33333333-3333-1333-8333-333333333333')),
    ], 'Fri, 13 Nov 2026 12:00:00 +0000')],
    [legislation.id, feedXml(legislation, [
      itemXml(entry('32026D1001', 'Unchanged legislation', 'Council of the European Union', '44444444-4444-1444-8444-444444444444')),
    ], 'Fri, 13 Nov 2026 12:00:00 +0000')],
  ]);
  const currentBodies = new Map([
    [commission.id, feedXml(commission, [
      itemXml(entry('52026PC1001', 'Unchanged proposal', 'European Commission', '11111111-1111-1111-8111-111111111111')),
      itemXml(entry('52026PC1002', 'Revised official proposal title', 'European Commission', '22222222-2222-1222-8222-222222222222')),
      itemXml(entry('52026PC1004', 'New official proposal', 'European Commission', '55555555-5555-1555-8555-555555555555', 'Fri, 13 Nov 2026 14:30:00 +0000')),
    ], 'Fri, 13 Nov 2026 15:00:00 +0000')],
    [legislation.id, feedXml(legislation, [
      itemXml(entry('32026D1001', 'Unchanged legislation', 'Council of the European Union', '44444444-4444-1444-8444-444444444444')),
    ], 'Fri, 13 Nov 2026 15:00:00 +0000')],
  ]);
  const feeds = pack.EU_OFFICIAL_FEEDS.map((definition) => {
    const body = baselineBodies.get(definition.id);
    assert.ok(body);
    const parsed = pack.parseEuOfficialRss(definition, body, BASELINE_TIME);
    return {
      feedId: definition.id,
      feedKind: definition.kind,
      sourceId: definition.sourceId,
      label: definition.label,
      retrievedAt: BASELINE_TIME,
      channelPublishedAt: parsed.channelPublishedAt,
      bodyHash: hash(body),
      entries: parsed.entries,
    };
  });
  const unsigned = {
    version: 'dlkt-info-eu-release-baseline-1',
    product: 'dlkt-info',
    pack: 'eu-official-change-radar',
    packVersion: '0.1.1',
    capturedAt: BASELINE_TIME,
    feeds,
    entryCount: feeds.reduce((sum, feed) => sum + feed.entries.length, 0),
  };
  const baseline = { ...unsigned, baselineHash: delta.computeEuReleaseBaselineHash(unsigned) };
  const fetchImplementation = async (url) => {
    const definition = pack.EU_OFFICIAL_FEEDS.find((candidate) => candidate.url === String(url));
    assert.ok(definition);
    const body = currentBodies.get(definition.id);
    assert.ok(body);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
  };
  return { delta, baseline, fetchImplementation };
}

test('release baseline comparator reports new and changed entries without false roll-off resolution', async () => {
  const { delta, baseline, fetchImplementation } = await fixture();
  const snapshot = await delta.buildDeltaOfficialSnapshot({ baseline, fetchImplementation, now: () => Date.parse(CURRENT_TIME) });
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.newCount, 1);
  assert.equal(snapshot.changedCount, 1);
  assert.equal(snapshot.unchangedCount, 2);
  assert.equal(snapshot.rolledOffIgnoredCount, 1);
  assert.equal(snapshot.availableCardCount, 2);
  assert.equal(snapshot.returnedCardCount, 2);
  assert.equal(snapshot.cards.some((card) => card.kind === 'new' && card.celexId === '52026PC1004'), true);
  const changed = snapshot.cards.find((card) => card.kind === 'changed');
  assert.equal(changed?.celexId, '52026PC1002');
  assert.deepEqual(changed?.changedFields, ['title']);
  assert.equal(changed?.previous?.title, 'Original proposal title');
  assert.equal(snapshot.rolloffResolutionDisabled, true);
  assert.equal(snapshot.databaseUsed, false);
  assert.equal(snapshot.baselinePersistence, 'immutable-release-artifact');
  assert.equal(snapshot.aiInterpretation, false);
});

test('delta comparator degrades per source and returns no cards when every source fails', async () => {
  const { delta, baseline, fetchImplementation } = await fixture();
  let calls = 0;
  const oneFailure = async (url, init) => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
    return fetchImplementation(url, init);
  };
  const partial = await delta.buildDeltaOfficialSnapshot({ baseline, fetchImplementation: oneFailure, now: () => Date.parse(CURRENT_TIME) });
  assert.equal(partial.partial, true);
  assert.equal(partial.feeds.filter((feed) => feed.status === 'unavailable').length, 1);
  await assert.rejects(
    delta.buildDeltaOfficialSnapshot({ baseline, fetchImplementation: async () => { throw new Error('offline'); }, now: () => Date.parse(CURRENT_TIME) }),
    /DELTA_OFFICIAL_ALL_SOURCES_FAILED/u,
  );
});

test('delta API validates origin before private cache reuse and preserves ETag boundaries', async () => {
  const { handleEuOfficialDelta } = await import('../.build/api/eu-official-delta.js');
  const { createPrivateSnapshotCache } = await import('../.build/src/http/private-snapshot-cache.js');
  const snapshot = {
    version: 'dlkt-info-eu-release-delta-1', product: 'dlkt-info', productVersion: '0.8.8', pack: 'eu-official-change-radar', packVersion: '0.1.1',
    mode: 'release-baseline-delta', baselineVersion: 'dlkt-info-eu-release-baseline-1', baselineAt: BASELINE_TIME,
    baselineHash: 'a'.repeat(64), generatedAt: CURRENT_TIME, complete: true, partial: false, feeds: [], baselineEntryCount: 0,
    currentEntryCount: 0, newCount: 0, changedCount: 0, unchangedCount: 0, rolledOffIgnoredCount: 0, availableCardCount: 0,
    returnedCardCount: 0, truncatedByPayloadBudget: false, cards: [], deltaAvailable: true, baselinePersistence: 'immutable-release-artifact',
    databaseUsed: false, persistenceUsed: true, databaseChanged: false, automaticPublication: false, publicCardsCreated: false,
    aiInterpretation: false, rolloffResolutionDisabled: true, legalBoundary: 'Official boundary.',
  };
  const cache = createPrivateSnapshotCache(900_000);
  let builds = 0;
  const dependencies = {
    cache,
    cacheNow: () => Date.parse(CURRENT_TIME),
    buildSnapshot: async () => { builds += 1; return snapshot; },
  };
  const invoke = async (overrides = {}) => {
    const headers = new Map(); let body = '';
    const { headers: overrideHeaders = {}, ...requestOverrides } = overrides;
    const request = {
      method: 'GET', url: '/api/eu-official-delta', ...requestOverrides, headers: {
        host: 'dlkt.example', origin: 'https://dlkt.example', 'x-forwarded-proto': 'https',
        'x-dlkt-info-request': 'eu-delta-v1', ...overrideHeaders,
      },
    };
    const response = { statusCode: 0, setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); }, end(value = '') { body = String(value ?? ''); } };
    await handleEuOfficialDelta(request, response, dependencies);
    return { response, headers, body };
  };

  const first = await invoke();
  assert.equal(first.response.statusCode, 200);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  assert.equal(first.headers.get('x-dlkt-info-server-cache'), 'miss');
  assert.equal(first.headers.get('x-dlkt-info-delta'), '1');
  assert.equal(first.headers.get('x-dlkt-info-baseline'), 'release-artifact');
  assert.equal(first.headers.get('x-dlkt-info-database'), '0');
  assert.equal(first.headers.get('x-dlkt-info-ai-interpretation'), '0');
  assert.equal(builds, 1);
  const etag = first.headers.get('etag');
  assert.match(etag ?? '', /^"[a-f0-9]{64}"$/u);

  const second = await invoke({ headers: { 'if-none-match': etag } });
  assert.equal(second.response.statusCode, 304);
  assert.equal(second.body, '');
  assert.equal(second.headers.get('cache-control'), 'private, no-store');
  assert.equal(second.headers.get('x-dlkt-info-server-cache'), 'hit');
  assert.equal(builds, 1);

  const foreign = await invoke({ headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' } });
  assert.equal(foreign.response.statusCode, 403);
  assert.equal(JSON.parse(foreign.body).error, 'ORIGIN_REJECTED');
  assert.equal(builds, 1);

  const query = await invoke({ url: '/api/eu-official-delta?unsafe=1' });
  assert.equal(query.response.statusCode, 400);
  assert.equal(JSON.parse(query.body).error, 'QUERY_NOT_ALLOWED');
  assert.equal(builds, 1);
});
