import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {observeKnowledgeEvidence,assessKnowledgeProbeOutcome} from '../scripts/knowledge-editorial-evidence.mjs';
const origin='https://www.nsw.gov.au',sourceUrl="https://www.nsw.gov.au/legal-and-justice/consumer-rights-and-protection/advertising-product-packaging-and-pricing-laws/fuel-pricing-discounts-and-signage/check-fuel-prices",policyUrl="https://www.nsw.gov.au/nsw-government/about-website/copyright";
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const page=(title,text,canonical)=>'<html><head>'+(canonical?'<link rel="canonical" href="'+canonical+'">':'')+'</head><body><main><h1>'+title+'</h1><p>'+text+'</p></main></body></html>';
const sourceText='FuelCheck is free, with real-time fuel prices. Never use your phone while driving.';
const termsText='Creative Commons Attribution 4.0, except as noted. State of New South Wales. third-party material, logos.';
function response(url,text,contentType='text/html',extra={}){return {url,status:200,ok:true,partial:false,contentType,text,sha256:hash(text),...extra};}
function harness({robots={},source={},terms={},decision=true,sourceBody=page('Check fuel prices',sourceText,sourceUrl),policyBody=page('Copyright',termsText,policyUrl)}={}){
 const requests=[];
 const data=new Map([[origin+'/robots.txt',response(origin+'/robots.txt','User-agent: *\nDisallow: /admin','text/plain',robots)],[sourceUrl,response(sourceUrl,sourceBody,'text/html',source)],[policyUrl,response(policyUrl,policyBody,'text/html',terms)]]);
 const input={id:'dlkt-elsewhere-nsw-fuelcheck',revision:1,sourceUrl,policyUrl,candidateDigest:'a'.repeat(64),get:async(url,kind)=>{requests.push({url,kind});return data.get(url);},parseRobots:()=>({state:'observed',bodyEvidence:{bodyKind:'text'},groupCount:1,malformedDirectives:0}),decideRobots:()=>({allowed:decision}),clock:()=>Date.parse('2026-11-26T20:00:00Z')};
 return {input,requests};
}
test('exact source and terms observations remain proposals, not permission',async()=>{
 const {input,requests}=harness(),r=await observeKnowledgeEvidence(input);
 assert.equal(r.state,'observed-for-review');assert.equal(r.activationAllowed,false);
 assert.equal(r.candidateDigest,input.candidateDigest);assert.equal(r.semanticReviewRequired,true);assert.equal(r.translationReviewRequired,true);assert.equal(r.rightsReviewRequired,true);
 assert.deepEqual(requests.map(x=>x.kind),['robots','article','article']);
 assert.equal(r.source.bodySha256.length,64);assert.equal(r.terms.mainSha256.length,64);
 assert.ok(!JSON.stringify(r).includes(sourceText));assert.ok(!JSON.stringify(r).includes(termsText));
});
test('unknown origin or malformed identity causes no network requests',async()=>{
 for(const patch of [{sourceUrl:'https://example.com/a'},{sourceUrl:origin+'/different-public-page'},{policyUrl:origin+'/different-terms'},{policyUrl:policyUrl+'?other=1'},{candidateDigest:'fake'},{revision:0},{id:'unknown'}]){
  const h=harness(),r=await observeKnowledgeEvidence({...h.input,...patch});assert.equal(r.state,'held');assert.equal(r.activationAllowed,false);assert.equal(h.requests.length,0);
 }
});
test('robots denial, redirect, missing and malformed evidence prevent page reads',async()=>{
 for(const options of [{decision:false},{robots:{status:404,ok:false}},{robots:{status:302,ok:false}},{robots:{contentType:'text/html'}},{robots:{partial:true}},{robots:{sha256:'f'.repeat(64)}}]){
  const h=harness(options),r=await observeKnowledgeEvidence(h.input);assert.equal(r.state,'held');assert.equal(r.activationAllowed,false);assert.equal(h.requests.length,1);
 }
});
test('source identity, hidden signals, partial content and digest mismatch fail closed',async()=>{
 for(const options of [{source:{partial:true}},{source:{sha256:'f'.repeat(64)}},{sourceBody:page('Different heading',sourceText,sourceUrl)},{sourceBody:page('Check fuel prices',sourceText,origin+'/wrong')},{sourceBody:page('Check fuel prices',sourceText)},{sourceBody:page('Check fuel prices','<span hidden>'+sourceText+'</span>',sourceUrl)},{sourceBody:page('Check fuel prices','FuelCheck is free.',sourceUrl)}]){
  const h=harness(options),r=await observeKnowledgeEvidence(h.input);assert.equal(r.state,'held');assert.equal(r.activationAllowed,false);assert.equal(h.requests.length,2);
 }
});
test('source success is insufficient when exact policy is unavailable or changed',async()=>{
 for(const options of [{terms:{status:403,ok:false}},{policyBody:page('Copyright','All rights reserved.',policyUrl)},{policyBody:page('Copyright','Creative Commons Attribution 4.0. State of New South Wales.',policyUrl)}]){
  const h=harness(options),r=await observeKnowledgeEvidence(h.input);assert.equal(r.state,'held');assert.equal(r.activationAllowed,false);assert.equal(h.requests.length,3);
 }
});
test('contradictory visible terms never become approval merely by matching signals',async()=>{
 const h=harness({policyBody:page('Copyright',termsText+' Specific article excluded from reuse.',policyUrl)}),r=await observeKnowledgeEvidence(h.input);
 assert.equal(r.activationAllowed,false);assert.equal(r.rightsReviewRequired,true);
});

