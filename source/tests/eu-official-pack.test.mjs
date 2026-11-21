import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const NOW = Date.parse('2026-11-11T20:00:00.000Z');
const RETRIEVED = new Date(NOW).toISOString();
const hash = (body) => createHash('sha256').update(body).digest('hex');

const xmlEscape = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const itemXml = ({
  celex = '52026PC0001',
  title = 'Proposal for a synthetic Council Regulation',
  creator = 'European Commission',
  cellar = '9502bac6-dcf8-11f1-8501-01aa75ed71a1',
  publishedAt = null,
  foreign = false,
} = {}) => `
  <item>
    <title>CELEX:${xmlEscape(celex)}: ${xmlEscape(title)}</title>
    <description/>
    <link>${foreign ? 'https://attacker.example' : 'https://eur-lex.europa.eu/.'}/legal-content/AUTO/?uri=CELEX:${xmlEscape(celex)}</link>
    <guid>https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELLAR:${xmlEscape(cellar)}</guid>
    <category>Lex Alerts</category>
    ${publishedAt ? `<pubDate>${xmlEscape(publishedAt)}</pubDate>` : ''}
    <dc:creator>${xmlEscape(creator)}</dc:creator>
  </item>`;

const feedXml = (definition, items, publishedAt = 'Wed, 11 Nov 2026 20:30:00 +0100') => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel xmlns:dc="http://purl.org/dc/elements/1.1/">
    <title>${xmlEscape(definition.expectedChannelTitle)}</title>
    <pubDate>${xmlEscape(publishedAt)}</pubDate>
    <description>Synthetic deterministic test feed.</description>
    <language>en</language>
    <link>https://eur-lex.europa.eu/homepage.html</link>
    ${items.join('\n')}
  </channel>
