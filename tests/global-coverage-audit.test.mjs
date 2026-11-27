import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD_STATE_CODES,stateCoverage,configuredCountryCodes,auditSnapshot} from '../scripts/audit-global-coverage.mjs';

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
 newsLanguageCoverage:rows=>({publications:rows.length})};
const card=(identity,country,extra={})=>({kind:'publication',current:true,identity,contentHash:'hash-'+identity,country,...extra});
test('audit counts only eligible unique publications and does not invent categories or country evidence',()=>{
 const a=card('a','RO',{taxonomy:'04000000',editorial:'business'});
 const r=auditSnapshot(fixture([a,a,card('b','HK'),card('c',null),card('old','RO',{current:false}),{kind:'legal-document'}]),NOW,model);
 assert.equal(r.status,'GLOBAL_COVERAGE_OBSERVED');
 assert.equal(r.eligiblePublicationCount,3);
 assert.equal(r.publisherCountryCoverage.stateCount,1);
 assert.deepEqual(r.publisherCountryCoverage.otherPlaceCodes,['HK']);
 assert.equal(r.publisherCountryCoverage.unknownRecordCount,1);
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
