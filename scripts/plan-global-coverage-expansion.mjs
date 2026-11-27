/** Offline operator planning, never source acquisition or a public coverage claim. */
import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {WORLD_OPERATIONAL_CODES,WORLD_STATE_CODES,stateCoverage,operationalGapPlan} from './audit-global-coverage.mjs';

const MAX_BYTES=1024*1024,MAX_SAMPLES=12,PREFIX='DLKT_GLOBAL_COVERAGE ';
const allowed=new Set(WORLD_OPERATIONAL_CODES);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=5000;
const sorted=values=>[...values].sort();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sum=values=>values.reduce((n,value)=>n+value,0);
const requireValid=(condition,reason)=>{if(!condition)throw Error('EXPANSION_'+reason);};
const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
const uniqueArray=value=>Array.isArray(value)&&value.length<=5000&&new Set(value).size===value.length;

export function parseCoverageEvidence(document){
 requireValid(typeof document==='string'&&Buffer.byteLength(document,'utf8')<=MAX_BYTES,'EVIDENCE_SIZE');
 const lines=document.split(/\r?\n/u).filter(line=>line.startsWith(PREFIX));
 requireValid(lines.length===1,'EVIDENCE_FRAME');
 let report;try{report=JSON.parse(lines[0].slice(PREFIX.length));}catch{throw Error('EXPANSION_EVIDENCE_JSON');}
 requireValid(plain(report),'EVIDENCE_JSON');
 return {report,documentSha256:digest(document),reportLineSha256:digest(lines[0])};
}

function verifyCoverage(summary,codes,unknown){
 requireValid(plain(summary)&&count(unknown),'COVERAGE_INVALID');
 const expected=stateCoverage([...codes,...Array(unknown).fill(null)],WORLD_OPERATIONAL_CODES);
 for(const key of ['stateCount','denominator','unknownRecordCount'])requireValid(summary[key]===expected[key],'COVERAGE_INVALID');
 for(const key of ['stateCodes','missingStateCodes','otherPlaceCodes','unrecognizedCodes'])
  requireValid(uniqueArray(summary[key])&&same(sorted(summary[key]),sorted(expected[key])),'COVERAGE_INVALID');
 requireValid(expected.unrecognizedCodes.length===0,'COUNTRY_UNRECOGNIZED');
}

function countsMap(value,pattern,size){
 requireValid(plain(value),'COUNTS_INVALID');
 const entries=Object.entries(value);
 requireValid(entries.length<=5000&&(size===undefined||entries.length===size)&&
  entries.every(([key,n])=>pattern.test(key)&&count(n)),'COUNTS_INVALID');
 return new Map(entries);
}

