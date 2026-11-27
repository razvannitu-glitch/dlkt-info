import {createHash} from 'node:crypto';

// Disposable laboratory only. These ports are trusted, server-owned,
// independently authenticated, single-transaction database operations.
// Never expose this adapter or an observation callback to a public request.
export interface Candidate {
  readonly id: string;
  readonly revision: number;
  readonly digest: string;
  readonly sourceUrl: string;
  readonly policyUrl: string;
}
type Hashes = readonly [string,string,string,string,string];
type HeldReason = 'source-denied'|'policy-changed'|'incomplete-evidence';
type FailedReason = 'transport-failed'|'invalid-receipt'|'clock-invalid';
export type Terminal =
  | {readonly outcome:'observed';readonly observedAt:string;readonly fingerprints:Hashes;readonly evidenceDigest:string;readonly reason:null}
  | {readonly outcome:'held';readonly reason:HeldReason;readonly observedAt:null;readonly fingerprints:null;readonly evidenceDigest:null}
  | {readonly outcome:'failed';readonly reason:FailedReason;readonly observedAt:null;readonly fingerprints:null;readonly evidenceDigest:null};
type Positive = Extract<Terminal,{outcome:'observed'}>;
type Key = Readonly<{candidate:Candidate;attemptId:string}>;
export interface Ports {
  readonly worker: {
    start(key:Key):Promise<unknown>;
    finish(key:Key,result:Terminal):Promise<unknown>;
  };
  readonly attestor: {attest(key:Key,result:Positive):Promise<unknown>};
  readonly reader: {read(candidate:Candidate):Promise<unknown>};
}
export interface AttemptResult {
  readonly state:'recorded'|'not-started'|'unresolved';
  readonly reason:string;
  readonly outcome:Terminal['outcome']|null;
  readonly historyState:string|null;
  readonly activationAllowed:false;
}
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(v);
const epoch=(v:unknown):number|null=>{
  if(typeof v!=='string')return null;
  const n=Date.parse(v);return Number.isSafeInteger(n)&&n>=0?n:null;
};
const canonicalTime=(v:unknown):v is string=>{
  const n=epoch(v);
  return typeof v==='string'&&n!==null&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v)&&new Date(n).toISOString()===v;
};
const isHashes=(v:unknown):v is Hashes=>Array.isArray(v)&&v.length===5&&[0,1,2,3,4].every(i=>Object.hasOwn(v,i)&&hex(v[i]));
const nsw=Object.freeze({id:'dlkt-elsewhere-nsw-fuelcheck',revision:1,digest:'772d754d42ceb10260b4c02c1b4c97fcb1949ddbf61d6b0cd17fb2b88fa1c88b',sourceUrl:'https://www.nsw.gov.au/legal-and-justice/consumer-rights-and-protection/advertising-product-packaging-and-pricing-laws/fuel-pricing-discounts-and-signage/check-fuel-prices',policyUrl:'https://www.nsw.gov.au/nsw-government/about-website/copyright'});
function sameCandidate(a:Candidate,b:Candidate):boolean{
  return a.id===b.id&&a.revision===b.revision&&a.digest===b.digest&&a.sourceUrl===b.sourceUrl&&a.policyUrl===b.policyUrl;
}
function validCandidate(c:Candidate):boolean{
  return typeof c.id==='string'&&typeof c.sourceUrl==='string'&&typeof c.policyUrl==='string'&&
    Number.isInteger(c.revision)&&c.revision>0&&c.revision<=2147483647&&hex(c.digest)&&
    ((/^lab-[a-z0-9][a-z0-9-]{0,62}$/u.test(c.id)&&
      /^https:\/\/example\.invalid\/source\/[a-z0-9-]{1,63}$/u.test(c.sourceUrl)&&
      /^https:\/\/example\.invalid\/policy\/[a-z0-9-]{1,63}$/u.test(c.policyUrl))||sameCandidate(c,nsw));
}
export function observationDigest(candidate:Candidate,observedAt:string,fingerprints:Hashes):string{
  return createHash('sha256').update(JSON.stringify(['dlkt-knowledge-observation-v1',
    candidate.id,candidate.revision,candidate.digest,candidate.sourceUrl,candidate.policyUrl,observedAt,fingerprints]),'utf8').digest('hex');
}
function failure(reason:FailedReason):Terminal{
  return Object.freeze({outcome:'failed',reason,observedAt:null,fingerprints:null,evidenceDigest:null});
}
function normalize(candidate:Candidate,input:unknown):Terminal{
  if(!object(input)||input.kind!=='lab-controlled-observation'||input.activationAllowed!==false)
    return failure('invalid-receipt');
  if(input.outcome==='held'&&(input.reason==='source-denied'||input.reason==='policy-changed'||input.reason==='incomplete-evidence')){
    return Object.freeze({outcome:'held',reason:input.reason,observedAt:null,fingerprints:null,evidenceDigest:null});
  }
  if(input.outcome==='failed'&&(input.reason==='transport-failed'||input.reason==='invalid-receipt'||input.reason==='clock-invalid'))
    return failure(input.reason);
  // Only synthetic positive fixtures are accepted in this increment. The
  // canonical NSW fixture can exercise the controlled held path, not admission.
  if(candidate.id===nsw.id||input.outcome!=='observed'||input.reason!==null||!object(input.candidate)||
    input.candidate.id!==candidate.id||input.candidate.revision!==candidate.revision||
    input.candidate.digest!==candidate.digest||input.candidate.sourceUrl!==candidate.sourceUrl||
    input.candidate.policyUrl!==candidate.policyUrl||!canonicalTime(input.observedAt)||
    !isHashes(input.fingerprints)||!hex(input.evidenceDigest))
    return failure('invalid-receipt');
  const f:Hashes=Object.freeze([input.fingerprints[0],input.fingerprints[1],input.fingerprints[2],input.fingerprints[3],input.fingerprints[4]]);
  const stamp=input.observedAt;
  if(observationDigest(candidate,stamp,f)!==input.evidenceDigest)return failure('invalid-receipt');
  return Object.freeze({outcome:'observed',reason:null,observedAt:stamp,fingerprints:f,evidenceDigest:input.evidenceDigest});
}
function report(state:AttemptResult['state'],reason:string,outcome:Terminal['outcome']|null=null,historyState:string|null=null):AttemptResult{
  return Object.freeze({state,reason,outcome,historyState,activationAllowed:false});
}
function isSequence(v:unknown):v is number{
  return typeof v==='number'&&Number.isInteger(v)&&v>=1&&v<=256;
}
type StoredOutcome=Terminal['outcome']|'open'|'abandoned';
type HistoryState='empty'|'complete-observation-prefix'|'terminal-hold-present'|'capacity-held'|'open'|'expired-open';
interface HistoryRow {
  readonly attemptId:string;readonly sequence:number;readonly startedAt:string;readonly finishedAt:string|null;
  readonly attestedAt:string|null;readonly outcome:StoredOutcome;readonly reason:string|null;
  readonly observedAt:string|null;readonly fingerprints:Hashes|null;readonly evidenceDigest:string|null;
}
interface CheckedHistory {readonly state:HistoryState;readonly tip:number;readonly attempts:readonly HistoryRow[]}
function validOutcome(value:unknown):value is StoredOutcome{
  return value==='observed'||value==='held'||value==='failed'||value==='open'||value==='abandoned';
}
function validHistoryState(value:unknown):value is HistoryState{
  return value==='empty'||value==='complete-observation-prefix'||value==='terminal-hold-present'||
    value==='capacity-held'||value==='open'||value==='expired-open';
}
function checkedHistory(value:unknown,c:Candidate):CheckedHistory|null{
  if(!object(value)||value.activationAllowed!==false||value.cardId!==c.id||value.revision!==c.revision||
    value.digest!==c.digest||value.sourceUrl!==c.sourceUrl||value.policyUrl!==c.policyUrl||
    (value.tip!==0&&!isSequence(value.tip))||!Array.isArray(value.attempts)||
    value.attempts.length!==value.tip||!validHistoryState(value.state))return null;
  const rows:HistoryRow[]=[];const seen=new Set<string>();
  let previousEnd:number|null=null,hasHold=false,hasOpen=false;
  for(let n=0;n<value.attempts.length;n++){
    const a:unknown=value.attempts[n];
    if(!object(a)||a.sequence!==n+1||!uuid(a.attemptId)||seen.has(a.attemptId)||
      !validOutcome(a.outcome)||typeof a.startedAt!=='string')return null;
    seen.add(a.attemptId);
    const started=epoch(a.startedAt);
    const finishedAt=a.finishedAt,attestedAt=a.attestedAt;
    if((finishedAt!==null&&typeof finishedAt!=='string')||(attestedAt!==null&&typeof attestedAt!=='string'))return null;
    const finished=epoch(finishedAt),attested=epoch(attestedAt);
    if(started===null||(previousEnd!==null&&started<previousEnd)||
      (attestedAt!==null&&(attested===null||attested<started||attested-started>=300000||
        (finished!==null&&attested>finished))))return null;
    if(a.outcome==='open'){
      if(n!==value.attempts.length-1||finishedAt!==null||a.reason!==null)return null;
      hasOpen=true;
    }else if(finished===null||finished<started)return null;
    let observedAt:string|null=null,fingerprints:Hashes|null=null,evidenceDigest:string|null=null;
    if(a.outcome==='observed'){
      const observed=epoch(a.observedAt);
      if(!c.id.startsWith('lab-')||typeof a.observedAt!=='string'||observed===null||attested===null||
        finished===null||observed<started||observed>attested||a.reason!==null||
        !isHashes(a.fingerprints)||!hex(a.evidenceDigest)||
        observationDigest(c,new Date(observed).toISOString(),a.fingerprints)!==a.evidenceDigest)return null;
      observedAt=a.observedAt;
      fingerprints=Object.freeze([a.fingerprints[0],a.fingerprints[1],a.fingerprints[2],a.fingerprints[3],a.fingerprints[4]]);
      evidenceDigest=a.evidenceDigest;
    }else{
      if(a.observedAt!==null||a.fingerprints!==null||a.evidenceDigest!==null)return null;
      if(a.outcome==='held'&&!['source-denied','policy-changed','incomplete-evidence'].includes(String(a.reason)))return null;
      if(a.outcome==='failed'&&!['transport-failed','invalid-receipt','clock-invalid'].includes(String(a.reason)))return null;
      if(a.outcome==='abandoned'&&(a.reason!=='start-timeout'||finished===null||finished-started<300000))return null;
      if(a.outcome!=='open')hasHold=true;
    }
    if(a.reason!==null&&typeof a.reason!=='string')return null;
    previousEnd=finished;
    rows.push(Object.freeze({attemptId:a.attemptId,sequence:n+1,startedAt:a.startedAt,finishedAt,attestedAt,
      outcome:a.outcome,reason:a.reason,observedAt,fingerprints,evidenceDigest}));
  }
  if(hasOpen){
    if(value.state!=='open'&&value.state!=='expired-open')return null;
  }else{
    const expected=value.tip===0?'empty':value.tip===256?'capacity-held':hasHold?'terminal-hold-present':'complete-observation-prefix';
    if(value.state!==expected)return null;
  }
  return Object.freeze({state:value.state,tip:value.tip,attempts:Object.freeze(rows)});
}
function confirmReadback(value:unknown,key:Key,sequence:number,terminal:Terminal):string|null{
  const history=checkedHistory(value,key.candidate);
  if(history===null)return null;
  const row=history.attempts[sequence-1];
  if(!row||row.attemptId!==key.attemptId||row.outcome!==terminal.outcome||row.reason!==terminal.reason)return null;
  if(terminal.outcome==='observed'){
    if(epoch(row.observedAt)!==epoch(terminal.observedAt)||row.fingerprints===null||
      !row.fingerprints.every((v,j)=>v===terminal.fingerprints[j])||row.evidenceDigest!==terminal.evidenceDigest)return null;
  }
  return history.state;
}
/**
 * A committed created acknowledgement is the sole permission to call observe.
 * Ambiguous start/attestation leave the existing attempt for recovery, never
 * retry the source. Finish uncertainty is resolved only by exact locked readback.
 * A recorded result proves persistence, not editorial suitability or activation.
 */
