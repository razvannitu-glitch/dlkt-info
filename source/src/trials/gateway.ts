import type { RpcTransport } from '../data/contracts.js';
import { isInstant, isUuid, isWorkerId } from '../data/guards.js';
import type {
  InternalTrialDecision,
  InternalTrialProjection,
  InternalTrialReviewResult,
  InternalTrialSummary,
} from './contracts.js';
import { readInternalDeltaJobs, readInternalReviewQueue, readInternalTrialFailure, readInternalTrialReview, readInternalTrialSummary } from './guards.js';

const ERROR_CODE = /^[A-Z0-9_:-]{3,120}$/u;
const REVIEWER = /^human:[a-zA-Z0-9][a-zA-Z0-9._:-]{2,120}$/u;
const safeText = (value: string, minimum: number, maximum: number): boolean =>
  value.length >= minimum && value.length <= maximum && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);

const cardPayload = (projection: InternalTrialProjection): readonly Readonly<Record<string, unknown>>[] =>
  Object.freeze(projection.cards.map(({ position, card }) => Object.freeze({
    position,
    external_card_id: card.id,
    delta_id: card.deltaId,
    topic_id: card.topicId,
    entity_key: card.entity.id,
    entity_type: card.entity.type,
    entity_label: card.entity.label,
    kind: card.kind,
    title: card.title,
    direct: card.direct,
    why_it_matters: card.whyItMatters,
    changed_since: card.changedSince,
    materiality: card.materiality,
    trust: card.trust,
    score: card.score,
    blocked_dependencies: card.blockedDependencies,
    sources: card.sources,
    created_at: card.createdAt,
    expires_at: card.expiresAt,
  })));

export class DlktInfoInternalTrialGateway {
  readonly #transport: RpcTransport;
  constructor(transport: RpcTransport) { this.#transport = transport; }

  async claimJobs(input: Readonly<{ workerId: string; limit?: number; now: string; leaseSeconds?: number }>) {
    if (!isWorkerId(input.workerId) || !isInstant(input.now)) throw new Error('DLKT_INFO_INTERNAL_TRIAL_CLAIM_INPUT_INVALID');
    const limit = input.limit ?? 10;
    const leaseSeconds = input.leaseSeconds ?? 180;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50
      || !Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) {
      throw new Error('DLKT_INFO_INTERNAL_TRIAL_CLAIM_INPUT_INVALID');
    }
    return readInternalDeltaJobs(await this.#transport.call('dlkt_info_claim_internal_delta_jobs', {
      p_worker_id: input.workerId,
      p_limit: limit,
      p_now: input.now,
      p_lease_seconds: leaseSeconds,
    }));
  }

  async complete(input: Readonly<{
    jobId: string;
    workerId: string;
    projection: InternalTrialProjection;
    packId: string;
    packVersion: string;
    engineVersion: string;
    productVersion: string;
    windowStart: string;
    windowEnd: string;
    now: string;
  }>): Promise<InternalTrialSummary> {
    if (!isUuid(input.jobId) || !isWorkerId(input.workerId) || !isInstant(input.windowStart)
      || !isInstant(input.windowEnd) || !isInstant(input.now) || Date.parse(input.windowStart) >= Date.parse(input.windowEnd)) {
      throw new Error('DLKT_INFO_INTERNAL_TRIAL_COMPLETE_INPUT_INVALID');
    }
    return readInternalTrialSummary(await this.#transport.call('dlkt_info_complete_internal_delta_trial', {
      p_job_id: input.jobId,
      p_worker_id: input.workerId,
      p_pack_id: input.packId,
      p_pack_version: input.packVersion,
      p_engine_version: input.engineVersion,
      p_product_version: input.productVersion,
      p_window_start: input.windowStart,
      p_window_end: input.windowEnd,
      p_payload_hash: input.projection.payloadHash,
      p_cards: cardPayload(input.projection),
      p_card_claims: input.projection.links.map((link) => ({
        external_card_id: link.externalCardId,
        claim_id: link.claimId,
        relationship: link.relationship,
      })),
      p_now: input.now,
    }));
  }

  async fail(input: Readonly<{
    jobId: string;
    workerId: string;
    errorCode: string;
    retryAt: string;
    now: string;
  }>) {
    if (!isUuid(input.jobId) || !isWorkerId(input.workerId) || !ERROR_CODE.test(input.errorCode)
      || !isInstant(input.retryAt) || !isInstant(input.now) || Date.parse(input.retryAt) < Date.parse(input.now)) {
      throw new Error('DLKT_INFO_INTERNAL_TRIAL_FAILURE_INPUT_INVALID');
    }
    return readInternalTrialFailure(await this.#transport.call('dlkt_info_fail_internal_delta_job', {
      p_job_id: input.jobId,
      p_worker_id: input.workerId,
      p_error_code: input.errorCode,
      p_retry_at: input.retryAt,
      p_now: input.now,
    }));
  }

  async readReviewQueue(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('DLKT_INFO_INTERNAL_REVIEW_QUEUE_INPUT_INVALID');
    }
    return readInternalReviewQueue(await this.#transport.call('dlkt_info_read_internal_delta_review_queue', {
      p_limit: limit,
    }));
  }

  async review(input: Readonly<{
    cardId: string;
    decision: InternalTrialDecision;
    reviewer: string;
    note: string;
    now: string;
  }>): Promise<InternalTrialReviewResult> {
    if (!isUuid(input.cardId) || !['approved', 'rejected'].includes(input.decision)
      || !REVIEWER.test(input.reviewer) || !safeText(input.note, 3, 500) || !isInstant(input.now)) {
      throw new Error('DLKT_INFO_INTERNAL_TRIAL_REVIEW_INPUT_INVALID');
    }
    return readInternalTrialReview(await this.#transport.call('dlkt_info_review_internal_delta_card', {
      p_card_id: input.cardId,
      p_decision: input.decision,
      p_reviewer: input.reviewer,
      p_note: input.note,
      p_now: input.now,
    }));
  }
}
