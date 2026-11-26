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
function scopeDecision({scope,identity,current,priorReview,approval,now}){
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
  reviewed<cardReviewed||reviewed<baseline.observed||reviewed>now||expires<=reviewed||expires>cardExpires)return reviewRequired('review-evidence-or-window-invalid');
 if(now>=expires||now>=cardExpires)return hold('existing-review-expired');
 if(now<release)return hold('editorial-release-not-due');
 if(current.observed<baseline.observed)return hold('observation-precedes-reviewed-evidence');
 const comparison=compare(current,baseline);
 if(comparison.state!=='unchanged')return reviewRequired('reviewed-source-or-terms-changed');
 let validUntil=Math.min(expires,cardExpires,current.observed+MAX_OBSERVATION_AGE);
 if(scope==='standalone'){
  if(!clock(approval.reviewedAt)||!clock(approval.expiresAt)||approval.reviewedAt<cardReviewed||approval.reviewedAt>now||approval.expiresAt<=approval.reviewedAt||approval.expiresAt<=now)return hold('standalone-admission-window-invalid');
  validUntil=Math.min(validUntil,approval.expiresAt);
 }
 if(now>=validUntil)return hold('revalidation-window-expired');
 return Object.freeze({state:'reuse-eligible',reason:'unchanged-exact-evidence-within-existing-authorization',validUntil:new Date(validUntil).toISOString()});
}
/** Advisory, read-only revalidation of existing permissions. This function
 * cannot authorize publication, create an approval, extend a review window,
 * write a registry, or convert an observed source into a reviewed decision.
 * The trusted review records and existing scope-specific approvals must come
 * from the independently reviewed repository, never a fetched page or visitor.
 */
export function assessKnowledgeRevalidation({identity,observation,previousObservation=null,feedApproval=null,standaloneApproval=null,feedReview=null,standaloneReview=null,now}){
 const denied=reason=>({activationAllowed:false,comparison:{state:'unavailable',changed:[]},feed:hold(reason),standalone:hold(reason),evidenceDigest:null});
 if(!clock(now)||!validIdentity(identity))return denied('invalid-candidate-or-clock');
 const current=receiptSnapshot(identity,observation,now,{fresh:true});
 if(!current)return denied('current-evidence-invalid-or-stale');
 const previous=previousObservation===null?null:receiptSnapshot(identity,previousObservation,now);
 if(previousObservation!==null&&!previous)return denied('previous-evidence-binding-invalid');
 const comparison=compare(current,previous);
 if(comparison.state==='out-of-order')return denied('out-of-order-observation');
 const feed=scopeDecision({scope:'feed',identity,current,priorReview:feedReview,approval:feedApproval,now});
 // Standalone distribution must not imply bypassing the existing feed approval.
 const standalone=feed.state==='reuse-eligible'?scopeDecision({scope:'standalone',identity,current,priorReview:standaloneReview,approval:standaloneApproval,now}):reviewRequired('feed-authorization-not-reusable');
 return Object.freeze({activationAllowed:false,comparison:Object.freeze({...comparison,changed:Object.freeze(comparison.changed)}),feed,standalone,evidenceDigest:current.evidenceDigest});
}
