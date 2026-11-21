import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
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
`);
try {
  const files = (await readdir('supabase/migrations')).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  const result = await db.query(`
    select
      (select count(*)::int from information_schema.tables
       where (table_schema in ('public','dlkt_info_private') and table_name like 'dlkt_info%')
          or table_schema='dlkt_info_private') as tables,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in (
         'dlkt_info_read_companion_configuration', 'dlkt_info_save_companion_configuration'
       )) as companion_functions,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in (
         'dlkt_info_reserve_source_acquisition', 'dlkt_info_complete_source_acquisition',
         'dlkt_info_read_source_acquisition', 'dlkt_info_commit_source_acquisition'
       )) as acquisition_functions,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in (
         'dlkt_info_claim_internal_delta_jobs', 'dlkt_info_complete_internal_delta_trial',
         'dlkt_info_fail_internal_delta_job', 'dlkt_info_review_internal_delta_card',
         'dlkt_info_read_internal_delta_review_queue'
       )) as trial_functions,
      (select count(*)::int from dlkt_info_private.source_registry
       where source_key like 'eu-eurlex-%' and status='active') as eu_sources,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in (
         'dlkt_info_read_system_identity', 'dlkt_info_read_database_readiness'
       )) as provisioning_functions
  `);
  console.log(JSON.stringify(result.rows));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
await db.close();
