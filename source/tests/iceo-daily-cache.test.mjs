import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {DailySnapshotCache, DAILY_CACHE_NAMESPACE, DAILY_CACHE_SLOT_MS, validDailySnapshot} from '../.build/src/iceo/daily-cache.js';
import {PUBLIC_TOPICS} from '../.build/src/iceo/topics.js';
import {PUBLIC_EDITORIAL_CATEGORIES,EDITORIAL_CATEGORY_TOPICS} from '../.build/src/iceo/editorial-categories.js';
import {handleIceoRefresh} from '../.build/api/iceo-refresh.js';
import {ICEO_SOURCES} from '../.build/src/iceo/registry.js';

const START = Date.parse('2026-11-20T05:01:00.000Z');
const clone = value => structuredClone(value);

class MemoryStore {
  entries = new Map();
  writes = [];
  reads = [];
  async read(key) { this.reads.push(key); return clone(this.entries.get(key)); }
  async write(key, value, ttl) { this.writes.push({key, value: clone(value), ttl}); this.entries.set(key, clone(value)); }
}

function snapshot(now = START, count = 30) {
  const cards = Array.from({length: count}, (_, index) => ({
    id: createHash('sha256').update(`daily-cache-${index}`).digest('hex').slice(0, 24),
    identity: `https://www.nasa.gov/daily-cache-test/${index}`,
    title: `Controlled daily publication ${index}`, topic: EDITORIAL_CATEGORY_TOPICS[PUBLIC_EDITORIAL_CATEGORIES[index % 20]],
    kind: 'publication', sourceUrl: `https://www.nasa.gov/daily-cache-test/${index}`,
    publisher: `Controlled publisher ${index}`, sourceIds: [`news-${PUBLIC_EDITORIAL_CATEGORIES[index % 20]}`],
    date: new Date(now - 3_600_000).toISOString(), dateLabel: 'Published', observedAt: new Date(now).toISOString(),
    contentHash: createHash('sha256').update(`daily-cache-body-${index}`).digest('hex'),
    boundary: 'Controlled fixture, not real reporting.', deadline: null, version: null,
    attribution: `Controlled publisher ${index}`, sourceState: 'verified',
  }));
  const sources = (cards.length ? [...new Map(cards.map(card=>[card.sourceIds[0],card])).values()] : [{topic: 'science', sourceIds: ['controlled-empty'], publisher: 'Controlled empty source'}]).map(card => ({
    id: card.sourceIds[0], label: card.publisher, publisher: card.publisher, topic: card.topic,
    state: 'verified', checkedAt: new Date(now).toISOString(), verifiedAt: new Date(now).toISOString(),
    count: cards.filter(c=>c.sourceIds[0]===card.sourceIds[0]).length, rejected: 0, error: null, retryAt: null,
    scope: 'Controlled test feed.', termsUrl: 'https://www.nasa.gov/nasa-brand-center/', windowed: true,
  }));
  return {version: 'iceo-primary-mesh-1', product: 'dlkt-info', productVersion: '0.9.46', mode: 'current-official-records',
    generatedAt: new Date(now).toISOString(), state: 'ready', sources, cards, conflictCount: 0, duplicateCount: 0,
    deltaAvailable: false, scheduledDelivery: false, accountPersistence: false, coverage: [...new Set(sources.map(source => source.topic))]};
}

const response = () => ({headers: {}, statusCode: 0, body: '', setHeader(name, value) {this.headers[name] = value;}, end(body = '') {this.body = body;}});
const request = (authorization, patch = {}) => ({method: 'GET', url: '/api/iceo-refresh', headers: authorization === undefined ? {} : {authorization}, ...patch});

test('cache namespace isolates this public catalog by project and registry revision', () => {
  assert.match(DAILY_CACHE_NAMESPACE, /^prj_3JKAWw8EvzWKNPqFNFxk4iDL2l7P:iceo-daily-v1:[a-f0-9]{16}$/u);
  const previousRegistryOnlyHash=createHash('sha256').update(JSON.stringify(ICEO_SOURCES)).digest('hex').slice(0,16);
  assert.notEqual(DAILY_CACHE_NAMESPACE,`prj_3JKAWw8EvzWKNPqFNFxk4iDL2l7P:iceo-daily-v1:${previousRegistryOnlyHash}`);
});

