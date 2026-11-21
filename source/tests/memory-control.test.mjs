import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryControlContract, projectMemoryControl } from '../.build/src/memory/index.js';

const candidates = Object.freeze([
  Object.freeze({ id: 'api-pricing', label: 'API pricing', topicId: 'technology', entityId: 'demo-ai-platform', kind: 'changed', baseScore: 154, baselineRank: 1 }),
  Object.freeze({ id: 'competitor-move', label: 'Competitor move', topicId: 'business', entityId: 'demo-competitor', kind: 'new', baseScore: 150, baselineRank: 2 }),
  Object.freeze({ id: 'funding-window', label: 'Funding window', topicId: 'opportunities', entityId: 'demo-fund', kind: 'new', baseScore: 144, baselineRank: 3 }),
  Object.freeze({ id: 'supply-status', label: 'Supply status', topicId: 'supply', entityId: 'demo-component', kind: 'changed', baseScore: 142, baselineRank: 4 }),
]);
const signals = Object.freeze([
  Object.freeze({ id: 'rule:technology', source: 'explicit-rule', targetType: 'topic', targetId: 'technology', weight: 20, reason: 'Technology is explicitly selected.' }),
  Object.freeze({ id: 'feedback:competitor', source: 'relevant-feedback', targetType: 'entity', targetId: 'demo-competitor', weight: 15, reason: 'A competitor card was marked relevant.' }),
  Object.freeze({ id: 'feedback:supply', source: 'less-like-feedback', targetType: 'topic', targetId: 'supply', weight: -18, reason: 'Supply updates were marked less useful.' }),
]);

test('memory control contract is transparent, bounded and session-only', () => {
  assert.deepEqual(memoryControlContract, {
    version: 'dlkt-info-memory-control-1', route: '/memory', mode: 'synthetic-session-preview',
    maximumSignals: 24, maximumCandidates: 12, minimumWeight: -50, maximumWeight: 50,
    browserStorage: false, persistenceEnabled: false, hiddenSignalsAllowed: false,
    undoAvailable: true, automaticProfileMutation: false,
  });
});

test('memory projection applies only matching signals and exposes rank movement', () => {
  const projection = projectMemoryControl(candidates, signals);
  assert.deepEqual(projection.map((item) => ({ id: item.id, memory: item.memoryScore, rank: item.projectedRank })), [
    { id: 'api-pricing', memory: 20, rank: 1 },
    { id: 'competitor-move', memory: 15, rank: 2 },
    { id: 'funding-window', memory: 0, rank: 3 },
    { id: 'supply-status', memory: -18, rank: 4 },
  ]);
  assert.equal(projection[0].appliedSignals[0].id, 'rule:technology');
  assert.equal(Object.isFrozen(projection), true);
});

test('turning off a signal produces a deterministic next-briefing reorder', () => {
  const boosted = projectMemoryControl(candidates, [
    ...signals,
    { id: 'follow:fund', source: 'followed-entity', targetType: 'entity', targetId: 'demo-fund', weight: 40, reason: 'The funding entity is followed.' },
  ]);
  assert.equal(boosted[0].id, 'funding-window');
  assert.equal(boosted[0].rankDelta, 2);
  assert.equal(boosted[0].totalScore, 184);
});

test('memory projection rejects duplicate or over-broad inputs', () => {
  assert.throws(() => projectMemoryControl([...candidates, candidates[0]], signals), /MEMORY_CONTROL_DUPLICATE/u);
  assert.throws(() => projectMemoryControl(candidates, Array.from({ length: 25 }, (_, index) => ({
    id: `signal:${index}`, source: 'explicit-rule', targetType: 'topic', targetId: 'technology', weight: 1, reason: 'Bounded test signal.'
  }))), /MEMORY_CONTROL_INPUT_INVALID/u);
});
