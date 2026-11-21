import { parseCompanionPreferences } from '../companion/index.js';
import { parseTrustPolicy } from '../trust/index.js';
import {
  FIRST_RUN_ACTIVATION_MODE,
  FIRST_RUN_ACTIVATION_ROUTE,
  FIRST_RUN_ACTIVATION_STEPS,
  FIRST_RUN_ACTIVATION_VERSION,
  type FirstRunActivationInput,
  type FirstRunActivationProjection,
} from './contracts.js';

export function projectFirstRunActivation(input: FirstRunActivationInput): FirstRunActivationProjection {
  const stepIndex = FIRST_RUN_ACTIVATION_STEPS.indexOf(input.step);
  if (stepIndex < 0) throw new Error('FIRST_RUN_STEP_INVALID');
  const preferences = parseCompanionPreferences(input.preferences);
  parseTrustPolicy(input.trustPolicy);
  if (!['strict', 'balanced', 'open'].includes(input.trustPreset)) throw new Error('FIRST_RUN_TRUST_PRESET_INVALID');
  if (!Number.isInteger(input.projectedCardCount) || input.projectedCardCount < 0
      || input.projectedCardCount > preferences.maxCards) {
    throw new Error('FIRST_RUN_PROJECTED_COUNT_INVALID');
  }
  const ready = preferences.topics.length > 0 && input.projectedCardCount >= 0;
  return Object.freeze({
    version: FIRST_RUN_ACTIVATION_VERSION,
    route: FIRST_RUN_ACTIVATION_ROUTE,
    mode: FIRST_RUN_ACTIVATION_MODE,
    step: input.step,
    stepIndex,
    completedSteps: stepIndex,
    topicCount: preferences.topics.length,
    trackedEntityCount: preferences.entities.length,
    projectedCardCount: input.projectedCardCount,
    trustPreset: input.trustPreset,
    ready,
    browserStorage: false,
    persistenceEnabled: false,
    automaticExecution: false,
    factualStateMutation: false,
  });
}
