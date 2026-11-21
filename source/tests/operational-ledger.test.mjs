import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const INSTANCE = '123e4567-e89b-42d3-a456-426614174000';
const START = Date.parse('2026-11-13T10:27:00.000Z');
const xmlEscape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const item = ({ celex, title, creator, cellar, publishedAt }) => `
<item><title>CELEX:${xmlEscape(celex)}: ${xmlEscape(title)}</title><description/>
<link>https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELEX:${xmlEscape(celex)}</link>
<guid>https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELLAR:${xmlEscape(cellar)}</guid>
<category>Lex Alerts</category><pubDate>${xmlEscape(publishedAt)}</pubDate><dc:creator>${xmlEscape(creator)}</dc:creator></item>`;
const feed = (definition, items) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel xmlns:dc="http://purl.org/dc/elements/1.1/">
<title>${xmlEscape(definition.expectedChannelTitle)}</title><pubDate>Fri, 13 Nov 2026 10:00:00 +0000</pubDate>
<description>Operational ledger fixture.</description><language>en</language><link>https://eur-lex.europa.eu/homepage.html</link>${items.join('')}</channel></rss>`;
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function harness() {
  const ledger = await import('../.build/src/operational-ledger/index.js');
  const { EU_OFFICIAL_FEEDS } = await import('../.build/src/packs/eu-official/index.js');
  const state = new Map();
  const set = (feedId, body) => state.set(feedId, body);
  set(EU_OFFICIAL_FEEDS[0].id, feed(EU_OFFICIAL_FEEDS[0], [item({
    celex: '52026PC0001', title: 'Initial proposal', creator: 'European Commission',
    cellar: '9502bac6-dcf8-11f1-8501-01aa75ed71a1', publishedAt: 'Fri, 13 Nov 2026 09:00:00 +0000',
  })]));
  set(EU_OFFICIAL_FEEDS[1].id, feed(EU_OFFICIAL_FEEDS[1], [item({
    celex: '32026D0001', title: 'Initial legislation', creator: 'European Parliament and Council',
    cellar: '8502bac6-dcf8-11f1-8501-01aa75ed71a2', publishedAt: 'Fri, 13 Nov 2026 09:30:00 +0000',
  })]));
  const fetchImplementation = async (input, init = {}) => {
    const url = new URL(String(input));
    const definition = EU_OFFICIAL_FEEDS.find((entry) => entry.url === url.toString());
    assert.ok(definition);
    const body = state.get(definition.id);
    assert.equal(typeof body, 'string');
    const etag = `"${hash(body)}"`;
    const headers = new Headers(init.headers);
    if (headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { etag, 'last-modified': 'Fri, 13 Nov 2026 10:00:00 GMT' } });
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8', etag, 'last-modified': 'Fri, 13 Nov 2026 10:00:00 GMT' } });
  };
  return { ledger, EU_OFFICIAL_FEEDS, state, set, fetchImplementation };
}

