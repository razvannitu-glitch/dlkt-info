import {stageSourceCandidate,worldSourceAtlas} from './world-source-atlas.js';
import type {AtlasVertical,SourceAtlasEntry} from './world-source-atlas.js';

/** Research metadata only. These are not connected providers or approved feeds. */
export type DiscoveryIndex='gdelt'|'media-cloud'|'openalex'|'reliefweb';
export type DiscoveryRejectionReason='invalid-record'|'untrusted-index'|'invalid-source'|'already-indexed'|'duplicate-candidate'|'stale-observation';
export interface DiscoveryRejection {readonly position:number;readonly reason:DiscoveryRejectionReason}
export interface DiscoveryProposal {
 readonly candidate:SourceAtlasEntry;
 readonly discoveryIndex:DiscoveryIndex;
 readonly recordReference:string;
 readonly observedAt:string;
 readonly provenance:'unverified-index-metadata';
 readonly admission:'manual-review-only';
}
export interface DiscoveryBatch {
 readonly proposals:readonly DiscoveryProposal[];
 readonly rejected:readonly DiscoveryRejection[];
 readonly received:number;
}

const DAY=86_400_000;
const MAX_RECORDS=200;
const SOURCES:Readonly<Record<DiscoveryIndex,Readonly<{origins:readonly string[];vertical:AtlasVertical}>>>=Object.freeze({
 gdelt:{origins:['https://gdeltproject.org','https://www.gdeltproject.org','https://data.gdeltproject.org'],vertical:'news'},
 'media-cloud':{origins:['https://mediacloud.org','https://www.mediacloud.org'],vertical:'news'},
 openalex:{origins:['https://openalex.org','https://api.openalex.org'],vertical:'science'},
 reliefweb:{origins:['https://reliefweb.int','https://api.reliefweb.int'],vertical:'humanitarian'},
});
const isRecord=(input:unknown):input is Record<string,unknown>=>typeof input==='object'&&input!==null&&!Array.isArray(input);
const canonicalInstant=(input:unknown):number|null=>{
 if(typeof input!=='string'||input.length>35||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input))return null;
 const timestamp=Date.parse(input);
 return Number.isFinite(timestamp)&&new Date(timestamp).toISOString()===input?timestamp:null;
};
const hostKey=(origin:string):string=>new URL(origin).hostname.replace(/^www\./u,'');
const recordReference=(input:unknown,index:DiscoveryIndex):string|null=>{
 if(typeof input!=='string'||input.length>2048||/[\u0000-\u0020\u007f<>\\]/u.test(input))return null;
 try{
  const url=new URL(input);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!SOURCES[index].origins.includes(url.origin))return null;
  // Keep an inspectable primary record path, never user tokens in query/fragment.
  return url.origin+url.pathname;
 }catch{return null;}
};
/**
 * Stage bounded, externally observed directory records without fetching anything.
 * Index identity is *claimed*, never authenticated by this function. A proposal
 * cannot become a sourceRequest or enter news selection without separate review.
 */
export function qualifyDiscoveryBatch(input:unknown,nowInput:unknown):DiscoveryBatch {
 const now=canonicalInstant(nowInput);
 if(now===null||!Array.isArray(input)||input.length>MAX_RECORDS)throw Error('ICEO_DISCOVERY_BATCH_INVALID');
 const inventory=new Set(worldSourceAtlas().map(entry=>hostKey(entry.origin)));
 const seen=new Set<string>();
 const proposals:DiscoveryProposal[]=[];
 const rejected:DiscoveryRejection[]=[];
 for(let position=0;position<input.length;position++){
  const item:unknown=input[position];
  if(!isRecord(item)||typeof item.index!=='string'||!Object.hasOwn(SOURCES,item.index)){
   rejected.push(Object.freeze({position,reason:'invalid-record'}));continue;
  }
  const index=item.index as DiscoveryIndex;
  const reference=recordReference(item.recordUrl,index);
  if(reference===null){rejected.push(Object.freeze({position,reason:'untrusted-index'}));continue;}
  const observed=canonicalInstant(item.observedAt);
  if(observed===null||observed>now||now-observed>30*DAY){
   rejected.push(Object.freeze({position,reason:'stale-observation'}));continue;
  }
  const candidate=stageSourceCandidate(item.sourceUrl,item.sourceName);
  if(candidate===null){
   let previouslyListed=false;
   if(typeof item.sourceUrl==='string'&&item.sourceUrl.length<=1000){
    try{const url=new URL(item.sourceUrl);previouslyListed=url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&inventory.has(hostKey(url.origin));}
    catch{/* Invalid and unsafe URLs are not usable sources. */}
   }
   rejected.push(Object.freeze({position,reason:previouslyListed?'already-indexed':'invalid-source'}));continue;
  }
  const key=hostKey(candidate.origin);
  if(inventory.has(key)){
   rejected.push(Object.freeze({position,reason:'already-indexed'}));continue;
  }
  if(seen.has(key)){
   rejected.push(Object.freeze({position,reason:'duplicate-candidate'}));continue;
  }
  seen.add(key);
  proposals.push(Object.freeze({
   candidate:Object.freeze({...candidate,vertical:SOURCES[index].vertical,scope:'unknown'}),
   discoveryIndex:index,recordReference:reference,observedAt:item.observedAt as string,
   provenance:'unverified-index-metadata',admission:'manual-review-only',
  }));
 }
 return Object.freeze({proposals:Object.freeze(proposals),rejected:Object.freeze(rejected),received:input.length});
}

