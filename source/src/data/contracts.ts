import type { AtomicClaim, Briefing } from '../core/contracts.js';

export const DATA_FOUNDATION_VERSION = 'dlkt-info-data-1' as const;
export const DATA_FOUNDATION_MIGRATION = '20261111184500_dlkt_info_data_delivery_foundation' as const;

export type Uuid = string;
export type ProfilePlan = 'free' | 'pro' | 'business' | 'internal';
export type ProfileOnboardingState = 'new' | 'configured' | 'active' | 'paused';
export type BriefingState = 'draft' | 'active' | 'paused' | 'archived';
export type RunState = 'queued' | 'claimed' | 'generating' | 'ready' | 'empty' | 'failed' | 'cancelled';
export type DeliveryChannel = 'web' | 'email' | 'push';
export type DeliveryEndpointState = 'pending' | 'verified' | 'disabled' | 'revoked';
export type DeliveryJobState = 'pending' | 'claimed' | 'retry' | 'delivered' | 'dead' | 'cancelled';
export type DeliveryReceiptState = 'delivered' | 'failed' | 'dead';

export interface ProfileRecord {
  readonly id: Uuid;
  readonly displayName: string | null;
  readonly locale: string;
  readonly timezone: string;
  readonly plan: ProfilePlan;
  readonly onboardingState: ProfileOnboardingState;
  readonly dataRegion: 'eu-central-1';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BriefingRecord {
  readonly id: Uuid;
  readonly ownerId: Uuid;
  readonly name: string;
  readonly timezone: string;
  readonly deliveryLocalTime: string;
  readonly weekdays: readonly number[];
  readonly maxCards: number;
  readonly status: BriefingState;
  readonly version: number;
  readonly nextDeliveryAt: string | null;
  readonly lastScheduledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InterestRuleRecord {
  readonly id: Uuid;
  readonly briefingId: Uuid;
  readonly name: string;
  readonly includeTopics: readonly string[];
  readonly excludeTopics: readonly string[];
  readonly includeEntities: readonly string[];
  readonly excludeEntities: readonly string[];
  readonly includeGeographies: readonly string[];
  readonly languages: readonly string[];
  readonly minMateriality: 'low' | 'medium' | 'high' | 'critical';
  readonly weight: number;
  readonly onlyActionable: boolean;
  readonly isEnabled: boolean;
  readonly position: number;
}

export interface DeliveryEndpointRecord {
  readonly id: Uuid;
  readonly ownerId: Uuid;
  readonly channel: Exclude<DeliveryChannel, 'web'>;
  readonly label: string;
  readonly destinationHash: string;
  readonly state: DeliveryEndpointState;
  readonly verifiedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BriefingRunRecord {
  readonly id: Uuid;
  readonly briefingId: Uuid;
  readonly ownerId: Uuid;
  readonly scheduledFor: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly generatedAt: string | null;
  readonly status: RunState;
  readonly attemptCount: number;
  readonly engineVersion: string | null;
  readonly productVersion: string | null;
  readonly payloadHash: string | null;
  readonly cardCount: number;
  readonly contestedCount: number;
  readonly omittedCount: number;
  readonly errorCode: string | null;
}

export interface ClaimedRun {
  readonly runId: Uuid;
  readonly briefingId: Uuid;
  readonly ownerId: Uuid;
  readonly scheduledFor: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly attemptNo: number;
  readonly maxCards: number;
}

export interface FinalizedRun {
  readonly runId: Uuid;
  readonly status: 'ready' | 'empty';
  readonly cardCount: number;
  readonly contestedCount: number;
  readonly omittedCount: number;
  readonly outboxCount: number;
}

export interface ClaimedDeliveryJob {
  readonly jobId: Uuid;
  readonly runId: Uuid;
  readonly ownerId: Uuid;
  readonly channel: Exclude<DeliveryChannel, 'web'>;
  readonly endpointId: Uuid;
  readonly secretRef: string;
  readonly destinationHash: string;
  readonly attemptNo: number;
  readonly payloadHash: string;
}

export interface DeliveryAttemptResult {
  readonly jobId: Uuid;
  readonly status: DeliveryJobState;
  readonly attemptNo: number;
  readonly terminal: boolean;
}

export interface LeaseRecoveryResult {
  readonly recoveredRuns: number;
  readonly failedRuns: number;
  readonly retriedDeliveries: number;
  readonly deadDeliveries: number;
}

export interface FinalizeRunInput {
  readonly runId: Uuid;
  readonly workerId: string;
  readonly briefing: Briefing;
  readonly engineVersion: string;
  readonly productVersion: string;
  readonly payloadHash: string;
  readonly now: string;
}

export interface RecordDeliveryAttemptInput {
  readonly jobId: Uuid;
  readonly workerId: string;
  readonly succeeded: boolean;
  readonly providerMessageId: string | null;
  readonly errorCode: string | null;
  readonly retryAt: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly now: string;
}

export interface RpcTransport {
  call(functionName: string, parameters: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export type SourceAcquisitionBlockReason = 'source-unavailable' | 'registry-expired' | 'leased' | 'interval' | 'daily-limit';
export type SourceAcquisitionOutcome = 'modified' | 'not_modified' | 'failed';

export interface SourceAcquisitionReservation {
  readonly allowed: boolean;
  readonly reason: 'reserved' | SourceAcquisitionBlockReason;
  readonly attemptId: Uuid | null;
  readonly sourceKey: string;
  readonly attemptNo: number;
  readonly checkpointVersion: number;
  readonly checkpoint: Readonly<Record<string, unknown>> | null;
  readonly bodyHash: string | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly leaseExpiresAt: string | null;
}

export interface SourceAcquisitionState {
  readonly sourceKey: string;
  readonly checkpointVersion: number;
  readonly checkpoint: Readonly<Record<string, unknown>> | null;
  readonly bodyHash: string | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly nextEligibleAt: string | null;
  readonly attemptsToday: number;
  readonly totalAttempts: number;
  readonly consecutiveFailures: number;
  readonly lastErrorCode: string | null;
}

export interface CompleteSourceAcquisitionInput {
  readonly sourceKey: string;
  readonly attemptId: Uuid;
  readonly workerId: string;
  readonly outcome: SourceAcquisitionOutcome;
  readonly checkpointVersion: number | null;
  readonly checkpoint: Readonly<Record<string, unknown>> | null;
  readonly bodyHash: string | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly errorCode: string | null;
  readonly now: string;
}

export type SourceClaimChangeKind = 'baseline' | 'new' | 'changed';

export interface SourceClaimIngestion {
  readonly externalKey: string;
  readonly supersedesExternalKey: string | null;
  readonly changeKind: SourceClaimChangeKind;
  readonly claim: AtomicClaim;
}

export interface CommitModifiedSourceAcquisitionInput {
  readonly sourceKey: string;
  readonly attemptId: Uuid;
  readonly workerId: string;
  readonly checkpointVersion: number;
  readonly checkpoint: Readonly<Record<string, unknown>>;
  readonly bodyHash: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly baseline: boolean;
  readonly claims: readonly SourceClaimIngestion[];
  readonly now: string;
}

export interface CommittedSourceAcquisition extends SourceAcquisitionState {
  readonly batchId: Uuid;
  readonly claimCount: number;
  readonly insertedClaims: number;
  readonly existingClaims: number;
}