export async function runObservationAttempt(input:Key,ports:Ports,observe:(key:Key)=>Promise<unknown>):Promise<AttemptResult>{
  let key:Key;
  try{
    const c=input.candidate;
    const candidate:Candidate=Object.freeze({id:c.id,revision:c.revision,digest:c.digest,sourceUrl:c.sourceUrl,policyUrl:c.policyUrl});
    if(!validCandidate(candidate)||!uuid(input.attemptId))return report('not-started','invalid-laboratory-identity');
    key=Object.freeze({candidate,attemptId:input.attemptId});
  }catch{return report('not-started','invalid-laboratory-identity');}
  let start:unknown;
  try{start=await ports.worker.start(key);}
  catch{return report('unresolved','start-commit-unconfirmed');}
  if(!object(start))return report('unresolved','start-receipt-invalid');
  if(start.disposition==='busy'||start.disposition==='capacity-held'){
    return start.sequence===null?report('not-started',start.disposition):report('unresolved','start-receipt-invalid');
  }
  if(!isSequence(start.sequence))return report('unresolved','start-receipt-invalid');
  if(start.disposition==='replay-open'||start.disposition==='replay-terminal')return report('not-started',start.disposition);
  if(start.disposition!=='created')return report('unresolved','start-receipt-invalid');
  const sequence=start.sequence;
  let raw:unknown;
  let terminal:Terminal;
  try{raw=await observe(key);}
  catch{raw=null;terminal=failure('transport-failed');
    return await persist(key,sequence,terminal,ports);
  }
  try{terminal=normalize(key.candidate,raw);}
  catch{terminal=failure('invalid-receipt');}
  if(terminal.outcome==='observed'){
    try{
      const a=await ports.attestor.attest(key,terminal);
      if(a!=='attested'&&a!=='replay')return report('unresolved','attestation-commit-unconfirmed');
    }catch{return report('unresolved','attestation-commit-unconfirmed');}
  }
  return await persist(key,sequence,terminal,ports);
}
async function persist(key:Key,sequence:number,terminal:Terminal,ports:Ports):Promise<AttemptResult>{
  let acknowledged=false;
  try{const response=await ports.worker.finish(key,terminal);acknowledged=response==='recorded'||response==='replay';}
  catch{/* A failed client response is not proof of database rollback. */}
  try{
    const state=confirmReadback(await ports.reader.read(key.candidate),key,sequence,terminal);
    if(state!==null)return report('recorded',acknowledged?'exact-readback':'confirmed-after-uncertain-finish',terminal.outcome,state);
  }catch{/* Never return a successful outcome without confirmed persistence. */}
  return report('unresolved','terminal-readback-unconfirmed');
}


