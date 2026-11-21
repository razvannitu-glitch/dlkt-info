import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const REV='33333333-3333-4333-8333-333333333333',NEXT='44444444-4444-4444-8444-444444444444';
const base={id:'55555555-5555-4555-8555-555555555555',ownerId:A,providerId:'gmail',accountLabel:'Fixture Gmail',status:'connected',sealedGrant:'v1.'+'x'.repeat(60),connectedAt:'2026-11-20T12:00:00.000Z',lastSyncAt:null,operationExpiresAt:null,revision:REV};
const providers=['gmail','outlook','instagram','facebook-pages'];
const authKeys=providers.map(id=>'wallet-oauth:'+id);
const pending=(hash='a'.repeat(43),providerId='gmail',ownerId=A)=>({stateHash:hash,ownerId,sessionHash:'b'.repeat(43),providerId,sealedVerifier:'v1.'+'v'.repeat(60),expiresAt:new Date(Date.now()+300000).toISOString()});
let db;
async function user(id,fn){
  await db.query("select set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');
  try{return await fn();}finally{await db.exec('reset role');await db.exec("select set_config('request.jwt.claim.role','',false),set_config('request.jwt.claim.sub','',false)");}
}
const insertConnection=(value=base)=>db.query("insert into public.dlkt_info_user_memory(owner_id,memory_key,memory_type,state) values($1,$2,'preference',$3::jsonb) returning state",[value.ownerId,'wallet-connection:'+value.providerId,JSON.stringify(value)]);
const upsertPending=value=>db.query("insert into public.dlkt_info_user_memory(owner_id,memory_key,memory_type,state,expires_at) values($1,$2,'preference',$3::jsonb,$4::timestamptz) on conflict(owner_id,memory_key) do update set state=excluded.state,expires_at=excluded.expires_at returning state",[value.ownerId,'wallet-oauth:'+value.providerId,JSON.stringify(value),value.expiresAt]);
// This is the SQL semantics of the store's single PostgREST DELETE with representation.
const consume=(hash,owner=A)=>db.query("delete from public.dlkt_info_user_memory where owner_id=$1 and memory_type='preference' and memory_key=any($2::text[]) and state->>'stateHash'=$3 and expires_at>clock_timestamp() returning state",[owner,authKeys,hash]);

before(async()=>{
  db=new PGlite();await db.waitReady;
  await db.exec(`create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;
    create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;`);
  await db.exec(await readFile('supabase/migrations/20261111184500_dlkt_info_data_delivery_foundation.sql','utf8'));
  await db.query('insert into auth.users(id) values($1),($2)',[A,B]);
});
beforeEach(async()=>{await db.exec('delete from public.dlkt_info_user_memory');});
after(async()=>{if(db)await db.close();});

test('existing FORCE RLS protects connection ciphertext and pending state across owners',async()=>{
  await user(A,async()=>{await insertConnection();await upsertPending(pending());});
  await user(B,async()=>{
    assert.deepEqual((await db.query('select state from public.dlkt_info_user_memory')).rows,[]);
    assert.deepEqual((await consume('a'.repeat(43),A)).rows,[]);
    assert.equal((await db.query('delete from public.dlkt_info_user_memory where owner_id=$1 returning id',[A])).rows.length,0);
    await assert.rejects(insertConnection({...base,providerId:'outlook'}),/row-level security/);
    await assert.rejects(upsertPending(pending('c'.repeat(43),'outlook',A)),/row-level security/);
  });
  await user(A,()=>assert.rejects(db.query('update public.dlkt_info_user_memory set owner_id=$1',[B]),/row-level security/));
  const flags=await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='public.dlkt_info_user_memory'::regclass");
  assert.deepEqual(flags.rows,[{relrowsecurity:true,relforcerowsecurity:true}]);
});

test('anonymous has no read or write access to the private memory table',async()=>{
  await db.exec('set role anon');
  try{
    await assert.rejects(db.query('select state from public.dlkt_info_user_memory'),/permission denied/);
    await assert.rejects(consume('a'.repeat(43)),/permission denied/);
  }finally{await db.exec('reset role');}
});

test('CAS permits one operation lease and rejects stale token refresh or stale disconnect',async()=>{
  await user(A,async()=>{
    await insertConnection();
    const sql="update public.dlkt_info_user_memory set state=$1::jsonb where owner_id=$2 and memory_key='wallet-connection:gmail' and memory_type='preference' and state->>'revision'=$3 returning state";
    const lease={...base,operationExpiresAt:new Date(Date.now()+120000).toISOString(),revision:NEXT};
    const results=await Promise.all([db.query(sql,[JSON.stringify(lease),A,REV]),db.query(sql,[JSON.stringify({...base,revision:'66666666-6666-4666-8666-666666666666'}),A,REV])]);
    assert.deepEqual(results.map(r=>r.rows.length).sort(),[0,1]);
    assert.equal((await db.query("delete from public.dlkt_info_user_memory where owner_id=$1 and memory_key='wallet-connection:gmail' and state->>'revision'=$2 returning id",[A,REV])).rows.length,0);
    await assert.rejects(insertConnection(),/duplicate key/);
  });
});

test('an OAuth callback atomically consumes state once and preserves session/provider identity',async()=>{
  const p=pending();
  await user(A,async()=>{
    await upsertPending(p);
    const results=await Promise.all([consume(p.stateHash),consume(p.stateHash)]);
    assert.deepEqual(results.map(r=>r.rows.length).sort(),[0,1]);
    const row=results.find(r=>r.rows.length).rows[0];assert.deepEqual(row.state,p);
    assert.equal((await consume(p.stateHash)).rows.length,0);
  });
});

test('a new authorization replaces only the previous attempt for that provider',async()=>{
  await user(A,async()=>{
    const old=pending(),next=pending('c'.repeat(43)),other=pending('d'.repeat(43),'outlook');
    await upsertPending(old);await upsertPending(other);await upsertPending(next);
    assert.equal((await consume(old.stateHash)).rows.length,0);
    assert.deepEqual((await consume(next.stateHash)).rows,[{state:next}]);
    assert.deepEqual((await consume(other.stateHash)).rows,[{state:other}]);
  });
});

test('four fixed OAuth keys keep repeated attempts bounded within their namespace',async()=>{
  await user(A,async()=>{
    for(let attempt=0;attempt<3;attempt++)for(const [index,id] of providers.entries())await upsertPending(pending((attempt*4+index).toString(16).padStart(43,'0'),id));
    const rows=await db.query("select memory_key from public.dlkt_info_user_memory where memory_key=any($1::text[]) order by memory_key",[authKeys]);
    assert.deepEqual(rows.rows.map(r=>r.memory_key),[...authKeys].sort());
  });
});

test('expired state cannot be consumed and a new attempt replaces the expired record',async()=>{
  await user(A,async()=>{
    const old={...pending(),expiresAt:new Date(Date.now()-1000).toISOString()};
    await upsertPending(old);assert.equal((await consume(old.stateHash)).rows.length,0);
    const next=pending('c'.repeat(43));await upsertPending(next);
    assert.deepEqual((await consume(next.stateHash)).rows,[{state:next}]);
  });
});

test('callback deletion cannot touch profile, reader or connection namespaces',async()=>{
  await user(A,async()=>{
    const p=pending();await upsertPending(p);await insertConnection();
    for(const key of ['wallet-profile-v1','reader-account-v1'])await db.query("insert into public.dlkt_info_user_memory(owner_id,memory_key,memory_type,state) values($1,$2,'preference',$3::jsonb)",[A,key,JSON.stringify({stateHash:p.stateHash})]);
    assert.equal((await consume(p.stateHash)).rows.length,1);
    const rows=await db.query('select memory_key from public.dlkt_info_user_memory order by memory_key');
    assert.deepEqual(rows.rows.map(r=>r.memory_key),['reader-account-v1','wallet-connection:gmail','wallet-profile-v1']);
  });
});
