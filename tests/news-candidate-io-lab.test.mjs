import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

// Isolated experiment only. No hosted DB, real credentials, fetch, or migration.
// Use the versioned production RPC; replace only its clock and coalescing
// predicate in a disposable in-memory database. Never ship the laboratory SQL.
const migration=await readFile(new URL('../source/supabase/migrations/20261123200500_dlkt_info_news_candidate_write_coalescing.sql',import.meta.url),'utf8');
const bootstrap=await readFile(new URL('../source/scripts/news-candidate-store.sql',import.meta.url),'utf8');
const KEY='fixture-only-lab-writer-key-0123456789abcdef123456';
const START=Date.UTC(2026,10,26,12,0,0),MIN=60_000;
const stamp=m=>new Date(START+m*MIN).toISOString();
const item=(name,m,title='A specialist development recorded today')=>({
  sourceUrl:'https://www.theguardian.com/2026/nov/26/lab-'+name,
  title,publisher:'The Guardian',indexedAt:stamp(m),category:null,
});
const replaceOnce=(sql,from,to)=>{
  assert.equal(sql.split(from).length,2,'expected exactly one matching production SQL expression');
  return sql.replace(from,to);
};
async function setup(minutes){
  const db=new PGlite();
  try{
    await db.waitReady;
    await db.exec("create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;grant usage on schema public to anon,authenticated,service_role;create schema dlkt_info_private;create table dlkt_info_private.share_archive_writer(singleton boolean primary key default true,key_hash text not null);");
    await db.exec(bootstrap);
    let sql=replaceOnce(migration,'checked_at timestamptz := clock_timestamp();',"checked_at timestamptz := current_setting('dlkt_lab.now')::timestamptz;");
    sql=replaceOnce(sql,"indexed_at <= checked_at - interval '10 minutes'","indexed_at <= checked_at - interval '"+minutes+" minutes'");
    await db.exec(sql);
    await db.query('insert into dlkt_info_private.share_archive_writer(key_hash) values($1)',[createHash('sha256').update(KEY).digest('hex')]);
    await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-dlkt-share-write':KEY})]);
    return db;
  }catch(error){await db.close();throw error;}
}
async function write(db,minute,rows){
  await db.query("select set_config('dlkt_lab.now',$1,false)",[stamp(minute)]);
  await db.exec('set role anon');
  try{
    return (await db.query('select public.dlkt_info_upsert_news_candidates($1::jsonb) as result',[JSON.stringify(rows)])).rows[0].result.accepted;
  }finally{await db.exec('reset role');}
}
async function find(db,url){
  return (await db.query('select title,indexed_at from public.dlkt_info_news_candidates where source_url=$1',[url])).rows[0]??null;
}
async function experiment(minutes){
  const db=await setup(minutes);
  try{
    // 60 stable sources repeatedly rediscovered for 60 minutes, at production cadence.
    let accepted=0;
    for(let minute=0;minute<60;minute+=2){
      const rows=Array.from({length:60},(_,i)=>item('stable-'+i,minute));
      accepted+=await write(db,minute,rows);
    }
    const stableUpdates=accepted-60; // First 60 are inserts, all later accepted rows are updates.
    const stable=(await db.query('select count(*)::int as n from public.dlkt_info_news_candidates')).rows[0].n;
    assert.equal(stable,60);
    // Immediate correction must not be suppressed, even inside the coalescing window.
    const corrected=item('stable-0',59,'A specialist development recorded today with further details');
    assert.equal(await write(db,59,[corrected]),1);
    assert.equal((await find(db,corrected.sourceUrl)).title,corrected.title);
    assert.equal(await write(db,60,[item('stable-0',58)]),0,'older conflicting observation must not overwrite correction');
    assert.equal((await find(db,corrected.sourceUrl)).title,corrected.title);
    // Capacity counterexample: fill all 5,000 positions. A rediscovered older
    // candidate may become the next eviction victim if its timestamp is not renewed.
    await db.exec('truncate public.dlkt_info_news_candidates');
    const target=item('target',0);
    assert.equal(await write(db,0,[target]),1);
    await db.query(`insert into public.dlkt_info_news_candidates(source_url,url_hash,title,publisher,indexed_at,category)
      select u,encode(sha256(convert_to(u,'UTF8')),'hex'),'A specialist development recorded today','The Guardian',$1::timestamptz,null
      from (select 'https://www.theguardian.com/2026/nov/26/lab-fill-'||n as u from generate_series(1,4999) n) rows`,[stamp(5)]);
    const renewed=await write(db,12,[item('target',12)]);
    assert.equal(await write(db,13,[item('new',13)]),1);
    const retained=(await find(db,target.sourceUrl))!==null;
    const count=(await db.query('select count(*)::int as n from public.dlkt_info_news_candidates')).rows[0].n;
    assert.equal(count,5000,'capacity is invariant');
    return {stableUpdates,renewed,retained};
  }finally{await db.close();}
}
test('candidate write coalescing lab measures the savings and exposes the eviction tradeoff',async t=>{
  const baseline=await experiment(10);
  const longer=await experiment(30);
  t.diagnostic(JSON.stringify({baseline10m:baseline,experiment30m:longer,syntheticOnly:true}));
  assert.deepEqual(baseline,{stableUpdates:300,renewed:1,retained:true});
  assert.deepEqual(longer,{stableUpdates:60,renewed:0,retained:false});
  // A passing test documents a counterexample, NOT permission to widen the window.
});
