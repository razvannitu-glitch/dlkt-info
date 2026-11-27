/** Isolated operator research collector, not part of the production runtime.
 * No keys, approval, scheduler, CLI, automatic retry or publication are installed.
 * Caller-supplied trust anchors do not establish reviewer/collector authority. */
import {createHash,createPublicKey,KeyObject,sign,verify} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {lstat,realpath,open} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {hdbEvidenceContext,hdbEvidenceRequest,captureSigningBytes,inspectHdbDatastoreEntity,buildHdbEvidenceGateway} from './primary-data-evidence-gateway.mjs';

const TOWNS=Object.freeze(['Ang Mo Kio','Bedok']);
const POLICY=Object.freeze([
 ['catalogue','https://data.gov.sg/datasets/d_b51323a474ba789fb4cc3db58a3116d4/view'],
 ['licence','https://data.gov.sg/open-data-licence'],
 ['api-guide','https://guide.data.gov.sg/developer-guide/dataset-apis/search-and-filter-within-dataset'],
 ['rate-limits','https://guide.data.gov.sg/developer-guide/api-overview/api-rate-limits'],
 ['robots','https://data.gov.sg/robots.txt'],
]);
const PERMIT_KEYS=Object.freeze(['format','evidenceClass','contextSha256','auditDocumentsSha256','reviewerKeySha256',
 'collectorKeySha256','nonce','issuedAt','expiresAt','requestUrls','policyEvidence']);
const PROOF_KEYS=Object.freeze(['kind','url','checkedAt','sha256','decision']);
const MAX_BODY=128*1024,MAX_REQUEST_MS=10000,MAX_PERMIT_MS=900000,MAX_POLICY_AGE=86400000;
const check=(condition,reason)=>{if(!condition)throw Error('TRUSTED_COLLECTION_'+reason);};
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
function instant(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))return null;
 const n=Date.parse(value);return Number.isFinite(n)&&new Date(n).toISOString()===value?n:null;
}
function clockNow(clock){
 const n=clock();check(Number.isSafeInteger(n)&&n>=0&&n<=253402300799999,'CLOCK');return n;
}
const fingerprint=key=>hash(key.export({type:'spki',format:'der'}));

/** Ordered domain-separated tuple; no unbounded objects, alternate URLs,
 * or unchecked extension fields in the signed representation. */
export function collectionPermitSigningBytes(permit){
 check(exact(permit,PERMIT_KEYS),'PERMIT_SHAPE');
 check(PERMIT_KEYS.slice(0,9).every(key=>typeof permit[key]==='string'&&permit[key].length<=128)&&
  Array.isArray(permit.requestUrls)&&permit.requestUrls.length===2&&
  permit.requestUrls.every(url=>typeof url==='string'&&url.length<=2048)&&
  Array.isArray(permit.policyEvidence)&&permit.policyEvidence.length===POLICY.length&&
  permit.policyEvidence.every(entry=>exact(entry,PROOF_KEYS)&&PROOF_KEYS.every(key=>typeof entry[key]==='string'&&entry[key].length<=2048)),'PERMIT_SHAPE');
 return Buffer.from(JSON.stringify(['dlkt-hdb-collection-permit-signature-1',
  ...PERMIT_KEYS.slice(0,10).map(key=>permit[key]),
  permit.policyEvidence.map(entry=>PROOF_KEYS.map(key=>entry[key]))]),'utf8');
}
export function collectionPlan(documents,model,ledgerText,packetText,asOf){
 const context=hdbEvidenceContext(documents,model,ledgerText,packetText,asOf);
 return {contextSha256:context.contextSha256,auditDocumentsSha256:hash(JSON.stringify(documents.map(hash))),
  requestUrls:[...context.requestUrls],requiredPolicyEvidence:POLICY.map(([kind,url])=>({kind,url})),
  maxRequests:2,maxEntityBytes:MAX_BODY,authorization:'NO_AUTOMATIC_AUTHORIZATION',
  probeAllowed:false,activationAllowed:false,publicationAllowed:false};
}
function verifyPermit(input,evidenceClass,now){
 const {documents,model,ledgerText,packetText,permit,permitSignature,reviewerPublicKey,collectorPrivateKey}=input;
 const bytes=collectionPermitSigningBytes(permit);
 check(permit.evidenceClass===evidenceClass,'PERMIT_BINDING');
 const plan=collectionPlan(documents,model,ledgerText,packetText,new Date(now).toISOString());
 check(reviewerPublicKey instanceof KeyObject&&reviewerPublicKey.type==='public'&&reviewerPublicKey.asymmetricKeyType==='ed25519'&&
  collectorPrivateKey instanceof KeyObject&&collectorPrivateKey.type==='private'&&collectorPrivateKey.asymmetricKeyType==='ed25519','KEYS');
 const collectorPublicKey=createPublicKey(collectorPrivateKey),reviewerDigest=fingerprint(reviewerPublicKey),collectorDigest=fingerprint(collectorPublicKey);
 check(reviewerDigest!==collectorDigest,'KEY_SEPARATION');
 check(permit.format==='dlkt-hdb-collection-permit-1'&&permit.evidenceClass===evidenceClass&&
  permit.contextSha256===plan.contextSha256&&permit.auditDocumentsSha256===plan.auditDocumentsSha256&&
  permit.reviewerKeySha256===reviewerDigest&&permit.collectorKeySha256===collectorDigest&&digest(permit.nonce),'PERMIT_BINDING');
 check(JSON.stringify(permit.requestUrls)===JSON.stringify(plan.requestUrls),'REQUEST_SET');
 const issued=instant(permit.issuedAt),expires=instant(permit.expiresAt);
 check(issued!==null&&expires!==null&&issued<=now&&now<expires&&expires-issued<=MAX_PERMIT_MS,'PERMIT_WINDOW');
 for(let i=0;i<POLICY.length;i++){
  const evidence=permit.policyEvidence[i],[kind,url]=POLICY[i],checked=instant(evidence.checkedAt);
  check(evidence.kind===kind&&evidence.url===url&&digest(evidence.sha256)&&
   evidence.decision==='allowed-for-this-exact-research'&&checked!==null&&checked<=issued&&expires-checked<=MAX_POLICY_AGE,'POLICY_REVIEW');
 }
 check(typeof permitSignature==='string'&&/^[A-Za-z0-9+/]{86}==$/u.test(permitSignature),'PERMIT_SIGNATURE');
 const signature=Buffer.from(permitSignature,'base64');
 check(signature.length===64&&signature.toString('base64')===permitSignature&&verify(null,bytes,reviewerPublicKey,signature),'PERMIT_SIGNATURE');
 return {plan,issued,expires,collectorPublicKey,collectorDigest,reviewerDigest,permitSha256:hash(Buffer.concat([bytes,signature])),
  nonce:permit.nonce};
}

