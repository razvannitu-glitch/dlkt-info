import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSourceQualificationQueue} from '../scripts/qualify-global-source-research.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const docs=[read('../docs/iceo-global-coverage-baseline-20261127.md'),read('../docs/evidence/global-coverage-operational-244-20261127.txt')];
const original=read('../docs/evidence/source-qualification-research-20261127.json');
const model='2005ad5cf04f6ea0f04080eeb66a99f6d895b55d';
const run=(text=original,date='2026-11-27')=>buildSourceQualificationQueue(docs,model,text,date);
const modify=fn=>{const ledger=JSON.parse(original);fn(ledger.entries,ledger);return JSON.stringify(ledger);};
const select=(result,id)=>result.rows.find(row=>row.id===id);

test('actual primary-page research separates four existing publishers and four official data opportunities',()=>{
 const r=run();assert.equal(r.rows.length,8);
 assert.deepEqual(r.countries,[{code:'AU',researchRecords:2},{code:'IE',researchRecords:2},{code:'QA',researchRecords:2},{code:'SG',researchRecords:2}]);
 assert.equal(select(r,'abc-au-direct').disposition,'hold-retired-feed');
 for(const id of ['rte-ie-direct','aljazeera-qa-direct','cna-sg-direct'])assert.equal(select(r,id).disposition,'hold-commercial-permission');
 for(const id of ['abs-au-statistics','cso-ie-statistics','hdb-sg-median-resale'])assert.equal(select(r,id).disposition,'prepare-dataset-specific-review');
 assert.equal(select(r,'qatar-cpi-data').disposition,'hold-policy-scope');
 assert.equal(r.lanes['hold-commercial-permission'],3);
 assert.deepEqual(r.auditSamples.map(x=>x.revision),[4077,4083]);
 assert.ok(r.rows.every(x=>x.probeAllowed===false&&x.activationAllowed===false&&x.countsAsNationalCoverage===false));
 assert.equal(r.authorization,'NO_SOURCE_PROBE_OR_ACTIVATION');
 assert.equal(r.probeAllowed,false);assert.equal(r.activationAllowed,false);
 assert.ok(r.rows.every(x=>/^[a-f0-9]{64}$/u.test(x.researchRecordSha256)));
});

test('positive research never overrides a restriction, ambiguity or retired feed',()=>{
 const r=run(modify(entries=>{
  const positive=entries.find(x=>x.id==='abs-au-statistics').evidence.at(-1);
  entries.find(x=>x.id==='abc-au-direct').evidence.push(positive);
  entries.find(x=>x.id==='rte-ie-direct').evidence.push(positive);
  entries.find(x=>x.id==='abs-au-statistics').evidence.push({url:'https://www.abs.gov.au/media-centre/media-releases',signal:'commercial-restriction',scope:'Controlled restrictive fixture'});
 }));
 assert.equal(select(r,'abc-au-direct').disposition,'hold-retired-feed');
 assert.equal(select(r,'rte-ie-direct').disposition,'hold-commercial-permission');
 assert.equal(select(r,'abs-au-statistics').disposition,'hold-commercial-permission');
 assert.equal(select(r,'qatar-cpi-data').disposition,'hold-policy-scope');
});

test('news origin and reviewed edition bindings are canonical, data is not a national news publisher',()=>{
 for(const patch of [
  {targetCountry:'IE'},{publisherId:'bbc'},{sourceReference:'https://www.abc.net.au.attacker.org/newssyndication'},
 ])assert.throws(()=>run(modify(entries=>Object.assign(entries[0],patch))),/SOURCE_PREFLIGHT_PUBLISHER_BINDING/);
 assert.throws(()=>run(modify(entries=>{entries[0].targetCountry='JP';})),/SOURCE_PREFLIGHT_TARGET_NOT_IN_LANE/);
 assert.throws(()=>run(modify(entries=>{entries[4].publisherId='abc-au';})),/SOURCE_PREFLIGHT_DATA_NOT_NEWS_PROVENANCE/);
 assert.throws(()=>run(modify(entries=>{entries[0].plannedCategories=['imaginary'];})),/SOURCE_PREFLIGHT_CATEGORY/);
});

test('noncanonical URLs, credentials, ambiguous encodings and unsafe hosts are rejected without fetching',()=>{
 for(const url of [
  'http://www.abc.net.au/newssyndication','https://user@www.abc.net.au/newssyndication',
  'https://www.abc.net.au:443/newssyndication','https://www.abc.net.au/newssyndication?token=private',
  'https://www.abc.net.au/newssyndication#private','https://www.abc.net.au/a/../newssyndication',
  'https://www.abc.net.au/a%2fb','https://127.0.0.1/x','https://localhost/x','https://example.internal/x',
 ])assert.throws(()=>run(modify(entries=>{entries[0].sourceReference=url;})),/SOURCE_PREFLIGHT_SOURCE_REFERENCE/);
 assert.throws(()=>run(modify(entries=>{entries[0].evidence[0].url='https://www.abc.net.au/a?secret=1';})),/SOURCE_PREFLIGHT_EVIDENCE_INVALID/);
});

test('stale and future research do not authorize a new probe, and negative evidence remains held',()=>{
 const late=run(original,'2026-12-28');
 assert.equal(select(late,'abs-au-statistics').disposition,'hold-stale-evidence');
 assert.equal(select(late,'cna-sg-direct').disposition,'hold-commercial-permission');
 assert.equal(select(late,'abc-au-direct').stale,true);
 assert.throws(()=>run(modify(entries=>{entries[0].observedOn='2026-11-28';})),/SOURCE_PREFLIGHT_OBSERVATION_TIME/);
 assert.throws(()=>run(original,'2026-11-26'),/SOURCE_PREFLIGHT_AUDIT_AFTER_CLOCK/);
 assert.throws(()=>run(original,'2026-02-30'),/SOURCE_PREFLIGHT_CLOCK/);
});

test('malformed, duplicated or approval-shaped research is fail closed',()=>{
 assert.throws(()=>run(modify(entries=>{entries[0].activationAllowed=true;})),/SOURCE_PREFLIGHT_ROW_SHAPE/);
 assert.throws(()=>run(modify(entries=>{entries.push(entries[0]);})),/SOURCE_PREFLIGHT_DUPLICATE_SOURCE_RESEARCH/);
 assert.throws(()=>run(modify(entries=>{entries[0].evidence.push(entries[0].evidence[0]);})),/SOURCE_PREFLIGHT_DUPLICATE_EVIDENCE/);
 assert.throws(()=>run(modify(entries=>{entries[0].evidence[0].signal='approved';})),/SOURCE_PREFLIGHT_EVIDENCE_INVALID/);
 assert.throws(()=>run(modify(entries=>{entries[0].evidence=[];})),/SOURCE_PREFLIGHT_EVIDENCE_COUNT/);
 assert.throws(()=>run('{'),/SOURCE_PREFLIGHT_LEDGER_JSON/);
 assert.throws(()=>run('x'.repeat(1024*1024+1)),/SOURCE_PREFLIGHT_LEDGER_SIZE/);
});
