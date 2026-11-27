import test from 'node:test';
import assert from 'node:assert/strict';
import {KNOWLEDGE_IDENTITY as I,KNOWLEDGE_ORIGIN,knowledgeCases,assessKnowledgeResponse,collectLiveKnowledge} from '../scripts/verify-live-knowledge.mjs';
const at=I.reviewedAt+1000,commit='a'.repeat(40),manifest='b'.repeat(64);
const common={'content-type':'text/html; charset=utf-8','cache-control':'no-store','set-cookie':'','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow'};
const receipt=(c=commit)=>new Response(JSON.stringify({format:'dlkt-info-public-build-1',product:'dlkt-info',gitCommitSha:c,manifestSha256:manifest}),{headers:{'content-type':'application/json'}});
function body(item){
  const begin='<html lang="'+item.language+'">';
  if(item.status!==200)return begin+'<h1>Unavailable</h1></html>';
  const canonical=KNOWLEDGE_ORIGIN+'/card/'+I.id+'?v='+I.revision+'&amp;lang='+item.language+'&amp;h='+I.digest;
  return begin+'<link rel="canonical" href="'+canonical+'"><article data-shared-knowledge-id="'+I.id+'"><p data-valid-until="'+I.expiresAt+'"></p><p class="card-credits"><a href="'+I.license+'"></a><a href="'+I.terms+'"></a></p><a href="'+I.source+'"></a></article></html>';
}
function reading(item){return {status:item.status,redirected:false,headers:{...common},body:body(item)};}
test('exact canonical/API links, lab digest denial and duplicate parameter rejection',()=>{
  const cases=knowledgeCases(at);
  assert.equal(cases.length,10);
  assert.equal(cases.filter(x=>x.status===200).length,6);
  assert.equal(cases.filter(x=>x.status===404).length,2);
  assert.equal(cases.filter(x=>x.status===400).length,2);
  for(const item of cases)assert.deepEqual(assessKnowledgeResponse(item,reading(item)),[]);
});
test('review expiry and pre-review time deny exact links without retimestamping',()=>{
  for(const time of [I.reviewedAt-1,I.expiresAt,I.expiresAt+1]){
    const cases=knowledgeCases(time);assert.equal(cases.filter(x=>x.status===200).length,0);
    assert.equal(cases.filter(x=>x.status===404).length,8);
  }
  assert.equal(knowledgeCases(I.expiresAt-1).filter(x=>x.status===200).length,6);
});
test('400 on an admitted link is a failure, not a successful denial',()=>{
  const item=knowledgeCases(at)[0],r=reading(item);r.status=400;r.body='<html lang="en"><h1>This card link is not valid</h1></html>';
  const failures=assessKnowledgeResponse(item,r);
  for(const name of ['status','identity','expiry','canonical','source','terms','license','credit'])assert.ok(failures.includes(name),name);
});
test('wrong revision response, language, attribution and cache/privacy failures block',()=>{
  const item=knowledgeCases(at)[1],r=reading(item);r.body=r.body.replace(I.digest,I.labDigest).replace('lang="en"','lang="ro"').replace(I.license,'https://example.invalid');
  r.headers['set-cookie']='unexpected=1';r.headers['cache-control']='public';r.redirected=true;
  const failures=assessKnowledgeResponse(item,r);
  for(const name of ['canonical','language','license','no-cookie','no-store','no-redirect'])assert.ok(failures.includes(name),name);
});
test('wrong digest cannot render a substitute card',()=>{
  const cases=knowledgeCases(at),item=cases.find(x=>x.key==='lab-api'),r=reading(item);
  r.body=body(cases[0]);assert.ok(assessKnowledgeResponse(item,r).includes('no-substitute'));
});
test('bounded direct collector uses only fixed GETs, with stable public release receipt',async()=>{
  const cases=new Map(knowledgeCases(at).map(item=>[KNOWLEDGE_ORIGIN+item.path,item]));
  const calls=[];
  const result=await collectLiveKnowledge(async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/release.json'))return receipt();
    const item=cases.get(url);assert.ok(item);
    return new Response(body(item),{status:item.status,headers:common});
  },()=>at);
  assert.equal(result.status,'LIVE_KNOWLEDGE_HTTP_PASS');assert.equal(result.commit,commit);
  assert.equal(result.requests,12);assert.equal(calls.length,12);
  for(const {url,options} of calls){
    assert.ok(url.startsWith(KNOWLEDGE_ORIGIN+'/'));
    assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
    assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);
  }
});
test('release change, oversized body and network errors fail without swallowing remaining probes',async()=>{
  const cases=new Map(knowledgeCases(at).map(item=>[KNOWLEDGE_ORIGIN+item.path,item]));let receipts=0,calls=0;
  const report=await collectLiveKnowledge(async(url)=>{
    calls++;
    if(url.endsWith('/release.json'))return receipt(receipts++?'c'.repeat(40):commit);
    const item=cases.get(url);
    if(item.key==='canonical-en')return new Response('x',{headers:{'content-length':'128001'}});
    if(item.key==='api-en')throw Error('network');
    return new Response(body(item),{status:item.status,headers:common});
  },()=>at);
  assert.equal(calls,12);assert.equal(report.status,'LIVE_KNOWLEDGE_HTTP_BLOCKED');
  assert.equal(report.commit,null);
  for(const failure of ['release-receipt-changed-or-unavailable','canonical-en:unreachable','api-en:unreachable'])assert.ok(report.failures.includes(failure));
});
test('clock crossing the strict review boundary cannot produce a pass',async()=>{
  const start=I.expiresAt-1,cases=new Map(knowledgeCases(start).map(item=>[KNOWLEDGE_ORIGIN+item.path,item]));let ticks=0;
  const report=await collectLiveKnowledge(async(url)=>{
    if(url.endsWith('/release.json'))return receipt();
    const item=cases.get(url);return new Response(body(item),{status:item.status,headers:common});
  },()=>ticks++?I.expiresAt:start);
  assert.ok(report.failures.includes('review-window-changed-or-clock-invalid'));
});
