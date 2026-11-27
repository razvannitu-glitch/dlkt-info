import test from 'node:test';
import assert from 'node:assert/strict';
import * as canonicalNews from '../source/public/news-sources.js';
import {WORLD_STATE_CODES,WORLD_OPERATIONAL_CODES,assertOperationalCatalogue,operationalGapPlan,stateCoverage,configuredCountryCodes,auditSnapshot} from '../scripts/audit-global-coverage.mjs';

test('global denominator is exactly 193 UN member states plus VA and PS, not the place directory',()=>{
 assert.equal(WORLD_STATE_CODES.length,195);
 assert.equal(new Set(WORLD_STATE_CODES).size,195);
 assert.ok(WORLD_STATE_CODES.includes('VA'));
 assert.ok(WORLD_STATE_CODES.includes('PS'));
 for(const code of ['HK','MO','PR','GL','TW','XK','AQ'])assert.ok(!WORLD_STATE_CODES.includes(code));
 const result=stateCoverage(WORLD_STATE_CODES,[]);
 assert.equal(result.stateCount,195);
 assert.equal(result.missingStateCodes.length,0);
});
test('territory, unknown and unrecognized records stay separate, repeated states count once',()=>{
 const result=stateCoverage(['RO','RO','HK','PR','VA','PS',null,null,'XX'],['RO','HK','PR','VA','PS']);
 assert.deepEqual(result.stateCodes,['PS','RO','VA']);
 assert.equal(result.stateCount,3);
 assert.equal(result.denominator,195);
 assert.deepEqual(result.otherPlaceCodes,['HK','PR']);
 assert.deepEqual(result.unrecognizedCodes,['XX']);
 assert.equal(result.unknownRecordCount,2);
 assert.equal(result.missingStateCodes.length,192);
});
test('no state is lost if the place picker lacks its code',()=>{
 const result=stateCoverage(['VA','PS'],['RO']);
 assert.equal(result.stateCount,2);
 assert.equal(result.otherPlaceCodes.length,0);
});
test('reject malformed geographic data',()=>{
 for(const codes of [['ro'],['RO '],['ZZ'],[1]])assert.throws(()=>stateCoverage(codes,[]),/GLOBAL_COVERAGE_INPUT_INVALID/);
 assert.throws(()=>stateCoverage(['RO'],[null]),/GLOBAL_COVERAGE_INPUT_INVALID/);
});
test('allowlisted origins, directory candidates and unregistered reviewed feeds are not direct configurations',()=>{
 const codes=configuredCountryCodes({indexes:[{publisherId:'a'},{publisherId:'a'}],
  publicationScopes:[{publisherId:'a',countryCode:'RO'},{publisherId:'b',countryCode:'JP'}],
  reviewedScopes:[{sourceId:'one',countryCode:'NZ'},{sourceId:'two',countryCode:'DE'},{sourceId:'three',countryCode:'US'}],
  sources:[{id:'one',adapter:'reviewed-feed'},{id:'three',adapter:'news-index'}]});
 assert.deepEqual(codes,['NZ','RO']);
});
const NOW=Date.parse('2026-11-27T17:00:00.000Z');
const at=new Date(NOW-30000).toISOString();
const fixture=cards=>({status:200,redirected:false,headers:{'content-type':'application/json','x-content-type-options':'nosniff',
 'x-iceo-revision':'1','x-iceo-collection-state':'ready','x-iceo-source-checked-at':at,'x-iceo-last-scheduled-success-at':at,'x-iceo-refreshed-at':at},
 body:JSON.stringify({version:'iceo-primary-mesh-1',product:'dlkt-info',state:'partial',generatedAt:at,
 sources:[{state:'verified'},{state:'partial'},{state:'unavailable'}],cards})});