function normalize(document){
 const {report,documentSha256,reportLineSha256}=parseCoverageEvidence(document);
 const {baseline:b,observed:o}=report;
 requireValid(plain(b)&&plain(o)&&plain(o.health),'AUDIT_INVALID');
 const h=o.health;
 requireValid(o.status==='GLOBAL_COVERAGE_OBSERVED'&&h.status==='ICEO_LIVE_HEALTHY'&&Array.isArray(h.failures)&&h.failures.length===0,'AUDIT_HELD');
 const time=Date.parse(h.checkedAt);
 requireValid(typeof h.checkedAt==='string'&&Number.isFinite(time)&&new Date(time).toISOString()===h.checkedAt&&
  Number.isSafeInteger(h.revision)&&h.revision>0,'OBSERVATION_INVALID');
 requireValid(b.stateReference===WORLD_STATE_CODES.length&&b.placeOptions===WORLD_OPERATIONAL_CODES.length&&
  (b.operationalEntityReference===undefined||b.operationalEntityReference===WORLD_OPERATIONAL_CODES.length)&&
  b.editorialCategories===20&&b.taxonomyCategories===17,'REFERENCE_DRIFT');
 const c=b.configuredDirectPublisherCountryCoverage;
 requireValid(plain(c)&&uniqueArray(c.stateCodes)&&uniqueArray(c.otherPlaceCodes),'CONFIGURATION_INVALID');
 const configured=sorted([...c.stateCodes,...c.otherPlaceCodes]);
 requireValid(uniqueArray(configured)&&configured.every(code=>allowed.has(code)),'CONFIGURATION_INVALID');
 verifyCoverage(c,configured,0);
 const total=o.eligiblePublicationCount;
 requireValid(count(total)&&total<=h.publicationCount,'ELIGIBLE_COUNT_INVALID');
 const country=countsMap(o.publisherCountryCounts,/^[A-Z]{2}$/u);
 requireValid([...country].every(([key,n])=>allowed.has(key)&&n>0),'COUNTRY_UNRECOGNIZED');
 const unknownCountry=o.publisherCountryCoverage?.unknownRecordCount;
 verifyCoverage(o.publisherCountryCoverage,[...country.keys()],unknownCountry);
 requireValid(sum([...country.values()])+unknownCountry===total,'COUNTRY_CONSERVATION');
 const editorial=countsMap(o.editorialCounts,/^[a-z][a-z-]{0,40}$/u,b.editorialCategories);
 requireValid(count(o.uncategorizedEditorial)&&sum([...editorial.values()])+o.uncategorizedEditorial===total,'EDITORIAL_CONSERVATION');
 const taxonomy=countsMap(o.taxonomyCounts,/^\d{8}$/u,b.taxonomyCategories);
 requireValid(count(o.uncategorizedTaxonomy)&&sum([...taxonomy.values()])+o.uncategorizedTaxonomy===total,'TAXONOMY_CONSERVATION');
 const l=o.languageCoverage;
 requireValid(plain(l)&&l.publications===total&&count(l.unknownLanguage)&&Array.isArray(l.languages)&&l.languages.length<=5000,'LANGUAGE_INVALID');
 const languages=new Map();
 for(const entry of l.languages){
  requireValid(plain(entry)&&typeof entry.language==='string'&&/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/u.test(entry.language)&&
   !languages.has(entry.language)&&count(entry.count)&&entry.count>0,'LANGUAGE_INVALID');
  languages.set(entry.language,entry.count);
 }
 requireValid(sum([...languages.values()])+l.unknownLanguage===total,'LANGUAGE_CONSERVATION');
 let provenance=null;
 if(o.unresolvedPublisherProvenance!==undefined){
  const groups=o.unresolvedPublisherProvenance,seen=new Set();
  requireValid(Array.isArray(groups)&&groups.length<=5000,'PROVENANCE_INVALID');
  for(const entry of groups){
   requireValid(plain(entry)&&typeof entry.target==='string'&&/^(?:(?:publisher|source):[a-z0-9-]{1,100}|unresolved)$/u.test(entry.target)&&
    typeof entry.reason==='string'&&/^[a-z-]{1,80}$/u.test(entry.reason)&&count(entry.count)&&entry.count>0,'PROVENANCE_INVALID');
   const key=entry.target+'|'+entry.reason;requireValid(!seen.has(key),'PROVENANCE_INVALID');seen.add(key);
  }
  requireValid(sum(groups.map(entry=>entry.count))===unknownCountry,'PROVENANCE_CONSERVATION');
  provenance=groups.map(({target,reason,count})=>({target,reason,count})).sort((a,b)=>b.count-a.count||a.target.localeCompare(b.target)||a.reason.localeCompare(b.reason));
 }
 const inventoryKeys=['cityOptions','interfaceLocales','configuredDefinitions','allowlistedPublishers','directDiscoveryIndexes','directIndexPublishers','discoveryOnlyEntries','dedicatedCityNewsFeedCount'];
 requireValid(inventoryKeys.every(key=>Number.isSafeInteger(b[key])&&b[key]>=0)&&h.sourceCount===b.configuredDefinitions,'CONFIGURATION_INVALID');
 const signature=JSON.stringify([inventoryKeys.map(key=>b[key]),configured,sorted(editorial.keys()),sorted(taxonomy.keys())]);
 return {revision:h.revision,checkedAt:h.checkedAt,time,total,configured,country,editorial,languages,unknownCountry,
  unknownLanguage:l.unknownLanguage,unclassifiedEditorial:o.uncategorizedEditorial,provenance,signature,documentSha256,reportLineSha256};
}

