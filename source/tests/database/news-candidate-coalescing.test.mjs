import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const KEY='fixture-only-coalesced-news-writer-key-0123456789abcdef';
const URL='https://www.theguardian.com/2026/nov/21/specialist-report';
const TITLE='A specialist development recorded today';
const CHANGED='A specialist development recorded today with further details';
const originalTime=Date.now();
const time=ago=>new Date(originalTime-ago).toISOString();
const candidate=(indexedAt,title=TITLE)=>({sourceUrl:URL,title,publisher:'The Guardian',indexedAt,category:null});
let db;

async function headers(value){await db.query("select set_config('request.headers',$1,false)",[JSON.stringify(value)]);}
async function write(rows){
  await db.exec('set role anon');
  try{return (await db.query('select public.dlkt_info_upsert_news_candidates($1::jsonb) as value',[JSON.stringify(rows)])).rows[0].value;}
  finally{await db.exec('reset role');}
}
async function row(){return (await db.query('select title,publisher,category,indexed_at from public.dlkt_info_news_candidates where source_url=$1',[URL])).rows[0]??null;}

before(async()=>{
  db=new PGlite();await db.waitReady;
  await db.exec("create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;grant usage on schema public to anon,authenticated,service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'::jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;");
  for(const file of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())
    await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  await db.query('insert into dlkt_info_private.share_archive_writer(key_hash) values($1)',[createHash('sha256').update(KEY).digest('hex')]);
  await headers({'x-dlkt-share-write':KEY});
});
after(async()=>{if(db){await db.exec('reset role');await db.close();}});

test('first indexed record is persisted with its original observation timestamp',async()=>{
  const created=candidate(time(120_000));
  assert.equal((await write([created])).accepted,1);
  const stored=await row();
  assert.deepEqual({title:stored.title,publisher:stored.publisher,category:stored.category},
    {title:TITLE,publisher:'The Guardian',category:null});
  assert.equal(new Date(stored.indexed_at).getTime(),Date.parse(created.indexedAt));
});
test('identical metadata observed two minutes later is not physically updated',async()=>{
  const storedBefore=await row();
  assert.equal((await write([candidate(time(5000))])).accepted,0);
  const storedAfter=await row();
  assert.deepEqual(storedAfter,storedBefore);
});
test('changed title is published immediately even inside the coalescing window',async()=>{
  assert.equal((await write([candidate(time(4000),CHANGED)])).accepted,1);
  const stored=await row();
  assert.equal(stored.title,CHANGED);
  assert.equal(new Date(stored.indexed_at).getTime(),Date.parse(time(4000)));
});
test('equal timestamp and identical metadata are no-ops, with NULL category safe',async()=>{
  const record=candidate(time(4000),CHANGED);
  assert.equal((await write([record])).accepted,0);
  assert.equal((await row()).category,null);
});
test('a fresh observation refreshes the entry once its age exceeds ten minutes',async()=>{
  await db.exec("update public.dlkt_info_news_candidates set indexed_at=clock_timestamp()-interval '11 minutes' where source_url='"+URL+"'");
  const newest=candidate(time(2000),CHANGED);
  assert.equal((await write([newest])).accepted,1);
  const result=await row();
  assert.equal(new Date(result.indexed_at).getTime(),Date.parse(newest.indexedAt));
  assert.equal((await write([newest])).accepted,0);
});
test('out-of-order older observations cannot regress content or timestamp',async()=>{
  const original=await row();
  assert.equal((await write([candidate(time(30_000),TITLE)])).accepted,0);
  assert.deepEqual(await row(),original);
});
test('invalid writer authentication and direct anon UPDATE remain denied',async()=>{
  await headers({});
  await assert.rejects(write([candidate(time(1000))]),{code:'42501'});
  await db.exec('set role anon');
  try{await assert.rejects(db.exec("update public.dlkt_info_news_candidates set title='forged'"),{code:'42501'});}
  finally{await db.exec('reset role');}
  await headers({'x-dlkt-share-write':KEY});
  assert.equal((await row()).title,CHANGED);
});
test('purpose-bound RPC preserves privileged SQL flags and database readiness',async()=>{
  const functionConfig=(await db.query("select p.prosecdef,p.proconfig from pg_proc p where p.oid='public.dlkt_info_upsert_news_candidates(jsonb)'::regprocedure")).rows[0];
  assert.equal(functionConfig.prosecdef,true);
  assert.ok(functionConfig.proconfig.some(x=>x.startsWith('search_path=')));
  const attestation=(await db.query('select public.dlkt_info_read_database_readiness() as readiness')).rows[0].readiness;
  assert.equal(attestation.ready,true);
  assert.equal(attestation.checks.publicRpcPermissions,true);
  assert.equal(attestation.checks.publicDataPermissions,true);
});
