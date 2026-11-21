import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const SOURCE = 'eu-eurlex-commission-proposals';
const WORKER = 'worker:eu-private:one';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const CONTENT_A = 'c'.repeat(64);
const CONTENT_B = 'd'.repeat(64);
let db;
let now;
let firstExternalKey;

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

const iso = (offsetMs = 0) => new Date(Date.parse(now) + offsetMs).toISOString();
const claim = ({ externalKey, fingerprint, contentHash, changeKind, supersedesExternalKey = null, title = 'Proposal for a synthetic regulation' }) => ({
  external_key: externalKey,
  supersedes_external_key: supersedesExternalKey,
  change_kind: changeKind,
  entity_key: 'eu-document:111111111111111111111111',
  entity_type: 'eu-proposal',
  entity_label: `52026PC0001: ${title}`,
  topic_id: 'regulation',
  kind: 'regulation',
  predicate: 'official-eu-proposal-listing',
  value: [title, 'creator:European Commission', 'celex:52026PC0001', 'feed:commission-proposals'],
  materiality: 'low',
  actionability: 0.25,
  observed_at: now,
  effective_at: null,
  valid_from: now,
  valid_until: iso(45 * 86_400_000),
  locale: 'en',
  geography: 'European Union',
  affects: ['regulatory-monitoring'],
  fingerprint,
  evidence: [{
    source_id: SOURCE,
    url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX%3A52026PC0001',
    title: `52026PC0001: ${title}`,
    retrieved_at: now,
    published_at: null,
    content_hash: contentHash,
  }],
});

async function reserve(at) {
  const result = await asService(() => query(
    'select * from public.dlkt_info_reserve_source_acquisition($1,$2,$3::timestamptz,120)',
    [SOURCE, WORKER, at],
  ));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].allowed, true);
  return result.rows[0];
}

async function commit(input) {
  return asService(() => query(`
    select * from public.dlkt_info_commit_source_acquisition(
      $1,$2::uuid,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11::timestamptz
    )
  `, [SOURCE, input.attemptId, WORKER, input.version, JSON.stringify(input.checkpoint), input.bodyHash,
    input.etag ?? null, input.lastModified ?? null, input.baseline, JSON.stringify(input.claims), input.at]));
}

