import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  ENGINE_ID,
  PRODUCT_ID,
  PRODUCT_VERSION,
  SourceRegistry,
  compareClaims,
  nextDeliveryAt,
  reconcileClaims,
  runBriefingOrchestra,
} from '../.build/src/core/index.js';

const NOW = Date.parse('2026-11-11T16:00:00.000Z');
const WINDOW_START = '2026-11-10T16:00:00.000Z';
const WINDOW_END = '2026-11-11T16:00:00.000Z';
const hash = (character) => character.repeat(64);

const rights = (overrides = {}) => ({
  automatedAccess: 'permitted',
  factualExtraction: 'permitted',
  commercialSummaries: 'attribution-required',
  attributionRequired: true,
  termsUrl: 'https://regulator.example/terms',
  reviewedAt: '2026-11-01T00:00:00.000Z',
  reviewExpiresAt: '2026-12-01T00:00:00.000Z',
  note: 'Synthetic registry entry for deterministic tests.',
  ...overrides,
});

const limits = { minIntervalSeconds: 3600, maxRequestsPerDay: 24, timeoutMs: 5000, maxBytes: 1_000_000 };
const official = {
  id: 'official-regulator', name: 'Official Regulator', origin: 'https://regulator.example', authority: 'official', role: 'regulator',
  languages: ['en'], pathRules: [{ pathnamePrefix: '/updates', claimKinds: ['regulation', 'state', 'change'] }], rights: rights(), limits,
};
const primary = {
  id: 'primary-company', name: 'Primary Company', origin: 'https://company.example', authority: 'primary', role: 'company',
  languages: ['en'], pathRules: [{ pathnamePrefix: '/news', claimKinds: ['release', 'state', 'change', 'price', 'availability'] }], rights: { ...rights(), termsUrl: 'https://company.example/terms' }, limits,
};
const secondary = {
  id: 'secondary-news', name: 'Secondary News', origin: 'https://news.example', authority: 'reputable-secondary', role: 'publisher',
  languages: ['en'], pathRules: [{ pathnamePrefix: '/article', claimKinds: ['release', 'state', 'change', 'availability'] }], rights: { ...rights(), termsUrl: 'https://news.example/terms' }, limits,
};
const blocked = {
  id: 'blocked-source', name: 'Blocked Source', origin: 'https://blocked.example', authority: 'primary', role: 'publisher',
  languages: ['en'], pathRules: [{ pathnamePrefix: '/story', claimKinds: ['state'] }],
  rights: rights({ commercialSummaries: 'permission-required', termsUrl: 'https://blocked.example/terms' }), limits,
};
const sources = [official, primary, secondary, blocked];

const evidence = (sourceId = 'primary-company', overrides = {}) => {
  const origin = sourceId === 'official-regulator' ? 'https://regulator.example/updates/rule-1'
    : sourceId === 'secondary-news' ? 'https://news.example/article/company-1'
      : sourceId === 'blocked-source' ? 'https://blocked.example/story/1'
        : 'https://company.example/news/product-1';
  return {
    sourceId,
    url: origin,
    title: 'Verified source item',
    retrievedAt: '2026-11-11T15:00:00.000Z',
    publishedAt: '2026-11-11T14:30:00.000Z',
    contentHash: hash(sourceId === 'official-regulator' ? 'a' : sourceId === 'secondary-news' ? 'b' : sourceId === 'blocked-source' ? 'c' : 'd'),
    ...overrides,
  };
};

const claim = (overrides = {}) => ({
  id: 'claim-product-state-1',
  entity: { id: 'company:acme', type: 'company', label: 'Acme' },
  topicId: 'ai',
  kind: 'state',
  predicate: 'product availability',
  value: 'available',
  materiality: 'high',
  actionability: 0.8,
  observedAt: '2026-11-11T15:00:00.000Z',
  effectiveAt: null,
  validFrom: '2026-11-11T14:30:00.000Z',
  validUntil: '2026-11-12T15:00:00.000Z',
  locale: 'en',
  geography: 'EU',
  affects: ['purchase', 'launch-planning'],
  evidence: [evidence()],
  ...overrides,
});

const priorClaim = (overrides = {}) => claim({
  id: 'claim-product-state-prior',
  value: 'waitlist',
  observedAt: '2026-11-10T15:00:00.000Z',
  validFrom: '2026-11-10T14:00:00.000Z',
  validUntil: '2026-11-12T15:00:00.000Z',
  evidence: [evidence('primary-company', { retrievedAt: '2026-11-10T15:00:00.000Z', publishedAt: '2026-11-10T14:30:00.000Z', contentHash: hash('e') })],
  ...overrides,
});

