import {createHash} from 'node:crypto';
import {knowledgeEvidenceSubject} from './knowledge-editorial-evidence.mjs';

const MAX_OBSERVATION_AGE=24*60*60*1000;
const HASH=/^[a-f0-9]{64}$/u;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hex=value=>typeof value==='string'&&HASH.test(value);
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const instant=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))return null;
 const n=Date.parse(value);return Number.isFinite(n)&&new Date(n).toISOString()===value?n:null;
};
const clock=value=>Number.isSafeInteger(value)&&value>0&&value<=8_640_000_000_000_000-MAX_OBSERVATION_AGE;
function validIdentity(identity){
 if(!object(identity)||typeof identity.id!=='string'||!Number.isSafeInteger(identity.revision)||identity.revision<1||
  typeof identity.payload!=='string'||identity.payload.length>20000||!hex(identity.digest)||hash(identity.payload)!==identity.digest)return false;
 const subject=knowledgeEvidenceSubject(identity.id);
 const reviewed=instant(identity.reviewedAt),expires=instant(identity.reviewBy),release=instant(identity.publishAt??identity.reviewedAt);
 if(!subject||identity.sourceUrl!==subject.sourceUrl||identity.policyUrl!==subject.policyUrl||reviewed===null||release===null||expires===null||release<reviewed||release>=expires)return false;
 // The caller supplies payload from the canonical existing knowledge model.
 // Verify its exact identity and temporal/source bindings here, not a second card schema.
 try{
  const p=JSON.parse(identity.payload);
  return Array.isArray(p)&&p.length===15&&p[0]==='dlkt-knowledge-editorial-v1'&&p[1]==='knowledge'&&p[2]===identity.id&&p[3]===identity.revision&&
   Array.isArray(p[8])&&p[8][1]===identity.sourceUrl&&p[11]===identity.reviewedAt&&p[12]===(identity.publishAt??null)&&p[13]===identity.reviewBy&&
   Array.isArray(p[14])&&p[14][2]===identity.policyUrl;
 }catch{return false;}
}
function matchSignals(actual,keys){
 return object(actual)&&JSON.stringify(Object.keys(actual).sort())===JSON.stringify(keys)&&keys.every(key=>actual[key]===true);
}
function documentEvidence(value,url,keys){
 return object(value)&&value.url===url&&value.status===200&&value.complete===true&&
  ['text/html','application/xhtml+xml'].includes(value.contentType)&&value.state==='observed-for-review'&&value.reason===null&&
  value.canonicalObserved===true&&hex(value.bodySha256)&&hex(value.mainSha256)&&matchSignals(value.signals,keys);
}
/** Validate the receipt shape and exact candidate/source binding. A digest is not
 * authentication: receipts must be obtained from the controlled source probe,
 * and reviewed decisions only from independently reviewed committed records.
 */
