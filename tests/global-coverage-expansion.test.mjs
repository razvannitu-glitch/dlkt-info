import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildExpansionPlan,parseCoverageEvidence} from '../scripts/plan-global-coverage-expansion.mjs';
import {WORLD_OPERATIONAL_CODES,stateCoverage} from '../scripts/audit-global-coverage.mjs';

const model='2005ad5cf04f6ea0f04080eeb66a99f6d895b55d';
const first=readFileSync(new URL('../docs/iceo-global-coverage-baseline-20261127.md',import.meta.url),'utf8');
const second=readFileSync(new URL('../docs/evidence/global-coverage-operational-244-20261127.txt',import.meta.url),'utf8');
const plan=(a=first,b=second)=>buildExpansionPlan([a,b],model);
const change=(document,mutate)=>{const {report}=parseCoverageEvidence(document);mutate(report);return 'DLKT_GLOBAL_COVERAGE '+JSON.stringify(report);};

test('historical evidence yields the exact 244-place partition without summing publication counts',()=>{
 const p=plan(second,first);
 assert.equal(p.status,'EXPANSION_RESEARCH_ONLY');assert.equal(p.authorization,'NO_SOURCE_ACTIVATION');
 assert.deepEqual(p.samples.map(x=>x.revision),[4077,4083]);assert.deepEqual(p.samples.map(x=>x.total),[302,305]);
 assert.equal(p.gaps.denominator,244);assert.equal(p.gaps.configuredCount,11);assert.equal(p.gaps.observedCount,13);
 assert.deepEqual(p.gaps.buckets.observedWithoutDirect,['AU','IE','QA','SG']);
 assert.deepEqual(p.gaps.buckets.directWithoutObserved,['JP','NL']);
 assert.equal(p.gaps.buckets.configuredAndObserved.length,9);assert.equal(p.gaps.buckets.neitherInThisAudit.length,229);
 assert.deepEqual(p.countries.map(x=>x.code),WORLD_OPERATIONAL_CODES);
 assert.deepEqual(p.countries.find(x=>x.code==='AU'),{code:'AU',direct:false,review:'review-direct-opportunity',counts:[1,1],observedIn:2,minimum:1,maximum:1});
 assert.deepEqual(p.samples.map(x=>x.unknownCountry),[102,95]);
 assert.deepEqual(p.samples.map(x=>x.unknownLanguage),[102,95]);
 assert.equal(p.latestProvenanceReview.revision,4083);assert.equal(p.latestProvenanceReview.groups.reduce((n,x)=>n+x.count,0),95);
 assert.equal(p.modelBinding,'operator-declared-not-embedded-in-legacy-audits');
 assert.ok(p.samples.every(x=>/^[a-f0-9]{64}$/u.test(x.documentSha256)&&/^[a-f0-9]{64}$/u.test(x.reportLineSha256)));
});

test('editorial and language review remain independent and rank measured scarcity rather than demand',()=>{
 const p=plan();
 assert.equal(p.editorialReview.length,20);
 for(const [category,counts] of [['family',[0,0]],['money',[0,1]],['housing',[1,1]],['digital-life',[2,3]]]){
  assert.deepEqual(p.editorialReview.find(x=>x.category===category).counts,counts);
 }
 assert.equal(p.editorialReview[0].category,'family');
 assert.deepEqual(p.samples.map(x=>x.unclassifiedEditorial),[130,140]);
 assert.deepEqual(p.observedLanguages.find(x=>x.language==='en').counts,[62,68]);
 assert.ok(!p.observedLanguages.some(x=>x.language==='unknown'));
});

