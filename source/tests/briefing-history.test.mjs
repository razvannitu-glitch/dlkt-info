import assert from 'node:assert/strict';
import test from 'node:test';

const hash = (character) => character.repeat(64);
const card = (overrides = {}) => ({
  id: 'card:alpha', entityId: 'entity:alpha', topicId: 'technology', stateHash: hash('a'), rank: 1, score: 100, ...overrides,
});
const run = (overrides = {}) => ({
  id: 'run:one', generatedAt: '2026-11-11T06:00:00.000Z', cards: [card()], ...overrides,
});

test('briefing history identifies new, updated, retained, resolved and rank moves deterministically', async () => {
  const { compareBriefingRuns } = await import('../.build/src/history/index.js');
  const previous = run({ cards: [
    card({ id: 'card:updated', stateHash: hash('a'), rank: 1 }),
    card({ id: 'card:retained', stateHash: hash('b'), rank: 2 }),
    card({ id: 'card:resolved', stateHash: hash('c'), rank: 3 }),
  ] });
  const current = run({
    id: 'run:two', generatedAt: '2026-11-12T06:00:00.000Z', cards: [
      card({ id: 'card:new', stateHash: hash('d'), rank: 1 }),
      card({ id: 'card:updated', stateHash: hash('e'), rank: 2 }),
      card({ id: 'card:retained', stateHash: hash('b'), rank: 3 }),
    ],
  });
  assert.deepEqual(compareBriefingRuns(previous, current), {
    previousRunId: 'run:one', currentRunId: 'run:two',
    newCardIds: ['card:new'], updatedCardIds: ['card:updated'], retainedCardIds: ['card:retained'], resolvedCardIds: ['card:resolved'],
    rankMoves: [
      { cardId: 'card:new', previousRank: undefined, currentRank: 1, delta: undefined },
    ].filter(() => false).concat([
      { cardId: 'card:updated', previousRank: 1, currentRank: 2, delta: -1 },
      { cardId: 'card:retained', previousRank: 2, currentRank: 3, delta: -1 },
    ]),
  });
});

test('history contract is finite, storage-free and explicit about stable omissions', async () => {
  const { briefingHistoryContract } = await import('../.build/src/history/index.js');
  assert.deepEqual(briefingHistoryContract, {
    version: 'dlkt-info-briefing-history-1', memoryVersion: 'dlkt-info-explainable-memory-1', route: '/history',
    mode: 'synthetic-finite-preview', maximumRuns: 7, browserStorage: false, realDataEnabled: false,
    rankExplanation: true, memoryExplanation: true, stableSignalsRepeated: false,
  });
});

test('explainable memory applies only matching transparent signals and preserves negative feedback', async () => {
  const { explainMemoryImpact } = await import('../.build/src/history/index.js');
  const result = explainMemoryImpact(
    { topicId: 'technology', entityId: 'entity:alpha', kind: 'changed' },
    [
      { id: 'memory:topic', source: 'explicit-rule', targetType: 'topic', targetId: 'technology', weight: 12, reason: 'Technology is explicitly selected.' },
      { id: 'memory:entity', source: 'followed-entity', targetType: 'entity', targetId: 'entity:alpha', weight: 9, reason: 'The entity is explicitly followed.' },
      { id: 'memory:negative', source: 'less-like-feedback', targetType: 'kind', targetId: 'changed', weight: -4, reason: 'Similar changed cards received negative feedback.' },
      { id: 'memory:other', source: 'relevant-feedback', targetType: 'topic', targetId: 'business', weight: 30, reason: 'Business feedback does not apply here.' },
    ],
  );
  assert.equal(result.total, 17);
  assert.deepEqual(result.applied.map((signal) => signal.id), ['memory:topic', 'memory:entity', 'memory:negative']);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.applied), true);
});

test('history and memory reject invalid clocks, duplicates, hashes and hidden weight extremes', async () => {
  const { compareBriefingRuns, explainMemoryImpact } = await import('../.build/src/history/index.js');
  assert.throws(() => compareBriefingRuns(run(), run({ id: 'run:two' })), /ORDER_INVALID/u);
  assert.throws(() => compareBriefingRuns(run(), run({ id: 'run:two', generatedAt: '2026-11-12T06:00:00.000Z', cards: [card(), card()] })), /DUPLICATE/u);
  assert.throws(() => compareBriefingRuns(run(), run({ id: 'run:two', generatedAt: '2026-11-12T06:00:00.000Z', cards: [card({ stateHash: 'bad' })] })), /CARD_INVALID/u);
  assert.throws(() => explainMemoryImpact(
    { topicId: 'technology', entityId: 'entity:alpha', kind: 'changed' },
    [{ id: 'memory:bad', source: 'relevant-feedback', targetType: 'topic', targetId: 'technology', weight: 99, reason: 'Hidden extreme.' }],
  ), /SIGNAL_INVALID/u);
});
