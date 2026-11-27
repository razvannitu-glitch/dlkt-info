import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {observeKnowledgeEvidence} from '../../scripts/knowledge-editorial-evidence.mjs';
import {assessKnowledgeClaimEvidence} from '../../scripts/knowledge-claim-evidence.mjs';
import {compareKnowledgeObservations,assessKnowledgeRevalidation} from '../../scripts/knowledge-editorial-revalidation.mjs';
import {knowledgeRightsCandidates} from '../../source/tests/fixtures/knowledge-rights-candidates.mjs';
import {validKnowledgeCard,knowledgeRightsForCard,knowledgeEditorialPayload} from '../../source/.build/src/iceo/knowledge.js';
import {knowledgeContentDigest} from '../../source/.build/src/share/knowledge-resolution.js';

const build=process.env.DLKT_HISTORY_ADAPTER_BUILD,container=process.env.TEST_CONTAINER;
if(!build||!container||!/^[a-f0-9]{12,64}$/u.test(container))throw Error('ISOLATED_TEST_ENV_REQUIRED');
const {runObservationAttempt,observationDigest,recoverObservationAttempt}=await import(pathToFileURL(build+'/transaction-adapter.mjs').href);
const db='editorial_history_adapter_test';
const users=Object.freeze({
  worker:['dlkt_history_ci_worker','lab-worker-local-only'],
  attestor:['dlkt_history_ci_attestor','lab-attestor-local-only'],
  reader:['dlkt_history_ci_reader','lab-reader-local-only'],
  reviewer:['dlkt_history_ci_reviewer','lab-reviewer-local-only'],
  archiver:['dlkt_history_ci_archiver','lab-archiver-local-only'],
  reaper:['dlkt_history_ci_reaper','lab-reaper-local-only'],
});
// One psql invocation = one authenticated connection and a completed
// autocommit SQL statement. No SET ROLE or privileged connection in tests.
// Fixed loopback inside the disposable container, no external database host.
function query(role,statement,passwordOverride){
  const [user,password]=users[role];
  const result=spawnSync('docker',['exec','-i','-e','PGPASSWORD='+(passwordOverride??password),container,
    'psql','-X','-qAt','-w','-h','127.0.0.1','-U',user,'-d',db,'-v','ON_ERROR_STOP=1'],{
    input:"SET standard_conforming_strings=on; SET statement_timeout='5s';\nSELECT session_user||':'||current_user||':'||current_database();\n"+statement+';\n',
    encoding:'utf8',timeout:12000,maxBuffer:2*1024*1024,
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
    // A correctly shaped synthetic positive digest is still prohibited for
    // this canonical lab subject at the database boundary, even with both roles.
    await new Promise(resolve=>setTimeout(resolve,5));
    const synthetic=positive(key);
    await assert.rejects(ports.attestor.attest(key,synthetic),/LAB_SQL_REJECTED/);
    await assert.rejects(ports.worker.finish(key,synthetic),/LAB_SQL_REJECTED/);
    const open=await row(key);
    assert.equal(open.outcome,'open');assert.equal(open.attestedAt,null);
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

const reviewSql=(k,id,scope,verdict,evidence,expires)=>'SELECT to_json(dlkt_history_lab.record_lab_review('+args(k)+','+q(id)+'::uuid,'+q(scope)+','+q(verdict)+','+q(evidence)+','+q(expires)+'::timestamptz))';
const snapshotSql=c=>'SELECT dlkt_history_lab.read_lab_review_snapshot('+[q(c.id),String(c.revision),q(c.digest)].join(',')+')';
const snapshot=k=>query('reader',snapshotSql(k.candidate));
const review=(k,id,scope,verdict,evidence,expires)=>query('reviewer',reviewSql(k,id,scope,verdict,evidence,expires));

test('synthetic reviewer is a separate authenticated principal and cannot cross role boundaries',async()=>{
  const k=makeKey('review-scopes'),id=randomUUID(),statement=reviewSql(k,id,'feed','lab-held',null,null);
  for(const role of ['worker','attestor','reader'])assert.throws(()=>query(role,statement),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('reviewer','SELECT row_to_json(t) FROM dlkt_history_lab.start_attempt('+args(k)+') t'),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('reviewer','SELECT to_json(dlkt_history_lab.attest_observation('+args(k)+',null,null,null))'),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('reviewer',snapshotSql(k.candidate)),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('reviewer','SELECT to_json(count(*)) FROM dlkt_history_lab.scope_reviews'),/LAB_SQL_REJECTED/);
  assert.equal(snapshot(k).scopes.feed.state,'no-review');
});
test('review scopes are immutable, separately recorded, exact and never authority',async()=>{
  const k=makeKey('review-scopes');
  assert.equal((await runObservationAttempt(k,ports,observer)).outcome,'observed');
  const entry=await row(k),expiry=new Date(Date.now()+60_000).toISOString(),feedId=randomUUID(),standaloneId=randomUUID();
  assert.throws(()=>review(k,feedId,'feed','lab-permitted','0'.repeat(64),expiry),/LAB_SQL_REJECTED/);
  assert.throws(()=>review(k,feedId,'feed','lab-permitted',entry.evidenceDigest,new Date(Date.now()+25*3600000).toISOString()),/LAB_SQL_REJECTED/);
  assert.equal(review(k,feedId,'feed','lab-permitted',entry.evidenceDigest,expiry),'recorded');
  const first=snapshot(k);
  assert.equal(first.activationAllowed,false);assert.equal(first.approvalReusable,false);
  assert.equal(first.scopes.feed.state,'recorded-not-authority');assert.equal(first.scopes.standalone.state,'no-review');
  assert.equal(first.scopes.feed.latest.reviewerPrincipal,users.reviewer[0]);
  assert.equal(review(k,feedId,'feed','lab-permitted',entry.evidenceDigest,expiry),'replay');
  assert.deepEqual(snapshot(k).scopes.feed,first.scopes.feed);
  assert.throws(()=>review(k,feedId,'standalone','lab-permitted',entry.evidenceDigest,expiry),/LAB_SQL_REJECTED/);
  assert.throws(()=>review(k,randomUUID(),'feed','lab-permitted',entry.evidenceDigest,expiry),/LAB_SQL_REJECTED/);
  assert.equal(review(k,standaloneId,'standalone','lab-permitted',entry.evidenceDigest,expiry),'recorded');
  const both=snapshot(k);assert.equal(both.scopes.feed.count,1);assert.equal(both.scopes.standalone.count,1);
  assert.equal(both.scopes.standalone.latest.reviewId,standaloneId);assert.equal(both.approvalReusable,false);
  // A held verdict immediately supersedes only its own scope, even on the
  // same observation. No same-baseline re-permission or expiry extension.
  const heldId=randomUUID();assert.equal(review(k,heldId,'feed','lab-held',entry.evidenceDigest,null),'recorded');
  const revoked=snapshot(k);assert.equal(revoked.scopes.feed.state,'held');assert.equal(revoked.scopes.feed.count,2);
  assert.equal(revoked.scopes.standalone.latest.reviewId,standaloneId);
  assert.equal(revoked.approvalReusable,false);
  assert.throws(()=>review(k,randomUUID(),'feed','lab-permitted',entry.evidenceDigest,expiry),/LAB_SQL_REJECTED/);
  const next={...k,attemptId:randomUUID()};
  assert.equal((await runObservationAttempt(next,ports,observer)).outcome,'observed');
  const later=snapshot(next);assert.equal(later.scopes.standalone.state,'new-observation-review-required');
  assert.throws(()=>review(k,randomUUID(),'feed','lab-permitted',entry.evidenceDigest,expiry),/LAB_SQL_REJECTED/);
  const nextEntry=await row(next);
  assert.equal(review(next,randomUUID(),'feed','lab-permitted',nextEntry.evidenceDigest,expiry),'recorded');
  assert.equal(snapshot(next).scopes.feed.count,3);
  assert.equal(snapshot(next).approvalReusable,false);
});
test('held or open evidence cannot acquire a synthetic permitted review',async()=>{
  const k=makeKey('review-held');
  const created=await ports.worker.start(k);assert.equal(created.disposition,'created');
  assert.throws(()=>review(k,randomUUID(),'feed','lab-permitted',null,new Date(Date.now()+60000).toISOString()),/LAB_SQL_REJECTED/);
  assert.equal(await ports.worker.finish(k,{outcome:'held',reason:'source-denied',observedAt:null,fingerprints:null,evidenceDigest:null}),'recorded');
  assert.throws(()=>review(k,randomUUID(),'feed','lab-permitted',null,new Date(Date.now()+60000).toISOString()),/LAB_SQL_REJECTED/);
  assert.equal(review(k,randomUUID(),'feed','lab-held',null,null),'recorded');
  assert.equal(snapshot(k).scopes.feed.state,'held');assert.equal(snapshot(k).approvalReusable,false);
});
test('review window expires without renewal or activation',async()=>{
  const k=makeKey('review-expiry');
  assert.equal((await runObservationAttempt(k,ports,observer)).outcome,'observed');
  const entry=await row(k),id=randomUUID(),expiry=new Date(Date.now()+2000).toISOString();
  assert.equal(review(k,id,'feed','lab-permitted',entry.evidenceDigest,expiry),'recorded');
  await new Promise(resolve=>setTimeout(resolve,2200));
  const expired=snapshot(k);assert.equal(expired.scopes.feed.state,'expired');assert.equal(expired.approvalReusable,false);
  assert.equal(review(k,id,'feed','lab-permitted',entry.evidenceDigest,expiry),'replay');
  assert.deepEqual(snapshot(k).scopes.feed,expired.scopes.feed);
  assert.throws(()=>review(k,randomUUID(),'feed','lab-permitted',entry.evidenceDigest,new Date(Date.now()+60000).toISOString()),/LAB_SQL_REJECTED/);
});
test('missing review records fail closed and the canonical lab identity remains held-only',()=>{
  const corrupt=makeKey('review-corrupt');
  const s=snapshot(corrupt);assert.equal(s.state,'integrity-held');assert.equal(s.scopes.feed.latest,null);assert.equal(s.approvalReusable,false);
  assert.throws(()=>review(corrupt,randomUUID(),'feed','lab-held',null,null),/LAB_SQL_REJECTED/);
  const canonical={attemptId:randomUUID(),candidate:{id:'dlkt-elsewhere-nsw-fuelcheck',revision:1,
    digest:'772d754d42ceb10260b4c02c1b4c97fcb1949ddbf61d6b0cd17fb2b88fa1c88b',
    sourceUrl:'https://www.nsw.gov.au/legal-and-justice/consumer-rights-and-protection/advertising-product-packaging-and-pricing-laws/fuel-pricing-discounts-and-signage/check-fuel-prices',
    policyUrl:'https://www.nsw.gov.au/nsw-government/about-website/copyright'}};
  assert.throws(()=>review(canonical,randomUUID(),'feed','lab-held',null,null),/LAB_SQL_REJECTED/);
  assert.equal(snapshot(canonical).scopes.feed.state,'synthetic-only');
});


// The persisted projection lives only in lab-planner-* / example.invalid.
// The complete controlled receipts are retained separately in this test
// harness. No real review or production approval object is imported.
const {simulateStoredRevalidation}=await import(pathToFileURL(build+'/planner-simulation.mjs').href);
const scenario=JSON.parse(readFileSync(process.env.DLKT_HISTORY_PLANNER_FIXTURE,'utf8'));
assert.equal(scenario.kind,'synthetic-planner-fixture-not-authority');
const plannerIdentity=scenario.identity;
function setupScenario(name){
  const candidate=scenario.candidates[name],receipts=[];
  const attempt=()=>({candidate,attemptId:randomUUID()});
  const evaluate=(patch={})=>simulateStoredRevalidation({candidate,identity:plannerIdentity,receipts,
    read:c=>Promise.resolve(query('reader',snapshotSql(c))),planner:assessKnowledgeRevalidation,...patch});
  const record=async (version='A')=>{
    const key=attempt();
    const result=await runObservationAttempt(key,ports,async()=>{
      if(version==='held')return held('source-denied');
      assert.ok(['A','B'].includes(version));
      await new Promise(resolve=>setTimeout(resolve,5));
      const i=plannerIdentity;
      const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
      const page=(title,body,url)=>'<html><head><link rel="canonical" href="'+url+'"></head><body><main><h1>'+title+'</h1><p>'+body+'</p></main></body></html>';
      const response=(url,text,contentType)=>({url,status:200,ok:true,partial:false,contentType,text,sha256:hash(text)});
      const robots=new URL(i.sourceUrl).origin+'/robots.txt';
      const pages=new Map([[robots,response(robots,'User-agent: *\nDisallow: /admin','text/plain')],
        [i.sourceUrl,response(i.sourceUrl,page('Check fuel prices','FuelCheck is free, with real-time fuel prices. Never use your phone while driving. Controlled simulation '+version+'.',i.sourceUrl),'text/html')],
        [i.policyUrl,response(i.policyUrl,page('Copyright','Creative Commons Attribution 4.0, except as noted. State of New South Wales. third-party material, logos.',i.policyUrl),'text/html')]]);
      const observation=await observeKnowledgeEvidence({id:i.id,revision:i.revision,candidateDigest:i.digest,
        sourceUrl:i.sourceUrl,policyUrl:i.policyUrl,
        get:async(url)=>{assert.ok(pages.has(url));return pages.get(url);},
        parseRobots:()=>({state:'observed',bodyEvidence:{bodyKind:'text'},groupCount:1,malformedDirectives:0}),
        decideRobots:()=>({allowed:true}),clock:Date.now});
      assert.equal(observation.state,'observed-for-review');
      // Deliberately not a genuine claim/translation review. Positive planner
      // outcomes below are hypothetical simulations of existing authority.
      assert.equal(assessKnowledgeClaimEvidence(i,observation).state,'held');
      const fingerprints=[observation.robots.bodySha256,observation.source.bodySha256,observation.source.mainSha256,
        observation.terms.bodySha256,observation.terms.mainSha256];
      const observedAt=observation.observedAt;
      receipts.push({kind:'controlled-synthetic-planner-receipt',attemptId:key.attemptId,observation});
      return {kind:'lab-controlled-observation',activationAllowed:false,outcome:'observed',reason:null,
        candidate,observedAt,fingerprints,evidenceDigest:observationDigest(candidate,observedAt,fingerprints)};
    });
    assert.equal(result.state,'recorded');assert.equal(result.outcome,version==='held'?'held':'observed');
    return key;
  };
  const permit=async(key,scope,expires=new Date(Date.now()+120000).toISOString())=>{
    const entry=await row(key);
    assert.equal(review(key,randomUUID(),scope,'lab-permitted',entry.evidenceDigest,expires),'recorded');
  };
  return {candidate,receipts,record,permit,evaluate};
}
const neverAuthority=r=>{
  assert.equal(r.kind,'synthetic-planner-simulation-not-authority');
  assert.equal(r.activationAllowed,false);assert.equal(r.approvalReusable,false);
};
test('existing planner consumes persisted complete controlled history with separate synthetic review scopes',async()=>{
  const s=setupScenario('scope'),first=await s.record();
  await s.permit(first,'feed');
  await s.record();
  const feedOnly=await s.evaluate();neverAuthority(feedOnly);
  assert.equal(feedOnly.feed.state,'would-reuse-in-lab');assert.equal(feedOnly.standalone.state,'review-required');
  const current=await s.record();
  await s.permit(current,'feed');
  await s.permit(current,'standalone',new Date(Date.now()+90000).toISOString());
  const last=await s.record();
  const both=await s.evaluate();neverAuthority(both);
  assert.equal(both.feed.state,'would-reuse-in-lab');assert.equal(both.standalone.state,'would-reuse-in-lab');
  assert.ok(Date.parse(both.standalone.validUntil)<=Date.parse(both.feed.validUntil));
  // Revoke the feed on its current tip via a separate synthetic verdict.
  const entry=await row(last);
  assert.equal(review(last,randomUUID(),'feed','lab-held',entry.evidenceDigest,null),'recorded');
  await s.record();
  const revoked=await s.evaluate();neverAuthority(revoked);
  assert.equal(revoked.feed.state,'held');assert.notEqual(revoked.standalone.state,'would-reuse-in-lab');
});
test('persisted A to B to A to A drift cannot silently restore prior decisions',async()=>{
  const s=setupScenario('drift'),first=await s.record();
  await s.permit(first,'feed');await s.permit(first,'standalone');
  await s.record('B');await s.record('A');const restored=await s.record('A');
  const changed=await s.evaluate();neverAuthority(changed);
  assert.equal(changed.feed.state,'review-required');assert.equal(changed.feed.reason,'unresolved-observed-change');
  assert.notEqual(changed.standalone.state,'would-reuse-in-lab');
  await s.permit(restored,'feed');await s.record('A');
  const reviewed=await s.evaluate();neverAuthority(reviewed);
  assert.equal(reviewed.feed.state,'would-reuse-in-lab');
  assert.equal(reviewed.standalone.state,'review-required');
});
test('failed or denied history is not repaired by a later positive observation',async()=>{
  const s=setupScenario('held'),first=await s.record();
  await s.permit(first,'feed');await s.record('held');await s.record();
  const blocked=await s.evaluate();neverAuthority(blocked);
  assert.equal(blocked.feed.state,'held');assert.equal(blocked.standalone.state,'held');
  assert.equal(blocked.feed.reason,'history-or-receipt-binding-incomplete');
});
test('persisted review expiry is enforced by the existing planner without renewal',async()=>{
  const s=setupScenario('expiry'),first=await s.record(),expiry=Date.now()+3500;
  await s.permit(first,'feed',new Date(expiry).toISOString());
  await s.record();
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,expiry-Date.now()+150)));
  const expired=await s.evaluate();neverAuthority(expired);
  assert.equal(expired.feed.state,'held');assert.equal(expired.feed.reason,'existing-review-expired');
});
test('simulation rejects missing or altered receipts, stale snapshot, foreign identity and forged scope',async()=>{
  const s=setupScenario('boundary'),first=await s.record();
  await s.permit(first,'feed');await s.record();
  const good=await s.evaluate();assert.equal(good.feed.state,'would-reuse-in-lab');
  const stored=snapshot(first);
  const mutate=(fn)=>{const copy=structuredClone(stored);fn(copy);return async()=>copy;};
  // Exercise the adapter's saturated-scope boundary independently of the
  // separately seeded full SQL journal. These are deliberately modified inputs.
  const capped=await s.evaluate({read:mutate(x=>{x.scopes.feed.count=256;x.scopes.feed.state='review-capacity-held';})});
  neverAuthority(capped);assert.equal(capped.feed.state,'held');
  assert.equal(capped.feed.reason,'synthetic-scope-review-capacity-held');
  assert.notEqual(capped.standalone.state,'would-reuse-in-lab');
  const changed=structuredClone(s.receipts);changed[0].observation.source.bodySha256='0'.repeat(64);
  const invalidFlags=structuredClone(s.receipts);invalidFlags[0].observation.rightsReviewRequired=false;
  for(const patch of [
    {receipts:s.receipts.slice(1)},
    {receipts:[s.receipts[0],s.receipts[0]]},
    {receipts:changed},{receipts:invalidFlags},
    {candidate:{...s.candidate,id:'dlkt-elsewhere-nsw-fuelcheck'}},
    {identity:{...plannerIdentity,digest:'d4c1df98ae87865402292c04c46811d60eee7ed3bde9583f1e16cd243611110e'}},
    {read:mutate(x=>{x.checkedAt=new Date(Date.now()-60000).toISOString();})},
    {read:mutate(x=>{x.scopes.feed.latest.evidenceDigest='0'.repeat(64);})},
    {read:mutate(x=>{x.scopes.feed.latest.scope='standalone';})},
    {read:mutate(x=>{x.scopes.feed.state='expired';})},
    {read:mutate(x=>{x.scopes.feed.count=256;})},
    {read:mutate(x=>{x.history.attempts.pop();})},
    {read:mutate(x=>{x.approvalReusable=true;})},
  ]){
    const denied=await s.evaluate(patch);neverAuthority(denied);
    assert.equal(denied.feed.state,'held');assert.equal(denied.standalone.state,'held');
  }
});


