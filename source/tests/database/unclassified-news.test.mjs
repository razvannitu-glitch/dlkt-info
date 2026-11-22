import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {readFile, readdir} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {cardContent} from '../../.build/src/iceo/card-validation.js';
import {validArchiveCard} from '../../.build/src/share/archive.js';
import {ICEO_SOURCES} from '../../.build/src/iceo/registry.js';
import {NEWS_UNCLASSIFIED_SOURCE} from '../../.build/src/iceo/news-sources.js';
import {PUBLIC_TOPICS} from '../../.build/src/iceo/topics.js';
import {EXPECTED_SCHEMA_FINGERPRINT} from '../../.build/src/provisioning/readiness-manifest.js';

const revision='20261121080311_dlkt_info_continuous_refresh.sql';
const key='fixture-only-unclassified-writer-123456789012345678901234567890';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash=value=>createHash('sha256').update(value).digest('hex');
let db,now,beforeRows,beforeShares;
function candidate(patch={}){return {sourceUrl:'https://www.theguardian.com/2026/nov/21/specialist-report',title:'A specialist development recorded today',publisher:'The Guardian',indexedAt:new Date(now-10000).toISOString(),category:null,...patch};}
function card(patch={}){const identity=candidate().sourceUrl;const value={id:digest(identity).slice(0,24),identity,title:candidate().title,topic:'other',kind:'publication',sourceUrl:identity,
 publisher:'The Guardian',sourceIds:['news-unclassified'],date:new Date(now-10000).toISOString(),dateLabel:'Published',observedAt:new Date(now).toISOString(),contentHash:'',boundary:'Original publisher listing; no independent confirmation.',deadline:null,version:null,attribution:'Source: The Guardian.',sourceState:'verified',...patch};value.contentHash=digest(cardContent(value));return value;}
function oldCard(){const identity='https://www.ecb.europa.eu/press/pr/date/2026/html/preserved.en.html';return card({id:digest(identity).slice(0,24),identity,sourceUrl:identity,topic:'business',publisher:'European Central Bank',sourceIds:['ecb-news']});}
function snapshot(cards=[card()]){const iso=new Date(now).toISOString();return {version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.46',mode:'current-source-records',generatedAt:iso,state:'ready',
 sources:ICEO_SOURCES.map(s=>({id:s.id,label:s.label,publisher:s.publisher,topic:s.topic,state:'verified',checkedAt:iso,verifiedAt:iso,count:cards.filter(c=>c.sourceIds.includes(s.id)).length,rejected:0,error:null,retryAt:null,scope:s.scope,termsUrl:s.termsUrl,windowed:true})),
 cards,conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:[...new Set(cards.map(c=>c.topic))]};}
async function role(name,fn){await db.exec(`set role ${name}`);try{return await fn();}finally{await db.exec('reset role');}}
async function headers(value){await db.query("select set_config('request.headers',$1,false)",[JSON.stringify(value)]);}
async function write(values){return (await role('anon',()=>db.query('select public.dlkt_info_upsert_news_candidates($1::jsonb) value',[JSON.stringify(values)]))).rows[0].value;}
async function valid(value){return (await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) value',[JSON.stringify(value)])).rows[0].value;}
async function ready(){return (await role('anon',()=>db.query('select public.dlkt_info_read_database_readiness() value'))).rows[0].value;}
async function user(id,fn){await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[id]);try{return await role('authenticated',fn);}finally{await db.exec("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','',false)");}}

before(async()=>{
 db=new PGlite();await db.waitReady;now=Date.now();
 await db.exec(`create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;
 grant usage on schema public to anon,authenticated,service_role;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'::jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;`);
 for(const file of (await readdir('supabase/migrations')).filter(file=>file.endsWith('.sql')).sort()){
  if(file===revision){
   assert.equal((await ready()).schemaFingerprint,'dca02b4fa88e55faa745b06c71f9a0e1ae1ed9b61b40d83faa51d1c1d6def4a7');
   await db.query('insert into dlkt_info_private.share_archive_writer(key_hash) values($1)',[hash(key)]);
   await headers({'x-dlkt-share-write':key});
   await write([candidate({sourceUrl:'https://www.ign.com/articles/existing-launch',title:'GTA VI launch',publisher:'IGN',category:'gaming'})]);
   await role('anon',()=>db.query('select public.dlkt_info_capture_shared_card($1::jsonb,$2::timestamptz,$3::timestamptz,false)',[JSON.stringify(oldCard()),new Date(now).toISOString(),new Date(now+300000).toISOString()]));
   beforeRows=(await db.query('select * from public.dlkt_info_news_candidates')).rows;
   beforeShares=(await db.query('select * from public.dlkt_info_shared_cards')).rows;
  }
  await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
 }
 await db.query('insert into auth.users(id) values($1),($2)',[A,B]);
});
after(async()=>{await db?.close();});

