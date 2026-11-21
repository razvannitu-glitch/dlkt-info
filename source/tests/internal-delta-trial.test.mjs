import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const NOW = Date.parse('2026-11-11T20:00:00.000Z');
const SOURCE = 'eu-eurlex-commission-proposals';
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const PREVIOUS_ID = '33333333-3333-4333-8333-333333333333';
const CURRENT_ID = '44444444-4444-4444-8444-444444444444';

const claim = ({ id, title, hash, observedAt }) => Object.freeze({
  id,
  entity: Object.freeze({ id: 'eu-document:52026PC0001', type: 'eu-proposal', label: '52026PC0001' }),
  topicId: 'regulation',
  kind: 'regulation',
  predicate: 'official-eu-proposal-listing',
  value: Object.freeze([title, 'creator:European Commission', 'celex:52026PC0001', 'feed:commission-proposals']),
  materiality: 'low',
  actionability: 0.25,
  observedAt,
  effectiveAt: null,
  validFrom: observedAt,
  validUntil: '2026-12-20T20:00:00.000Z',
  locale: 'en',
  geography: 'European Union',
  affects: Object.freeze(['regulatory-monitoring']),
  evidence: Object.freeze([Object.freeze({
    sourceId: SOURCE,
    url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX%3A52026PC0001',
    title: `52026PC0001: ${title}`,
    retrievedAt: observedAt,
    publishedAt: null,
    contentHash: hash,
  })]),
});

const previous = claim({ id: PREVIOUS_ID, title: 'Original synthetic proposal title', hash: 'a'.repeat(64), observedAt: '2026-11-11T19:00:00.000Z' });
const current = claim({ id: CURRENT_ID, title: 'Updated synthetic proposal title', hash: 'b'.repeat(64), observedAt: '2026-11-11T20:00:00.000Z' });
const jobRow = () => ({
  job_id: JOB_ID,
  source_batch_id: BATCH_ID,
  source_key: SOURCE,
  observed_at: '2026-11-11T20:00:00.000Z',
  window_start: '2026-11-11T19:00:00.000Z',
  window_end: '2026-11-11T20:00:00.000Z',
  current_claims: [current],
  previous_claims: [previous],
  attempt_no: 1,
  lease_expires_at: '2026-11-11T20:03:00.000Z',
});

