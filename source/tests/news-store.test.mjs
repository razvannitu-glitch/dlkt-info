import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createNewsCandidateStore,NewsCandidateStoreError} from '../.build/src/iceo/news-store.js';

const now=Date.parse('2026-11-20T12:00:00.000Z');
const environment={DLKT_INFO_SUPABASE_PROJECT_REF:'abcdefghijklmnopqrst',DLKT_INFO_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',
  DLKT_INFO_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_abcdefghijklmnopqrstuvwx',DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY:'x'.repeat(43)};
const candidate=(changes={})=>({sourceUrl:'https://www.ign.com/articles/gta-6-launch',title:'GTA 6 launches with a new multiplayer update',publisher:'IGN',
  indexedAt:new Date(now-60_000).toISOString(),category:'gaming',...changes});
const row=(value=candidate())=>({source_url:value.sourceUrl,title:value.title,publisher:value.publisher,indexed_at:value.indexedAt,category:value.category});
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const unclassified=()=>candidate({sourceUrl:'https://www.bbc.com/news/articles/queen-emergence',publisher:'BBC',title:'Beekeepers report first queen emergence after winter',category:null});

test('public candidate cache reads bounded current metadata without writer/account credentials',async()=>{
  let call;const store=createNewsCandidateStore(environment,async(input,init)=>{call={url:new URL(input),init};return json([row()]);});
  assert.equal(store.writable,true);assert.deepEqual(await store.read(now),{candidates:[candidate()],rejected:0});
  assert.equal(call.url.pathname,'/rest/v1/dlkt_info_news_candidates');assert.equal(call.url.searchParams.get('limit'),'400');
  assert.deepEqual(call.url.searchParams.getAll('indexed_at'),['gte.2026-11-19T12:00:00.000Z','lte.2026-11-20T12:05:00.000Z']);
  assert.equal(call.url.searchParams.get('select'),'source_url,title,publisher,indexed_at,category');
  assert.equal(call.init.headers['x-dlkt-share-write'],undefined);assert.equal(call.init.headers.Authorization,undefined);
  assert.equal(call.init.credentials,'omit');assert.equal(call.init.redirect,'error');assert.equal(call.init.cache,'no-store');
  assert.equal(Object.hasOwn((await store.read(now)).candidates[0],'publishedAt'),false);
});

test('invalid or conflicting cache records are isolated while unrelated valid candidates survive',async()=>{
  const other=candidate({sourceUrl:'https://www.ign.com/articles/gta-6-multiplayer',title:'GTA 6 multiplayer launch announced'});
  const store=createNewsCandidateStore(environment,async()=>json([row(),row(candidate({title:'GTA 6 release delayed'})),row(other),
    row(candidate({sourceUrl:'https://evil.example/articles/gta-6'})),row(candidate({indexedAt:new Date(now-86_400_001).toISOString()})),
    {...row(),accountId:'private'},row(candidate({category:'world'}))]));
  assert.deepEqual(await store.read(now),{candidates:[other],rejected:6});
});

test('matching duplicate rows are deduplicated and Postgres UTC timestamps are validated',async()=>{
  const store=createNewsCandidateStore(environment,async()=>json([row(),{...row(),indexed_at:'2026-11-20T11:59:00+00:00'}]));
  assert.deepEqual(await store.read(now),{candidates:[candidate()],rejected:0});
});

test('one bounded diversity follow-up recovers family and uncategorized subjects behind500 newer gaming candidates',async()=>{
  const family=candidate({sourceUrl:'https://www.parents.com/parenting-child-care-news',publisher:'Parents',title:'Parents share new child care guidance',
    category:'family',indexedAt:new Date(now-120_000).toISOString()});
  const niche=unclassified(),records=[...Array.from({length:500},(_,n)=>row(candidate({sourceUrl:`https://www.ign.com/articles/gta-6-${n}`}))),row(family),row(niche)];
  const calls=[];let fetched=0;
  const store=createNewsCandidateStore(environment,async(input,init)=>{
    const url=new URL(input);calls.push({url,init});const limit=Number(url.searchParams.get('limit'));
    const excluded=/category\.not\.in\.\(([^)]+)\)/u.exec(url.searchParams.get('or')??'')?.[1].split(',');
    const selected=records.filter(value=>!excluded||value.category===null||!excluded.includes(value.category)).slice(0,limit);fetched+=selected.length;return json(selected);
  });
  const result=await store.read(now);assert.equal(calls.length,2);assert.equal(fetched,402);assert.equal(result.candidates.length,402);
  assert.ok(result.candidates.some(value=>value.sourceUrl===family.sourceUrl));assert.equal(result.rejected,0);
  assert.ok(result.candidates.some(value=>value.sourceUrl===niche.sourceUrl&&value.category===null));
  assert.equal(calls[0].url.searchParams.get('limit'),'400');assert.equal(calls[1].url.searchParams.get('limit'),'100');
  assert.equal(calls[1].url.searchParams.get('category'),null);assert.equal(calls[1].url.searchParams.get('or'),'(category.not.in.(gaming),category.is.null)');
  for(const {init} of calls){assert.equal(init.headers['x-dlkt-share-write'],undefined);assert.equal(init.headers.Authorization,undefined);assert.equal(init.credentials,'omit');}
});

