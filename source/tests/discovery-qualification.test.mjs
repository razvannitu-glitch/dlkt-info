import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyDiscoveryBatch,assessDiscoveryReview} from '../.build/src/iceo/discovery-qualification.js';
const now='2026-11-23T12:00:00.000Z';
const discovery=(overrides={})=>({index:'gdelt',recordUrl:'https://data.gdeltproject.org/gdeltv3/gal/feed.rss?access_token=private',sourceName:'Tuvalu Observer',sourceUrl:'https://tuvalu-observer.example.org/story/234',observedAt:'2026-11-23T11:59:00.000Z',...overrides});

test('controlled staging never activates, geolocates or republishes a source',()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('network forbidden')};
 try{
  const batch=qualifyDiscoveryBatch([discovery(),discovery({index:'openalex',recordUrl:'https://api.openalex.org/sources/S42',sourceName:'Science Journal',sourceUrl:'https://new-science.example.org/home'})],now);
  assert.equal(batch.received,2);assert.equal(batch.proposals.length,2);assert.equal(batch.rejected.length,0);
  assert.equal(calls,0);
  assert.equal(batch.proposals[0].candidate.origin,'https://tuvalu-observer.example.org');
  assert.equal(batch.proposals[0].candidate.scope,'unknown');
  assert.equal(batch.proposals[1].candidate.vertical,'science');
  assert.equal(batch.proposals[1].admission,'manual-review-only');
  assert.equal(batch.proposals[0].provenance,'unverified-index-metadata');
  assert.equal(batch.proposals[0].recordReference,'https://data.gdeltproject.org/gdeltv3/gal/feed.rss');
  assert.equal(batch.proposals[0].candidate.rights,'source-specific-review-required');
 }finally{globalThis.fetch=original;}
});

test('deduplicates known origins and www aliases without merging distinct subdomains',()=>{
 const batch=qualifyDiscoveryBatch([
  discovery(),
  discovery({sourceUrl:'https://www.tuvalu-observer.example.org/home',sourceName:'Tuvalu Observer alias'}),
  discovery({sourceUrl:'https://www.who.int',sourceName:'WHO'}),
  discovery({sourceUrl:'https://health.tuvalu-observer.example.org',sourceName:'Health Tuvalu'}),
 ],now);
 assert.equal(batch.proposals.length,2);
 assert.deepEqual(batch.rejected.map(item=>item.reason),['duplicate-candidate','already-indexed']);
});

test('quarantines stale, future, forged-index, private, and malformed records without side effects',()=>{
 const invalid=[
  discovery({observedAt:'2026-10-01T12:00:00.000Z'}),
  discovery({observedAt:'2026-11-24T12:00:00.000Z'}),
  discovery({recordUrl:'https://data.gdeltproject.org.evil.invalid/record'}),
  discovery({recordUrl:'http://data.gdeltproject.org/record'}),
  discovery({sourceUrl:'https://127.0.0.1/private'}),
  discovery({sourceName:'<script>alert(1)</script>'}),
  discovery({index:'not-supported'}),
  discovery({observedAt:'2026-02-31T12:00:00.000Z'}),
 ];
 const result=qualifyDiscoveryBatch(invalid,now);
 assert.equal(result.proposals.length,0);assert.equal(result.rejected.length,invalid.length);
 assert.deepEqual(result.rejected.map(v=>v.reason),['stale-observation','stale-observation','untrusted-index','untrusted-index','invalid-source','invalid-source','invalid-record','stale-observation']);
 assert.throws(()=>qualifyDiscoveryBatch(Array(201).fill(discovery()),now),/ICEO_DISCOVERY_BATCH_INVALID/);
 assert.throws(()=>qualifyDiscoveryBatch({},now),/ICEO_DISCOVERY_BATCH_INVALID/);
 assert.throws(()=>qualifyDiscoveryBatch([], '2026-02-31T12:00:00.000Z'),/ICEO_DISCOVERY_BATCH_INVALID/);
});

test('rights evidence can only complete review checklist, not authorize acquisition',()=>{
 const [proposal]=qualifyDiscoveryBatch([discovery()],now).proposals;
 const good={reviewer:'ICEO editor',termsUrl:'https://tuvalu-observer.example.org/terms',rightsEvidenceUrl:'https://tuvalu-observer.example.org/permissions',rightsBasis:'publisher-terms',requestedUse:'metadata-links',publisherIdentityVerified:true,termsReviewed:true,robotsReviewed:true,checkedAt:'2026-11-22T12:00:00.000Z',reviewBy:'2026-12-22T12:00:00.000Z'};
 const approval=assessDiscoveryReview(proposal,good,now);
 assert.deepEqual(approval,{disposition:'complete-for-human-review',issues:[],activationAllowed:false});
 assert.equal(assessDiscoveryReview(proposal,{...good,reviewBy:'2026-11-20T12:00:00.000Z'},now).disposition,'blocked');
 assert.equal(assessDiscoveryReview(proposal,{...good,publisherIdentityVerified:false},now).disposition,'blocked');
 assert.equal(assessDiscoveryReview(proposal,{...good,rightsEvidenceUrl:'http://localhost/private'},now).disposition,'blocked');
 assert.throws(()=>assessDiscoveryReview(proposal,good,'tomorrow'),/ICEO_DISCOVERY_REVIEW_CLOCK_INVALID/);
});
