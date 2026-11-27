/** Read-only operator pilot. No network, publication, source activation,
 * investment recommendation, individual transaction or property valuation. */
import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildSourceQualificationQueue} from './qualify-global-source-research.mjs';

const DATASET_ID='d_b51323a474ba789fb4cc3db58a3116d4';
const DATASET_URL='https://data.gov.sg/datasets/'+DATASET_ID+'/view';
const DATASET_TITLE='Median Resale Prices for Registered Applications by Town and Flat Type';
const LICENCE_URL='https://data.gov.sg/open-data-licence';
const RELEASE_URL='https://www.hdb.gov.sg/hdb-pulse/news/2026/3rd-quarter-2026-public-housing-data-and-upcoming-flat-supply';
const METHOD_URL='https://www.hdb.gov.sg/managing-my-home/selling-a-flat/process-for-selling-a-flat/resale-flat-planning/resale-statistics';
const API_DOC_URL='https://guide.data.gov.sg/developer-guide/dataset-apis/search-and-filter-within-dataset';
const MAX_BYTES=1024*1024,DAY=86400000;
const FLAT_TYPES=new Set(['1-room','2-room','3-room','4-room','5-room','Executive']);
const PILOT_TOWNS=new Set(['Ang Mo Kio','Bedok']);
const check=(condition,reason)=>{if(!condition)throw Error('PRIMARY_DATA_'+reason);};
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
function instant(date){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(date))return null;
 const n=Date.parse(date+'T00:00:00.000Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===date?n:null;
}
function quarter(value){
 if(typeof value!=='string'||!/^(?:19|20)\d{2}-Q[1-4]$/u.test(value))return null;
 const year=Number(value.slice(0,4)),part=Number(value.at(-1));
 return {ordinal:year*4+part,end:Date.UTC(year,part*3,0)};
}

/** Quarterly releases are compared to an explicitly observed producer
 * watermark, not a calendar guess or the transport retrieval timestamp. */
export function assessQuarterAvailability({dataFrom,dataThrough,officialThrough,datasetUpdatedOn,officialPublishedOn,observedOn},asOfDate){
 const from=quarter(dataFrom),through=quarter(dataThrough),official=quarter(officialThrough);
 const updated=instant(datasetUpdatedOn),published=instant(officialPublishedOn),observed=instant(observedOn),asOf=instant(asOfDate);
 check(from&&through&&official&&from.ordinal<=through.ordinal&&official.ordinal>=through.ordinal,'QUARTER_RANGE');
 check(updated!==null&&published!==null&&observed!==null&&asOf!==null&&
  through.end<=updated&&official.end<=published&&updated<=observed&&published<=observed&&observed<=asOf,'DATE_ORDER');
 const lag=official.ordinal-through.ordinal;
 return {dataFrom,dataThrough,officialThrough,lagQuarters:lag,
  state:asOf-observed>30*DAY?'held-stale-primary-evidence':lag>0?'held-newer-official-period':'aligned-with-observed-official-period',
  observationAgeDays:(asOf-observed)/DAY};
}

/** Preserve provider absence markers; never impute a zero or deduce why
 * NA/null was omitted. The producer's methodology defines '-' and '*'. */
function price(raw){
 if(raw===null||raw===''||raw==='na'||raw==='NA')return {state:'unavailable',amount:null};
 if(raw==='-')return {state:'no-transactions-marker',amount:null};
 if(raw==='*')return {state:'suppressed-small-sample-marker',amount:null};
 check(typeof raw==='string'&&/^[1-9]\d{0,14}$/u.test(raw),'PRICE_VALUE');
 const amount=Number(raw);check(Number.isSafeInteger(amount)&&amount>0,'PRICE_VALUE');
 return {state:'reported-median',amount};
}
export function normalizeHdbSample(rows,dataFrom,dataThrough){
 const from=quarter(dataFrom),through=quarter(dataThrough);
 check(from&&through&&from.ordinal<=through.ordinal,'QUARTER_RANGE');
 check(Array.isArray(rows)&&rows.length>0&&rows.length<=100,'ROW_COUNT');
 const seen=new Set(),counts={'reported-median':0,'unavailable':0,'no-transactions-marker':0,'suppressed-small-sample-marker':0};
 const normalized=rows.map(row=>{
  check(exact(row,['quarter','town','flat_type','price']),'ROW_SCHEMA');
  const q=quarter(row.quarter);
  check(q&&q.ordinal>=from.ordinal&&q.ordinal<=through.ordinal,'ROW_PERIOD');
  check(PILOT_TOWNS.has(row.town)&&FLAT_TYPES.has(row.flat_type),'ROW_SCOPE');
  const key=JSON.stringify([row.quarter,row.town,row.flat_type]);
  check(!seen.has(key),'DUPLICATE_GRAIN');seen.add(key);
  const measure=price(row.price);counts[measure.state]++;
  return {quarter:row.quarter,town:row.town,flatType:row.flat_type,rawPrice:row.price,...measure};
 });
 return {rows:normalized,counts,grain:['quarter','town','flat_type'],completeDataset:false};
}

