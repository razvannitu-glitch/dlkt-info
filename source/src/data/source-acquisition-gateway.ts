import type {
  CompleteSourceAcquisitionInput,
  RpcTransport,
  SourceAcquisitionReservation,
  SourceAcquisitionState,
} from './contracts.js';
import { isInstant, isSha256, isUuid, isWorkerId } from './guards.js';

const SOURCE_KEY = /^[a-z0-9][a-z0-9._:-]{0,119}$/u;
const ERROR_CODE = /^[A-Z0-9_:-]{3,120}$/u;
const BLOCK_REASONS = new Set(['source-unavailable', 'registry-expired', 'leased', 'interval', 'daily-limit']);
const OUTCOMES = new Set(['modified', 'not_modified', 'failed']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
const nullableText = (value: unknown, maximum = 512): value is string | null =>
  value === null || (typeof value === 'string' && value.length >= 1 && value.length <= maximum
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value));
const nullableInstant = (value: unknown): value is string | null => value === null || isInstant(value);
const nullableCheckpoint = (value: unknown): value is Readonly<Record<string, unknown>> | null =>
  value === null || isRecord(value);

const oneRow = (value: unknown): Record<string, unknown> => {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error('DLKT_INFO_ACQUISITION_RESPONSE_INVALID');
  }
  return value[0];
};

export function readSourceAcquisitionReservation(value: unknown): SourceAcquisitionReservation {
  const row = oneRow(value);
  const keys = Object.keys(row).sort();
  const expected = ['allowed', 'attempt_id', 'attempt_no', 'body_hash', 'checkpoint', 'checkpoint_version',
    'etag', 'last_modified', 'lease_expires_at', 'reason', 'source_key'].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)
    || typeof row.allowed !== 'boolean' || typeof row.reason !== 'string'
    || typeof row.source_key !== 'string' || !SOURCE_KEY.test(row.source_key)
    || !integer(row.attempt_no, 0, Number.MAX_SAFE_INTEGER)
    || !integer(row.checkpoint_version, 0, 1_000_000)
    || !nullableCheckpoint(row.checkpoint)
    || !(row.body_hash === null || isSha256(row.body_hash))
    || !nullableText(row.etag) || !nullableText(row.last_modified)
    || !nullableInstant(row.lease_expires_at)) throw new Error('DLKT_INFO_ACQUISITION_RESPONSE_INVALID');
  if (row.allowed) {
    if (row.reason !== 'reserved' || !isUuid(row.attempt_id) || row.lease_expires_at === null) {
      throw new Error('DLKT_INFO_ACQUISITION_RESPONSE_INVALID');
    }
  } else if (!BLOCK_REASONS.has(row.reason) || row.attempt_id !== null) {
    throw new Error('DLKT_INFO_ACQUISITION_RESPONSE_INVALID');
  }
  if ((row.checkpoint_version === 0) !== (row.checkpoint === null && row.body_hash === null)) {
    throw new Error('DLKT_INFO_ACQUISITION_RESPONSE_INVALID');
  }
  return Object.freeze({
    allowed: row.allowed,
    reason: row.reason as SourceAcquisitionReservation['reason'],
    attemptId: row.attempt_id as string | null,
    sourceKey: row.source_key,
    attemptNo: row.attempt_no,
    checkpointVersion: row.checkpoint_version,
    checkpoint: row.checkpoint,
    bodyHash: row.body_hash as string | null,
    etag: row.etag as string | null,
    lastModified: row.last_modified as string | null,
    leaseExpiresAt: row.lease_expires_at as string | null,
  });
}

export function readSourceAcquisitionState(value: unknown): SourceAcquisitionState | null {
  if (!Array.isArray(value) || value.length > 1 || value.some((entry) => !isRecord(entry))) {
    throw new Error('DLKT_INFO_ACQUISITION_STATE_INVALID');
  }
  if (value.length === 0) return null;
  const row = value[0] as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  const expected = ['attempts_today', 'body_hash', 'checkpoint', 'checkpoint_version', 'consecutive_failures',
    'etag', 'last_attempt_at', 'last_error_code', 'last_modified', 'last_success_at', 'next_eligible_at',
    'source_key', 'total_attempts'].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)
    || typeof row.source_key !== 'string' || !SOURCE_KEY.test(row.source_key)
    || !integer(row.checkpoint_version, 0, 1_000_000) || !nullableCheckpoint(row.checkpoint)
    || !(row.body_hash === null || isSha256(row.body_hash)) || !nullableText(row.etag)
    || !nullableText(row.last_modified) || !nullableInstant(row.last_attempt_at)
    || !nullableInstant(row.last_success_at) || !nullableInstant(row.next_eligible_at)
    || !integer(row.attempts_today, 0, 10_000) || !integer(row.total_attempts, 0, Number.MAX_SAFE_INTEGER)
    || !integer(row.consecutive_failures, 0, 1_000_000)
    || !(row.last_error_code === null || (typeof row.last_error_code === 'string' && ERROR_CODE.test(row.last_error_code)))) {
    throw new Error('DLKT_INFO_ACQUISITION_STATE_INVALID');
  }
  if ((row.checkpoint_version === 0) !== (row.checkpoint === null && row.body_hash === null)) {
    throw new Error('DLKT_INFO_ACQUISITION_STATE_INVALID');
  }
  return Object.freeze({
    sourceKey: row.source_key,
    checkpointVersion: row.checkpoint_version,
    checkpoint: row.checkpoint,
    bodyHash: row.body_hash as string | null,
    etag: row.etag as string | null,
    lastModified: row.last_modified as string | null,
    lastAttemptAt: row.last_attempt_at as string | null,
    lastSuccessAt: row.last_success_at as string | null,
    nextEligibleAt: row.next_eligible_at as string | null,
    attemptsToday: row.attempts_today,
    totalAttempts: row.total_attempts,
    consecutiveFailures: row.consecutive_failures,
    lastErrorCode: row.last_error_code as string | null,
  });
}

