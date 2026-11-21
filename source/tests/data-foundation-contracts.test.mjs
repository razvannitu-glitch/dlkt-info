import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DATA_FOUNDATION_MIGRATION,
  DATA_FOUNDATION_VERSION,
  DlktInfoWorkerGateway,
  isSecretRef,
  isSha256,
  isUuid,
  readClaimedDeliveryJobs,
  readClaimedRuns,
  readFinalizedRun,
} from '../.build/src/data/index.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const BRIEFING_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '33333333-3333-4333-8333-333333333333';
const ENDPOINT_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-11-11T16:05:00.000Z';
const HASH = 'a'.repeat(64);

const claimedRun = {
  run_id: RUN_ID,
  briefing_id: BRIEFING_ID,
  owner_id: OWNER_ID,
  scheduled_for: '2026-11-11T16:00:00.000Z',
  window_start: '2026-11-10T16:00:00.000Z',
  window_end: '2026-11-11T16:00:00.000Z',
  attempt_no: 1,
  max_cards: 5,
};

class RecordingTransport {
  calls = [];
  responses = new Map();
  async call(functionName, parameters) {
    this.calls.push({ functionName, parameters });
    return this.responses.get(functionName) ?? [];
  }
}

test('data foundation has an explicit independent version and migration identity', () => {
  assert.equal(DATA_FOUNDATION_VERSION, 'dlkt-info-data-1');
  assert.equal(DATA_FOUNDATION_MIGRATION, '20261111184500_dlkt_info_data_delivery_foundation');
});

test('identifier, hash and secret-reference guards reject malformed values', () => {
  assert.equal(isUuid(RUN_ID), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isSha256(HASH), true);
  assert.equal(isSha256('A'.repeat(64)), false);
  assert.equal(isSecretRef('vault://dlkt-info/endpoints/one'), true);
  assert.equal(isSecretRef('bad secret'), false);
});

test('claimed-run response parsing is strict and immutable', () => {
  const result = readClaimedRuns([claimedRun]);
  assert.deepEqual(result, [{
    runId: RUN_ID,
    briefingId: BRIEFING_ID,
    ownerId: OWNER_ID,
    scheduledFor: claimedRun.scheduled_for,
    windowStart: claimedRun.window_start,
    windowEnd: claimedRun.window_end,
    attemptNo: 1,
    maxCards: 5,
  }]);
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => readClaimedRuns([{ ...claimedRun, max_cards: 0 }]), /DLKT_INFO_CLAIMED_RUN_INVALID/u);
});

test('delivery jobs never expose a raw destination, only a hash and secret reference', () => {
  const result = readClaimedDeliveryJobs([{
    job_id: JOB_ID,
    run_id: RUN_ID,
    owner_id: OWNER_ID,
    channel: 'email',
    endpoint_id: ENDPOINT_ID,
    secret_ref: 'vault://dlkt-info/endpoints/one',
    destination_hash: HASH,
    attempt_no: 1,
    payload_hash: HASH,
  }]);
  assert.equal(result[0].secretRef, 'vault://dlkt-info/endpoints/one');
  assert.equal(result[0].destinationHash, HASH);
  assert.equal(Object.hasOwn(result[0], 'destination'), false);
});

test('finalized-run response enforces finite-card and idempotent-outbox bounds', () => {
  const result = readFinalizedRun([{
    run_id: RUN_ID,
    status: 'ready',
    card_count: 5,
    contested_count: 1,
    omitted_count: 7,
    outbox_count: 2,
  }]);
  assert.equal(result.cardCount, 5);
  assert.throws(() => readFinalizedRun([{ ...result, run_id: RUN_ID, card_count: 13 }]), /DLKT_INFO_FINALIZED_RUN_INVALID/u);
});

test('worker gateway calls the due scheduler with bounded explicit parameters', async () => {
  const transport = new RecordingTransport();
  transport.responses.set('dlkt_info_claim_due_briefings', [claimedRun]);
  const gateway = new DlktInfoWorkerGateway(transport);
  const result = await gateway.claimDueBriefings({ workerId: 'worker:one', limit: 10, now: NOW, leaseSeconds: 90 });
  assert.equal(result.length, 1);
  assert.deepEqual(transport.calls, [{
    functionName: 'dlkt_info_claim_due_briefings',
    parameters: { p_worker_id: 'worker:one', p_limit: 10, p_now: NOW, p_lease_seconds: 90 },
  }]);
});

test('worker gateway refuses malformed service inputs before network execution', async () => {
  const transport = new RecordingTransport();
  const gateway = new DlktInfoWorkerGateway(transport);
  await assert.rejects(
    gateway.claimDueBriefings({ workerId: 'x', limit: 10, now: NOW }),
    /DLKT_INFO_CLAIM_INPUT_INVALID/u,
  );
  await assert.rejects(
    gateway.claimDeliveryJobs({ workerId: 'worker:one', limit: 201, now: NOW }),
    /DLKT_INFO_DELIVERY_LIMIT_INVALID/u,
  );
  assert.equal(transport.calls.length, 0);
});

test('endpoint verification is service-oriented and validates the returned state', async () => {
  const transport = new RecordingTransport();
  transport.responses.set('dlkt_info_verify_delivery_endpoint', [{
    endpoint_id: ENDPOINT_ID,
    state: 'verified',
    verified_at: NOW,
  }]);
  const gateway = new DlktInfoWorkerGateway(transport);
  const result = await gateway.verifyDeliveryEndpoint({
    endpointId: ENDPOINT_ID,
    secretRef: 'vault://dlkt-info/endpoints/one',
    now: NOW,
  });
  assert.deepEqual(result, { endpointId: ENDPOINT_ID, state: 'verified', verifiedAt: NOW });
});

test('delivery success cannot carry retry or error state', async () => {
  const transport = new RecordingTransport();
  const gateway = new DlktInfoWorkerGateway(transport);
  await assert.rejects(gateway.recordDeliveryAttempt({
    jobId: JOB_ID,
    workerId: 'worker:delivery',
    succeeded: true,
    providerMessageId: 'message-1',
    errorCode: 'SHOULD_NOT_EXIST',
    retryAt: null,
    metadata: {},
    now: NOW,
  }), /DLKT_INFO_DELIVERY_SUCCESS_INVALID/u);
  assert.equal(transport.calls.length, 0);
});
