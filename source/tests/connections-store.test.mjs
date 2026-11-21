import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SupabaseConnectionStore} from '../.build/src/connections/store.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const REV = '33333333-3333-4333-8333-333333333333';
const NEXT = '44444444-4444-4444-8444-444444444444';
const config = {state:'ready',projectRef:'abcdefghijklmnopqrst',url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_'+'p'.repeat(32)};
const jwt = (id=A,role='authenticated') => `aaaaaaaa.${Buffer.from(JSON.stringify({sub:id,role})).toString('base64url')}.cccccccc`;
const value = {id:'55555555-5555-4555-8555-555555555555',ownerId:A,providerId:'gmail',accountLabel:'Fixture Gmail',status:'connected',sealedGrant:'v1.'+'x'.repeat(60),connectedAt:'2026-11-20T12:00:00.000Z',lastSyncAt:null,operationExpiresAt:null,revision:REV};
const row = (v=value) => ({owner_id:v.ownerId,memory_key:'wallet-connection:'+v.providerId,memory_type:'preference',state:v,expires_at:null});
const pending = () => ({stateHash:'a'.repeat(43),ownerId:A,sessionHash:'b'.repeat(43),providerId:'gmail',sealedVerifier:'v1.'+'v'.repeat(60),expiresAt:new Date(Date.now()+300000).toISOString()});
const authRow = v => ({owner_id:v.ownerId,memory_key:'wallet-oauth:'+v.providerId,memory_type:'preference',state:v,expires_at:v.expiresAt});
const reply = rows => Response.json(rows);

test('connection persistence preserves the owner token, restrictive filters and bounded transport', async()=>{
  const seen=[];
  const store=new SupabaseConnectionStore(config,A,jwt(),async(url,init)=>{seen.push({url:new URL(url),init});return reply([row()]);});
  assert.deepEqual(await store.read('gmail'),value);
  const {url,init}=seen[0];
  assert.equal(url.searchParams.get('owner_id'),'eq.'+A);
  assert.equal(url.pathname,'/rest/v1/dlkt_info_user_memory');
  assert.equal(url.searchParams.get('memory_key'),'eq.wallet-connection:gmail');
  assert.equal(url.searchParams.get('memory_type'),'eq.preference');
  assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+jwt());
  assert.equal(new Headers(init.headers).get('apikey'),config.publishableKey);
  assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
});

test('constructor rejects a foreign owner, privileged token, secret key and untrusted origin',()=>{
  for(const [cfg,token] of [[config,jwt(B)],[config,jwt(A,'service_role')],[{...config,publishableKey:'sb_secret_'+ 'a'.repeat(32)},jwt()],[{...config,url:'https://attacker.invalid'},jwt()]]){
    assert.throws(()=>new SupabaseConnectionStore(cfg,A,token),/CONNECTION_SESSION_INVALID/);
  }
});

test('project references accept the same alphanumeric format as persistence configuration',async()=>{
  const cfg={...config,projectRef:'abcdefghijklmnopqr12',url:'https://abcdefghijklmnopqr12.supabase.co'};
  for(const url of [cfg.url,cfg.url+'/']) {
    const store=new SupabaseConnectionStore({...cfg,url},A,jwt(),async()=>reply([]));
    assert.deepEqual(await store.list(),[]);
  }
  for(const url of [cfg.url+'/unsafe',cfg.url+'?token=unsafe',cfg.url+'#unsafe','https://user@abcdefghijklmnopqr12.supabase.co']) {
    assert.throws(()=>new SupabaseConnectionStore({...cfg,url},A,jwt()),/CONNECTION_SESSION_INVALID/);
  }
});

test('foreign, unknown, duplicate and malformed upstream connections never escape validation',async()=>{
  for(const rows of [[row({...value,ownerId:B})],[row({...value,providerId:'yahoo'})],[row(),row()],[{...row(),access_token:'plain-secret'}],[row({...value,sealedGrant:'too-short'})]]){
    const store=new SupabaseConnectionStore(config,A,jwt(),async()=>reply(rows));
    await assert.rejects(store.list(),/CONNECTION_UPSTREAM_INVALID/);
  }
});

