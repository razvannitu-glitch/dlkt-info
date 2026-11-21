import assert from 'node:assert/strict';
import test from 'node:test';

const NOW = '2026-11-11T20:00:00.000Z';
const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const BATCH = '22222222-2222-4222-8222-222222222222';
const SOURCE = 'eu-eurlex-commission-proposals';
const BODY_HASH = 'a'.repeat(64);
const CONTENT_HASH = 'b'.repeat(64);
const EXTERNAL_KEY = `eu-source-claim:${'c'.repeat(64)}`;
const claim = Object.freeze({
  id: 'eu-claim:111111111111111111111111',
  entity: Object.freeze({ id: 'eu-document:111111111111111111111111', type: 'eu-proposal', label: '52026PC0001: Synthetic proposal' }),
  topicId: 'regulation', kind: 'regulation', predicate: 'official-eu-proposal-listing',
  value: Object.freeze(['Synthetic proposal', 'creator:European Commission', 'celex:52026PC0001', 'feed:commission-proposals']),
  materiality: 'low', actionability: 0.25, observedAt: NOW, effectiveAt: null, validFrom: NOW,
  validUntil: '2026-12-26T20:00:00.000Z', locale: 'en', geography: 'European Union',
  affects: Object.freeze(['regulatory-monitoring']),
  evidence: Object.freeze([Object.freeze({ sourceId: SOURCE,
    url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX%3A52026PC0001',
    title: '52026PC0001: Synthetic proposal', retrievedAt: NOW, publishedAt: null, contentHash: CONTENT_HASH })]),
});

const response = Object.freeze({
  source_key: SOURCE, checkpoint_version: 1, checkpoint: { version: 'checkpoint-1' }, body_hash: BODY_HASH,
  etag: '"one"', last_modified: null, last_attempt_at: NOW, last_success_at: NOW,
  next_eligible_at: '2026-11-11T20:30:00.000Z', attempts_today: 1, total_attempts: 1,
  consecutive_failures: 0, last_error_code: null, batch_id: BATCH,
  claim_count: 1, inserted_claims: 1, existing_claims: 0,
});

test('source claim gateway projects one atomic baseline commit into the bounded RPC contract', async () => {
  const { DlktInfoSourceClaimGateway } = await import('../.build/src/data/index.js');
  const calls = [];
  const gateway = new DlktInfoSourceClaimGateway({ call: async (name, parameters) => {
    calls.push({ name, parameters }); return [response];
  }});
  const result = await gateway.commitModified({ sourceKey: SOURCE, attemptId: ATTEMPT, workerId: 'worker:eu:one',
    checkpointVersion: 1, checkpoint: { version: 'checkpoint-1' }, bodyHash: BODY_HASH,
    etag: '"one"', lastModified: null, baseline: true,
    claims: [{ externalKey: EXTERNAL_KEY, supersedesExternalKey: null, changeKind: 'baseline', claim }], now: NOW });
  assert.equal(result.batchId, BATCH);
  assert.equal(result.insertedClaims, 1);
  assert.equal(calls[0].name, 'dlkt_info_commit_source_acquisition');
  assert.equal(calls[0].parameters.p_baseline, true);
  assert.equal(calls[0].parameters.p_claims[0].external_key, EXTERNAL_KEY);
  assert.equal(calls[0].parameters.p_claims[0].evidence[0].source_id, SOURCE);
  assert.match(calls[0].parameters.p_claims[0].fingerprint, /^[a-f0-9]{64}$/u);
});

test('source claim gateway rejects invalid baseline semantics, claims and over-broad RPC rows', async () => {
  const { DlktInfoSourceClaimGateway } = await import('../.build/src/data/index.js');
  let calls = 0;
  const gateway = new DlktInfoSourceClaimGateway({ call: async () => { calls += 1; return [{ ...response, unexpected: true }]; } });
  await assert.rejects(() => gateway.commitModified({ sourceKey: SOURCE, attemptId: ATTEMPT, workerId: 'worker:eu:one',
    checkpointVersion: 2, checkpoint: { version: 'checkpoint-2' }, bodyHash: BODY_HASH,
    etag: null, lastModified: null, baseline: true,
    claims: [{ externalKey: EXTERNAL_KEY, supersedesExternalKey: null, changeKind: 'baseline', claim }], now: NOW }),
  /DLKT_INFO_SOURCE_COMMIT_BASELINE_INVALID/u);
  assert.equal(calls, 0);
  await assert.rejects(() => gateway.commitModified({ sourceKey: SOURCE, attemptId: ATTEMPT, workerId: 'worker:eu:one',
    checkpointVersion: 1, checkpoint: { version: 'checkpoint-1' }, bodyHash: BODY_HASH,
    etag: null, lastModified: null, baseline: true,
    claims: [{ externalKey: EXTERNAL_KEY, supersedesExternalKey: null, changeKind: 'new', claim }], now: NOW }),
  /DLKT_INFO_SOURCE_COMMIT_CHANGE_KIND_INVALID|DLKT_INFO_SOURCE_COMMIT_BASELINE_INVALID/u);
  assert.equal(calls, 0);
  await assert.rejects(() => gateway.commitModified({ sourceKey: SOURCE, attemptId: ATTEMPT, workerId: 'worker:eu:one',
    checkpointVersion: 1, checkpoint: { version: 'checkpoint-1' }, bodyHash: BODY_HASH,
    etag: null, lastModified: null, baseline: true,
    claims: [{ externalKey: EXTERNAL_KEY, supersedesExternalKey: null, changeKind: 'baseline', claim }], now: NOW }),
  /DLKT_INFO_SOURCE_COMMIT_RESPONSE_INVALID/u);
  assert.equal(calls, 1);
});
