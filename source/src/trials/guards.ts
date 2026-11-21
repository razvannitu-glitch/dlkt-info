import type { AtomicClaim } from '../core/contracts.js';
import { assertAtomicClaim, isInstant, isRecord, isSafeEvidenceUrl, isSafeText } from '../core/guards.js';
import { isUuid } from '../data/guards.js';
import type {
  InternalDeltaJob,
  InternalReviewCandidate,
  InternalTrialFailureResult,
  InternalTrialReviewResult,
  InternalTrialSummary,
} from './contracts.js';

const SOURCE_KEY = /^[a-z0-9][a-z0-9._:-]{0,119}$/u;
const STATUS = new Set(['ready_for_review', 'empty', 'approved', 'rejected', 'expired']);
const REVIEW_STATUS = new Set(['ready_for_review', 'approved', 'rejected']);
const integer = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

const exact = (row: Record<string, unknown>, keys: readonly string[]): boolean =>
  JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...keys].sort());

const readClaims = (value: unknown): readonly AtomicClaim[] => {
  if (!Array.isArray(value) || value.length > 200) throw new Error('DLKT_INFO_INTERNAL_DELTA_CLAIMS_INVALID');
  const claims: AtomicClaim[] = [];
  for (const candidate of value) {
    try { assertAtomicClaim(candidate as AtomicClaim); } catch { throw new Error('DLKT_INFO_INTERNAL_DELTA_CLAIMS_INVALID'); }
    claims.push(structuredClone(candidate as AtomicClaim));
  }
  return Object.freeze(claims);
};

export function readInternalDeltaJobs(value: unknown): readonly InternalDeltaJob[] {
  if (!Array.isArray(value) || value.length > 50 || value.some((row) => !isRecord(row))) {
    throw new Error('DLKT_INFO_INTERNAL_DELTA_JOBS_INVALID');
  }
  const keys = ['attempt_no', 'current_claims', 'job_id', 'lease_expires_at', 'observed_at', 'previous_claims',
    'source_batch_id', 'source_key', 'window_end', 'window_start'];
  return Object.freeze(value.map((raw) => {
    const row = raw as Record<string, unknown>;
    if (!exact(row, keys) || !isUuid(row.job_id) || !isUuid(row.source_batch_id)
      || typeof row.source_key !== 'string' || !SOURCE_KEY.test(row.source_key)
      || !isInstant(row.observed_at) || !isInstant(row.window_start) || !isInstant(row.window_end)
      || !isInstant(row.lease_expires_at) || !integer(row.attempt_no, 1, 5)
      || Date.parse(row.window_start as string) >= Date.parse(row.window_end as string)) {
      throw new Error('DLKT_INFO_INTERNAL_DELTA_JOBS_INVALID');
    }
    return Object.freeze({
      jobId: row.job_id as string,
      sourceBatchId: row.source_batch_id as string,
      sourceKey: row.source_key,
      observedAt: row.observed_at as string,
      windowStart: row.window_start as string,
      windowEnd: row.window_end as string,
      currentClaims: readClaims(row.current_claims),
      previousClaims: readClaims(row.previous_claims),
      attemptNo: row.attempt_no,
      leaseExpiresAt: row.lease_expires_at as string,
    });
  }));
}

export function readInternalTrialSummary(value: unknown): InternalTrialSummary {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error('DLKT_INFO_INTERNAL_TRIAL_SUMMARY_INVALID');
  }
  const row = value[0];
  const keys = ['approved_count', 'card_count', 'pending_count', 'public_cards_created', 'rejected_count', 'status', 'trial_id'];
  if (!exact(row, keys) || !isUuid(row.trial_id) || typeof row.status !== 'string' || !STATUS.has(row.status)
    || !integer(row.card_count, 0, 12) || !integer(row.pending_count, 0, 12)
    || !integer(row.approved_count, 0, 12) || !integer(row.rejected_count, 0, 12)
    || row.pending_count + row.approved_count + row.rejected_count !== row.card_count
    || row.public_cards_created !== false) throw new Error('DLKT_INFO_INTERNAL_TRIAL_SUMMARY_INVALID');
  return Object.freeze({
    trialId: row.trial_id,
    status: row.status as InternalTrialSummary['status'],
    cardCount: row.card_count,
    pendingCount: row.pending_count,
    approvedCount: row.approved_count,
    rejectedCount: row.rejected_count,
    publicCardsCreated: false,
  });
}

export function readInternalTrialFailure(value: unknown): InternalTrialFailureResult {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error('DLKT_INFO_INTERNAL_TRIAL_FAILURE_INVALID');
  }
  const row = value[0];
  const keys = ['attempt_count', 'job_id', 'next_attempt_at', 'status', 'terminal'];
  if (!exact(row, keys) || !isUuid(row.job_id) || !['retry', 'dead'].includes(String(row.status))
    || !integer(row.attempt_count, 1, 5) || !isInstant(row.next_attempt_at)
    || typeof row.terminal !== 'boolean' || row.terminal !== (row.status === 'dead')) {
    throw new Error('DLKT_INFO_INTERNAL_TRIAL_FAILURE_INVALID');
  }
  return Object.freeze({
    jobId: row.job_id,
    status: row.status as 'retry' | 'dead',
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at as string,
    terminal: row.terminal,
  });
}