const archiveArgs=k=>[q(k.candidate.id),String(k.candidate.revision),q(k.candidate.digest)].join(',');
const sealSql=(k,id)=>'SELECT to_json(dlkt_history_lab.seal_lab_checkpoint('+archiveArgs(k)+','+q(id)+'::uuid))';
const checkpointSql=k=>'SELECT dlkt_history_lab.read_lab_checkpoint('+archiveArgs(k)+')';
const checkpoint=k=>query('reader',checkpointSql(k));
const seal=(k,id)=>query('archiver',sealSql(k,id));
function archiveBoundary(r){
  assert.equal(r.kind,'synthetic-checkpoint-not-authority');assert.equal(r.activationAllowed,false);
  assert.equal(r.approvalReusable,false);assert.equal(r.rolloverAllowed,false);
}
test('archive authority is separated and cannot write observations, decisions or raw checkpoint rows',()=>{
  const k=makeKey('archive-full'),id=randomUUID(),statement=sealSql(k,id);
  for(const role of ['worker','attestor','reader','reviewer'])assert.throws(()=>query(role,statement),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('archiver',checkpointSql(k)),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('archiver','SELECT row_to_json(t) FROM dlkt_history_lab.start_attempt('+args(k)+') t'),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('archiver',reviewSql(k,id,'feed','lab-held',null,null)),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('archiver','SELECT to_json(count(*)) FROM dlkt_history_lab.archive_checkpoints'),/LAB_SQL_REJECTED/);
  const none=checkpoint(k);archiveBoundary(none);assert.equal(none.state,'no-checkpoint');
});
test('seal a saturated complete history including held, failed, abandoned, attestations and all scope reviews',async()=>{
  const k=makeKey('archive-full'),id=randomUUID();
  const before=await ports.reader.read(k.candidate);
  assert.equal(before.state,'capacity-held');assert.equal(before.attempts.length,256);
  assert.equal(seal(k,id),'sealed');
  const r=checkpoint(k);archiveBoundary(r);assert.equal(r.state,'sealed-verified');
  assert.equal(r.checkpoint.checkpointId,id);assert.equal(r.checkpoint.sealedBy,users.archiver[0]);
  assert.equal(createHash('sha256').update(r.checkpoint.payload,'utf8').digest('hex'),r.checkpoint.payloadSha256);
  const archive=JSON.parse(r.checkpoint.payload);
  assert.equal(archive.kind,'dlkt-synthetic-archive-pg17-v1');
  assert.equal(archive.candidate.tip,256);assert.equal(archive.candidate.card_id,k.candidate.id);
  assert.equal(archive.activationAllowed,false);assert.equal(archive.approvalReusable,false);assert.equal(archive.rolloverAllowed,false);
  assert.deepEqual(archive.attempts.map(x=>x.attempt.sequence_no),Array.from({length:256},(_,i)=>i+1));
  assert.deepEqual(archive.attempts.slice(0,4).map(x=>x.result.outcome),['observed','held','failed','abandoned']);
  assert.ok(archive.attempts[0].attestation.evidence_digest);
  assert.ok(archive.attempts[3].attestation.evidence_digest);
  assert.equal(archive.attempts[3].result.evidence_digest,null);
  assert.deepEqual(archive.scopeReviewHeads.map(x=>[x.scope,x.tip]),[['feed',2],['standalone',1]]);
  assert.deepEqual(archive.scopeReviews.map(x=>[x.scope,x.review_no,x.verdict]),[
    ['feed',1,'lab-permitted'],['feed',2,'lab-held'],['standalone',1,'lab-permitted']]);
  assert.equal(seal(k,id),'replay');
  assert.deepEqual(checkpoint(k),r);
  // A different client/session time zone must not change the sealed bytes.
  const otherZone=query('reader',"SET TIME ZONE 'Pacific/Auckland'; "+checkpointSql(k));
  assert.deepEqual(otherZone,r);
  assert.throws(()=>seal(k,randomUUID()),/LAB_SQL_REJECTED/);
  assert.equal((await ports.worker.start({...k,attemptId:randomUUID()})).disposition,'capacity-held');
  const after=await ports.reader.read(k.candidate);
  assert.deepEqual(after,before);
  assert.equal(snapshot(k).approvalReusable,false);
});
test('open, below-capacity, corrupt or non-synthetic histories cannot be archived as completed',async()=>{
  for(const name of ['positive','busy','review-corrupt']){
    const k=makeKey(name);
    assert.throws(()=>seal(k,randomUUID()),/LAB_SQL_REJECTED/);
    const r=checkpoint(k);archiveBoundary(r);assert.equal(r.state,'no-checkpoint');
  }
  const real={candidate:{id:'dlkt-elsewhere-nsw-fuelcheck',revision:1,
    digest:'772d754d42ceb10260b4c02c1b4c97fcb1949ddbf61d6b0cd17fb2b88fa1c88b'}};
  assert.throws(()=>seal(real,randomUUID()),/LAB_SQL_REJECTED/);
});
test('rehashing modified archive bytes or changing retained terminal data does not restore integrity',()=>{
  for(const [name,id] of [['archive-corrupt','40000000-0000-4000-8000-000000000001'],
    ['archive-live-drift','40000000-0000-4000-8000-000000000002']]){
    const k=makeKey(name),r=checkpoint(k);archiveBoundary(r);
    assert.equal(r.state,'integrity-held');assert.equal(r.checkpoint,null);
    assert.throws(()=>seal(k,id),/LAB_SQL_REJECTED/);
  }
});


