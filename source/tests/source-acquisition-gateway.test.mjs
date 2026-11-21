import assert from 'node:assert/strict';
import test from 'node:test';

const SOURCE = 'eu-eurlex-commission-proposals';
const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-11-11T20:00:00.000Z';
const HASH = 'a'.repeat(64);
const reservation = {
  allowed: true, reason: 'reserved', attempt_id: ATTEMPT, source_key: SOURCE, attempt_no: 1,
  checkpoint_version: 0, checkpoint: null, body_hash: null, etag: null, last_modified: null,
  lease_expires_at: '2026-11-11T20:02:00.000Z',
};
const state = {
  source_key: SOURCE, checkpoint_version: 1, checkpoint: { version: 'checkpoint-1' }, body_hash: HASH,
  etag: '"one"', last_modified: null, last_attempt_at: NOW, last_success_at: NOW,
  next_eligible_at: '2026-11-11T20:30:00.000Z', attempts_today: 1, total_attempts: 1,
  consecutive_failures: 0, last_error_code: null,
};

test('source acquisition gateway reserves, completes and reads strict service RPCs', async () => {
  const { DlktInfoSourceAcquisitionGateway } = await import('../.build/src/data/index.js');
  const calls = [];
  const transport = { call: async (name, parameters) => {
    calls.push({ name, parameters });
    if (name === 'dlkt_info_reserve_source_acquisition') return [reservation];
    if (name === 'dlkt_info_complete_source_acquisition') return [state];
    if (name === 'dlkt_info_read_source_acquisition') return [state];
    throw new Error('unexpected');
  }};
  const gateway = new DlktInfoSourceAcquisitionGateway(transport);
  const reserved = await gateway.reserve({ sourceKey: SOURCE, workerId: 'worker:eu:one', now: NOW });
  assert.equal(reserved.attemptId, ATTEMPT);
  const completed = await gateway.complete({ sourceKey: SOURCE, attemptId: ATTEMPT, workerId: 'worker:eu:one',
    outcome: 'modified', checkpointVersion: 1, checkpoint: { version: 'checkpoint-1' }, bodyHash: HASH,
    etag: '"one"', lastModified: null, errorCode: null, now: NOW });
  assert.equal(completed.checkpointVersion, 1);
  assert.equal((await gateway.read(SOURCE)).bodyHash, HASH);
  assert.deepEqual(calls.map((call) => call.name), [
    'dlkt_info_reserve_source_acquisition', 'dlkt_info_complete_source_acquisition', 'dlkt_info_read_source_acquisition',
  ]);
});

test('source acquisition gateway rejects malformed inputs and over-broad RPC projections', async () => {
  const { DlktInfoSourceAcquisitionGateway, readSourceAcquisitionReservation, readSourceAcquisitionState } = await import('../.build/src/data/index.js');
  const gateway = new DlktInfoSourceAcquisitionGateway({ call: async () => { throw new Error('network must not run'); } });
  await assert.rejects(() => gateway.reserve({ sourceKey: 'bad key', workerId: 'x', now: 'invalid' }), /RESERVE_INPUT_INVALID/u);
  await assert.rejects(() => gateway.complete({ sourceKey: SOURCE, attemptId: ATTEMPT, workerId: 'worker:eu:one',
    outcome: 'modified', checkpointVersion: null, checkpoint: null, bodyHash: null, etag: null,
    lastModified: null, errorCode: null, now: NOW }), /COMPLETE_INPUT_INVALID/u);
  assert.throws(() => readSourceAcquisitionReservation([{ ...reservation, secret: 'blocked' }]), /RESPONSE_INVALID/u);
  assert.throws(() => readSourceAcquisitionReservation([{ ...reservation, allowed: false, reason: 'reserved', attempt_id: null }]), /RESPONSE_INVALID/u);
  assert.throws(() => readSourceAcquisitionState([{ ...state, checkpoint_version: 0 }]), /STATE_INVALID/u);
});
