import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {NEWS_DISCOVERY_INDEXES,canonicalNewsUrl} from '../../.build/src/iceo/news-sources.js';
import {discoverNewsWithDiagnostics,readPublisherNewsCandidates} from '../../.build/src/iceo/news-discovery.js';
import {buildNewsCorpus} from '../../.build/src/iceo/news-corpus.js';
import {validNewsDiagnostics} from '../../.build/src/iceo/news-diagnostics.js';
import {snapshot} from '../fixtures/news-corpus.mjs';
import {SPECIALIST_NOW as now,SPECIALIST_ROWS as rows,SPECIALIST_FEEDS as feeds,specialistFeed,specialistFetcher} from '../fixtures/romanian-specialists.mjs';
const migration='20261124192500_dlkt_info_romanian_specialist_sources.sql';
const signatures=['dlkt_info_private.valid_news_candidate_publisher(text,text)','dlkt_info_private.valid_news_diagnostics(jsonb,timestamp with time zone)'];
const iso=new Date(now).toISOString();
let db,beforeStamp,afterStamp,result,corpus;
async function stamp(){
 return (await db.query("select p.oid::text oid,p.proname,p.proacl::text acl,p.prosecdef,p.provolatile,p.proconfig::text config,pg_get_function_identity_arguments(p.oid) arguments,(select count(*)::integer from pg_proc f join pg_namespace n on n.oid=f.pronamespace where n.nspname in ('public','dlkt_info_private')) function_count from pg_proc p where p.oid in (to_regprocedure($1),to_regprocedure($2)) order by p.proname",signatures)).rows;
}
const valid=async(name,value)=>(await db.query('select dlkt_info_private.'+name+'($1::jsonb,$2::timestamptz) value',[JSON.stringify(value),iso])).rows[0].value;
before(async()=>{
 db=new PGlite();await db.waitReady;
 await db.exec("create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;create role untrusted_visitor noinherit;grant usage on schema public to anon,authenticated,service_role,untrusted_visitor;alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'::jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;");
 for(const file of (await readdir('supabase/migrations')).filter(name=>name.endsWith('.sql')).sort()){
  if(file===migration)beforeStamp=await stamp();
  await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  if(file===migration)afterStamp=await stamp();
 }
 result=await discoverNewsWithDiagnostics(specialistFetcher,now,[],undefined,{frontpageHighlights:false,maxArticleRequests:4});
 const cards=result.sources.flatMap(source=>source.cards);assert.equal(cards.length,4);
 corpus=buildNewsCorpus(snapshot(cards,now),[],now);assert.equal(corpus.cards.length,4);
});
after(async()=>{await db?.close();});
test('Romanian additions preserve existing private function identities, privileges and request limits',async()=>{
 assert.equal(beforeStamp?.length,2);assert.deepEqual(afterStamp,beforeStamp);
 for(const role of ['anon','authenticated','service_role','untrusted_visitor'])for(const signature of signatures)
  assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') value",[role,signature])).rows[0].value,false);
 assert.ok(validNewsDiagnostics(result.diagnostics,now));assert.equal(await valid('valid_news_diagnostics',result.diagnostics),true);
 assert.equal(result.diagnostics.indexes.length,32);
});
test('SQL accepts the observed original candidates and corpus while rejecting undeclared origins and paths',async()=>{
 for(const [id,feed] of Object.entries(feeds)){
  const index=NEWS_DISCOVERY_INDEXES.find(value=>value.id===id+'-ro-news');
  const candidates=readPublisherNewsCandidates(specialistFeed(id),index,now);assert.equal(candidates.length,2);
  for(const candidate of candidates){assert.equal(await valid('valid_news_candidate',candidate),true);assert.equal(await valid('valid_news_candidate',{...candidate,category:null}),true);}
  const row=rows.find(value=>value.publisherId===id);
  const invalid=[row.url.replace('https:','http:'),row.url.replace(feed.origin,feed.origin+'.attacker.invalid'),row.url.replace('https://','https://user@'),feed.origin+'/',feed.origin+'/api/story'];
  if(id==='spotmedia')invalid.push('https://spotmedia.ro/outside-news/story','https://www.spotmedia.ro/stiri/story');
  else invalid.push('https://descopera.ro/stiinta/story');
  for(const url of invalid){
   assert.equal(canonicalNewsUrl(url),null);
   assert.equal((await db.query('select dlkt_info_private.valid_news_candidate_publisher($1,$2) value',[feed.publisher,url])).rows[0].value,false,url);
   assert.equal(await valid('valid_news_candidate',{...candidates[0],sourceUrl:url}),false);
  }
  assert.equal((await db.query('select dlkt_info_private.valid_news_candidate_publisher($1,$2) value',['Wrong publisher',row.url])).rows[0].value,false);
 }
 assert.equal(await valid('valid_news_corpus',corpus),true);
});
test('SQL rejects changed new-source identity, language, duplicate indexes and excessive requests',async()=>{
 for(const id of Object.keys(feeds)){
  for(const change of [row=>{row.language='en';},row=>{row.publisherId='hotnews';}]){
   const diagnostics=structuredClone(result.diagnostics);change(diagnostics.indexes.find(row=>row.indexId===id+'-ro-news'));
   assert.equal(validNewsDiagnostics(diagnostics,now),false);assert.equal(await valid('valid_news_diagnostics',diagnostics),false);
  }
 }
 const duplicate=structuredClone(result.diagnostics);duplicate.indexes.push({...duplicate.indexes[0]});
 assert.equal(await valid('valid_news_diagnostics',duplicate),false);
 const excessive=structuredClone(result.diagnostics),group=excessive.groups.find(row=>row.publisherId==='descopera');
 excessive.totals.requestAttempts+=81-group.counts.requestAttempts;group.counts.requestAttempts=81;
 assert.equal(validNewsDiagnostics(excessive,now),false);assert.equal(await valid('valid_news_diagnostics',excessive),false);
});