export function readInternalTrialReview(value: unknown): InternalTrialReviewResult {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error('DLKT_INFO_INTERNAL_TRIAL_REVIEW_INVALID');
  }
  const row = value[0];
  const keys = ['approved_count', 'card_id', 'card_review_state', 'pending_count', 'public_cards_created',
    'rejected_count', 'trial_id', 'trial_status'];
  if (!exact(row, keys) || !isUuid(row.trial_id) || !isUuid(row.card_id)
    || typeof row.trial_status !== 'string' || !REVIEW_STATUS.has(row.trial_status)
    || !['approved', 'rejected'].includes(String(row.card_review_state))
    || !integer(row.pending_count, 0, 12) || !integer(row.approved_count, 0, 12)
    || !integer(row.rejected_count, 0, 12) || row.public_cards_created !== false) {
    throw new Error('DLKT_INFO_INTERNAL_TRIAL_REVIEW_INVALID');
  }
  return Object.freeze({
    trialId: row.trial_id,
    trialStatus: row.trial_status as InternalTrialReviewResult['trialStatus'],
    cardId: row.card_id,
    cardReviewState: row.card_review_state as 'approved' | 'rejected',
    pendingCount: row.pending_count,
    approvedCount: row.approved_count,
    rejectedCount: row.rejected_count,
    publicCardsCreated: false,
  });
}

const REVIEW_KIND = new Set(['new', 'changed', 'resolved', 'conflicted']);
const MATERIALITY = new Set(['low', 'medium', 'high', 'critical']);
const TRUST = new Set(['confirmed', 'corroborated', 'single-source', 'conflicting']);
const AUTHORITY = new Set(['official', 'primary', 'reputable-secondary', 'community', 'unknown']);
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$/u;

const readCardSources = (value: unknown): InternalReviewCandidate['sources'] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20 || value.some((entry) => !isRecord(entry))) {
    throw new Error('DLKT_INFO_INTERNAL_REVIEW_QUEUE_INVALID');
  }
  return Object.freeze(value.map((raw) => {
    const source = raw as Record<string, unknown>;
    if (!exact(source, ['authority', 'retrievedAt', 'sourceId', 'title', 'url'])
      || typeof source.sourceId !== 'string' || !SOURCE_KEY.test(source.sourceId)
      || !isSafeText(source.title, 300) || !isSafeEvidenceUrl(source.url)
      || typeof source.authority !== 'string' || !AUTHORITY.has(source.authority)
      || !isInstant(source.retrievedAt)) throw new Error('DLKT_INFO_INTERNAL_REVIEW_QUEUE_INVALID');
    return Object.freeze({
      sourceId: source.sourceId,
      title: source.title,
      url: source.url,
      authority: source.authority as InternalReviewCandidate['sources'][number]['authority'],
      retrievedAt: source.retrievedAt as string,
    });
  }));
};

export function readInternalReviewQueue(value: unknown): readonly InternalReviewCandidate[] {
  if (!Array.isArray(value) || value.length > 50 || value.some((entry) => !isRecord(entry))) {
    throw new Error('DLKT_INFO_INTERNAL_REVIEW_QUEUE_INVALID');
  }
  const keys = ['blocked_dependencies', 'card_id', 'changed_since', 'delta_id', 'direct', 'entity_key',
    'entity_label', 'entity_type', 'expires_at', 'external_card_id', 'generated_at', 'kind', 'materiality',
    'card_position', 'score', 'source_key', 'sources', 'title', 'topic_id', 'trial_id', 'trust', 'why_it_matters'];
  return Object.freeze(value.map((raw) => {
    const row = raw as Record<string, unknown>;
    if (!exact(row, keys) || !isUuid(row.card_id) || !isUuid(row.trial_id)
      || typeof row.source_key !== 'string' || !SOURCE_KEY.test(row.source_key)
      || !isInstant(row.generated_at) || !integer(row.card_position, 1, 12)
      || typeof row.external_card_id !== 'string' || !IDENTIFIER.test(row.external_card_id)
      || typeof row.delta_id !== 'string' || !IDENTIFIER.test(row.delta_id)
      || typeof row.topic_id !== 'string' || !IDENTIFIER.test(row.topic_id)
      || typeof row.entity_key !== 'string' || !IDENTIFIER.test(row.entity_key)
      || typeof row.entity_type !== 'string' || !/^[a-z][a-z0-9-]{0,59}$/u.test(row.entity_type)
      || !isSafeText(row.entity_label, 200) || typeof row.kind !== 'string' || !REVIEW_KIND.has(row.kind)
      || !isSafeText(row.title, 300) || !isSafeText(row.direct, 1000)
      || !isSafeText(row.why_it_matters, 1000) || !isSafeText(row.changed_since, 500)
      || typeof row.materiality !== 'string' || !MATERIALITY.has(row.materiality)
      || typeof row.trust !== 'string' || !TRUST.has(row.trust)
      || !integer(row.score, -100000, 100000)
      || !Array.isArray(row.blocked_dependencies) || row.blocked_dependencies.length > 100
      || row.blocked_dependencies.some((item) => typeof item !== 'string' || !IDENTIFIER.test(item))
      || !(row.expires_at === null || isInstant(row.expires_at))) {
      throw new Error('DLKT_INFO_INTERNAL_REVIEW_QUEUE_INVALID');
    }
    return Object.freeze({
      cardId: row.card_id,
      trialId: row.trial_id,
      sourceKey: row.source_key,
      generatedAt: row.generated_at as string,
      position: row.card_position,
      externalCardId: row.external_card_id,
      deltaId: row.delta_id,
      topicId: row.topic_id,
      entity: Object.freeze({ id: row.entity_key, type: row.entity_type, label: row.entity_label }),
      kind: row.kind as InternalReviewCandidate['kind'],
      title: row.title,
      direct: row.direct,
      whyItMatters: row.why_it_matters,
      changedSince: row.changed_since,
      materiality: row.materiality as InternalReviewCandidate['materiality'],
      trust: row.trust as InternalReviewCandidate['trust'],
      score: row.score,
      blockedDependencies: Object.freeze([...row.blocked_dependencies]),
      sources: readCardSources(row.sources),
      expiresAt: row.expires_at as string | null,
    });
  }));
}
