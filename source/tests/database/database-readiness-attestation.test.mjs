import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const FINGERPRINT = 'ef03f90d229d089f8871c64b996994c79c65d0e1e3a0f8e2b0bb08dc2d6f6dec';
const REVISION = '20261122200813_dlkt_info_news_corpus';
const REPAIR_REVISION = '20261119142617_dlkt_info_public_acl_attestation';
let db;
let beforeRepair;
let originalAuthenticatedTruncateSucceeded = false;
let defaultAclBeforeRepair;
let serverVersion;

async function readiness(role = 'anon') {
  await db.exec(`reset role; set role ${role};`);
  try { return (await db.query('select public.dlkt_info_read_database_readiness() readiness')).rows[0].readiness; }
  finally { await db.exec('reset role'); }
}

async function drift(sql, check) {
  await db.exec('begin');
  try {
    await db.exec(sql);
    const value = await readiness();
    assert.equal(value.ready, false);
    assert.equal(value.activationReceipt, null);
    assert.equal(value.checks[check], false);
  } finally { await db.exec('reset role; rollback'); }
}

before(async () => {
  db = new PGlite(); await db.waitReady;
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit bypassrls;
    create role qa_acl_inherited;
    alter default privileges in schema public grant all privileges on tables to public, anon, authenticated;
    alter default privileges in schema public grant all privileges on sequences to public, anon, authenticated;
    create table public.qa_unrelated_acl (id integer);
    create sequence public.qa_unrelated_acl_seq;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
  `);
  serverVersion = Number((await db.query("select current_setting('server_version_num') version")).rows[0].version);
  for (const file of (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    if (file === `${REPAIR_REVISION}.sql`) {
      // Seed real ACL drift into the original nine-migration schema. No fixture
      // mocks PostgreSQL privilege answers or the original readiness function.
      await db.exec(`
        grant select (id), insert (id), update (display_name), references (id) on public.dlkt_info_profiles to anon;
        grant select (id) on public.dlkt_info_profiles to public;
        grant select (owner_id) on public.dlkt_info_briefing_cards to authenticated with grant option;
        grant select on public.dlkt_info_profiles to authenticated with grant option;
        grant update on sequence public.dlkt_info_briefing_events_id_seq to service_role with grant option;
        grant select on public.dlkt_info_profiles to service_role with grant option;
      `);
      beforeRepair = await readiness();
      defaultAclBeforeRepair = (await db.query('select defaclrole, defaclnamespace, defaclobjtype, defaclacl::text acl from pg_default_acl order by 1, 2, 3')).rows;
      await db.exec('begin; set role authenticated');
      try {
        await db.exec('truncate table public.dlkt_info_briefing_events');
        originalAuthenticatedTruncateSucceeded = true;
      } finally { await db.exec('reset role; rollback'); }
    }
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }
});
after(async () => { await db.exec('reset role'); await db.close(); });

test('healthy database returns exact attestation and activation receipt', async () => {
  const value = await readiness();
  assert.equal(value.version, 'dlkt-info-database-readiness-2');
  assert.equal(value.ready, true);
  assert.equal(value.checks.publicDataPermissions, true);
  assert.equal(value.schemaFingerprint, FINGERPRINT);
  assert.equal(value.schemaRevision, REVISION);
  assert.equal(value.activationReceipt, createHash('sha256').update(`${value.instanceId}:${FINGERPRINT}:${REVISION}`).digest('hex'));
  assert.equal(Object.values(value.checks).every(Boolean), true);
  assert.deepEqual(value.counts, {
    relationsExpected: 33, relationsPresent: 33, relationsTotal: 33,
    functionsExpected: 67, functionsPresent: 67, functionsTotal: 67,
    rlsExpected: 21, rlsPresent: 21, rlsTotal: 21,
    policiesExpected: 29, policiesPresent: 29, policiesTotal: 29,
    triggersExpected: 34, triggersPresent: 34, triggersTotal: 34,
  });
});

test('private validator permissions are least-privilege and explicit', async () => {
  await db.exec('set role anon');
  await assert.rejects(db.query("select dlkt_info_private.is_valid_text_collection(array['x']::text[], 10, 10)"), /permission denied/u);
  await db.exec('reset role; set role authenticated');
  assert.equal((await db.query("select dlkt_info_private.is_valid_text_collection(array['x']::text[], 10, 10) ok")).rows[0].ok, true);
  await db.exec('reset role; set role service_role');
  assert.equal((await db.query("select dlkt_info_private.is_valid_text_collection(array['x']::text[], 10, 10) ok")).rows[0].ok, true);
  await db.exec('reset role');
});

test('RLS drift blocks activation', async () => {
  await drift('alter table public.dlkt_info_profiles disable row level security', 'rls');
});

test('policy drift blocks activation', async () => {
  await drift('drop policy dlkt_info_profiles_select_own on public.dlkt_info_profiles', 'policies');
});

test('private function privilege drift blocks activation', async () => {
  await drift('grant execute on function dlkt_info_private.is_valid_text_collection(text[], integer, integer) to anon', 'privateFunctionPermissions');
});

test('unexpected product table blocks activation', async () => {
  await drift('create table public.dlkt_info_unexpected (id integer)', 'noUnexpectedObjects');
});

test('unexpected public RPC blocks activation', async () => {
  await drift("create function public.dlkt_info_unexpected_rpc() returns integer language sql stable set search_path=pg_catalog as $$ select 1 $$", 'noUnexpectedObjects');
});

test('new migration repairs broad defaults and explicit column grants that original readiness missed', async () => {
  assert.equal(beforeRepair.version, 'dlkt-info-database-readiness-1');
  assert.equal(beforeRepair.ready, true);
  assert.equal(typeof beforeRepair.activationReceipt, 'string');
  assert.equal(Object.hasOwn(beforeRepair.checks, 'publicDataPermissions'), false);
  assert.equal(originalAuthenticatedTruncateSucceeded, true);
  assert.deepEqual((await db.query('select defaclrole, defaclnamespace, defaclobjtype, defaclacl::text acl from pg_default_acl order by 1, 2, 3')).rows, defaultAclBeforeRepair);
  const explicitColumns = await db.query(`
    select count(*)::integer count
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(case when cardinality(a.attacl) > 0 then a.attacl end) acl
    where n.nspname = 'public' and c.relname like 'dlkt_info_%'
      and a.attnum > 0 and not a.attisdropped
      and (acl.grantee = 0 or acl.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))
  `);
  assert.equal(explicitColumns.rows[0].count, 0);
  assert.equal((await readiness()).ready, true);
});

test('unrelated objects and trusted service administrative privileges are preserved', async () => {
  const row = (await db.query(`select
    has_table_privilege('anon', 'public.qa_unrelated_acl', 'TRUNCATE') unrelated_table,
    has_sequence_privilege('authenticated', 'public.qa_unrelated_acl_seq', 'USAGE') unrelated_sequence,
    has_table_privilege('service_role', 'public.dlkt_info_profiles', 'SELECT WITH GRANT OPTION') service_table_option,
    has_sequence_privilege('service_role', 'public.dlkt_info_briefing_events_id_seq', 'UPDATE WITH GRANT OPTION') service_sequence_extra
  `)).rows[0];
  assert.deepEqual(row, { unrelated_table: true, unrelated_sequence: true, service_table_option: true, service_sequence_extra: true });
  assert.equal((await readiness()).checks.publicDataPermissions, true);
});

test('authenticated and anonymous TRUNCATE is denied by PostgreSQL after repair', async () => {
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`set role ${role}`);
    try { await assert.rejects(db.exec('truncate table public.dlkt_info_briefing_events'), /permission denied/u); }
    finally { await db.exec('reset role'); }
  }
});

test('authenticated table operations match the existing product contract exactly', async () => {
  // Deliberately independent of the manifest fixture: these are the original
  // product grants, including profile DELETE denial and four read-only tables.
  const expected = {
    dlkt_info_profiles: ['SELECT', 'INSERT', 'UPDATE'],
    dlkt_info_briefings: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    dlkt_info_interest_rules: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    dlkt_info_delivery_endpoints: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    dlkt_info_briefing_targets: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    dlkt_info_user_memory: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    dlkt_info_briefing_runs: ['SELECT'],
    dlkt_info_briefing_cards: ['SELECT'],
    dlkt_info_delivery_receipts: ['SELECT'],
    dlkt_info_briefing_events: ['SELECT'],
  };
  const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', ...(serverVersion >= 170000 ? ['MAINTAIN'] : [])];
  for (const [table, allowed] of Object.entries(expected)) {
    for (const privilege of privileges) {
      const row = (await db.query(`select
        has_table_privilege('authenticated', $1, $2) authenticated,
        has_table_privilege('authenticated', $1, $3) grant_option,
        has_table_privilege('anon', $1, $2) anonymous,
        has_table_privilege('service_role', $1, $2) service
      `, [`public.${table}`, privilege, `${privilege} WITH GRANT OPTION`])).rows[0];
      assert.deepEqual(row, { authenticated: allowed.includes(privilege), grant_option: false, anonymous: false, service: true }, `${table}:${privilege}`);
    }
  }
});

const publicAclDrift = [
  ['PUBLIC inherited SELECT', 'grant select on public.dlkt_info_profiles to public'],
  ['anonymous TRUNCATE', 'grant truncate on public.dlkt_info_profiles to anon'],
  ['authenticated TRUNCATE', 'grant truncate on public.dlkt_info_profiles to authenticated'],
  ['authenticated REFERENCES', 'grant references on public.dlkt_info_profiles to authenticated'],
  ['authenticated TRIGGER', 'grant trigger on public.dlkt_info_profiles to authenticated'],
  ['profile DELETE', 'grant delete on public.dlkt_info_profiles to authenticated'],
  ['read-only INSERT', 'grant insert on public.dlkt_info_briefing_events to authenticated'],
  ['missing authenticated SELECT', 'revoke select on public.dlkt_info_profiles from authenticated'],
  ['allowed table operation with grant option', 'grant select on public.dlkt_info_profiles to authenticated with grant option'],
  ['anonymous column SELECT', 'grant select (id) on public.dlkt_info_profiles to anon'],
  ['PUBLIC column REFERENCES', 'grant references (id) on public.dlkt_info_profiles to public'],
  ['read-only column UPDATE', 'grant update (owner_id) on public.dlkt_info_briefing_cards to authenticated'],
  ['column grant option', 'grant select (id) on public.dlkt_info_profiles to authenticated with grant option'],
  ['redundant explicit column grant', 'grant select (id) on public.dlkt_info_profiles to authenticated'],
  ['PUBLIC sequence USAGE', 'grant usage on sequence public.dlkt_info_briefing_events_id_seq to public'],
  ['authenticated sequence SELECT', 'grant select on sequence public.dlkt_info_briefing_events_id_seq to authenticated'],
  ['anonymous sequence UPDATE with grant option', 'grant update on sequence public.dlkt_info_briefing_events_id_seq to anon with grant option'],
  ['missing required service sequence SELECT', 'revoke select on sequence public.dlkt_info_briefing_events_id_seq from service_role'],
  ['missing required service table INSERT', 'revoke insert on public.dlkt_info_profiles from service_role'],
  ['missing event identity sequence', 'alter table public.dlkt_info_briefing_events alter column id drop identity'],
  ['inherited table TRUNCATE', 'alter role authenticated inherit; grant qa_acl_inherited to authenticated; grant truncate on public.dlkt_info_profiles to qa_acl_inherited'],
  ['inherited redundant column grant', 'alter role authenticated inherit; grant qa_acl_inherited to authenticated; grant select (id) on public.dlkt_info_profiles to qa_acl_inherited'],
];
for (const [name, sql] of publicAclDrift) {
  test(`${name} drift blocks activation and removes the receipt`, async () => {
    await drift(sql, 'publicDataPermissions');
  });
}

test('MAINTAIN privilege drift blocks activation on PostgreSQL 17 and newer', async (t) => {
  if (serverVersion < 170000) { t.skip('MAINTAIN does not exist before PostgreSQL 17'); return; }
  await drift('grant maintain on public.dlkt_info_profiles to authenticated', 'publicDataPermissions');
});

for (const [name, sql] of [
  ['private TRUNCATE', 'grant truncate on dlkt_info_private.system_identity to authenticated'],
  ['private REFERENCES', 'grant references on dlkt_info_private.system_identity to anon'],
  ['private column SELECT', 'grant select (instance_id) on dlkt_info_private.system_identity to authenticated'],
  ['private column grant option', 'grant select (instance_id) on dlkt_info_private.system_identity to authenticated with grant option'],
]) {
  test(`${name} drift is rejected by the existing privateTables boundary`, async () => {
    await drift(sql, 'privateTables');
  });
}
