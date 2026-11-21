import assert from 'node:assert/strict';
import test from 'node:test';

const preferences = Object.freeze({
  topics: ['technology', 'regulation', 'opportunities'],
  entities: Array.from({ length: 12 }, (_, index) => `Entity ${index + 1}`),
  timezone: 'Europe/Bucharest',
  deliveryLocalTime: '08:00',
  maxCards: 25,
  minMateriality: 'medium',
  onlyActionable: false,
});
const policy = Object.freeze({
  minimumTrust: 'corroborated', conflictPolicy: 'exclude', authorityRequirement: 'primary',
  minimumSources: 2, maximumEvidenceAgeHours: 72, requireOfficialForHighImpact: true,
});

test('first-run activation projects an explicit finite contract', async () => {
  const { projectFirstRunActivation, firstRunActivationContract } = await import('../.build/src/activation/index.js');
  const projection = projectFirstRunActivation({ step: 'preview', preferences, trustPreset: 'balanced', trustPolicy: policy, projectedCardCount: 2 });
  assert.deepEqual(projection, {
    version: 'dlkt-info-first-run-activation-1', route: '/start', mode: 'synthetic-session-preview',
    step: 'preview', stepIndex: 3, completedSteps: 3, topicCount: 3, trackedEntityCount: 12,
    projectedCardCount: 2, trustPreset: 'balanced', ready: true, browserStorage: false,
    persistenceEnabled: false, automaticExecution: false, factualStateMutation: false,
  });
  assert.equal(firstRunActivationContract.entityCapacity, 'payload-bounded');
  assert.equal(firstRunActivationContract.cardBudget, 'user-defined-positive-integer');
  assert.equal(Object.isFrozen(projection), true);
});

test('first-run activation rejects inconsistent or over-broad state', async () => {
  const { projectFirstRunActivation } = await import('../.build/src/activation/index.js');
  assert.throws(() => projectFirstRunActivation({ step: 'unknown', preferences, trustPreset: 'balanced', trustPolicy: policy, projectedCardCount: 2 }), /STEP_INVALID/u);
  assert.throws(() => projectFirstRunActivation({ step: 'preview', preferences, trustPreset: 'hidden', trustPolicy: policy, projectedCardCount: 2 }), /TRUST_PRESET_INVALID/u);
  assert.throws(() => projectFirstRunActivation({ step: 'preview', preferences, trustPreset: 'balanced', trustPolicy: policy, projectedCardCount: 26 }), /PROJECTED_COUNT_INVALID/u);
  assert.throws(() => projectFirstRunActivation({ step: 'preview', preferences: { ...preferences, entities: ['OpenAI', 'openai'] }, trustPreset: 'balanced', trustPolicy: policy, projectedCardCount: 2 }), /COMPANION_INPUT_INVALID/u);
});
