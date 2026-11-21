import assert from 'node:assert/strict';
import test from 'node:test';
import {IceoEngine} from '../.build/src/iceo/engine.js';
import {ICEO_SOURCES} from '../.build/src/iceo/registry.js';

const START = Date.parse('2026-11-21T12:00:00.000Z');
const HOUR = 3_600_000;
const stamp = at => new Date(at).toISOString();
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const articleUrls = {
  'fda-news': 'https://www.fda.gov/news-events/press-announcements/controlled-refresh',
  'gv-culture': 'https://globalvoices.org/2026/11/21/controlled-refresh/',
  'nasa-news': 'https://www.nasa.gov/news-release/controlled-refresh/',
  'ecb-news': 'https://www.ecb.europa.eu/press/controlled-refresh.html',
};

function source(id) {
  const value = ICEO_SOURCES.find(entry => entry.id === id);
  assert.ok(value, `Registered source ${id} is required`);
  return value;
}

function feed(value) {
  const title = value.feed?.title ?? 'ECB - European Central Bank';
  const home = value.feed?.homeOrigin ?? 'https://www.ecb.europa.eu';
  const credits = value.id === 'gv-culture'
    ? '<div class="gv-rss-footer"><div class="text-credits-section"><span class="credit-label">Written (Portugues) by</span><a class="user-link" href="https://pt.globalvoices.org/author/controlled/">Controlled Writer</a></div><div class="text-credits-section"><span class="credit-label">Translated (English) by</span><a class="user-link">Controlled Translator</a></div></div>'
    : '';
  return `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>${xml(title)}</title><link>${home}</link><item><title>Controlled publisher update</title><link>${articleUrls[value.id]}</link><pubDate>Sat, 21 Nov 2026 10:00:00 GMT</pubDate><description>Controlled feed fixture with a complete publisher statement.</description><content:encoded><![CDATA[${credits}]]></content:encoded></item></channel></rss>`;
}

function response(value) {
  return new Response(feed(value), {headers: {'content-type': 'application/rss+xml', etag: '"controlled-feed"'}});
}

function provenance(result) {
  assert.equal(result.cards.length, 1);
  return {
    checkedAt: result.health.checkedAt,
    verifiedAt: result.health.verifiedAt,
    observedAt: result.cards[0].observedAt,
  };
}

function verifiedAt(result, at) {
  assert.equal(result.health.state, 'verified');
  assert.equal(result.health.error, null);
  assert.equal(result.health.rejected, 0);
  assert.equal(result.health.count, 1);
  assert.equal(result.cards[0]?.sourceState, 'verified');
  assert.deepEqual(provenance(result), {checkedAt: stamp(at), verifiedAt: stamp(at), observedAt: stamp(at)});
}

for (const id of ['fda-news', 'gv-culture']) {
  test(`${id} keeps its hourly interval and original evidence until the actual source check`, async () => {
    const selected = source(id);
    assert.equal(selected.feed.refreshSeconds, 3600);
    let clock = START, calls = 0;
    const engine = new IceoEngine(async () => {calls++; return response(selected);}, () => clock);
    const first = await engine.read(selected);
    verifiedAt(first, START);
    assert.equal(calls, 1);

    for (const elapsed of [1_800_000, 3_599_000, HOUR - 1]) {
      clock = START + elapsed;
      const cached = await engine.read(selected);
      assert.equal(calls, 1, `${id} must not be rechecked after ${elapsed}ms`);
      assert.deepEqual(provenance(cached), provenance(first));
      assert.equal(cached.cards[0].contentHash, first.cards[0].contentHash);
    }

    clock = START + HOUR;
    const refreshed = await engine.read(selected);
    assert.equal(calls, 2);
    verifiedAt(refreshed, clock);
    assert.equal(refreshed.cards[0].date, first.cards[0].date);
    assert.equal(refreshed.cards[0].contentHash, first.cards[0].contentHash);
  });
}

test('an hourly 304 recheck renews observation time and starts a complete new hourly interval', async () => {
  const selected = source('fda-news');
  let clock = START, calls = 0;
  const validators = [];
  const engine = new IceoEngine(async (_url, init) => {
    calls++;
    validators.push(new Headers(init.headers).get('if-none-match'));
    return calls === 1 ? response(selected) : new Response(null, {status: 304});
  }, () => clock);
  const first = await engine.read(selected);
  verifiedAt(first, START);

  clock = START + HOUR;
  const checked = await engine.read(selected);
  assert.equal(calls, 2);
  assert.deepEqual(validators, [null, '"controlled-feed"']);
  verifiedAt(checked, clock);
  assert.equal(checked.cards[0].contentHash, first.cards[0].contentHash);
  assert.equal(checked.cards[0].date, first.cards[0].date);

  for (const elapsed of [1_800_000, HOUR - 1]) {
    clock = START + HOUR + elapsed;
    assert.deepEqual(provenance(await engine.read(selected)), provenance(checked));
    assert.equal(calls, 2);
  }
  clock = START + 2 * HOUR;
  verifiedAt(await engine.read(selected), clock);
  assert.equal(calls, 3);
  assert.deepEqual(validators, [null, '"controlled-feed"', '"controlled-feed"']);
});

