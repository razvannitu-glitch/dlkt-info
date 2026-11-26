import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SecureIntegrationTransport} from './.transport-build/secure-transport.js';
import {resolveIntegrationRoute} from './.transport-build/integration-route.js';
import {prepareTemporaryProbe,validProbeIdentity} from './.transport-build/temporary-access-probe.js';
import {preparePasswordProbe} from './.transport-build/password-access-probe.js';
const ref='hziavqdhsqnihxuuxzhn',owner='00000000-0000-4000-8000-000000000101',session='10000000-0000-4000-8000-000000000101';
const ca=readFileSync(process.env.TEST_CA,'utf8'),wrongCA=readFileSync(process.env.TEST_WRONG_CA,'utf8');
const config=capability=>({mode:'integration',projectRef:ref,connectionMethod:'direct',capability,password:process.env.TEST_RUNTIME_PASSWORD,ca});
const ingest='SELECT dlkt_info_billing.ingest_notice($1::text,$2::text,$3::text,$4::text,$5::bigint) AS outcome';
const list='SELECT * FROM dlkt_info_connection_vault.list_connections($1::uuid,$2::uuid)';
test('fixed project, mode, role, CA and strong secret required',()=>{
 for(const patch of [{projectRef:'gxzpvuyawpzevwwbrlpz'},{mode:'production'},{capability:'postgres'},{password:'short'},{ca:'bad'}])
  assert.throws(()=>new SecureIntegrationTransport({...config('ingress'),...patch}),/INTEGRATION_TRANSPORT_REJECTED/u);
});
test('real TLS transport and actual role attestation, atomic duplicate ingestion',async()=>{
 const t=new SecureIntegrationTransport(config('ingress'));
 try{
  assert.deepEqual(await t.probe(),{projectRef:ref,environment:'integration',role:'dlkt_rt_ingress',encrypted:true,contractVersion:1});
  const p=['acct_1Ug2Sh77EKtnzo3p','evt_TransportFixture','invoice.paid','in_TransportFixture','1795695000'];
  assert.deepEqual(await t.query(ingest,p),[{outcome:'accepted'}]);assert.deepEqual(await t.query(ingest,p),[{outcome:'duplicate'}]);
  await assert.rejects(t.query(ingest,[...p.slice(0,3),'in_Conflict',p[4]]),{code:'23514'});
  await assert.rejects(t.query(list,[owner,session]),/INTEGRATION_TRANSPORT_REJECTED/u);
  await assert.rejects(t.query('SELECT 1',[]),/INTEGRATION_TRANSPORT_REJECTED/u);
  await assert.rejects(t.query(ingest,[...p.slice(0,4),'1;SELECT 1']),/INTEGRATION_DATABASE_REJECTED|INTEGRATION_DATABASE_UNAVAILABLE/u);
 }finally{await t.close();}
 await assert.rejects(t.probe(),/INTEGRATION_TRANSPORT_REJECTED/u);
});
test('real restricted vault role checks exact session; unauthorized role operations denied',async()=>{
 const t=new SecureIntegrationTransport(config('vault'));
 try{
  assert.equal((await t.probe()).role,'dlkt_rt_vault');assert.deepEqual(await t.query(list,[owner,session]),[]);
  await assert.rejects(t.query(list,[owner,'10000000-0000-4000-8000-000000000102']),{code:'28000'});
  await assert.rejects(t.query(ingest,[]),/INTEGRATION_TRANSPORT_REJECTED/u);
 }finally{await t.close();}
});
test('untrusted certificate refuses connection and does not leak password or original error',async()=>{
 const t=new SecureIntegrationTransport({...config('ingress'),ca:wrongCA});
 try{await assert.rejects(t.probe(),{message:'INTEGRATION_DATABASE_UNAVAILABLE'});}finally{await t.close();}
});
test('valid certificate with wrong hostname is rejected',{skip:process.env.TEST_WRONG_HOST!=='1'},async()=>{
 // Certificate for the wrong hostname is installed by a distinct CI test run.
 if(process.env.TEST_WRONG_HOST!=='1')return;
 const t=new SecureIntegrationTransport(config('ingress'));
 try{await assert.rejects(t.probe(),{message:'INTEGRATION_DATABASE_UNAVAILABLE'});}finally{await t.close();}
});

