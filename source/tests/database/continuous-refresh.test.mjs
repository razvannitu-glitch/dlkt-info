import assert from 'node:assert/strict';
import {before, beforeEach, after, test} from 'node:test';
import {readFile, readdir} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {cardContent} from '../../.build/src/iceo/card-validation.js';
import {ICEO_SOURCES} from '../../.build/src/iceo/registry.js';
import {NEWS_PUBLISHERS} from '../../.build/src/iceo/news-sources.js';
import {EXPECTED_SCHEMA_FINGERPRINT, DATABASE_READINESS_MIGRATION} from '../../.build/src/provisioning/readiness-manifest.js';

const key='test-only-continuous-refresh-writer-key-12345678901234567890';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const source=ICEO_SOURCES.find(s=>s.id==='ecb-news');
let db;
function snapshot(time=Date.now()) {
  const iso=new Date(time).toISOString(), identity='https://www.ecb.europa.eu/press/pr/date/2026/html/refresh.en.html';
  const card={id:digest(identity).slice(0,24),identity,title:'Controlled current publication',topic:'business',kind:'publication',sourceUrl:identity,
    publisher:source.publisher,sourceIds:[source.id],date:new Date(time-10000).toISOString(),dateLabel:'Published',observedAt:iso,
    contentHash:'',boundary:'Official publication listing.',deadline:null,version:null,attribution:source.attribution,sourceState:'verified'};
  card.contentHash=digest(cardContent(card));
  return {version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.46',mode:'current-source-records',generatedAt:iso,state:'ready',
    sources:[{id:source.id,label:source.label,publisher:source.publisher,topic:source.topic,state:'verified',checkedAt:iso,verifiedAt:iso,count:1,rejected:0,error:null,retryAt:null,scope:source.scope,termsUrl:source.termsUrl,windowed:true}],
    cards:[card],conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:['business']};
}
async function asRole(role,fn){await db.exec(`set role ${role}`);try{return await fn();}finally{await db.exec('reset role');}}
async function headers(value){await db.query("select set_config('request.headers',$1,false)",[JSON.stringify(value)]);}
async function rpc(sql,args=[]){return (await asRole('anon',()=>db.query(sql,args))).rows[0].value;}
async function read(){return rpc('select public.dlkt_info_read_public_snapshot() value');}
async function claim(trigger={kind:'manual'}){return rpc('select public.dlkt_info_claim_public_refresh($1::uuid,$2::jsonb) value',[randomUUID(),JSON.stringify(trigger)]);}
async function publish(lease,value=snapshot(),hash=digest(value)){return rpc('select public.dlkt_info_publish_public_snapshot($1::uuid,$2::bigint,$3::jsonb,$4) value',[lease.leaseToken,lease.fence,JSON.stringify(value),hash]);}
async function fail(lease,error='collector-unavailable'){return rpc('select public.dlkt_info_fail_public_refresh($1::uuid,$2::bigint,$3) value',[lease.leaseToken,lease.fence,error]);}
function scheduled(){return {kind:'scheduled',executionId:'urn:vercel:refresh/test-1',scheduleName:'iceo-daily-top',scheduledAt:new Date().toISOString(),namespace:'default',expression:'*/2 * * * *'};}
async function readiness(){return rpc('select public.dlkt_info_read_database_readiness() value');}
async function drift(sql,check){await db.exec('begin');try{await db.exec(sql);const value=await readiness();assert.equal(value.ready,false);assert.equal(value.checks[check],false);assert.equal(value.activationReceipt,null);}finally{await db.exec('reset role; rollback');}}

before(async()=>{
  db=new PGlite();await db.waitReady;
  await db.exec(`create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;create role untrusted_visitor noinherit;
    grant usage on schema public to anon,authenticated,service_role,untrusted_visitor;
    alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;
    create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;`);
  for(const file of (await readdir('supabase/migrations')).filter(name=>name.endsWith('.sql')).sort())await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
  await db.query('insert into dlkt_info_private.share_archive_writer(key_hash) values($1)',[createHash('sha256').update(key).digest('hex')]);
});
beforeEach(async()=>{await db.exec('reset role; truncate dlkt_info_private.public_refresh_state,dlkt_info_private.public_refresh_runs; insert into dlkt_info_private.public_refresh_state(singleton) values(true)');await headers({'x-dlkt-share-write':key});});
after(async()=>{await db?.close();});