const abandonSql=k=>'SELECT to_json(dlkt_history_lab.abandon_attempt('+args(k)+'))';
const recoveryPorts={reader:ports.reader,reaper:{async abandon(k){return query('reaper',abandonSql(k));}}};
async function recoveryKey(name){
  const k=makeKey('recovery-'+name),h=await ports.reader.read(k.candidate);
  assert.ok(h.attempts.length>0);
  return {...k,attemptId:h.attempts.at(-1).attemptId};
}
function recoveryBoundary(r){
  assert.equal(r.activationAllowed,false);assert.equal(r.approvalReusable,false);
}
test('recovery principal is authenticated separately and early abandonment remains impossible',async()=>{
  // Start a fresh attempt now rather than relying on fixture initialization age.
  const k=makeKey('before-commit');assert.equal((await ports.worker.start(k)).disposition,'created');
  for(const role of ['worker','reader','attestor','reviewer','archiver'])
    assert.throws(()=>query(role,abandonSql(k)),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('reaper','SELECT row_to_json(t) FROM dlkt_history_lab.start_attempt('+args(k)+') t'),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('reaper',snapshotSql(k.candidate)),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('reaper',reviewSql(k,randomUUID(),'feed','lab-held',null,null)),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('reaper','SELECT to_json(count(*)) FROM dlkt_history_lab.attempts'),/LAB_SQL_REJECTED/);
  assert.throws(()=>query('reaper',abandonSql(k)),/LAB_SQL_REJECTED/);
  let calls=0;
  const r=await recoverObservationAttempt(k,{...recoveryPorts,reaper:{async abandon(){calls++;return 'recorded';}}});
  recoveryBoundary(r);assert.equal(r.reason,'attempt-not-expired');assert.equal(calls,0);
  assert.equal((await row(k)).outcome,'open');
});
test('recover a stranded attempt, retain its terminal failure and allow only an explicit new start',async()=>{
  const k=await recoveryKey('plain'),before=await row(k);
  assert.equal(before.outcome,'open');
  const r=await recoverObservationAttempt(k,recoveryPorts);recoveryBoundary(r);
  assert.equal(r.state,'recovered');assert.equal(r.reason,'exact-abandonment-readback');
  assert.equal(r.historyState,'terminal-hold-present');
  const closed=await row(k);
  assert.equal(closed.outcome,'abandoned');assert.equal(closed.reason,'start-timeout');
  assert.equal(closed.startedAt,before.startedAt);assert.equal(closed.evidenceDigest,null);
  assert.equal((await recoverObservationAttempt(k,recoveryPorts)).reason,'already-abandoned');
  await assert.rejects(ports.worker.finish(k,{outcome:'failed',reason:'transport-failed',observedAt:null,fingerprints:null,evidenceDigest:null}),/LAB_SQL_REJECTED/);
  let probes=0;
  const replay=await runObservationAttempt(k,ports,async()=>{probes++;return held('source-denied');});
  assert.equal(replay.reason,'replay-terminal');assert.equal(probes,0);
  const next={...k,attemptId:randomUUID()};
  assert.equal((await runObservationAttempt(next,ports,observer)).outcome,'observed');
  const history=await ports.reader.read(k.candidate);
  assert.equal(history.tip,2);assert.equal(history.state,'terminal-hold-present');
  assert.deepEqual(history.attempts[0],closed);
  assert.equal(snapshot(k).approvalReusable,false);
});
test('lost attestation acknowledgement remains a failure after timeout, not an observed result',async()=>{
  const k=await recoveryKey('attested'),before=await row(k);
  assert.equal(before.outcome,'open');assert.ok(before.attestedAt);
  const r=await recoverObservationAttempt(k,recoveryPorts);recoveryBoundary(r);
  assert.equal(r.state,'recovered');
  const closed=await row(k);
  assert.equal(closed.outcome,'abandoned');assert.equal(closed.reason,'start-timeout');
  assert.equal(closed.attestedAt,before.attestedAt);assert.equal(closed.evidenceDigest,null);
  assert.equal(closed.observedAt,null);assert.equal(closed.fingerprints,null);
  assert.throws(()=>review(k,randomUUID(),'feed','lab-permitted',null,new Date(Date.now()+60000).toISOString()),/LAB_SQL_REJECTED/);
});
test('uncertain abandonment is confirmed only from exact readback, before-commit failure stays unresolved',async()=>{
  const lost=await recoveryKey('lost');
  const r=await recoverObservationAttempt(lost,{...recoveryPorts,reaper:{async abandon(k){
    await recoveryPorts.reaper.abandon(k);throw Error('ack lost');
  }}});
  recoveryBoundary(r);assert.equal(r.reason,'confirmed-after-uncertain-abandonment');
  assert.equal((await row(lost)).outcome,'abandoned');
  const before=await recoveryKey('before');
  const u=await recoverObservationAttempt(before,{...recoveryPorts,reaper:{async abandon(){throw Error('before commit');}}});
  recoveryBoundary(u);assert.equal(u.state,'unresolved');assert.equal(u.reason,'abandonment-readback-unconfirmed');
  assert.equal((await row(before)).outcome,'open');
  assert.equal((await recoverObservationAttempt(before,recoveryPorts)).state,'recovered');
});
test('malformed or mismatched history cannot trigger or falsely confirm recovery',async()=>{
  const k=await recoveryKey('bad-read'),history=await ports.reader.read(k.candidate);
  let writes=0;
  for(const change of [
    h=>{h.cardId='lab-other';},h=>{h.tip=2;},h=>{h.attempts[0].sequence=2;},
    h=>{h.attempts[0].outcome='observed';},h=>{h.activationAllowed=true;},
    h=>{h.state='complete-observation-prefix';},h=>{h.attempts[0].evidenceDigest='a'.repeat(64);},
  ]){
    const altered=structuredClone(history);change(altered);
    const r=await recoverObservationAttempt(k,{reader:{read:async()=>altered},reaper:{async abandon(){writes++;return 'recorded';}}});
    recoveryBoundary(r);assert.equal(r.state,'unresolved');
  }
  assert.equal(writes,0);assert.equal((await row(k)).outcome,'open');
  let reads=0;
  const r=await recoverObservationAttempt(k,{...recoveryPorts,reader:{async read(c){
    const real=await ports.reader.read(c);
    if(++reads===1)return real;
    return {...real,attempts:real.attempts.map(a=>({...a,startedAt:'2026-01-02T00:00:00.000Z'}))};
  }}});
  recoveryBoundary(r);assert.equal(r.state,'unresolved');assert.equal((await row(k)).outcome,'abandoned');
  assert.equal((await recoverObservationAttempt(k,recoveryPorts)).reason,'already-abandoned');
});
test('stale recovery target never abandons a replacement attempt',async()=>{
  const k=await recoveryKey('race'),before=await ports.reader.read(k.candidate);
  assert.equal((await recoverObservationAttempt(k,recoveryPorts)).state,'recovered');
  const next={...k,attemptId:randomUUID()};
  assert.equal((await ports.worker.start(next)).disposition,'created');
  let reads=0;
  const r=await recoverObservationAttempt(k,{...recoveryPorts,reader:{async read(c){
    if(++reads===1)return before;
    return ports.reader.read(c);
  }}});
  recoveryBoundary(r);assert.equal(r.state,'recovered');assert.equal(r.historyState,'open');
  assert.equal((await row(next)).outcome,'open');
  assert.equal((await row(k)).outcome,'abandoned');
});
test('abandoning the final capacity slot preserves capacity and permits sealing, never rollover',async()=>{
  const k=await recoveryKey('cap');
  const pre=await ports.reader.read(k.candidate);
  assert.equal(pre.tip,256);assert.equal(pre.state,'expired-open');
  const id=randomUUID();assert.throws(()=>seal(k,id),/LAB_SQL_REJECTED/);
  const r=await recoverObservationAttempt(k,recoveryPorts);recoveryBoundary(r);
  assert.equal(r.state,'recovered');assert.equal(r.historyState,'capacity-held');
  const history=await ports.reader.read(k.candidate);
  assert.equal(history.attempts.length,256);assert.equal(history.attempts.at(-1).outcome,'abandoned');
  assert.deepEqual(history.attempts.slice(0,255),pre.attempts.slice(0,255));
  assert.equal((await ports.worker.start({...k,attemptId:randomUUID()})).disposition,'capacity-held');
  assert.equal(seal(k,id),'sealed');
  const saved=checkpoint(k);archiveBoundary(saved);assert.equal(saved.state,'sealed-verified');
  assert.equal(JSON.parse(saved.checkpoint.payload).attempts.at(-1).result.outcome,'abandoned');
});