test('operational ledger configuration never falls back to generic Blob credentials', async () => {
  const { readOperationalLedgerConfiguration } = await import('../.build/src/operational-ledger/index.js');
  assert.equal(readOperationalLedgerConfiguration({}).state, 'disabled');
  assert.deepEqual(readOperationalLedgerConfiguration({
    DLKT_INFO_OPERATIONAL_LEDGER_ENABLED: '1',
    DLKT_INFO_LEDGER_INSTANCE_ID: INSTANCE,
    BLOB_READ_WRITE_TOKEN: ['vercel', 'blob', 'rw', 'should-never-be-used-1234567890'].join('_'),
  }), { state: 'blocked', blocker: 'OPERATIONAL_LEDGER_STORAGE_CREDENTIALS_REQUIRED' });
  const token = readOperationalLedgerConfiguration({
    DLKT_INFO_OPERATIONAL_LEDGER_ENABLED: '1', DLKT_INFO_LEDGER_INSTANCE_ID: INSTANCE,
    DLKT_INFO_LEDGER_BLOB_TOKEN: ['vercel', 'blob', 'rw', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_'),
  });
  assert.equal(token.state, 'ready');
  assert.equal(token.auth.mode, 'token');
  const oidc = readOperationalLedgerConfiguration({
    DLKT_INFO_OPERATIONAL_LEDGER_ENABLED: '1', DLKT_INFO_LEDGER_INSTANCE_ID: INSTANCE,
    DLKT_INFO_LEDGER_STORE_ID: 'store_operational_ledger', VERCEL_OIDC_TOKEN: 'oidc-token-value-that-is-long-enough',
  });
  assert.equal(oidc.state, 'ready');
  assert.equal(oidc.auth.mode, 'oidc');
});

test('operational ledger establishes an immutable baseline then computes consecutive deltas', async () => {
  const { ledger, EU_OFFICIAL_FEEDS, set, fetchImplementation } = await harness();
  const storage = new ledger.InMemoryOperationalLedgerStorage();
  await ledger.bootstrapOperationalLedgerIdentity(storage, INSTANCE, START - 60_000);

  const first = await ledger.collectOperationalDelta({ storage, instanceId: INSTANCE, dependencies: { fetchImplementation, now: () => START } });
  assert.equal(first.status, 'initialized');
  assert.equal(first.sequence, 1);
  assert.equal(first.newCount, 0);
  const initial = await ledger.readLatestOperationalDelta(storage, INSTANCE);
  assert.equal(initial.state, 'ready');
  assert.equal(initial.delta.baselineEstablished, true);
  assert.equal(initial.delta.cards.length, 0);
  assert.equal(initial.delta.unchangedCount, 2);

  const secondTime = START + 60 * 60_000;
  const second = await ledger.collectOperationalDelta({ storage, instanceId: INSTANCE, dependencies: { fetchImplementation, now: () => secondTime } });
  assert.equal(second.status, 'committed');
  assert.equal(second.sequence, 2);
  assert.equal(second.newCount, 0);
  assert.equal(second.changedCount, 0);
  assert.equal(second.unchangedCount, 2);

  set(EU_OFFICIAL_FEEDS[0].id, feed(EU_OFFICIAL_FEEDS[0], [
    item({ celex: '52026PC0001', title: 'Changed proposal', creator: 'European Commission', cellar: '9502bac6-dcf8-11f1-8501-01aa75ed71a1', publishedAt: 'Fri, 13 Nov 2026 09:00:00 +0000' }),
    item({ celex: '52026PC0002', title: 'New proposal', creator: 'European Commission', cellar: '9502bac6-dcf8-11f1-8501-01aa75ed71a3', publishedAt: 'Fri, 13 Nov 2026 11:20:00 +0000' }),
  ]));
  set(EU_OFFICIAL_FEEDS[1].id, feed(EU_OFFICIAL_FEEDS[1], [item({ celex: '32026D0002', title: 'Replacement legislation', creator: 'European Parliament and Council', cellar: '8502bac6-dcf8-11f1-8501-01aa75ed71a4', publishedAt: 'Fri, 13 Nov 2026 11:40:00 +0000' })]));
  const third = await ledger.collectOperationalDelta({ storage, instanceId: INSTANCE, dependencies: { fetchImplementation, now: () => START + 2 * 60 * 60_000 } });
  assert.equal(third.status, 'committed');
  assert.equal(third.sequence, 3);
  assert.equal(third.newCount, 2);
  assert.equal(third.changedCount, 1);
  assert.equal(third.rolledOffIgnoredCount, 1);

  const latest = await ledger.readLatestOperationalDelta(storage, INSTANCE);
  assert.equal(latest.state, 'ready');
  assert.equal(latest.delta.mode, 'operational-consecutive-delta');
  assert.equal(latest.delta.newCount, 2);
  assert.equal(latest.delta.changedCount, 1);
  assert.equal(latest.delta.rolledOffIgnoredCount, 1);
  assert.equal(latest.delta.cards.length, 3);
  assert.deepEqual(latest.delta.cards.map((entry) => entry.kind).sort(), ['changed', 'new', 'new']);
  assert.equal(latest.delta.cards.find((entry) => entry.kind === 'changed').changedFields.includes('title'), true);
  assert.equal(storage.list().filter((entry) => entry.pathname.includes('/checkpoints/')).length, 3);
});

test('source failure never advances the operational pointer', async () => {
  const { ledger, fetchImplementation } = await harness();
  const storage = new ledger.InMemoryOperationalLedgerStorage();
  await ledger.bootstrapOperationalLedgerIdentity(storage, INSTANCE, START - 60_000);
  const first = await ledger.collectOperationalDelta({ storage, instanceId: INSTANCE, dependencies: { fetchImplementation, now: () => START } });
  const failed = await ledger.collectOperationalDelta({
    storage, instanceId: INSTANCE,
    dependencies: { fetchImplementation: async () => { throw new Error('TLS CERTIFICATE FAILURE'); }, now: () => START + 60 * 60_000 },
  });
  assert.equal(failed.status, 'source-unavailable');
  assert.equal(failed.errorCode, 'OPERATIONAL_SOURCE_TRANSPORT_ERROR');
  const latest = await ledger.readLatestOperationalDelta(storage, INSTANCE);
  assert.equal(latest.state, 'ready');
  assert.equal(latest.pointer.sequence, first.sequence);
  assert.equal(latest.pointer.checkpointHash, first.checkpointHash);
});

test('same-slot concurrent writers expose only the CAS winner', async () => {
  const { ledger, EU_OFFICIAL_FEEDS, set, fetchImplementation } = await harness();
  const delegate = new ledger.InMemoryOperationalLedgerStorage();
  await ledger.bootstrapOperationalLedgerIdentity(delegate, INSTANCE, START - 60_000);
  await ledger.collectOperationalDelta({ storage: delegate, instanceId: INSTANCE, dependencies: { fetchImplementation, now: () => START } });

  let waiting = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const storage = {
    read: (pathname) => delegate.read(pathname),
    create: (pathname, body) => delegate.create(pathname, body),
    async compareAndSwap(pathname, body, etag) {
      waiting += 1;
      if (waiting === 2) release();
      await barrier;
      return delegate.compareAndSwap(pathname, body, etag);
    },
  };
  const slot = START + 60 * 60_000;
  const bodyA = feed(EU_OFFICIAL_FEEDS[0], [item({ celex: '52026PC0001', title: 'Writer A', creator: 'European Commission', cellar: '9502bac6-dcf8-11f1-8501-01aa75ed71a1', publishedAt: 'Fri, 13 Nov 2026 09:00:00 +0000' })]);
  const bodyB = feed(EU_OFFICIAL_FEEDS[0], [item({ celex: '52026PC0001', title: 'Writer B', creator: 'European Commission', cellar: '9502bac6-dcf8-11f1-8501-01aa75ed71a1', publishedAt: 'Fri, 13 Nov 2026 09:00:00 +0000' })]);
  const fetchFor = (proposalBody) => async (input, init) => {
    const definition = EU_OFFICIAL_FEEDS.find((entry) => entry.url === String(input));
    const original = definition.id === EU_OFFICIAL_FEEDS[0].id ? proposalBody : null;
    if (original) return new Response(original, { status: 200, headers: { 'content-type': 'application/rss+xml', etag: `"${hash(original)}"` } });
    return fetchImplementation(input, init);
  };
  set(EU_OFFICIAL_FEEDS[0].id, bodyA);
  const [left, right] = await Promise.all([
    ledger.collectOperationalDelta({ storage, instanceId: INSTANCE, dependencies: { fetchImplementation: fetchFor(bodyA), now: () => slot } }),
    ledger.collectOperationalDelta({ storage, instanceId: INSTANCE, dependencies: { fetchImplementation: fetchFor(bodyB), now: () => slot } }),
  ]);
  assert.deepEqual([left.status, right.status].sort(), ['committed', 'slot-conflict']);
  const latest = await ledger.readLatestOperationalDelta(delegate, INSTANCE);
  assert.equal(latest.pointer.sequence, 2);
  assert.equal(latest.pointer.slotAt, ledger.operationalSlotAt(slot));
});

test('ledger identity and checkpoint tampering fail closed', async () => {
  const { ledger, fetchImplementation } = await harness();
  const storage = new ledger.InMemoryOperationalLedgerStorage();
  await ledger.bootstrapOperationalLedgerIdentity(storage, INSTANCE, START);
  await assert.rejects(() => ledger.assertOperationalLedgerIdentity(storage, '223e4567-e89b-42d3-a456-426614174000'), /INSTANCE_MISMATCH/u);
  const first = await ledger.collectOperationalDelta({ storage, instanceId: INSTANCE, dependencies: { fetchImplementation, now: () => START } });
  const record = await storage.read(ledger.operationalCheckpointPath(first.checkpointHash));
  const parsed = JSON.parse(record.body);
  parsed.entryCount += 1;
  assert.throws(() => ledger.readOperationalCheckpoint(parsed), /COUNT_INVALID/u);
});
