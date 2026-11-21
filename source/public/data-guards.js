const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const WORKER_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,159}$/u;
const SECRET_REF = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{2,254}$/u;
const DELIVERY_STATES = new Set(['pending', 'claimed', 'retry', 'delivered', 'dead', 'cancelled']);
export const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
export const isUuid = (value) => typeof value === 'string' && UUID.test(value);
export const isSha256 = (value) => typeof value === 'string' && SHA256.test(value);
export const isWorkerId = (value) => typeof value === 'string' && WORKER_ID.test(value);
export const isSecretRef = (value) => typeof value === 'string' && SECRET_REF.test(value);
export const isInstant = (value) => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const integer = (value, minimum, maximum) => typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
const rows = (value) => {
    if (!Array.isArray(value) || value.some((entry) => !isRecord(entry)))
        throw new Error('DLKT_INFO_RPC_RESPONSE_INVALID');
    return value;
};
const claimedRun = (row) => {
    if (!isUuid(row.run_id) || !isUuid(row.briefing_id) || !isUuid(row.owner_id)
        || !isInstant(row.scheduled_for) || !isInstant(row.window_start) || !isInstant(row.window_end)
        || !integer(row.attempt_no, 1, 10) || !integer(row.max_cards, 1, 2_147_483_647)) {
        throw new Error('DLKT_INFO_CLAIMED_RUN_INVALID');
    }
    return Object.freeze({
        runId: row.run_id,
        briefingId: row.briefing_id,
        ownerId: row.owner_id,
        scheduledFor: row.scheduled_for,
        windowStart: row.window_start,
        windowEnd: row.window_end,
        attemptNo: row.attempt_no,
        maxCards: row.max_cards,
    });
};
export const readClaimedRuns = (value) => Object.freeze(rows(value).map(claimedRun));
export const readFinalizedRun = (value) => {
    const result = rows(value);
    if (result.length !== 1)
        throw new Error('DLKT_INFO_FINALIZED_RUN_CARDINALITY');
    const row = result[0];
    if (!row || !isUuid(row.run_id) || (row.status !== 'ready' && row.status !== 'empty')
        || !integer(row.card_count, 0, 12) || !integer(row.contested_count, 0, 12)
        || !integer(row.omitted_count, 0, 32767) || !integer(row.outbox_count, 0, 100)) {
        throw new Error('DLKT_INFO_FINALIZED_RUN_INVALID');
    }
    return Object.freeze({
        runId: row.run_id,
        status: row.status,
        cardCount: row.card_count,
        contestedCount: row.contested_count,
        omittedCount: row.omitted_count,
        outboxCount: row.outbox_count,
    });
};
export const readClaimedDeliveryJobs = (value) => Object.freeze(rows(value).map((row) => {
    if (!isUuid(row.job_id) || !isUuid(row.run_id) || !isUuid(row.owner_id) || !isUuid(row.endpoint_id)
        || (row.channel !== 'email' && row.channel !== 'push') || !isSecretRef(row.secret_ref)
        || !isSha256(row.destination_hash) || !isSha256(row.payload_hash) || !integer(row.attempt_no, 1, 20)) {
        throw new Error('DLKT_INFO_DELIVERY_JOB_INVALID');
    }
    return Object.freeze({
        jobId: row.job_id,
        runId: row.run_id,
        ownerId: row.owner_id,
        channel: row.channel,
        endpointId: row.endpoint_id,
        secretRef: row.secret_ref,
        destinationHash: row.destination_hash,
        attemptNo: row.attempt_no,
        payloadHash: row.payload_hash,
    });
}));
export const readDeliveryAttemptResult = (value) => {
    const result = rows(value);
    const row = result[0];
    if (result.length !== 1 || !row || !isUuid(row.job_id)
        || typeof row.status !== 'string' || !DELIVERY_STATES.has(row.status)
        || !integer(row.attempt_no, 1, 20) || typeof row.terminal !== 'boolean') {
        throw new Error('DLKT_INFO_DELIVERY_RESULT_INVALID');
    }
    return Object.freeze({
        jobId: row.job_id,
        status: row.status,
        attemptNo: row.attempt_no,
        terminal: row.terminal,
    });
};
export const readLeaseRecoveryResult = (value) => {
    const result = rows(value);
    const row = result[0];
    if (result.length !== 1 || !row
        || !integer(row.recovered_runs, 0, 100000) || !integer(row.failed_runs, 0, 100000)
        || !integer(row.retried_deliveries, 0, 100000) || !integer(row.dead_deliveries, 0, 100000)) {
        throw new Error('DLKT_INFO_LEASE_RECOVERY_INVALID');
    }
    return Object.freeze({
        recoveredRuns: row.recovered_runs,
        failedRuns: row.failed_runs,
        retriedDeliveries: row.retried_deliveries,
        deadDeliveries: row.dead_deliveries,
    });
};
