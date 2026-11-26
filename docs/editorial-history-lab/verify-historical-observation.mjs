// LAB ONLY. Replay two exact historical probe receipts, never a live writer.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {knowledgeRightsCandidates} from '../../source/tests/fixtures/knowledge-rights-candidates.mjs';
import {validKnowledgeCard,knowledgeRightsForCard,knowledgeEditorialPayload} from '../../source/.build/src/iceo/knowledge.js';
import {knowledgeContentDigest} from '../../source/.build/src/share/knowledge-resolution.js';
import {compareKnowledgeObservations} from '../../scripts/knowledge-editorial-revalidation.mjs';
import {assessKnowledgeClaimEvidence} from '../../scripts/knowledge-claim-evidence.mjs';
import {assessKnowledgeProbeOutcome} from '../../scripts/knowledge-editorial-evidence.mjs';

const MAX_BYTES=64*1024;
const IDS=Object.freeze(['dlkt-elsewhere-nsw-fuelcheck','dlkt-elsewhere-nz-unit-pricing']);
const BASELINE=Object.freeze({sha256:'808102ce4b4d028bd3127717cb10cc0003c8d3e3312ad157950f2130c6ec03fb',run:45888933255,job:140146505166,commit:'bad1a13a88cb2c132aaf72f6bd50d600559b6c53'});
const RECEIPT=Object.freeze({sha256:'59973eaa3ee57daf056c272d0c641fe46abe522a125d21c39e3abef76fb0be5d',run:45891421555,job:140154794291,commit:'52ba5fa3af5359eb2a456a6f5bbab1f9e154d43b'});
const budget=Object.freeze({robots:2,feed:0,article:4});
function requireCondition(condition,code){
  if(!condition)throw Error('HISTORICAL_EVIDENCE_'+code);
}
function decodePinned(bytes,pin){
  requireCondition(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX_BYTES,'SIZE_OR_TYPE');
  const snapshot=Buffer.from(bytes);
  requireCondition(createHash('sha256').update(snapshot).digest('hex')===pin.sha256,'PIN_MISMATCH');
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(snapshot));}
  catch{throw Error('HISTORICAL_EVIDENCE_JSON_INVALID');}
}
function instant(value){
  requireCondition(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value),'CLOCK_INVALID');
  const n=Date.parse(value);
  requireCondition(Number.isSafeInteger(n)&&new Date(n).toISOString()===value,'CLOCK_INVALID');
  return n;
}
function envelope(doc,pin){
  requireCondition(doc&&doc.probe==='dlkt-knowledge-editorial-evidence-1'&&doc.commit===pin.commit&&doc.activationAllowed===false,'PROVENANCE');
  requireCondition(isDeepStrictEqual(doc.attempts,budget)&&isDeepStrictEqual(doc.limits,budget)
    &&isDeepStrictEqual(doc.robotsParserChecks,{state:'passed',cases:16}),'BUDGET');
  const started=instant(doc.startedAt),finished=instant(doc.finishedAt);
  requireCondition(finished>=started&&finished-started<=75000,'DURATION');
  requireCondition(Array.isArray(doc.reports)&&doc.reports.length===IDS.length&&IDS.every((id,i)=>doc.reports[i]?.id===id),'CANDIDATES');
  let previous=started-1;
  for(const row of doc.reports){
    const t=instant(row.observedAt);
    requireCondition(t>=started&&t<=finished&&t>previous&&row.activationAllowed===false
      &&row.candidateIdentity==='exact-laboratory-card-digest-not-admission','OBSERVATION_TIME_OR_IDENTITY');
    previous=t;
  }
  return finished;
}

/**
 * Exact, offline compatibility check. Pins were captured from two known
 * successful GitHub jobs; they are not a general receipt-signing authority.
 * The historical finish time is used only for reproducing historical checks.
 * No database I/O, no fresh evidence, no trusted-history or editorial approval.
 */
export function verifyHistoricalObservation(receiptBytes,baselineBytes){
  const baseline=decodePinned(baselineBytes,BASELINE);
  const receipt=decodePinned(receiptBytes,RECEIPT);
  requireCondition(baseline.kind==='observed-evidence-not-approval'&&baseline.workflowRun===BASELINE.run
    &&baseline.workflowJob===BASELINE.job&&baseline.state==='observations-collected','BASELINE_PROVENANCE');
  const baselineFinished=envelope(baseline,BASELINE),finished=envelope(receipt,RECEIPT);
  requireCondition(instant(receipt.startedAt)>baselineFinished,'HISTORY_ORDER');
  const reconstructed=[];
  const observations=IDS.map((id,i)=>{
    const matches=knowledgeRightsCandidates.filter(card=>card.id===id);
    requireCondition(matches.length===1&&validKnowledgeCard(matches[0]),'CARD_INVALID');
    const card=matches[0],rights=knowledgeRightsForCard(card);
    requireCondition(Boolean(rights),'RIGHTS_BINDING');
    const identity={id:card.id,revision:card.revision,digest:knowledgeContentDigest(card),
      payload:knowledgeEditorialPayload(card),sourceUrl:card.source.url,policyUrl:rights.policyUrl,
      reviewedAt:card.reviewedAt,publishAt:card.publishAt,reviewBy:card.reviewBy};
    const observation=receipt.reports[i],prior=baseline.reports[i];
    const revalidation=compareKnowledgeObservations({identity,observation,baselineObservation:prior,now:finished});
    const claimEvidence=assessKnowledgeClaimEvidence(identity,observation);
    requireCondition(isDeepStrictEqual(revalidation,observation.revalidation)
      &&isDeepStrictEqual(claimEvidence,observation.claimEvidence),'RECOMPUTATION_MISMATCH');
    requireCondition(revalidation.mode==='comparison-only'&&revalidation.activationAllowed===false
      &&revalidation.feed.state==='review-required'&&revalidation.standalone.state==='review-required'
      &&/^[a-f0-9]{64}$/u.test(revalidation.evidenceDigest??'')
      &&claimEvidence.state==='evidence-ready-for-independent-review'&&claimEvidence.fields.length===12
      &&claimEvidence.independentReviewRequired===true&&claimEvidence.activationAllowed===false,'BOUNDARY');
    reconstructed.push({...observation,revalidation,claimEvidence});
    return Object.freeze({id,revision:identity.revision,candidateDigest:identity.digest,
      observedAt:observation.observedAt,evidenceDigest:revalidation.evidenceDigest,
      comparison:revalidation.comparison.state,changed:Object.freeze([...revalidation.comparison.changed]),
      claimFields:claimEvidence.fields.length,claimChecks:claimEvidence.claimChecks.length,
      feed:revalidation.feed.state,standalone:revalidation.standalone.state});
  });
  const result=assessKnowledgeProbeOutcome(reconstructed,[...IDS]);
  requireCondition(result.complete===true&&result.activationAllowed===false
    &&Object.entries(result).every(([key,value])=>receipt[key]===value),'OUTCOME');
  return Object.freeze({kind:'verified-historical-replay-not-attestation',sourceRun:RECEIPT.run,
    sourceJob:RECEIPT.job,sourceCommit:RECEIPT.commit,baselineRun:BASELINE.run,
    receiptSha256:RECEIPT.sha256,baselineSha256:BASELINE.sha256,finishedAt:receipt.finishedAt,
    observations:Object.freeze(observations),historicalOnly:true,liveObservation:false,
    ledgerWritable:false,activationAllowed:false});
}