const model={placeCodes:['RO','HK'],taxonomy:[{id:'04000000'}],editorialCategories:['business'],
 validNewsGlobalCard:c=>c.kind==='publication'&&c.current===true,sourceEditionCountryCode:c=>c.country,
 classifyEvidenceCard:c=>c.taxonomy?{category:c.taxonomy}:null,editorialCategory:c=>c.editorial??null,
 newsLanguageCoverage:rows=>({publications:rows.length}),
 publisherForNewsUrl:url=>url==='https://example.org/article'?{id:'known'}:null,
 sourcePublicationContext:c=>c.context??null,sourceLanguage:c=>c.context?.language??null,nonIndexSourceIds:new Set(['official'])};
const card=(identity,country,extra={})=>({kind:'publication',current:true,identity,contentHash:'hash-'+identity,country,...extra});
test('audit counts only eligible unique publications and does not invent categories or country evidence',()=>{
 const a=card('a','RO',{taxonomy:'04000000',editorial:'business'});
 const r=auditSnapshot(fixture([a,a,card('b','HK'),card('c',null),card('old','RO',{current:false}),{kind:'legal-document'}]),NOW,model);
 assert.equal(r.status,'GLOBAL_COVERAGE_OBSERVED');
 assert.equal(r.eligiblePublicationCount,3);
 assert.equal(r.publisherCountryCoverage.stateCount,1);
 assert.deepEqual(r.publisherCountryCoverage.otherPlaceCodes,['HK']);
 assert.equal(r.publisherCountryCoverage.unknownRecordCount,1);
 assert.deepEqual(r.unresolvedPublisherProvenance,[{target:'unresolved',reason:'reviewed-edition-context-missing',count:1}]);
 assert.equal(r.taxonomyCounts['04000000'],1);
 assert.equal(r.editorialCounts.business,1);
 assert.equal(r.uncategorizedTaxonomy,2);
 assert.equal(r.uncategorizedEditorial,2);
 assert.equal(r.sourceStates.unavailable,1);
});
test('conflicting duplicate identities fail rather than choosing an arbitrary article',()=>{
 assert.throws(()=>auditSnapshot(fixture([card('a','RO'),card('a','RO',{contentHash:'changed'})]),NOW,model),/GLOBAL_COVERAGE_CONFLICTING_IDENTITY/);
});
test('stale or broken snapshots return held and no observed geography',()=>{
 const sample=fixture([card('a','RO')]);
 sample.headers['x-iceo-last-scheduled-success-at']=new Date(NOW-3600000).toISOString();
 const r=auditSnapshot(sample,NOW,model);
 assert.equal(r.status,'GLOBAL_COVERAGE_HELD');
 assert.equal(r.observed,null);
});

