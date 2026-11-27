import test from 'node:test';
import assert from 'node:assert/strict';
import {KNOWLEDGE_IDENTITY as I,KNOWLEDGE_ORIGIN,knowledgeCases,assessKnowledgeResponse,collectLiveKnowledge,knowledgeProbeOptions,knowledgeCanonicalUrl,knowledgeCreditText,knowledgeCreditLinks,knowledgeRenderedFields} from '../scripts/verify-live-knowledge.mjs';
import {assessKnowledgeBrowser} from '../scripts/qa-live-reader.mjs';
const at=I.reviewedAt+1000,commit='a'.repeat(40),manifest='b'.repeat(64);
const common={'content-type':'text/html; charset=utf-8','cache-control':'no-store','set-cookie':'','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow'};
const receipt=(c=commit,m=manifest)=>new Response(JSON.stringify({format:'dlkt-info-public-build-1',product:'dlkt-info',gitCommitSha:c,manifestSha256:m}),{headers:{'content-type':'application/json'}});
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function body(item){
  const begin='<html lang="'+item.language+'">';
  if(item.status!==200)return begin+'<h1>Unavailable</h1></html>';
  const canonical=KNOWLEDGE_ORIGIN+'/card/'+I.id+'?v='+I.revision+'&amp;lang='+item.language+'&amp;h='+I.digest;
  const creditLinks=knowledgeCreditLinks(item.language),credit=knowledgeCreditText(item.language);
  const prefix=credit.slice(0,credit.indexOf('CC BY 4.0'));
  const fields=knowledgeRenderedFields(item.language),split=fields.connection.indexOf(': ')+2;
  const editorial='<header><span class="card-topic">'+escape(fields.geography)+'</span></header><h1>'+escape(fields.title)+'</h1><p class="card-meta">'+escape(fields.publisher)+'</p><p class="card-context">'+escape(fields.explanation)+'</p><div class="card-guide"><p><strong>'+escape(fields.connection.slice(0,split))+'</strong>'+escape(fields.connection.slice(split))+'</p></div><p class="privacy-note">'+escape(fields.boundary)+'</p>';
  return begin+'<head><link rel="canonical" href="'+canonical+'"></head><body><main><article data-shared-knowledge-id="'+I.id+'">'+editorial+'<p id="shared-freshness" data-valid-until="'+I.expiresAt+'"></p><p class="card-credits">'+prefix+'<a href="'+creditLinks[0].href+'">'+creditLinks[0].text+'</a> · <a href="'+creditLinks[1].href+'">'+creditLinks[1].text+'</a></p><a class="source-link" href="'+I.source+'">Source</a><button id="shared-copy" data-card-url="'+canonical+'" hidden>Copy</button></article></main></body></html>';
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
  assert.equal(result.status,'LIVE_KNOWLEDGE_MONITOR_PASS');assert.equal(result.commit,commit);assert.equal(result.recoveryVerified,false);
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

const recovery={mode:'recovery',origin:KNOWLEDGE_ORIGIN,expectedCommit:commit,expectedManifest:manifest};
function fetchFixture(now,{c=commit,m=manifest,origin=KNOWLEDGE_ORIGIN}={}){
  const cases=new Map(knowledgeCases(now).map(item=>[origin+item.path,item]));
  return async(url,options)=>{
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');
    if(url===origin+'/release.json')return receipt(c,m);
    const item=cases.get(url);assert.ok(item,url);
    return new Response(body(item),{status:item.status,headers:common});
  };
}
test('only an active explicitly matched release can pass recovery',async()=>{
  const report=await collectLiveKnowledge(fetchFixture(at),()=>at,recovery);
  assert.equal(report.status,'LIVE_KNOWLEDGE_RECOVERY_PASS');assert.equal(report.recoveryVerified,true);
  for(const [fixture,expected] of [[{c:'c'.repeat(40)},'expected-release-commit'],[{m:'d'.repeat(64)},'expected-release-manifest']]){
    const r=await collectLiveKnowledge(fetchFixture(at,fixture),()=>at,recovery);
    assert.equal(r.recoveryVerified,false);assert.ok(r.failures.includes(expected));
  }
  const denial=await collectLiveKnowledge(fetchFixture(I.expiresAt),()=>I.expiresAt);
  assert.equal(denial.status,'LIVE_KNOWLEDGE_DENIAL_PASS');assert.equal(denial.recoveryVerified,false);
  const expired=await collectLiveKnowledge(fetchFixture(I.expiresAt),()=>I.expiresAt,recovery);
  assert.ok(expired.failures.includes('recovery-requires-active-admission'));assert.equal(expired.recoveryVerified,false);
  const premature=await collectLiveKnowledge(fetchFixture(I.reviewedAt-1),()=>I.reviewedAt-1,recovery);
  assert.ok(premature.failures.includes('recovery-requires-active-admission'));assert.equal(premature.recoveryVerified,false);
});
test('isolated origin is explicit, project-scoped and cannot be confused with the public canonical link',async()=>{
  const origin='https://dlkt-info-fixture123-dlkt-group-ou.vercel.app',options={...recovery,origin};
  const report=await collectLiveKnowledge(fetchFixture(at,{origin}),()=>at,options);
  assert.equal(report.origin,origin);assert.equal(report.recoveryVerified,true);
  for(const value of ['https://evil.vercel.app','https://dlkt-info-test-dlkt-group-ou.vercel.app.evil.test','https://dlkt-info-test-dlkt-group-ou.vercel.app/path','http://dlkt-info-test-dlkt-group-ou.vercel.app','https://user@www.dlkt.ee']){
    assert.throws(()=>knowledgeProbeOptions({...recovery,origin:value}),/PROBE_OPTIONS/u);
  }
  assert.throws(()=>knowledgeProbeOptions({mode:'recovery',expectedCommit:commit}),/PROBE_OPTIONS/u);
  assert.throws(()=>knowledgeProbeOptions({mode:'monitor',expectedCommit:commit}),/PROBE_OPTIONS/u);
});
test('empty, misplaced, hidden and counterfeit attribution cannot pass HTTP',()=>{
  const item=knowledgeCases(at)[0],r=reading(item);
  for(const altered of [
    r.body.replace(/<p class="card-credits">[\s\S]*?<\/p>/u,'<p class="card-credits"></p>')+'<a href="'+I.license+'">CC BY 4.0</a><a href="'+I.terms+'">Source terms</a>',
    r.body.replace('class="card-credits"','class="card-credits" hidden'),
    r.body.replace('© State of New South Wales.','Different author.'),
    r.body.replace('class="card-credits"','class="card-credits" aria-hidden="true"'),
  ])assert.ok(assessKnowledgeResponse(item,{...r,body:altered}).includes('credit'));
  const broken=r.body.replace('id="shared-copy"','id="not-copy"');
  assert.ok(assessKnowledgeResponse(item,{...r,body:broken}).includes('copy-reference'));
});
test('browser assessment requires visible exact credit, links, enabled exact copy and actual HTTP status',()=>{
  const item=knowledgeCases(at)[0],url=knowledgeCanonicalUrl(item.language),width=320;
  const state={ready:'complete',url,lang:item.language,status:200,main:1,width,articleCount:1,id:I.id,expiry:String(I.expiresAt),canonical:url,
    editorial:Object.fromEntries(Object.entries(knowledgeRenderedFields(item.language)).map(([key,text])=>[key,{count:1,visible:true,structure:true,text}])),
    source:[I.source],creditCount:1,creditVisible:true,creditText:knowledgeCreditText(item.language),creditLinks:knowledgeCreditLinks(item.language).map(link=>({...link,visible:true})),
    copyCount:1,copyVisible:true,copyEnabled:true,copyUrl:url};
  assert.deepEqual(assessKnowledgeBrowser(item,state,url,width),[]);
  for(const [change,code] of [[{creditVisible:false},'visible-exact-credit'],[{creditText:''},'visible-exact-credit'],[{creditLinks:[]},'visible-exact-credit'],[{copyVisible:false},'copy-control'],[{copyEnabled:false},'copy-control'],[{copyUrl:'https://example.invalid'},'copy-control'],[{status:null},'http-status']]){
    assert.ok(assessKnowledgeBrowser(item,{...state,...change},url,width).includes(code),code);
  }
});

test('all admitted language responses must contain the reviewed text, local scope and safety guidance',()=>{
  for(const item of knowledgeCases(at).filter(item=>item.status===200)){
    const r=reading(item),fields=knowledgeRenderedFields(item.language);
    const wrong=knowledgeRenderedFields(item.language==='en'?'ro':'en');
    for(const key of ['title','explanation','geography','publisher','boundary']){
      const original=escape(fields[key]);
      const alternate=wrong[key]===fields[key]?'Substituted wording':escape(wrong[key]);
      assert.ok(assessKnowledgeResponse(item,{...r,body:r.body.replace(original,alternate)}).includes('editorial-'+key),item.key+':'+key);
      assert.ok(assessKnowledgeResponse(item,{...r,body:r.body.replace(original,'')}).includes('editorial-'+key),item.key+':missing-'+key);
    }
    const split=fields.connection.indexOf(': ')+2,guide=escape(fields.connection.slice(split));
    const withoutSafety=r.body.replace(guide,escape(fields.connection.slice(split).replace(/\.[^.]+\.?$/u,'')));
    assert.ok(assessKnowledgeResponse(item,{...r,body:withoutSafety}).includes('editorial-connection'),item.key+':safety');
    for(const altered of [
      r.body.replace('class="card-context"','class="card-context" hidden'),
      r.body.replace(escape(fields.explanation),'<span style="display:none">'+escape(fields.explanation)+'</span>'),
      r.body.replace('</h1>','</h1><h1>'+escape(fields.title)+'</h1>'),
      r.body.replace(/<div class="card-guide">[\s\S]*?<\/div>/u,''),
    ])assert.ok(assessKnowledgeResponse(item,{...r,body:altered}).some(x=>x.startsWith('editorial-')));
  }
});
test('browser assessor rejects absent, invisible, duplicate and wrong-language editorial fields',()=>{
  for(const item of knowledgeCases(at).filter(item=>item.key.startsWith('canonical-')&&item.status===200)){
    const url=knowledgeCanonicalUrl(item.language),fields=knowledgeRenderedFields(item.language);
    const editorial=Object.fromEntries(Object.entries(fields).map(([key,text])=>[key,{count:1,visible:true,structure:true,text}]));
    const state={ready:'complete',url,lang:item.language,status:200,main:1,width:320,articleCount:1,id:I.id,expiry:String(I.expiresAt),canonical:url,
      editorial,source:[I.source],creditCount:1,creditVisible:true,creditText:knowledgeCreditText(item.language),
      creditLinks:knowledgeCreditLinks(item.language).map(link=>({...link,visible:true})),
      copyCount:1,copyVisible:true,copyEnabled:true,copyUrl:url};
    assert.deepEqual(assessKnowledgeBrowser(item,state,url,320),[]);
    for(const key of Object.keys(editorial)){
      for(const change of [{count:0},{count:2},{visible:false},{structure:false},{text:'Substituted text'}]){
        const bad={...editorial,[key]:{...editorial[key],...change}};
        assert.ok(assessKnowledgeBrowser(item,{...state,editorial:bad},url,320).includes('editorial-'+key),item.key+':'+key);
      }
    }
    const wrong=knowledgeRenderedFields(item.language==='en'?'ro':'en');
    assert.ok(assessKnowledgeBrowser(item,{...state,editorial:{...editorial,title:{...editorial.title,text:wrong.title}}},url,320).includes('editorial-title'));
    assert.ok(assessKnowledgeBrowser(item,{...state,editorial:undefined},url,320).includes('editorial-connection'));
  }
});