const READY_ENV = Object.freeze({
  DLKT_INFO_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  DLKT_INFO_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  DLKT_INFO_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(32)}`,
  DLKT_INFO_DATA_FOUNDATION_READY: '1',
  DLKT_INFO_AUTH_ENABLED: '0',
  DLKT_INFO_REAL_DATA_ENABLED: '1',
  DLKT_INFO_SOURCE_ACQUISITION_ENABLED: '1',
  DLKT_INFO_DELIVERY_WORKERS_ENABLED: '0',
  DLKT_INFO_SUPABASE_SECRET_KEY: `sb_secret_${'s'.repeat(32)}`,
  CRON_SECRET: 'cron_secret_value_0123456789abcdef',
  DLKT_INFO_INTERNAL_TRIAL_ENABLED: '1',
  DLKT_INFO_INTERNAL_REVIEW_ENABLED: '0',
});

test('internal trial configuration is explicit and never activates from generic variables', async () => {
  const { readInternalTrialConfiguration } = await import('../.build/src/trials/index.js');
  const ready = readInternalTrialConfiguration(READY_ENV);
  assert.deepEqual(ready, { state: 'ready', trialEnabled: true, reviewEnabled: false, reviewSecret: null, reviewerId: null });
  assert.equal(readInternalTrialConfiguration({ ...READY_ENV, DLKT_INFO_INTERNAL_TRIAL_ENABLED: '0' }).code, 'DLKT_INFO_INTERNAL_TRIAL_DISABLED');
  assert.equal(readInternalTrialConfiguration({ ...READY_ENV, DLKT_INFO_INTERNAL_REVIEW_ENABLED: '1' }).code,
    'DLKT_INFO_INTERNAL_REVIEW_CONFIGURATION_INVALID');
  assert.equal(readInternalTrialConfiguration({ SUPABASE_URL: READY_ENV.DLKT_INFO_SUPABASE_URL }).state, 'missing');
});

test('strict job projection produces one finite claim-linked card and deterministic hash', async () => {
  const { readInternalDeltaJobs, projectInternalDeltaTrial, internalTrialClaimKeys } = await import('../.build/src/trials/index.js');
  const [job] = readInternalDeltaJobs([jobRow()]);
  assert.ok(job);
  const first = projectInternalDeltaTrial(job, NOW);
  const second = projectInternalDeltaTrial(job, NOW);
  assert.equal(first.version, 'dlkt-info-internal-delta-trial-1');
  assert.equal(first.cards.length, 1);
  assert.equal(first.briefing.cards[0].kind, 'changed');
  assert.equal(first.links.length, 2);
  assert.deepEqual(first.links.map((link) => link.relationship).sort(), ['supersedes', 'supports']);
  assert.deepEqual(internalTrialClaimKeys(job.currentClaims), ['eu-document:52026PC0001|official-eu-proposal-listing']);
  assert.equal(first.payloadHash, second.payloadHash);
  assert.match(first.payloadHash, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(first), /publicCardsCreated/u);
});

test('job and RPC projections reject over-broad, malformed and cross-scope values', async () => {
  const { readInternalDeltaJobs, readInternalTrialSummary, readInternalTrialReview } = await import('../.build/src/trials/index.js');
  assert.throws(() => readInternalDeltaJobs([{ ...jobRow(), private_secret: 'x' }]), /JOBS_INVALID/u);
  assert.throws(() => readInternalDeltaJobs([{ ...jobRow(), current_claims: [{ ...current, evidence: [] }] }]), /CLAIMS_INVALID/u);
  assert.throws(() => readInternalTrialSummary([{ trial_id: JOB_ID, status: 'ready_for_review', card_count: 1,
    pending_count: 1, approved_count: 0, rejected_count: 0, public_cards_created: true }]), /SUMMARY_INVALID/u);
  assert.throws(() => readInternalTrialReview([{ trial_id: JOB_ID, trial_status: 'approved', card_id: BATCH_ID,
    card_review_state: 'approved', pending_count: 0, approved_count: 1, rejected_count: 0,
    public_cards_created: false, extra: true }]), /REVIEW_INVALID/u);
  const queueRow = {
    card_id: BATCH_ID, trial_id: JOB_ID, source_key: SOURCE, generated_at: '2026-11-11T20:00:00.000Z',
    card_position: 1, external_card_id: 'abcdef1234567890abcdef12', delta_id: '1234567890abcdef12345678',
    topic_id: 'regulation', entity_key: 'eu-document:52026PC0001', entity_type: 'eu-proposal', entity_label: '52026PC0001',
    kind: 'changed', title: 'Official metadata changed', direct: 'The official listing changed.',
    why_it_matters: 'Review the linked document.', changed_since: 'Changed since the previous checkpoint.',
    materiality: 'low', trust: 'confirmed', score: 47, blocked_dependencies: [],
    sources: [{ sourceId: SOURCE, title: 'EUR-Lex source', url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX%3A52026PC0001',
      authority: 'official', retrievedAt: '2026-11-11T20:00:00.000Z' }], expires_at: '2026-12-20T20:00:00.000Z',
  };
  const { readInternalReviewQueue } = await import('../.build/src/trials/index.js');
  assert.equal(readInternalReviewQueue([queueRow])[0].position, 1);
  assert.throws(() => readInternalReviewQueue([{ ...queueRow, sources: [{ ...queueRow.sources[0], url: 'javascript:alert(1)' }] }]), /QUEUE_INVALID/u);
});

test('internal trial gateway sends finite cards and claim links only to the private RPC', async () => {
  const { DlktInfoInternalTrialGateway, readInternalDeltaJobs, projectInternalDeltaTrial } = await import('../.build/src/trials/index.js');
  const calls = [];
  const transport = { call: async (name, parameters) => {
    calls.push({ name, parameters });
    if (name === 'dlkt_info_claim_internal_delta_jobs') return [jobRow()];
    if (name === 'dlkt_info_complete_internal_delta_trial') return [{ trial_id: '55555555-5555-4555-8555-555555555555',
      status: 'ready_for_review', card_count: 1, pending_count: 1, approved_count: 0, rejected_count: 0,
      public_cards_created: false }];
    throw new Error(`UNEXPECTED:${name}`);
  }};
  const gateway = new DlktInfoInternalTrialGateway(transport);
  const jobs = await gateway.claimJobs({ workerId: 'worker:internal-delta:test', now: new Date(NOW).toISOString() });
  const projection = projectInternalDeltaTrial(jobs[0], NOW);
  const summary = await gateway.complete({ jobId: JOB_ID, workerId: 'worker:internal-delta:test', projection,
    packId: 'eu-official-change-radar', packVersion: '0.1.1', engineVersion: '0.1.0', productVersion: '0.8.8',
    windowStart: jobs[0].windowStart, windowEnd: jobs[0].windowEnd, now: new Date(NOW).toISOString() });
  assert.equal(summary.cardCount, 1);
  assert.deepEqual(calls.map((call) => call.name), ['dlkt_info_claim_internal_delta_jobs', 'dlkt_info_complete_internal_delta_trial']);
  const complete = calls[1].parameters;
  assert.equal(complete.p_cards.length, 1);
  assert.equal(complete.p_card_claims.length, 2);
  assert.ok(complete.p_card_claims.every((link) => !('value' in link) && !('sources' in link)));
  assert.equal(complete.p_payload_hash, projection.payloadHash);
});