test('explicit null category survives a write and a new cold public read without changing its fields',async()=>{
  const niche=unclassified();let saved;
  const writer=createNewsCandidateStore(environment,async(_input,init)=>{saved=JSON.parse(init.body).p_candidates;return json({accepted:saved.length});});
  assert.equal(await writer.write([niche],now),1);assert.deepEqual(saved,[niche]);assert.ok(Object.hasOwn(saved[0],'category'));assert.equal(saved[0].category,null);
  const reader=createNewsCandidateStore({...environment,DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY:undefined},async(_input,init)=>{assert.equal(init.headers['x-dlkt-share-write'],undefined);return json(saved.map(value=>row(value)));});
  assert.deepEqual(await reader.read(now),{candidates:[niche],rejected:0});
  for(const category of ['uncategorized','beekeeping','world',undefined])await assert.rejects(writer.write([{...niche,category}],now),{code:'NEWS_CANDIDATE_INVALID'});
});

test('a first page of uncategorized subjects uses remaining capacity for any other observed category',async()=>{
  let count=0;const calls=[];
  const first=Array.from({length:400},(_,n)=>row({...unclassified(),sourceUrl:`https://www.bbc.com/news/articles/beekeeping-${n}`}));
  const store=createNewsCandidateStore(environment,async(input)=>{calls.push(new URL(input));return json(++count===1?first:[row()]);});
  const result=await store.read(now);assert.equal(result.candidates.length,401);assert.equal(result.rejected,0);
  assert.equal(calls[1].searchParams.get('category'),'not.is.null');assert.equal(calls[1].searchParams.get('or'),null);
});

test('category follow-up shares byte budget and preserves first response with an explicit partial result',async()=>{
  const first=Array.from({length:400},(_,n)=>row(candidate({sourceUrl:`https://www.ign.com/articles/gta-6-${n}`})));
  const firstJson=JSON.stringify(first);let requests=0;
  const second='[]'+' '.repeat(2_097_152-Buffer.byteLength(firstJson)+1);
  assert.ok(Buffer.byteLength(second)<2_097_152);
  const store=createNewsCandidateStore(environment,async()=>{requests++;return new Response(requests===1?firstJson:second,{headers:{'content-type':'application/json'}});});
  const result=await store.read(now);assert.equal(requests,2);assert.equal(result.candidates.length,400);assert.equal(result.partial,true);
});

test('two category requests share one2.5second deadline even if follow-up ignores abort',async()=>{
  const first=Array.from({length:400},(_,n)=>row(candidate({sourceUrl:`https://www.ign.com/articles/gta-6-${n}`})));
  let requests=0;let signal;const began=Date.now();
  const store=createNewsCandidateStore(environment,async(_input,init)=>{
    requests++;if(requests===1){await new Promise(resolve=>setTimeout(resolve,1000));return json(first);}
    signal=init.signal;return new Promise(()=>{});
  });
  const result=await store.read(now);assert.equal(requests,2);assert.equal(result.candidates.length,400);assert.equal(result.partial,true);
  assert.equal(signal.aborted,true);assert.ok(Date.now()-began<3_200,'follow-up must not receive a second2.5second budget');
});