const definition = (overrides = {}) => ({
  id: 'briefing-morning',
  ownerId: 'user:one',
  name: 'Morning',
  timezone: 'Europe/Bucharest',
  deliveryLocalTime: '08:00',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  channels: ['web'],
  maxCards: 5,
  rules: [{
    id: 'rule-ai', includeTopics: ['ai'], excludeTopics: [], includeEntities: [], excludeEntities: [], includeGeographies: [],
    languages: ['en'], minMateriality: 'low', weight: 2, onlyActionable: false,
  }],
  ...overrides,
});

test('identity is DLKT and the orchestra is an independent engine namespace', () => {
  assert.equal(PRODUCT_ID, 'dlkt-info');
  assert.equal(PRODUCT_VERSION, '0.9.46');
  assert.equal(ENGINE_ID, 'dlkt-info-inphocore-engine-orchestra');
  const runtime = readdirSync('src/core').filter((file) => file.endsWith('.ts')).map((file) => readFileSync(`src/core/${file}`, 'utf8')).join('\n');
  assert.doesNotMatch(runtime, /veciniada|sports-edge-ai|INPHO_SUPABASE/iu);
});

test('source registry enforces exact origin, path, rights and review lifetime', () => {
  const registry = new SourceRegistry(sources);
  assert.equal(registry.authorize(evidence(), 'state', NOW).allowed, true);
  assert.deepEqual(registry.authorize(evidence('primary-company', { url: 'https://company.example.evil.test/news/product-1' }), 'state', NOW), { allowed: false, reason: 'origin-mismatch' });
  assert.deepEqual(registry.authorize(evidence('primary-company', { url: 'https://company.example/jobs/product-1' }), 'state', NOW), { allowed: false, reason: 'path-unregistered' });
  assert.deepEqual(registry.authorize(evidence('blocked-source'), 'state', NOW), { allowed: false, reason: 'rights-blocked' });
  assert.deepEqual(registry.authorize(evidence(), 'state', Date.parse('2027-01-01T00:00:00.000Z')), { allowed: false, reason: 'registry-expired' });
});

test('claims without provenance never enter the factual ledger', () => {
  const result = reconcileClaims([claim({ evidence: [] })], new SourceRegistry(sources), NOW);
  assert.equal(result.accepted.length, 0);
  assert.deepEqual(result.rejected, [{ claimId: 'claim-product-state-1', reason: 'invalid' }]);
});

test('duplicate observations are not counted twice', () => {
  const first = claim();
  const duplicate = claim({ id: 'claim-product-state-copy' });
  const result = reconcileClaims([first, duplicate], new SourceRegistry(sources), NOW);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected[0]?.reason, 'duplicate');
});

test('contradictions stay explicit and block only dependent conclusions', () => {
  const opposing = claim({
    id: 'claim-product-state-opposing', value: 'unavailable', materiality: 'critical',
    evidence: [evidence('secondary-news')], affects: ['purchase', 'inventory-model'],
  });
  const result = reconcileClaims([claim(), opposing], new SourceRegistry(sources), NOW);
  const state = result.claims.get('company:acme|product availability');
  assert.equal(state?.status, 'contested');
  assert.equal(state?.trust, 'conflicting');
  assert.deepEqual(state?.blockedDependencies, ['inventory-model', 'launch-planning', 'purchase']);
  assert.equal(state?.selectedClaimId, null);
  assert.equal(state?.reviewPriorityClaimId, 'claim-product-state-1');
});

test('Delta First emits no card for unchanged information', () => {
  const registry = new SourceRegistry(sources);
  const previous = reconcileClaims([claim()], registry, NOW - 1000);
  const current = reconcileClaims([claim()], registry, NOW);
  assert.deepEqual(compareClaims(previous.claims, current.claims), []);
});

test('orchestra produces a finite ranked briefing instead of an infinite feed', () => {
  const changed = claim();
  const newRegulation = claim({
    id: 'claim-regulation-1', entity: { id: 'regulator:eu', type: 'regulator', label: 'EU Regulator' }, topicId: 'ai', kind: 'regulation',
    predicate: 'compliance deadline', value: '2027-02-01', materiality: 'critical', actionability: 1,
    evidence: [evidence('official-regulator')], affects: ['compliance', 'product-roadmap'],
  });
  const result = runBriefingOrchestra({
    definition: definition({ maxCards: 1 }), sources, previousClaims: [priorClaim()], currentClaims: [changed, newRegulation],
    windowStart: WINDOW_START, windowEnd: WINDOW_END, now: NOW,
  });
  assert.equal(result.briefing.cards.length, 1);
  assert.equal(result.briefing.totalEligibleDeltas, 2);
  assert.equal(result.briefing.omittedByLimit, 1);
  assert.equal(result.briefing.cards[0]?.entity.id, 'regulator:eu');
  assert.equal(result.briefing.cards[0]?.trust, 'confirmed');
  assert.equal(result.briefing.cards[0]?.sources[0]?.sourceId, 'official-regulator');
  assert.equal(result.briefing.status, 'ready');
});

