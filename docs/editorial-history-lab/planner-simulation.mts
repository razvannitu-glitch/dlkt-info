// Disposable laboratory only. This is a read-only adapter for the existing
// canonical planner, using a distinct synthetic identity and controlled receipts.
// The injected planner and reader are trusted test-harness functions, not API inputs.
// Never import this module into the public runtime or use its output as authority.
import {createHash} from 'node:crypto';
import {observationDigest,type Candidate} from './transaction-adapter.mjs';

export const SIMULATION_MARKER='DLKT SYNTHETIC PLANNER SIMULATION';
export const SIMULATION_REVISION=1000001;
const SUBJECT='dlkt-elsewhere-nsw-fuelcheck';
const SOURCE='https://www.nsw.gov.au/legal-and-justice/consumer-rights-and-protection/advertising-product-packaging-and-pricing-laws/fuel-pricing-discounts-and-signage/check-fuel-prices';
const POLICY='https://www.nsw.gov.au/nsw-government/about-website/copyright';
const SCENARIOS=['scope','drift','held','expiry','boundary'] as const;
const DAY=86400000;
type Scope='feed'|'standalone';
type Dict=Record<string,unknown>;
type Hashes=readonly [string,string,string,string,string];
export interface SimulationIdentity {
  readonly id:string;readonly revision:number;readonly digest:string;readonly payload:string;
  readonly sourceUrl:string;readonly policyUrl:string;readonly reviewedAt:string;readonly reviewBy:string;
}
export interface SimulationReceipt {
  readonly attemptId:string;
  readonly kind:'controlled-synthetic-planner-receipt';
  readonly observation:unknown;
}
export interface SimulationInput {
  readonly candidate:Candidate;readonly identity:SimulationIdentity;
  readonly receipts:readonly SimulationReceipt[];
  readonly read:(candidate:Candidate)=>Promise<unknown>;
  readonly planner:(input:Dict)=>unknown;
}
type ScopeState='would-reuse-in-lab'|'held'|'review-required';
interface Advice {readonly state:ScopeState;readonly reason:string;readonly validUntil:string|null}
interface SimulationResult {
  readonly kind:'synthetic-planner-simulation-not-authority';
  readonly feed:Advice;readonly standalone:Advice;
  readonly activationAllowed:false;readonly approvalReusable:false;
}
interface CheckedRow {
  readonly attemptId:string;readonly sequence:number;readonly started:number;readonly finished:number;
  readonly observed:number;readonly evidenceDigest:string;readonly plannerDigest:string;readonly receipt:Dict;
}
interface ReviewBinding {
  readonly reviewId:string;readonly verdict:'lab-held'|'lab-permitted';
  readonly reviewed:number;readonly expires:number|null;readonly row:CheckedRow;
  readonly capacityHeld:boolean;
}

const object=(v:unknown):v is Dict=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(v);
const integer=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const epoch=(v:unknown):number|null=>{
  if(typeof v!=='string')return null;
  const n=Date.parse(v);return Number.isSafeInteger(n)&&n>=0?n:null;
};
const canonical=(v:unknown):v is string=>{
  const n=epoch(v);
  return typeof v==='string'&&n!==null&&new Date(n).toISOString()===v;
};
const hashes=(v:unknown):v is Hashes=>Array.isArray(v)&&v.length===5&&[0,1,2,3,4].every(i=>Object.hasOwn(v,i)&&hex(v[i]));
const sha=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex');
const advice=(state:ScopeState,reason:string,validUntil:string|null=null):Advice=>Object.freeze({state,reason,validUntil});
const result=(feed:Advice,standalone:Advice):SimulationResult=>Object.freeze({kind:'synthetic-planner-simulation-not-authority',feed,standalone,activationAllowed:false,approvalReusable:false});
const deny=(reason:string)=>result(advice('held',reason),advice('held',reason));

