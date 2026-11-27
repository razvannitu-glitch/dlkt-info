/** Offline research preflight only. No fetching, credentials, source requests,
 * registry writes, approval or publishing. Existing discovery qualification and
 * the bounded source-probe process remain the separate admission boundaries. */
import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NEWS_PUBLISHERS,NEWS_PUBLICATION_SCOPES,NEWS_DISCOVERY_INDEXES} from '../source/public/news-sources.js';
import {PUBLIC_EDITORIAL_CATEGORIES} from '../source/public/editorial-categories.js';
import {buildExpansionPlan} from './plan-global-coverage-expansion.mjs';

const DAY=86400000,MAX_BYTES=1024*1024,MAX_ENTRIES=100;
const SIGNALS=new Set(['feed-retired','commercial-restriction','automated-access-restriction','syndication-offer',
 'official-release-list','open-license-limited','dataset-identified','portal-policy-ambiguity','historical-data-only']);
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const check=(condition,reason)=>{if(!condition)throw Error('SOURCE_PREFLIGHT_'+reason);};
const id=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/u.test(value);
const instant=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(value))return null;
 const n=Date.parse(value+'T00:00:00.000Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value?n:null;
};
const boundedText=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!/[\u0000-\u001f\u007f<>]/u.test(value);
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
function publicReference(raw){
 if(typeof raw!=='string'||raw.length>2048||/[\u0000-\u0020\u007f<>\\]/u.test(raw))return null;
 try{
  const url=new URL(raw);
  if(url.href!==raw||url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||
   !url.hostname.includes('.')||url.hostname.endsWith('.')||/^\d+(?:\.\d+){3}$/u.test(url.hostname)||
   /(?:^localhost$|\.localhost$|\.local$|\.internal$|\.test$|\.invalid$|\.example$|\.onion$)/u.test(url.hostname)||
   /%(?:2e|2f|5c)/iu.test(url.pathname)||url.pathname.includes('//'))return null;
  return url;
 }catch{return null;}
}

function reviewRow(row,plan,asOf){
 check(exact(row,['id','targetCountry','publisherId','lane','sourceReference','plannedCategories','observedOn','evidence','notes']),'ROW_SHAPE');
 check(id(row.id)&&boundedText(row.notes,700),'ROW_IDENTITY');
 const gap=plan.countries.find(country=>country.code===row.targetCountry);
 check(gap!==undefined&&gap.review==='review-direct-opportunity','TARGET_NOT_IN_LANE');
 const ref=publicReference(row.sourceReference);
 check(ref!==null,'SOURCE_REFERENCE');
 check(row.lane==='direct-news-research'||row.lane==='official-data-research','LANE');
 if(row.lane==='direct-news-research'){
  const publisher=NEWS_PUBLISHERS.find(item=>item.id===row.publisherId);
  check(publisher?.origins.includes(ref.origin)&&NEWS_PUBLICATION_SCOPES.some(scope=>scope.publisherId===publisher.id&&scope.countryCode===row.targetCountry&&
   (scope.origins===undefined||scope.origins.includes(ref.origin))),'PUBLISHER_BINDING');
  check(!NEWS_DISCOVERY_INDEXES.some(index=>index.publisherId===publisher.id),'ALREADY_DIRECT_INDEXED');
 }else{
  check(row.publisherId===null,'DATA_NOT_NEWS_PROVENANCE');
 }
 check(Array.isArray(row.plannedCategories)&&row.plannedCategories.length>0&&row.plannedCategories.length<=PUBLIC_EDITORIAL_CATEGORIES.length&&
  new Set(row.plannedCategories).size===row.plannedCategories.length&&row.plannedCategories.every(value=>PUBLIC_EDITORIAL_CATEGORIES.includes(value)),'CATEGORY');
 const observed=instant(row.observedOn);
 check(observed!==null&&observed<=asOf,'OBSERVATION_TIME');
 check(Array.isArray(row.evidence)&&row.evidence.length>0&&row.evidence.length<=10,'EVIDENCE_COUNT');
 const evidenceIds=new Set(),signals=new Set();
 for(const entry of row.evidence){
  check(exact(entry,['url','signal','scope'])&&publicReference(entry.url)!==null&&SIGNALS.has(entry.signal)&&boundedText(entry.scope,500),'EVIDENCE_INVALID');
  const key=entry.url+'|'+entry.signal;
  check(!evidenceIds.has(key),'DUPLICATE_EVIDENCE');evidenceIds.add(key);signals.add(entry.signal);
 }
 // References are operator-recorded publisher statements, not authenticated
 // document receipts. Even a positive signal is not rights/access approval.
 const stale=asOf-observed>30*DAY;
 const restricted=signals.has('commercial-restriction')||signals.has('automated-access-restriction');
 const retired=signals.has('feed-retired');
 const ambiguous=signals.has('portal-policy-ambiguity');
 const specific=signals.has('dataset-identified')||signals.has('official-release-list');
 const positive=signals.has('open-license-limited')&&specific;
 let disposition='research-incomplete';
 if(retired)disposition='hold-retired-feed';
 else if(restricted)disposition='hold-commercial-permission';
 else if(stale)disposition='hold-stale-evidence';
 else if(ambiguous)disposition='hold-policy-scope';
 else if(row.lane==='official-data-research'&&positive)disposition='prepare-dataset-specific-review';
 // No automatic escalation of a news publisher from a claimed open licence.
 // Data research can never fill the national publisher coverage statistic.
 const requiredNext=disposition==='hold-retired-feed'?'separate-licensed-distribution-review':
  disposition==='hold-commercial-permission'?'obtain-explicit-permission-and-review-existing-access':
  disposition==='hold-stale-evidence'?'refresh-primary-evidence':
  disposition==='hold-policy-scope'?'resolve-exact-dataset-and-portal-rights':
  disposition==='prepare-dataset-specific-review'?'verify-exact-dataset-scope-endpoint-robots-and-freshness':
  'complete-primary-policy-and-endpoint-review';
 return {id:row.id,targetCountry:row.targetCountry,lane:row.lane,publisherId:row.publisherId,
  sourceReference:row.sourceReference,plannedCategories:[...row.plannedCategories],
  observationRevisions:plan.samples.map(item=>item.revision),historicalCounts:[...gap.counts],observedOn:row.observedOn,stale,
  disposition,requiredNext,evidence:row.evidence.map(({url,signal,scope})=>({url,signal,scope})),notes:row.notes,
  // This is a digest of the research record, NOT a hash of remote content.
  researchRecordSha256:hash(JSON.stringify(row)),countsAsNationalCoverage:false,probeAllowed:false,activationAllowed:false};
}

