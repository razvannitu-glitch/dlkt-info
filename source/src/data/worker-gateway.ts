import type {
  ClaimedDeliveryJob,
  ClaimedRun,
  DeliveryAttemptResult,
  FinalizeRunInput,
  FinalizedRun,
  LeaseRecoveryResult,
  RecordDeliveryAttemptInput,
  RpcTransport,
  Uuid,
} from './contracts.js';
import {
  isInstant,
  isSecretRef,
  isSha256,
  isUuid,
  isWorkerId,
  readClaimedDeliveryJobs,
  readClaimedRuns,
  readDeliveryAttemptResult,
  readFinalizedRun,
  readLeaseRecoveryResult,
} from './guards.js';

const boundedInteger = (value: number, minimum: number, maximum: number, code: string): number => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(code);
  return value;
};

export class DlktInfoWorkerGateway {
  readonly #transport: RpcTransport;

  constructor(transport: RpcTransport) {
    this.#transport = transport;
  }

  async claimDueBriefings(input: {
    readonly workerId: string;
    readonly limit?: number;
    readonly now: string;
    readonly leaseSeconds?: number;
  }): Promise<readonly ClaimedRun[]> {
    if (!isWorkerId(input.workerId) || !isInstant(input.now)) throw new Error('DLKT_INFO_CLAIM_INPUT_INVALID');
    const response = await this.#transport.call('dlkt_info_claim_due_briefings', {
      p_worker_id: input.workerId,
      p_limit: boundedInteger(input.limit ?? 20, 1, 100, 'DLKT_INFO_CLAIM_LIMIT_INVALID'),
      p_now: input.now,
      p_lease_seconds: boundedInteger(input.leaseSeconds ?? 120, 30, 900, 'DLKT_INFO_LEASE_INVALID'),
    });
    return readClaimedRuns(response);
  }

  async claimQueuedRuns(input: {
    readonly workerId: string;
    readonly limit?: number;
    readonly now: string;
    readonly leaseSeconds?: number;
  }): Promise<readonly ClaimedRun[]> {
    if (!isWorkerId(input.workerId) || !isInstant(input.now)) throw new Error('DLKT_INFO_CLAIM_INPUT_INVALID');
    const response = await this.#transport.call('dlkt_info_claim_queued_runs', {
      p_worker_id: input.workerId,
      p_limit: boundedInteger(input.limit ?? 20, 1, 100, 'DLKT_INFO_CLAIM_LIMIT_INVALID'),
      p_now: input.now,
      p_lease_seconds: boundedInteger(input.leaseSeconds ?? 120, 30, 900, 'DLKT_INFO_LEASE_INVALID'),
    });
    return readClaimedRuns(response);
  }

  async finalizeRun(input: FinalizeRunInput): Promise<FinalizedRun> {
    if (!isUuid(input.runId) || !isWorkerId(input.workerId) || !isInstant(input.now)
      || !isSha256(input.payloadHash) || !input.engineVersion || !input.productVersion) {
      throw new Error('DLKT_INFO_FINALIZE_INPUT_INVALID');
    }
    const response = await this.#transport.call('dlkt_info_finalize_run', {
      p_run_id: input.runId,
      p_worker_id: input.workerId,
      p_briefing: input.briefing,
      p_engine_version: input.engineVersion,
      p_product_version: input.productVersion,
      p_payload_hash: input.payloadHash,
      p_now: input.now,
    });
    return readFinalizedRun(response);
  }

  async verifyDeliveryEndpoint(input: {
    readonly endpointId: Uuid;
    readonly secretRef: string;
    readonly now: string;
  }): Promise<Readonly<{ endpointId: Uuid; state: 'verified'; verifiedAt: string }>> {
    if (!isUuid(input.endpointId) || !isSecretRef(input.secretRef) || !isInstant(input.now)) {
      throw new Error('DLKT_INFO_ENDPOINT_VERIFICATION_INVALID');
    }
    const response = await this.#transport.call('dlkt_info_verify_delivery_endpoint', {
      p_endpoint_id: input.endpointId,
      p_secret_ref: input.secretRef,
      p_now: input.now,
    });
    if (!Array.isArray(response) || response.length !== 1 || typeof response[0] !== 'object' || response[0] === null) {
      throw new Error('DLKT_INFO_ENDPOINT_VERIFICATION_RESPONSE_INVALID');
    }
    const row = response[0] as Record<string, unknown>;
    if (!isUuid(row.endpoint_id) || row.state !== 'verified' || !isInstant(row.verified_at)) {
      throw new Error('DLKT_INFO_ENDPOINT_VERIFICATION_RESPONSE_INVALID');
    }
    return Object.freeze({ endpointId: row.endpoint_id, state: 'verified', verifiedAt: row.verified_at });
  }

  async claimDeliveryJobs(input: {
    readonly workerId: string;
    readonly limit?: number;
    readonly now: string;
    readonly leaseSeconds?: number;
  }): Promise<readonly ClaimedDeliveryJob[]> {
    if (!isWorkerId(input.workerId) || !isInstant(input.now)) throw new Error('DLKT_INFO_DELIVERY_CLAIM_INVALID');
    const response = await this.#transport.call('dlkt_info_claim_delivery_jobs', {
      p_worker_id: input.workerId,
      p_limit: boundedInteger(input.limit ?? 50, 1, 200, 'DLKT_INFO_DELIVERY_LIMIT_INVALID'),
      p_now: input.now,
      p_lease_seconds: boundedInteger(input.leaseSeconds ?? 120, 30, 900, 'DLKT_INFO_LEASE_INVALID'),
    });
    return readClaimedDeliveryJobs(response);
  }

  async recordDeliveryAttempt(input: RecordDeliveryAttemptInput): Promise<DeliveryAttemptResult> {
    if (!isUuid(input.jobId) || !isWorkerId(input.workerId) || !isInstant(input.now)
      || (input.retryAt !== null && !isInstant(input.retryAt))) {
      throw new Error('DLKT_INFO_DELIVERY_RESULT_INVALID');
    }
    if (input.succeeded && (!input.providerMessageId || input.errorCode !== null || input.retryAt !== null)) {
      throw new Error('DLKT_INFO_DELIVERY_SUCCESS_INVALID');
    }
    if (!input.succeeded && !input.errorCode) throw new Error('DLKT_INFO_DELIVERY_ERROR_INVALID');
    const response = await this.#transport.call('dlkt_info_record_delivery_attempt', {
      p_job_id: input.jobId,
      p_worker_id: input.workerId,
      p_succeeded: input.succeeded,
      p_provider_message_id: input.providerMessageId,
      p_error_code: input.errorCode,
      p_retry_at: input.retryAt,
      p_metadata: input.metadata,
      p_now: input.now,
    });
    return readDeliveryAttemptResult(response);
  }

  async recoverExpiredLeases(now: string): Promise<LeaseRecoveryResult> {
    if (!isInstant(now)) throw new Error('DLKT_INFO_RECOVERY_TIME_INVALID');
    return readLeaseRecoveryResult(await this.#transport.call('dlkt_info_recover_expired_leases', { p_now: now }));
  }
}
