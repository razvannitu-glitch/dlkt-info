import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {assessOfficialReadback,collectOfficialResponses,OFFICIAL_ORIGIN} from '../scripts/verify-official-readback.mjs';
const sha='a'.repeat(40);
const manifest=JSON.stringify({product:'dlkt-info',version:'0.9.46',revision:'iceo-primary-mesh-1'});
const html='<!doctype html><html><head><title>DLKT INFO — Daily Life. Key Things.</title></head><body>Daily Life. Key Things.</body></html>';
const assets={'/header.css':'header','/iceo.css':'layout','/iceo.js':'reader-code'};
const expected={sha,manifest,html,assets};
const receipt={format:'dlkt-info-public-build-1',product:'dlkt-info',version:'0.9.46',revision:'iceo-primary-mesh-1',
 manifestSha256:createHash('sha256').update(manifest).digest('hex'),gitCommitSha:sha,
 indexability:'prelaunch-noindex',runtimeVerification:'not-attested-by-receipt'};
const route='< !doctype html>DLKT INFO'.replace('< !','<!');
const headers={'content-security-policy':"default-src 'none'; script-src 'self'",'x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow'};
const fixture=()=>{
 const responses={
  '/':{status:200,headers,body:html},
  '/release.json':{status:200,headers,body:JSON.stringify(receipt)},
  '/robots.txt':{status:200,headers,body:'User-agent: *\nDisallow: /\n'},
  '/sources':{status:200,headers,body:route+'<section id="iceo-source-atlas">DLKT INFO</section>'},
 };
 for(const path of ['/terms','/privacy','/contact','/about','/company'])responses[path]={status:200,headers,body:route};
 for(const [path,body]of Object.entries(assets))responses[path]={status:200,headers,body};
 return {responses};
};

test('matching live receipt, assets and protected prelaunch surface passes static readback only',()=>{
 const result=assessOfficialReadback(expected,fixture());
 assert.equal(result.status,'LIVE_READBACK_PASS');assert.deepEqual(result.failures,[]);
 assert.equal(result.reportedSha,sha);assert.ok(result.notAttested.some(x=>x.includes('Supabase')));
});
test('stale production release fails even with all other HTML and assets matching',()=>{
 const snapshot=fixture();
 snapshot.responses['/release.json'].body=JSON.stringify({...receipt,gitCommitSha:'b'.repeat(40)});
 const result=assessOfficialReadback(expected,snapshot);
 assert.equal(result.status,'LIVE_READBACK_BLOCKED');
 assert.ok(result.failures.includes('exact-git-commit'));
});
test('security downgrade, missing legal page and tampered CSS fail independently',()=>{
 const snapshot=fixture();snapshot.responses['/'].headers={...headers,'x-robots-tag':''};
 snapshot.responses['/privacy'].status=404;snapshot.responses['/header.css'].body='unexpected';
 snapshot.responses['/robots.txt'].body='User-agent: *\nAllow: /\n';
 const result=assessOfficialReadback(expected,snapshot);
 for(const name of ['served-security-headers','prelaunch-robots','html-route:/privacy','asset-integrity:/header.css']){
  assert.ok(result.failures.includes(name),name);
 }
});
test('missing source attribution atlas and false release receipt block launch',()=>{
 const snapshot=fixture();snapshot.responses['/sources'].body=route;
 snapshot.responses['/release.json'].body=JSON.stringify({...receipt,manifestSha256:'f'.repeat(64)});
 const result=assessOfficialReadback(expected,snapshot);
 assert.ok(result.failures.includes('source-directory-rendered'));
 assert.ok(result.failures.includes('exact-release-manifest'));
});
test('readback request set is fixed to official origin, read-only, credential-free',async()=>{
 const visited=[];
 const fetcher=async(url,options)=>{
  visited.push(url);assert.ok(url.startsWith(OFFICIAL_ORIGIN+'/'));
  assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');
  assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');
  return new Response('ok',{headers:{'content-type':'text/plain'}});
 };
 const output=await collectOfficialResponses(fetcher);
 assert.equal(visited.length,12);assert.ok(output.responses['/release.json']);assert.ok(output.responses['/header.css']);
 assert.equal(new Set(visited).size,visited.length);
});
test('oversized and redirected external results cannot be accepted',async()=>{
 let calls=0;
 await assert.rejects(collectOfficialResponses(async()=>{
  calls++;return new Response('x',{headers:{'content-length':'999999999'}});
 }),/DLKT_READBACK_SIZE/);
 assert.equal(calls,1);
 const snapshot=await collectOfficialResponses(async()=>new Response(null,{status:302,headers:{location:'https://evil.invalid/'}}));
 assert.equal(assessOfficialReadback(expected,snapshot).status,'LIVE_READBACK_BLOCKED');
});
test('readback cannot run without a full checked expected commit or manifest',()=>{
 assert.throws(()=>assessOfficialReadback({...expected,sha:'unverified'},fixture()),/DLKT_OFFICIAL_READBACK_INPUT/);
 assert.throws(()=>assessOfficialReadback({...expected,assets:{}},fixture()),/DLKT_OFFICIAL_READBACK_INPUT/);
});
