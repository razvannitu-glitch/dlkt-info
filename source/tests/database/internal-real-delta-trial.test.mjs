import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const SOURCE = 'eu-eurlex-commission-proposals';
const ACQUISITION_WORKER = 'worker:eu-private:trial';
const TRIAL_WORKER = 'worker:internal-delta:trial';
const BASELINE_AT = '2026-11-11T20:00:00.000Z';
const CHANGED_AT = '2026-11-11T20:31:00.000Z';
const TRIAL_AT = '2026-11-11T20:31:01.000Z';
const BASELINE_EXTERNAL = `eu-source-claim:${'1'.repeat(64)}`;
const CHANGED_EXTERNAL = `eu-source-claim:${'2'.repeat(64)}`;
let db;

async function query(text, params = []) { return db.query(text, params); }
async function resetRole() {
  await db.exec('reset role;');
  await query("select set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)");
}
async function asRole(role, operation) {
  await resetRole();
  await query("select set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.exec(`set role ${role};`);
  try { return await operation(); } finally { await resetRole(); }
}
const asService = (operation) => asRole('service_role', operation);

const claim = ({ at, externalKey, supersedesExternalKey = null, changeKind, title, fingerprint, evidenceHash }) => ({
  external_key: externalKey,
  supersedes_external_key: supersedesExternalKey,
  change_kind: changeKind,
  entity_key: 'eu-document:52026PC0001',
  entity_type: 'eu-proposal',
  entity_label: '52026PC0001',
  topic_id: 'regulation',
  kind: 'regulation',
  predicate: 'official-eu-proposal-listing',
  value: [title, 'creator:European Commission', 'celex:52026PC0001', 'feed:commission-proposals'],
  materiality: 'low',
  actionability: 0.25,
  observed_at: at,
  effective_at: null,
  valid_from: at,
  valid_until: '2026-12-20T20:00:00.000Z',
  locale: 'en',
  geography: 'European Union',
  affects: ['regulatory-monitoring'],
  fingerprint,
  evidence: [{
    source_id: SOURCE,
    url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX%3A52026PC0001',
    title: `52026PC0001: ${title}`,
    retrieved_at: at,
    published_at: null,
    content_hash: evidenceHash,
  }],
});

async function reserve(at) {
  const result = await asService(() => query(
    'select * from public.dlkt_info_reserve_source_acquisition($1,$2,$3::timestamptz,120)',
    [SOURCE, ACQUISITION_WORKER, at],
  ));
  assert.equal(result.rows[0].allowed, true);
  return result.rows[0];
}

async function commit({ reservation, at, version, hash, baseline, claims }) {
  return asService(() => query(`
    select * from public.dlkt_info_commit_source_acquisition(
      $1,$2::uuid,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11::timestamptz
    )
  `, [SOURCE, reservation.attempt_id, ACQUISITION_WORKER, version,
    JSON.stringify({ version: 'dlkt-info-eu-official-checkpoint-1', feedId: 'eu-commission-proposals',
      checkedAt: at, bodyHash: hash, etag: null, lastModified: null, channelPublishedAt: at,
      entries: [{ feedId: 'eu-commission-proposals', feedKind: 'commission-proposals', sourceId: SOURCE,
        celexId: '52026PC0001', documentTitle: claims[0].value[0], creator: 'European Commission',
        link: claims[0].evidence[0].url, guid: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELLAR%3A9502bac6-dcf8-11f1-8501-01aa75ed71a1',
        publishedAt: null, fingerprint: claims[0].fingerprint }] }),
    hash, null, null, baseline, JSON.stringify(claims), at]));
}

const cardRows = (projection) => projection.cards.map(({ position, card }) => ({
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
}));
const linkRows = (projection) => projection.links.map((link) => ({
  external_card_id: link.externalCardId,
  claim_id: link.claimId,
  relationship: link.relationship,
}));

before(async () => {
  db = new PGlite(); await db.waitReady;
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role', true), '')
    $$;
  `);
  const migrations = (await readdir('supabase/migrations')).filter((file) => file.endsWith('.sql')).sort();
  for (const migration of migrations) await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));

  const baselineReservation = await reserve(BASELINE_AT);
  await commit({ reservation: baselineReservation, at: BASELINE_AT, version: 1, hash: 'a'.repeat(64), baseline: true,
    claims: [claim({ at: BASELINE_AT, externalKey: BASELINE_EXTERNAL, changeKind: 'baseline',
      title: 'Original synthetic proposal title', fingerprint: 'b'.repeat(64), evidenceHash: 'c'.repeat(64) })] });
  const baselineJobs = await query('select count(*)::int count from dlkt_info_private.internal_delta_jobs');
  assert.equal(baselineJobs.rows[0].count, 0);

  const changedReservation = await reserve(CHANGED_AT);
  await commit({ reservation: changedReservation, at: CHANGED_AT, version: 2, hash: 'd'.repeat(64), baseline: false,
    claims: [claim({ at: CHANGED_AT, externalKey: CHANGED_EXTERNAL, supersedesExternalKey: BASELINE_EXTERNAL,
      changeKind: 'changed', title: 'Updated synthetic proposal title', fingerprint: 'e'.repeat(64), evidenceHash: 'f'.repeat(64) })] });
});

after(async () => { await db.close(); });

let trialId;
let trialCardId;

test('baseline is silent and the next changed batch becomes one private leased delta job', async () => {
  const queued = await query('select status, source_key, attempt_count from dlkt_info_private.internal_delta_jobs');
  assert.deepEqual(queued.rows, [{ status: 'pending', source_key: SOURCE, attempt_count: 0 }]);
  const claimed = await asService(() => query(
    'select * from public.dlkt_info_claim_internal_delta_jobs($1,10,$2::timestamptz,180)',
    [TRIAL_WORKER, TRIAL_AT],
  ));
  assert.equal(claimed.rows.length, 1);
  assert.equal(claimed.rows[0].attempt_no, 1);
  assert.equal(claimed.rows[0].current_claims.length, 1);
  assert.equal(claimed.rows[0].previous_claims.length, 1);
  assert.equal(claimed.rows[0].current_claims[0].id.length, 36);
  assert.equal(claimed.rows[0].previous_claims[0].id.length, 36);
  const { readInternalDeltaJobs, projectInternalDeltaTrial } = await import('../../.build/src/trials/index.js');
  const [job] = readInternalDeltaJobs(JSON.parse(JSON.stringify(claimed.rows)));
  const projection = projectInternalDeltaTrial(job, Date.parse(TRIAL_AT));
  assert.equal(projection.cards.length, 1);
  assert.equal(projection.cards[0].card.kind, 'changed');

  const invalidCards = cardRows(projection).map((card) => ({
    ...card,
    sources: card.sources.map((source) => ({ ...source, url: 'https://eur-lex.europa.eu/legal-content/OTHER/?uri=CELEX%3A52026PC0001' })),
  }));
  await assert.rejects(() => asService(() => query(`
    select * from public.dlkt_info_complete_internal_delta_trial(
      $1::uuid,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10::jsonb,$11::jsonb,$12::timestamptz
    )
  `, [job.jobId, TRIAL_WORKER, 'eu-official-change-radar', '0.1.1', '0.1.0', '0.8.8',
    job.windowStart, job.windowEnd, projection.payloadHash, JSON.stringify(invalidCards),
    JSON.stringify(linkRows(projection)), TRIAL_AT])), /SOURCE_INVALID/u);
  assert.equal((await query('select count(*)::int count from dlkt_info_private.internal_delta_trials')).rows[0].count, 0);

  const invalidLinks = linkRows(projection).map((link, index) => index === 0
    ? { ...link, claim_id: '99999999-9999-4999-8999-999999999999' } : link);
  await assert.rejects(() => asService(() => query(`
    select * from public.dlkt_info_complete_internal_delta_trial(
      $1::uuid,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10::jsonb,$11::jsonb,$12::timestamptz
    )
  `, [job.jobId, TRIAL_WORKER, 'eu-official-change-radar', '0.1.1', '0.1.0', '0.8.8',
    job.windowStart, job.windowEnd, projection.payloadHash, JSON.stringify(cardRows(projection)),
    JSON.stringify(invalidLinks), TRIAL_AT])), /CLAIM_SCOPE_INVALID/u);
  assert.equal((await query('select count(*)::int count from dlkt_info_private.internal_delta_trials')).rows[0].count, 0);

  const completed = await asService(() => query(`
    select * from public.dlkt_info_complete_internal_delta_trial(
      $1::uuid,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10::jsonb,$11::jsonb,$12::timestamptz
    )
  `, [job.jobId, TRIAL_WORKER, 'eu-official-change-radar', '0.1.1', '0.1.0', '0.8.8',
    job.windowStart, job.windowEnd, projection.payloadHash, JSON.stringify(cardRows(projection)),
    JSON.stringify(linkRows(projection)), TRIAL_AT]));
  assert.deepEqual({ status: completed.rows[0].status, card_count: completed.rows[0].card_count,
    pending_count: completed.rows[0].pending_count, public_cards_created: completed.rows[0].public_cards_created },
  { status: 'ready_for_review', card_count: 1, pending_count: 1, public_cards_created: false });
  trialId = completed.rows[0].trial_id;
  const card = await query('select id, review_state, kind, entity_key from dlkt_info_private.internal_delta_trial_cards where trial_id=$1', [trialId]);
  trialCardId = card.rows[0].id;
  const queue = await asService(() => query('select * from public.dlkt_info_read_internal_delta_review_queue(20)'));
  assert.equal(queue.rows.length, 1);
  assert.equal(queue.rows[0].card_id, trialCardId);
  assert.equal(queue.rows[0].source_key, SOURCE);
  assert.equal(queue.rows[0].title, projection.cards[0].card.title);
  const { readInternalReviewQueue } = await import('../../.build/src/trials/index.js');
  const parsedQueue = readInternalReviewQueue(JSON.parse(JSON.stringify(queue.rows)));
  assert.equal(parsedQueue[0].cardId, trialCardId);
  assert.equal(parsedQueue[0].sources[0].authority, 'official');
  assert.deepEqual({ review_state: card.rows[0].review_state, kind: card.rows[0].kind, entity_key: card.rows[0].entity_key },
    { review_state: 'pending', kind: 'changed', entity_key: 'eu-document:52026PC0001' });
  assert.equal((await query('select count(*)::int count from public.dlkt_info_briefing_cards')).rows[0].count, 0);
});

test('human approval is auditable but cannot publish a public card', async () => {
  const reviewed = await asService(() => query(
    'select * from public.dlkt_info_review_internal_delta_card($1::uuid,$2,$3,$4,$5::timestamptz)',
    [trialCardId, 'approved', 'human:razvan.internal', 'Verified against the linked official EUR-Lex document.', '2026-11-11T20:31:02.000Z'],
  ));
  assert.deepEqual({ trial_status: reviewed.rows[0].trial_status, card_review_state: reviewed.rows[0].card_review_state,
    approved_count: reviewed.rows[0].approved_count, public_cards_created: reviewed.rows[0].public_cards_created },
  { trial_status: 'approved', card_review_state: 'approved', approved_count: 1, public_cards_created: false });
  const trial = await query('select status, pending_count, approved_count, rejected_count, public_cards_created from dlkt_info_private.internal_delta_trials where id=$1', [trialId]);
  assert.deepEqual(trial.rows[0], { status: 'approved', pending_count: 0, approved_count: 1, rejected_count: 0, public_cards_created: false });
  assert.equal((await query('select count(*)::int count from public.dlkt_info_briefing_cards')).rows[0].count, 0);
  assert.equal((await asService(() => query('select count(*)::int count from public.dlkt_info_read_internal_delta_review_queue(20)'))).rows[0].count, 0);
  assert.equal((await query('select count(*)::int count from dlkt_info_private.internal_delta_review_events where trial_id=$1', [trialId])).rows[0].count, 3);
  await assert.rejects(() => asService(() => query(
    'select * from public.dlkt_info_review_internal_delta_card($1::uuid,$2,$3,$4,$5::timestamptz)',
    [trialCardId, 'rejected', 'human:razvan.internal', 'Second decision must fail.', '2026-11-11T20:31:03.000Z'],
  )), /CARD_NOT_PENDING/u);
});

test('trial tables and RPCs are private, and audit events are immutable', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(() => asRole(role, () => query('select * from dlkt_info_private.internal_delta_trials')), /permission denied/u);
    await assert.rejects(() => asRole(role, () => query(
      'select * from public.dlkt_info_claim_internal_delta_jobs($1,1,$2::timestamptz,180)',
      ['worker:forbidden:test', TRIAL_AT],
    )), /permission denied/u);
    await assert.rejects(() => asRole(role, () => query(
      'select * from public.dlkt_info_read_internal_delta_review_queue(20)'
    )), /permission denied/u);
  }
  await assert.rejects(() => asService(() => query(
    "update dlkt_info_private.internal_delta_review_events set note='Mutated note' where trial_id=$1",
    [trialId],
  )), /APPEND_ONLY|permission denied/u);
  const counts = await query(`select
    (select count(*)::int from dlkt_info_private.internal_delta_trials) trials,
    (select count(*)::int from dlkt_info_private.internal_delta_trial_cards) private_cards,
    (select count(*)::int from dlkt_info_private.internal_delta_trial_card_claims) links,
    (select count(*)::int from public.dlkt_info_briefing_cards) public_cards`);
  assert.deepEqual(counts.rows[0], { trials: 1, private_cards: 1, links: 2, public_cards: 0 });
});