test('approved operational reference includes all 195 states and exactly 49 other geographic entities',()=>{
 assert.equal(WORLD_OPERATIONAL_CODES.length,244);
 assert.equal(new Set(WORLD_OPERATIONAL_CODES).size,244);
 assert.ok(WORLD_STATE_CODES.every(x=>WORLD_OPERATIONAL_CODES.includes(x)));
 assert.equal(WORLD_OPERATIONAL_CODES.filter(x=>!WORLD_STATE_CODES.includes(x)).length,49);
 for(const x of ['HK','MO','PR','GL','TW','XK','CK','NU'])assert.ok(WORLD_OPERATIONAL_CODES.includes(x));
 assert.doesNotThrow(()=>assertOperationalCatalogue([...WORLD_OPERATIONAL_CODES].reverse()));
});
test('catalogue drift is explicit, never silently normalized to an inflated denominator',()=>{
 const a=[...WORLD_OPERATIONAL_CODES];
 for(const invalid of [a.slice(1),[...a,'AQ'],[...a.slice(1),a[1]],[...a.slice(1),'AQ'],[...a.slice(1),'ro']])
  assert.throws(()=>assertOperationalCatalogue(invalid),/GLOBAL_OPERATIONAL_CATALOGUE_DRIFT/);
});
test('all operational entities are allocated exactly once across configuration and observation gaps',()=>{
 const r=operationalGapPlan(['RO','RO','HK','AQ'],{RO:5,PR:2,US:1,XX:3});
 assert.equal(r.denominator,244);
 assert.equal(r.configuredCount,2);
 assert.equal(r.observedCount,3);
 assert.deepEqual(r.buckets.configuredAndObserved,['RO']);
 assert.deepEqual(r.buckets.observedWithoutDirect,['PR','US']);
 assert.deepEqual(r.buckets.directWithoutObserved,['HK']);
 assert.equal(r.buckets.neitherInThisAudit.length,240);
 const all=Object.values(r.buckets).flat().sort();
 assert.deepEqual(all,[...WORLD_OPERATIONAL_CODES]);
 assert.deepEqual(r.unexpectedConfiguredCodes,['AQ']);
 assert.deepEqual(r.unexpectedObservedCodes,['XX']);
});
test('operational gap planning rejects fake observations and malformed codes',()=>{
 for(const bad of [{RO:0},{RO:-1},{RO:1.5},{ro:1},{RO:'2'},null,[]])
  assert.throws(()=>operationalGapPlan(['RO'],bad),/GLOBAL_OPERATIONAL_GAP_INPUT_INVALID/);
 assert.throws(()=>operationalGapPlan(['ZZ'],{}),/GLOBAL_OPERATIONAL_GAP_INPUT_INVALID/);
});
test('unresolved provenance is grouped for review, not fabricated or automatically resolved',()=>{
 const cards=[
  card('a',null,{sourceUrl:'https://example.org/article'}),
  card('b',null,{sourceUrl:'https://example.org/article'}),
  card('c',null,{sourceUrl:'https://example.org/article',context:{language:null}}),
  card('d',null,{sourceIds:['official']}),
  card('e',null,{sourceIds:['unknown']}),
  card('f','RO')
 ];
 const r=auditSnapshot(fixture(cards),NOW,model);
 assert.equal(r.publisherCountryCoverage.unknownRecordCount,5);
 assert.equal(r.unresolvedPublisherProvenance.reduce((n,x)=>n+x.count,0),5);
 assert.deepEqual(r.unresolvedPublisherProvenance.find(x=>x.count===2),{target:'publisher:known',reason:'reviewed-edition-context-missing',count:2});
 assert.ok(r.unresolvedPublisherProvenance.some(x=>x.target==='publisher:known'&&x.reason==='reviewed-edition-language-missing'));
 assert.ok(r.unresolvedPublisherProvenance.some(x=>x.target==='source:official'));
 assert.ok(r.unresolvedPublisherProvenance.some(x=>x.target==='unresolved'));
 assert.deepEqual(r.publisherCountryCounts,{RO:1});
});

test('shared indexes cannot imply direct national configuration across scoped publisher editions',()=>{
 const scope=(country,origins)=>({publisherId:'shared',countryCode:country,origins,editions:[{path:'/edition/',language:'en'}]});
 const origin='https://publisher.example',shared={publisherId:'shared',url:origin+'/news-sitemap.xml'};
 const us=scope('US',[origin]),gb=scope('GB',[origin]);
 const input={indexes:[shared,{publisherId:'legacy'}],publicationScopes:[us,gb,{publisherId:'legacy',countryCode:'RO'}],reviewedScopes:[],sources:[]};
 const context=country=>({publisherCountryCode:country,language:'en',basis:'reviewed-publisher'});
 assert.deepEqual(configuredCountryCodes(input),['RO'],'no resolver means no scoped-index attribution');
 assert.deepEqual(configuredCountryCodes({...input,resolvePublicationContext:()=>null}),['RO'],'shared sitemap remains unresolved');
 const direct={publisherId:'shared',url:origin+'/edition/explicit'};
 const exact={...input,indexes:[...input.indexes,direct],resolvePublicationContext:url=>url===direct.url?context('GB'):null};
 assert.deepEqual(configuredCountryCodes(exact),['GB','RO'],'one exact edition, not every country in the publisher group');
 assert.deepEqual(configuredCountryCodes({...exact,publicationScopes:[...input.publicationScopes,gb]}),['RO'],'ambiguous duplicate scopes remain unresolved');
 assert.deepEqual(configuredCountryCodes({...exact,resolvePublicationContext:()=>({...context('GB'),language:null})}),['RO']);
 assert.deepEqual(configuredCountryCodes({...exact,resolvePublicationContext:()=>({...context('GB'),basis:'unknown'})}),['RO']);
 assert.deepEqual(configuredCountryCodes({...exact,indexes:[{publisherId:'shared',url:'https://foreign.example/edition/explicit'}],resolvePublicationContext:()=>context('GB')}),[]);
 assert.deepEqual(configuredCountryCodes({...exact,publicationScopes:[us,gb,{publisherId:'legacy',countryCode:'RO'},{publisherId:'legacy',countryCode:'IT'}]}),['GB'],'ambiguous legacy scopes cannot borrow a single index');
});

