import test from 'node:test';
import assert from 'node:assert/strict';
import {attestAudienceConnection} from '../lib/audience-attestation.mjs';
import {PROJECT_ID} from '../lib/production-attestation.mjs';
const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:PROJECT_ID,VERCEL_OIDC_TOKEN:'fixture-oidc',DLKT_INFO_AUDIENCE_CONNECTION_CHECK:'1',DLKT_INFO_AUDIENCE_TOKEN_SECRET:Buffer.alloc(32,7).toString('base64url')};
function fixture(overrides={}){
 const calls=[];
 const storage={audienceStorageConfig(e){calls.push('config');assert.equal(e,env);return {projectRef:'abcdefghijklmnopqrst',secretKey:'fixture-secret'};},
  SupabaseAudienceStore:class {
   constructor(){calls.push('store');}
   async operationalReady(){calls.push('ready');return true;}
   async snapshot(hours){calls.push('snapshot:'+hours);return {version:'dlkt-audience-1',retentionDays:90};}
   async record(){throw Error('WRITE_FORBIDDEN');}
   async forget(){throw Error('WRITE_FORBIDDEN');}
  },...overrides};
 return {storage,calls};
}
test('connection attestation uses only the approved production build and read-only methods',async()=>{
 const {storage,calls}=fixture();
 await attestAudienceConnection(env,storage);
 assert.deepEqual(calls,['config','store','ready','snapshot:24']);
});
test('unverified deployment identity is rejected before config or network',async()=>{
 for(const bad of [{VERCEL_ENV:'preview'},{VERCEL_PROJECT_ID:'foreign'},{VERCEL_OIDC_TOKEN:''},{DLKT_INFO_AUDIENCE_CONNECTION_CHECK:'0'}]){
  const {storage,calls}=fixture();
  await assert.rejects(attestAudienceConnection({...env,...bad},storage),/AUDIENCE_ATTESTATION_BUILD_IDENTITY/);
  assert.deepEqual(calls,[]);
 }
});
test('missing storage or malformed token refuses to connect',async()=>{
 const {storage}=fixture({audienceStorageConfig:()=>null});
 await assert.rejects(attestAudienceConnection(env,storage),/AUDIENCE_ATTESTATION_CONFIG/);
 const good=fixture({audienceStorageConfig:()=>({})});
 await assert.rejects(attestAudienceConnection({...env,DLKT_INFO_AUDIENCE_TOKEN_SECRET:'invalid'},good.storage),/AUDIENCE_ATTESTATION_CONFIG/);
});
test('unready storage and provider errors fail closed without leaking secrets',async()=>{
 const {storage,calls}=fixture({SupabaseAudienceStore:class{async operationalReady(){return false;}async snapshot(){calls.push('unexpected');}}});
 await assert.rejects(attestAudienceConnection(env,storage),/AUDIENCE_ATTESTATION_READ_FAILED/);
 assert.ok(!calls.includes('unexpected'));
 const failing=fixture({SupabaseAudienceStore:class{async operationalReady(){throw Error('sb_secret_DO_NOT_PRINT');}}});
 await assert.rejects(attestAudienceConnection(env,failing.storage),error=>error.message==='AUDIENCE_ATTESTATION_READ_FAILED');
});
test('wrong snapshot contract is rejected',async()=>{
 const {storage}=fixture({SupabaseAudienceStore:class{async operationalReady(){return true;}async snapshot(){return {version:'foreign',retentionDays:90};}}});
 await assert.rejects(attestAudienceConnection(env,storage),/AUDIENCE_ATTESTATION_READ_FAILED/);
});
