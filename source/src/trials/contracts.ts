import type { AtomicClaim, Briefing, CardSource, CardTrust, DeltaKind, InfoCard, Materiality } from '../core/contracts.js';

export const INTERNAL_DELTA_TRIAL_VERSION = 'dlkt-info-internal-delta-trial-1' as const;
export const INTERNAL_DELTA_TRIAL_MIGRATION = '20261112003000_dlkt_info_internal_real_delta_trial' as const;
export const INTERNAL_DELTA_TRIAL_WORKER_ID = 'worker:internal-delta:scheduled' as const;
export const INTERNAL_DELTA_TRIAL_ENVIRONMENT_KEYS = Object.freeze([
  'DLKT_INFO_INTERNAL_TRIAL_ENABLED',
  'DLKT_INFO_INTERNAL_REVIEW_ENABLED',
  'DLKT_INFO_INTERNAL_REVIEW_SECRET',
  'DLKT_INFO_INTERNAL_REVIEWER_ID',
] as const);

export type InternalTrialRelationship = 'supports' | 'contradicts' | 'supersedes';
export type InternalTrialDecision = 'approved' | 'rejected';

export interface InternalDeltaJob {
  readonly jobId: string;
  readonly sourceBatchId: string;
  readonly sourceKey: string;
  readonly observedAt: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly currentClaims: readonly AtomicClaim[];
  readonly previousClaims: readonly AtomicClaim[];
  readonly attemptNo: number;
  readonly leaseExpiresAt: string;
}

export interface InternalTrialCardLink {
  readonly externalCardId: string;
  readonly claimId: string;
  readonly relationship: InternalTrialRelationship;
}

export interface InternalTrialCardProjection {
  readonly position: number;
  readonly card: InfoCard;
}

export interface InternalTrialProjection {
  readonly version: typeof INTERNAL_DELTA_TRIAL_VERSION;
  readonly briefing: Briefing;
  readonly cards: readonly InternalTrialCardProjection[];
  readonly links: readonly InternalTrialCardLink[];
  readonly payloadHash: string;
}

export interface InternalTrialSummary {
  readonly trialId: string;
  readonly status: 'ready_for_review' | 'empty' | 'approved' | 'rejected' | 'expired';
  readonly cardCount: number;
  readonly pendingCount: number;
  readonly approvedCount: number;
  readonly rejectedCount: number;
  readonly publicCardsCreated: false;
}

export interface InternalTrialFailureResult {
  readonly jobId: string;
  readonly status: 'retry' | 'dead';
  readonly attemptCount: number;
  readonly nextAttemptAt: string;
  readonly terminal: boolean;
}

export interface InternalTrialReviewResult {
  readonly trialId: string;
  readonly trialStatus: 'ready_for_review' | 'approved' | 'rejected';
  readonly cardId: string;
  readonly cardReviewState: InternalTrialDecision;
  readonly pendingCount: number;
  readonly approvedCount: number;
  readonly rejectedCount: number;
  readonly publicCardsCreated: false;
}

export type InternalTrialConfiguration =
  | Readonly<{ state: 'missing' | 'invalid' | 'disabled'; code: string }>
  | Readonly<{
      state: 'ready';
      trialEnabled: true;
      reviewEnabled: boolean;
      reviewSecret: string | null;
      reviewerId: string | null;
    }>;

export interface InternalReviewCandidate {
  readonly cardId: string;
  readonly trialId: string;
  readonly sourceKey: string;
  readonly generatedAt: string;
  readonly position: number;
  readonly externalCardId: string;
  readonly deltaId: string;
  readonly topicId: string;
  readonly entity: Readonly<{ id: string; type: string; label: string }>;
  readonly kind: DeltaKind;
  readonly title: string;
  readonly direct: string;
  readonly whyItMatters: string;
  readonly changedSince: string;
  readonly materiality: Materiality;
  readonly trust: CardTrust;
  readonly score: number;
  readonly blockedDependencies: readonly string[];
  readonly sources: readonly CardSource[];
  readonly expiresAt: string | null;
}