test('first refresh acquires sources, verifies shared readback and reports actual daily coverage', async () => {
  const store = new MemoryStore(), original = snapshot(); let calls = 0;
  const cache = new DailySnapshotCache(store, async () => {calls++; return original;}, () => START);
  const receipt = await cache.refresh();
  assert.equal(calls, 1); assert.equal(store.writes.length, 1); assert.equal(store.writes[0].ttl, 3_600);
  assert.equal(receipt.acquisition, 'source-check'); assert.equal(receipt.sharedCacheReadback, true);
  assert.equal(receipt.selectedCount, 30); assert.equal(receipt.minimumMet, true);
  assert.equal(receipt.categoryCount, 20); assert.deepEqual(receipt.missingCategories, []);
  assert.equal(receipt.sourceCheckedAt, original.generatedAt); assert.equal(receipt.editionDate, '2026-11-20');
  assert.equal(receipt.editionTimezone, 'UTC'); assert.equal(receipt.window, 'last-24-hours');
  assert.equal(receipt.snapshotDigest, createHash('sha256').update(JSON.stringify(original)).digest('hex'));
  assert.deepEqual(await cache.snapshot(), original);
});

test('a separate service process reads the same slot without reacquiring or rewriting source dates', async () => {
  const store = new MemoryStore(), original = snapshot(); let calls = 0;
  await new DailySnapshotCache(store, async () => original, () => START).refresh();
  const later = new DailySnapshotCache(store, async () => {calls++; return snapshot(START + 600_000);}, () => START + 600_000);
  const result = await later.snapshot(), receipt = await later.refresh();
  assert.equal(calls, 0); assert.equal(store.writes.length, 1); assert.deepEqual(result, original);
  assert.equal(receipt.acquisition, 'shared-cache'); assert.equal(receipt.sourceCheckedAt, original.generatedAt);
  assert.deepEqual(result.cards.map(card => [card.date, card.observedAt]), original.cards.map(card => [card.date, card.observedAt]));
});

test('in-process concurrent cold requests coalesce before reading or acquiring a second time', async () => {
  const store = new MemoryStore(); let calls = 0, finish, started;
  const beginning=new Promise(resolve=>{started=resolve;});
  const cache = new DailySnapshotCache(store, () => {calls++; return new Promise(resolve => {finish = resolve;started();});}, () => START);
  const first = cache.snapshot(), second = cache.snapshot();
  await beginning; finish(snapshot());
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1); assert.equal(store.writes.length, 1); assert.deepEqual(a, b);
});

test('quarter-hour rollover uses a new key and cannot reuse the previous edition observation', async () => {
  const store = new MemoryStore(); let now = START, calls = 0;
  const cache = new DailySnapshotCache(store, async () => {calls++; return snapshot(now);}, () => now);
  await cache.snapshot(); now += DAILY_CACHE_SLOT_MS;
  const next = await cache.snapshot();
  assert.equal(calls, 2); assert.equal(store.entries.size, 2); assert.notEqual(store.writes[0].key, store.writes[1].key);
  assert.equal(next.generatedAt, new Date(now).toISOString());
});

test('an earlier slow slot finishes into its own key and does not overwrite the newer slot', async () => {
  const store = new MemoryStore(); let oldNow = START, finishOld;
  const old = new DailySnapshotCache(store, () => new Promise(resolve => {finishOld = resolve;}), () => oldNow);
  const pending = old.snapshot(); await Promise.resolve(); await Promise.resolve();
  const nextNow = START + DAILY_CACHE_SLOT_MS;
  await new DailySnapshotCache(store, async () => snapshot(nextNow), () => nextNow).snapshot();
  finishOld(snapshot()); await pending;
  const loaded = await new DailySnapshotCache(store, async () => {throw new Error('MUST_NOT_LOAD');}, () => nextNow).snapshot();
  assert.equal(loaded.generatedAt, new Date(nextNow).toISOString()); assert.equal(store.entries.size, 2);
});

