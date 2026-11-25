import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyDiscoveryBatch,assessDiscoveryReview} from '../.build/src/iceo/discovery-qualification.js';
const now='2026-11-23T12:00:00.000Z';
const discovery=(overrides={})=>({index:'gdelt',recordUrl:'https://data.gdeltproject.org/gdeltv3/gal/feed.rss?access_token=private',sourceName:'Tuvalu Observer',sourceUrl:'https://tuvalu-observer.example.org/story/234',observedAt:'2026-11-23T11:59:00.000Z',...overrides});

const reviewFor=proposal=>({
 reviewer:'ICEO editor',sourceOrigin:proposal.candidate.origin,
 termsUrl:proposal.candidate.origin+'/terms',rightsEvidenceUrl:proposal.candidate.origin+'/permissions',
 robotsUrl:proposal.candidate.origin+'/robots.txt',rightsBasis:'publisher-terms',requestedUse:'metadata-links',
 publisherIdentityVerified:true,termsReviewed:true,termsDecision:'permitted',robotsReviewed:true,robotsDecision:'permitted',
 checkedAt:'2026-11-22T12:00:00.000Z',reviewBy:'2026-12-22T12:00:00.000Z',
});

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
 const good=reviewFor(proposal);
 const approval=assessDiscoveryReview(proposal,good,now);
 assert.deepEqual(approval,{disposition:'complete-for-human-review',issues:[],activationAllowed:false});
 assert.equal(assessDiscoveryReview(proposal,{...good,reviewBy:'2026-11-20T12:00:00.000Z'},now).disposition,'blocked');
 assert.equal(assessDiscoveryReview(proposal,{...good,publisherIdentityVerified:false},now).disposition,'blocked');
 assert.equal(assessDiscoveryReview(proposal,{...good,rightsEvidenceUrl:'http://localhost/private'},now).disposition,'blocked');
 assert.throws(()=>assessDiscoveryReview(proposal,good,'tomorrow'),/ICEO_DISCOVERY_REVIEW_CLOCK_INVALID/);
});

test('reviewed prohibitions and unknown decisions stay blocked for every requested use',()=>{
 const [proposal]=qualifyDiscoveryBatch([discovery()],now).proposals;
 for(const requestedUse of ['metadata-links','licensed-excerpt']){
  const good={...reviewFor(proposal),requestedUse};
  for(const decision of ['prohibited','unknown',undefined,null,true,'PERMITTED']){
   for(const [field,issue]of [['termsDecision','terms-not-permitted'],['robotsDecision','robots-not-permitted']]){
    const result=assessDiscoveryReview(proposal,{...good,[field]:decision},now);
    assert.equal(result.disposition,'blocked');
    assert.ok(result.issues.includes(issue));
    assert.equal(result.activationAllowed,false);
   }
  }
  for(const [field,issue]of [['termsReviewed','terms-unreviewed'],['robotsReviewed','robots-unreviewed']]){
   const result=assessDiscoveryReview(proposal,{...good,[field]:false},now);
   assert.equal(result.disposition,'blocked');assert.ok(result.issues.includes(issue));
  }
 }
});

test('legacy reviewed flags without explicit permission and source binding cannot complete a review',()=>{
 const [proposal]=qualifyDiscoveryBatch([discovery()],now).proposals;
 const {sourceOrigin,robotsUrl,termsDecision,robotsDecision,...legacy}=reviewFor(proposal);
 const result=assessDiscoveryReview(proposal,legacy,now);
 assert.equal(result.disposition,'blocked');
 for(const issue of ['source-origin-mismatch','robots-origin-mismatch','terms-not-permitted','robots-not-permitted'])assert.ok(result.issues.includes(issue));
 assert.equal(result.activationAllowed,false);
});

test('review evidence is bound to the exact source and robots origin, including aliases',()=>{
 const [proposal]=qualifyDiscoveryBatch([discovery()],now).proposals,good=reviewFor(proposal);
 for(const sourceOrigin of [
  'https://another-paper.example.org','https://www.tuvalu-observer.example.org',
  good.sourceOrigin+'/','http://tuvalu-observer.example.org',
  'https://user@tuvalu-observer.example.org',good.sourceOrigin+'?token=private',
 ]){
  const result=assessDiscoveryReview(proposal,{...good,sourceOrigin},now);
  assert.equal(result.disposition,'blocked');assert.ok(result.issues.includes('source-origin-mismatch'));
 }
 for(const robotsUrl of [
  'https://another-paper.example.org/robots.txt','https://www.tuvalu-observer.example.org/robots.txt',
  good.robotsUrl+'?cache=1',good.robotsUrl+'#section',good.sourceOrigin+'/robots.txt/','http://tuvalu-observer.example.org/robots.txt',
 ]){
  const result=assessDiscoveryReview(proposal,{...good,robotsUrl},now);
  assert.equal(result.disposition,'blocked');assert.ok(result.issues.includes('robots-origin-mismatch'));
 }
 const [other]=qualifyDiscoveryBatch([discovery({sourceUrl:'https://another-paper.example.org/story',sourceName:'Another paper'})],now).proposals;
 assert.equal(assessDiscoveryReview(other,good,now).disposition,'blocked');
 const external={...good,rightsBasis:'explicit-license',rightsEvidenceUrl:'https://creativecommons.org/licenses/by/4.0/'};
 assert.equal(assessDiscoveryReview(proposal,external,now).disposition,'complete-for-human-review','external license document is not the publisher identity');
 assert.equal(assessDiscoveryReview(proposal,external,now).activationAllowed,false);
});

