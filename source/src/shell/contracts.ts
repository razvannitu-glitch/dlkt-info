export const UNIFIED_SHELL_VERSION = 'dlkt-info-unified-shell-1' as const;
export const UNIFIED_SHELL_ROUTE = '/companion-preview' as const;
export const UNIFIED_SHELL_MODE = 'synthetic-session-preview' as const;

export type UnifiedShellStage = 'briefing' | 'trust' | 'memory' | 'actions' | 'inbox' | 'delivery';
export type UnifiedShellStepState = 'ready' | 'attention' | 'waiting' | 'empty';

export interface UnifiedShellInput {
  readonly selectedStage: UnifiedShellStage;
  readonly currentCardId: string | null;
  readonly briefingCardCount: number;
  readonly trackedEntityCount: number;
  readonly trustIncludedCount: number;
  readonly trustExcludedCount: number;
  readonly memorySignalCount: number;
  readonly activeActionCount: number;
  readonly dueNowCount: number;
  readonly waitingCount: number;
  readonly notifyNowCount: number;
  readonly deferredCount: number;
  readonly nextBriefingCount: number;
}

export interface UnifiedShellStep {
  readonly id: UnifiedShellStage;
  readonly label: string;
  readonly state: UnifiedShellStepState;
  readonly count: number;
  readonly explanation: string;
}

export interface UnifiedShellProjection {
  readonly version: typeof UNIFIED_SHELL_VERSION;
  readonly route: typeof UNIFIED_SHELL_ROUTE;
  readonly selectedStage: UnifiedShellStage;
  readonly currentCardId: string | null;
  readonly steps: readonly UnifiedShellStep[];
  readonly readyCount: number;
  readonly attentionCount: number;
  readonly finiteCardCount: number;
  readonly trackedEntityCount: number;
  readonly activeActionCount: number;
  readonly immediateAttentionCount: number;
  readonly nextBriefingCount: number;
  readonly browserStorage: false;
  readonly persistenceEnabled: false;
  readonly automaticExecution: false;
  readonly factualStateMutation: false;
  readonly finite: true;
}

export const unifiedShellContract = Object.freeze({
  version: UNIFIED_SHELL_VERSION,
  route: UNIFIED_SHELL_ROUTE,
  mode: UNIFIED_SHELL_MODE,
  stages: Object.freeze(['briefing', 'trust', 'memory', 'actions', 'inbox', 'delivery'] as const),
  cardBudget: 'user-defined-positive-integer',
  entityCapacity: 'payload-bounded',
  browserStorage: false,
  persistenceEnabled: false,
  automaticExecution: false,
  factualStateMutation: false,
  unifiedUrlState: true,
  finite: true,
} as const);
