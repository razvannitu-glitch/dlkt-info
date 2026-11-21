import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const valid = () => ({
  topics: ['technology', 'regulation'],
  entities: ['OpenAI', 'EU AI Act'],
  timezone: 'Europe/Bucharest',
  deliveryLocalTime: '07:30',
  maxCards: 2,
  minMateriality: 'medium',
  onlyActionable: true,
});

test('companion bridge serializes a strict finite briefing definition', async () => {
  const { buildCompanionBridgeSearch, buildCompanionBridgeUrl, parseCompanionBridgeSearch } = await import('../.build/src/bridge/index.js');
  const search = buildCompanionBridgeSearch(valid());
  assert.equal(search, '?bridge=companion-v1&topics=technology%2Cregulation&entities=OpenAI%7CEU+AI+Act&tz=Europe%2FBucharest&at=07%3A30&max=2&min=medium&actionable=1');
  assert.equal(buildCompanionBridgeUrl(valid()), `/today${search}`);
  const parsed = parseCompanionBridgeSearch(`${search}&trust=trust-v1&level=corroborated&conflicts=exclude&authority=primary&sources=2&age=72&officialHigh=1&_vercel_share=synthetic-preview-token`);
  assert.equal(parsed.state, 'valid');
  assert.deepEqual(parsed.definition, { ...valid(), bridgeVersion: 'dlkt-info-companion-bridge-1' });
  assert.equal(Object.isFrozen(parsed.definition), true);
  assert.equal(Object.isFrozen(parsed.definition.topics), true);
  assert.equal(Object.isFrozen(parsed.definition.entities), true);
  const expanded = parseCompanionBridgeSearch('?bridge=companion-v1&topics=technology&tz=Europe%2FBucharest&at=08%3A00&max=250&min=low&actionable=0');
  assert.equal(expanded.state, 'valid');
  assert.equal(expanded.definition.maxCards, 250);
});

test('companion bridge rejects partial, duplicate, unknown and unsafe query state', async () => {
  const { parseCompanionBridgeSearch } = await import('../.build/src/bridge/index.js');
  assert.deepEqual(parseCompanionBridgeSearch(''), { state: 'absent', definition: null });
  for (const search of [
    '?bridge=wrong&topics=technology&tz=Europe%2FBucharest&at=08%3A00&max=5&min=low&actionable=0',
    '?bridge=companion-v1&topics=technology,technology&tz=Europe%2FBucharest&at=08%3A00&max=5&min=low&actionable=0',
    '?bridge=companion-v1&topics=technology&tz=Europe%2FBucharest&at=08%3A00&max=0&min=low&actionable=0',
    '?bridge=companion-v1&topics=technology&tz=Europe%2FBucharest&at=08%3A00&max=5&min=low&actionable=0&admin=1',
    '?bridge=companion-v1&topics=technology&entities=OpenAI%7Copenai&tz=Europe%2FBucharest&at=08%3A00&max=5&min=low&actionable=0',
    '?bridge=companion-v1&topics=technology&entities=OpenAI&entities=Anthropic&tz=Europe%2FBucharest&at=08%3A00&max=5&min=low&actionable=0',
    '?bridge=companion-v1&bridge=companion-v1&topics=technology&tz=Europe%2FBucharest&at=08%3A00&max=5&min=low&actionable=0',
  ]) assert.equal(parseCompanionBridgeSearch(search).state, 'invalid');
});

test('browser bridge is storage-free and both product surfaces consume one contract', () => {
  const bridge = readFileSync('public/bridge.js', 'utf8');
  const home = readFileSync('public/index.html', 'utf8');
  const app = readFileSync('public/app.js', 'utf8');
  const today = readFileSync('public/today.js', 'utf8');
  const todayHtml = readFileSync('public/today.html', 'utf8');
  assert.match(bridge, /dlkt-info-companion-bridge-1/u);
  assert.match(bridge, /buildUrl/u);
  assert.match(bridge, /parseSearch/u);
  assert.doesNotMatch(bridge, /localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu);
  assert.equal((home.match(/<script src="\/bridge\.js" defer><\/script>/gu) ?? []).length, 1);
  assert.equal((todayHtml.match(/<script src="\/bridge\.js" defer><\/script>/gu) ?? []).length, 1);
  assert.match(app, /window\.location\.assign\(companionUrl\)/u);
  assert.match(today, /bridgeApi\.parseSearch\(window\.location\.search\)/u);
  assert.match(todayHtml, /Nothing crossed your threshold/u);
  assert.match(today, /onlyActionable/u);
});
