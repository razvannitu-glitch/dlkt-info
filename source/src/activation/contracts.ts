import type { CompanionPreferences } from '../companion/contracts.js';
import type { TrustPolicy } from '../trust/contracts.js';

export const FIRST_RUN_ACTIVATION_VERSION = 'dlkt-info-first-run-activation-1' as const;
export const FIRST_RUN_ACTIVATION_ROUTE = '/start' as const;
export const FIRST_RUN_ACTIVATION_MODE = 'synthetic-session-preview' as const;
export const FIRST_RUN_ACTIVATION_STEPS = Object.freeze([
  'interests',
  'trust',
  'delivery',
  'preview',
] as const);

export type FirstRunActivationStep = (typeof FIRST_RUN_ACTIVATION_STEPS)[number];
export type FirstRunTrustPreset = 'strict' | 'balanced' | 'open';

export interface FirstRunActivationInput {
  readonly step: FirstRunActivationStep;
  readonly preferences: CompanionPreferences;
  readonly trustPreset: FirstRunTrustPreset;
  readonly trustPolicy: TrustPolicy;
  readonly projectedCardCount: number;
}

export interface FirstRunActivationProjection {
  readonly version: typeof FIRST_RUN_ACTIVATION_VERSION;
  readonly route: typeof FIRST_RUN_ACTIVATION_ROUTE;
  readonly mode: typeof FIRST_RUN_ACTIVATION_MODE;
  readonly step: FirstRunActivationStep;
  readonly stepIndex: number;
  readonly completedSteps: number;
  readonly topicCount: number;
  readonly trackedEntityCount: number;
  readonly projectedCardCount: number;
  readonly trustPreset: FirstRunTrustPreset;
  readonly ready: boolean;
  readonly browserStorage: false;
  readonly persistenceEnabled: false;
  readonly automaticExecution: false;
  readonly factualStateMutation: false;
}

export const firstRunActivationContract = Object.freeze({
  version: FIRST_RUN_ACTIVATION_VERSION,
  route: FIRST_RUN_ACTIVATION_ROUTE,
  mode: FIRST_RUN_ACTIVATION_MODE,
  steps: FIRST_RUN_ACTIVATION_STEPS,
  entityCapacity: 'payload-bounded',
  cardBudget: 'user-defined-positive-integer',
  browserStorage: false,
  persistenceEnabled: false,
  automaticExecution: false,
  factualStateMutation: false,
} as const);
