import {createHash} from 'node:crypto';
import {parseDocument,DomUtils} from 'htmlparser2';
import {knowledgeClaimAnchors,observeClaimAnchors} from './knowledge-claim-evidence.mjs';

const NSW='dlkt-elsewhere-nsw-fuelcheck',NZ='dlkt-elsewhere-nz-unit-pricing';
const subjects=Object.freeze({
 [NSW]:Object.freeze({origin:'https://www.nsw.gov.au',sourceUrl:"https://www.nsw.gov.au/legal-and-justice/consumer-rights-and-protection/advertising-product-packaging-and-pricing-laws/fuel-pricing-discounts-and-signage/check-fuel-prices",policyUrl:"https://www.nsw.gov.au/nsw-government/about-website/copyright",sourceTitle:'check fuel prices',policyTitle:'copyright',sourceSignals:Object.freeze({
  service:/\bfuelcheck\b/iu,free:/\bfree\b/iu,pricing:/\bfuel prices\b/iu,realTime:/\breal[- ]time\b/iu,driving:/\bnever use your phone while driving\b/iu,
 }),policySignals:Object.freeze({
  licence:/\bcreative commons attribution 4\.0\b/iu,credit:/\bstate of new south wales\b/iu,exceptions:/\bexcept as noted\b/iu,thirdParty:/\bthird[- ]party material\b/iu,marks:/\blogos\b/iu,
 })}),
 [NZ]:Object.freeze({origin:'https://www.comcom.govt.nz',sourceUrl:"https://www.comcom.govt.nz/regulated-industries/grocery/information-for-consumers/",policyUrl:"https://www.comcom.govt.nz/using-our-website/copyright/",sourceTitle:'information for consumers',policyTitle:'copyright',sourceSignals:Object.freeze({
  unitPricing:/\bunit pricing regulations\b/iu,retailerScope:/\bcertain grocery retailers\b/iu,display:/\bdisplay the unit price\b/iu,exception:/\bnot every grocery retailer\b/iu,comparison:/\bcompare products\b/iu,
 }),policySignals:Object.freeze({
  licence:/\bcreative commons attribution 4\.0\b/iu,credit:/\bcommerce commission\b/iu,exceptions:/\bunless indicated otherwise\b/iu,thirdParty:/\bthird part(?:y|ies)\b/iu,marks:/\blogos\b/iu,imagery:/\bimagery\b/iu,
 })}),
});
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
const normalize=value=>value.replace(/[\u200B-\u200D\uFEFF]/gu,'').replace(/\s+/gu,' ').trim();
const safeUrl=(value,origin)=>{
 if(typeof value!=='string'||value.length>1000||/[\u0000-\u0020\u007f\\]/u.test(value))return false;
 try{const u=new URL(value);return u.protocol==='https:'&&u.origin===origin&&u.href===value&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.pathname.length>1;}catch{return false;}
};
export function knowledgeEvidenceSubject(id){
 if(typeof id!=='string'||!Object.hasOwn(subjects,id))return null;
 const spec=subjects[id];return Object.freeze({origin:spec.origin,sourceUrl:spec.sourceUrl,policyUrl:spec.policyUrl,sourceSignals:Object.freeze(Object.keys(spec.sourceSignals).sort()),policySignals:Object.freeze(Object.keys(spec.policySignals).sort())});
}
const requestMetadata=response=>({url:response?.url??null,status:response?.status??null,contentType:response?.contentType??null,complete:response?.ok===true&&response.partial===false,bodySha256:typeof response?.text==='string'&&response.ok===true&&response.partial===false?sha(response.text):null});
function visibleText(root){
 const pending=[root],parts=[];let nodes=0;
 while(pending.length){
  const node=pending.pop();if(++nodes>50000)throw Error('KNOWLEDGE_EVIDENCE_DOM_LIMIT');
  if(node.type==='text'){parts.push(node.data);continue;}
  if(['script','style','template','noscript','svg','nav','footer'].includes(node.name)||node.attribs?.['aria-hidden']==='true'||Object.hasOwn(node.attribs??{},'hidden')||/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/iu.test(node.attribs?.style??''))continue;
  if(node.children)for(let i=node.children.length-1;i>=0;i--)pending.push(node.children[i]);
 }
 return normalize(parts.join(' '));
}
function inspectPage(response,url,title,signals,anchors){
 const metadata=requestMetadata(response);
 const reject=reason=>({...metadata,state:'held',reason});
 if(response?.url!==url||response.status!==200||response.ok!==true||response.partial!==false||!['text/html','application/xhtml+xml'].includes(response.contentType)||typeof response.text!=='string')return reject('page-unavailable-or-incomplete');
 if(Buffer.byteLength(response.text,'utf8')>1_048_576||metadata.bodySha256!==response.sha256)return reject('page-digest-or-size-mismatch');
 try{
  const doc=parseDocument(response.text,{decodeEntities:true});
  const mains=DomUtils.getElementsByTagName('main',doc,true);
  if(mains.length!==1)return reject('ambiguous-main-content');
  const main=mains[0],headings=DomUtils.getElementsByTagName('h1',main,true).map(visibleText);
  if(headings.length!==1||headings[0].toLowerCase()!==title)return reject('unexpected-page-heading');
  const canonicals=DomUtils.getElementsByTagName('link',doc,true).filter(n=>(n.attribs.rel??'').toLowerCase().split(/\s+/u).includes('canonical'));
  if(canonicals.length!==1||canonicals.some(n=>{try{return new URL(n.attribs.href??'',url).href!==url;}catch{return true;}}))return reject('canonical-url-mismatch');
  const text=visibleText(main),observations=Object.fromEntries(Object.entries(signals).map(([name,re])=>[name,re.test(text)]));
  const complete=Object.values(observations).every(Boolean);
  return {...metadata,state:complete?'observed-for-review':'held',reason:complete?null:'expected-source-signals-missing',canonicalObserved:canonicals.length===1,mainSha256:sha(text),signals:observations,claimAnchors:observeClaimAnchors(main,anchors,visibleText)};
 }catch{return reject('page-parse-or-identity-failed');}
}
/** Evidence-only: positive signals cannot establish semantic accuracy,
 * complete applicable terms, translation equivalence or permission.
 * The caller supplies canonical candidate/rights binding and the existing
 * bounded transport and robots parser; no visitor input or automatic admission.
 */