const series=values=>({counts:values,observedIn:values.filter(n=>n>0).length,minimum:Math.min(...values),maximum:Math.max(...values)});

/** Legacy audit reports do not embed a model commit. The operator declares
 * their common model, which is not independently authenticated by this tool.
 * Report revisions are compared, never added as unique articles. */
export function buildExpansionPlan(documents,declaredModelCommit){
 requireValid(Array.isArray(documents)&&documents.length>=2&&documents.length<=MAX_SAMPLES,'SAMPLE_COUNT');
 requireValid(typeof declaredModelCommit==='string'&&/^[a-f0-9]{40}$/u.test(declaredModelCommit),'MODEL_RECEIPT_REQUIRED');
 const samples=documents.map(normalize).sort((a,b)=>a.time-b.time);
 requireValid(samples.every((s,i)=>s.signature===samples[0].signature&&
  (i===0||s.time>samples[i-1].time&&s.revision>samples[i-1].revision)),'INCOMPARABLE_OR_DUPLICATE');
 const configured=samples[0].configured,configuredSet=new Set(configured);
 const union={};
 const countries=WORLD_OPERATIONAL_CODES.map(code=>{
  const observation=series(samples.map(s=>s.country.get(code)??0));
  if(observation.maximum>0)union[code]=observation.maximum;
  const direct=configuredSet.has(code);
  const review=direct?(observation.observedIn===samples.length?'maintain-observed':'diagnose-configured'):
   (observation.observedIn>0?'review-direct-opportunity':'discover-no-evidence');
  return {code,direct,review,...observation};
 });
 const gaps=operationalGapPlan(configured,union);
 const categories=sorted(samples[0].editorial.keys()).map(category=>({category,...series(samples.map(s=>s.editorial.get(category)))}))
  .sort((a,b)=>a.maximum-b.maximum||a.minimum-b.minimum||a.category.localeCompare(b.category));
 const observedLanguages=sorted(new Set(samples.flatMap(s=>[...s.languages.keys()]))).map(language=>({language,...series(samples.map(s=>s.languages.get(language)??0))}));
 const latest=samples.at(-1);
 return {status:'EXPANSION_RESEARCH_ONLY',declaredModelCommit,modelBinding:'operator-declared-not-embedded-in-legacy-audits',
  scope:'historical public snapshot observations; not event geography, demand, unique cross-snapshot articles or current coverage',
  samples:samples.map(({revision,checkedAt,total,unknownCountry,unknownLanguage,unclassifiedEditorial,documentSha256,reportLineSha256})=>({revision,checkedAt,total,unknownCountry,unknownLanguage,unclassifiedEditorial,documentSha256,reportLineSha256})),
  gaps,countries,editorialReview:categories,observedLanguages,
  latestProvenanceReview:{revision:latest.revision,groups:latest.provenance},authorization:'NO_SOURCE_ACTIVATION'};
}

async function boundedRead(path){
 const handle=await open(path,'r');
 try{
  const stat=await handle.stat();requireValid(stat.isFile()&&stat.size<=MAX_BYTES,'EVIDENCE_SIZE');
  const bytes=Buffer.alloc(MAX_BYTES+1);let length=0;
  while(length<bytes.length){const read=await handle.read(bytes,length,bytes.length-length,null);if(read.bytesRead===0)break;length+=read.bytesRead;}
  requireValid(length<=MAX_BYTES,'EVIDENCE_SIZE');
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));
 }finally{await handle.close();}
}
const invoked=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked)try{
 const [flag,model,...paths]=process.argv.slice(2);
 requireValid(flag==='--model-commit'&&paths.length>=2&&paths.length<=MAX_SAMPLES,'ARGUMENTS_INVALID');
 const documents=[];for(const path of paths)documents.push(await boundedRead(path));
 console.log('DLKT_COVERAGE_EXPANSION '+JSON.stringify(buildExpansionPlan(documents,model)));
}catch(error){
 console.error('DLKT_COVERAGE_EXPANSION_HELD '+(error instanceof Error&&/^EXPANSION_[A-Z_]+$/u.test(error.message)?error.message:'EVIDENCE_UNAVAILABLE'));
 process.exitCode=1;
}