test('a blocked source cannot create an InfoCard', () => {
  const blockedClaim = claim({ evidence: [evidence('blocked-source')] });
  const result = runBriefingOrchestra({
    definition: definition(), sources, previousClaims: [], currentClaims: [blockedClaim],
    windowStart: WINDOW_START, windowEnd: WINDOW_END, now: NOW,
  });
  assert.equal(result.briefing.cards.length, 0);
  assert.equal(result.diagnostics.rejectedCurrent, 1);
});

test('a conflict becomes one transparent card, not two arbitrary truths', () => {
  const opposing = claim({ id: 'claim-product-state-opposing', value: 'unavailable', evidence: [evidence('secondary-news')] });
  const result = runBriefingOrchestra({
    definition: definition(), sources, previousClaims: [priorClaim()], currentClaims: [claim(), opposing],
    windowStart: WINDOW_START, windowEnd: WINDOW_END, now: NOW,
  });
  assert.equal(result.briefing.cards.length, 1);
  assert.equal(result.briefing.cards[0]?.kind, 'conflicted');
  assert.equal(result.briefing.cards[0]?.trust, 'conflicting');
  assert.match(result.briefing.cards[0]?.direct ?? '', /available \/ unavailable|unavailable \/ available/u);
  assert.deepEqual(result.briefing.cards[0]?.blockedDependencies, ['launch-planning', 'purchase']);
});

test('delivery time is resolved in the user timezone, including the next local day', () => {
  assert.equal(nextDeliveryAt(definition(), Date.parse('2026-11-11T05:30:00.000Z')), '2026-11-11T06:00:00.000Z');
  assert.equal(nextDeliveryAt(definition(), Date.parse('2026-11-11T06:30:00.000Z')), '2026-11-12T06:00:00.000Z');
});

test('interest exclusions win over broad inclusions', () => {
  const result = runBriefingOrchestra({
    definition: definition({ rules: [{
      id: 'exclude-acme', includeTopics: ['ai'], excludeTopics: [], includeEntities: [], excludeEntities: ['company:acme'],
      includeGeographies: [], languages: ['en'], minMateriality: 'low', weight: 2, onlyActionable: false,
    }] }),
    sources, previousClaims: [priorClaim()], currentClaims: [claim()], windowStart: WINDOW_START, windowEnd: WINDOW_END, now: NOW,
  });
  assert.equal(result.briefing.cards.length, 0);
});

test('card wording is deterministic and contains only claim-backed values', () => {
  const result = runBriefingOrchestra({
    definition: definition(), sources, previousClaims: [priorClaim()], currentClaims: [claim()],
    windowStart: WINDOW_START, windowEnd: WINDOW_END, now: NOW,
  });
  const card = result.briefing.cards[0];
  assert.ok(card);
  assert.match(card.direct, /waitlist/u);
  assert.match(card.direct, /available/u);
  assert.doesNotMatch(JSON.stringify(card), /prediction|probably|maybe|AI says/iu);
});

test('synthetic demonstration exercises the complete orchestra without real-world assertions', async () => {
  const { buildSyntheticBriefing } = await import('../.build/src/demo.js');
  const result = buildSyntheticBriefing(NOW);
  assert.equal(result.synthetic, true);
  assert.equal(result.briefing.status, 'ready');
  assert.equal(result.briefing.cards.length, 5);
  assert.equal(result.definition.maxCards, 5);
  assert.deepEqual(new Set(result.briefing.cards.map((card) => card.topicId)), new Set(['technology', 'business', 'regulation', 'opportunities', 'supply']));
  const launch = result.briefing.cards.find((card) => card.topicId === 'technology');
  assert.ok(launch);
  assert.equal(launch.kind, 'changed');
  assert.match(launch.direct, /waitlist/u);
  assert.match(launch.direct, /available/u);
  assert.equal(launch.sources[0]?.sourceId, 'demo-company-official');
  const conflict = result.briefing.cards.find((card) => card.kind === 'conflicted');
  assert.ok(conflict);
  assert.equal(conflict.trust, 'conflicting');
  assert.equal(conflict.blockedDependencies.includes('procurement'), true);
  for (const card of result.briefing.cards) {
    for (const source of card.sources) assert.match(new URL(source.url).hostname, /\.example$/u);
  }
});