test('write sends only strict public discovery candidates through the purpose-bound RPC',async()=>{
  let call;const store=createNewsCandidateStore(environment,async(input,init)=>{call={url:new URL(input),init};return json({accepted:1});});
  assert.equal(await store.write([candidate(),candidate()],now),1);
  assert.equal(call.url.pathname,'/rest/v1/rpc/dlkt_info_upsert_news_candidates');
  assert.equal(call.init.headers['x-dlkt-share-write'],environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY);
  assert.deepEqual(JSON.parse(call.init.body),{p_candidates:[candidate()]});
  assert.equal(call.init.headers.Authorization,undefined);assert.equal(call.init.credentials,'omit');
  assert.equal(await store.write([],now),0);
});

test('private fields, bad provenance, future/stale discovery, malformed clocks and conflicting writes never reach REST',async()=>{
  let requests=0;const store=createNewsCandidateStore(environment,async()=>{requests++;return json({accepted:1});});
  const invalid=[candidate({accountId:'private'}),candidate({publisher:'Reuters'}),candidate({category:'family'}),
    candidate({sourceUrl:'https://www.ign.com.evil.example/articles/gta-6'}),candidate({title:'x'.repeat(201)}),
    candidate({indexedAt:new Date(now+300_001).toISOString()}),candidate({indexedAt:new Date(now-86_400_001).toISOString()}),
    candidate({publishedAt:new Date(now).toISOString()})];
  for(const value of invalid)await assert.rejects(store.write([value],now),{code:'NEWS_CANDIDATE_INVALID'});
  await assert.rejects(store.write([candidate(),candidate({title:'GTA 6 delayed'})],now),{code:'NEWS_CANDIDATE_INVALID'});
  await assert.rejects(store.write(Array.from({length:501},()=>candidate()),now),{code:'NEWS_CANDIDATE_INVALID'});
  await assert.rejects(store.read(Number.NaN),{code:'NEWS_CANDIDATE_INVALID'});
  await assert.rejects(store.write([candidate()],Number.POSITIVE_INFINITY),{code:'NEWS_CANDIDATE_INVALID'});
  assert.equal(requests,0);
});

test('missing/mismatched configuration disables cache, missing writer preserves public reads',async()=>{
  assert.equal(createNewsCandidateStore({}),null);
  assert.equal(createNewsCandidateStore({...environment,DLKT_INFO_SUPABASE_URL:'https://evil.example'}),null);
  for(const key of [undefined,'short',' '+environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY]){
    const store=createNewsCandidateStore({...environment,DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY:key},async()=>json([]));
    assert.equal(store.writable,false);assert.deepEqual(await store.read(now),{candidates:[],rejected:0});
    await assert.rejects(store.write([candidate()],now),{code:'NEWS_CANDIDATE_STORE_UNAVAILABLE'});
  }
});

test('cache backend failure, invalid envelopes and oversized streams never masquerade as empty discovery',async()=>{
  const variants=[()=>new Response('private backend detail',{status:503}),()=>new Response('denied',{status:401}),
    ()=>new Response('[]',{headers:{'content-type':'text/html'}}),()=>json({error:'private account detail'}),
    ()=>json(Array.from({length:501},()=>row())),()=>new Response('x'.repeat(2_097_153),{headers:{'content-type':'application/json'}}),
    ()=>new Response('[]',{headers:{'content-type':'application/json','content-length':'999999999'}}),
    ()=>new Response('{',{headers:{'content-type':'application/json'}})];
  for(const reply of variants){const store=createNewsCandidateStore(environment,async()=>reply());
    await assert.rejects(store.read(now),error=>error instanceof NewsCandidateStoreError&&error.message==='NEWS_CANDIDATE_STORE_UNAVAILABLE');}
});

test('RPC acceptance must be bounded and exact; partial cache capacity is reported honestly',async()=>{
  for(const response of [{accepted:2},{accepted:-1},{accepted:0.5},{accepted:'1'},{accepted:1,private:'secret'},null]){
    const store=createNewsCandidateStore(environment,async()=>json(response));
    await assert.rejects(store.write([candidate()],now),{code:'NEWS_CANDIDATE_STORE_UNAVAILABLE'});
  }
  const store=createNewsCandidateStore(environment,async()=>json({accepted:0}));assert.equal(await store.write([candidate()],now),0);
});