export type ReviewDisposition='blocked'|'complete-for-human-review';
export type ReviewIssue='invalid-candidate'|'missing-evidence'|'identity-unverified'|'terms-unreviewed'|'robots-unreviewed'|'source-origin-mismatch'|'robots-origin-mismatch'|'terms-not-permitted'|'robots-not-permitted'|'invalid-review-window';
export interface ReviewAssessment {readonly disposition:ReviewDisposition;readonly issues:readonly ReviewIssue[];readonly activationAllowed:false}
const httpsEvidence=(input:unknown):boolean=>{
 if(typeof input!=='string'||input.length>2048||/[\u0000-\u0020\u007f<>\\]/u.test(input))return false;
 try{const value=new URL(input);return value.protocol==='https:'&&!value.username&&!value.password&&!value.port&&value.hostname.includes('.');}
 catch{return false;}
};
const exactReviewOrigin=(input:unknown):string|null=>{
 if(typeof input!=='string'||!httpsEvidence(input))return null;
 try{const origin=new URL(input).origin;return input===origin?origin:null;}
 catch{return null;}
};
/**
 * Reuse the same global qualification path instead of maintaining a second
 * candidate validator. In particular, each discovery index owns its vertical:
 * OpenAlex science and ReliefWeb humanitarian must not be reduced to news.
 */
function reviewedCandidateOrigin(proposal:unknown,nowInput:unknown):string|null {
 if(!isRecord(proposal)||!isRecord(proposal.candidate))return null;
 const candidate=proposal.candidate;
 const reference=qualifyDiscoveryBatch([{
  index:proposal.discoveryIndex,recordUrl:proposal.recordReference,observedAt:proposal.observedAt,
  sourceUrl:candidate.origin,sourceName:candidate.name,
 }],nowInput).proposals[0];
 if(reference===undefined)return null;
 const candidateKeys=['id','name','origin','vertical','scope','countryCode','status','acquisition','rights'] as const;
 const proposalKeys=['discoveryIndex','recordReference','observedAt','provenance','admission'] as const;
 if(Object.keys(candidate).length!==candidateKeys.length||candidateKeys.some(key=>candidate[key]!==reference.candidate[key])||
    Object.keys(proposal).length!==proposalKeys.length+1||proposalKeys.some(key=>proposal[key]!==reference[key]))return null;
 return reference.candidate.origin;
}
/**
 * A reviewed restriction is not a permitted use. The same explicit decisions
 * and exact-origin binding apply to every candidate, regardless of country or
 * language. These remain reviewer assertions, not authenticated licensing proof.
 * A complete evidence checklist still cannot activate a feed or publish content.
 */
export function assessDiscoveryReview(proposal:unknown,evidence:unknown,nowInput:unknown):ReviewAssessment {
 const issues:ReviewIssue[]=[];
 const now=canonicalInstant(nowInput);
 if(now===null)throw Error('ICEO_DISCOVERY_REVIEW_CLOCK_INVALID');
 const origin=reviewedCandidateOrigin(proposal,nowInput);
 if(origin===null)issues.push('invalid-candidate');
 const review=isRecord(evidence)?evidence:null;
 if(review===null||typeof review.reviewer!=='string'||review.reviewer.trim().length<2||review.reviewer.length>120||
    !httpsEvidence(review.termsUrl)||!httpsEvidence(review.rightsEvidenceUrl)||
    (typeof review.rightsBasis!=='string'||!['publisher-terms','explicit-license','written-permission'].includes(review.rightsBasis))||
    (typeof review.requestedUse!=='string'||!['metadata-links','licensed-excerpt'].includes(review.requestedUse))){
  issues.push('missing-evidence');
 }
 // Explicit publisher binding also permits an external license/permission
 // document to be cited without confusing that document's host with the source.
 if(origin===null||exactReviewOrigin(review?.sourceOrigin)!==origin)issues.push('source-origin-mismatch');
 if(origin===null||review?.robotsUrl!==origin+'/robots.txt')issues.push('robots-origin-mismatch');
 if(review?.publisherIdentityVerified!==true)issues.push('identity-unverified');
 if(review?.termsReviewed!==true)issues.push('terms-unreviewed');
 if(review?.robotsReviewed!==true)issues.push('robots-unreviewed');
 if(review?.termsDecision!=='permitted')issues.push('terms-not-permitted');
 if(review?.robotsDecision!=='permitted')issues.push('robots-not-permitted');
 const checked=canonicalInstant(review?.checkedAt);
 const until=canonicalInstant(review?.reviewBy);
 if(checked===null||until===null||checked>now||until<=now||until-checked>90*DAY)issues.push('invalid-review-window');
 return Object.freeze({disposition:issues.length===0?'complete-for-human-review':'blocked',issues:Object.freeze(issues),activationAllowed:false});
}