export function buildSourceQualificationQueue(documents,declaredModelCommit,ledgerText,asOfDate){
 const asOf=instant(asOfDate);check(asOf!==null,'CLOCK');
 check(typeof ledgerText==='string'&&Buffer.byteLength(ledgerText,'utf8')<=MAX_BYTES,'LEDGER_SIZE');
 let ledger;try{ledger=JSON.parse(ledgerText);}catch{throw Error('SOURCE_PREFLIGHT_LEDGER_JSON');}
 check(exact(ledger,['format','evidenceBasis','entries'])&&ledger.format==='dlkt-source-preflight-1'&&
  ledger.evidenceBasis==='operator-recorded-primary-page-research-not-authenticated-receipts'&&Array.isArray(ledger.entries)&&
  ledger.entries.length>0&&ledger.entries.length<=MAX_ENTRIES,'LEDGER_SHAPE');
 const plan=buildExpansionPlan(documents,declaredModelCommit);
 check(plan.samples.every(sample=>instant(sample.checkedAt.slice(0,10))<=asOf),'AUDIT_AFTER_CLOCK');
 const rows=ledger.entries.map(row=>reviewRow(row,plan,asOf));
 const ids=new Set(),references=new Set();
 for(const row of rows){
  check(!ids.has(row.id)&&!references.has(row.sourceReference),'DUPLICATE_SOURCE_RESEARCH');
  ids.add(row.id);references.add(row.sourceReference);
 }
 rows.sort((a,b)=>a.targetCountry.localeCompare(b.targetCountry)||a.lane.localeCompare(b.lane)||a.id.localeCompare(b.id));
 const lanes={};
 for(const row of rows)lanes[row.disposition]=(lanes[row.disposition]??0)+1;
 const countries=plan.gaps.buckets.observedWithoutDirect.map(code=>({code,researchRecords:rows.filter(row=>row.targetCountry===code).length}));
 return {status:'SOURCE_RESEARCH_PREFLIGHT_ONLY',asOfDate,declaredModelCommit,modelBinding:plan.modelBinding,
  ledgerSha256:hash(ledgerText),auditSamples:plan.samples.map(({revision,checkedAt,documentSha256,reportLineSha256})=>({revision,checkedAt,documentSha256,reportLineSha256})),
  countries,lanes,rows,authorization:'NO_SOURCE_PROBE_OR_ACTIVATION',probeAllowed:false,activationAllowed:false};
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
 const [flag,date,...extra]=process.argv.slice(2);
 check(flag==='--as-of'&&extra.length===0,'ARGUMENTS');
 const paths=['../docs/iceo-global-coverage-baseline-20261127.md','../docs/evidence/global-coverage-operational-244-20261127.txt',
  '../docs/evidence/source-qualification-research-20261127.json'];
 const [first,second,ledger]=await Promise.all(paths.map(path=>boundedRead(new URL(path,import.meta.url))));
 console.log('DLKT_SOURCE_PREFLIGHT '+JSON.stringify(buildSourceQualificationQueue([first,second],
  '2005ad5cf04f6ea0f04080eeb66a99f6d895b55d',ledger,date)));
}catch(error){
 console.error('DLKT_SOURCE_PREFLIGHT_HELD '+(error instanceof Error&&/^SOURCE_PREFLIGHT_[A-Z_]+$/u.test(error.message)?error.message:'EVIDENCE_UNAVAILABLE'));
 process.exitCode=1;
}
