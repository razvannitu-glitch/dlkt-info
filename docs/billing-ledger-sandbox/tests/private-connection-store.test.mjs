import test from 'node:test';
import assert from 'node:assert/strict';
import {PrivateConnectionVaultStore} from '../.billing-build/docs/billing-ledger-sandbox/private-connection-store.js';
import {digest,seal,unseal} from '../.billing-build/source/src/connections/crypto.js';
const owner='00000000-0000-4000-8000-000000000008',session='20000000-0000-4000-8000-000000000008',other='00000000-0000-4000-8000-000000000009';
const id='40000000-0000-4000-8000-000000000008',r1='50000000-0000-4000-8000-000000000008',r2='60000000-0000-4000-8000-000000000008';
const now=1795695000000,clock=()=>now,sh=digest(owner+':'+session),stateHash='A'.repeat(43),key=Buffer.alloc(32,17).toString('base64url');
const jwt=patch=>['fixtureHeader',Buffer.from(JSON.stringify({sub:owner,role:'authenticated',session_id:session,exp:now/1000+300,...patch})).toString('base64url'),'fixtureSignature'].join('.');
const identity=patch=>({user:{id:owner,email:'fixture@example.test'},accessToken:jwt(patch),refreshed:false});
const encrypted=seal({refreshToken:'synthetic'},key,'grant:'+owner+':gmail:'+id);
const connected=new Date(now-60000).toISOString(),expires=new Date(now+300000).toISOString();
const row={owner_id:owner,provider_id:'gmail',connection_id:id,account_label:'Fixture',status:'connected',sealed_grant:encrypted,connected_at:connected,last_sync_at:null,operation_expires_at:null,revision:r1};
const connection={ownerId:owner,providerId:'gmail',id,accountLabel:'Fixture',status:'connected',sealedGrant:encrypted,connectedAt:connected,lastSyncAt:null,operationExpiresAt:null,revision:r1};
const pending={ownerId:owner,providerId:'gmail',stateHash,sessionHash:sh,sealedVerifier:encrypted,expiresAt:expires};
const pendingRow={owner_id:owner,provider_id:'gmail',session_id:session,state_hash:stateHash,session_hash:sh,sealed_verifier:encrypted,expires_at:expires};
function fixture(result,provider='gmail',current=clock){
 const calls=[],db={query:async(sql,params)=>{calls.push({sql,params});return result}};
 return {calls,db,store:new PrivateConnectionVaultStore(identity(),db,provider,current)};
}
test('read bound to verified session and parameterized SQL; existing AES-GCM envelope survives round trip',async()=>{
 const f=fixture([row]),v=await f.store.read('gmail');assert.deepEqual(v,connection);assert.deepEqual(unseal(v.sealedGrant,key,'grant:'+owner+':gmail:'+id),{refreshToken:'synthetic'});
 assert.deepEqual(f.calls[0].params,[owner,session,'gmail']);assert.match(f.calls[0].sql,/read_connection\(\$1::uuid,\$2::uuid,\$3::text\)/u);
 assert.equal(JSON.stringify(f.store),'{}');assert.ok(!JSON.stringify(f.calls).includes(identity().accessToken));
});
test('list handles no row and rejects duplicate, foreign-owner, oversized or malformed rows',async()=>{
 assert.deepEqual(await fixture([]).store.list(),[]);
 for(const rows of [[row,row],[{...row,owner_id:other}],Array(5).fill(row),[{...row,sealed_grant:'plaintext'}],{}])await assert.rejects(fixture(rows).store.list(),/CONNECTION_UPSTREAM_INVALID/u);
 assert.equal(await fixture([]).store.read('gmail'),null);
 await assert.rejects(fixture([{...row,provider_id:'outlook'}]).store.read('gmail'),/CONNECTION_UPSTREAM_INVALID/u);
});
test('session identity and expiry checked before any database access',()=>{
 for(const patch of [{sub:other},{role:'service_role'},{session_id:null},{is_anonymous:true},{exp:now/1000},{exp:'9999999999'}])assert.throws(()=>new PrivateConnectionVaultStore(identity(patch),{query:async()=>[]},null,clock),/CONNECTION_SESSION_INVALID/u);
});
test('save sends exact encrypted parameters and CAS revision, never raw bearer token',async()=>{
 const f=fixture([{ok:true}]);await f.store.save({...connection,revision:r2},r1);
 assert.deepEqual(f.calls[0].params,[owner,session,'gmail',id,'Fixture','connected',encrypted,connected,null,null,r2,r1]);
 assert.match(f.calls[0].sql,/save_connection\(/u);assert.ok(!f.calls[0].sql.includes(encrypted));
});
test('stale compare-and-swap and malformed write response fail closed',async()=>{
 await assert.rejects(fixture([{ok:false}]).store.save(connection,null),/CONNECTION_CONFLICT/u);
 for(const value of [[],[{ok:'true'}],[{ok:true},{ok:true}]])await assert.rejects(fixture(value).store.remove('gmail',r1),/CONNECTION_UPSTREAM_INVALID/u);
});
test('wrong owner, unchanged revision, unsafe provider or plaintext token never reach DB',async()=>{
 const f=fixture([{ok:true}]);
 for(const v of [{...connection,ownerId:other},{...connection,sealedGrant:'plaintext'},{...connection,providerId:'gmail;DROP TABLE'}])await assert.rejects(f.store.save(v,null),/CONNECTION_UPSTREAM_INVALID/u);
 await assert.rejects(f.store.save(connection,r1),/CONNECTION_UPSTREAM_INVALID/u);assert.equal(f.calls.length,0);
});
test('pending state exact owner/session and provider passed as parameters',async()=>{
 const f=fixture([{ok:true}]);await f.store.createAuthorization(pending);
 assert.deepEqual(f.calls[0].params,[owner,session,'gmail',stateHash,sh,encrypted,expires]);
 await assert.rejects(f.store.createAuthorization({...pending,sessionHash:'B'.repeat(43)}),/CONNECTION_UPSTREAM_INVALID/u);
 await assert.rejects(f.store.createAuthorization({...pending,expiresAt:new Date(now+601000).toISOString()}),/CONNECTION_UPSTREAM_INVALID/u);
});
test('consume binds callback provider and session; missing or mismatched response fails closed',async()=>{
 const f=fixture([pendingRow]);assert.deepEqual(await f.store.consumeAuthorization(stateHash),pending);
 assert.deepEqual(f.calls[0].params,[owner,session,'gmail',stateHash,sh]);
 assert.equal(await fixture([]).store.consumeAuthorization(stateHash),null);
 for(const patch of [{session_id:other},{provider_id:'outlook'},{state_hash:'C'.repeat(43)},{expires_at:new Date(now-1).toISOString()}])await assert.rejects(fixture([{...pendingRow,...patch}]).store.consumeAuthorization(stateHash),/CONNECTION_UPSTREAM_INVALID/u);
 const g=fixture([],null);await assert.rejects(g.store.consumeAuthorization(stateHash),/CONNECTION_UPSTREAM_INVALID/u);assert.equal(g.calls.length,0);
});
test('revoked DB session and transport outage map to safe errors',async()=>{
 const f=fixture([]);f.db.query=async()=>{throw {code:'28000',message:'private detail'}};
 await assert.rejects(f.store.list(),{message:'CONNECTION_SESSION_INVALID'});
 f.db.query=async()=>{throw Error('private provider credentials')};await assert.rejects(f.store.list(),{message:'CONNECTION_UPSTREAM_UNAVAILABLE'});
});
test('JWT expires during DB operation and no result is released',async()=>{
 let t=now;const f=fixture([row],'gmail',()=>t);f.db.query=async()=>{t=now+301000;return [row]};
 await assert.rejects(f.store.read('gmail'),/CONNECTION_SESSION_INVALID/u);
});
