import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const USER_ONE = '11111111-1111-4111-8111-111111111111';
const USER_TWO = '22222222-2222-4222-8222-222222222222';
const DUE_AT = '2026-11-11T16:00:00.000Z';
const CLAIM_AT = '2026-11-11T16:05:00.000Z';
const WORKER_ONE = 'worker:data-foundation:one';
const WORKER_TWO = 'worker:data-foundation:two';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

let db;
let briefingOne;
let briefingTwo;
let endpointOne;
let runOne;
let deliveryJob;

async function query(text, params = []) {
  return db.query(text, params);
}

async function resetRole() {
  await db.exec('reset role;');
  await query("select set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)");
}

async function asRole(role, userId, operation) {
  await resetRole();
  await query(
    "select set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.sub', $2, false)",
    [role, userId ?? ''],
  );
  await db.exec(`set role ${role};`);
  try {
    return await operation();
  } finally {
    await resetRole();
  }
}

async function asUser(userId, operation) {
  return asRole('authenticated', userId, operation);
}

async function asService(operation) {
  return asRole('service_role', '', operation);
}

before(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role', true), '')
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    grant execute on function auth.role() to anon, authenticated, service_role;
  `);
  const migration = await readFile(
    'supabase/migrations/20261111184500_dlkt_info_data_delivery_foundation.sql',
    'utf8',
  );
  await db.exec(migration);
  await query(
    `insert into auth.users (id, raw_user_meta_data) values
      ($1, '{"display_name":"R One","locale":"en","timezone":"Europe/Bucharest"}'::jsonb),
      ($2, '{"display_name":"R Two","locale":"ro","timezone":"Europe/Bucharest"}'::jsonb)`,
    [USER_ONE, USER_TWO],
  );
});

after(async () => {
  await resetRole();
  await db.close();
});

test('migration creates an isolated data and delivery surface', async () => {
  const tables = await query(`
    select table_schema, table_name
    from information_schema.tables
    where table_schema = 'dlkt_info_private'
       or table_name like 'dlkt_info_%'
    order by table_schema, table_name
  `);
  assert.equal(tables.rows.length, 17);
  assert.ok(tables.rows.some((row) => row.table_name === 'delivery_outbox'));
  assert.ok(tables.rows.some((row) => row.table_name === 'claims'));
  assert.ok(tables.rows.some((row) => row.table_name === 'dlkt_info_briefing_runs'));

  const foreignSchemas = await query(`
    select count(*)::int as count
    from information_schema.tables
    where table_schema in ('veciniada', 'inphomaniac_private')
  `);
  assert.equal(foreignSchemas.rows[0].count, 0);
});

test('profile creation stores no duplicated email and protects commercial fields', async () => {
  const profiles = await query(`select * from public.dlkt_info_profiles order by id`);
  assert.equal(profiles.rows.length, 2);
  assert.equal(Object.hasOwn(profiles.rows[0], 'email'), false);
  assert.equal(profiles.rows[0].plan, 'free');
  assert.equal(profiles.rows[0].data_region, 'eu-central-1');

  await asUser(USER_ONE, async () => {
    const own = await query(`select id, display_name from public.dlkt_info_profiles`);
    assert.deepEqual(own.rows, [{ id: USER_ONE, display_name: 'R One' }]);
    await assert.rejects(
      query(`update public.dlkt_info_profiles set plan = 'business' where id = $1`, [USER_ONE]),
      /DLKT_INFO_PROFILE_SYSTEM_FIELDS_FORBIDDEN/u,
    );
    await query(`update public.dlkt_info_profiles set display_name = 'R One Updated' where id = $1`, [USER_ONE]);
  });
});

test('timezone scheduling is deterministic across European DST', async () => {
  const spring = await query(
    `select public.dlkt_info_next_delivery_at('Europe/Bucharest', time '08:00', array[1,2,3,4,5,6,7]::smallint[], $1::timestamptz) as next`,
    ['2026-03-29T00:30:00.000Z'],
  );
  assert.equal(new Date(spring.rows[0].next).toISOString(), '2026-03-29T05:00:00.000Z');

  const autumn = await query(
    `select public.dlkt_info_next_delivery_at('Europe/Bucharest', time '08:00', array[1,2,3,4,5,6,7]::smallint[], $1::timestamptz) as next`,
    ['2026-10-25T01:30:00.000Z'],
  );
  assert.equal(new Date(autumn.rows[0].next).toISOString(), '2026-10-25T06:00:00.000Z');
});

test('RLS isolates briefing definitions and creates a web target automatically', async () => {
  briefingOne = await asUser(USER_ONE, async () => {
    const inserted = await query(
      `insert into public.dlkt_info_briefings (
        owner_id, name, timezone, delivery_local_time, weekdays, max_cards, status
      ) values ($1, 'Morning', 'Europe/Bucharest', time '08:00', array[1,2,3,4,5,6,7]::smallint[], 5, 'active')
      returning id, owner_id, version, next_delivery_at`,
      [USER_ONE],
    );
    assert.equal(inserted.rows[0].owner_id, USER_ONE);
    assert.equal(inserted.rows[0].version, 1);
    assert.ok(inserted.rows[0].next_delivery_at);

    const targets = await query(
      `select channel, endpoint_id, is_enabled from public.dlkt_info_briefing_targets where briefing_id = $1`,
      [inserted.rows[0].id],
    );
    assert.deepEqual(targets.rows, [{ channel: 'web', endpoint_id: null, is_enabled: true }]);

    await assert.rejects(
      query(
        `insert into public.dlkt_info_briefings (owner_id, name, status) values ($1, 'Illegal', 'draft')`,
        [USER_TWO],
      ),
      /row-level security|violates row-level/u,
    );
    return inserted.rows[0].id;
  });

  await asUser(USER_TWO, async () => {
    const hidden = await query(`select id from public.dlkt_info_briefings where id = $1`, [briefingOne]);
    assert.equal(hidden.rows.length, 0);
    const inserted = await query(
      `insert into public.dlkt_info_briefings (owner_id, name, timezone, status)
       values ($1, 'Evening', 'Europe/Bucharest', 'active') returning id`,
      [USER_TWO],
    );
    briefingTwo = inserted.rows[0].id;
  });
});

test('interest rules and cross-device memory remain owner scoped', async () => {
  await asUser(USER_ONE, async () => {
    await query(
      `insert into public.dlkt_info_interest_rules (
        briefing_id, name, include_topics, exclude_topics, languages, min_materiality, weight, position
      ) values ($1, 'Core interests', array['technology','business'], array['celebrity'], array['en'], 'medium', 3, 1)`,
      [briefingOne],
    );
    await query(
      `insert into public.dlkt_info_user_memory (owner_id, memory_key, memory_type, state)
       values ($1, 'topic:technology', 'pinned-topic', '{"pinned":true}'::jsonb)`,
      [USER_ONE],
    );
    assert.equal((await query(`select count(*)::int as count from public.dlkt_info_interest_rules`)).rows[0].count, 1);
    assert.equal((await query(`select count(*)::int as count from public.dlkt_info_user_memory`)).rows[0].count, 1);
  });

  await asUser(USER_TWO, async () => {
    assert.equal((await query(`select count(*)::int as count from public.dlkt_info_interest_rules`)).rows[0].count, 0);
    assert.equal((await query(`select count(*)::int as count from public.dlkt_info_user_memory`)).rows[0].count, 0);
  });
});

test('delivery destinations keep raw routing data server-side and require service verification', async () => {
  endpointOne = await asUser(USER_ONE, async () => {
    await assert.rejects(
      query(
        `insert into public.dlkt_info_delivery_endpoints (
          owner_id, channel, label, destination_hash, state, verified_at
        ) values ($1, 'email', 'Primary', $2, 'verified', clock_timestamp())`,
        [USER_ONE, HASH_B],
      ),
      /DLKT_INFO_ENDPOINT_SYSTEM_FIELDS_FORBIDDEN/u,
    );

    const inserted = await query(
      `insert into public.dlkt_info_delivery_endpoints (
        owner_id, channel, label, destination_hash
      ) values ($1, 'email', 'Primary', $2)
      returning *`,
      [USER_ONE, HASH_B],
    );
    assert.equal(Object.hasOwn(inserted.rows[0], 'secret_ref'), false);

    await query(
      `insert into public.dlkt_info_briefing_targets (briefing_id, channel, endpoint_id)
       values ($1, 'email', $2)`,
      [briefingOne, inserted.rows[0].id],
    );
    return inserted.rows[0].id;
  });

  await assert.rejects(
    asUser(USER_TWO, () => query(
      `insert into public.dlkt_info_briefing_targets (briefing_id, channel, endpoint_id)
       values ($1, 'email', $2)`,
      [briefingTwo, endpointOne],
    )),
    /DLKT_INFO_TARGET_ENDPOINT_MISMATCH|row-level security/u,
  );

  await asService(async () => {
    const verified = await query(
      `select * from public.dlkt_info_verify_delivery_endpoint($1, $2, $3::timestamptz)`,
      [endpointOne, 'vault://dlkt-info/delivery/endpoint-one', CLAIM_AT],
    );
    assert.equal(verified.rows[0].state, 'verified');
    const secret = await query(
      `select secret_ref, secret_version from dlkt_info_private.delivery_endpoint_secrets where endpoint_id = $1`,
      [endpointOne],
    );
    assert.deepEqual(secret.rows, [{ secret_ref: 'vault://dlkt-info/delivery/endpoint-one', secret_version: 1 }]);
  });
});

test('scheduler is service-only, advances schedule once and creates an idempotent run', async () => {
  await resetRole();
  await query(`update public.dlkt_info_briefings set next_delivery_at = $2 where id = $1`, [briefingOne, DUE_AT]);

  await assert.rejects(
    asUser(USER_ONE, () => query(
      `select * from public.dlkt_info_claim_due_briefings($1, 10, $2::timestamptz, 120)`,
      [WORKER_ONE, CLAIM_AT],
    )),
    /permission denied|DLKT_INFO_SERVICE_ROLE_REQUIRED/u,
  );

  await asService(async () => {
    const claimed = await query(
      `select * from public.dlkt_info_claim_due_briefings($1, 10, $2::timestamptz, 120)`,
      [WORKER_ONE, CLAIM_AT],
    );
    assert.equal(claimed.rows.length, 1);
    runOne = claimed.rows[0].run_id;
    assert.equal(claimed.rows[0].briefing_id, briefingOne);
    assert.equal(claimed.rows[0].attempt_no, 1);
    assert.equal(claimed.rows[0].max_cards, 5);

    const duplicate = await query(
      `select * from public.dlkt_info_claim_due_briefings($1, 10, $2::timestamptz, 120)`,
      [WORKER_ONE, CLAIM_AT],
    );
    assert.equal(duplicate.rows.length, 0);

    const schedule = await query(
      `select next_delivery_at, last_scheduled_at from public.dlkt_info_briefings where id = $1`,
      [briefingOne],
    );
    assert.equal(new Date(schedule.rows[0].last_scheduled_at).toISOString(), DUE_AT);
    assert.ok(new Date(schedule.rows[0].next_delivery_at).getTime() > new Date(DUE_AT).getTime());

    const runs = await query(
      `select count(*)::int as count from public.dlkt_info_briefing_runs where briefing_id = $1 and scheduled_for = $2`,
      [briefingOne, DUE_AT],
    );
    assert.equal(runs.rows[0].count, 1);
  });
});

test('finalization is atomic, finite and idempotently enqueues verified targets', async () => {
  const createdAt = '2026-11-11T16:05:00.000Z';
  const expiresAt = '2026-11-12T16:05:00.000Z';
  const briefing = {
    definitionId: briefingOne,
    omittedByLimit: 3,
    cards: [
      {
        id: 'card-technology-1',
        deltaId: 'delta-technology-1',
        topicId: 'technology',
        entity: { id: 'company:demo-ai' },
        kind: 'changed',
        title: 'Demo AI: material update',
        direct: 'public launch state changed from waitlist to available.',
        whyItMatters: 'This can affect product access.',
        changedSince: 'Updated since the previous briefing.',
        materiality: 'high',
        trust: 'confirmed',
        score: 178.833,
        blockedDependencies: [],
        sources: [{ sourceId: 'official', title: 'Synthetic source', url: 'https://example.com/update' }],
        createdAt,
        expiresAt,
      },
      {
        id: 'card-supply-1',
        deltaId: 'delta-supply-1',
        topicId: 'supply',
        entity: { id: 'product:demo-device' },
        kind: 'conflicted',
        title: 'Demo Device: sources disagree',
        direct: 'Current evidence reports incompatible availability.',
        whyItMatters: 'Procurement remains blocked.',
        changedSince: 'A contradiction appeared.',
        materiality: 'critical',
        trust: 'conflicting',
        score: 190.25,
        blockedDependencies: ['procurement'],
        sources: [
          { sourceId: 'official', title: 'Synthetic official source', url: 'https://example.com/official' },
          { sourceId: 'secondary', title: 'Synthetic secondary source', url: 'https://example.com/secondary' },
        ],
        createdAt,
        expiresAt,
      },
    ],
  };

  await asService(async () => {
    const finalized = await query(
      `select * from public.dlkt_info_finalize_run($1, $2, $3::jsonb, '0.1.0', '0.8.8', $4, $5::timestamptz)`,
      [runOne, WORKER_ONE, JSON.stringify(briefing), HASH_A, CLAIM_AT],
    );
    assert.deepEqual(finalized.rows, [{
      run_id: runOne,
      status: 'ready',
      card_count: 2,
      contested_count: 1,
      omitted_count: 3,
      outbox_count: 1,
    }]);

    const repeated = await query(
      `select * from public.dlkt_info_finalize_run($1, $2, $3::jsonb, '0.1.0', '0.8.8', $4, $5::timestamptz)`,
      [runOne, WORKER_ONE, JSON.stringify(briefing), HASH_A, CLAIM_AT],
    );
    assert.equal(repeated.rows[0].status, 'ready');
    assert.equal(repeated.rows[0].outbox_count, 0);

    await assert.rejects(
      query(
        `select * from public.dlkt_info_finalize_run($1, $2, $3::jsonb, '0.1.0', '0.8.8', $4, $5::timestamptz)`,
        [runOne, WORKER_ONE, JSON.stringify(briefing), HASH_C, CLAIM_AT],
      ),
      /DLKT_INFO_RUN_ALREADY_FINALIZED/u,
    );

    assert.equal((await query(`select count(*)::int as count from public.dlkt_info_briefing_cards where run_id = $1`, [runOne])).rows[0].count, 2);
    assert.equal((await query(`select count(*)::int as count from dlkt_info_private.delivery_outbox where run_id = $1`, [runOne])).rows[0].count, 1);
  });
});

test('delivery outbox supports bounded retry, receipt history and terminal idempotency', async () => {
  await asService(async () => {
    const jobs = await query(
      `select * from public.dlkt_info_claim_delivery_jobs($1, 10, $2::timestamptz, 120)`,
      [WORKER_TWO, '2026-11-11T16:06:00.000Z'],
    );
    assert.equal(jobs.rows.length, 1);
    deliveryJob = jobs.rows[0].job_id;
    assert.equal(jobs.rows[0].secret_ref, 'vault://dlkt-info/delivery/endpoint-one');
    assert.equal(jobs.rows[0].destination_hash, HASH_B);
    assert.equal(jobs.rows[0].attempt_no, 1);

    const failed = await query(
      `select * from public.dlkt_info_record_delivery_attempt(
        $1, $2, false, null, 'PROVIDER_TIMEOUT', $3::timestamptz, '{"provider":"synthetic"}'::jsonb, $4::timestamptz
      )`,
      [deliveryJob, WORKER_TWO, '2026-11-11T16:10:00.000Z', '2026-11-11T16:07:00.000Z'],
    );
    assert.equal(failed.rows[0].status, 'retry');
    assert.equal(failed.rows[0].terminal, false);

    const retry = await query(
      `select * from public.dlkt_info_claim_delivery_jobs($1, 10, $2::timestamptz, 120)`,
      [WORKER_TWO, '2026-11-11T16:11:00.000Z'],
    );
    assert.equal(retry.rows.length, 1);
    assert.equal(retry.rows[0].job_id, deliveryJob);
    assert.equal(retry.rows[0].attempt_no, 2);

    const delivered = await query(
      `select * from public.dlkt_info_record_delivery_attempt(
        $1, $2, true, 'synthetic-message-001', null, null, '{"provider":"synthetic"}'::jsonb, $3::timestamptz
      )`,
      [deliveryJob, WORKER_TWO, '2026-11-11T16:12:00.000Z'],
    );
    assert.equal(delivered.rows[0].status, 'delivered');
    assert.equal(delivered.rows[0].terminal, true);

    const repeated = await query(
      `select * from public.dlkt_info_record_delivery_attempt(
        $1, $2, true, 'synthetic-message-001', null, null, '{}'::jsonb, $3::timestamptz
      )`,
      [deliveryJob, WORKER_TWO, '2026-11-11T16:13:00.000Z'],
    );
    assert.equal(repeated.rows[0].status, 'delivered');

    const receipts = await query(
      `select attempt_no, status from public.dlkt_info_delivery_receipts where outbox_id = $1 order by attempt_no`,
      [deliveryJob],
    );
    assert.deepEqual(receipts.rows, [
      { attempt_no: 1, status: 'failed' },
      { attempt_no: 2, status: 'delivered' },
    ]);
  });
});

test('expired leases are recovered and queued runs can be reclaimed without duplication', async () => {
  await resetRole();
  await query(`update public.dlkt_info_briefings set next_delivery_at = $2 where id = $1`, [briefingTwo, DUE_AT]);

  let runTwo;
  await asService(async () => {
    const claimed = await query(
      `select * from public.dlkt_info_claim_due_briefings('worker:expired:first', 10, $1::timestamptz, 30)`,
      [CLAIM_AT],
    );
    runTwo = claimed.rows.find((row) => row.briefing_id === briefingTwo)?.run_id;
    assert.ok(runTwo);

    const recovered = await query(
      `select * from public.dlkt_info_recover_expired_leases($1::timestamptz)`,
      ['2026-11-11T16:06:00.000Z'],
    );
    assert.equal(recovered.rows[0].recovered_runs, 1);

    const reclaimed = await query(
      `select * from public.dlkt_info_claim_queued_runs('worker:expired:second', 10, $1::timestamptz, 120)`,
      ['2026-11-11T16:07:00.000Z'],
    );
    assert.equal(reclaimed.rows.length, 1);
    assert.equal(reclaimed.rows[0].run_id, runTwo);
    assert.equal(reclaimed.rows[0].attempt_no, 2);

    const count = await query(
      `select count(*)::int as count from public.dlkt_info_briefing_runs where briefing_id = $1 and scheduled_for = $2`,
      [briefingTwo, DUE_AT],
    );
    assert.equal(count.rows[0].count, 1);
  });
});

test('claims and provenance are immutable and source-version specific', async () => {
  await asService(async () => {
    const source = await query(
      `insert into dlkt_info_private.source_registry (
        source_key, revision, name, origin, authority, role, languages, path_rules,
        automated_access, factual_extraction, commercial_summaries, attribution_required,
        terms_url, reviewed_at, review_expires_at, note,
        min_interval_seconds, max_requests_per_day, timeout_ms, max_bytes
      ) values (
        'demo-official', 1, 'Demo Official', 'https://official.example', 'official', 'company',
        array['en'], '[{"pathnamePrefix":"/updates","claimKinds":["change"]}]'::jsonb,
        'permitted', 'permitted', 'attribution-required', true,
        'https://official.example/terms', clock_timestamp() - interval '1 day', clock_timestamp() + interval '30 days',
        'Synthetic test source.', 3600, 24, 5000, 1000000
      ) returning id`,
    );
    const entity = await query(
      `insert into dlkt_info_private.entities (entity_key, entity_type, canonical_label)
       values ('company:demo', 'company', 'Demo Company') returning id`,
    );
    const claim = await query(
      `insert into dlkt_info_private.claims (
        entity_id, topic_id, kind, predicate, value, materiality, actionability,
        observed_at, valid_from, valid_until, locale, affects, fingerprint
      ) values (
        $1, 'technology', 'change', 'launch state', '"available"'::jsonb, 'high', 0.9,
        clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 day', 'en', array['product-access'], $2
      ) returning id`,
      [entity.rows[0].id, HASH_C],
    );
    await query(
      `insert into dlkt_info_private.claim_evidence (
        claim_id, source_revision_id, url, title, retrieved_at, content_hash
      ) values ($1, $2, 'https://official.example/updates/launch', 'Synthetic launch update', clock_timestamp(), $3)`,
      [claim.rows[0].id, source.rows[0].id, HASH_A],
    );

    await assert.rejects(
      query(`update dlkt_info_private.claims set materiality = 'low' where id = $1`, [claim.rows[0].id]),
      /DLKT_INFO_APPEND_ONLY/u,
    );
    await assert.rejects(
      query(`update dlkt_info_private.claim_evidence set title = 'Changed' where claim_id = $1`, [claim.rows[0].id]),
      /DLKT_INFO_APPEND_ONLY/u,
    );
  });
});

test('output rows are owner-visible, append-only, and account deletion cascades safely', async () => {
  await asUser(USER_ONE, async () => {
    assert.equal((await query(`select count(*)::int as count from public.dlkt_info_briefing_runs`)).rows[0].count, 1);
    assert.equal((await query(`select count(*)::int as count from public.dlkt_info_briefing_cards`)).rows[0].count, 2);
    assert.equal((await query(`select count(*)::int as count from public.dlkt_info_delivery_receipts`)).rows[0].count, 2);
    assert.ok((await query(`select count(*)::int as count from public.dlkt_info_briefing_events`)).rows[0].count >= 4);
  });

  await asUser(USER_TWO, async () => {
    assert.equal((await query(`select count(*)::int as count from public.dlkt_info_briefing_cards`)).rows[0].count, 0);
    assert.equal((await query(`select count(*)::int as count from public.dlkt_info_delivery_receipts`)).rows[0].count, 0);
  });

  await asService(async () => {
    await assert.rejects(
      query(`update public.dlkt_info_briefing_cards set title = 'Mutated' where run_id = $1`, [runOne]),
      /DLKT_INFO_APPEND_ONLY/u,
    );
  });

  await resetRole();
  await query(`delete from auth.users where id = $1`, [USER_ONE]);
  assert.equal((await query(`select count(*)::int as count from public.dlkt_info_profiles where id = $1`, [USER_ONE])).rows[0].count, 0);
  assert.equal((await query(`select count(*)::int as count from public.dlkt_info_briefings where owner_id = $1`, [USER_ONE])).rows[0].count, 0);
  assert.equal((await query(`select count(*)::int as count from public.dlkt_info_briefing_runs where owner_id = $1`, [USER_ONE])).rows[0].count, 0);
  assert.equal((await query(`select count(*)::int as count from public.dlkt_info_briefing_cards where owner_id = $1`, [USER_ONE])).rows[0].count, 0);
  assert.equal((await query(`select count(*)::int as count from public.dlkt_info_delivery_receipts where owner_id = $1`, [USER_ONE])).rows[0].count, 0);
  assert.equal((await query(`select count(*)::int as count from public.dlkt_info_briefing_events where owner_id = $1`, [USER_ONE])).rows[0].count, 0);
});