function validSubject(c:Candidate,i:SimulationIdentity):boolean {
  const name=SCENARIOS.find(s=>c.id==='lab-planner-'+s);
  if(!name||c.revision!==SIMULATION_REVISION||i.revision!==SIMULATION_REVISION||i.id!==SUBJECT||
    !hex(c.digest)||c.digest!==i.digest||c.sourceUrl!=='https://example.invalid/source/planner-'+name||
    c.policyUrl!=='https://example.invalid/policy/planner-'+name||i.sourceUrl!==SOURCE||i.policyUrl!==POLICY||
    !canonical(i.reviewedAt)||!canonical(i.reviewBy)||typeof i.payload!=='string'||i.payload.length>20000||
    sha(i.payload)!==i.digest)return false;
  const from=Date.parse(i.reviewedAt),until=Date.parse(i.reviewBy);
  if(until<=from||until-from>366*DAY)return false;
  const p:unknown=JSON.parse(i.payload);
  if(!Array.isArray(p)||p.length!==15||p[0]!=='dlkt-knowledge-editorial-v1'||p[1]!=='knowledge'||
    p[2]!==SUBJECT||p[3]!==SIMULATION_REVISION||p[4]!=='04000000'||
    !Array.isArray(p[8])||p[8][1]!==SOURCE||p[11]!==i.reviewedAt||p[12]!==null||p[13]!==i.reviewBy||
    !Array.isArray(p[14])||p[14][2]!==POLICY||!Array.isArray(p[10])||p[10].length!==3)return false;
  return ['en','ro','it'].every((lang,index)=>{
    const row:unknown=p[10][index];
    return Array.isArray(row)&&row.length===5&&row[0]===lang&&row.slice(1).every(v=>v===SIMULATION_MARKER);
  });
}
function receiptHashes(r:Dict):Hashes|null{
  const {robots,source,terms}=r;
  if(!object(robots)||!object(source)||!object(terms))return null;
  const f=[robots.bodySha256,source.bodySha256,source.mainSha256,terms.bodySha256,terms.mainSha256];
  return hashes(f)?f:null;
}
function checkedRows(h:Dict,c:Candidate,i:SimulationIdentity,packets:readonly SimulationReceipt[],now:number,planner:SimulationInput['planner']):CheckedRow[]|null {
  if(h.activationAllowed!==false||h.cardId!==c.id||h.revision!==c.revision||h.digest!==c.digest||
    h.sourceUrl!==c.sourceUrl||h.policyUrl!==c.policyUrl||h.state!=='complete-observation-prefix'||
    !integer(h.tip,1,255)||!Array.isArray(h.attempts)||h.attempts.length!==h.tip||
    !Array.isArray(packets)||packets.length!==h.tip)return null;
  const map=new Map<string,Dict>();
  for(const p of packets){
    if(!object(p)||p.kind!=='controlled-synthetic-planner-receipt'||!uuid(p.attemptId)||
      map.has(p.attemptId)||!object(p.observation))return null;
    // Snapshot controlled test inputs rather than exposing mutable receipts.
    const raw=JSON.stringify(p.observation);
    if(raw.length>64000)return null;
    const copy:unknown=JSON.parse(raw);
    if(!object(copy))return null;
    map.set(p.attemptId,copy);
  }
  const rows:CheckedRow[]=[];const seen=new Set<string>();
  for(let n=0;n<h.attempts.length;n++){
    const a:unknown=h.attempts[n];
    if(!object(a)||a.sequence!==n+1||!uuid(a.attemptId)||seen.has(a.attemptId)||
      a.outcome!=='observed'||a.reason!==null||!hashes(a.fingerprints)||!hex(a.evidenceDigest))return null;
    seen.add(a.attemptId);
    const started=epoch(a.startedAt),finished=epoch(a.finishedAt),observed=epoch(a.observedAt),attested=epoch(a.attestedAt);
    const prev=rows.at(-1),r=map.get(a.attemptId);
    if(started===null||finished===null||observed===null||attested===null||
      started>observed||observed>attested||attested>finished||finished>now||
      (prev!==undefined&&(started<prev.finished||observed<=prev.observed))||
      !r||r.id!==i.id||r.revision!==i.revision||r.candidateDigest!==i.digest||
      r.sourceUrl!==i.sourceUrl||r.policyUrl!==i.policyUrl||r.observedAt!==new Date(observed).toISOString()||
      r.activationAllowed!==false)return null;
    const f=receiptHashes(r),stamp=new Date(observed).toISOString(),storedFingerprints=a.fingerprints;
    if(!f||!f.every((x,j)=>x===storedFingerprints[j])||observationDigest(c,stamp,f)!==a.evidenceDigest)return null;
    const plannerDigest=sha(JSON.stringify(['dlkt-knowledge-observation-v1',i.id,i.revision,i.digest,i.sourceUrl,i.policyUrl,stamp,f]));
    // Reuse the canonical planner's own receipt validator. The per-row
    // comparison is historical to the synthetic observation, not a live check.
    const proof=planner({identity:i,observation:r,previousObservation:null,now:observed});
    if(!object(proof)||proof.activationAllowed!==false||proof.mode!=='comparison-only'||
      proof.evidenceDigest!==plannerDigest||!object(proof.comparison)||proof.comparison.state!=='first-valid-observation'||
      !object(proof.feed)||proof.feed.state!=='review-required'||
      !object(proof.standalone)||proof.standalone.state!=='review-required')return null;
    rows.push({attemptId:a.attemptId,sequence:n+1,started,finished,observed,evidenceDigest:a.evidenceDigest,plannerDigest,receipt:r});
  }
  return rows;
}
function checkedReview(scopes:Dict,scope:Scope,rows:readonly CheckedRow[],i:SimulationIdentity,now:number,snapshotClock:number):ReviewBinding|null|false {
  const s=scopes[scope];
  if(!object(s)||!integer(s.count,0,256))return false;
  if(s.count===0)return s.latest===null&&s.state==='no-review'?null:false;
  const r=s.latest;
  if(!object(r)||!uuid(r.reviewId)||r.scope!==scope||!integer(r.sequence,1,rows.length)||
    r.reviewerPrincipal!=='dlkt_history_ci_reviewer'||
    (r.verdict!=='lab-held'&&r.verdict!=='lab-permitted'))return false;
  const row=rows[r.sequence-1],reviewed=epoch(r.reviewedAt),expires=epoch(r.expiresAt);
  const next=rows[r.sequence];
  if(!row||r.attemptId!==row.attemptId||r.evidenceDigest!==row.evidenceDigest||reviewed===null||
    reviewed<row.finished||reviewed>now||(next!==undefined&&next.started<reviewed))return false;
  const capacityHeld=s.count===256;
  if(r.verdict==='lab-held'){
    if(r.expiresAt!==null||s.state!==(capacityHeld?'review-capacity-held':'held'))return false;
  }else if(expires===null||expires<=reviewed||reviewed-row.observed>=DAY||
    expires>row.observed+DAY||expires>Date.parse(i.reviewBy)||reviewed<Date.parse(i.reviewedAt)||
    s.state!==(capacityHeld?'review-capacity-held':snapshotClock>=expires?'expired':r.sequence===rows.length?'recorded-not-authority':'new-observation-review-required'))return false;
  return {reviewId:r.reviewId,verdict:r.verdict,reviewed,expires,row,capacityHeld};
}
function simulatedReview(i:SimulationIdentity,scope:Scope,r:ReviewBinding|null):Dict|null{
  if(r===null||r.capacityHeld||r.verdict!=='lab-permitted'||r.expires===null)return null;
  // These verdict fields represent ONLY the hypothetical test scenario.
  // They do not come from real editorial review or prove claim completeness.
  return {scope,id:i.id,revision:i.revision,digest:i.digest,decision:'permitted',
    claims:'verified',translations:'verified',origin:'verified',usefulness:'verified',
    attribution:'verified',exceptions:'cleared',observation:r.row.receipt,
    evidenceDigest:r.row.plannerDigest,reviewedAt:new Date(r.reviewed).toISOString(),expiresAt:new Date(r.expires).toISOString()};
}
function mappedAdvice(value:unknown,r:ReviewBinding|null,now:number):Advice|null{
  if(!object(value)||typeof value.reason!=='string'||value.reason.length>160)return null;
  if(r?.capacityHeld)return advice('held','synthetic-scope-review-capacity-held');
  if(r?.verdict==='lab-held')return advice('held','synthetic-scope-revoked');
  if(value.state==='held'||value.state==='review-required')return value.validUntil===null?advice(value.state,value.reason):null;
  if(value.state!=='reuse-eligible'||!canonical(value.validUntil)||r===null||r.verdict!=='lab-permitted'||r.expires===null)return null;
  const until=Date.parse(value.validUntil);
  return until>now&&until<=r.expires?advice('would-reuse-in-lab',value.reason,value.validUntil):null;
}
/** Consumes one fresh locked snapshot and every matching controlled receipt.
 * It does not repair or truncate failed history, extend review windows, accept
 * historical evidence as fresh, or authorize any runtime operation.
 */