/** Compare published medians at identical grain dimensions except town.
 * No weighting, pooling, extrapolation or market/individual valuation. */
export function compareHistoricalMedians(rows,{quarter:period,flatType,firstTown,secondTown}){
 check(quarter(period)&&FLAT_TYPES.has(flatType)&&PILOT_TOWNS.has(firstTown)&&PILOT_TOWNS.has(secondTown)&&firstTown!==secondTown,'COMPARISON_SCOPE');
 const matching=town=>rows.filter(row=>row.quarter===period&&row.flatType===flatType&&row.town===town);
 const first=matching(firstTown),second=matching(secondTown);
 if(first.length!==1||second.length!==1||first[0].state!=='reported-median'||second[0].state!=='reported-median')
  return {state:'held-missing-comparable-medians',quarter:period,flatType,difference:null};
 check([first[0],second[0]].every(row=>Number.isSafeInteger(row.amount)&&row.amount>0),'PRICE_VALUE');
 return {state:'historical-lab-comparison',quarter:period,flatType,currency:'SGD',
  first:{town:firstTown,median:first[0].amount},second:{town:secondTown,median:second[0].amount},
  difference:first[0].amount-second[0].amount,meaning:'Difference between the two reported aggregate medians; not a valuation, forecast or price for an individual flat.'};
}