test('duplicate, held, malformed and incomparable evidence fails closed',()=>{
 assert.throws(()=>plan(first,first),/EXPANSION_INCOMPARABLE_OR_DUPLICATE/);
 assert.throws(()=>buildExpansionPlan([first],model),/EXPANSION_SAMPLE_COUNT/);
 assert.throws(()=>buildExpansionPlan([first,second],'main'),/EXPANSION_MODEL_RECEIPT_REQUIRED/);
 assert.throws(()=>plan(first,change(second,r=>{r.observed.health.status='ICEO_LIVE_BLOCKED';})),/EXPANSION_AUDIT_HELD/);
 assert.throws(()=>plan(first,change(second,r=>{r.baseline.directDiscoveryIndexes++;})),/EXPANSION_INCOMPARABLE_OR_DUPLICATE/);
 assert.throws(()=>plan(first,change(second,r=>{r.baseline.placeOptions++;})),/EXPANSION_REFERENCE_DRIFT/);
 assert.throws(()=>parseCoverageEvidence(first+'\n'+second),/EXPANSION_EVIDENCE_FRAME/);
 assert.throws(()=>parseCoverageEvidence('DLKT_GLOBAL_COVERAGE {'),/EXPANSION_EVIDENCE_JSON/);
});

test('independent count conservation rejects invented geography, language, editorial and provenance totals',()=>{
 for(const [mutate,error] of [
  [r=>{r.observed.publisherCountryCounts.AU++;},/EXPANSION_COUNTRY_CONSERVATION/],
  [r=>{r.observed.publisherCountryCounts.XX=1;},/EXPANSION_COUNTRY_UNRECOGNIZED/],
  [r=>{r.observed.languageCoverage.unknownLanguage++;},/EXPANSION_LANGUAGE_CONSERVATION/],
  [r=>{r.observed.languageCoverage.languages.push(r.observed.languageCoverage.languages[0]);},/EXPANSION_LANGUAGE_INVALID/],
  [r=>{r.observed.editorialCounts.family++;},/EXPANSION_EDITORIAL_CONSERVATION/],
  [r=>{r.observed.taxonomyCounts['01000000']++;},/EXPANSION_TAXONOMY_CONSERVATION/],
  [r=>{r.observed.unresolvedPublisherProvenance[0].count++;},/EXPANSION_PROVENANCE_CONSERVATION/],
 ])assert.throws(()=>plan(first,change(second,mutate)),error);
});

test('language without national provenance and non-state places never inflate the state denominator',()=>{
 const changed=change(second,r=>{
  const o=r.observed,c=o.publisherCountryCounts;c.HK=c.AU;delete c.AU;
  o.publisherCountryCoverage=stateCoverage([...Object.keys(c),...Array(o.publisherCountryCoverage.unknownRecordCount).fill(null)],WORLD_OPERATIONAL_CODES);
  o.languageCoverage.unknownLanguage--;o.languageCoverage.languages.find(x=>x.language==='en').count++;
 });
 const p=plan(first,changed);
 assert.equal(p.gaps.denominator,244);
 assert.equal(p.gaps.observedCount,14);
 assert.equal(p.countries.find(x=>x.code==='HK').observedIn,1);
 assert.deepEqual(p.samples.map(x=>x.unknownCountry),[102,95]);
 assert.deepEqual(p.samples.map(x=>x.unknownLanguage),[102,94]);
});

test('new classification pins cannot be mixed with historical unpinned reports or different classifiers',()=>{
 const tagged=(document,pin)=>change(document,r=>{r.baseline.classificationSourceSha256=pin;});
 const pin='a'.repeat(64),other='b'.repeat(64);
 assert.throws(()=>plan(first,tagged(second,pin)),/EXPANSION_INCOMPARABLE_OR_DUPLICATE/);
 assert.throws(()=>plan(tagged(first,pin),tagged(second,other)),/EXPANSION_INCOMPARABLE_OR_DUPLICATE/);
 for(const invalid of [null,'main','A'.repeat(64),123]){
  assert.throws(()=>plan(first,tagged(second,invalid)),/EXPANSION_CLASSIFICATION_PIN_INVALID/);
 }
 const consistent=plan(tagged(first,pin),tagged(second,pin));
 assert.equal(consistent.classificationSourceSha256,pin);
 assert.equal(consistent.modelBinding,'reported-source-pin-not-independently-authenticated');
 assert.equal(consistent.gaps.denominator,244);
 assert.equal(plan().classificationSourceSha256,null);
});