test('connection save is insert-only for new grants and CAS for subsequent writes',async()=>{
  for(const expected of [null,REV]){
    const next={...value,revision:NEXT,sealedGrant:'v1.'+'n'.repeat(60)};
    const store=new SupabaseConnectionStore(config,A,jwt(),async(url,init)=>{
      assert.equal(init.method,expected===null?'POST':'PATCH');
      assert.equal(new URL(url).searchParams.get('state->>revision'),expected===null?null:'eq.'+expected);
      assert.equal(new URL(url).searchParams.get('owner_id'),'eq.'+A);
      assert.deepEqual(JSON.parse(init.body),expected===null?row(next):{state:next,expires_at:null});
      assert.equal(new Headers(init.headers).get('prefer'),'return=representation');
      return reply([row(next)]);
    });
    await store.save(next,expected);
  }
  const stale=new SupabaseConnectionStore(config,A,jwt(),async()=>reply([]));
  await assert.rejects(stale.save({...value,revision:NEXT},REV),/CONNECTION_CONFLICT/);
  await assert.rejects(stale.save(value,REV),/CONNECTION_REVISION_INVALID/);
  const duplicate=new SupabaseConnectionStore(config,A,jwt(),async()=>Response.json({}, {status:409}));
  await assert.rejects(duplicate.save(value,null),/CONNECTION_CONFLICT/);
});

test('operation leases persist through CAS and reject malformed or omitted timestamps',async()=>{
  const leased={...value,operationExpiresAt:new Date(Date.now()+120000).toISOString(),revision:NEXT};
  const store=new SupabaseConnectionStore(config,A,jwt(),async(url,init)=>{
    assert.equal(new URL(url).searchParams.get('state->>revision'),'eq.'+REV);
    assert.equal(JSON.parse(init.body).state.operationExpiresAt,leased.operationExpiresAt);
    return reply([row(leased)]);
  });
  await store.save(leased,REV);
  await assert.rejects(store.save({...leased,operationExpiresAt:'infinity'},REV),/CONNECTION_INPUT_INVALID/);
  const {operationExpiresAt,...missing}=leased;
  await assert.rejects(store.save(missing,REV),/CONNECTION_INPUT_INVALID/);
});

test('unconfirmed writes and deletes are rejected instead of reported as success',async()=>{
  const wrong=new SupabaseConnectionStore(config,A,jwt(),async()=>reply([row({...value,revision:NEXT})]));
  await assert.rejects(wrong.save(value,null),/CONNECTION_WRITE_NOT_CONFIRMED/);
  await assert.rejects(wrong.remove('gmail',REV),/CONNECTION_WRITE_NOT_CONFIRMED/);
  const absent=new SupabaseConnectionStore(config,A,jwt(),async()=>reply([]));
  await assert.rejects(absent.remove('gmail',REV),/CONNECTION_CONFLICT/);
  const correct=new SupabaseConnectionStore(config,A,jwt(),async(url,init)=>{
    assert.equal(init.method,'DELETE');assert.equal(new URL(url).searchParams.get('state->>revision'),'eq.'+REV);return reply([row()]);
  });
  await correct.remove('gmail',REV);
});

test('invalid sealed material, foreign ownership and provider injection fail before network',async()=>{
  let calls=0;const store=new SupabaseConnectionStore(config,A,jwt(),async()=>{calls++;throw Error('must not request');});
  for(const change of [{ownerId:B},{providerId:'gmail&owner_id=eq.'+B},{accountLabel:'x\nsecret'},{sealedGrant:'plain'},{sealedGrant:'v1.'+'x'.repeat(65536)}]){
    await assert.rejects(store.save({...value,...change},null),/CONNECTION_INPUT_INVALID/);
  }
  await assert.rejects(store.read('unknown'),/CONNECTION_PROVIDER_INVALID/);assert.equal(calls,0);
});

test('pending state replaces only its fixed provider key with a scoped upsert',async()=>{
  const p=pending();let count=0;
  const store=new SupabaseConnectionStore(config,A,jwt(),async(url,init)=>{
    count++;assert.equal(new URL(url).pathname,'/rest/v1/dlkt_info_user_memory');
    assert.equal(new URL(url).searchParams.get('owner_id'),'eq.'+A);assert.equal(init.method,'POST');
    assert.equal(new URL(url).searchParams.get('memory_key'),'eq.wallet-oauth:gmail');
    assert.equal(new URL(url).searchParams.get('on_conflict'),'owner_id,memory_key');
    assert.equal(new Headers(init.headers).get('prefer'),'resolution=merge-duplicates,return=representation');
    assert.deepEqual(JSON.parse(init.body),authRow(p));return reply([authRow(p)]);
  });
  await store.createAuthorization(p);assert.equal(count,1);
});

test('pending hashes accept SHA256 base64url digests used by the cryptographic contract',async()=>{
  const hash=text=>createHash('sha256').update(text).digest('base64url');
  const p={...pending(),stateHash:hash('state'),sessionHash:hash('session')};
  assert.equal(p.stateHash.length,43);assert.equal(p.sessionHash.length,43);
  const store=new SupabaseConnectionStore(config,A,jwt(),async()=>reply([authRow(p)]));
  await store.createAuthorization(p);
  assert.deepEqual(await store.consumeAuthorization(p.stateHash),p);
});