test('forward upgrade preserves existing candidates, immutable shared revisions and previous source validation',async()=>{
 assert.deepEqual((await db.query('select * from public.dlkt_info_news_candidates')).rows,beforeRows);
 assert.deepEqual((await db.query('select * from public.dlkt_info_shared_cards')).rows,beforeShares);
 assert.equal(await valid(oldCard()),true);const readiness=await ready();assert.equal(readiness.ready,true);assert.equal(readiness.schemaFingerprint,EXPECTED_SCHEMA_FINGERPRINT);
 assert.equal(readiness.counts.relationsExpected,33);assert.equal(readiness.counts.functionsExpected,67);
});

test('explicit JSON null category is accepted and round-trips through the existing authenticated-writer RPC',async()=>{
 assert.equal((await write([candidate()])).accepted,1);
 const row=(await role('anon',()=>db.query('select category,title,publisher from public.dlkt_info_news_candidates where source_url=$1',[candidate().sourceUrl]))).rows[0];
 assert.deepEqual(row,{category:null,title:candidate().title,publisher:'The Guardian'});
 const value=(await db.query('select dlkt_info_private.valid_news_candidate($1::jsonb,clock_timestamp()) value',[JSON.stringify(candidate())])).rows[0].value;assert.equal(value,true);
});

test('missing, fabricated or non-string category and malformed source metadata remain rejected',async()=>{
 const missing=candidate();delete missing.category;
 for(const value of [missing,...['other','unclassified','null','',false,17,{},[]].map(category=>candidate({category})),candidate({ownerId:A}),candidate({publisher:'IGN'}),candidate({sourceUrl:'https://www.theguardian.com.attacker.invalid/a'}),candidate({indexedAt:'infinity'})])await assert.rejects(write([value]),{code:'22023'});
 await assert.rejects(db.query('update public.dlkt_info_news_candidates set category=$1 where source_url=$2',['invented',candidate().sourceUrl]),{code:'23514'});
});

test('null category does not weaken writer authentication, direct-write denial or cache monotonicity',async()=>{
 await headers({});await assert.rejects(write([candidate()]),{code:'42501'});await headers({'x-dlkt-share-write':key});
 for(const name of ['anon','authenticated','service_role'])await assert.rejects(role(name,()=>db.exec('update public.dlkt_info_news_candidates set category=null')),{code:'42501'});
 assert.equal((await write([candidate({title:'Older replacement',indexedAt:new Date(now-20000).toISOString()})])).accepted,0);
 assert.equal((await db.query('select title from public.dlkt_info_news_candidates where source_url=$1',[candidate().sourceUrl])).rows[0].title,candidate().title);
});

test('unclassified share cards retain exact publisher, URL, identity, topic, body and homepage restrictions',async()=>{
 const value=card();assert.equal(validArchiveCard(value),true);assert.equal(await valid(value),true);
 assert.equal(await valid(card({sourceIds:['news-unclassified','editorial-frontpage']})),true);
 const alternate='https://www.theguardian.com/2026/nov/21/different-record';
 for(const patch of [{topic:'world'},{sourceIds:['news-world']},{sourceIds:['news-unclassified','news-world']},{sourceIds:['ecb-news']},{publisher:'IGN'},{identity:alternate,id:digest(alternate).slice(0,24)},{summary:'An unlicensed article body'},{sourceUrl:'https://evil.invalid/a'},{dateLabel:'Updated'}])assert.equal(await valid(card(patch)),false,JSON.stringify(patch));
 const noHomepage='https://www.ign.com/articles/specialist-report';assert.equal(await valid(card({identity:noHomepage,id:digest(noHomepage).slice(0,24),sourceUrl:noHomepage,publisher:'IGN',sourceIds:['news-unclassified','editorial-frontpage']})),false);
 const captured=(await role('anon',()=>db.query('select public.dlkt_info_capture_shared_card($1::jsonb,$2::timestamptz,$3::timestamptz,false) value',[JSON.stringify(value),new Date(now).toISOString(),new Date(now+300000).toISOString()]))).rows[0].value;
 assert.deepEqual(captured.card,value);
});