test('stale, mismatched-slot and unknown-field cache entries are ignored before fresh acquisition', async () => {
  for (const mutation of [
    entry => {entry.snapshot.generatedAt = new Date(START - DAILY_CACHE_SLOT_MS).toISOString();},
    entry => {entry.slot = '2026-11-19T05:00:00.000Z';},
    entry => {entry.snapshot.account = {email: 'private@example.invalid'};},
    entry => {entry.snapshot.cards[0].wallet = 'private note';},
    entry => {entry.snapshot.sources[0].accessToken = 'private token';},
  ]) {
    const store = new MemoryStore();
    await new DailySnapshotCache(store, async () => snapshot(), () => START).snapshot();
    mutation(store.entries.values().next().value); let calls = 0;
    const result = await new DailySnapshotCache(store, async () => {calls++; return snapshot();}, () => START).snapshot();
    assert.equal(calls, 1); assert.equal(validDailySnapshot(result, START), true);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('new source results with unknown private fields are rejected without shared writes', async () => {
  const store = new MemoryStore(), unsafe = {...snapshot(), userId: 'private-user'};
  await assert.rejects(new DailySnapshotCache(store, async () => unsafe, () => START).snapshot(), /DAILY_SNAPSHOT_INVALID/u);
  assert.equal(store.writes.length, 0);
});

test('an unavailable refresh does not store failed observations or replace the prior slot', async () => {
  const store = new MemoryStore(); await new DailySnapshotCache(store, async () => snapshot(), () => START).snapshot();
  const now = START + DAILY_CACHE_SLOT_MS, unavailable = snapshot(now, 0);
  unavailable.state = 'unavailable'; unavailable.sources[0].state = 'unavailable'; unavailable.sources[0].verifiedAt = null;
  const cache = new DailySnapshotCache(store, async () => unavailable, () => now);
  const retained=await cache.snapshot();
  assert.equal(retained.state, 'ready'); assert.equal(retained.generatedAt,new Date(START).toISOString());
  await assert.rejects(cache.refresh(), /DAILY_REFRESH_RETAINED_OLD_CHECK/u);
  assert.equal(store.entries.size, 1); assert.equal(store.writes.length, 1);
});

test('under-target daily supply stays explicitly under-target and keeps its real count', async () => {
  const receipt = await new DailySnapshotCache(new MemoryStore(), async () => snapshot(START, 3), () => START).refresh();
  assert.equal(receipt.selectedCount, 3); assert.equal(receipt.minimumMet, false);
  assert.equal(receipt.minimum, 20); assert.equal(receipt.target, 30); assert.equal(receipt.maximum, 40);
  assert.equal(receipt.missingCategories.length, 17);
});

test('a check late in its slot remains usable across the fourth slot while still less than one hour old',async()=>{
  const acquired=Date.parse('2026-11-20T05:14:00.000Z'),now=Date.parse('2026-11-20T06:00:00.000Z');
  const store=new MemoryStore();await new DailySnapshotCache(store,async()=>snapshot(acquired),()=>acquired).snapshot();
  const cache=new DailySnapshotCache(store,async()=>{throw Error('SOURCE_OUTAGE');},()=>now);
  assert.equal((await cache.snapshot()).generatedAt,new Date(acquired).toISOString());
  await assert.rejects(cache.refresh(),/DAILY_REFRESH_RETAINED_OLD_CHECK/u);
  const expired=new DailySnapshotCache(store,async()=>{throw Error('SOURCE_OUTAGE');},()=>acquired+3_600_001);
  await assert.rejects(expired.snapshot(),/SOURCE_OUTAGE/u);
});

test('public reading can recover from cache failure but scheduled refresh never fabricates a readback', async () => {
  const broken = {async read() {throw new Error('CACHE_OFFLINE');}, async write() {throw new Error('CACHE_OFFLINE');}};
  const cache = new DailySnapshotCache(broken, async () => snapshot(), () => START);
  assert.equal((await cache.snapshot()).cards.length, 30);
  await assert.rejects(cache.refresh(), /DAILY_CACHE_READBACK_FAILED/u);
});

test('a write acknowledgement alone cannot produce a successful scheduled receipt', async () => {
  const unreadable = {async read() {return null;}, async write() {}};
  await assert.rejects(new DailySnapshotCache(unreadable, async () => snapshot(), () => START).refresh(), /DAILY_CACHE_READBACK_FAILED/u);
});

test('unresponsive runtime cache operations cannot hold the public source result indefinitely',{timeout:6000},async()=>{
  const stalled={read:()=>new Promise(()=>{}),async write(){throw Error('CACHE_UNAVAILABLE');}};
  assert.equal((await new DailySnapshotCache(stalled,async()=>snapshot(),()=>START).snapshot()).cards.length,30);
  const noWrite={async read(){return null;},write:()=>new Promise(()=>{})};
  await assert.rejects(new DailySnapshotCache(noWrite,async()=>snapshot(),()=>START).refresh(),/DAILY_CACHE_READBACK_FAILED/u);
});

test('midnight rollover changes the UTC edition date while preserving original publication dates', async () => {
  const now = Date.parse('2026-11-21T00:01:00Z'), value = snapshot(now);
  value.cards[0].date = '2026-11-20T23:10:00.000Z';
  const receipt = await new DailySnapshotCache(new MemoryStore(), async () => value, () => now).refresh();
  assert.equal(receipt.editionDate, '2026-11-21'); assert.equal(value.cards[0].date, '2026-11-20T23:10:00.000Z');
  assert.equal(receipt.window, 'last-24-hours');
});

test('cron endpoint rejects absent, malformed and wrong secrets before any acquisition', async () => {
  for (const [secret, header] of [[undefined, undefined], ['short', 'Bearer short'], ['a'.repeat(32), undefined], ['a'.repeat(32), 'Bearer '+ 'b'.repeat(32)], ['a'.repeat(32), ['Bearer '+ 'a'.repeat(32)]], ['a'.repeat(31)+' ', 'Bearer '+ 'a'.repeat(31)+' ']]) {
    let calls = 0; const res = response();
    await handleIceoRefresh(request(header), res, {environment: {CRON_SECRET: secret}, refresh: async () => {calls++; return {};}});
    assert.equal(res.statusCode, 401); assert.equal(calls, 0);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.deepEqual(JSON.parse(res.body), {error: 'AUTHENTICATION_REQUIRED'});
  }
});

test('cron endpoint accepts only a query-free GET and never accepts user-specific payloads', async () => {
  const secret = 'x'.repeat(40); let calls = 0;
  for (const [patch, expected] of [[{method: 'POST'}, 405], [{method: 'HEAD'}, 405], [{url: '/api/iceo-refresh?user=private'}, 400]]) {
    const res = response();
    await handleIceoRefresh(request('Bearer '+secret, patch), res, {environment: {CRON_SECRET: secret}, refresh: async () => {calls++; return {};}});
    assert.equal(res.statusCode, expected);
  }
  assert.equal(calls, 0);
});

test('authenticated cron returns the actual receipt and uses generic errors without exposing internals', async () => {
  const secret = 'z'.repeat(40), receipt = {version: 'controlled-receipt', sharedCacheReadback: true};
  const ok = response();
  await handleIceoRefresh(request('Bearer '+secret), ok, {environment: {CRON_SECRET: secret}, refresh: async () => receipt});
  assert.equal(ok.statusCode, 200); assert.deepEqual(JSON.parse(ok.body), receipt);
  const failed = response();
  await handleIceoRefresh(request('Bearer '+secret), failed, {environment: {CRON_SECRET: secret}, refresh: async () => {throw new Error('private cache credential');}});
  assert.equal(failed.statusCode, 503); assert.equal(failed.headers['Retry-After'], '60');
  assert.deepEqual(JSON.parse(failed.body), {error: 'DAILY_REFRESH_UNAVAILABLE'});
});
