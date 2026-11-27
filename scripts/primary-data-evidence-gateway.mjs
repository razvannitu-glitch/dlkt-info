/** Offline evidence gateway. No network, key enrolment, publication or activation.
 * A caller-supplied collector key authenticates a statement about a capture,
 * not the remote provider, TLS session, licence, or collector authorization. */
import {createHash,createPublicKey,verify} from 'node:crypto';
import {buildPrimaryDataPilot,normalizeHdbSample,compareHistoricalMedians} from './primary-data-intelligence.mjs';

const DATASET='d_b51323a474ba789fb4cc3db58a3116d4';
const ENDPOINT='https://data.gov.sg/api/action/datastore_search';
const PERIOD='2026-Q2',FLAT='4-room';
const TOWNS=Object.freeze(['Ang Mo Kio','Bedok']);
const FIELDS=Object.freeze(['quarter','town','flat_type','price']);
const MAX_BODY=128*1024,MAX_CAPTURE_AGE=86400000,MAX_PAIR_GAP=600000;
const PURPOSES=new Set(['synthetic-fixture','external-research-capture']);
const RECEIPT_KEYS=Object.freeze(['format','evidenceClass','contextSha256','signerKeySha256','requestUrl','responseUrl',
 'method','status','contentType','redirected','capturedAt','bodyEncoding','bodyBytes','bodySha256']);
const check=(condition,reason)=>{if(!condition)throw Error('DATA_EVIDENCE_'+reason);};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
function instant(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))return null;
 const n=Date.parse(value);return Number.isFinite(n)&&new Date(n).toISOString()===value?n:null;
}

/** Exact research request plans, not permission to execute either request.
 * No arbitrary URLs, filters, API keys, redirects, pagination or wildcards. */
export function hdbEvidenceRequest(town){
 check(TOWNS.includes(town),'TOWN');
 const url=new URL(ENDPOINT);
 url.searchParams.set('resource_id',DATASET);
 url.searchParams.set('limit','2');
 url.searchParams.set('offset','0');
 url.searchParams.set('fields',FIELDS.join(','));
 url.searchParams.set('filters',JSON.stringify({quarter:PERIOD,town,flat_type:FLAT}));
 return url.href;
}

function sourceContext(documents,model,ledgerText,packetText,asOf){
 const now=instant(asOf);check(now!==null,'CLOCK');
 const pilot=buildPrimaryDataPilot(documents,model,ledgerText,packetText,asOf.slice(0,10));
 check(pilot.datasetId===DATASET&&pilot.availability.dataThrough===PERIOD,'PILOT_BINDING');
 check(!pilot.latestPublication.reasons.includes('source-research-held')&&
  pilot.availability.state!=='held-stale-primary-evidence','SOURCE_RESEARCH_HELD');
 const contextSha256=hash(JSON.stringify(['dlkt-hdb-evidence-context-1',model,pilot.packetSha256,pilot.ledgerSha256,
  pilot.researchRecordSha256,pilot.availability.dataFrom,pilot.availability.dataThrough,pilot.availability.officialThrough]));
 const observedOn=JSON.parse(packetText).observedOn;
 return {pilot,contextSha256,earliest:Date.parse(observedOn+'T00:00:00.000Z'),now};
}

export function hdbEvidenceContext(documents,model,ledgerText,packetText,asOf){
 const context=sourceContext(documents,model,ledgerText,packetText,asOf);
 return Object.freeze({contextSha256:context.contextSha256,requestUrls:Object.freeze(TOWNS.map(hdbEvidenceRequest)),
  probeAllowed:false,activationAllowed:false,publicationAllowed:false});
}

/** Sign only this fixed ordered, domain-separated tuple. A key is supplied
 * separately by the operator; never accept a key from the signed receipt. */
export function captureSigningBytes(receipt){
 check(exact(receipt,RECEIPT_KEYS),'RECEIPT_SHAPE');
 return Buffer.from(JSON.stringify(['dlkt-primary-data-capture-signature-1',...RECEIPT_KEYS.map(key=>receipt[key])]),'utf8');
}
function collectorKey(trust){
 check(exact(trust,['evidenceClass','publicKeyPem'])&&PURPOSES.has(trust.evidenceClass)&&
  typeof trust.publicKeyPem==='string'&&trust.publicKeyPem.length<=512&&
  /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/u.test(trust.publicKeyPem),'COLLECTOR_KEY_REQUIRED');
 let key;try{key=createPublicKey(trust.publicKeyPem);}catch{throw Error('DATA_EVIDENCE_COLLECTOR_KEY_INVALID');}
 check(key.asymmetricKeyType==='ed25519','COLLECTOR_KEY_INVALID');
 return {key,keySha256:hash(key.export({type:'spki',format:'der'})),evidenceClass:trust.evidenceClass};
}