// Recovery is deliberately separate from observation and editorial review.
// The reaper never receives a probe callback or a worker/reviewer port.
export interface RecoveryPorts {
  readonly reader:Ports['reader'];
  readonly reaper:{abandon(key:Key):Promise<unknown>};
}
export interface RecoveryResult {
  readonly state:'recovered'|'not-actionable'|'unresolved';
  readonly reason:string;readonly historyState:HistoryState|null;
  readonly activationAllowed:false;readonly approvalReusable:false;
}
function recovery(state:RecoveryResult['state'],reason:string,historyState:HistoryState|null=null):RecoveryResult{
  return Object.freeze({state,reason,historyState,activationAllowed:false,approvalReusable:false});
}
/**
 * Reconcile one exact durable attempt. Only the authoritative database's
 * expired-open state permits a reaper call, and SQL rechecks its deadline
 * under the candidate lock. Never retry observation or abandon a replacement.
 * A committed or uncertain abandonment is confirmed from the same immutable
 * row and attestation metadata, even if a newer attempt has since started.
 * Recovery confirms failure persistence only, never permission to publish.
 */
export async function recoverObservationAttempt(input:Key,ports:RecoveryPorts):Promise<RecoveryResult>{
  let key:Key;
  try{
    const c=input.candidate;
    const candidate:Candidate=Object.freeze({id:c.id,revision:c.revision,digest:c.digest,sourceUrl:c.sourceUrl,policyUrl:c.policyUrl});
    if(!validCandidate(candidate)||!uuid(input.attemptId))return recovery('not-actionable','invalid-laboratory-identity');
    key=Object.freeze({candidate,attemptId:input.attemptId});
  }catch{return recovery('not-actionable','invalid-laboratory-identity');}
  let before:CheckedHistory|null;
  try{before=checkedHistory(await ports.reader.read(key.candidate),key.candidate);}
  catch{return recovery('unresolved','history-read-unconfirmed');}
  if(before===null)return recovery('unresolved','history-read-invalid');
  const target=before.attempts.find(a=>a.attemptId===key.attemptId);
  if(!target)return recovery('not-actionable','attempt-not-found',before.state);
  if(target.outcome==='abandoned')return recovery('recovered','already-abandoned',before.state);
  if(target.outcome!=='open')return recovery('not-actionable','already-terminal',before.state);
  if(before.state!=='expired-open'||target.sequence!==before.tip)
    return recovery('not-actionable','attempt-not-expired',before.state);
  let acknowledged=false;
  try{
    const reply=await ports.reaper.abandon(key);
    acknowledged=reply==='recorded'||reply==='already-terminal';
  }catch{/* An uncertain response is not proof of rollback. */}
  try{
    const after=checkedHistory(await ports.reader.read(key.candidate),key.candidate);
    const same=after?.attempts[target.sequence-1];
    if(after!==null&&same&&same.attemptId===target.attemptId&&same.startedAt===target.startedAt&&
      same.attestedAt===target.attestedAt&&same.outcome==='abandoned')
      return recovery('recovered',acknowledged?'exact-abandonment-readback':'confirmed-after-uncertain-abandonment',after.state);
  }catch{/* Never confirm a missing or ambiguous abandonment. */}
  return recovery('unresolved','abandonment-readback-unconfirmed');
}