</rss>`;

const modified = (definition, body, retrievedAt = RETRIEVED) => ({
  status: 'modified', definition, retrievedAt, body, bodyHash: hash(body), etag: '"synthetic-etag"', lastModified: null,
});

const definition = (maxCards = 12) => ({
  id: 'briefing-eu-radar', ownerId: 'user:one', name: 'EU Radar', timezone: 'Europe/Bucharest',
  deliveryLocalTime: '08:00', weekdays: [1,2,3,4,5,6,7], channels: ['web'], maxCards,
  rules: [{ id: 'rule-regulation', includeTopics: ['regulation'], excludeTopics: [], includeEntities: [],
    excludeEntities: [], includeGeographies: ['European Union'], languages: ['en'], minMateriality: 'low', weight: 3,
    onlyActionable: false }],
});

const acquisitions = (feeds, previous = [null, null]) => feeds.map((body, index) => ({
  definition: globalThis.EU_FEEDS[index],
  result: modified(globalThis.EU_FEEDS[index], body),
  previousCheckpoint: previous[index],
}));

test('EUR-Lex source registry allows only the registered CELEX query contract', async () => {
  const { SourceRegistry } = await import('../.build/src/core/index.js');
  const { EU_OFFICIAL_SOURCES } = await import('../.build/src/packs/eu-official/index.js');
  const registry = new SourceRegistry(EU_OFFICIAL_SOURCES);
  const evidence = {
    sourceId: 'eu-eurlex-commission-proposals',
    url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX%3A52026PC0001',
    title: 'Synthetic official document', retrievedAt: RETRIEVED, publishedAt: null, contentHash: 'a'.repeat(64),
  };
  assert.equal(registry.authorize(evidence, 'regulation', NOW).allowed, true);
  assert.deepEqual(registry.authorize({ ...evidence, url: `${evidence.url}&lang=en` }, 'regulation', NOW),
    { allowed: false, reason: 'query-unregistered' });
  assert.deepEqual(registry.authorize({ ...evidence, url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX%3A1&uri=CELEX%3A2' }, 'regulation', NOW),
    { allowed: false, reason: 'query-unregistered' });
  assert.deepEqual(registry.authorize({ ...evidence, url: 'https://eur-lex.europa.eu/legal-content/AUTO/' }, 'regulation', NOW),
    { allowed: false, reason: 'query-unregistered' });
  assert.deepEqual(registry.authorize({ ...evidence, url: 'https://attacker.example/legal-content/AUTO/?uri=CELEX%3A52026PC0001' }, 'regulation', NOW),
    { allowed: false, reason: 'origin-mismatch' });
});

test('strict EUR-Lex parser normalizes a bounded official feed without assigning legal effect', async () => {
  const { EU_OFFICIAL_FEEDS, parseEuOfficialRss } = await import('../.build/src/packs/eu-official/index.js');
  const feed = EU_OFFICIAL_FEEDS[0];
  const parsed = parseEuOfficialRss(feed, feedXml(feed, [itemXml()]), RETRIEVED);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].celexId, '52026PC0001');
  assert.equal(parsed.entries[0].publishedAt, null);
  assert.equal(parsed.entries[0].link, 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX%3A52026PC0001');
  assert.match(parsed.entries[0].fingerprint, /^[a-f0-9]{64}$/u);
});

test('strict parser rejects DTDs, foreign links, duplicate CELEX identities and wrong channels', async () => {
  const { EU_OFFICIAL_FEEDS, parseEuOfficialRss } = await import('../.build/src/packs/eu-official/index.js');
  const feed = EU_OFFICIAL_FEEDS[0];
  assert.throws(() => parseEuOfficialRss(feed, `<!DOCTYPE rss [<!ENTITY x "bad">]>${feedXml(feed, [itemXml()])}`, RETRIEVED), /EU_RSS_DOCUMENT_INVALID/u);
  assert.throws(() => parseEuOfficialRss(feed, feedXml(feed, [itemXml({ foreign: true })]), RETRIEVED), /EU_RSS_LINK_INVALID/u);
  assert.throws(() => parseEuOfficialRss(feed, feedXml(feed, [itemXml(), itemXml()]), RETRIEVED), /EU_RSS_DUPLICATE_CELEX/u);
  assert.throws(() => parseEuOfficialRss({ ...feed, expectedChannelTitle: 'Different channel' }, feedXml(feed, [itemXml()]), RETRIEVED), /EU_RSS_CHANNEL_INVALID/u);
});

test('feed fetch is exact, bounded, conditional and rejects invalid provider responses', async () => {
  const { EU_OFFICIAL_FEEDS, fetchEuOfficialFeed } = await import('../.build/src/packs/eu-official/index.js');
  const feed = EU_OFFICIAL_FEEDS[0];
  const body = feedXml(feed, [itemXml()]);
  const calls = [];
  const result = await fetchEuOfficialFeed({
    definition: feed, previousEtag: '"old"', previousLastModified: 'Tue, 10 Nov 2026 00:00:00 GMT', now: () => NOW,
    fetchImplementation: async (url, init) => {
      calls.push({ url, init });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/xml', etag: '"new"' } });
    },
  });
  assert.equal(result.status, 'modified');
  assert.equal(result.bodyHash, hash(body));
  assert.equal(calls[0].url, feed.url);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers['If-None-Match'], '"old"');
  assert.equal(calls[0].init.headers.Accept, 'application/rss+xml');

  const unchanged = await fetchEuOfficialFeed({ definition: feed, now: () => NOW,
    fetchImplementation: async () => new Response(null, { status: 304 }) });
  assert.equal(unchanged.status, 'not-modified');
  await assert.rejects(() => fetchEuOfficialFeed({ definition: feed, now: () => NOW,
    fetchImplementation: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) }), /EU_RSS_CONTENT_TYPE_INVALID/u);
  await assert.rejects(() => fetchEuOfficialFeed({ definition: feed, now: () => NOW,
    fetchImplementation: async () => new Response('x', { status: 200, headers: { 'content-type': 'application/xml', 'content-length': '500001' } }) }), /EU_RSS_BODY_TOO_LARGE/u);
});

test('first acquisition establishes a baseline and emits no historical flood', async () => {
  const { EU_OFFICIAL_FEEDS, runEuOfficialPack } = await import('../.build/src/packs/eu-official/index.js');
  globalThis.EU_FEEDS = EU_OFFICIAL_FEEDS;
  const proposal = feedXml(EU_OFFICIAL_FEEDS[0], [itemXml()]);
  const legislation = feedXml(EU_OFFICIAL_FEEDS[1], [itemXml({ celex: '32026R0001', title: 'Synthetic adopted Regulation', creator: 'European Parliament and Council', publishedAt: 'Wed, 11 Nov 2026 00:00:00 +0100' })]);
  const output = runEuOfficialPack({ definition: definition(), acquisitions: acquisitions([proposal, legislation]),
    windowStart: '2026-11-10T20:00:00.000Z', windowEnd: RETRIEVED, now: NOW });
  assert.equal(output.result.briefing.cards.length, 0);
  assert.equal(output.diagnostics.feeds.every((feed) => feed.baselineEstablished), true);
  assert.deepEqual(output.diagnostics.feeds.map((feed) => feed.stableEntryCount), [1, 1]);
});

test('one newly listed proposal produces one attributed cautionary InfoCard', async () => {
  const { EU_OFFICIAL_FEEDS, runEuOfficialPack } = await import('../.build/src/packs/eu-official/index.js');
  globalThis.EU_FEEDS = EU_OFFICIAL_FEEDS;
  const firstProposal = feedXml(EU_OFFICIAL_FEEDS[0], [itemXml()]);
  const legislation = feedXml(EU_OFFICIAL_FEEDS[1], [itemXml({ celex: '32026R0001', title: 'Synthetic adopted Regulation', creator: 'European Parliament and Council', publishedAt: 'Wed, 11 Nov 2026 00:00:00 +0100' })]);
  const baseline = runEuOfficialPack({ definition: definition(), acquisitions: acquisitions([firstProposal, legislation]),
    windowStart: '2026-11-10T20:00:00.000Z', windowEnd: RETRIEVED, now: NOW });
  const secondProposal = feedXml(EU_OFFICIAL_FEEDS[0], [
    itemXml({ celex: '52026PC0002', title: 'Second synthetic Commission proposal', cellar: '11111111-2222-3333-4444-555555555555' }),
    itemXml(),
  ], 'Wed, 11 Nov 2026 20:45:00 +0100');
  const output = runEuOfficialPack({ definition: definition(), acquisitions: acquisitions([secondProposal, legislation], baseline.checkpoints),
    windowStart: '2026-11-10T20:00:00.000Z', windowEnd: RETRIEVED, now: NOW });
  assert.equal(output.result.briefing.cards.length, 1);
  const card = output.result.briefing.cards[0];
  assert.equal(card.kind, 'new');
  assert.equal(card.topicId, 'regulation');
  assert.equal(card.trust, 'confirmed');
  assert.equal(card.sources[0].sourceId, 'eu-eurlex-commission-proposals');
  assert.match(card.whyItMatters, /does not establish adoption, entry into force or a legal obligation/u);
  assert.match(card.direct, /EUR-Lex's official Commission proposals feed lists/u);
});

test('changed official metadata becomes one delta while rolled-off entries never become false resolutions', async () => {
  const { EU_OFFICIAL_FEEDS, runEuOfficialPack } = await import('../.build/src/packs/eu-official/index.js');
  globalThis.EU_FEEDS = EU_OFFICIAL_FEEDS;
  const proposal = feedXml(EU_OFFICIAL_FEEDS[0], [itemXml(), itemXml({ celex: '52026PC0002', title: 'Old synthetic title', cellar: '11111111-2222-3333-4444-555555555555' })]);
  const legislation = feedXml(EU_OFFICIAL_FEEDS[1], [itemXml({ celex: '32026R0001', title: 'Synthetic adopted Regulation', creator: 'European Parliament and Council', publishedAt: 'Wed, 11 Nov 2026 00:00:00 +0100' })]);
  const baseline = runEuOfficialPack({ definition: definition(), acquisitions: acquisitions([proposal, legislation]),
    windowStart: '2026-11-10T20:00:00.000Z', windowEnd: RETRIEVED, now: NOW });
  const changedAndRolled = feedXml(EU_OFFICIAL_FEEDS[0], [itemXml({ celex: '52026PC0002', title: 'Corrected synthetic title', cellar: '11111111-2222-3333-4444-555555555555' })]);
  const output = runEuOfficialPack({ definition: definition(), acquisitions: acquisitions([changedAndRolled, legislation], baseline.checkpoints),
    windowStart: '2026-11-10T20:00:00.000Z', windowEnd: RETRIEVED, now: NOW });
  assert.equal(output.result.briefing.cards.length, 1);
  assert.equal(output.result.briefing.cards[0].kind, 'changed');
  assert.equal(output.result.briefing.cards.some((card) => card.kind === 'resolved'), false);
  assert.equal(output.diagnostics.feeds[0].rolledOffEntryCount, 1);
});

test('304 and identical bodies are idempotent and preserve a finite empty delta', async () => {
  const { EU_OFFICIAL_FEEDS, runEuOfficialPack } = await import('../.build/src/packs/eu-official/index.js');
  globalThis.EU_FEEDS = EU_OFFICIAL_FEEDS;
  const feeds = [
    feedXml(EU_OFFICIAL_FEEDS[0], [itemXml()]),
    feedXml(EU_OFFICIAL_FEEDS[1], [itemXml({ celex: '32026R0001', title: 'Synthetic adopted Regulation', creator: 'European Parliament and Council', publishedAt: 'Wed, 11 Nov 2026 00:00:00 +0100' })]),
  ];
  const baseline = runEuOfficialPack({ definition: definition(), acquisitions: acquisitions(feeds),
    windowStart: '2026-11-10T20:00:00.000Z', windowEnd: RETRIEVED, now: NOW });
  const unchanged = EU_OFFICIAL_FEEDS.map((feed, index) => ({ definition: feed,
    result: { status: 'not-modified', definition: feed, retrievedAt: '2026-11-11T20:30:00.000Z', etag: null, lastModified: null },
    previousCheckpoint: baseline.checkpoints[index] }));
  const output = runEuOfficialPack({ definition: definition(), acquisitions: unchanged,
    windowStart: '2026-11-10T20:30:00.000Z', windowEnd: '2026-11-11T20:30:00.000Z', now: Date.parse('2026-11-11T20:30:00.000Z') });
  assert.equal(output.result.briefing.cards.length, 0);
  assert.equal(output.diagnostics.feeds.every((feed) => feed.notModified), true);
});
