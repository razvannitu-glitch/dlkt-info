import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {assessKnowledgeRevalidation} from '../scripts/knowledge-editorial-revalidation.mjs';
import {knowledgeRightsCandidates} from '../source/tests/fixtures/knowledge-rights-candidates.mjs';
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const file=JSON.parse(readFileSync(new URL('../docs/evidence/knowledge-editorial-observation-20261126.json',import.meta.url),'utf8'));
const baseline=file.reports[0],card=knowledgeRightsCandidates.find(x=>x.id===baseline.id);
const languages=['en','ro','it'],rights=['© State of New South Wales. For current information go to www.nsw.gov.au.','https://creativecommons.org/licenses/by/4.0/',baseline.policyUrl];
function payload(c){return JSON.stringify(['dlkt-knowledge-editorial-v1',c.kind,c.id,c.revision,c.category,c.format??null,c.calendarDay??null,c.distribution??null,[c.source.publisher,c.source.url],[c.geography.countryCode,[...c.geography.cityIds],languages.map(l=>c.geography.label[l])],languages.map(l=>[l,c.topic[l],c.copy[l].title,c.copy[l].explanation,c.copy[l].connection]),c.reviewedAt,c.publishAt??null,c.reviewBy,rights]);}
const identity={id:card.id,revision:card.revision,digest:hash(payload(card)),payload:payload(card),sourceUrl:card.source.url,policyUrl:baseline.policyUrl,reviewedAt:card.reviewedAt,publishAt:card.publishAt,reviewBy:card.reviewBy};
const now=Date.parse('2026-11-27T12:00:00.000Z'),observedAt=new Date(now-60000).toISOString();
const current={...baseline,observedAt};
const feedApproval={id:identity.id,revision:identity.revision,digest:identity.digest,payload:identity.payload};
const standaloneApproval={id:identity.id,revision:identity.revision,digest:identity.digest,reviewedAt:Date.parse('2026-11-26T21:00:00.000Z'),expiresAt:now+600000};
const call=patch=>assessKnowledgeRevalidation({identity,observation:current,previousObservation:baseline,now,...patch});
const first=call({observation:baseline,previousObservation:null,now:Date.parse(baseline.observedAt)});
const reviewedAt='2026-11-26T21:00:00.000Z';
const feedReview={scope:'feed',id:identity.id,revision:identity.revision,digest:identity.digest,decision:'permitted',claims:'verified',translations:'verified',origin:'verified',usefulness:'verified',attribution:'verified',exceptions:'cleared',observation:baseline,evidenceDigest:first.evidenceDigest,reviewedAt,expiresAt:'2026-11-28T00:00:00.000Z'};
const standaloneReview={...feedReview,scope:'standalone'};
const trusted={feedApproval,standaloneApproval,feedReview,standaloneReview};
test('real receipt provenance binds the exact laboratory payload, not a review',()=>{
 assert.equal(file.kind,'observed-evidence-not-approval');assert.equal(file.workflowRun,45888933255);assert.equal(file.commit,'bad1a13a88cb2c132aaf72f6bd50d600559b6c53');
 assert.equal(identity.digest,baseline.candidateDigest);assert.ok(first.evidenceDigest);
 const r=call({});assert.equal(r.comparison.state,'unchanged');assert.equal(r.activationAllowed,false);assert.equal(r.feed.state,'review-required');assert.equal(r.standalone.state,'review-required');
});
test('existing independent synthetic approvals can be reused only in their original windows',()=>{
 const r=call(trusted);assert.equal(r.feed.state,'reuse-eligible');assert.equal(r.standalone.state,'reuse-eligible');assert.equal(r.activationAllowed,false);
 assert.equal(r.feed.validUntil,feedReview.expiresAt);assert.equal(r.standalone.validUntil,new Date(standaloneApproval.expiresAt).toISOString());
 const feed=call({feedApproval,feedReview});assert.equal(feed.feed.state,'reuse-eligible');assert.equal(feed.standalone.state,'review-required');
 const share=call({standaloneApproval,standaloneReview});assert.equal(share.feed.state,'review-required');assert.equal(share.standalone.state,'review-required');
 assert.equal(call({...trusted,now:Date.parse(identity.publishAt)-1}).feed.state,'held');
});
test('same-revision text, wrong source, wrong payload or review identity cannot reuse approval',()=>{
 for(const patch of [
  {identity:{...identity,payload:identity.payload+' '}},
  {identity:{...identity,sourceUrl:'https://www.nsw.gov.au/different'}},
  {identity:{...identity,reviewBy:'2026-12-27T00:00:00.000Z'}},
  {observation:{...current,candidateDigest:'f'.repeat(64)}},
  {feedApproval:{...feedApproval,payload:identity.payload+' '}},
  {feedReview:{...feedReview,digest:'f'.repeat(64)}},
  {feedReview:{...feedReview,scope:'standalone'}},
 ]){const r=call({...trusted,...patch});assert.notEqual(r.feed.state,'reuse-eligible');assert.notEqual(r.standalone.state,'reuse-eligible');assert.equal(r.activationAllowed,false);}
});
test('any reviewed document byte change triggers exception review, even identical visible text',()=>{
 for(const [field,key] of [['robots','bodySha256'],['source','bodySha256'],['source','mainSha256'],['terms','bodySha256'],['terms','mainSha256']]){
  const observation=structuredClone(current);observation[field][key]='f'.repeat(64);
  const r=call({...trusted,observation});assert.equal(r.comparison.state,'changed');assert.equal(r.comparison.changed.length,1);assert.equal(r.feed.state,'review-required');assert.equal(r.standalone.state,'review-required');
 }
});
test('denied, stale, future, incomplete and forged evidence is held',()=>{
 for(const observation of [
  {...current,state:'held'},{...current,observedAt:new Date(now-86400000).toISOString()},
  {...current,observedAt:new Date(now+1).toISOString()},
  {...current,access:{...current.access,source:{allowed:false}}},
  {...current,source:{...current.source,canonicalObserved:false}},
  {...current,terms:{...current.terms,complete:false}},
  {...current,terms:{...current.terms,signals:{licence:true}}},
  {...current,robots:{...current.robots,bodySha256:'not-a-digest'}},
 ]){const r=call({...trusted,observation});assert.equal(r.feed.state,'held');assert.equal(r.standalone.state,'held');}
});
test('observations must be ordered and prior review must bind the actual evidence',()=>{
 for(const feedReviewPatch of [{evidenceDigest:'f'.repeat(64)},{claims:'unknown'},{exceptions:'unknown'},{translations:'unknown'},{reviewedAt:'2026-11-26T00:00:00.000Z'},{expiresAt:'2026-12-27T00:00:00.000Z'}]){
  const r=call({...trusted,feedReview:{...feedReview,...feedReviewPatch}});assert.notEqual(r.feed.state,'reuse-eligible');
 }
 const r=call({...trusted,previousObservation:{...current,observedAt:new Date(now-1).toISOString()}});assert.equal(r.feed.state,'held');
});
test('expiry is exact and new observations never extend prior approval',()=>{
 const expiredAt=Date.parse(feedReview.expiresAt);
 const observation={...current,observedAt:new Date(expiredAt-1000).toISOString()};
 assert.equal(call({...trusted,now:expiredAt,observation}).feed.state,'held');
 const t=standaloneApproval.expiresAt;
 const r=call({...trusted,now:t,observation:{...current,observedAt:new Date(t-1000).toISOString()}});
 assert.equal(r.feed.state,'reuse-eligible');assert.equal(r.standalone.state,'held');
 const latest={...current,observedAt:new Date(now-23*3600000).toISOString()};
 const limited=call({...trusted,observation:latest,previousObservation:null,feedReview:{...feedReview,reviewedAt,expiresAt:'2026-11-28T00:00:00.000Z'}});
 // This is older than the reviewed baseline; a newer clock cannot rehabilitate it.
 assert.notEqual(limited.feed.state,'reuse-eligible');
});