export class DlktInfoSourceAcquisitionGateway {
  readonly #transport: RpcTransport;

  constructor(transport: RpcTransport) { this.#transport = transport; }

  async reserve(input: Readonly<{ sourceKey: string; workerId: string; now: string; leaseSeconds?: number }>): Promise<SourceAcquisitionReservation> {
    if (!SOURCE_KEY.test(input.sourceKey) || !isWorkerId(input.workerId) || !isInstant(input.now)
      || !integer(input.leaseSeconds ?? 120, 30, 900)) throw new Error('DLKT_INFO_ACQUISITION_RESERVE_INPUT_INVALID');
    return readSourceAcquisitionReservation(await this.#transport.call('dlkt_info_reserve_source_acquisition', {
      p_source_key: input.sourceKey,
      p_worker_id: input.workerId,
      p_now: input.now,
      p_lease_seconds: input.leaseSeconds ?? 120,
    }));
  }

  async complete(input: CompleteSourceAcquisitionInput): Promise<SourceAcquisitionState> {
    if (!SOURCE_KEY.test(input.sourceKey) || !isUuid(input.attemptId) || !isWorkerId(input.workerId)
      || !OUTCOMES.has(input.outcome) || !isInstant(input.now)
      || !(input.checkpointVersion === null || integer(input.checkpointVersion, 1, 1_000_000))
      || !nullableCheckpoint(input.checkpoint) || !(input.bodyHash === null || isSha256(input.bodyHash))
      || !nullableText(input.etag) || !nullableText(input.lastModified)
      || !(input.errorCode === null || ERROR_CODE.test(input.errorCode))) {
      throw new Error('DLKT_INFO_ACQUISITION_COMPLETE_INPUT_INVALID');
    }
    if (input.outcome === 'modified' && (input.checkpointVersion === null || input.checkpoint === null
      || input.bodyHash === null || input.errorCode !== null)) throw new Error('DLKT_INFO_ACQUISITION_COMPLETE_INPUT_INVALID');
    if (input.outcome === 'not_modified' && (input.checkpointVersion !== null || input.checkpoint !== null
      || input.bodyHash !== null || input.errorCode !== null)) throw new Error('DLKT_INFO_ACQUISITION_COMPLETE_INPUT_INVALID');
    if (input.outcome === 'failed' && (input.errorCode === null || input.checkpointVersion !== null
      || input.checkpoint !== null || input.bodyHash !== null)) throw new Error('DLKT_INFO_ACQUISITION_COMPLETE_INPUT_INVALID');
    const state = readSourceAcquisitionState(await this.#transport.call('dlkt_info_complete_source_acquisition', {
      p_source_key: input.sourceKey,
      p_attempt_id: input.attemptId,
      p_worker_id: input.workerId,
      p_outcome: input.outcome,
      p_checkpoint_version: input.checkpointVersion,
      p_checkpoint: input.checkpoint,
      p_body_hash: input.bodyHash,
      p_etag: input.etag,
      p_last_modified: input.lastModified,
      p_error_code: input.errorCode,
      p_now: input.now,
    }));
    if (!state) throw new Error('DLKT_INFO_ACQUISITION_STATE_INVALID');
    return state;
  }

  async read(sourceKey: string): Promise<SourceAcquisitionState | null> {
    if (!SOURCE_KEY.test(sourceKey)) throw new Error('DLKT_INFO_ACQUISITION_READ_INPUT_INVALID');
    return readSourceAcquisitionState(await this.#transport.call('dlkt_info_read_source_acquisition', { p_source_key: sourceKey }));
  }
}