/** JSON.parse alone silently resolves duplicate properties. Scan the
 * already grammar-checked document to reject ambiguous keys at any depth,
 * including escaped spellings, and cap structural complexity. */
function unambiguousJson(body){
 let input;
 try{input=new TextDecoder('utf-8',{fatal:true}).decode(body);}catch{throw Error('DATA_EVIDENCE_BODY_UTF8');}
 check(Buffer.from(input,'utf8').equals(body),'BODY_UTF8');
 let parsed;try{parsed=JSON.parse(input);}catch{throw Error('DATA_EVIDENCE_BODY_JSON');}
 let pos=0,nodes=0;
 const ws=()=>{while(pos<input.length&&/[ \t\r\n]/u.test(input[pos]))pos++;};
 const stringToken=()=>{
  const start=pos++;while(pos<input.length){
   const ch=input[pos++];if(ch==='\\'){pos++;continue;}
   if(ch==='"')return JSON.parse(input.slice(start,pos));
  }throw Error('DATA_EVIDENCE_BODY_JSON');
 };
 const token=depth=>{
  check(depth<=24&&++nodes<=10000,'BODY_COMPLEXITY');ws();
  if(input[pos]==='"'){stringToken();return;}
  if(input[pos]==='{'){
   pos++;ws();const keys=new Set();if(input[pos]==='}'){pos++;return;}
   while(true){
    ws();const key=stringToken();check(!keys.has(key),'DUPLICATE_JSON_KEY');keys.add(key);
    ws();pos++;token(depth+1);ws();if(input[pos++]==='}')return;
   }
  }
  if(input[pos]==='['){
   pos++;ws();if(input[pos]===']'){pos++;return;}
   while(true){token(depth+1);ws();if(input[pos++ ]===']')return;}
  }
  while(pos<input.length&&!/[ \t\r\n,}\]]/u.test(input[pos]))pos++;
 };
 token(0);ws();check(pos===input.length,'BODY_JSON');
 return parsed;
}

/** Provisional datastore envelope adapter. The provider documents the query
 * parameters, but no original response is available in this repository.
 * Unexpected response structure must be held, never treated as success. */
export function inspectHdbDatastoreEntity(body,town){
 check(TOWNS.includes(town)&&Buffer.isBuffer(body)&&body.length>0&&body.length<=MAX_BODY,'BODY_INTEGRITY');
 const value=unambiguousJson(body);
 check(record(value)&&Object.hasOwn(value,'success')&&value.success===true&&record(value.result),'RESPONSE_ENVELOPE');
 const result=value.result;
 check(Object.hasOwn(result,'resource_id')&&result.resource_id===DATASET&&Array.isArray(result.records),'RESPONSE_DATASET');
 check(Number.isSafeInteger(result.total)&&result.total>=0&&result.total<=1&&
  result.total===result.records.length&&result.records.length<=1&&
  (!Object.hasOwn(result,'total_was_estimated')||result.total_was_estimated===false)&&
  (!Object.hasOwn(result,'limit')||result.limit===2)&&(!Object.hasOwn(result,'offset')||result.offset===0),'RESPONSE_CARDINALITY');
 const projected=result.records.map(row=>{
  // The explicitly selected fields are the only allowed data fields.
  // Some datastore responses include a transport row identifier; discard it.
  const hasId=record(row)&&Object.hasOwn(row,'_id');
  check(exact(row,hasId?[...FIELDS,'_id']:FIELDS)&&(!hasId||Number.isSafeInteger(row._id)&&row._id>0),'ROW_FIELDS');
  check(row.quarter===PERIOD&&row.town===town&&row.flat_type===FLAT,'ROW_FILTER');
  return {quarter:row.quarter,town:row.town,flat_type:row.flat_type,price:row.price};
 });
 return projected.length?normalizeHdbSample(projected,PERIOD,PERIOD).rows:[];
}

