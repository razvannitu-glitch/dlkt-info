import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessQuarterAvailability,normalizeHdbSample,compareHistoricalMedians,buildPrimaryDataPilot} from '../scripts/primary-data-intelligence.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const docs=[read('../docs/iceo-global-coverage-baseline-20261127.md'),read('../docs/evidence/global-coverage-operational-244-20261127.txt')];
const ledger=read('../docs/evidence/source-qualification-research-20261127.json');
const packet=read('../docs/evidence/primary-data-hdb-catalogue-20261127.json');
const data=JSON.parse(packet),model='2005ad5cf04f6ea0f04080eeb66a99f6d895b55d';
const run=(text=packet,date='2026-11-27',research=ledger)=>buildPrimaryDataPilot(docs,model,research,text,date);
const modify=fn=>{const p=JSON.parse(packet);fn(p);return JSON.stringify(p);};

test('actual recorded catalogue and official release establish a newer official quarter, not latest dataset eligibility',()=>{
 const r=run();assert.equal(r.availability.state,'held-newer-official-period');
 assert.equal(r.availability.dataThrough,'2026-Q2');assert.equal(r.availability.officialThrough,'2026-Q3');assert.equal(r.availability.lagQuarters,1);
 assert.equal(r.latestPublication.state,'held');assert.ok(r.latestPublication.reasons.includes('endpoint-response-not-verified'));
 assert.ok(r.latestPublication.reasons.includes('held-newer-official-period'));
 assert.equal(r.probeAllowed,false);assert.equal(r.activationAllowed,false);assert.equal(r.publicationAllowed,false);
 assert.equal(r.countsAsNationalNewsCoverage,false);assert.equal(r.authorization,'NO_PROBE_ACTIVATION_OR_PUBLICATION');
 assert.deepEqual(r.auditSamples.map(x=>x.revision),[4077,4083]);
 assert.ok(/^[a-f0-9]{64}$/u.test(r.packetSha256)&&/^[a-f0-9]{64}$/u.test(r.researchRecordSha256));
});

test('ten recorded public preview cells retain missing markers and exact comparable historical medians',()=>{
 const before=JSON.stringify(data.rows),n=normalizeHdbSample(data.rows,data.dataFrom,data.dataThrough),r=run();
 assert.deepEqual(r.sampleProfile,{rowCount:10,counts:{'reported-median':5,'unavailable':2,'no-transactions-marker':3,'suppressed-small-sample-marker':0},grain:['quarter','town','flat_type'],completeDataset:false});
 assert.ok(n.rows.filter(row=>row.state!=='reported-median').every(row=>row.amount===null));
 assert.equal(JSON.stringify(data.rows),before);
 assert.deepEqual(r.historicalExample.first,{town:'Ang Mo Kio',median:260000});
 assert.deepEqual(r.historicalExample.second,{town:'Bedok',median:224500});
 assert.equal(r.historicalExample.difference,35500);assert.equal(r.historicalExample.quarter,'2007-Q2');
 assert.equal(r.historicalExample.flatType,'4-room');assert.equal(r.historicalExample.currency,'SGD');
 assert.match(r.attribution.notice,/2026-11-27.*Singapore Open Data Licence version 1.0/);
 assert.equal(r.attribution.licenceUrl,'https://data.gov.sg/open-data-licence');
});

test('absence, suppressed and invalid prices never become zero or a manufactured median',()=>{
 const make=price=>[{quarter:'2007-Q2',town:'Bedok',flat_type:'4-room',price}];
 for(const [value,state] of [[null,'unavailable'],['','unavailable'],['na','unavailable'],['NA','unavailable'],['-','no-transactions-marker'],['*','suppressed-small-sample-marker']]){
  const n=normalizeHdbSample(make(value),data.dataFrom,data.dataThrough);
  assert.equal(n.rows[0].state,state);assert.equal(n.rows[0].amount,null);
 }
 for(const value of ['0','-100','012','1e5','100,000','Infinity','100.1',' 100','N/A',100000,{},'9999999999999999'])
  assert.throws(()=>normalizeHdbSample(make(value),data.dataFrom,data.dataThrough),/PRIMARY_DATA_PRICE_VALUE/);
});