test('standalone reuse cannot outlive the feed decision even with a later standalone approval',()=>{
 const shorter={...feedReview,expiresAt:new Date(now+1000).toISOString()};
 const r=call({...trusted,feedReview:shorter});
 assert.equal(r.feed.state,'reuse-eligible');assert.equal(r.standalone.state,'reuse-eligible');
 assert.equal(r.feed.validUntil,shorter.expiresAt);assert.equal(r.standalone.validUntil,shorter.expiresAt);
});
test('a change since the latest observation requires review even if bytes return to an older approved state',()=>{
 const previous={...baseline,source:{...baseline.source,bodySha256:'f'.repeat(64)}};
 const r=call({...trusted,previousObservation:previous});
 assert.equal(r.comparison.state,'changed');assert.equal(r.feed.state,'review-required');assert.equal(r.standalone.state,'review-required');
});
test('a prior decision cannot be based on observations already stale at review time',()=>{
 const reviewedAt=new Date(Date.parse(baseline.observedAt)+86400000).toISOString(),later=Date.parse(reviewedAt)+1000;
 const r=call({...trusted,now:later,observation:{...current,observedAt:new Date(later-100).toISOString()},feedReview:{...feedReview,reviewedAt}});
 assert.equal(r.feed.state,'review-required');assert.equal(r.standalone.state,'review-required');
});
