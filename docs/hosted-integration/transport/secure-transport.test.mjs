import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SecureIntegrationTransport} from './.transport-build/secure-transport.js';
const ref='hziavqdhsqnihxuuxzhn',owner='00000000-0000-4000-8000-000000000101',session='10000000-0000-4000-8000-000000000101';
const ca=readFileSync(process.env.TEST_CA,'utf8'),wrongCA=readFileSync(process.env.TEST_WRONG_CA,'utf8');
const config=capability=>({mode:'integration',projectRef:ref,capability,password:process.env.TEST_RUNTIME_PASSWORD,ca});
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
