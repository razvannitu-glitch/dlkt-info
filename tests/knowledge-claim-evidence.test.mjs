import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parseDocument,DomUtils} from 'htmlparser2';
import {knowledgeClaimAnchors,observeClaimAnchors,assessKnowledgeClaimEvidence} from '../scripts/knowledge-claim-evidence.mjs';
import {knowledgeRightsCandidates} from '../source/tests/fixtures/knowledge-rights-candidates.mjs';
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const baseline=JSON.parse(readFileSync(new URL('../docs/evidence/knowledge-editorial-observation-20261126.json',import.meta.url),'utf8'));
const langs=['en','ro','it'];
function fixture(index){
 const receipt=structuredClone(baseline.reports[index]),card=knowledgeRightsCandidates.find(x=>x.id===receipt.id);
 const credit=index===0?'© State of New South Wales. For current information go to www.nsw.gov.au.':'Crown Copyright ©, Commerce Commission.';
 const rights=[credit,'https://creativecommons.org/licenses/by/4.0/',receipt.policyUrl];
 const payload=JSON.stringify(['dlkt-knowledge-editorial-v1',card.kind,card.id,card.revision,card.category,card.format??null,card.calendarDay??null,card.distribution??null,[card.source.publisher,card.source.url],[card.geography.countryCode,[...card.geography.cityIds],langs.map(l=>card.geography.label[l])],langs.map(l=>[l,card.topic[l],card.copy[l].title,card.copy[l].explanation,card.copy[l].connection]),card.reviewedAt,card.publishAt??null,card.reviewBy,rights]);
 const identity={id:card.id,revision:card.revision,digest:hash(payload),payload,sourceUrl:card.source.url,policyUrl:receipt.policyUrl};
 // Synthetic matched-anchor counts test the coverage boundary, not live evidence.
 for(const role of ['source','terms'])receipt[role].claimAnchors=Object.fromEntries(Object.entries(knowledgeClaimAnchors(card.id,role)).map(([key,digest])=>[key,{digest,matches:1}]));
 return {identity,receipt};
}
test('complete paragraph matching is exact, with no keyword or substring approval',()=>{
 const sentence='A controlled positive statement.',expected={fact:hash(sentence)};
 const observe=html=>observeClaimAnchors(DomUtils.getElementsByTagName('main',parseDocument('<main>'+html+'</main>'),true)[0],expected,DomUtils.textContent);
 assert.equal(observe('<p>'+sentence+'</p>').fact.matches,1);
 assert.equal(observe('<p>Not: '+sentence+'</p>').fact.matches,0);
 assert.equal(observe('<p>'+sentence+' It is false.</p>').fact.matches,0);
 assert.equal(observe('<p>'+sentence+'</p><p>'+sentence+'</p>').fact.matches,2);
 assert.equal(observe('<div hidden><p>'+sentence+'</p></div>').fact.matches,0);
 assert.equal(observe('<div style="display: none"><p>'+sentence+'</p></div>').fact.matches,0);
 assert.equal(observe('<div aria-hidden="true"><p>'+sentence+'</p></div>').fact.matches,0);
 assert.equal(observe('<nav><p>'+sentence+'</p></nav>').fact.matches,0);
 assert.equal(observe('<ul><li>'+sentence+'</li></ul>').fact.matches,1);
});
test('both exact mapped candidates cover every displayed field in each language without authorization',()=>{
 for(let i=0;i<2;i++){
  const {identity,receipt}=fixture(i),r=assessKnowledgeClaimEvidence(identity,receipt);
  assert.equal(identity.digest,receipt.candidateDigest);
  assert.equal(r.state,'evidence-ready-for-independent-review');assert.equal(r.activationAllowed,false);
  assert.equal(r.independentReviewRequired,true);assert.equal(r.translationReviewRequired,true);assert.equal(r.rightsReviewRequired,true);
  assert.equal(r.fields.length,12);
  for(const language of langs)assert.deepEqual(r.fields.filter(f=>f.language===language).map(f=>f.field).sort(),['connection','explanation','title','topic']);
  assert.ok(r.claimChecks.some(c=>c.kind==='primary-source-fact'));assert.ok(r.claimChecks.some(c=>c.kind==='editorial-guidance'));
  assert.ok(r.fields.every(f=>f.claims.every(id=>r.claimChecks.some(c=>c.id===id))));
 }
});
test('every language copy mutation and revision change requires new mapping, even if the caller rehashes',()=>{
 const {identity,receipt}=fixture(0);
 for(let i=0;i<3;i++)for(let field=1;field<=4;field++){
  const p=JSON.parse(identity.payload);p[10][i][field]+=' changed';
  const payload=JSON.stringify(p),digest=hash(payload),r=assessKnowledgeClaimEvidence({...identity,payload,digest},{...receipt,candidateDigest:digest});
  assert.equal(r.state,'held');assert.equal(r.activationAllowed,false);
 }
 const p=JSON.parse(identity.payload);p[3]++;const payload=JSON.stringify(p),digest=hash(payload);
 assert.equal(assessKnowledgeClaimEvidence({...identity,payload,digest,revision:p[3]},{...receipt,candidateDigest:digest,revision:p[3]}).state,'held');
});
test('missing, duplicate, wrong or changed evidence cannot become semantic approval',()=>{
 for(const role of ['source','terms'])for(const kind of ['missing','duplicate','wrong']){
  const {identity,receipt}=fixture(1),key=Object.keys(receipt[role].claimAnchors)[0];
  if(kind==='missing')delete receipt[role].claimAnchors[key];
  if(kind==='duplicate')receipt[role].claimAnchors[key].matches=2;
  if(kind==='wrong')receipt[role].claimAnchors[key].digest='f'.repeat(64);
  const r=assessKnowledgeClaimEvidence(identity,receipt);assert.equal(r.state,'held');assert.equal(r.activationAllowed,false);
 }
 const {identity,receipt}=fixture(0);receipt.source.canonicalObserved=false;
 assert.equal(assessKnowledgeClaimEvidence(identity,receipt).state,'held');
});
