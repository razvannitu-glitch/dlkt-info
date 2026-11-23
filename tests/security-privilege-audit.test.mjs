import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {readFile, readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

/**
 * Regression for the intentionally narrow public SECURITY DEFINER surface.
 * Uses the actual ordered SQL migrations, not mocked permissions or fixtures.
 * No connection to production and no real credentials.
 */
const ANON_DEFINERS = [
  'dlkt_info_capture_shared_card',
  'dlkt_info_claim_public_refresh',
  'dlkt_info_fail_public_refresh',
  'dlkt_info_find_news_corpus_article',
  'dlkt_info_publish_public_snapshot',
  'dlkt_info_read_database_readiness',
  'dlkt_info_read_news_corpus',
  'dlkt_info_read_public_snapshot',
  'dlkt_info_read_system_identity',
  'dlkt_info_stage_news_corpus',
  'dlkt_info_upsert_news_candidates',
].sort();
const AUTH_DEFINERS = [
  ...ANON_DEFINERS,
  'dlkt_info_read_companion_configuration',
  'dlkt_info_save_companion_configuration',
].sort();
const SHARED_KEY_GUARDED = [
  'dlkt_info_capture_shared_card',
  'dlkt_info_claim_public_refresh',
  'dlkt_info_fail_public_refresh',
  'dlkt_info_find_news_corpus_article',
  'dlkt_info_publish_public_snapshot',
  'dlkt_info_read_news_corpus',
  'dlkt_info_stage_news_corpus',
  'dlkt_info_upsert_news_candidates',
];
const USER_BOUND = [
  'dlkt_info_read_companion_configuration',
  'dlkt_info_save_companion_configuration',
];
let db;

before(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec([
    'create role anon noinherit;',
    'create role authenticated noinherit;',
    'create role service_role noinherit bypassrls;',
    'create schema auth;',
    "create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}'::jsonb);",
    "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;",
    "create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;",
    'grant usage on schema auth to anon, authenticated, service_role;',
    'grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;',
  ].join('\n'));
  const migrations=(await readdir('source/supabase/migrations'))
    .filter(file=>file.endsWith('.sql')).sort();
  assert.ok(migrations.length>=16,'Cannot audit incomplete migration history');
  for(const file of migrations){
    const sql=await readFile('source/supabase/migrations/'+file,'utf8');
    await db.exec(sql);
  }
});
after(async () => {
  if(db){await db.exec('reset role');await db.close();}
});

test('anonymous and authenticated privileged RPC allowlists are exact', async () => {
  const result=await db.query([
    'select p.proname, p.proconfig,',
    "has_function_privilege('anon',p.oid,'EXECUTE') as anonymous,",
    "has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated",
    'from pg_proc p join pg_namespace n on n.oid=p.pronamespace',
    "where n.nspname='public' and p.proname like 'dlkt_info_%' and p.prosecdef",
    'order by p.proname',
  ].join(' '));
  const anonymous=result.rows.filter(row=>row.anonymous).map(row=>row.proname).sort();
  const authenticated=result.rows.filter(row=>row.authenticated).map(row=>row.proname).sort();
  assert.deepEqual(anonymous,ANON_DEFINERS,'Unexpected anonymous privileged RPC');
  assert.deepEqual(authenticated,AUTH_DEFINERS,'Unexpected authenticated privileged RPC');
  for(const row of result.rows){
    assert.ok(String(row.proconfig).includes('search_path='),'Unpinned SECURITY DEFINER search_path: '+row.proname);
  }
});

test('every privileged public reader/writer uses its explicit guard', async () => {
  const result=await db.query([
    'select p.proname, pg_get_functiondef(p.oid) as definition',
    'from pg_proc p join pg_namespace n on n.oid=p.pronamespace',
    "where n.nspname='public' and p.proname like 'dlkt_info_%' and p.prosecdef",
  ].join(' '));
  const byName=new Map(result.rows.map(row=>[row.proname,row.definition]));
  for(const name of SHARED_KEY_GUARDED){
    const definition=byName.get(name);
    assert.equal(typeof definition,'string','Missing privileged RPC '+name);
    assert.match(definition,/require_public_refresh_writer|x-dlkt-share-write/iu,'Missing shared-key guard: '+name);
  }
  for(const name of USER_BOUND){
    const definition=byName.get(name);
    assert.equal(typeof definition,'string','Missing user-owned RPC '+name);
    assert.match(definition,/auth\.uid\(\)/iu,'Missing owner identity guard: '+name);
  }
});