test('cold public read is exact, empty and reveals no lease, worker, trigger or writer secret',async()=>{
  await headers({});const value=await read();
  assert.deepEqual(value,{version:'iceo-shared-snapshot-1',snapshot:null,digest:null,revision:0,refreshedAt:null,lastAttemptAt:null,lastScheduledAttemptAt:null,lastScheduledSuccessAt:null,status:'empty',retryAt:null});
  assert.equal(JSON.stringify(value).includes(key),false);
});
test('all mutations deny missing, malformed, wrong and unprovisioned writer authentication',async()=>{
  for(const header of [{},{'x-dlkt-share-write':'invalid'},{'x-dlkt-share-write':'x'.repeat(43)}]){
    await headers(header);await assert.rejects(claim(),{code:'42501'});
    await assert.rejects(publish({leaseToken:randomUUID(),fence:1}),{code:'42501'});
    await assert.rejects(fail({leaseToken:randomUUID(),fence:1}),{code:'42501'});
  }
  await db.query("select set_config('request.headers','broken-json',false)");await assert.rejects(claim(),{code:'42501'});
  await headers({'x-dlkt-share-write':key});
  await db.exec('delete from dlkt_info_private.share_archive_writer');try{await assert.rejects(claim(),{code:'42501'});}finally{await db.query('insert into dlkt_info_private.share_archive_writer(key_hash) values($1)',[createHash('sha256').update(key).digest('hex')]);}
  await assert.rejects(asRole('untrusted_visitor',()=>db.query('select public.dlkt_info_read_public_snapshot()')),{code:'42501'});
});
test('only one claim wins; other workers receive neither the active token nor a second lease',async()=>{
  const first=await claim(),second=await claim();assert.equal(first.state,'claimed');assert.equal(second.state,'busy');assert.equal(first.fence,1);assert.equal(second.fence,1);
  assert.ok(first.leaseToken);assert.equal(second.leaseToken,null);assert.equal(second.leaseExpiresAt,null);
  assert.equal((await read()).status,'refreshing');assert.equal((await db.query('select count(*)::int count from dlkt_info_private.public_refresh_runs')).rows[0].count,1);
});
test('expired worker is fenced out after a fresh claim, including its failure receipt',async()=>{
  const old=await claim();await db.exec("update dlkt_info_private.public_refresh_state set lease_expires_at=clock_timestamp()-interval '1 second'");
  const current=await claim();assert.equal(current.fence,old.fence+1);assert.notEqual(current.leaseToken,old.leaseToken);
  await assert.rejects(publish(old),{code:'55000'});assert.deepEqual(await fail(old),{recorded:false,retryAt:null});
  const value=await publish(current);assert.equal(value.revision,1);assert.equal(value.status,'ready');
  assert.deepEqual((await db.query('select outcome from dlkt_info_private.public_refresh_runs order by fence')).rows.map(r=>r.outcome),['expired','succeeded']);
});
test('successful publication atomically exposes catalog, digest and authoritative scheduled receipt',async()=>{
  const lease=await claim(scheduled()),value=snapshot();const result=await publish(lease,value);
  assert.deepEqual(result.snapshot,value);assert.equal(result.digest,digest(value));assert.equal(result.revision,1);assert.equal(result.status,'ready');
  assert.ok(result.lastScheduledAttemptAt);assert.ok(result.lastScheduledSuccessAt);assert.ok(result.refreshedAt);
  assert.deepEqual(await read(),result);assert.equal((await claim()).state,'complete');
  const stored=(await db.query('select outcome,finished_at,digest from dlkt_info_private.public_refresh_runs')).rows[0];assert.equal(stored.outcome,'succeeded');assert.equal(stored.digest,result.digest);assert.ok(stored.finished_at);
  assert.equal(Object.keys(result).length,10);
});
test('failed refresh retains last good snapshot and applies bounded server-owned backoff',async()=>{
  const original=await publish(await claim());
  for(const seconds of [30,60,120,300,300]){
    await db.exec('update dlkt_info_private.public_refresh_state set successful_slot=-1,retry_at=null');
    const lease=await claim(),result=await fail(lease);assert.equal(result.recorded,true);
    const wait=Date.parse(result.retryAt)-Date.now();assert.ok(wait>seconds*1000-1000&&wait<=seconds*1000+500);
    const current=await read();assert.equal(current.status,'backoff');assert.deepEqual(current.snapshot,original.snapshot);assert.equal(current.digest,original.digest);assert.equal(current.revision,1);assert.equal(current.refreshedAt,original.refreshedAt);
    const blocked=await claim();assert.equal(blocked.state,'backoff');assert.equal(blocked.leaseToken,null);
  }
});
test('successful scheduled execution replay is suppressed after slot rollover; failed execution can retry',async()=>{
  const trigger=scheduled(),lease=await claim(trigger);await publish(lease);
  await db.exec('update dlkt_info_private.public_refresh_state set successful_slot=successful_slot-1');
  const replay=await claim(trigger);assert.equal(replay.state,'complete');assert.equal(replay.leaseToken,null);assert.equal(replay.fence,lease.fence);
  const next={...trigger,executionId:'urn:vercel:refresh/test-2'},attempt=await claim(next);assert.equal(attempt.state,'claimed');await fail(attempt);
  await db.exec('update dlkt_info_private.public_refresh_state set retry_at=null');assert.equal((await claim(next)).state,'claimed');
});
test('snapshot validation rejects private data, forged provenance, hash mismatch and malformed payload without replacing current',async()=>{
  const original=await publish(await claim());await db.exec('update dlkt_info_private.public_refresh_state set successful_slot=-1');const lease=await claim();
  const attacks=[v=>{v.ownerId='private';},v=>{v.product=null;},v=>{v.state='unavailable';},v=>{v.cards[0].ownerId='private';},v=>{v.cards[0].contentHash='0'.repeat(64);},v=>{v.cards[0].sourceIds=['unknown'];},v=>{v.sources[0].publisher='Forged';},v=>{v.sources[0].count=0;},v=>{v.sources[0].verifiedAt='infinity';},v=>{v.sources=[];},v=>{v.cards.push(v.cards[0]);},v=>{v.coverage=[];},v=>{v.cards[0].summary='x'.repeat(1048576);},v=>{v.generatedAt=new Date(Date.now()-600000).toISOString();},v=>{v.generatedAt=new Date(Date.now()+600000).toISOString();}];
  for(const attack of attacks){const value=snapshot(Date.now()+1);attack(value);await assert.rejects(publish(lease,value),{code:'22023'});const current=await read();assert.deepEqual(current.snapshot,original.snapshot);assert.equal(current.revision,1);}
  await assert.rejects(publish(lease,snapshot(),'not-sha256'),{code:'22023'});
});
test('generation cannot regress or repeat even with the current valid fencing token',async()=>{
  const value=snapshot(),first=await publish(await claim(),value);await db.exec('update dlkt_info_private.public_refresh_state set successful_slot=-1');const lease=await claim();
  await assert.rejects(publish(lease,value),{code:'22023'});
  const older=snapshot(Date.parse(value.generatedAt)-1);await assert.rejects(publish(lease,older),{code:'22023'});
  assert.equal((await read()).revision,1);const newer=snapshot(Math.max(Date.now(),Date.parse(value.generatedAt)+1));assert.equal((await publish(lease,newer)).revision,2);assert.equal(first.revision,1);
});
test('scheduled trigger rejects nulls, extra fields, old/future times and forged scheduler identities',async()=>{
  const values=[{kind:null},{kind:'manual',owner:'private'}, {...scheduled(),executionId:'bad\n'}, {...scheduled(),scheduleName:'other'}, {...scheduled(),namespace:'other'}, {...scheduled(),expression:'* * * * *'}, {...scheduled(),scheduledAt:new Date(Date.now()-601000).toISOString()}, {...scheduled(),scheduledAt:new Date(Date.now()+61000).toISOString()}];
  for(const field of Object.keys(scheduled()))values.push({...scheduled(),[field]:null});
  for(const value of values)await assert.rejects(claim(value),{code:'22023'});
  assert.equal((await claim(scheduled())).state,'claimed');
});
test('retained stale cards remain distinguishable from current verified health',async()=>{
  const value=snapshot();value.state='partial';value.cards[0].sourceState='stale';value.sources[0].state='stale';
  const current=ICEO_SOURCES.find(s=>s.id==='ecb-statistics');
  value.sources.push({...value.sources[0],id:current.id,label:current.label,publisher:current.publisher,topic:current.topic,scope:current.scope,termsUrl:current.termsUrl,state:'verified',count:0});
  const result=await publish(await claim(),value);assert.equal(result.snapshot.cards[0].sourceState,'stale');assert.equal(result.snapshot.sources[0].state,'stale');
});
test('fresh catalog timestamp cannot publish old source observations or stale-only evidence',async()=>{
  const lease=await claim(),old=new Date(Date.now()-60000).toISOString();
  for(const change of [
    source=>{source.checkedAt=old;source.verifiedAt=old;},
    source=>{source.checkedAt=old;},
    source=>{source.verifiedAt=old;},
    source=>{source.state='stale';},
    source=>{source.verifiedAt=null;},
  ]){
    const value=snapshot();value.state='partial';change(value.sources[0]);
    await assert.rejects(publish(lease,value),{code:'22023',message:'PUBLIC_REFRESH_CURRENT_SOURCE_REQUIRED'});
    const current=await read();assert.equal(current.revision,0);assert.equal(current.snapshot,null);assert.equal(current.lastScheduledSuccessAt,null);
  }
  const value=snapshot();value.state='partial';value.sources[0].state='partial';assert.equal((await publish(lease,value)).revision,1);
});
test('history is bounded to720 recent attempts and removes records older than7days',async()=>{
  await db.exec("insert into dlkt_info_private.public_refresh_runs(fence,worker_id,slot,trigger,started_at,outcome,finished_at) select n,'00000000-0000-0000-0000-000000000001'::uuid,0,'{\"kind\":\"manual\"}'::jsonb,clock_timestamp()-case when n=721 then interval '8 days' else interval '1 day' end,'failed',clock_timestamp() from generate_series(1,721) n;update dlkt_info_private.public_refresh_state set fence=721");
  const lease=await claim();assert.equal(lease.fence,722);
  const row=(await db.query("select count(*)::int count,min(fence)::int minimum,max(fence)::int maximum,count(*) filter(where started_at<clock_timestamp()-interval '7 days')::int old from dlkt_info_private.public_refresh_runs")).rows[0];
  assert.ok(row.count<=720);assert.equal(row.maximum,722);assert.equal(row.old,0);assert.ok(row.minimum>1);
});
test('all REST roles lack direct private table, column, truncate and private helper privileges',async()=>{
  for(const role of ['anon','authenticated','service_role'])for(const table of ['public_refresh_state','public_refresh_runs']){
    for(const sql of [`select * from dlkt_info_private.${table}`,`update dlkt_info_private.${table} set fence=0`,`delete from dlkt_info_private.${table}`,`truncate dlkt_info_private.${table}`])await assert.rejects(asRole(role,()=>db.exec(sql)),{code:'42501'});
    await assert.rejects(asRole(role,()=>db.exec('select dlkt_info_private.require_public_refresh_writer()')),{code:'42501'});
  }
});
test('readiness preserves exact catalog and catches refresh table, column, PUBLIC execute and grant-option drift',async()=>{
  const value=await readiness();assert.equal(value.ready,true);assert.equal(value.schemaFingerprint,EXPECTED_SCHEMA_FINGERPRINT);assert.equal(value.schemaRevision,DATABASE_READINESS_MIGRATION);assert.ok(Object.values(value.checks).every(Boolean));
  await drift('grant select on dlkt_info_private.public_refresh_state to service_role','privateTables');
  await drift('grant select (trigger) on dlkt_info_private.public_refresh_runs to anon','privateTables');
  await drift('grant execute on function public.dlkt_info_claim_public_refresh(uuid,jsonb) to public','publicRpcPermissions');
  await drift('grant execute on function public.dlkt_info_read_public_snapshot() to anon with grant option','publicRpcPermissions');
  await drift("alter function public.dlkt_info_publish_public_snapshot(uuid,bigint,jsonb,text) set search_path=public",'searchPath');
});