export async function observeKnowledgeEvidence({id,revision,sourceUrl,policyUrl,candidateDigest,get,parseRobots,decideRobots,clock}){
 const base={id,revision,sourceUrl,policyUrl,candidateDigest,activationAllowed:false,semanticReviewRequired:true,rightsReviewRequired:true,translationReviewRequired:true};
 const hold=(reason,extra={})=>({...base,...extra,state:'held',reason});
 const spec=typeof id==='string'&&Object.hasOwn(subjects,id)?subjects[id]:null;
 if(!spec||!Number.isSafeInteger(revision)||revision<1||!/^[a-f0-9]{64}$/u.test(candidateDigest)||!safeUrl(sourceUrl,spec.origin)||!safeUrl(policyUrl,spec.origin)||sourceUrl!==spec.sourceUrl||policyUrl!==spec.policyUrl)return hold('candidate-binding-invalid');
 const started=clock();
 if(!Number.isSafeInteger(started)||started<=0)return hold('clock-invalid');
 const robotsUrl=spec.origin+'/robots.txt';
 const robot=await get(robotsUrl,'robots'),robots=requestMetadata(robot);
 // Conservative pilot: absent, redirected, malformed or ambiguous robots
 // cannot silently grant access, even if a generic parser permits absence.
 if(robot?.url!==robotsUrl||robot.status!==200||robot.ok!==true||robot.partial!==false||robot.contentType!=='text/plain'||typeof robot.text!=='string'||robot.sha256!==robots.bodySha256)return hold('robots-unavailable-or-ambiguous',{robots});
 const policy=parseRobots(robot);
 if(policy?.state!=='observed'||policy.bodyEvidence?.bodyKind!=='text'||policy.groupCount<1||policy.malformedDirectives!==0)return hold('robots-unavailable-or-ambiguous',{robots});
 const sourceDecision=decideRobots(policy,sourceUrl),policyDecision=decideRobots(policy,policyUrl),access={source:sourceDecision,policy:policyDecision};
 if(sourceDecision?.allowed!==true||policyDecision?.allowed!==true)return hold('robots-not-permitted',{robots,access});
 const source=inspectPage(await get(sourceUrl,'article'),sourceUrl,spec.sourceTitle,spec.sourceSignals,knowledgeClaimAnchors(id,'source'));
 if(source.state!=='observed-for-review')return hold(source.reason,{robots,access,source});
 const terms=inspectPage(await get(policyUrl,'article'),policyUrl,spec.policyTitle,spec.policySignals,knowledgeClaimAnchors(id,'terms'));
 if(terms.state!=='observed-for-review')return hold(terms.reason,{robots,access,source,terms});
 const finished=clock();
 if(!Number.isSafeInteger(finished)||finished<started||finished-started>75_000)return hold('clock-invalid',{robots,access,source,terms});
 return {...base,state:'observed-for-review',reason:null,robots,access,source,terms,observedAt:new Date(finished).toISOString(),candidateIdentity:'exact-laboratory-card-digest-not-admission'};
}