test('anonymous RPC mutations reject missing shared write key with SQLSTATE 42501', async () => {
  await db.query("select set_config('request.headers','{}',false)");
  const attempts=[
    "select public.dlkt_info_claim_public_refresh('11111111-1111-4111-8111-111111111111'::uuid,'{\"kind\":\"manual\"}'::jsonb)",
    "select public.dlkt_info_fail_public_refresh('11111111-1111-4111-8111-111111111111'::uuid,1,'timeout')",
    "select public.dlkt_info_publish_public_snapshot('11111111-1111-4111-8111-111111111111'::uuid,1,'{}'::jsonb,repeat('0',64))",
    "select public.dlkt_info_stage_news_corpus('11111111-1111-4111-8111-111111111111'::uuid,1,'{}'::jsonb,repeat('0',64),null)",
    "select public.dlkt_info_upsert_news_candidates('[]'::jsonb)",
    "select public.dlkt_info_capture_shared_card('{}'::jsonb,now(),now()+interval '1 hour',false)",
  ];
  await db.exec('set role anon');
  try{
    for(const sql of attempts){
      await assert.rejects(db.query(sql),{code:'42501'},sql);
    }
  }finally{await db.exec('reset role');}
  const result=await db.query('select revision, fence from dlkt_info_private.public_refresh_state where singleton');
  assert.deepEqual(result.rows,[{revision:0,fence:0}],'Rejected writes must not claim or publish');
});

test('private data tables remain unreachable by anonymous and authenticated clients', async () => {
  const result=await db.query([
    "select c.relname, c.relrowsecurity,",
    "has_table_privilege('anon',c.oid,'SELECT') as anon_read,",
    "has_table_privilege('authenticated',c.oid,'SELECT') as auth_read,",
    "has_table_privilege('anon',c.oid,'INSERT') as anon_insert,",
    "has_table_privilege('authenticated',c.oid,'UPDATE') as auth_update",
    'from pg_class c join pg_namespace n on n.oid=c.relnamespace',
    "where n.nspname='dlkt_info_private' and c.relkind in ('r','p')",
    'order by c.relname',
  ].join(' '));
  assert.ok(result.rows.length>=15,'Private schema unexpectedly empty');
  for(const row of result.rows){
    assert.equal(row.anon_read,false,'Anonymous private read: '+row.relname);
    assert.equal(row.auth_read,false,'Authenticated private read: '+row.relname);
    assert.equal(row.anon_insert,false,'Anonymous private write: '+row.relname);
    assert.equal(row.auth_update,false,'Authenticated private write: '+row.relname);
  }
});

test('authenticated owner-scoped public tables retain row-level security', async () => {
  const personal=[
    'dlkt_info_profiles','dlkt_info_briefings','dlkt_info_interest_rules',
    'dlkt_info_user_memory','dlkt_info_delivery_endpoints','dlkt_info_briefing_targets',
    'dlkt_info_briefing_cards','dlkt_info_briefing_events','dlkt_info_briefing_runs',
    'dlkt_info_delivery_receipts',
  ];
  const query=await db.query([
    'select c.relname,c.relrowsecurity from pg_class c',
    'join pg_namespace n on n.oid=c.relnamespace',
    "where n.nspname='public' and c.relname like 'dlkt_info_%' and c.relkind='r'",
  ].join(' '));
  const map=new Map(query.rows.map(row=>[row.relname,row.relrowsecurity]));
  for(const name of personal)assert.equal(map.get(name),true,'Missing owner-table RLS: '+name);
});
