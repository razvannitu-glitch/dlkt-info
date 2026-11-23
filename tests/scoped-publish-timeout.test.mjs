import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

let db;
before(async()=>{
  db=new PGlite();await db.waitReady;
  await db.exec("create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'::jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;");
  for(const file of (await readdir('source/supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())
    await db.exec(await readFile('source/supabase/migrations/'+file,'utf8'));
});
after(async()=>{if(db){await db.exec('reset role');await db.close();}});
test('snapshot publish has 12s scoped timeout while unrelated RPCs remain unchanged',async()=>{
  const rows=(await db.query("select p.proname,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('dlkt_info_publish_public_snapshot','dlkt_info_read_public_snapshot','dlkt_info_read_database_readiness','dlkt_info_claim_public_refresh')")).rows;
  const configs=new Map(rows.map(x=>[x.proname,x.proconfig]));
  const publisher=configs.get('dlkt_info_publish_public_snapshot')??[];
  assert.ok(publisher.includes('statement_timeout=12s'));
  assert.ok(publisher.some(x=>x.startsWith('search_path=')));
  assert.equal((configs.get('dlkt_info_read_public_snapshot')??[]).some(x=>x.startsWith('statement_timeout=')),false);
  assert.equal((configs.get('dlkt_info_claim_public_refresh')??[]).some(x=>x.startsWith('statement_timeout=')),false);
  assert.ok((configs.get('dlkt_info_read_database_readiness')??[]).includes('statement_timeout=12s'));
});
test('database readiness attestation remains ready with scoped timeout',async()=>{
  const r=(await db.query('select public.dlkt_info_read_database_readiness() as value')).rows[0].value;
  assert.equal(r.ready,true);
  assert.ok(typeof r.activationReceipt==='string'&&r.activationReceipt.length===64);
});
test('anonymous snapshot publish still rejects missing writer credential',async()=>{
  const beforeTimeout=(await db.query("select current_setting('statement_timeout') as setting")).rows[0].setting;
  await db.exec("set role anon");
  try{await assert.rejects(db.query("select public.dlkt_info_publish_public_snapshot('11111111-1111-4111-8111-111111111111'::uuid,1,'{}'::jsonb,repeat('0',64))"),{code:'42501'});}
  finally{await db.exec('reset role');}
  const afterTimeout=(await db.query("select current_setting('statement_timeout') as setting")).rows[0].setting;
  assert.equal(afterTimeout,beforeTimeout,'statement_timeout must not leak into caller session');
  const receipt=await db.query('select revision,fence from dlkt_info_private.public_refresh_state where singleton');
  assert.deepEqual(receipt.rows,[{revision:0,fence:0}]);
});
