import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

// Differential laboratory only: no hosted database, secrets, runtime, or migration.
const bootstrap=await readFile(new URL('../source/scripts/news-candidate-store.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../source/supabase/migrations/20261123200500_dlkt_info_news_candidate_write_coalescing.sql',import.meta.url),'utf8');
const oldOrder="where indexed_at < (entry->>'indexedAt')::timestamptz\n          order by (indexed_at < checked_at - interval '24 hours') desc,indexed_at,url_hash limit 1;";
const newOrder="where indexed_at = (select min(indexed_at) from public.dlkt_info_news_candidates\n            where indexed_at < (entry->>'indexedAt')::timestamptz)\n          order by url_hash limit 1;";
const replaceOnce=(sql,from,to)=>{
  assert.equal(sql.split(from).length,2,'production SQL must match exactly once');
  return sql.replace(from,to);
};
const KEY='fixture-only-eviction-lab-writer-key-0123456789abcdef';
const START=Date.UTC(2026,10,26,12),MIN=60000;
const stamp=m=>new Date(START+m*MIN).toISOString();
const url=name=>'https://www.theguardian.com/2026/nov/26/eviction-'+name;
const title='A specialist development recorded today';
const item=(name,m,overrides={})=>({sourceUrl:url(name),title,publisher:'The Guardian',indexedAt:stamp(m),category:null,...overrides});
async function setup(optimized){
  const db=new PGlite();
  try{
    await db.waitReady;
    await db.exec("create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;grant usage on schema public to anon,authenticated,service_role;create schema dlkt_info_private;create table dlkt_info_private.share_archive_writer(singleton boolean primary key default true,key_hash text not null);");
    await db.exec(bootstrap);
    let sql=replaceOnce(migration,'checked_at timestamptz := clock_timestamp();',"checked_at timestamptz := current_setting('dlkt_lab.now')::timestamptz;");
    if(optimized)sql=replaceOnce(sql,oldOrder,newOrder);
    await db.exec(sql);
    await db.query('insert into dlkt_info_private.share_archive_writer(key_hash) values($1)',[createHash('sha256').update(KEY).digest('hex')]);
    await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-dlkt-share-write':KEY})]);
    return db;
  }catch(error){await db.close();throw error;}
}
async function write(db,minute,rows){
  await db.query("select set_config('dlkt_lab.now',$1,false)",[stamp(minute)]);
  await db.exec('set role anon');
  try{return (await db.query('select public.dlkt_info_upsert_news_candidates($1::jsonb) as result',[JSON.stringify(rows)])).rows[0].result.accepted;}
  finally{await db.exec('reset role');}
}
async function receipt(db){
  const rows=(await db.query("select source_url,url_hash,title,publisher,indexed_at,category from public.dlkt_info_news_candidates order by url_hash")).rows;
  return {count:rows.length,digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
}
async function exists(db,name){
  return (await db.query('select count(*)::int as n from public.dlkt_info_news_candidates where source_url=$1',[url(name)])).rows[0].n===1;
}
async function compareVictim(db,minute,checkedAt=0){
  const args=[stamp(minute),stamp(checkedAt-1440)];
  const a=(await db.query("select url_hash from public.dlkt_info_news_candidates where indexed_at < $1::timestamptz order by (indexed_at < $2::timestamptz) desc,indexed_at,url_hash limit 1",args)).rows;
  const b=(await db.query("select url_hash from public.dlkt_info_news_candidates where indexed_at=(select min(indexed_at) from public.dlkt_info_news_candidates where indexed_at < $1::timestamptz) order by url_hash limit 1",[args[0]])).rows;
  assert.deepEqual(b,a,'same deterministic victim, including empty or tied timestamps');
  return a[0]?.url_hash??null;
}
async function run(optimized){
  const db=await setup(optimized);
  const receipts=[],counts=[];
  try{
    assert.equal(await compareVictim(db,0),null);
    // 5,000 rows with deliberately repeated timestamps, including both sides of 24h and 48h.
    await db.query(`insert into public.dlkt_info_news_candidates(source_url,url_hash,title,publisher,indexed_at,category)
      select u,encode(sha256(convert_to(u,'UTF8')),'hex'),$1,'The Guardian',
        $2::timestamptz+(case when n<=2 then -3000 when n<=12 then -1500 when n<=60 then -1200 else -(n%100) end)*interval '1 minute',null
      from (select n,'https://www.theguardian.com/2026/nov/26/eviction-fill-'||n as u from generate_series(1,5000) n) x`,[title,stamp(0)]);
    receipts.push(await receipt(db));
    for(const cutoff of [-3001,-3000,-2999,-1500,-1499,-1440,-1200,-1199,-100,-99,-50,0,1]){
      for(const checkedAt of [-2000,0,1500])await compareVictim(db,cutoff,checkedAt);
    }
    // The RPC itself expires >48h rows before admission and then applies the same capacity.
    counts.push(await write(db,0,[item('first',0),item('second',0)]));
    assert.equal(await exists(db,'fill-1'),false);
    assert.equal(await exists(db,'fill-2'),false);
    assert.equal(await exists(db,'first'),true);
    assert.equal((await receipt(db)).count,5000);
    receipts.push(await receipt(db));
    // Full cache: verify the exact hash tie-breaker after cleanup.
    const victim=await compareVictim(db,1);
    assert.ok(victim);
    counts.push(await write(db,1,[item('third',1)]));
    assert.equal((await db.query('select count(*)::int as n from public.dlkt_info_news_candidates where url_hash=$1',[victim])).rows[0].n,0);
    receipts.push(await receipt(db));
    // Mixed batch, same observation timestamp, changed metadata, no-op renewal, older rejection.
    counts.push(await write(db,2,[item('first',0,{title:title+' with further details'}),item('second',2),item('fourth',2),item('fifth',2)]));
    counts.push(await write(db,3,[item('first',-1),item('third',3)]));
    counts.push(await write(db,12,[item('first',12),item('second',12),item('third',12)]));
    receipts.push(await receipt(db));
    // Deterministic sustained contention with repeated ties and mixed additions/rediscoveries.
    for(let minute=14;minute<=34;minute+=2){
      counts.push(await write(db,minute,[
        ...Array.from({length:16},(_,n)=>item('wave-'+(minute%6)+'-'+n,minute)),
        ...Array.from({length:6},(_,n)=>item('fill-'+(100+n),minute)),
      ]));
      const state=await receipt(db);
      assert.equal(state.count,5000);
      receipts.push(state);
    }
    await assert.rejects(write(db,36,[item('duplicate',36),item('duplicate',36)]),{code:'22023'});
    await db.query("select set_config('request.headers','{}',false)");
    await assert.rejects(write(db,36,[item('denied',36)]),{code:'42501'});
    receipts.push(await receipt(db));
    // Verify strict comparison: existing newest/equal timestamp cannot be evicted.
    await db.exec('truncate public.dlkt_info_news_candidates');
    await db.query(`insert into public.dlkt_info_news_candidates(source_url,url_hash,title,publisher,indexed_at,category)
      select u,encode(sha256(convert_to(u,'UTF8')),'hex'),$1,'The Guardian',$2::timestamptz,null
      from (select 'https://www.theguardian.com/2026/nov/26/eviction-equal-'||n as u from generate_series(1,5000) n) x`,[title,stamp(40)]);
    assert.equal(await compareVictim(db,40),null);
    await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-dlkt-share-write':KEY})]);
    counts.push(await write(db,40,[item('equal-rejected',40)]));
    assert.equal(counts.at(-1),0);
    receipts.push(await receipt(db));
    return {counts,receipts};
  }finally{await db.close();}
}
test('indexed victim selection preserves exact candidate RPC outcomes under expiry, ties, saturation and authorization',async t=>{
  const baseline=await run(false),optimized=await run(true);
  assert.deepEqual(optimized,baseline);
  t.diagnostic(JSON.stringify({identicalStateCheckpoints:baseline.receipts.length,identicalAcceptedCounts:baseline.counts.length,syntheticOnly:true}));
});
