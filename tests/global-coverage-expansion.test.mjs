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

const pinnedFirst=readFileSync(new URL('../docs/evidence/global-coverage-pinned-4825-20261128.txt',import.meta.url),'utf8');
const pinnedSecond=readFileSync(new URL('../docs/evidence/global-coverage-pinned-4828-20261128.txt',import.meta.url),'utf8');
const pinnedModel='d89db45c081a712aa2d2846a006096352b7cf96a';
const pinnedPlan=(a=pinnedFirst,b=pinnedSecond)=>buildExpansionPlan([a,b],pinnedModel);

test('incomplete historical provenance evidence never becomes a zero-filled comparison',()=>{
 const review=plan().provenanceReview;
 assert.deepEqual(review,{status:'incomplete-evidence',revisions:[4077,4083],missingRevisions:[4077],groups:null});
 assert.equal(plan().latestProvenanceReview.revision,4083);
 const missing=change(pinnedSecond,r=>{delete r.observed.unresolvedPublisherProvenance;});
 assert.deepEqual(pinnedPlan(pinnedFirst,missing).provenanceReview,{status:'incomplete-evidence',revisions:[4825,4828],missingRevisions:[4828],groups:null});
});

test('same pinned actual observations prioritize recurring unresolved publisher editions without conflating language or countries',()=>{
 const p=pinnedPlan(pinnedSecond,pinnedFirst),review=p.provenanceReview;
 assert.equal(p.classificationSourceSha256,'73774a7746fba30fb685d40f96f08173c065ac0f15a1a9a94710e5085b743344');
 assert.deepEqual(review.revisions,[4825,4828]);assert.equal(review.status,'complete-evidence');
 assert.deepEqual(review.missingRevisions,[]);assert.equal(review.groups.length,26);
 assert.deepEqual(review.groups[0],{target:'publisher:variety',reason:'reviewed-edition-context-missing',review:'review-publisher-edition',counts:[12,12],observedIn:2,minimum:12,maximum:12});
 const choose=id=>review.groups.find(x=>x.target===id);
 assert.deepEqual(choose('publisher:euronews').counts,[11,9]);
 assert.deepEqual(choose('publisher:engadget').counts,[9,11]);
 assert.equal(choose('source:ec-press').review,'review-registered-source-context');
 assert.deepEqual(choose('publisher:global-voices'),{target:'publisher:global-voices',reason:'reviewed-language-without-country-edition',review:'preserve-language-only',counts:[1,1],observedIn:2,minimum:1,maximum:1});
 assert.equal(review.groups.at(-1).target,'publisher:global-voices');
 assert.deepEqual(review.revisions.map((_,i)=>review.groups.reduce((n,g)=>n+g.counts[i],0)),[111,114]);
 assert.deepEqual(p.samples.map(x=>x.total),[287,260]);
 assert.deepEqual(p.gaps.buckets.directWithoutObserved,['JP','NL','NZ']);
 assert.equal(p.authorization,'NO_SOURCE_ACTIVATION');
});

test('group reason changes remain distinct and zero is allowed only with complete group evidence',()=>{
 const changed=change(pinnedSecond,r=>{
  r.observed.unresolvedPublisherProvenance.find(x=>x.target==='publisher:global-voices').reason='reviewed-edition-context-missing';
 });
 const groups=pinnedPlan(pinnedFirst,changed).provenanceReview.groups.filter(x=>x.target==='publisher:global-voices');
 assert.deepEqual(groups.map(x=>[x.review,x.counts,x.observedIn]),[
  ['review-publisher-edition',[0,1],1],['preserve-language-only',[1,0],1],
 ]);
 const malformed=change(pinnedSecond,r=>{r.observed.unresolvedPublisherProvenance.pop();});
 assert.throws(()=>pinnedPlan(pinnedFirst,malformed),/EXPANSION_PROVENANCE_CONSERVATION/);
 assert.throws(()=>pinnedPlan(pinnedFirst,pinnedFirst),/EXPANSION_INCOMPARABLE_OR_DUPLICATE/);
});