function receiptSnapshot(identity,receipt,now,{fresh=false}={}){
 const spec=knowledgeEvidenceSubject(identity.id);
 if(!spec||!object(receipt)||receipt.id!==identity.id||receipt.revision!==identity.revision||receipt.candidateDigest!==identity.digest||
  receipt.sourceUrl!==spec.sourceUrl||receipt.policyUrl!==spec.policyUrl||receipt.activationAllowed!==false||receipt.state!=='observed-for-review'||receipt.reason!==null||
  receipt.semanticReviewRequired!==true||receipt.rightsReviewRequired!==true||receipt.translationReviewRequired!==true||
  !object(receipt.robots)||receipt.robots.url!==spec.origin+'/robots.txt'||receipt.robots.status!==200||receipt.robots.contentType!=='text/plain'||receipt.robots.complete!==true||!hex(receipt.robots.bodySha256)||
  receipt.access?.source?.allowed!==true||receipt.access?.policy?.allowed!==true||
  !documentEvidence(receipt.source,spec.sourceUrl,spec.sourceSignals)||!documentEvidence(receipt.terms,spec.policyUrl,spec.policySignals))return null;
 const observed=instant(receipt.observedAt);
 if(observed===null||observed>now||fresh&&now-observed>=MAX_OBSERVATION_AGE)return null;
 const fingerprints=Object.freeze({
  robots:receipt.robots.bodySha256,source:receipt.source.bodySha256,sourceMain:receipt.source.mainSha256,
  terms:receipt.terms.bodySha256,termsMain:receipt.terms.mainSha256,
 });
 const evidenceDigest=hash(JSON.stringify(['dlkt-knowledge-observation-v1',identity.id,identity.revision,identity.digest,spec.sourceUrl,spec.policyUrl,receipt.observedAt,Object.values(fingerprints)]));
 return Object.freeze({observed,fingerprints,evidenceDigest});
}
const hold=reason=>Object.freeze({state:'held',reason,validUntil:null});
const reviewRequired=reason=>Object.freeze({state:'review-required',reason,validUntil:null});
function compare(current,previous){
 if(!previous)return {state:'first-valid-observation',changed:[]};
 if(current.observed<previous.observed)return {state:'out-of-order',changed:[]};
 const changed=Object.keys(current.fingerprints).filter(key=>current.fingerprints[key]!==previous.fingerprints[key]);
 return {state:changed.length?'changed':'unchanged',changed};
}
function scopeDecision({scope,identity,current,history,priorReview,approval,now}){
 // Only compare against an explicitly supplied trusted prior review. A previous
 // source observation or an existing source licence is never this review.
 if(!object(approval)||!object(priorReview))return reviewRequired('existing-exact-approval-and-reviewed-baseline-required');
 if(approval.id!==identity.id||approval.revision!==identity.revision||approval.digest!==identity.digest)return reviewRequired('approval-identity-changed');
 if(scope==='feed'&&(approval.payload!==identity.payload||!hex(approval.digest)||hash(approval.payload)!==approval.digest))return reviewRequired('approval-payload-changed');
 if(priorReview.scope!==scope||priorReview.id!==identity.id||priorReview.revision!==identity.revision||priorReview.digest!==identity.digest||
  priorReview.decision!=='permitted'||priorReview.claims!=='verified'||priorReview.translations!=='verified'||priorReview.origin!=='verified'||
  priorReview.usefulness!=='verified'||priorReview.attribution!=='verified'||priorReview.exceptions!=='cleared')return reviewRequired('review-scope-or-verdict-invalid');
 const baseline=receiptSnapshot(identity,priorReview.observation,now),reviewed=instant(priorReview.reviewedAt),expires=instant(priorReview.expiresAt);
 const cardReviewed=instant(identity.reviewedAt),cardExpires=instant(identity.reviewBy),release=instant(identity.publishAt??identity.reviewedAt);
 if(!baseline||priorReview.evidenceDigest!==baseline.evidenceDigest||reviewed===null||expires===null||cardReviewed===null||cardExpires===null||release===null||
  reviewed<cardReviewed||reviewed<baseline.observed||reviewed-baseline.observed>=MAX_OBSERVATION_AGE||reviewed>now||expires<=reviewed||expires>cardExpires)return reviewRequired('review-evidence-or-window-invalid');
 if(now>=expires||now>=cardExpires)return hold('existing-review-expired');
 if(now<release)return hold('editorial-release-not-due');
 if(current.observed<baseline.observed)return hold('observation-precedes-reviewed-evidence');
 // Locate the exact reviewed receipt in the trusted complete chronological
 // history. A review cannot silently skip a later observation already known
 // at its review time. Any subsequent change remains latched, even A→B→A.
 const all=[...history,current];
 const index=all.findIndex(entry=>entry.evidenceDigest===baseline.evidenceDigest);
 if(index<0||all.some((entry,i)=>i>index&&entry.observed<=reviewed))return reviewRequired('review-not-bound-to-latest-known-evidence');
 if(all.slice(index+1).some(entry=>compare(entry,baseline).state!=='unchanged'))return reviewRequired('unresolved-observed-change');
 let validUntil=Math.min(expires,cardExpires,current.observed+MAX_OBSERVATION_AGE);
 if(scope==='standalone'){
  if(!clock(approval.reviewedAt)||!clock(approval.expiresAt)||approval.reviewedAt<cardReviewed||approval.reviewedAt>now||approval.expiresAt<=approval.reviewedAt||approval.expiresAt<=now)return hold('standalone-admission-window-invalid');
  validUntil=Math.min(validUntil,approval.expiresAt);
 }
 if(now>=validUntil)return hold('revalidation-window-expired');
 return Object.freeze({state:'reuse-eligible',reason:'unchanged-exact-evidence-within-existing-authorization',validUntil:new Date(validUntil).toISOString()});
}
/** Advisory, read-only assessment. The fixed-baseline mode compares evidence
 * only and cannot yield reuse-eligible even if approval arguments are present.
 * The history mode is a pure planner for an authoritative, complete ordered
 * history supplied by a trusted caller; it cannot authenticate that history or
 * prove omitted observations did not occur. No such persistent trusted reader
 * exists in the pilot. Never substitute a fixed baseline for that history.
 * No mode authorizes publication, creates approvals or extends review windows.
 */