test('national news origins preserve every reviewed family and reject spoofed or mismatched publishers',async()=>{
  assert.equal(NEWS_PUBLISHERS.length,77);
  for(const publisher of NEWS_PUBLISHERS)for(const origin of publisher.origins){
    const value=(await db.query('select dlkt_info_private.valid_news_candidate_publisher($1,$2) allowed',[publisher.label,origin+(['stirile-protv','spotmedia'].includes(publisher.id)?'/stiri/reviewed-origin-check':'/news/reviewed-origin-check')])).rows[0].allowed;
    assert.equal(value,true,origin+' must remain valid');
  }
  const invalid=[
    ['Digi24','https://www.digi24.ro.attacker.invalid/stiri/item'],
    ['Digi24','https://digi24.ro/stiri/item'],
    ['Digi24','http://www.digi24.ro/stiri/item'],
    ['HotNews.ro','https://www.digi24.ro/stiri/item'],
    ['Digi24','https://www.digi24.ro/'],
    ['Digi24','https://www.digi24.ro/account/item'],
    ['Digi24','https://www.digi24.ro/stiri/../item'],
    ['Digi24','https://www.digi24.ro/stiri/item?utm_source=tracking'],
    ['HotNews.ro','https://hotnews.ro/item#fragment'],
  ];
  for(const [publisher,url] of invalid)assert.equal(
    (await db.query('select dlkt_info_private.valid_news_candidate_publisher($1,$2) allowed',[publisher,url])).rows[0].allowed,false,url);
  assert.equal((await readiness()).ready,true);
});
test('publisher allowlist remains private and the expanded origins do not bypass writer authentication',async()=>{
  await assert.rejects(asRole('anon',()=>db.query("select dlkt_info_private.valid_news_candidate_publisher('Digi24','https://www.digi24.ro/stiri/item')")),{code:'42501'});
  await headers({});
  const candidate={sourceUrl:'https://www.digi24.ro/stiri/test-item',title:'Controlled original title',publisher:'Digi24',indexedAt:new Date().toISOString(),category:'world'};
  await assert.rejects(asRole('anon',()=>db.query('select public.dlkt_info_upsert_news_candidates($1::jsonb)',[JSON.stringify([candidate])])),{code:'42501'});
});
