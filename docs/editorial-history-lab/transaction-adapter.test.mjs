import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {observeKnowledgeEvidence} from '../../scripts/knowledge-editorial-evidence.mjs';
import {assessKnowledgeClaimEvidence} from '../../scripts/knowledge-claim-evidence.mjs';
import {compareKnowledgeObservations} from '../../scripts/knowledge-editorial-revalidation.mjs';
import {knowledgeRightsCandidates} from '../../source/tests/fixtures/knowledge-rights-candidates.mjs';
import {validKnowledgeCard,knowledgeRightsForCard,knowledgeEditorialPayload} from '../../source/.build/src/iceo/knowledge.js';
import {knowledgeContentDigest} from '../../source/.build/src/share/knowledge-resolution.js';

const build=process.env.DLKT_HISTORY_ADAPTER_BUILD,container=process.env.TEST_CONTAINER;
if(!build||!container||!/^[a-f0-9]{12,64}$/u.test(container))throw Error('ISOLATED_TEST_ENV_REQUIRED');
const {runObservationAttempt,observationDigest}=await import(pathToFileURL(build+'/transaction-adapter.mjs').href);
const db='editorial_history_adapter_test';
const users=Object.freeze({
  worker:['dlkt_history_ci_worker','lab-worker-local-only'],
  attestor:['dlkt_history_ci_attestor','lab-attestor-local-only'],
  reader:['dlkt_history_ci_reader','lab-reader-local-only'],
});
// One psql invocation = one authenticated connection and a completed
// autocommit SQL statement. No SET ROLE or privileged connection in tests.
// Fixed loopback inside the disposable container, no external database host.
function query(role,statement,passwordOverride){
  const [user,password]=users[role];
  const result=spawnSync('docker',['exec','-i','-e','PGPASSWORD='+(passwordOverride??password),container,
    'psql','-X','-qAt','-w','-h','127.0.0.1','-U',user,'-d',db,'-v','ON_ERROR_STOP=1'],{
    input:"SET standard_conforming_strings=on; SET statement_timeout='5s';\nSELECT session_user||':'||current_user||':'||current_database();\n"+statement+';\n',
    encoding:'utf8',timeout:12000,maxBuffer:256*1024,
  });
  if(result.status!==0)throw Error('LAB_SQL_REJECTED');
  const lines=result.stdout.trim().split('\n');
  if(lines.length!==2||lines[0]!==user+':'+user+':'+db)throw Error('LAB_SQL_IDENTITY_OR_REPLY_INVALID');
  return JSON.parse(lines[1]);
}
const q=v=>v===null?'null':"'"+String(v).replaceAll("'","''")+"'";
const args=k=>[q(k.candidate.id),String(k.candidate.revision),q(k.candidate.digest),q(k.attemptId)+'::uuid'].join(',');
const params=t=>[q(t.observedAt)+'::timestamptz',q(t.fingerprints===null?null:JSON.stringify(t.fingerprints))+'::jsonb',q(t.evidenceDigest)].join(',');
const ports={
  worker:{
    async start(k){const r=query('worker','SELECT row_to_json(t) FROM dlkt_history_lab.start_attempt('+args(k)+') t');return {sequence:r.sequence_no,disposition:r.disposition};},
    async finish(k,t){return query('worker','SELECT to_json(dlkt_history_lab.finish_attempt('+args(k)+','+q(t.outcome)+','+q(t.reason)+','+params(t)+'))');},
  },
  attestor:{async attest(k,t){return query('attestor','SELECT to_json(dlkt_history_lab.attest_observation('+args(k)+','+params(t)+'))');}},
  reader:{async read(c){return query('reader','SELECT dlkt_history_lab.read_history('+[q(c.id),String(c.revision),q(c.digest)].join(',')+')');}},
};
const makeKey=n=>({attemptId:randomUUID(),candidate:{id:'lab-adapter-'+n,revision:1,digest:'a'.repeat(64),
  sourceUrl:'https://example.invalid/source/adapter-'+n,policyUrl:'https://example.invalid/policy/adapter-'+n}});