before(async () => {
  db = new PGlite();
  await db.waitReady;
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
    grant usage on schema auth to anon, authenticated, service_role;
    grant select on auth.users to service_role;
  `);
  for (const file of [
    '20261111184500_dlkt_info_data_delivery_foundation.sql',
    '20261111213000_dlkt_info_companion_persistence.sql',
    '20261111224500_dlkt_info_source_acquisition.sql',
    '20261111233000_dlkt_info_private_baseline_commit.sql',
  ]) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  now = new Date().toISOString();
  firstExternalKey = `eu-source-claim:${'1'.repeat(64)}`;
});

after(async () => { await db.close(); });

test('baseline commit atomically stores checkpoint, batch, claims and provenance', async () => {
  const reservation = await reserve(now);
  const payload = claim({ externalKey: firstExternalKey, fingerprint: HASH_A, contentHash: CONTENT_A, changeKind: 'baseline' });
  const result = await commit({
    attemptId: reservation.attempt_id,
    version: 1,
    checkpoint: { version: 'dlkt-info-eu-official-checkpoint-1', feedId: 'eu-commission-proposals', entries: [{ celexId: '52026PC0001' }] },
    bodyHash: HASH_A,
    etag: '"baseline"',
    baseline: true,
    claims: [payload],
    at: now,
  });
  assert.equal(result.rows[0].checkpoint_version, 1);
  assert.equal(result.rows[0].claim_count, 1);
  assert.equal(result.rows[0].inserted_claims, 1);
  assert.equal(result.rows[0].existing_claims, 0);
  const counts = await query(`select
    (select count(*)::int from dlkt_info_private.source_claim_batches) batches,
    (select count(*)::int from dlkt_info_private.source_claim_batch_items) items,
    (select count(*)::int from dlkt_info_private.claims where external_key is not null) claims,
    (select count(*)::int from dlkt_info_private.claim_evidence) evidence`);
  assert.deepEqual(counts.rows[0], { batches: 1, items: 1, claims: 1, evidence: 1 });
});

test('changed metadata appends a superseding claim and never mutates the baseline', async () => {
  const secondAt = iso(1_000);
  await query('update dlkt_info_private.source_acquisition_state set next_eligible_at=$2::timestamptz where source_key=$1', [SOURCE, secondAt]);
  const reservation = await reserve(secondAt);
  const secondExternalKey = `eu-source-claim:${'2'.repeat(64)}`;
  const result = await commit({
    attemptId: reservation.attempt_id,
    version: 2,
    checkpoint: { version: 'dlkt-info-eu-official-checkpoint-1', feedId: 'eu-commission-proposals', entries: [{ celexId: '52026PC0001', revision: 2 }] },
    bodyHash: HASH_B,
    baseline: false,
    claims: [claim({ externalKey: secondExternalKey, supersedesExternalKey: firstExternalKey,
      fingerprint: HASH_B, contentHash: CONTENT_B, changeKind: 'changed', title: 'Amended synthetic proposal title' })],
    at: secondAt,
  });
  assert.equal(result.rows[0].inserted_claims, 1);
  const chain = await query(`select current.external_key current_key, previous.external_key previous_key
    from dlkt_info_private.claims current
    join dlkt_info_private.claims previous on previous.id=current.supersedes_claim_id
    where current.external_key=$1`, [secondExternalKey]);
  assert.deepEqual(chain.rows[0], { current_key: secondExternalKey, previous_key: firstExternalKey });
  const baseline = await query('select baseline, claim_count, inserted_claims from dlkt_info_private.source_claim_batches order by checkpoint_version');
  assert.deepEqual(baseline.rows, [
    { baseline: true, claim_count: 1, inserted_claims: 1 },
    { baseline: false, claim_count: 1, inserted_claims: 1 },
  ]);
});

test('invalid provenance rolls the entire commit back and leaves the lease recoverable', async () => {
  const thirdAt = iso(2_000);
  await query('update dlkt_info_private.source_acquisition_state set next_eligible_at=$2::timestamptz where source_key=$1', [SOURCE, thirdAt]);
  const reservation = await reserve(thirdAt);
  const invalid = claim({ externalKey: `eu-source-claim:${'3'.repeat(64)}`, fingerprint: 'e'.repeat(64),
    contentHash: 'f'.repeat(64), changeKind: 'new' });
  invalid.evidence[0].url = 'https://attacker.example/legal-content/AUTO/?uri=CELEX%3A52026PC0001';
  const attempt = () => commit({
    attemptId: reservation.attempt_id,
    version: 3,
    checkpoint: { version: 'dlkt-info-eu-official-checkpoint-1', feedId: 'eu-commission-proposals', entries: [] },
    bodyHash: 'e'.repeat(64), baseline: false, claims: [invalid], at: thirdAt,
  });
  await assert.rejects(attempt, /DLKT_INFO_SOURCE_EVIDENCE_INVALID/u);
  invalid.evidence[0].url = 'https://eur-lex.europa.eu/legal-content/OTHER/?uri=CELEX%3A52026PC0001';
  await assert.rejects(attempt, /DLKT_INFO_SOURCE_EVIDENCE_INVALID/u);
  invalid.evidence[0].url = 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX%3A52026PC0001&lang=en';
  await assert.rejects(attempt, /DLKT_INFO_SOURCE_EVIDENCE_INVALID/u);
  const state = await query('select checkpoint_version, active_attempt_id from dlkt_info_private.source_acquisition_state where source_key=$1', [SOURCE]);
  assert.equal(state.rows[0].checkpoint_version, 2);
  assert.equal(state.rows[0].active_attempt_id, reservation.attempt_id);
  const batches = await query('select count(*)::int count from dlkt_info_private.source_claim_batches');
  assert.equal(batches.rows[0].count, 2);
  await asService(() => query(`select * from public.dlkt_info_complete_source_acquisition(
    $1,$2::uuid,$3,'failed',null,null,null,null,null,'PROVIDER_PAYLOAD_INVALID',$4::timestamptz
  )`, [SOURCE, reservation.attempt_id, WORKER, thirdAt]));
});

test('claim batches and items are append-only and service-only', async () => {
  await assert.rejects(() => asRole('authenticated', () => query('select * from dlkt_info_private.source_claim_batches')), /permission denied/u);
  await assert.rejects(() => query('update dlkt_info_private.source_claim_batches set claim_count=0'), /DLKT_INFO_APPEND_ONLY/u);
  await assert.rejects(() => query('delete from dlkt_info_private.source_claim_batch_items'), /DLKT_INFO_APPEND_ONLY/u);
});