// Exercise the actual shipped resolver together with the root audit, not a
// simulated correspondence between a language and a country.
test('integrated provenance counts scoped editions and language-only originals independently',()=>{
 const rows=[
  card('global',null,{publisher:'Global Voices',sourceUrl:'https://globalvoices.org/2026/11/27/controlled-global-language-fixture/'}),
  card('unknown',null,{publisher:'Global Voices',sourceUrl:'https://globalvoices.org/2026/11/27/controlled-global-language-fixture/?edition=ro'}),
  card('politico',null,{publisher:'POLITICO',sourceUrl:'https://www.politico.eu/article/controlled-european-politics-fixture/'}),
  card('us',null,{publisher:'Good Housekeeping',sourceUrl:'https://www.goodhousekeeping.com/what-to-buy/clothing/a123456/controlled-fixture/'}),
  card('gb',null,{publisher:'Good Housekeeping',sourceUrl:'https://www.goodhousekeeping.com/uk/lifestyle/a123456/controlled-fixture/'}),
 ];
 const exactModel={...model,placeCodes:WORLD_OPERATIONAL_CODES,publisherForNewsUrl:canonicalNews.publisherForNewsUrl,
  sourcePublicationContext:canonicalNews.sourcePublicationContext,sourceEditionCountryCode:canonicalNews.sourceEditionCountryCode,
  sourceLanguage:canonicalNews.sourceLanguage,newsLanguageCoverage:canonicalNews.newsLanguageCoverage};
 const before=JSON.stringify(rows),observed=auditSnapshot(fixture([...rows,rows[0]]),NOW,exactModel);
 assert.equal(observed.eligiblePublicationCount,5);
 assert.deepEqual(observed.publisherCountryCounts,{BE:1,US:1,GB:1});
 assert.deepEqual(observed.publisherCountryCoverage.stateCodes,['BE','GB','US']);
 assert.equal(observed.publisherCountryCoverage.unknownRecordCount,2);
 assert.deepEqual(observed.languageCoverage,{publications:5,publishers:3,unknownLanguage:1,languages:[{language:'en',count:4}]});
 assert.deepEqual(observed.unresolvedPublisherProvenance,[
  {target:'publisher:global-voices',reason:'reviewed-edition-context-missing',count:1},
  {target:'publisher:global-voices',reason:'reviewed-language-without-country-edition',count:1},
 ]);
 assert.equal(JSON.stringify(rows),before);
});

test('integrated shared Good Housekeeping sitemap cannot inflate national direct-source coverage',()=>{
 const indexes=canonicalNews.NEWS_DISCOVERY_INDEXES.filter(index=>index.publisherId==='good-housekeeping');
 assert.ok(indexes.some(index=>index.id==='good-housekeeping-news'));
 const codes=configuredCountryCodes({indexes,publicationScopes:canonicalNews.NEWS_PUBLICATION_SCOPES,
  reviewedScopes:[],sources:[],resolvePublicationContext:canonicalNews.sourcePublicationContext});
 assert.deepEqual(codes,[]);
 assert.equal(canonicalNews.NEWS_PUBLISHERS.length,77);assert.equal(canonicalNews.NEWS_DISCOVERY_INDEXES.length,31);
});