test('candidate SQL draft validates authorization, public-only ACLs, exact payloads, bounded capacity and cache-only expiry',async()=>{
  const db=new PGlite();await db.waitReady;const current=Date.now();
  const fresh=(changes={})=>candidate({indexedAt:new Date(current-1000).toISOString(),...changes});
  const asRole=async(role,fn)=>{await db.exec(`set role ${role}`);try{return await fn();}finally{await db.exec('reset role');}};
  const headers=async(value)=>db.query("select set_config('request.headers',$1,false)",[JSON.stringify(value)]);
  const write=async(values)=>asRole('anon',()=>db.query('select public.dlkt_info_upsert_news_candidates($1::jsonb) as result',[JSON.stringify(values)]));
  try {
    await db.exec(`create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;create role visitor noinherit;
      grant usage on schema public to anon,authenticated,service_role,visitor;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      create schema dlkt_info_private;create table dlkt_info_private.share_archive_writer(singleton boolean primary key default true,key_hash text not null);
      alter table dlkt_info_private.share_archive_writer enable row level security;
      revoke all on dlkt_info_private.share_archive_writer from public,anon,authenticated,service_role;
      create table public.dlkt_info_shared_cards(sentinel text);insert into public.dlkt_info_shared_cards values('historical share remains');`);
    await db.exec(await readFile(new URL('../scripts/news-candidate-store.sql',import.meta.url),'utf8'));
    await headers({'x-dlkt-share-write':environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY});
    await assert.rejects(write([fresh()]),{code:'42501'});
    await db.query('insert into dlkt_info_private.share_archive_writer(key_hash) values($1)',[createHash('sha256').update(environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY).digest('hex')]);
    for(const value of [{},{'x-dlkt-share-write':'wrong'},{'x-dlkt-share-write':'y'.repeat(43)}]){await headers(value);await assert.rejects(write([fresh()]),{code:'42501'});}
    await db.query("select set_config('request.headers','not-json',false)");await assert.rejects(write([fresh()]),{code:'42501'});
    await headers({'x-dlkt-share-write':environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY});
    // The reviewed publisher registry is deliberately absent from this draft.
    await assert.rejects(write([fresh()]),{code:'22023'});
    // Test-only publisher rule. Root owns the real complete migration registry.
    await db.exec(`create or replace function dlkt_info_private.valid_news_candidate_publisher(p_publisher text,p_url text)
      returns boolean language sql immutable set search_path='' as $$ select p_publisher='IGN' and p_url ~ '^https://www[.]ign[.]com/articles/[a-z0-9-]+$' $$;`);
    assert.equal((await write([fresh()])).rows[0].result.accepted,1);
    const seen=(await asRole('anon',()=>db.query('select source_url,title,publisher,indexed_at,category from public.dlkt_info_news_candidates'))).rows;
    assert.equal(seen.length,1);assert.equal(seen[0].publisher,'IGN');
    for(const role of ['anon','authenticated','service_role']){
      for(const sql of ['delete from public.dlkt_info_news_candidates','truncate public.dlkt_info_news_candidates',
        'update public.dlkt_info_news_candidates set title=title',
        "insert into public.dlkt_info_news_candidates(source_url,title,publisher,indexed_at,category) values('https://www.ign.com/articles/new','GTA 6','IGN',now(),'gaming')",
        'select key_hash from dlkt_info_private.share_archive_writer'])await assert.rejects(asRole(role,()=>db.exec(sql)),{code:'42501'});
    }
    await assert.rejects(asRole('visitor',()=>db.query('select public.dlkt_info_upsert_news_candidates($1::jsonb)',[JSON.stringify([fresh()])])),{code:'42501'});
    for(const value of [fresh({userId:'private'}),fresh({publishedAt:new Date(current).toISOString()}),fresh({sourceUrl:'https://evil.example/a'}),
      fresh({publisher:'Reuters'}),fresh({category:'unknown'}),fresh({title:'x'.repeat(201)}),fresh({indexedAt:'infinity'}),
      fresh({indexedAt:new Date(current-86_500_000).toISOString()}),fresh({indexedAt:new Date(current+600_000).toISOString()})]){
      await assert.rejects(write([value]),{code:'22023'});
    }
    await assert.rejects(write([fresh(),fresh()]),{code:'22023'});
    await assert.rejects(write(Array.from({length:501},()=>fresh())),{code:'22023'});
    const newer=fresh({title:'GTA 6 multiplayer announcement',indexedAt:new Date(current).toISOString()});await write([newer]);
    assert.equal((await write([fresh()])).rows[0].result.accepted,0);
    assert.equal((await db.query('select title from public.dlkt_info_news_candidates')).rows[0].title,newer.title);
    await db.exec(`insert into public.dlkt_info_news_candidates(source_url,url_hash,title,publisher,indexed_at,category)
      select 'https://www.ign.com/articles/filler-'||n,encode(sha256(convert_to('https://www.ign.com/articles/filler-'||n,'UTF8')),'hex'),
        'GTA 6 launch','IGN',clock_timestamp(),'gaming' from generate_series(1,4999) n;`);
    assert.equal((await write([fresh({sourceUrl:'https://www.ign.com/articles/overflow'})])).rows[0].result.accepted,0);
    await db.exec(`update public.dlkt_info_news_candidates set indexed_at=clock_timestamp()-interval '30 hours' where source_url like '%/filler-1';
      update public.dlkt_info_news_candidates set indexed_at=clock_timestamp()-interval '25 hours' where source_url like '%/filler-2';`);
    assert.equal((await write([fresh({sourceUrl:'https://www.ign.com/articles/overflow'})])).rows[0].result.accepted,1);
    assert.equal((await db.query('select count(*)::int as n from public.dlkt_info_news_candidates')).rows[0].n,5000);
    assert.equal((await db.query("select count(*)::int as n from public.dlkt_info_news_candidates where source_url like '%/filler-1'")).rows[0].n,0);
    assert.equal((await db.query("select count(*)::int as n from public.dlkt_info_news_candidates where source_url like '%/filler-2'")).rows[0].n,1);
    const next=fresh({sourceUrl:'https://www.ign.com/articles/newer-current',indexedAt:new Date(current+30_000).toISOString()});
    assert.equal((await write([next])).rows[0].result.accepted,1);
    assert.equal((await db.query("select count(*)::int as n from public.dlkt_info_news_candidates where source_url like '%/filler-2'")).rows[0].n,0);
    const oldest=(await db.query('select source_url from public.dlkt_info_news_candidates order by indexed_at,url_hash limit 1')).rows[0].source_url;
    assert.equal((await write([fresh({sourceUrl:'https://www.ign.com/articles/latest-current',indexedAt:new Date(current+60_000).toISOString()})])).rows[0].result.accepted,1);
    assert.equal((await db.query('select count(*)::int as n from public.dlkt_info_news_candidates where source_url=$1',[oldest])).rows[0].n,0);
    await db.exec("update public.dlkt_info_news_candidates set indexed_at=clock_timestamp()-interval '30 hours'");
    assert.equal((await write([fresh({sourceUrl:'https://www.ign.com/articles/fresh-after-cache-saturation'})])).rows[0].result.accepted,1);
    assert.equal((await db.query('select count(*)::int as n from public.dlkt_info_news_candidates')).rows[0].n,5000);
    await db.exec("update public.dlkt_info_news_candidates set indexed_at=clock_timestamp()-interval '49 hours' where source_url like '%/fresh-after-cache-saturation'");
    assert.equal((await write([fresh({sourceUrl:'https://www.ign.com/articles/after-cache-expiry'})])).rows[0].result.accepted,1);
    assert.equal((await db.query('select count(*)::int as n from public.dlkt_info_news_candidates')).rows[0].n,5000);
    assert.equal((await db.query('select sentinel from public.dlkt_info_shared_cards')).rows[0].sentinel,'historical share remains');
    const functions=(await db.query("select proname,prosecdef,proconfig from pg_proc where proname in ('valid_news_candidate_publisher','valid_news_candidate','dlkt_info_upsert_news_candidates')")).rows;
    assert.equal(functions.length,3);assert.ok(functions.every(fn=>fn.proconfig.includes('search_path=""')));
    assert.equal(functions.find(fn=>fn.proname==='dlkt_info_upsert_news_candidates').prosecdef,true);
  } finally {await db.close();}
});