/** Exclusive reservation is intentionally irreversible even on a failed
 * collection. It protects one operator-controlled local filesystem, not
 * different hosts or a malicious process with access to the ledger. */
async function reserve(directory,verified,now){
 check(typeof directory==='string'&&directory.length<=4096&&isAbsolute(directory)&&resolve(directory)===directory,'LEDGER_DIRECTORY');
 try{
  const info=await lstat(directory);
  check(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(directory)===directory&&
   (info.mode&0o077)===0&&(info.mode&0o700)===0o700&&
   (typeof process.getuid!=='function'||info.uid===process.getuid()),'LEDGER_DIRECTORY');
 }catch{throw Error('TRUSTED_COLLECTION_LEDGER_DIRECTORY');}
 const name=hash(JSON.stringify(['dlkt-hdb-permit-nonce-1',verified.reviewerDigest,verified.nonce]))+'.json';
 let handle;
 try{
  handle=await open(join(directory,name),'wx',0o600);
  await handle.writeFile(JSON.stringify({permitSha256:verified.permitSha256,reservedAt:new Date(now).toISOString()})+'\n','utf8');
  await handle.sync();
 }catch(error){
  if(error?.code==='EEXIST')throw Error('TRUSTED_COLLECTION_PERMIT_ALREADY_USED');
  throw Error('TRUSTED_COLLECTION_LEDGER_RESERVATION');
 }finally{if(handle)await handle.close();}
}
function mediaType(value){
 check(typeof value==='string'&&/^application\/json(?:;\s*charset=utf-8)?$/iu.test(value.trim()),'RESPONSE_MEDIA');
 return value.includes(';')?'application/json; charset=utf-8':'application/json';
}
function validateTransport(response,url){
 check(exact(response,['responseUrl','status','contentType','contentEncoding','redirected','body']),'RESPONSE_SHAPE');
 check(response.responseUrl===url&&response.redirected===false,'RESPONSE_ORIGIN');
 check(response.status===200,'RESPONSE_STATUS');
 check(response.contentEncoding==='identity','RESPONSE_ENCODING');
 check(Buffer.isBuffer(response.body)&&response.body.length>0&&response.body.length<=MAX_BODY,'RESPONSE_SIZE');
 return mediaType(response.contentType);
}

/** Fixed HTTPS requests; native TLS verification; no cookies, API keys,
 * proxy selection, redirects, decompression or retries. Never logs bodies. */
