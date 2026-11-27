import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {KNOWLEDGE_EDITORIAL_APPROVALS,knowledgeEditorialPayload,knowledgeRightsForCard,validateKnowledgeCatalog} from '../.build/src/iceo/knowledge.js';
import {selectInlineKnowledge,interleaveKnowledge} from '../.build/src/iceo/knowledge-stream.js';
import {resolveKnowledgeShare,knowledgeContentDigest} from '../.build/src/share/knowledge-resolution.js';
import {knowledgeRightsCandidates} from './fixtures/knowledge-rights-candidates.mjs';
const evidence=JSON.parse(readFileSync(new URL('./evidence/nsw-fuelcheck-admission-20261126.json',import.meta.url),'utf8'));
const id='dlkt-elsewhere-nsw-fuelcheck',digest='d4c1df98ae87865402292c04c46811d60eee7ed3bde9583f1e16cd243611110e',card=KNOWLEDGE_CARDS.find(item=>item.id===id);
const reviewed=Date.parse(card.reviewedAt),expires=Date.parse(card.reviewBy);
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
test('the first actual release candidate is bound to the reviewed copy, fresh exact observation and independent scope decisions',async()=>{
 assert.equal(evidence.kind,'dlkt-exact-admission-release-candidate');
 assert.equal(evidence.candidateDigest,digest);assert.equal(evidence.cardId,id);assert.equal(card.revision,1);
 assert.equal(knowledgeContentDigest(card),digest);assert.equal(sha(knowledgeEditorialPayload(card)),digest);
 assert.equal(evidence.reviewedAt,card.reviewedAt);assert.equal(evidence.reviewBy,card.reviewBy);assert.equal(expires-reviewed,30*86400000);
 assert.equal(Object.hasOwn(card,'publishAt'),false);
 assert.equal(evidence.review.feedSuitability,'eligible');assert.equal(evidence.review.standaloneSuitability,'eligible');
 assert.equal(evidence.observation.workflowRun,45892402385);assert.equal(evidence.observation.workflowJob,140157984340);
 const r=evidence.observation.receipt,observed=Date.parse(r.observedAt);
 assert.equal(r.candidateDigest,digest);assert.equal(r.id,id);assert.equal(r.revision,1);assert.equal(r.activationAllowed,false);
 assert.equal(r.reviewedDocumentContinuity.state,'unchanged-from-reviewed-documents');assert.equal(r.reviewedDocumentContinuity.finalCandidateDigest,digest);
 assert.equal(r.reviewedDocumentContinuity.reviewedLabDigest,evidence.priorLabDigest);assert.notEqual(evidence.priorLabDigest,digest);
 assert.equal(r.claimEvidence.state,'evidence-ready-for-independent-review');assert.equal(r.claimEvidence.fields.length,12);
 assert.ok(observed>=reviewed&&observed-reviewed<86400000);
 assert.ok(r.access.source.allowed&&r.access.policy.allowed);
 assert.equal(r.sourceUrl,card.source.url);assert.equal(r.policyUrl,knowledgeRightsForCard(card).policyUrl);
 const fingerprints=[r.robots.bodySha256,r.source.bodySha256,r.source.mainSha256,r.terms.bodySha256,r.terms.mainSha256];
 const observationDigest=sha(JSON.stringify(['dlkt-knowledge-observation-v1',id,card.revision,digest,r.sourceUrl,r.policyUrl,r.observedAt,fingerprints]));
 assert.equal(r.revalidation.evidenceDigest,observationDigest);
 for(const page of [r.source,r.terms]){assert.equal(page.status,200);assert.equal(page.complete,true);assert.equal(page.canonicalObserved,true);assert.ok(Object.values(page.claimAnchors).every(a=>a.matches===1));}
 assert.deepEqual(evidence.decisions.map(d=>d.scope),['feed','standalone']);
 for(const decision of evidence.decisions){assert.equal(decision.decision,'permit-on-verified-release');assert.equal(decision.id,id);assert.equal(decision.revision,1);assert.equal(decision.digest,digest);assert.equal(decision.evidenceDigest,observationDigest);assert.equal(decision.reviewedAt,card.reviewedAt);assert.equal(decision.expiresAt,card.reviewBy);}
 assert.deepEqual(KNOWLEDGE_EDITORIAL_APPROVALS.map(a=>[a.id,a.revision,a.digest]),[[id,1,digest]]);
 assert.equal(KNOWLEDGE_EDITORIAL_APPROVALS[0].payload,knowledgeEditorialPayload(card));
 const view=await resolveKnowledgeShare({id,revision:1,digest,language:'en'},observed);
 assert.ok(view);assert.equal(view.validUntil,expires);
});
test('the real feed selection preserves origin, lifecycle and the eleven-news cadence',()=>{
 for(const [countryCode,scope] of [['AU','country'],['RO','global'],[null,'global']]){
  const context={countryCode,cityId:null,timeZone:'UTC'};
  assert.equal(selectInlineKnowledge([card],context,reviewed-1,'admission').length,0);
  const items=selectInlineKnowledge([card],context,reviewed,'admission');
  assert.equal(items.length,1);assert.equal(items[0].scope,scope);assert.strictEqual(items[0].card,card);
  assert.equal(selectInlineKnowledge([card],context,expires,'admission').length,0);
  const news=Array.from({length:24},(_,i)=>({key:'n-'+i})),stream=interleaveKnowledge(news,items);
  assert.deepEqual(stream.filter(x=>x.kind==='news').map(x=>x.item),news);
  assert.equal(stream.filter(x=>x.kind==='knowledge').length,1);assert.equal(stream.find(x=>x.kind==='knowledge').afterNews,11);
 }
 assert.equal(card.geography.countryCode,'AU');assert.deepEqual(card.geography.cityIds,[]);
 assert.equal(card.copy.ro.topic,undefined);
 assert.equal(card.topic.ro,'Compararea prețurilor carburanților');
 for(const fixture of knowledgeRightsCandidates)assert.throws(()=>validateKnowledgeCatalog([fixture]),/KNOWLEDGE_EDITORIAL_APPROVAL_REQUIRED/);
 for(const language of ['en','ro','it'])for(const field of ['title','explanation','connection']){
  const changed=structuredClone(card);changed.copy[language][field]+=' X';
  assert.throws(()=>validateKnowledgeCatalog([changed]),/KNOWLEDGE_EDITORIAL_APPROVAL_REQUIRED/);
 }
 assert.ok(!KNOWLEDGE_CARDS.some(c=>c.id==='dlkt-elsewhere-nz-unit-pricing'));
});
