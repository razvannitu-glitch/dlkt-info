import type { ExplainableMemorySignal } from '../history/contracts.js';

export const MEMORY_CONTROL_VERSION = 'dlkt-info-memory-control-1' as const;
export const MEMORY_CONTROL_ROUTE = '/memory' as const;
export const MEMORY_CONTROL_MODE = 'synthetic-session-preview' as const;

export interface MemoryControlCandidate {
  readonly id: string;
  readonly label: string;
  readonly topicId: string;
  readonly entityId: string;
  readonly kind: string;
  readonly baseScore: number;
  readonly baselineRank: number;
}

export interface MemoryControlProjection {
  readonly id: string;
  readonly label: string;
  readonly baseScore: number;
  readonly memoryScore: number;
  readonly totalScore: number;
  readonly baselineRank: number;
  readonly projectedRank: number;
  readonly rankDelta: number;
  readonly appliedSignals: readonly ExplainableMemorySignal[];
}

export const memoryControlContract = Object.freeze({
  version: MEMORY_CONTROL_VERSION,
  route: MEMORY_CONTROL_ROUTE,
  mode: MEMORY_CONTROL_MODE,
  maximumSignals: 24,
  maximumCandidates: 12,
  minimumWeight: -50,
  maximumWeight: 50,
  browserStorage: false,
  persistenceEnabled: false,
  hiddenSignalsAllowed: false,
  undoAvailable: true,
  automaticProfileMutation: false,
});