test('hourly source failures retain the last verified evidence and keep exponential retry backoff', async () => {
  const selected = source('fda-news');
  let clock = START, calls = 0;
  const engine = new IceoEngine(async () => {
    calls++;
    if (calls === 2 || calls === 3) throw new Error('controlled network failure');
    return response(selected);
  }, () => clock);
  const first = await engine.read(selected);
  verifiedAt(first, START);

  clock = START + HOUR;
  const failed = await engine.read(selected);
  assert.equal(calls, 2);
  assert.equal(failed.health.state, 'stale');
  assert.equal(failed.cards[0].sourceState, 'stale');
  assert.deepEqual(provenance(failed), {checkedAt: stamp(clock), verifiedAt: stamp(START), observedAt: stamp(START)});
  assert.equal(failed.health.retryAt, stamp(clock + 60_000));

  clock = START + HOUR + 59_999;
  assert.deepEqual(provenance(await engine.read(selected)), provenance(failed));
  assert.equal(calls, 2);
  clock++;
  const failedAgain = await engine.read(selected);
  assert.equal(calls, 3);
  assert.equal(failedAgain.health.state, 'stale');
  assert.equal(failedAgain.health.retryAt, stamp(clock + 120_000));
  assert.equal(failedAgain.health.verifiedAt, first.health.verifiedAt);
  assert.equal(failedAgain.cards[0].observedAt, first.cards[0].observedAt);

  clock = START + HOUR + 179_999;
  assert.deepEqual(provenance(await engine.read(selected)), provenance(failedAgain));
  assert.equal(calls, 3);
  clock++;
  const recoveredAt = clock;
  const recovered = await engine.read(selected);
  verifiedAt(recovered, recoveredAt);
  assert.equal(recovered.health.retryAt, null);
  assert.equal(calls, 4);
  clock = recoveredAt + HOUR - 1;
  assert.deepEqual(provenance(await engine.read(selected)), provenance(recovered));
  assert.equal(calls, 4);
  clock++;
  verifiedAt(await engine.read(selected), clock);
  assert.equal(calls, 5);
});

test('provider Retry-After remains authoritative even when it exceeds the hourly source interval', async () => {
  const selected = source('fda-news');
  let clock = START, calls = 0;
  const engine = new IceoEngine(async () => {
    calls++;
    return calls === 2 ? new Response(null, {status: 429, headers: {'retry-after': '7200'}}) : response(selected);
  }, () => clock);
  const first = await engine.read(selected);
  verifiedAt(first, START);
  clock = START + HOUR;
  const limited = await engine.read(selected);
  assert.equal(calls, 2);
  assert.equal(limited.health.state, 'stale');
  assert.equal(limited.health.error, 'SOURCE_RATE_LIMITED');
  assert.equal(limited.health.retryAt, stamp(START + 3 * HOUR));
  assert.equal(limited.cards[0].observedAt, first.cards[0].observedAt);

  for (const elapsed of [2 * HOUR, 3 * HOUR - 1]) {
    clock = START + elapsed;
    assert.deepEqual(provenance(await engine.read(selected)), provenance(limited));
    assert.equal(calls, 2);
  }
  clock = START + 3 * HOUR;
  const recovered = await engine.read(selected);
  verifiedAt(recovered, clock);
  assert.equal(recovered.health.retryAt, null);
  assert.equal(calls, 3);
});

test('default 900-second and configured 1800-second source intervals retain their existing boundaries', async () => {
  for (const [id, interval] of [['ecb-news', 900_000], ['nasa-news', 1_800_000]]) {
    const selected = source(id);
    assert.equal(selected.feed?.refreshSeconds ?? 900, interval / 1000);
    let clock = START, calls = 0;
    const engine = new IceoEngine(async () => {calls++; return response(selected);}, () => clock);
    const first = await engine.read(selected);
    verifiedAt(first, START);

    clock = START + interval - 1;
    assert.deepEqual(provenance(await engine.read(selected)), provenance(first));
    assert.equal(calls, 1, `${id} must wait for its interval`);
    clock++;
    const checked = await engine.read(selected);
    verifiedAt(checked, clock);
    assert.equal(calls, 2, `${id} must recheck at its boundary`);

    clock = START + 2 * interval - 1;
    assert.deepEqual(provenance(await engine.read(selected)), provenance(checked));
    assert.equal(calls, 2);
    clock++;
    verifiedAt(await engine.read(selected), clock);
    assert.equal(calls, 3);
  }
});