export async function simulateStoredRevalidation(input:SimulationInput):Promise<SimulationResult>{
  try{
    const c=Object.freeze({...input.candidate}),i=Object.freeze({...input.identity});
    if(!validSubject(c,i))return deny('simulation-identity-invalid');
    const s=await input.read(c),wall=Date.now();
    if(!object(s)||s.kind!=='synthetic-review-snapshot-not-authority'||s.state!=='metadata-only'||
      s.activationAllowed!==false||s.approvalReusable!==false||!object(s.history)||!object(s.scopes))
      return deny('snapshot-unavailable-or-integrity-held');
    const clock=epoch(s.checkedAt);
    if(clock===null||clock>wall+1000||wall-clock>10000)return deny('snapshot-clock-invalid-or-stale');
    const now=Math.max(clock,wall);
    const rows=checkedRows(s.history,c,i,input.receipts,now,input.planner);
    if(rows===null)return deny('history-or-receipt-binding-incomplete');
    if(rows.length<2)return result(advice('review-required','new-observation-required'),advice('review-required','new-observation-required'));
    const feed=checkedReview(s.scopes,'feed',rows,i,now,clock),standalone=checkedReview(s.scopes,'standalone',rows,i,now,clock);
    if(feed===false||standalone===false||(feed&&standalone&&feed.reviewId===standalone.reviewId))return deny('scope-review-binding-invalid');
    const last=rows.at(-1)!,prior=rows.slice(0,-1).map(r=>r.receipt);
    const feedReview=simulatedReview(i,'feed',feed),standaloneReview=simulatedReview(i,'standalone',standalone);
    const approval={id:i.id,revision:i.revision,digest:i.digest};
    const plan=input.planner({identity:i,observation:last.receipt,previousObservation:prior.at(-1),
      trustedHistory:prior,now,feedReview,standaloneReview,
      feedApproval:feedReview===null?null:{...approval,payload:i.payload},
      standaloneApproval:standaloneReview===null||standalone===null?null:{...approval,reviewedAt:standalone.reviewed,expiresAt:standalone.expires}});
    if(!object(plan)||plan.mode!=='trusted-history-advisory'||plan.activationAllowed!==false)return deny('planner-response-invalid');
    const a=mappedAdvice(plan.feed,feed,now),b=mappedAdvice(plan.standalone,standalone,now);
    if(a===null||b===null||(b.state==='would-reuse-in-lab'&&(a.state!=='would-reuse-in-lab'||
      Date.parse(b.validUntil!)>Date.parse(a.validUntil!))))return deny('planner-scope-inconsistent');
    // A held feed scope cannot be converted into a share permission.
    return result(a,b);
  }catch{return deny('simulation-failed-closed');}
}