test('session pooler route pins exact uploaded CA, host, project and technical username',()=>{
 const publicCA=readFileSync(new URL('./prod-ca-2021.crt',import.meta.url),'utf8');
 const route=resolveIntegrationRoute('session-pooler',ref,'ingress',publicCA);
 assert.equal(route.host,'aws-0-eu-central-1.pooler.supabase.com');
 assert.equal(route.port,5432);
 assert.equal(route.user,'dlkt_rt_ingress.'+ref);
 assert.equal(route.role,'dlkt_rt_ingress');
 assert.throws(()=>resolveIntegrationRoute('session-pooler',ref,'ingress',ca),/INTEGRATION_TRANSPORT_REJECTED/u);
 assert.throws(()=>resolveIntegrationRoute('session-pooler','gxzpvuyawpzevwwbrlpz','ingress',publicCA),/INTEGRATION_TRANSPORT_REJECTED/u);
 assert.throws(()=>resolveIntegrationRoute('session-pooler',ref,'postgres',publicCA),/INTEGRATION_TRANSPORT_REJECTED/u);
 assert.throws(()=>resolveIntegrationRoute('direct',ref,'probe',publicCA),/INTEGRATION_TRANSPORT_REJECTED/u);
 assert.throws(()=>new SecureIntegrationTransport({...config('ingress'),connectionMethod:undefined}),/INTEGRATION_TRANSPORT_REJECTED/u);
});
test('temporary access probe accepts only scoped test token format and exact read-only identity',()=>{
 const publicCA=readFileSync(new URL('./prod-ca-2021.crt',import.meta.url),'utf8');
 const fixture='sbp_fc'+ 'A'.repeat(48); // nonsecret synthetic format fixture, never used for network
 const x=prepareTemporaryProbe({projectRef:ref,ca:publicCA,token:fixture});
 assert.equal(x.route.user,'dlkt_rt_probe.'+ref);
 assert.equal(x.route.host,'aws-0-eu-central-1.pooler.supabase.com');
 for(const token of ['sbp_legacy_fixture','',undefined,'rk_test_fixture'])assert.throws(()=>prepareTemporaryProbe({projectRef:ref,ca:publicCA,token}),/INTEGRATION_TRANSPORT_REJECTED/u);
 const good={project_ref:ref,environment:'integration',contract_version:1,login_role:'dlkt_rt_probe',effective_role:'dlkt_rt_probe',encrypted:true};
 assert.equal(validProbeIdentity(good),true);
 for(const patch of [{project_ref:'gxzpvuyawpzevwwbrlpz'},{login_role:'postgres'},{effective_role:'postgres'},{encrypted:false},{contract_version:2}])assert.equal(validProbeIdentity({...good,...patch}),false);
});

test('password pilot only accepts exact integration route and bounded non-control password',()=>{
 const publicCA=readFileSync(new URL('./prod-ca-2021.crt',import.meta.url),'utf8');
 const password='fixture:password+with/symbols!2026';
 const v=preparePasswordProbe({projectRef:ref,ca:publicCA,password});
 assert.equal(v.route.user,'dlkt_rt_probe.'+ref);
 assert.equal(v.route.host,'aws-0-eu-central-1.pooler.supabase.com');
 assert.equal(v.password,password);
 for(const invalid of [undefined,'','too-short','A'.repeat(257),'A'.repeat(20)+'\n','A'.repeat(20)+'\u0000'])
   assert.throws(()=>preparePasswordProbe({projectRef:ref,ca:publicCA,password:invalid}),/INTEGRATION_TRANSPORT_REJECTED/u);
 assert.throws(()=>preparePasswordProbe({projectRef:'gxzpvuyawpzevwwbrlpz',ca:publicCA,password}),/INTEGRATION_TRANSPORT_REJECTED/u);
 assert.throws(()=>preparePasswordProbe({projectRef:ref,ca,password}),/INTEGRATION_TRANSPORT_REJECTED/u);
});