export function buildPrimaryDataPilot(documents,model,ledgerText,packetText,asOfDate){
 check(typeof packetText==='string'&&Buffer.byteLength(packetText,'utf8')<=MAX_BYTES,'PACKET_SIZE');
 let packet;try{packet=JSON.parse(packetText);}catch{throw Error('PRIMARY_DATA_PACKET_JSON');}
 check(exact(packet,['format','evidenceBasis','datasetId','datasetUrl','datasetTitle','producer','country','licenceUrl','methodUrl','apiDocumentationUrl',
  'apiObservation','observedOn','datasetUpdatedOn','dataFrom','dataThrough','officialReleaseUrl','officialThrough','officialPublishedOn','rows'])&&
  packet.format==='dlkt-primary-data-hdb-pilot-1'&&packet.evidenceBasis==='operator-transcribed-public-catalogue-preview-not-api-receipt','PACKET_SHAPE');
 check(packet.datasetId===DATASET_ID&&packet.datasetUrl===DATASET_URL&&packet.datasetTitle===DATASET_TITLE&&
  packet.producer==='Housing & Development Board'&&packet.country==='SG'&&packet.licenceUrl===LICENCE_URL&&
  packet.methodUrl===METHOD_URL&&packet.apiDocumentationUrl===API_DOC_URL&&packet.officialReleaseUrl===RELEASE_URL&&
  packet.apiObservation==='unavailable-no-response-verified','SOURCE_BINDING');
 // This is a fixed, dated evidence pilot. New release observations must
 // be separately reviewed and versioned, not substituted via caller input.
 check(packet.observedOn==='2026-11-27'&&packet.datasetUpdatedOn==='2026-08-13'&&packet.dataFrom==='2007-Q2'&&
  packet.dataThrough==='2026-Q2'&&packet.officialThrough==='2026-Q3'&&packet.officialPublishedOn==='2026-10-23','EVIDENCE_REVISION');
 const availability=assessQuarterAvailability(packet,asOfDate);
 const qualification=buildSourceQualificationQueue(documents,model,ledgerText,asOfDate);
 const source=qualification.rows.find(row=>row.id==='hdb-sg-median-resale');
 check(source&&source.targetCountry==='SG'&&source.lane==='official-data-research'&&source.publisherId===null&&
  source.sourceReference===DATASET_URL&&source.plannedCategories.includes('housing')&&source.plannedCategories.includes('money'),'QUALIFICATION_BINDING');
 const sample=normalizeHdbSample(packet.rows,packet.dataFrom,packet.dataThrough);
 const qualificationReady=source.disposition==='prepare-dataset-specific-review';
 const example=qualificationReady&&availability.state!=='held-stale-primary-evidence'?
  compareHistoricalMedians(sample.rows,{quarter:'2007-Q2',flatType:'4-room',firstTown:'Ang Mo Kio',secondTown:'Bedok'}):null;
 const reasons=['endpoint-response-not-verified','collection-policy-and-independent-review-required'];
 if(!qualificationReady)reasons.push('source-research-held');
 if(availability.state!=='aligned-with-observed-official-period')reasons.push(availability.state);
 return {status:'PRIMARY_DATA_RESEARCH_ONLY',datasetId:DATASET_ID,country:'SG',categories:['housing','money'],
  observationBasis:packet.evidenceBasis,packetSha256:hash(packetText),researchRecordSha256:source.researchRecordSha256,
  ledgerSha256:qualification.ledgerSha256,auditSamples:qualification.auditSamples,availability,
  sampleProfile:{rowCount:sample.rows.length,counts:sample.counts,grain:sample.grain,completeDataset:false},
  historicalExample:example,
  attribution:{producer:packet.producer,dataset:DATASET_TITLE,sourceUrl:DATASET_URL,accessedOn:packet.observedOn,
   licence:'Singapore Open Data Licence version 1.0',licenceUrl:LICENCE_URL,
   notice:'Contains information from '+DATASET_TITLE+' accessed on '+packet.observedOn+' from data.gov.sg (Housing & Development Board), under the Singapore Open Data Licence version 1.0: '+LICENCE_URL+'.'},
  caveats:['Catalogue preview only; not an authenticated or complete dataset extract.',
   'Quarterly registered resale applications, not asking prices, rentals, real-time prices or all Singapore housing.',
   'The published medians do not establish an individual flat value; omitted and suppressed cells remain unknown.',
   'No government endorsement is implied.'],
  latestPublication:{state:'held',reasons},countsAsNationalNewsCoverage:false,
  authorization:'NO_PROBE_ACTIVATION_OR_PUBLICATION',probeAllowed:false,activationAllowed:false,publicationAllowed:false};
}

async function boundedRead(url){
 const handle=await open(url,'r');
 try{
  const stat=await handle.stat();check(stat.isFile()&&stat.size<=MAX_BYTES,'INPUT_SIZE');
  const bytes=Buffer.alloc(MAX_BYTES+1);let length=0;
  while(length<bytes.length){const read=await handle.read(bytes,length,bytes.length-length,null);if(read.bytesRead===0)break;length+=read.bytesRead;}
  check(length<=MAX_BYTES,'INPUT_SIZE');
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));
 }finally{await handle.close();}
}
const invoked=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked)try{
 const [flag,date,...extra]=process.argv.slice(2);check(flag==='--as-of'&&extra.length===0,'ARGUMENTS');
 const paths=['../docs/iceo-global-coverage-baseline-20261127.md','../docs/evidence/global-coverage-operational-244-20261127.txt',
  '../docs/evidence/source-qualification-research-20261127.json','../docs/evidence/primary-data-hdb-catalogue-20261127.json'];
 const [first,second,ledger,packet]=await Promise.all(paths.map(path=>boundedRead(new URL(path,import.meta.url))));
 console.log('DLKT_PRIMARY_DATA '+JSON.stringify(buildPrimaryDataPilot([first,second],
  '2005ad5cf04f6ea0f04080eeb66a99f6d895b55d',ledger,packet,date)));
}catch(error){
 console.error('DLKT_PRIMARY_DATA_HELD '+(error instanceof Error&&/^PRIMARY_DATA_[A-Z_]+$/u.test(error.message)?error.message:'EVIDENCE_UNAVAILABLE'));
 process.exitCode=1;
}
