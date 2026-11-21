import { claimFingerprint } from '../core/claims.js';
import { assertAtomicClaim } from '../core/guards.js';
import type {
  CommitModifiedSourceAcquisitionInput,
  CommittedSourceAcquisition,
  RpcTransport,
  SourceClaimIngestion,
} from './contracts.js';
import { isInstant, isSha256, isUuid, isWorkerId } from './guards.js';
import { readSourceAcquisitionState } from './source-acquisition-gateway.js';

const SOURCE_KEY = /^[a-z0-9][a-z0-9._:-]{0,119}$/u;
const EXTERNAL_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,159}$/u;
const CHANGE_KINDS = new Set(['baseline', 'new', 'changed']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
const nullableText = (value: unknown, maximum = 512): value is string | null =>
  value === null || (typeof value === 'string' && value.length >= 1 && value.length <= maximum
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value));

const projectedClaim = (record: SourceClaimIngestion): Readonly<Record<string, unknown>> => {
  if (!EXTERNAL_KEY.test(record.externalKey)
    || !(record.supersedesExternalKey === null || EXTERNAL_KEY.test(record.supersedesExternalKey))
    || !CHANGE_KINDS.has(record.changeKind)) throw new Error('DLKT_INFO_SOURCE_CLAIM_INPUT_INVALID');
  try { assertAtomicClaim(record.claim); } catch { throw new Error('DLKT_INFO_SOURCE_CLAIM_INPUT_INVALID'); }
  return Object.freeze({
    external_key: record.externalKey,
    supersedes_external_key: record.supersedesExternalKey,
    change_kind: record.changeKind,
    entity_key: record.claim.entity.id,
    entity_type: record.claim.entity.type,
    entity_label: record.claim.entity.label,
    topic_id: record.claim.topicId,
    kind: record.claim.kind,
    predicate: record.claim.predicate,
    value: record.claim.value,
    materiality: record.claim.materiality,
    actionability: record.claim.actionability,
    observed_at: record.claim.observedAt,
    effective_at: record.claim.effectiveAt,
    valid_from: record.claim.validFrom,
    valid_until: record.claim.validUntil,
    locale: record.claim.locale,
    geography: record.claim.geography,
    affects: record.claim.affects,
    fingerprint: claimFingerprint(record.claim),
    evidence: record.claim.evidence.map((evidence) => Object.freeze({
      source_id: evidence.sourceId,
      url: evidence.url,
      title: evidence.title,
      retrieved_at: evidence.retrievedAt,
      published_at: evidence.publishedAt,
      content_hash: evidence.contentHash,
    })),
  });
};

export function readCommittedSourceAcquisition(value: unknown): CommittedSourceAcquisition {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error('DLKT_INFO_SOURCE_COMMIT_RESPONSE_INVALID');
  }
  const row = value[0];
  const stateKeys = ['source_key', 'checkpoint_version', 'checkpoint', 'body_hash', 'etag', 'last_modified',
    'last_attempt_at', 'last_success_at', 'next_eligible_at', 'attempts_today', 'total_attempts',
    'consecutive_failures', 'last_error_code'] as const;
  const expected = [...stateKeys, 'batch_id', 'claim_count', 'inserted_claims', 'existing_claims'].sort();
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(expected)
    || !isUuid(row.batch_id) || !integer(row.claim_count, 0, 200)
    || !integer(row.inserted_claims, 0, 200) || !integer(row.existing_claims, 0, 200)
    || row.inserted_claims + row.existing_claims !== row.claim_count) {
    throw new Error('DLKT_INFO_SOURCE_COMMIT_RESPONSE_INVALID');
  }
  const stateRow = Object.fromEntries(stateKeys.map((key) => [key, row[key]]));
  const state = readSourceAcquisitionState([stateRow]);
  if (!state) throw new Error('DLKT_INFO_SOURCE_COMMIT_RESPONSE_INVALID');
  return Object.freeze({
    ...state,
    batchId: row.batch_id,
    claimCount: row.claim_count,
    insertedClaims: row.inserted_claims,
    existingClaims: row.existing_claims,
  });
}

export class DlktInfoSourceClaimGateway {
  readonly #transport: RpcTransport;

  constructor(transport: RpcTransport) { this.#transport = transport; }

  async commitModified(input: CommitModifiedSourceAcquisitionInput): Promise<CommittedSourceAcquisition> {
    if (!SOURCE_KEY.test(input.sourceKey) || !isUuid(input.attemptId) || !isWorkerId(input.workerId)
      || !integer(input.checkpointVersion, 1, 1_000_000) || !isRecord(input.checkpoint)
      || !isSha256(input.bodyHash) || !nullableText(input.etag) || !nullableText(input.lastModified)
      || typeof input.baseline !== 'boolean' || !Array.isArray(input.claims) || input.claims.length > 200
      || !isInstant(input.now)) throw new Error('DLKT_INFO_SOURCE_COMMIT_INPUT_INVALID');
    if (input.baseline !== (input.checkpointVersion === 1)) throw new Error('DLKT_INFO_SOURCE_COMMIT_BASELINE_INVALID');
    const claims = input.claims.map(projectedClaim);
    if (input.baseline && (claims.length === 0 || claims.some((claim) => claim.change_kind !== 'baseline'))) {
      throw new Error('DLKT_INFO_SOURCE_COMMIT_BASELINE_INVALID');
    }
    if (!input.baseline && claims.some((claim) => claim.change_kind === 'baseline')) {
      throw new Error('DLKT_INFO_SOURCE_COMMIT_CHANGE_KIND_INVALID');
    }
    return readCommittedSourceAcquisition(await this.#transport.call('dlkt_info_commit_source_acquisition', {
      p_source_key: input.sourceKey,
      p_attempt_id: input.attemptId,
      p_worker_id: input.workerId,
      p_checkpoint_version: input.checkpointVersion,
      p_checkpoint: input.checkpoint,
      p_body_hash: input.bodyHash,
      p_etag: input.etag,
      p_last_modified: input.lastModified,
      p_baseline: input.baseline,
      p_claims: claims,
      p_now: input.now,
    }));
  }
}
