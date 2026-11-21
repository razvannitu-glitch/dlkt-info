import type { DeltaKind, Materiality } from '../core/contracts.js';

export const ACTION_CONTROL_VERSION = 'dlkt-info-action-control-1' as const;
export const ACTION_CONTROL_ROUTE = '/actions' as const;
export const ACTION_CONTROL_MODE = 'synthetic-session-preview' as const;
export const ACTION_CONTROL_MARKER = 'actions-v1' as const;
export const ACTION_CONTROL_QUERY_KEYS = Object.freeze([
  'actions', 'watch', 'remind', 'compare', 'resolved', 'ignore',
] as const);

export type ActionType = 'watch-change' | 'remind-next-briefing' | 'compare-next' | 'mark-resolved' | 'ignore-pattern';
export type ActionStatus = 'active' | 'completed' | 'paused' | 'cancelled';
export type ActionAttentionState = 'active' | 'resolved' | 'ignored' | 'none';

export interface ActionCandidate {
  readonly id: string;
  readonly label: string;
  readonly entityId: string;
  readonly topicId: string;
  readonly kind: DeltaKind;
  readonly materiality: Materiality;
  readonly claimStateHash: string;
}

export interface UserAction {
  readonly id: string;
  readonly candidateId: string;
  readonly type: ActionType;
  readonly status: ActionStatus;
  readonly createdAt: string;
  readonly scheduledFor: string | null;
  readonly reason: string;
}

export interface ActionCandidateProjection {
  readonly candidateId: string;
  readonly label: string;
  readonly activeActions: readonly ActionType[];
  readonly attentionState: ActionAttentionState;
  readonly nextBriefingEffects: readonly string[];
  readonly automaticExecution: false;
  readonly factualStateChanged: false;
}

export interface ActionControlProjection {
  readonly candidates: readonly ActionCandidateProjection[];
  readonly activeActionCount: number;
  readonly watchedCandidateCount: number;
  readonly oneTimeActionCount: number;
  readonly ignoredCandidateCount: number;
}

export type ActionSearchParseResult =
  | Readonly<{ state: 'absent'; actions: readonly UserAction[] }>
  | Readonly<{ state: 'invalid'; actions: readonly UserAction[]; reason: string }>
  | Readonly<{ state: 'valid'; actions: readonly UserAction[] }>;

export const actionControlContract = Object.freeze({
  version: ACTION_CONTROL_VERSION,
  route: ACTION_CONTROL_ROUTE,
  mode: ACTION_CONTROL_MODE,
  marker: ACTION_CONTROL_MARKER,
  maximumCandidates: 12,
  maximumActions: 24,
  browserStorage: false,
  persistenceEnabled: false,
  notificationDeliveryEnabled: false,
  automaticExecution: false,
  factualClaimMutation: false,
  actionLedgerVisible: true,
  undoAvailable: true,
} as const);