const held=reason=>({kind:'lab-controlled-observation',activationAllowed:false,outcome:'held',reason});
function positive(k){
  const observedAt=new Date().toISOString(),fingerprints=['b','c','d','e','f'].map(s=>s.repeat(64));
  return {kind:'lab-controlled-observation',activationAllowed:false,outcome:'observed',reason:null,
    candidate:k.candidate,observedAt,fingerprints,evidenceDigest:observationDigest(k.candidate,observedAt,fingerprints)};
}
const observer=async k=>{await new Promise(r=>setTimeout(r,5));return positive(k);};
const noProbe=async()=>{throw Error('probe must not run');};
const row=async k=>(await ports.reader.read(k.candidate)).attempts.find(a=>a.attemptId===k.attemptId);
test('separate authenticated roles reject wrong credentials and cross-role functions',async()=>{
  for(const role of Object.keys(users))assert.equal(query(role,'SELECT to_json(session_user::text)'),users[role][0]);
  assert.throws(()=>query('worker','SELECT to_json(1)','invalid-password'),/LAB_SQL_REJECTED/);
  const k=makeKey('acl');
  assert.throws(()=>query('attestor','SELECT row_to_json(t) FROM dlkt_history_lab.start_attempt('+args(k)+') t'),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('reader','SELECT row_to_json(t) FROM dlkt_history_lab.start_attempt('+args(k)+') t'),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('worker','SELECT to_json(dlkt_history_lab.attest_observation('+args(k)+',null,null,null))'),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('attestor','SELECT to_json(dlkt_history_lab.finish_attempt('+args(k)+",'failed','transport-failed',null,null,null))"),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('worker','SELECT dlkt_history_lab.read_history('+[q(k.candidate.id),'1',q(k.candidate.digest)].join(',')+')'),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('reader','SELECT to_json(count(*)) FROM dlkt_history_lab.attempts'),/LAB_SQL_REJECTED/);
  assert.equal((await ports.reader.read(k.candidate)).state,'empty');
});
test('committed start is visible before a controlled observation; positive exact readback',async()=>{
  const k=makeKey('positive');let calls=0;
  const r=await runObservationAttempt(k,ports,async key=>{
    calls++;
    const open=await row(key);
    assert.equal(open.outcome,'open');
    await new Promise(resolve=>setTimeout(resolve,5));
    return positive(key);
  });
  assert.equal(calls,1);assert.equal(r.state,'recorded');assert.equal(r.outcome,'observed');
  assert.equal(r.historyState,'complete-observation-prefix');assert.equal(r.activationAllowed,false);
  const entry=await row(k);assert.ok(entry.attestedAt);assert.equal(entry.outcome,'observed');
  const replay=await runObservationAttempt(k,ports,async()=>{calls++;return held('source-denied');});
  assert.equal(replay.reason,'replay-terminal');assert.equal(calls,1);
});
test('held source and observer failure are terminal records, without attestation',async()=>{
  for(const [name,fn,expected] of [['denied',async()=>held('source-denied'),'held'],['failure',async()=>{throw Error('transport');},'failed']]){
    const k=makeKey(name);
    const r=await runObservationAttempt(k,{...ports,attestor:{attest:async()=>{assert.fail('must not attest');}}},fn);
    assert.equal(r.state,'recorded');assert.equal(r.outcome,expected);
    const entry=await row(k);assert.equal(entry.outcome,expected);assert.equal(entry.attestedAt,null);
  }
});
test('historical or foreign positive receipt is not accepted as a fresh observation',async()=>{
  const k=makeKey('bad-receipt');
  const result=await runObservationAttempt(k,ports,async()=>({kind:'verified-historical-replay-not-attestation',activationAllowed:false,historicalOnly:true}));
  assert.equal(result.state,'recorded');assert.equal(result.outcome,'failed');
  assert.equal((await row(k)).reason,'invalid-receipt');
});
test('lost committed start acknowledgement and replay-open never observe twice',async()=>{
  const k=makeKey('start-lost');let calls=0;
  const obs=async()=>{calls++;return held('source-denied');};
  const lost={...ports,worker:{...ports.worker,start:async key=>{await ports.worker.start(key);throw Error('ack lost');}}};
  assert.equal((await runObservationAttempt(k,lost,obs)).reason,'start-commit-unconfirmed');
  assert.equal((await row(k)).outcome,'open');
  assert.equal((await runObservationAttempt(k,ports,obs)).reason,'replay-open');
  assert.equal(calls,0);
});
test('failure before start commit has no stored attempt and no observation',async()=>{
  const k=makeKey('before-commit');let calls=0;
  const r=await runObservationAttempt(k,{...ports,worker:{...ports.worker,start:async()=>{throw Error('before commit');}}},
    async()=>{calls++;return held('source-denied');});
  assert.equal(r.reason,'start-commit-unconfirmed');assert.equal(calls,0);assert.equal(await row(k),undefined);
});
test('lost attestation acknowledgement leaves the attempt unresolved and never finalizes',async()=>{
  const k=makeKey('attest-lost');let finishes=0;
  const r=await runObservationAttempt(k,{...ports,
    attestor:{attest:async(key,t)=>{await ports.attestor.attest(key,t);throw Error('ack lost');}},
    worker:{...ports.worker,finish:async(key,t)=>{finishes++;return ports.worker.finish(key,t);}}},observer);
  assert.equal(r.reason,'attestation-commit-unconfirmed');assert.equal(finishes,0);
  const entry=await row(k);assert.equal(entry.outcome,'open');assert.ok(entry.attestedAt);
});
test('lost terminal acknowledgement is recovered only from exact readback',async()=>{
  const k=makeKey('finish-lost');
  const r=await runObservationAttempt(k,{...ports,worker:{...ports.worker,finish:async(key,t)=>{await ports.worker.finish(key,t);throw Error('ack lost');}}},observer);
  assert.equal(r.state,'recorded');assert.equal(r.reason,'confirmed-after-uncertain-finish');assert.equal(r.outcome,'observed');
});
test('finish failure before commit and mismatched readback both fail closed',async()=>{
  const k=makeKey('finish-before');
  const r=await runObservationAttempt(k,{...ports,worker:{...ports.worker,finish:async()=>{throw Error('before commit');}}},async()=>held('source-denied'));
  assert.equal(r.reason,'terminal-readback-unconfirmed');assert.equal((await row(k)).outcome,'open');
  const second=makeKey('read-lost');
  const v=await runObservationAttempt(second,{...ports,reader:{read:async c=>{
    const real=await ports.reader.read(c);return {...real,attempts:real.attempts.map(a=>({...a,reason:'policy-changed'}))};
  }}},async()=>held('source-denied'));
  assert.equal(v.state,'unresolved');assert.equal(v.outcome,null);assert.equal((await row(second)).reason,'source-denied');
});
test('busy, invalid identity and malformed start acknowledgement do not call the observer',async()=>{
  const k=makeKey('busy');await ports.worker.start(k);let calls=0;
  const obs=async()=>{calls++;return held('source-denied');};
  assert.equal((await runObservationAttempt({...k,attemptId:randomUUID()},ports,obs)).reason,'busy');
  assert.equal((await runObservationAttempt({...k,candidate:{...k.candidate,sourceUrl:'https://other.invalid/a'}},ports,obs)).reason,'invalid-laboratory-identity');
  assert.equal((await runObservationAttempt(k,{...ports,worker:{...ports.worker,start:async()=>({sequence:0,disposition:'created'})}},obs)).reason,'start-receipt-invalid');
  assert.equal(calls,0);
});
test('actual canonical observer with controlled HTML persists missing claim coverage as held',async()=>{
  const card=knowledgeRightsCandidates.find(x=>x.id==='dlkt-elsewhere-nsw-fuelcheck');
  assert.ok(card&&validKnowledgeCard(card));
  const rights=knowledgeRightsForCard(card);assert.ok(rights);
  const identity={id:card.id,revision:card.revision,digest:knowledgeContentDigest(card),payload:knowledgeEditorialPayload(card),
    sourceUrl:card.source.url,policyUrl:rights.policyUrl,reviewedAt:card.reviewedAt,publishAt:card.publishAt,reviewBy:card.reviewBy};
  assert.equal(identity.digest,'772d754d42ceb10260b4c02c1b4c97fcb1949ddbf61d6b0cd17fb2b88fa1c88b');
  const candidate={id:identity.id,revision:identity.revision,digest:identity.digest,sourceUrl:identity.sourceUrl,policyUrl:identity.policyUrl};
  const key={attemptId:randomUUID(),candidate};const requests=[];
  const page=(title,text,url)=>'<html><head><link rel="canonical" href="'+url+'"></head><body><main><h1>'+title+'</h1><p>'+text+'</p></main></body></html>';
  const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
  const response=(url,text,contentType)=>({url,status:200,ok:true,partial:false,contentType,text,sha256:hash(text)});
  const robots=new URL(candidate.sourceUrl).origin+'/robots.txt';
  const pages=new Map([[robots,response(robots,'User-agent: *\nDisallow: /admin','text/plain')],
    [candidate.sourceUrl,response(candidate.sourceUrl,page('Check fuel prices','FuelCheck is free, with real-time fuel prices. Never use your phone while driving.',candidate.sourceUrl),'text/html')],
    [candidate.policyUrl,response(candidate.policyUrl,page('Copyright','Creative Commons Attribution 4.0, except as noted. State of New South Wales. third-party material, logos.',candidate.policyUrl),'text/html')]]);
  const result=await runObservationAttempt(key,ports,async()=>{
    assert.equal((await row(key)).outcome,'open');
    const receipt=await observeKnowledgeEvidence({id:identity.id,revision:identity.revision,sourceUrl:identity.sourceUrl,policyUrl:identity.policyUrl,candidateDigest:identity.digest,
      get:async(url,kind)=>{requests.push(kind);assert.ok(pages.has(url));return pages.get(url);},
      parseRobots:()=>({state:'observed',bodyEvidence:{bodyKind:'text'},groupCount:1,malformedDirectives:0}),
      decideRobots:()=>({allowed:true}),clock:Date.now});
    assert.equal(receipt.state,'observed-for-review');
    assert.equal(compareKnowledgeObservations({identity,observation:receipt,baselineObservation:null,now:Date.now()}).activationAllowed,false);
    const claims=assessKnowledgeClaimEvidence(identity,receipt);
    assert.equal(claims.state,'held');assert.equal(claims.activationAllowed,false);
    return held('incomplete-evidence');
  });
  assert.deepEqual(requests,['robots','article','article']);
  assert.equal(result.state,'recorded');assert.equal(result.outcome,'held');
  assert.equal((await row(key)).reason,'incomplete-evidence');
  assert.equal((await row(key)).attestedAt,null);
});
