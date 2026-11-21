import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const SOURCE = 'eu-eurlex-commission-proposals';
const WORKER_ONE = 'worker:eu-radar:one';
const WORKER_TWO = 'worker:eu-radar:two';
const START = '2026-11-11T20:00:00.000Z';
const HASH_A = 'a'.repeat(64);

let db;
let firstAttemptId;

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
  await db.exec(await readFile('supabase/migrations/20261111184500_dlkt_info_data_delivery_foundation.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261111213000_dlkt_info_companion_persistence.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261111224500_dlkt_info_source_acquisition.sql', 'utf8'));
});

after(async () => { await db?.close(); });

test('official source registry rows are versioned and legally bounded', async () => {
  const rows = await asService(() => query(`
    select source_key, authority, role, automated_access, factual_extraction,
      commercial_summaries, attribution_required, min_interval_seconds,
      max_requests_per_day, status
    from dlkt_info_private.source_registry
    where source_key like 'eu-eurlex-%'
    order by source_key
  `));
  assert.equal(rows.rows.length, 2);
  assert.ok(rows.rows.every((row) => row.authority === 'official' && row.role === 'regulator'));
  assert.ok(rows.rows.every((row) => row.automated_access === 'permitted' && row.factual_extraction === 'permitted'));
  assert.ok(rows.rows.every((row) => row.commercial_summaries === 'attribution-required' && row.attribution_required === true));
  assert.ok(rows.rows.every((row) => row.min_interval_seconds === 1800 && row.max_requests_per_day === 48 && row.status === 'active'));
});

test('reservation is service-only, lease-safe and consumes one bounded attempt', async () => {
  await assert.rejects(() => asRole('authenticated', () => query(
    'select * from public.dlkt_info_reserve_source_acquisition($1,$2,$3::timestamptz,$4)',
    [SOURCE, WORKER_ONE, START, 120],
  )), /permission denied|DLKT_INFO_SERVICE_ROLE_REQUIRED/iu);

  const first = await asService(() => query(
    'select * from public.dlkt_info_reserve_source_acquisition($1,$2,$3::timestamptz,$4)',
    [SOURCE, WORKER_ONE, START, 120],
  ));
  assert.equal(first.rows[0].allowed, true);
  assert.equal(first.rows[0].reason, 'reserved');
  assert.equal(first.rows[0].attempt_no, 1);
  assert.equal(first.rows[0].checkpoint_version, 0);
  assert.match(first.rows[0].attempt_id, /^[0-9a-f-]{36}$/u);
  firstAttemptId = first.rows[0].attempt_id;

  const competing = await asService(() => query(
    'select * from public.dlkt_info_reserve_source_acquisition($1,$2,$3::timestamptz,$4)',
    [SOURCE, WORKER_TWO, '2026-11-11T20:00:30.000Z', 120],
  ));
  assert.equal(competing.rows[0].allowed, false);
  assert.equal(competing.rows[0].reason, 'leased');
});

test('modified completion stores one checkpoint and immediate retry is interval-blocked', async () => {
  assert.match(firstAttemptId, /^[0-9a-f-]{36}$/u);
  const completed = await asService(() => query(`
    select * from public.dlkt_info_complete_source_acquisition(
      $1,$2::uuid,$3,'modified',$4,$5::jsonb,$6,$7,$8,null,$9::timestamptz
    )
  `, [SOURCE, firstAttemptId, WORKER_ONE, 1, JSON.stringify({ version: 'checkpoint-1', entries: [] }), HASH_A,
    '"etag-one"', 'Wed, 11 Nov 2026 20:00:00 GMT', '2026-11-11T20:00:20.000Z']));
  assert.equal(completed.rows[0].checkpoint_version, 1);
  assert.deepEqual(completed.rows[0].checkpoint, { version: 'checkpoint-1', entries: [] });
  assert.equal(completed.rows[0].body_hash, HASH_A);
  assert.equal(completed.rows[0].consecutive_failures, 0);

  const blocked = await asService(() => query(
    'select * from public.dlkt_info_reserve_source_acquisition($1,$2,$3::timestamptz,$4)',
    [SOURCE, WORKER_ONE, '2026-11-11T20:10:00.000Z', 120],
  ));
  assert.equal(blocked.rows[0].allowed, false);
  assert.equal(blocked.rows[0].reason, 'interval');
});

test('not-modified completion preserves the baseline and failure never erases it', async () => {
  const reserved = await asService(() => query(
    'select * from public.dlkt_info_reserve_source_acquisition($1,$2,$3::timestamptz,$4)',
    [SOURCE, WORKER_ONE, '2026-11-11T20:31:00.000Z', 120],
  ));
  assert.equal(reserved.rows[0].allowed, true);
  const unchanged = await asService(() => query(`
    select * from public.dlkt_info_complete_source_acquisition(
      $1,$2::uuid,$3,'not_modified',null,null,null,$4,null,null,$5::timestamptz
    )
  `, [SOURCE, reserved.rows[0].attempt_id, WORKER_ONE, '"etag-two"', '2026-11-11T20:31:10.000Z']));
  assert.equal(unchanged.rows[0].checkpoint_version, 1);
  assert.deepEqual(unchanged.rows[0].checkpoint, { version: 'checkpoint-1', entries: [] });
  assert.equal(unchanged.rows[0].body_hash, HASH_A);
  assert.equal(unchanged.rows[0].etag, '"etag-two"');

  const next = await asService(() => query(
    'select * from public.dlkt_info_reserve_source_acquisition($1,$2,$3::timestamptz,$4)',
    [SOURCE, WORKER_ONE, '2026-11-11T21:02:00.000Z', 120],
  ));
  const failed = await asService(() => query(`
    select * from public.dlkt_info_complete_source_acquisition(
      $1,$2::uuid,$3,'failed',null,null,null,null,null,$4,$5::timestamptz
    )
  `, [SOURCE, next.rows[0].attempt_id, WORKER_ONE, 'PROVIDER_TIMEOUT', '2026-11-11T21:02:10.000Z']));
  assert.equal(failed.rows[0].checkpoint_version, 1);
  assert.deepEqual(failed.rows[0].checkpoint, { version: 'checkpoint-1', entries: [] });
  assert.equal(failed.rows[0].consecutive_failures, 1);
});

test('stale completion, daily overflow and event mutation are blocked', async () => {
  await assert.rejects(() => asService(() => query(`
    select * from public.dlkt_info_complete_source_acquisition(
      $1,$2::uuid,$3,'failed',null,null,null,null,null,'STALE',$4::timestamptz
    )
  `, [SOURCE, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', WORKER_ONE, '2026-11-11T21:02:20.000Z'])), /DLKT_INFO_ACQUISITION_LEASE_INVALID/u);

  await query(`
    update dlkt_info_private.source_acquisition_state
    set attempts_today=48, next_eligible_at=null, active_attempt_id=null,
      lease_owner=null, lease_expires_at=null
    where source_key=$1
  `, [SOURCE]);
  const limited = await asService(() => query(
    'select * from public.dlkt_info_reserve_source_acquisition($1,$2,$3::timestamptz,$4)',
    [SOURCE, WORKER_ONE, '2026-11-11T22:00:00.000Z', 120],
  ));
  assert.equal(limited.rows[0].allowed, false);
  assert.equal(limited.rows[0].reason, 'daily-limit');

  await assert.rejects(() => query(
    "update dlkt_info_private.source_acquisition_events set metadata='{}'::jsonb",
  ), /DLKT_INFO_APPEND_ONLY/u);
});