test('saturated review journal fails closed before observation capacity is exhausted',async()=>{
  const base=makeKey('review-cap'),before=await ports.reader.read(base.candidate);
  assert.equal(before.state,'complete-observation-prefix');assert.equal(before.tip,129);
  const k={...base,attemptId:before.attempts.at(-1).attemptId};
  const s=snapshot(k);assert.equal(s.state,'metadata-only');assert.equal(s.scopes.feed.count,256);
  assert.equal(s.scopes.feed.latest.verdict,'lab-permitted');
  assert.ok(Date.parse(s.scopes.feed.latest.expiresAt)>Date.now());
  assert.equal(s.scopes.feed.state,'review-capacity-held');assert.equal(s.scopes.standalone.state,'no-review');
  assert.equal(s.approvalReusable,false);assert.equal(s.activationAllowed,false);
  assert.throws(()=>review(k,randomUUID(),'feed','lab-held',s.scopes.feed.latest.evidenceDigest,null),/LAB_SQL_REJECTED/);
  const original=s.scopes.feed.latest;
  assert.equal(review(k,original.reviewId,'feed','lab-permitted',original.evidenceDigest,original.expiresAt),'replay');
  assert.deepEqual(snapshot(k).scopes.feed,s.scopes.feed);
  const next={...k,attemptId:randomUUID()};
  assert.equal((await runObservationAttempt(next,ports,observer)).outcome,'observed');
  const later=snapshot(next);assert.equal(later.history.tip,130);assert.equal(later.scopes.feed.state,'review-capacity-held');
  assert.equal(later.approvalReusable,false);
});

test('archive seal replay and readback agree on impossible historical seal time',()=>{
  const k=makeKey('archive-bad-clock'),r=checkpoint(k);
  archiveBoundary(r);assert.equal(r.state,'integrity-held');assert.equal(r.checkpoint,null);
  assert.throws(()=>seal(k,'40000000-0000-4000-8000-000000000003'),/LAB_SQL_REJECTED/);
});