export function assessKnowledgeRevalidation({identity,observation,previousObservation=null,trustedHistory=null,feedApproval=null,standaloneApproval=null,feedReview=null,standaloneReview=null,now}){
 const mode=trustedHistory===null?'comparison-only':'trusted-history-advisory';
 const denied=reason=>Object.freeze({mode,activationAllowed:false,comparison:{state:'unavailable',changed:[]},feed:hold(reason),standalone:hold(reason),evidenceDigest:null});
 if(!clock(now)||!validIdentity(identity))return denied('invalid-candidate-or-clock');
 const current=receiptSnapshot(identity,observation,now,{fresh:true});
 if(!current)return denied('current-evidence-invalid-or-stale');
 const previous=previousObservation===null?null:receiptSnapshot(identity,previousObservation,now);
 if(previousObservation!==null&&!previous)return denied('previous-evidence-binding-invalid');
 let history=[],latest=previous;
 if(trustedHistory!==null){
  // The trusted store must provide every observation from the review baseline
  // through the last observation, including failed/denied attempts. A missing,
  // held or malformed record cannot be treated as a successful history.
  if(!Array.isArray(trustedHistory)||trustedHistory.length===0||trustedHistory.length>256)return denied('trusted-history-invalid');
  for(const entry of trustedHistory){
   const snapshot=receiptSnapshot(identity,entry,now);
   if(!snapshot||history.length&&snapshot.observed<=history[history.length-1].observed)return denied('trusted-history-invalid-or-unresolved-failure');
   history.push(snapshot);
  }
  latest=history[history.length-1];
  if(previous&&previous.evidenceDigest!==latest.evidenceDigest)return denied('previous-observation-not-history-tip');
  if(current.observed<=latest.observed)return denied('out-of-order-observation');
 }
 const comparison=compare(current,latest);
 if(comparison.state==='out-of-order')return denied('out-of-order-observation');
 const feed=mode==='comparison-only'?reviewRequired('trusted-observation-history-required'):
  comparison.state==='changed'?reviewRequired('latest-observed-source-or-terms-changed'):
  scopeDecision({scope:'feed',identity,current,history,priorReview:feedReview,approval:feedApproval,now});
 const share=feed.state==='reuse-eligible'?scopeDecision({scope:'standalone',identity,current,history,priorReview:standaloneReview,approval:standaloneApproval,now}):reviewRequired('feed-authorization-not-reusable');
 const standalone=share.state==='reuse-eligible'?Object.freeze({...share,validUntil:new Date(Math.min(Date.parse(feed.validUntil),Date.parse(share.validUntil))).toISOString()}):share;
 return Object.freeze({mode,activationAllowed:false,comparison:Object.freeze({...comparison,changed:Object.freeze(comparison.changed)}),feed,standalone,evidenceDigest:current.evidenceDigest});
}
/** Actual pilot entry: deliberately cannot accept approval/history arguments. */
export function compareKnowledgeObservations({identity,observation,baselineObservation,now}){
 return assessKnowledgeRevalidation({identity,observation,previousObservation:baselineObservation,now});
}
