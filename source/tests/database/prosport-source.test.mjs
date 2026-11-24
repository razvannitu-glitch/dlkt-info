import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {NEWS_DISCOVERY_INDEXES,canonicalNewsUrl} from '../../.build/src/iceo/news-sources.js';
import {discoverNewsWithDiagnostics,readPublisherNewsCandidates} from '../../.build/src/iceo/news-discovery.js';
import {cardContent} from '../../.build/src/iceo/card-validation.js';
import {buildNewsCorpus} from '../../.build/src/iceo/news-corpus.js';
import {validNewsDiagnostics} from '../../.build/src/iceo/news-diagnostics.js';
import {snapshot} from '../fixtures/news-corpus.mjs';
import {PROSPORT_NOW as now,PROSPORT_ROWS as rows,PROSPORT_PUBLISHER as publisher,prosportFeed,prosportFetcher} from '../fixtures/prosport-news.mjs';
const migration='20261123231500_dlkt_info_prosport_news_source.sql';
const index=NEWS_DISCOVERY_INDEXES.find(value=>value.id==='prosport-ro-news');
const signatures=['dlkt_info_private.valid_news_candidate_publisher(text,text)','dlkt_info_private.valid_news_diagnostics(jsonb,timestamp with time zone)'];
const iso=new Date(now).toISOString();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
let db,stampBefore,stampAfter,result,cards,corpus;
async function stamp(){
 return (await db.query("select p.oid::text oid,p.proname,p.proacl::text acl,p.prosecdef,p.provolatile,p.proconfig::text config,pg_get_function_identity_arguments(p.oid) arguments,(select count(*)::integer from pg_proc f join pg_namespace n on n.oid=f.pronamespace where n.nspname in ('public','dlkt_info_private')) function_count from pg_proc p where p.oid in (to_regprocedure($1),to_regprocedure($2)) order by p.proname",signatures)).rows;
}
const valid=async(name,value)=>(await db.query('select dlkt_info_private.'+name+'($1::jsonb,$2::timestamptz) value',[JSON.stringify(value),iso])).rows[0].value;
before(async()=>{
 db=new PGlite();await db.waitReady;
 await db.exec("create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;create role untrusted_visitor noinherit;grant usage on schema public to anon,authenticated,service_role,untrusted_visitor;alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'::jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;");
 for(const file of (await readdir('supabase/migrations')).filter(name=>name.endsWith('.sql')).sort()){
  if(file===migration)stampBefore=await stamp();
  await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  if(file===migration)stampAfter=await stamp();
 }
 result=await discoverNewsWithDiagnostics(prosportFetcher,now,[],undefined,{frontpageHighlights:false,maxArticleRequests:2});
 cards=result.sources.flatMap(source=>source.cards);assert.equal(cards.length,2);
 corpus=buildNewsCorpus(snapshot(cards,now),[],now);assert.equal(corpus.cards.length,2);
});
after(async()=>{await db?.close();});

test('ProSport migration preserves existing private function identities, authority and schema counts',async()=>{
 assert.equal(stampBefore?.length,2);assert.deepEqual(stampAfter,stampBefore);
 for(const role of ['anon','authenticated','service_role','untrusted_visitor'])for(const signature of signatures){
  assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') value',[role,signature])).rows[0].value,false);
 }
});

test('SQL candidate and corpus admission agrees with the reviewed ProSport original boundary',async()=>{
 const candidates=readPublisherNewsCandidates(prosportFeed(),index,now);assert.equal(candidates.length,2);
 for(const candidate of candidates){
  assert.equal(await valid('valid_news_candidate',candidate),true);
  assert.equal(await valid('valid_news_candidate',{...candidate,category:null}),true,'unknown subject remains supported');
 }
 assert.equal(await valid('valid_news_corpus',corpus),true);
 for(const url of [
  'https://prosport.ro/fotbal/story.html','https://rss.prosport.ro/fotbal/story.html',
  'https://www.prosport.ro.attacker.invalid/fotbal/story.html','http://www.prosport.ro/fotbal/story.html',
  'https://user@www.prosport.ro/fotbal/story.html','https://www.prosport.ro:444/fotbal/story.html',
  'https://www.prosport.ro/','https://www.prosport.ro/login/story.html','https://www.prosport.ro/api/story.html',
 ]){
  assert.equal(canonicalNewsUrl(url),null);
  assert.equal((await db.query('select dlkt_info_private.valid_news_candidate_publisher($1,$2) value',[publisher,url])).rows[0].value,false);
  assert.equal(await valid('valid_news_candidate',{...candidates[0],sourceUrl:url}),false);
 }
 assert.equal((await db.query('select dlkt_info_private.valid_news_candidate_publisher($1,$2) value',['Prosport',rows[0].url])).rows[0].value,false);
 const url='https://prosport.ro/fotbal/unreviewed.html';
 const moved={...cards[0],sourceUrl:url,identity:url,id:hash(url).slice(0,24),articleSubject:{...cards[0].articleSubject,articleUrl:url}};
 moved.contentHash=hash(cardContent(moved));
 assert.equal(await valid('valid_news_corpus',{...corpus,cards:[moved,cards[1]]}),false);
 assert.equal((await db.query('select dlkt_info_private.valid_news_candidate_publisher($1,$2) value',['la Repubblica','https://www.repubblica.it/politica/controlled-original/'])).rows[0].value,true,'existing reviewed publishers remain accepted');
});

test('SQL diagnostics accepts the new exact index and publisher while keeping the finite80 request cap',async()=>{
 assert.ok(validNewsDiagnostics(result.diagnostics,now));
 assert.equal(await valid('valid_news_diagnostics',result.diagnostics),true);
 const wrongLanguage=structuredClone(result.diagnostics);
 wrongLanguage.indexes.find(value=>value.indexId===index.id).language='en';
 assert.equal(await valid('valid_news_diagnostics',wrongLanguage),false);
 const wrongPublisher=structuredClone(result.diagnostics);
 wrongPublisher.groups.find(value=>value.publisherId==='prosport').publisherId='unreviewed-prosport';
 assert.equal(await valid('valid_news_diagnostics',wrongPublisher),false);
 const excessive=structuredClone(result.diagnostics),group=excessive.groups.find(value=>value.publisherId==='prosport');
 excessive.totals.requestAttempts+=81-group.counts.requestAttempts;group.counts.requestAttempts=81;
 assert.equal(validNewsDiagnostics(excessive,now),false);
 assert.equal(await valid('valid_news_diagnostics',excessive),false);
});