test('snapshot accepts the exact 51-source registry and other coverage only with correctly sourced cards',async()=>{
 assert.equal(ICEO_SOURCES.length,51);assert.equal(NEWS_UNCLASSIFIED_SOURCE.topic,'other');
 const value=snapshot();const sql='select dlkt_info_private.valid_public_refresh_snapshot($1::jsonb,clock_timestamp()) value';
 assert.equal((await db.query(sql,[JSON.stringify(value)])).rows[0].value,true);
 for(const mutate of [v=>{v.coverage=[];},v=>{v.sources.find(s=>s.id==='news-unclassified').topic='world';},v=>{v.sources.find(s=>s.id==='news-unclassified').publisher='Fake';},v=>{v.cards[0]=card({sourceIds:['editorial-frontpage']});}]){
  const attack=structuredClone(value);mutate(attack);assert.equal((await db.query(sql,[JSON.stringify(attack)])).rows[0].value,false);
 }
 const lease=(await role('anon',()=>db.query('select public.dlkt_info_claim_public_refresh($1::uuid,$2::jsonb) value',[randomUUID(),JSON.stringify({kind:'manual'})]))).rows[0].value;
 const published=(await role('anon',()=>db.query('select public.dlkt_info_publish_public_snapshot($1::uuid,$2::bigint,$3::jsonb,$4) value',[lease.leaseToken,lease.fence,JSON.stringify(value),digest(value)]))).rows[0].value;
 assert.deepEqual(published.snapshot,value);
});

test('all 21 public coverage topics fit without turning unknown into an inferred interest',async()=>{
 const cards=PUBLIC_TOPICS.map((topic,index)=>{if(topic==='other')return card();const identity=`https://www.ecb.europa.eu/press/pr/date/2026/html/coverage-${index}.en.html`;return card({id:digest(identity).slice(0,24),identity,sourceUrl:identity,topic,publisher:'European Central Bank',sourceIds:['ecb-news']});});
 const value=snapshot(cards);assert.equal(value.coverage.length,21);
 assert.equal((await db.query('select dlkt_info_private.valid_public_refresh_snapshot($1::jsonb,clock_timestamp()) value',[JSON.stringify(value)])).rows[0].value,true);
});

test('saved other cards round-trip through owner-only reader memory without weakening cross-account isolation',async()=>{
 const state={version:'dlkt-info-reader-account-1',revision:randomUUID(),updatedAt:new Date(now).toISOString(),value:{focus:null,cards:[card()],checkpoint:null}};
 await user(A,()=>db.query("insert into public.dlkt_info_user_memory(owner_id,memory_key,memory_type,state) values($1,'reader-account-v1','preference',$2::jsonb)",[A,JSON.stringify(state)]));
 assert.deepEqual((await user(A,()=>db.query("select state from public.dlkt_info_user_memory where memory_key='reader-account-v1'"))).rows,[{state}]);
 assert.equal((await user(B,()=>db.query("select state from public.dlkt_info_user_memory where memory_key='reader-account-v1'"))).rows.length,0);
 await assert.rejects(user(B,()=>db.query("insert into public.dlkt_info_user_memory(owner_id,memory_key,memory_type,state) values($1,'reader-forged','preference',$2::jsonb)",[A,JSON.stringify(state)])),{code:'42501'});
});

test('readiness detects loss of nullable classification or widening of the category CHECK',async()=>{
 for(const sql of ["delete from public.dlkt_info_news_candidates where category is null;alter table public.dlkt_info_news_candidates alter column category set not null", "alter table public.dlkt_info_news_candidates drop constraint dlkt_info_news_candidates_category_check;alter table public.dlkt_info_news_candidates add constraint dlkt_info_news_candidates_category_check check(category is null or length(category)>0)"]){
  await db.exec('begin');try{await db.exec(sql);const value=await ready();assert.equal(value.ready,false);assert.equal(value.checks.publicDataPermissions,false);assert.equal(value.activationReceipt,null);}finally{await db.exec('rollback');}
 }
 assert.equal((await ready()).ready,true);
});
