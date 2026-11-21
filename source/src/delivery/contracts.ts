import type { ActionType } from '../actions/contracts.js';
import type { ActionInboxState } from '../inbox/contracts.js';
import type { CardTrust, Materiality } from '../core/contracts.js';

export const DELIVERY_CONTROL_VERSION = 'dlkt-info-delivery-control-1' as const;
export const DELIVERY_CONTROL_ROUTE = '/delivery' as const;
export const DELIVERY_CONTROL_MODE = 'synthetic-session-preview' as const;
export const DELIVERY_CONTROL_MARKER = 'delivery-v1' as const;
export const DELIVERY_CONTROL_QUERY_KEYS = Object.freeze([
  'delivery', 'dw', 'dr', 'dc', 'dx', 'di', 'qh', 'qs', 'qe', 'cap', 'gap', 'bypass', 'conflict', 'trustFloor', 'materialityFloor', 'channel',
] as const);

export type DeliveryMode = 'alert' | 'briefing' | 'off';
export type DeliveryChannel = 'web' | 'email' | 'push';
export type QuietHoursBypass = 'never' | 'confirmed-official-high';
export type ConflictDeliveryMode = 'briefing' | 'off';
export type DeliveryDisposition =
  | 'notify-now'
  | 'defer-quiet-hours'
  | 'next-briefing'
  | 'scheduled'
  | 'waiting'
  | 'attention-resolved'
  | 'muted'
  | 'rate-limited'
  | 'blocked-conflict'
  | 'suppressed-policy';

export interface DeliveryActionModes {
  readonly 'watch-change': DeliveryMode;
  readonly 'remind-next-briefing': DeliveryMode;
  readonly 'compare-next': DeliveryMode;
  readonly 'mark-resolved': DeliveryMode;
  readonly 'ignore-pattern': DeliveryMode;
}

export interface DeliveryPolicy {
  readonly timezone: string;
  readonly channel: DeliveryChannel;
  readonly actionModes: DeliveryActionModes;
  readonly quietHoursEnabled: boolean;
  readonly quietStart: string;
  readonly quietEnd: string;
  readonly dailyAlertCap: number;
  readonly minimumGapMinutes: number;
  readonly quietHoursBypass: QuietHoursBypass;
  readonly conflictMode: ConflictDeliveryMode;
  readonly minimumAlertTrust: Exclude<CardTrust, 'single-source' | 'conflicting'>;
  readonly minimumAlertMateriality: Exclude<Materiality, 'low'>;
  readonly requireOfficialForHighImpact: true;
}

export interface DeliveryCandidate {
  readonly id: string;
  readonly actionId: string;
  readonly candidateId: string;
  readonly entityId: string;
  readonly topicId: string;
  readonly duplicateKey: string;
  readonly actionType: ActionType;
  readonly inboxState: ActionInboxState;
  readonly materiality: Materiality;
  readonly trust: CardTrust;
  readonly officialEvidence: boolean;
  readonly conflictActive: boolean;
  readonly materialDelta: boolean;
  readonly observedAt: string;
  readonly dueAt: string | null;
}

export interface DeliveryReceipt {
  readonly id: string;
  readonly candidateId: string;
  readonly duplicateKey: string;
  readonly channel: DeliveryChannel;
  readonly deliveredAt: string;
}

export interface DeliveryDecision {
  readonly id: string;
  readonly candidateId: string;
  readonly disposition: DeliveryDisposition;
  readonly channel: DeliveryChannel | null;
  readonly scheduledFor: string | null;
  readonly reason: string;
  readonly explanation: readonly string[];
  readonly quietHoursApplied: boolean;
  readonly antiSpamApplied: boolean;
  readonly automaticExecution: false;
  readonly factualStateChanged: false;
}

export interface DeliveryProjection {
  readonly version: typeof DELIVERY_CONTROL_VERSION;
  readonly route: typeof DELIVERY_CONTROL_ROUTE;
  readonly generatedAt: string;
  readonly policy: DeliveryPolicy;
  readonly decisions: readonly DeliveryDecision[];
  readonly totalCount: number;
  readonly notifyNowCount: number;
  readonly deferredCount: number;
  readonly nextBriefingCount: number;
  readonly waitingCount: number;
  readonly quietCount: number;
  readonly rateLimitedCount: number;
  readonly nextScheduledAt: string | null;
  readonly automaticExecution: false;
  readonly factualStateChanged: false;
}

export type DeliverySearchParseResult = Readonly<{
  state: 'absent' | 'valid' | 'invalid';
  policy: DeliveryPolicy;
  reason?: string;
}>;

export const deliveryControlContract = Object.freeze({
  version: DELIVERY_CONTROL_VERSION,
  route: DELIVERY_CONTROL_ROUTE,
  mode: DELIVERY_CONTROL_MODE,
  marker: DELIVERY_CONTROL_MARKER,
  maximumCandidates: 24,
  maximumRecentReceipts: 100,
  browserStorage: false,
  persistenceEnabled: false,
  emailEnabled: false,
  pushEnabled: false,
  automaticExecution: false,
  factualStateMutation: false,
  quietHoursRequired: true,
  antiSpamRequired: true,
  decisionReasonVisible: true,
  finite: true,
} as const);