function verifyCapture(capture,town,context,collector){
 check(exact(capture,['receipt','signature','body']),'CAPTURE_SHAPE');
 const {receipt,signature,body}=capture;
 const bytes=captureSigningBytes(receipt);
 check(receipt.format==='dlkt-primary-data-capture-1'&&receipt.evidenceClass===collector.evidenceClass&&
  receipt.contextSha256===context.contextSha256&&digest(receipt.signerKeySha256)&&
  receipt.signerKeySha256===collector.keySha256,'RECEIPT_BINDING');
 const url=hdbEvidenceRequest(town);
 check(receipt.requestUrl===url&&receipt.responseUrl===url&&receipt.method==='GET'&&receipt.redirected===false,'REQUEST_BINDING');
 check(receipt.status===200&&['application/json','application/json; charset=utf-8'].includes(receipt.contentType)&&
  receipt.bodyEncoding==='decoded-http-entity-utf8','TRANSPORT');
 const capturedAt=instant(receipt.capturedAt);
 check(capturedAt!==null&&capturedAt>=context.earliest&&capturedAt<=context.now&&
  context.now-capturedAt<=MAX_CAPTURE_AGE,'CAPTURE_TIME');
 check(Buffer.isBuffer(body)&&body.length>0&&body.length<=MAX_BODY&&Number.isSafeInteger(receipt.bodyBytes)&&
  receipt.bodyBytes===body.length&&digest(receipt.bodySha256)&&hash(body)===receipt.bodySha256,'BODY_INTEGRITY');
 check(typeof signature==='string'&&/^[A-Za-z0-9+/]{86}==$/u.test(signature),'SIGNATURE_ENCODING');
 const sig=Buffer.from(signature,'base64');
 check(sig.length===64&&sig.toString('base64')===signature,'SIGNATURE_ENCODING');
 check(verify(null,bytes,collector.key,sig),'SIGNATURE_INVALID');
 const rows=inspectHdbDatastoreEntity(body,town);
 return {town,rows,capturedAt,receipt:{capturedAt:receipt.capturedAt,requestUrl:url,bodyBytes:body.length,
  bodySha256:receipt.bodySha256,signedReceiptSha256:hash(Buffer.concat([bytes,sig])),rowCount:rows.length}};
}

/** Validate two bounded historical cells. Neither the externally supplied
 * key nor signed metadata is independently trusted by this gateway.
 * Fixture evidence always remains labelled; no raw response is published. */
export function buildHdbEvidenceGateway(documents,model,ledgerText,packetText,asOf,captures,trust){
 const context=sourceContext(documents,model,ledgerText,packetText,asOf);
 const collector=collectorKey(trust);
 check(Array.isArray(captures)&&captures.length===TOWNS.length,'CAPTURE_COUNT');
 const results=TOWNS.map(town=>{
  const matches=captures.filter(item=>item?.receipt?.requestUrl===hdbEvidenceRequest(town));
  check(matches.length===1,'CAPTURE_SET');
  return verifyCapture(matches[0],town,context,collector);
 });
 check(Math.abs(results[0].capturedAt-results[1].capturedAt)<=MAX_PAIR_GAP,'CAPTURE_WINDOW');
 const rows=results.flatMap(item=>item.rows);
 const compared=compareHistoricalMedians(rows,{quarter:PERIOD,flatType:FLAT,firstTown:TOWNS[0],secondTown:TOWNS[1]});
 const comparison=compared.state==='historical-lab-comparison'?
  {state:'historical-research-comparison',evidenceClass:collector.evidenceClass,quarter:PERIOD,flatType:FLAT,
   first:compared.first,second:compared.second,difference:compared.difference,currency:null,
   meaning:'Difference of two reported aggregate medians in the unconfirmed catalogue unit; not current prices or a valuation.'}:
  {state:'held-missing-comparable-medians',quarter:PERIOD,flatType:FLAT,difference:null};
 return {status:'PRIMARY_DATA_EVIDENCE_RESEARCH_ONLY',evidenceClass:collector.evidenceClass,
  signatureState:'verified-against-caller-supplied-collector-key',collectorKeySha256:collector.keySha256,
  collectorAuthority:'not-independently-established',remoteOriginAuthenticated:false,
  contextSha256:context.contextSha256,datasetId:DATASET,statisticalPeriod:PERIOD,
  officialPeriod:context.pilot.availability.officialThrough,availability:context.pilot.availability,
  receipts:results.map(item=>item.receipt),comparison,
  completeDataset:false,sameDatasetVersionEstablished:false,countsAsNationalNewsCoverage:false,
  latestPublication:{state:'held',reasons:['collector-authority-and-remote-response-not-independently-authenticated',
   'provisional-response-adapter-requires-real-receipt','licence-and-collection-review-required','currency-unconfirmed',context.pilot.availability.state]},
  authorization:'NO_PROBE_ACTIVATION_OR_PUBLICATION',probeAllowed:false,activationAllowed:false,publicationAllowed:false};
}