test('strict grain, schema, period and pilot geography reject duplicates, hidden fields and noncomparable data',()=>{
 assert.throws(()=>run(modify(p=>p.rows.push({...p.rows[0]}))),/PRIMARY_DATA_DUPLICATE_GRAIN/);
 assert.throws(()=>run(modify(p=>p.rows.push({...p.rows[0],price:'123000'}))),/PRIMARY_DATA_DUPLICATE_GRAIN/);
 assert.throws(()=>run(modify(p=>p.rows[0].quarter='2026-Q3')),/PRIMARY_DATA_ROW_PERIOD/);
 assert.throws(()=>run(modify(p=>p.rows[0].quarter='2007-Q1')),/PRIMARY_DATA_ROW_PERIOD/);
 assert.throws(()=>run(modify(p=>p.rows[0].town='Singapore')),/PRIMARY_DATA_ROW_SCOPE/);
 assert.throws(()=>run(modify(p=>p.rows[0].flat_type='penthouse')),/PRIMARY_DATA_ROW_SCOPE/);
 assert.throws(()=>run(modify(p=>p.rows[0].address='private address')),/PRIMARY_DATA_ROW_SCHEMA/);
 const n=normalizeHdbSample(data.rows,data.dataFrom,data.dataThrough);
 for(const flatType of ['1-room','2-room','5-room']){
  const comparison=compareHistoricalMedians(n.rows,{quarter:'2007-Q2',flatType,firstTown:'Ang Mo Kio',secondTown:'Bedok'});
  assert.equal(comparison.state,'held-missing-comparable-medians');assert.equal(comparison.difference,null);
 }
 assert.throws(()=>compareHistoricalMedians(n.rows,{quarter:'2007-Q2',flatType:'4-room',firstTown:'Bedok',secondTown:'Bedok'}),/PRIMARY_DATA_COMPARISON_SCOPE/);
});

test('date-aware quarter comparison distinguishes lag, alignment, invalid chronology and stale research',()=>{
 assert.equal(assessQuarterAvailability(data,'2026-11-27').lagQuarters,1);
 const aligned={...data,dataThrough:'2026-Q3',datasetUpdatedOn:'2026-11-01'};
 assert.equal(assessQuarterAvailability(aligned,'2026-11-27').state,'aligned-with-observed-official-period');
 assert.throws(()=>assessQuarterAvailability({...data,officialPublishedOn:'2026-09-01'},'2026-11-27'),/PRIMARY_DATA_DATE_ORDER/);
 assert.throws(()=>assessQuarterAvailability({...data,dataThrough:'2026-Q4'},'2026-11-27'),/PRIMARY_DATA_QUARTER_RANGE/);
 assert.throws(()=>assessQuarterAvailability(data,'2026-11-26'),/PRIMARY_DATA_DATE_ORDER/);
 assert.equal(run(packet,'2026-12-28').availability.state,'held-stale-primary-evidence');
 assert.equal(run(packet,'2026-12-28').historicalExample,null);
 assert.ok(run(packet,'2026-12-28').latestPublication.reasons.includes('source-research-held'));
});

test('source identity, fixed evidence and restrictions remain bound without approval-shaped input',()=>{
 for(const patch of [{datasetId:'wrong'},{licenceUrl:'https://example.org/'},{datasetUrl:data.datasetUrl+'?token=private'},
  {apiObservation:'verified'},{officialReleaseUrl:data.datasetUrl},{country:'RO'}])
  assert.throws(()=>run(modify(p=>Object.assign(p,patch))),/PRIMARY_DATA_SOURCE_BINDING/);
 assert.throws(()=>run(modify(p=>p.officialThrough='2026-Q2')),/PRIMARY_DATA_EVIDENCE_REVISION/);
 assert.throws(()=>run(modify(p=>p.activationAllowed=true)),/PRIMARY_DATA_PACKET_SHAPE/);
 const restricted=JSON.parse(ledger);restricted.entries.find(row=>row.id==='hdb-sg-median-resale').evidence.push({
  url:data.datasetUrl,signal:'commercial-restriction',scope:'Controlled restrictive fixture'});
 const r=run(packet,'2026-11-27',JSON.stringify(restricted));
 assert.equal(r.historicalExample,null);assert.ok(r.latestPublication.reasons.includes('source-research-held'));assert.equal(r.publicationAllowed,false);
 assert.throws(()=>run('{'),/PRIMARY_DATA_PACKET_JSON/);
 assert.throws(()=>run('x'.repeat(1024*1024+1)),/PRIMARY_DATA_PACKET_SIZE/);
});