test('country-like origins and multilingual labels use one review rule without asserting geography or fetching',()=>{
 const fetcher=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('network forbidden')};
 try{
  for(const [host,name]of [
   ['newspaper.example.be','Journal local'],['newspaper.example.ru','Местные новости'],
   ['newspaper.example.tv','Island reporting'],['newspaper.example.jp','地域ニュース'],
   ['newspaper.example.za','Community news'],['newspaper.example.br','Noticias locais'],
  ]){
   const [proposal]=qualifyDiscoveryBatch([discovery({sourceUrl:'https://'+host+'/story',sourceName:name})],now).proposals;
   assert.ok(proposal);assert.equal(proposal.candidate.countryCode,null);assert.equal(proposal.candidate.scope,'unknown');
   const good=reviewFor(proposal),result=assessDiscoveryReview(proposal,good,now);
   assert.deepEqual(result,{disposition:'complete-for-human-review',issues:[],activationAllowed:false});
   assert.equal(assessDiscoveryReview(proposal,{...good,termsDecision:'prohibited'},now).disposition,'blocked');
  }
  assert.equal(calls,0);
 }finally{globalThis.fetch=fetcher;}
});

test('a forged candidate state cannot borrow a complete review',()=>{
 const [proposal]=qualifyDiscoveryBatch([discovery()],now).proposals,good=reviewFor(proposal);
 for(const patch of [
  {status:'configured'},{acquisition:'configured'},{rights:'reviewed-until-expiry'},
  {scope:'country',countryCode:'BE'},{scope:'international'},{countryCode:'RU'},
  {id:'discovered:another-paper.example.org'},{origin:'https://127.0.0.1'},
  {vertical:undefined},{vertical:'official'},{vertical:'science'},{name:' Tuvalu Observer '},{extra:'unreviewed'},
 ]){
  const changed={...proposal,candidate:{...proposal.candidate,...patch}};
  const result=assessDiscoveryReview(changed,good,now);
  assert.equal(result.disposition,'blocked');assert.ok(result.issues.includes('invalid-candidate'));
  assert.equal(result.activationAllowed,false);
 }
 for(const malformed of [null,{}, {...proposal,candidate:null}]){
  const result=assessDiscoveryReview(malformed,good,now);
  assert.equal(result.disposition,'blocked');assert.ok(result.issues.includes('invalid-candidate'));
 }
});

test('non-news discovery preserves its own validated vertical during source review',()=>{
 for(const [index,recordUrl,vertical]of [
  ['openalex','https://api.openalex.org/sources/S42','science'],
  ['reliefweb','https://api.reliefweb.int/v1/reports/42','humanitarian'],
  ['media-cloud','https://mediacloud.org/sources/42','news'],
 ]){
  const [proposal]=qualifyDiscoveryBatch([discovery({index,recordUrl,sourceName:'Primary institution',sourceUrl:'https://new-institution.example.org'})],now).proposals;
  assert.ok(proposal);assert.equal(proposal.candidate.vertical,vertical);
  const good=reviewFor(proposal);
  assert.deepEqual(assessDiscoveryReview(proposal,good,now),{disposition:'complete-for-human-review',issues:[],activationAllowed:false});
 }
});

test('invalid index, altered provenance and stale directory records cannot borrow a review',()=>{
 const [proposal]=qualifyDiscoveryBatch([discovery()],now).proposals,good=reviewFor(proposal);
 for(const patch of [
  {discoveryIndex:'unknown-index'},{discoveryIndex:'openalex'},
  {recordReference:'https://another-index.example.org/record'},
  {observedAt:'2026-10-01T12:00:00.000Z'},{observedAt:'2026-11-24T12:00:00.000Z'},
  {provenance:'verified'},{admission:'auto-approved'},{extra:'unreviewed'},
 ]){
  const result=assessDiscoveryReview({...proposal,...patch},good,now);
  assert.equal(result.disposition,'blocked');assert.ok(result.issues.includes('invalid-candidate'));
 }
 const {vertical,...missingVertical}=proposal.candidate;
 assert.ok(assessDiscoveryReview({...proposal,candidate:missingVertical},good,now).issues.includes('invalid-candidate'));
});
