import type { ActionType } from '../actions/contracts.js';

export const ACTION_INBOX_VERSION = 'dlkt-info-action-inbox-1' as const;
export const ACTION_INBOX_ROUTE = '/inbox' as const;
export const ACTION_INBOX_MODE = 'synthetic-session-preview' as const;

export type ActionInboxState =
  | 'due-now'
  | 'scheduled'
  | 'waiting-for-delta'
  | 'attention-resolved'
  | 'muted';

export interface ActionObservation {
  readonly candidateId: string;
  readonly currentClaimStateHash: string;
  readonly observedAt: string;
  readonly materialDelta: boolean;
  readonly conflictActive: boolean;
}

export interface ActionInboxItem {
  readonly actionId: string;
  readonly candidateId: string;
  readonly actionType: ActionType;
  readonly state: ActionInboxState;
  readonly dueAt: string | null;
  readonly reason: string;
  readonly claimStateChanged: boolean;
  readonly materialDelta: boolean;
  readonly conflictActive: boolean;
  readonly automaticExecution: false;
  readonly factualStateChanged: false;
}

export interface ActionInboxProjection {
  readonly version: typeof ACTION_INBOX_VERSION;
  readonly route: typeof ACTION_INBOX_ROUTE;
  readonly generatedAt: string;
  readonly items: readonly ActionInboxItem[];
  readonly totalCount: number;
  readonly dueNowCount: number;
  readonly scheduledCount: number;
  readonly waitingCount: number;
  readonly resolvedCount: number;
  readonly mutedCount: number;
  readonly suppressedMaterialDeltaCount: number;
  readonly nextScheduledAt: string | null;
  readonly automaticExecution: false;
  readonly factualStateChanged: false;
}

export const actionInboxContract = Object.freeze({
  version: ACTION_INBOX_VERSION,
  route: ACTION_INBOX_ROUTE,
  mode: ACTION_INBOX_MODE,
  maximumActions: 24,
  browserStorage: false,
  persistenceEnabled: false,
  automaticExecution: false,
  factualStateMutation: false,
  finite: true,
} as const);
