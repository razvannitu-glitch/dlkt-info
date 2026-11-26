import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {observeKnowledgeEvidence} from '../scripts/knowledge-editorial-evidence.mjs';
const origin='https://www.nsw.gov.au',sourceUrl=origin+'/example',policyUrl=origin+'/copyright';
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
 for(const patch of [{sourceUrl:'https://example.com/a'},{policyUrl:origin+'/copyright?other=1'},{candidateDigest:'fake'},{revision:0},{id:'unknown'}]){
  const h=harness(),r=await observeKnowledgeEvidence({...h.input,...patch});assert.equal(r.state,'held');assert.equal(r.activationAllowed,false);assert.equal(h.requests.length,0);
 }
});
test('robots denial, redirect, missing and malformed evidence prevent page reads',async()=>{
 for(const options of [{decision:false},{robots:{status:404,ok:false}},{robots:{status:302,ok:false}},{robots:{contentType:'text/html'}},{robots:{partial:true}},{robots:{sha256:'f'.repeat(64)}}]){
  const h=harness(options),r=await observeKnowledgeEvidence(h.input);assert.equal(r.state,'held');assert.equal(r.activationAllowed,false);assert.equal(h.requests.length,1);
 }
});
test('source identity, hidden signals, partial content and digest mismatch fail closed',async()=>{
 for(const options of [{source:{partial:true}},{source:{sha256:'f'.repeat(64)}},{sourceBody:page('Different heading',sourceText,sourceUrl)},{sourceBody:page('Check fuel prices',sourceText,origin+'/wrong')},{sourceBody:page('Check fuel prices','<span hidden>'+sourceText+'</span>',sourceUrl)},{sourceBody:page('Check fuel prices','FuelCheck is free.',sourceUrl)}]){
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
