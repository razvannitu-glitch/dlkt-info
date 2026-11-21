import assert from 'node:assert/strict';
import test from 'node:test';

const base = Object.freeze({
  selectedStage: 'briefing', currentCardId: 'demo-tech-pricing', briefingCardCount: 40, trackedEntityCount: 24,
  trustIncludedCount: 4, trustExcludedCount: 2, memorySignalCount: 3, activeActionCount: 4,
  dueNowCount: 1, waitingCount: 2, notifyNowCount: 1, deferredCount: 0, nextBriefingCount: 2,
});

test('unified shell projects one finite inspectable companion loop', async () => {
  const { projectUnifiedShell, unifiedShellContract } = await import('../.build/src/shell/index.js');
  const projection = projectUnifiedShell(base);
  assert.equal(projection.version, 'dlkt-info-unified-shell-1');
  assert.equal(projection.route, '/companion-preview');
  assert.equal(projection.steps.length, 6);
  assert.equal(projection.finiteCardCount, 40);
  assert.equal(projection.trackedEntityCount, 24);
  assert.equal(projection.immediateAttentionCount, 2);
  assert.equal(projection.automaticExecution, false);
  assert.equal(projection.factualStateMutation, false);
  assert.equal(projection.browserStorage, false);
  assert.equal(projection.persistenceEnabled, false);
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(unifiedShellContract.cardBudget, 'user-defined-positive-integer');
  assert.equal(unifiedShellContract.entityCapacity, 'payload-bounded');
});

test('unified shell exposes attention, waiting and empty states without inventing work', async () => {
  const { projectUnifiedShell } = await import('../.build/src/shell/index.js');
  const projection = projectUnifiedShell({ ...base, selectedStage: 'inbox', dueNowCount: 0, waitingCount: 2, notifyNowCount: 0, deferredCount: 1 });
  assert.equal(projection.steps.find((entry) => entry.id === 'inbox')?.state, 'waiting');
  assert.equal(projection.steps.find((entry) => entry.id === 'delivery')?.state, 'waiting');
  assert.equal(projection.attentionCount, 1);
});

test('unified shell permits a truthful zero-result state', async () => {
  const { projectUnifiedShell } = await import('../.build/src/shell/index.js');
  const projection = projectUnifiedShell({ ...base, currentCardId: null, briefingCardCount: 0, trustIncludedCount: 0, trustExcludedCount: 0, memorySignalCount: 0, activeActionCount: 0, dueNowCount: 0, waitingCount: 0, notifyNowCount: 0, deferredCount: 0, nextBriefingCount: 0 });
  assert.equal(projection.finiteCardCount, 0);
  assert.equal(projection.steps.every((entry) => entry.state === 'empty'), true);
});

test('unified shell rejects invalid counts, stages and orphan cards', async () => {
  const { projectUnifiedShell } = await import('../.build/src/shell/index.js');
  assert.throws(() => projectUnifiedShell({ ...base, selectedStage: 'unknown' }), /UNIFIED_SHELL_STAGE_INVALID/u);
  assert.throws(() => projectUnifiedShell({ ...base, briefingCardCount: 2_147_483_648 }), /UNIFIED_SHELL_BRIEFING_COUNT_INVALID/u);
  assert.throws(() => projectUnifiedShell({ ...base, currentCardId: 'BAD ID' }), /UNIFIED_SHELL_CARD_INVALID/u);
  assert.throws(() => projectUnifiedShell({ ...base, briefingCardCount: 0 }), /UNIFIED_SHELL_ORPHAN_CARD/u);
  assert.throws(() => projectUnifiedShell({ ...base, activeActionCount: -1 }), /UNIFIED_SHELL_ACTION_COUNT_INVALID/u);
});