test('pending expiry and invalid ownership/session binding are rejected without network',async()=>{
  let calls=0;const store=new SupabaseConnectionStore(config,A,jwt(),async()=>{calls++;throw Error('must not request');});
  const p=pending();
  for(const change of [{ownerId:B},{stateHash:'not-hashed'},{sessionHash:'not-hashed'},{stateHash:'a'.repeat(42)},{stateHash:'a'.repeat(44)},{stateHash:'a'.repeat(64)},{sessionHash:'b'.repeat(42)},{sessionHash:'b'.repeat(44)},{sessionHash:'b'.repeat(64)},{stateHash:'+'.repeat(43)},{expiresAt:new Date(Date.now()-1).toISOString()},{expiresAt:new Date(Date.now()+660000).toISOString()}]){
    await assert.rejects(store.createAuthorization({...p,...change}),/CONNECTION_AUTHORIZATION_INVALID/);
  }
  for(const hash of ['a'.repeat(42),'a'.repeat(44),'a'.repeat(64),'+'.repeat(43)])await assert.rejects(store.consumeAuthorization(hash),/CONNECTION_AUTHORIZATION_INVALID/);
  assert.equal(calls,0);
});

test('pending consume is one atomic DELETE RETURNING, validates identity, and replay returns null',async()=>{
  const p=pending();let count=0;
  const store=new SupabaseConnectionStore(config,A,jwt(),async(url,init)=>{
    count++;assert.equal(new URL(url).pathname,'/rest/v1/dlkt_info_user_memory');
    const query=new URL(url).searchParams;
    assert.equal(init.method,'DELETE');assert.equal(init.body,undefined);
    assert.equal(query.get('owner_id'),'eq.'+A);
    assert.equal(query.get('state->>stateHash'),'eq.'+p.stateHash);
    assert.equal(query.get('memory_key'),'in.(wallet-oauth:gmail,wallet-oauth:outlook,wallet-oauth:instagram,wallet-oauth:facebook-pages)');
    assert.match(query.get('expires_at'),/^gt\./);
    return reply(count===1?[authRow(p)]:[]);
  });
  assert.deepEqual(await store.consumeAuthorization(p.stateHash),p);assert.equal(await store.consumeAuthorization(p.stateHash),null);assert.equal(count,2);
  for(const bad of [{...p,ownerId:B},{...p,stateHash:'c'.repeat(43)},{...p,expiresAt:new Date(Date.now()-1).toISOString()}]){
    const wrong=new SupabaseConnectionStore(config,A,jwt(),async()=>reply([authRow(bad)]));
    await assert.rejects(wrong.consumeAuthorization(p.stateHash),/CONNECTION_(UPSTREAM_INVALID|AUTHORIZATION_INVALID)/);
  }
});

test('fixed namespace and exact DTO validation reject unrelated or tampered memory rows',async()=>{
  const p=pending();
  for(const bad of [{...authRow(p),memory_key:'wallet-profile-v1'},{...authRow(p),expires_at:new Date(Date.now()+100000).toISOString()},{...authRow(p),state:{...p,rawVerifier:'plaintext'}},{...authRow(p),state:{...p,ownerId:B}}]){
    const store=new SupabaseConnectionStore(config,A,jwt(),async()=>reply([bad]));
    await assert.rejects(store.consumeAuthorization(p.stateHash),/CONNECTION_UPSTREAM_INVALID/);
  }
  for(const bad of [{...row(),memory_key:'reader-account-v1'},{...row(),memory_type:'reading-state'},{...row(),state:{...value,accessToken:'plaintext'}}]){
    const store=new SupabaseConnectionStore(config,A,jwt(),async()=>reply([bad]));
    await assert.rejects(store.list(),/CONNECTION_UPSTREAM_INVALID/);
  }
});

test('list requests only four exact connection keys and never pending or profile records',async()=>{
  const store=new SupabaseConnectionStore(config,A,jwt(),async(url)=>{
    assert.equal(new URL(url).searchParams.get('memory_key'),'in.(wallet-connection:gmail,wallet-connection:outlook,wallet-connection:instagram,wallet-connection:facebook-pages)');
    return reply([]);
  });
  assert.deepEqual(await store.list(),[]);
});

test('upstream failures do not reflect response details or tokens',async()=>{
  for(const [status,message] of [[401,'CONNECTION_SESSION_INVALID'],[403,'CONNECTION_FORBIDDEN'],[409,'CONNECTION_CONFLICT'],[500,'CONNECTION_UPSTREAM_UNAVAILABLE']]){
    const store=new SupabaseConnectionStore(config,A,jwt(),async()=>Response.json({message:'private upstream detail'}, {status}));
    await assert.rejects(store.read('gmail'),{message});
  }
});
