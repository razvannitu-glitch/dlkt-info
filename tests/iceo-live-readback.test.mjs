import test from 'node:test';
import assert from 'node:assert/strict';
import {assessLiveIceo, collectLiveIceo, LIVE_ICEO_ORIGIN, LIVE_ICEO_PATH,
  LIVE_ICEO_MAX_AGE_MS} from '../scripts/verify-iceo-live.mjs';

const NOW = Date.parse('2026-11-23T18:45:00.000Z');
const time = age => new Date(NOW - age).toISOString();
const fixture = () => {
  const generatedAt = time(50_000);
  return {
    status: 200, redirected: false,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'set-cookie': '',
      'x-iceo-revision': '1426',
      'x-iceo-collection-state': 'ready',
      'x-iceo-source-checked-at': generatedAt,
      'x-iceo-last-scheduled-success-at': time(30_000),
      'x-iceo-refreshed-at': time(30_000),
    },
    body: JSON.stringify({
      version: 'iceo-primary-mesh-1', product: 'dlkt-info',
      state: 'partial', generatedAt,
      sources: [{state: 'verified'}, {state: 'unavailable'}],
      cards: [{kind: 'publication'}, {kind: 'legal-document'}],
    }),
  };
};

test('partial source coverage is valid when a distinct scheduled publication is fresh', () => {
  const result = assessLiveIceo(fixture(), NOW);
  assert.equal(result.status, 'ICEO_LIVE_HEALTHY');
  assert.deepEqual(result.failures, []);
  assert.equal(result.revision, 1426);
  assert.equal(result.cardCount, 2);
  assert.equal(result.publicationCount, 1);
  assert.equal(result.availableSourceCount, 1);
});

test('successful HTTP response cannot mask a stopped scheduler', () => {
  const data = fixture();
  data.headers['x-iceo-last-scheduled-success-at'] = time(LIVE_ICEO_MAX_AGE_MS + 1);
  const result = assessLiveIceo(data, NOW);
  assert.equal(result.status, 'ICEO_LIVE_BLOCKED');
  assert.ok(result.failures.includes('fresh-scheduled-publication'));
});

test('old generated data cannot borrow freshness from a new successful receipt', () => {
  const data = fixture();
  const body = JSON.parse(data.body);
  body.generatedAt = time(LIVE_ICEO_MAX_AGE_MS + 1);
  data.body = JSON.stringify(body);
  data.headers['x-iceo-source-checked-at'] = body.generatedAt;
  assert.ok(assessLiveIceo(data, NOW).failures.includes('fresh-source-check'));
});

test('future timestamps, broken readback and a delayed collection fail closed', () => {
  const data = fixture();
  data.headers['x-iceo-refreshed-at'] = time(-120_000);
  data.headers['x-iceo-collection-state'] = 'delayed';
  const failures = assessLiveIceo(data, NOW).failures;
  assert.ok(failures.includes('fresh-durable-readback'));
  assert.ok(failures.includes('collection-state'));
});

test('a broken API must not pass as healthy due to a recent date alone', () => {
  const data = fixture();
  data.status = 503;
  data.headers['content-type'] = 'text/html';
  data.body = '{"error":"ICEO_TEMPORARILY_UNAVAILABLE"}';
  const failures = assessLiveIceo(data, NOW).failures;
  assert.ok(failures.includes('http-200'));
  assert.ok(failures.includes('json-response'));
  data.status = 200;
  data.body = JSON.stringify({...JSON.parse(fixture().body), state: 'unavailable'});
  assert.ok(assessLiveIceo(data, NOW).failures.includes('usable-card-catalog'));
  assert.ok(assessLiveIceo(data, NOW).failures.includes('json-response'));
});

test('missing cards, missing headers and unexpected cookies are rejected', () => {
  const data = fixture();
  data.body = JSON.stringify({...JSON.parse(data.body), cards: []});
  delete data.headers['x-iceo-revision'];
  data.headers['set-cookie'] = 'session=unexpected';
  const failures = assessLiveIceo(data, NOW).failures;
  for (const check of ['durable-revision', 'usable-card-catalog', 'security-headers'])
    assert.ok(failures.includes(check), check);
});

test('network read is exact-origin, query-free, read-only and not a refresh trigger', async () => {
  const sample = fixture();
  let requests = 0;
  const fetcher = async (url, options) => {
    requests++;
    assert.equal(url, LIVE_ICEO_ORIGIN + LIVE_ICEO_PATH);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(options.headers, {Accept: 'application/json'});
    assert.equal(url.includes('?'), false);
    const response = new Response(sample.body, {headers: sample.headers});
    return response;
  };
  const received = await collectLiveIceo(fetcher);
  assert.equal(requests, 1);
  assert.equal(assessLiveIceo(received, NOW).status, 'ICEO_LIVE_HEALTHY');
});

test('large responses and external redirects cannot be trusted', async () => {
  await assert.rejects(collectLiveIceo(async () =>
    new Response('x', {headers: {'content-length': '2000000'}})), /DLKT_LIVE_ICEO_RESPONSE_SIZE/);
  const sample = await collectLiveIceo(async () =>
    new Response(null, {status: 302, headers: {location: 'https://example.com/'}}));
  assert.equal(sample.status, 302);
  assert.ok(assessLiveIceo(sample, NOW).failures.includes('http-200'));
});

test('invalid monitor input cannot be misreported as a pass', () => {
  assert.throws(() => assessLiveIceo(null, NOW), /DLKT_LIVE_ICEO_INPUT/);
  assert.throws(() => assessLiveIceo(fixture(), NaN), /DLKT_LIVE_ICEO_INPUT/);
});
