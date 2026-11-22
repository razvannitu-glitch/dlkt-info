import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {cardContent} from '../../.build/src/iceo/card-validation.js';
import {ICEO_SOURCES} from '../../.build/src/iceo/registry.js';
import {buildNewsCorpus} from '../../.build/src/iceo/news-corpus.js';
import {publicSnapshotDigest} from '../../.build/src/iceo/refresh-ledger.js';
import {validNewsDiagnostics} from '../../.build/src/iceo/news-diagnostics.js';
import {article,snapshot,local,iso} from '../fixtures/news-corpus.mjs';
const writer='test-only-news-corpus-writer-key-123456789012345678901234567890';
let db;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function asRole(role,operation){await db.exec('set role '+role);try{return await operation();}finally{await db.exec('reset role');}}
async function headers(value){await db.query("select set_config('request.headers',$1,false)",[JSON.stringify(value)]);}
async function rpc(sql,args=[]){return (await asRole('anon',()=>db.query(sql,args))).rows[0].value;}
async function claim(){return rpc('select public.dlkt_info_claim_public_refresh($1::uuid,$2::jsonb) value',[randomUUID(),JSON.stringify({kind:'manual'})]);}
async function stage(lease,corpus,diagnostics=null){return rpc('select public.dlkt_info_stage_news_corpus($1::uuid,$2::bigint,$3::jsonb,$4,$5::jsonb) value',[lease.leaseToken,lease.fence,JSON.stringify(corpus),publicSnapshotDigest(corpus),diagnostics===null?null:JSON.stringify(diagnostics)]);}
async function publish(lease,value){return rpc('select public.dlkt_info_publish_public_snapshot($1::uuid,$2::bigint,$3::jsonb,$4) value',[lease.leaseToken,lease.fence,JSON.stringify(value),publicSnapshotDigest(value)]);}
async function read(id=null){return rpc('select public.dlkt_info_read_news_corpus($1::bigint) value',[id]);}
async function lookup(record,cityId=null){return rpc('select public.dlkt_info_find_news_corpus_article($1,$2,$3,null) value',[record.id,cityId?record.documentHash:record.contentHash,cityId]);}
function pair(now=Date.now(),locals=[],count=1){
 const value=snapshot(Array.from({length:count},(_,i)=>article(i+1,{now})),now);
 return {snapshot:value,corpus:buildNewsCorpus(value,locals,now)};
}
before(async()=>{
 db=new PGlite();await db.waitReady;
 await db.exec("create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;create role untrusted_visitor noinherit;grant usage on schema public to anon,authenticated,service_role,untrusted_visitor;alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'::jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;");
 for(const file of (await readdir('supabase/migrations')).filter(name=>name.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 await db.query('insert into dlkt_info_private.share_archive_writer(key_hash) values($1)',[createHash('sha256').update(writer).digest('hex')]);
});
beforeEach(async()=>{
 await db.exec('reset role;truncate dlkt_info_private.news_corpus_epochs,dlkt_info_private.public_refresh_state,dlkt_info_private.public_refresh_runs;insert into dlkt_info_private.public_refresh_state(singleton) values(true)');
 await headers({'x-dlkt-share-write':writer});
});
after(async()=>{await db?.close();});
test('all corpus RPCs require existing server authority and private tables/helpers have no public grants',async()=>{
 for(const supplied of [{},{'x-dlkt-share-write':'bad'},{'x-dlkt-share-write':'x'.repeat(43)}]){
  await headers(supplied);await assert.rejects(read(),{code:'42501'});
  await assert.rejects(rpc('select public.dlkt_info_stage_news_corpus(null,null,null,null,null) value'),{code:'42501'});
  await assert.rejects(rpc('select public.dlkt_info_find_news_corpus_article(null,null,null,null) value'),{code:'42501'});}
 for(const role of ['anon','authenticated','service_role']){
  await assert.rejects(asRole(role,()=>db.exec('select * from dlkt_info_private.news_corpus_epochs')),{code:'42501'});
  await assert.rejects(asRole(role,()=>db.exec('select dlkt_info_private.publish_news_corpus(1,1,now())')),{code:'42501'});}
 await assert.rejects(asRole('untrusted_visitor',()=>db.exec('select public.dlkt_info_read_news_corpus(null)')),{code:'42501'});
});
test('staging is idempotent, immutable and invisible until the same fenced snapshot transaction publishes it',async()=>{
 const lease=await claim(),value=pair();const receipt=await stage(lease,value.corpus);
 assert.deepEqual(receipt,{epoch:String(lease.fence),digest:publicSnapshotDigest(value.corpus)});assert.deepEqual(await stage(lease,value.corpus),receipt);assert.equal(await read(),null);
 const changed=structuredClone(value.corpus);changed.cards[0].title='Changed original';changed.cards[0].contentHash=hash(cardContent(changed.cards[0]));
 await assert.rejects(stage(lease,changed),{code:'55000'});
 const result=await publish(lease,value.snapshot),stored=await read();
 assert.equal(stored.revision,result.revision);assert.equal(stored.epoch,String(lease.fence));assert.deepEqual(stored.corpus,value.corpus);
 assert.equal(stored.digest,receipt.digest);assert.equal(stored.generatedAt,value.snapshot.generatedAt);
 assert.equal(Date.parse(stored.expiresAt),Date.parse(stored.generatedAt)+3600000);
 assert.equal(JSON.stringify(stored).includes(writer),false);assert.equal('diagnostics' in stored,false);assert.equal('lease_token' in stored,false);
 await assert.rejects(stage(lease,value.corpus),{code:'55000'});
});
test('old writer without a stage remains compatible and cannot accidentally publish an unrelated earlier stage',async()=>{
 const first=await claim(),value=pair();await publish(first,value.snapshot);assert.equal(await read(),null);
 await db.exec('update dlkt_info_private.public_refresh_state set successful_slot=-1');
 const staged=await claim(),later=pair(Math.max(Date.now(),Date.parse(value.snapshot.generatedAt)+1));await stage(staged,later.corpus);
 await db.exec("update dlkt_info_private.public_refresh_state set lease_expires_at=clock_timestamp()-interval '1 second'");
 const replacement=await claim();assert.equal(replacement.fence,staged.fence+1);
 await assert.rejects(stage(staged,later.corpus),{code:'55000'});
 const next=pair(Math.max(Date.now(),Date.parse(later.snapshot.generatedAt)+1));await publish(replacement,next.snapshot);assert.equal(await read(),null);
});
test('a corpus/snapshot generation mismatch rolls back the complete publication transaction',async()=>{
 const lease=await claim(),value=pair();await stage(lease,value.corpus);
 const changed={...value.snapshot,generatedAt:iso(Date.parse(value.snapshot.generatedAt)+1000)};
 await assert.rejects(publish(lease,changed),{code:'55000'});
 assert.equal(await read(),null);const state=(await db.query('select revision,lease_token from dlkt_info_private.public_refresh_state')).rows[0];
 assert.equal(Number(state.revision),0);assert.equal(state.lease_token,lease.leaseToken);
 await publish(lease,value.snapshot);assert.ok(await read());
});
test('source metadata, original hashes and private-field allowlists are checked before staging',async()=>{
 const lease=await claim(),value=pair();
 for(const mutation of [
  corpus=>{corpus.cards[0].title='Title with old hash';},corpus=>{corpus.cards[0].writerKey=writer;},
  corpus=>{corpus.sources[0].count=2;},corpus=>{corpus.cards.push(corpus.cards[0]);},corpus=>{corpus.extra='private';},
  corpus=>{corpus.cards[0].sourceUrl='https://attacker.invalid/article';},corpus=>{corpus.orderVersion='unknown';},
 ]){
  const invalid=structuredClone(value.corpus);mutation(invalid);await assert.rejects(stage(lease,invalid),{code:'22023'});assert.equal(await read(),null);}
});
test('full local corpus preserves quote, licence, geography and strict72hour/check boundaries in SQL',async()=>{
 const now=Date.now(),entry=local(25,{now}),value=pair(now,[entry]),lease=await claim();
 await stage(lease,value.corpus);await publish(lease,value.snapshot);assert.equal((await read()).corpus.local[0].snapshot.articles.length,25);
 const article=entry.snapshot.articles[0];
 const valid=async(record,time)=>Boolean((await db.query('select dlkt_info_private.valid_news_local_article($1::jsonb,$2::jsonb,$3::timestamptz) valid',[JSON.stringify(record),JSON.stringify(entry.city),iso(time)])).rows[0].valid);
 assert.equal(await valid(article,now),true);assert.equal(await valid(article,Date.parse(article.validUntil)),false);
 const old={...article,publishedAt:iso(now-72*3600000)};assert.equal(await valid(old,now),true);assert.equal(await valid(old,now+1),false);
 assert.equal(await valid({...article,geoAnchors:['London']},now),false);assert.equal(await valid({...article,sourceId:'unknown'},now),false);
});
test('an exact older local feed revision remains resolvable after a newer epoch publishes',async()=>{
 const now=Date.now(),old=local(1,{now}),first=pair(now,[old]),lease=await claim();await stage(lease,first.corpus);await publish(lease,first.snapshot);
 await db.exec('update dlkt_info_private.public_refresh_state set successful_slot=-1');
 const newerAt=Math.max(Date.now(),now+1),newer=local(2,{now:newerAt}),second=pair(newerAt,[newer]),next=await claim();
 await stage(next,second.corpus);await publish(next,second.snapshot);assert.notEqual(old.snapshot.articles[0].documentHash,newer.snapshot.articles[0].documentHash);
 const found=await lookup(old.snapshot.articles[0],'683506');assert.equal(found.kind,'local');assert.deepEqual(found.article,old.snapshot.articles[0]);
 assert.deepEqual((await read(String(lease.fence))).corpus,first.corpus);
 await db.query("update dlkt_info_private.news_corpus_epochs set generated_at=statement_timestamp()-interval '2 hours',expires_at=statement_timestamp()-interval '1 hour' where fence=$1",[lease.fence]);
 assert.equal(await lookup(old.snapshot.articles[0],'683506'),null);
});
test('diagnostics publish atomically to private state/run and never appear in the public epoch envelope',async()=>{
 const lease=await claim(),value=pair(),zero={freshDiscovered:0,pool:0,scheduled:0,attempted:0,requestAttempts:0,verifiedNow:0,rejected:0,duplicates:0,deferredCapacity:0,deferredBeforeAttempt:0,retained:0};
 const diagnostics={version:'dlkt-news-diagnostics-1',checkedAt:value.snapshot.generatedAt,indexes:[],groups:[],totals:zero,issues:[]};
 assert.ok(validNewsDiagnostics(diagnostics));await stage(lease,value.corpus,diagnostics);
 assert.equal((await db.query('select news_diagnostics from dlkt_info_private.public_refresh_state')).rows[0].news_diagnostics,null);
 await publish(lease,value.snapshot);
 for(const table of ['public_refresh_state','public_refresh_runs'])assert.deepEqual((await db.query('select news_diagnostics from dlkt_info_private.'+table)).rows[0].news_diagnostics,diagnostics);
 const publicValue=await read();assert.equal('diagnostics' in publicValue,false);assert.equal(JSON.stringify(publicValue).includes('freshDiscovered'),false);
});
