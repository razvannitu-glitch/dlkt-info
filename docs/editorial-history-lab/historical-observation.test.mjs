import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyHistoricalObservation} from './verify-historical-observation.mjs';

const receipt=readFileSync(new URL('./evidence-45891421555.json',import.meta.url));
const baseline=readFileSync(new URL('../evidence/knowledge-editorial-observation-20261126.json',import.meta.url));
const alter=(bytes,fn)=>{const copy=JSON.parse(bytes.toString('utf8'));fn(copy);return Buffer.from(JSON.stringify(copy)+'\n');};

test('exact historical workflow evidence recomputes with the existing canonical engines',()=>{
  const result=verifyHistoricalObservation(receipt,baseline);
  assert.equal(result.kind,'verified-historical-replay-not-attestation');
  assert.equal(result.sourceRun,45891421555);
  assert.equal(result.sourceJob,140154794291);
  assert.equal(result.sourceCommit,'52ba5fa3af5359eb2a456a6f5bbab1f9e154d43b');
  assert.equal(result.baselineRun,45888933255);
  assert.equal(result.finishedAt,'2026-11-26T20:30:08.424Z');
  assert.equal(result.historicalOnly,true);
  assert.equal(result.liveObservation,false);
  assert.equal(result.ledgerWritable,false);
  assert.equal(result.activationAllowed,false);
  assert.equal(result.observations.length,2);
  assert.deepEqual(result.observations.map(x=>[x.comparison,x.changed]),[['unchanged',[]],['changed',['source','terms']]]);
  assert.deepEqual(result.observations.map(x=>x.observedAt),['2026-11-26T20:30:06.115Z','2026-11-26T20:30:08.423Z']);
  assert.deepEqual(result.observations.map(x=>x.evidenceDigest),[
    '32be52f81f07150ad0d0c4b63d1ad9e271e2b51c8a31e1164e286ee02cb058dd',
    'f215890a2feab757fed7426eccde6d993605ed5ec2c3c43f19df6a4353b69d20',
  ]);
  assert.ok(result.observations.every(x=>x.claimFields===12&&x.claimChecks===4
    &&x.feed==='review-required'&&x.standalone==='review-required'));
});
test('byte changes and forged provenance cannot pass the fixed receipt pin',()=>{
  for(const change of [
    doc=>{doc.commit='0'.repeat(40);},
    doc=>{doc.activationAllowed=true;},
    doc=>{doc.reports.pop();},
    doc=>{doc.reports.reverse();},
    doc=>{doc.reports[0].observedAt='2026-11-27T20:30:06.115Z';},
    doc=>{doc.reports[0].candidateDigest=doc.reports[1].candidateDigest;},
    doc=>{doc.reports[0].claimEvidence.fields.pop();},
    doc=>{doc.reports[0].access.source.allowed=false;},
    doc=>{doc.reports[0].terms.bodySha256='0'.repeat(64);},
    doc=>{doc.reports[0].revalidation.feed.state='reuse-eligible';},
    doc=>{doc.attempts.article=5;},
  ])assert.throws(()=>verifyHistoricalObservation(alter(receipt,change),baseline),/PIN_MISMATCH/);
  assert.throws(()=>verifyHistoricalObservation(Buffer.concat([receipt,Buffer.from(' ')]),baseline),/PIN_MISMATCH/);
});
test('baseline substitution is rejected and historical evidence cannot be refreshed by caller input',()=>{
  assert.throws(()=>verifyHistoricalObservation(receipt,alter(baseline,doc=>{doc.reports[0].observedAt='2026-11-26T20:29:00.000Z';})),/PIN_MISMATCH/);
  assert.throws(()=>verifyHistoricalObservation(baseline,receipt),/PIN_MISMATCH/);
  const result=verifyHistoricalObservation(receipt,baseline,{now:Date.now(),activationAllowed:true});
  assert.equal(result.finishedAt,'2026-11-26T20:30:08.424Z');
  assert.equal(result.ledgerWritable,false);
  assert.equal(result.activationAllowed,false);
});
test('unbounded, empty or non-byte input fails before parsing',()=>{
  for(const value of [null,'{}',Buffer.alloc(0),Buffer.alloc(65537)])
    assert.throws(()=>verifyHistoricalObservation(value,baseline),/SIZE_OR_TYPE/);
  assert.throws(()=>verifyHistoricalObservation(receipt,Buffer.alloc(65537)),/SIZE_OR_TYPE/);
});