test('canonical must explicitly name the exact absolute page; absent and blank href never inherit request URL',async()=>{
 const good=page('Check fuel prices',sourceText,sourceUrl);
 for(const tag of ['<link rel="canonical">','<link rel="canonical" href="">','<link rel="canonical" href=" ">','<link rel="canonical" href="&#9;">','<link rel="canonical" href="&#160;">','<link rel="canonical" href="#fragment">','<link rel="canonical" href="./check-fuel-prices">']){
  const h=harness({sourceBody:good.replace('<link rel="canonical" href="'+sourceUrl+'">',tag)});
  const r=await observeKnowledgeEvidence(h.input);assert.equal(r.state,'held',tag);assert.equal(r.reason,'canonical-url-mismatch',tag);assert.notEqual(r.source.canonicalObserved,true);assert.equal(h.requests.length,2);
 }
 const h=harness({policyBody:page('Copyright',termsText,policyUrl).replace('href="'+policyUrl+'"','href=""')});
 const r=await observeKnowledgeEvidence(h.input);assert.equal(r.state,'held');assert.equal(r.reason,'canonical-url-mismatch');assert.equal(h.requests.length,3);
});
test('hidden main or hidden ancestor cannot yield collected page evidence',async()=>{
 const good=page('Check fuel prices',sourceText,sourceUrl);
 for(const wrapper of ['<div hidden>','<div aria-hidden="true">','<div style="display: none">','<div style="visibility: hidden">']){
  const h=harness({sourceBody:good.replace('<main>',wrapper+'<main>').replace('</main>','</main></div>')});
  const r=await observeKnowledgeEvidence(h.input);assert.equal(r.state,'held',wrapper);assert.equal(r.reason,'main-content-excluded');assert.equal(h.requests.length,2);
 }
 const h=harness({sourceBody:good.replace('<main>','<main hidden>')});assert.equal((await observeKnowledgeEvidence(h.input)).state,'held');
});
test('dossier success separately requires collection and complete claim evidence for every expected card',async()=>{
 const {input}=harness(),observation=await observeKnowledgeEvidence(input),id=input.id;
 assert.equal(observation.state,'observed-for-review');assert.ok(Object.values(observation.source.claimAnchors).every(anchor=>anchor.matches===0));
 const incomplete=assessKnowledgeProbeOutcome([{...observation,claimEvidence:{state:'held',activationAllowed:false,independentReviewRequired:true}}],[id]);
 assert.equal(incomplete.collectionState,'observations-collected');assert.equal(incomplete.claimState,'held');assert.equal(incomplete.state,'held');assert.equal(incomplete.complete,false);
 const ready={...observation,claimEvidence:{state:'evidence-ready-for-independent-review',activationAllowed:false,independentReviewRequired:true}};
 assert.equal(assessKnowledgeProbeOutcome([ready],[id]).complete,true);
 for(const [reports,ids] of [[[],[id]],[[ready,ready],[id,'another']],[[ready],[id,'another']],[[{...ready,state:'held'}],[id]],[[{...ready,claimEvidence:{...ready.claimEvidence,activationAllowed:true}}],[id]],[[{...ready,claimEvidence:undefined}],[id]],[[ready],[]]]){
  const r=assessKnowledgeProbeOutcome(reports,ids);assert.equal(r.complete,false);assert.equal(r.state,'held');assert.equal(r.activationAllowed,false);
 }
});