function directHttpsTransport(url){
 check(TOWNS.some(town=>hdbEvidenceRequest(town)===url),'REQUEST_SET');
 return new Promise((resolveResponse,rejectResponse)=>{
  const signal=AbortSignal.timeout(MAX_REQUEST_MS);
  const req=httpsRequest(url,{method:'GET',agent:false,rejectUnauthorized:true,minVersion:'TLSv1.2',
   maxHeaderSize:16384,signal,headers:{'Accept':'application/json','Accept-Encoding':'identity',
    'User-Agent':'DLKT-Info-ICEO/1.0 (+https://www.dlkt.ee)'}},res=>{
   (async()=>{
    check(res.statusCode===200,'RESPONSE_STATUS');
    const type=mediaType(res.headers['content-type']);
    const encoding=res.headers['content-encoding']??'identity';
    check(encoding==='identity','RESPONSE_ENCODING');
    const declared=res.headers['content-length'];
    check(declared===undefined||typeof declared==='string'&&/^\d{1,6}$/u.test(declared)&&Number(declared)>0&&Number(declared)<=MAX_BODY,'RESPONSE_SIZE');
    const chunks=[];let total=0;
    for await(const chunk of res){
     check(Buffer.isBuffer(chunk),'RESPONSE_ENCODING');total+=chunk.length;
     check(total<=MAX_BODY,'RESPONSE_SIZE');chunks.push(chunk);
    }
    check(res.complete&&total>0&&(declared===undefined||Number(declared)===total),'RESPONSE_INCOMPLETE');
    return {responseUrl:url,status:200,contentType:type,contentEncoding:'identity',redirected:false,body:Buffer.concat(chunks,total)};
   })().then(resolveResponse,error=>{res.destroy();rejectResponse(error);});
  });
  req.once('error',()=>rejectResponse(Error('TRUSTED_COLLECTION_TRANSPORT_FAILED')));
  req.end();
 });
}

async function collect(input,evidenceClass,transport,clock){
 const started=clockNow(clock),verified=verifyPermit(input,evidenceClass,started);
 await reserve(input.ledgerDirectory,verified,started);
 const captures=[];
 const assertWindow=()=>{
  const now=clockNow(clock);check(now>=started&&now>=verified.issued&&now<verified.expires,'PERMIT_WINDOW');return now;
 };
 for(const [index,town] of TOWNS.entries()){
  assertWindow();
  const url=verified.plan.requestUrls[index];
  const response=await transport(url);
  const capturedAt=new Date(assertWindow()).toISOString();
  const type=validateTransport(response,url);
  // Reuse the exact provisional parser before starting a second request.
  // Never query around a denial, malformed response or invalid row scope.
  const body=Buffer.from(response.body);
  inspectHdbDatastoreEntity(body,town);
  const receipt={format:'dlkt-primary-data-capture-1',evidenceClass,contextSha256:verified.plan.contextSha256,
   signerKeySha256:verified.collectorDigest,requestUrl:url,responseUrl:url,method:'GET',status:200,
   contentType:type,redirected:false,capturedAt,bodyEncoding:'decoded-http-entity-utf8',bodyBytes:body.length,bodySha256:hash(body)};
  const signature=sign(null,captureSigningBytes(receipt),input.collectorPrivateKey).toString('base64');
  captures.push({receipt,signature,body});
 }
 const asOf=new Date(assertWindow()).toISOString();
 const report=buildHdbEvidenceGateway(input.documents,input.model,input.ledgerText,input.packetText,asOf,captures,
  {evidenceClass,publicKeyPem:verified.collectorPublicKey.export({type:'spki',format:'pem'})});
 return {report,collection:{evidenceClass,permitSha256:verified.permitSha256,reviewerKeySha256:verified.reviewerDigest,
  signatureState:'verified-against-caller-supplied-reviewer-key',reviewerAuthority:'not-independently-established',
  requestsCompleted:2,localPermitConsumed:true,remoteOriginAuthenticated:false,
  activationAllowed:false,publicationAllowed:false},captures};
}

/** No injectable clock/transport in this entrypoint. A separately managed
 * trust boundary and actual permission evidence are deployment prerequisites.
 * No live permit or private key exists in this repository. */
export function collectHdbResearch(input){
 return collect(input,'external-research-capture',directHttpsTransport,Date.now);
}
/** Test-only research path; even an otherwise valid real permit cannot be
 * used here. Injected responses are always labelled synthetic. */
export function collectHdbSyntheticFixture(input,{transport,clock}){
 check(typeof transport==='function'&&typeof clock==='function','FIXTURE_TRANSPORT');
 return collect(input,'synthetic-fixture',transport,clock);
}
