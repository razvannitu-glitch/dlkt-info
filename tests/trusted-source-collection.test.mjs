import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,readdir,chmod,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {collectionPlan,collectionPermitSigningBytes,collectHdbResearch,collectHdbSyntheticFixture} from '../scripts/trusted-source-collection.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const documents=[read('../docs/iceo-global-coverage-baseline-20261127.md'),read('../docs/evidence/global-coverage-operational-244-20261127.txt')];
const ledgerText=read('../docs/evidence/source-qualification-research-20261127.json');
const packetText=read('../docs/evidence/primary-data-hdb-catalogue-20261127.json');
const model='2005ad5cf04f6ea0f04080eeb66a99f6d895b55d',asOf='2026-11-27T19:30:00.000Z';
const epoch=Date.parse(asOf),reviewer=generateKeyPairSync('ed25519'),collector=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');
const hash=value=>createHash('sha256').update(value).digest('hex');
const fingerprint=key=>hash(key.export({type:'spki',format:'der'}));
const plan=collectionPlan(documents,model,ledgerText,packetText,asOf);
const dataset='d_b51323a474ba789fb4cc3db58a3116d4';
const signed=permit=>sign(null,collectionPermitSigningBytes(permit),reviewer.privateKey).toString('base64');
async function input(t){
 const ledgerDirectory=await mkdtemp(join(tmpdir(),'dlkt-hdb-permit-'));
 t.after(()=>rm(ledgerDirectory,{recursive:true,force:true}));
 const permit={format:'dlkt-hdb-collection-permit-1',evidenceClass:'synthetic-fixture',contextSha256:plan.contextSha256,
  auditDocumentsSha256:plan.auditDocumentsSha256,reviewerKeySha256:fingerprint(reviewer.publicKey),collectorKeySha256:fingerprint(collector.publicKey),
  nonce:'a'.repeat(64),issuedAt:'2026-11-27T19:25:00.000Z',expiresAt:'2026-11-27T19:40:00.000Z',
  requestUrls:plan.requestUrls,policyEvidence:plan.requiredPolicyEvidence.map(({kind,url})=>({kind,url,checkedAt:'2026-11-27T19:20:00.000Z',
   sha256:hash('synthetic-policy-fixture:'+kind),decision:'allowed-for-this-exact-research'}))};
 return {documents,model,ledgerText,packetText,permit,permitSignature:signed(permit),reviewerPublicKey:reviewer.publicKey,
  collectorPrivateKey:collector.privateKey,ledgerDirectory};
}
function replacePermit(value,patch){
 const permit={...value.permit,...patch};return {...value,permit,permitSignature:signed(permit)};
}
// Invented prices and policy digests are synthetic; no provider claim.
function response(url,patch={}){
 const town=JSON.parse(new URL(url).searchParams.get('filters')).town;
 return {responseUrl:url,status:200,contentType:'application/json',contentEncoding:'identity',redirected:false,
  body:Buffer.from(JSON.stringify({success:true,result:{resource_id:dataset,records:[{quarter:'2026-Q2',town,flat_type:'4-room',
   price:town==='Ang Mo Kio'?'123000':'101000'}],total:1,limit:2,offset:0}})),...patch};
}
const run=(value,transport=async url=>response(url),clock=()=>epoch)=>collectHdbSyntheticFixture(value,{transport,clock});

test('separate synthetic reviewer and collector signatures bind the exact two responses',async t=>{
 const value=await input(t),calls=[];
 const result=await run(value,async url=>{calls.push(url);return response(url);});
 assert.deepEqual(calls,plan.requestUrls);assert.equal(result.collection.requestsCompleted,2);
 assert.equal(result.collection.evidenceClass,'synthetic-fixture');assert.equal(result.report.evidenceClass,'synthetic-fixture');
 assert.equal(result.report.comparison.difference,22000);assert.equal(result.report.availability.lagQuarters,1);
 assert.equal(result.report.latestPublication.state,'held');assert.equal(result.collection.reviewerAuthority,'not-independently-established');
 assert.equal(result.collection.remoteOriginAuthenticated,false);assert.equal(result.report.publicationAllowed,false);
 assert.equal(result.collection.publicationAllowed,false);assert.equal(result.captures.length,2);
 assert.equal((await readdir(value.ledgerDirectory)).length,1);
 await assert.rejects(run(value,async()=>assert.fail('replayed request')),/TRUSTED_COLLECTION_PERMIT_ALREADY_USED/);
});

test('unenrolled authority blocks every real entrypoint before reservation, including self-issued distinct keys',async t=>{
 const value=await input(t);
 await assert.rejects(collectHdbResearch(value),/TRUSTED_COLLECTION_TRUST_NOT_ENROLLED/);
 const real=replacePermit(value,{evidenceClass:'external-research-capture'});
 await assert.rejects(collectHdbResearch(real),/TRUSTED_COLLECTION_TRUST_NOT_ENROLLED/);
 await assert.rejects(collectHdbResearch(null),/TRUSTED_COLLECTION_TRUST_NOT_ENROLLED/);
 assert.equal((await readdir(value.ledgerDirectory)).length,0);
 await assert.rejects(run(real,async()=>assert.fail('real permit in fixture')),/TRUSTED_COLLECTION_PERMIT_BINDING/);
});

test('invalid reviewer signature, swapped keys, self-approval and changed evidence never reserve or request',async t=>{
 const value=await input(t),never=async()=>assert.fail('unauthorized transport');
 await assert.rejects(run({...value,permitSignature:'A'.repeat(86)+'=='},never),/TRUSTED_COLLECTION_PERMIT_SIGNATURE/);
 await assert.rejects(run({...value,reviewerPublicKey:other.publicKey},never),/TRUSTED_COLLECTION_PERMIT_BINDING/);
 await assert.rejects(run({...value,collectorPrivateKey:reviewer.privateKey},never),/TRUSTED_COLLECTION_KEY_SEPARATION/);
 await assert.rejects(run({...value,reviewerPublicKey:reviewer.privateKey},never),/TRUSTED_COLLECTION_KEYS/);
 for(const patch of [{contextSha256:'0'.repeat(64)},{auditDocumentsSha256:'0'.repeat(64)},{requestUrls:[plan.requestUrls[0],plan.requestUrls[0]]}]){
  await assert.rejects(run(replacePermit(value,patch),never),/TRUSTED_COLLECTION_(PERMIT_BINDING|REQUEST_SET)/);
 }
 assert.equal((await readdir(value.ledgerDirectory)).length,0);
});

test('unavailable robots, stale policy reviews and invalid permit windows deny before network',async t=>{
 const value=await input(t),never=async()=>assert.fail('unreviewed transport');
 for(const patch of [{decision:'unknown'},{decision:'denied'},{checkedAt:'2026-11-25T00:00:00.000Z'},{url:'https://example.org/robots.txt'}]){
  const policyEvidence=value.permit.policyEvidence.map(entry=>entry.kind==='robots'?{...entry,...patch}:entry);
  await assert.rejects(run(replacePermit(value,{policyEvidence}),never),/TRUSTED_COLLECTION_POLICY_REVIEW/);
 }
 for(const patch of [{issuedAt:'2026-11-27T19:31:00.000Z'},{expiresAt:'2026-11-27T19:30:00.000Z'},{expiresAt:'2026-11-27T20:00:00.000Z'}]){
  await assert.rejects(run(replacePermit(value,patch),never),/TRUSTED_COLLECTION_PERMIT_WINDOW/);
 }
 assert.equal((await readdir(value.ledgerDirectory)).length,0);
});

test('concurrent use of one permit reserves only once',async t=>{
 const value=await input(t),calls=[];
 const transport=async url=>{calls.push(url);return response(url);};
 const result=await Promise.allSettled([run(value,transport),run(value,transport)]);
 assert.equal(result.filter(item=>item.status==='fulfilled').length,1);
 assert.match(result.find(item=>item.status==='rejected').reason.message,/TRUSTED_COLLECTION_PERMIT_ALREADY_USED/);
 assert.deepEqual(calls,plan.requestUrls);
});

test('provider denial, redirect, encoding, malformed schema and oversized entity stop after the first request with no retry',async t=>{
 const cases=[
  [{status:403},/RESPONSE_STATUS/],[{status:429},/RESPONSE_STATUS/],[{redirected:true},/RESPONSE_ORIGIN/],
  [{responseUrl:'https://example.org/'},/RESPONSE_ORIGIN/],[{contentEncoding:'gzip'},/RESPONSE_ENCODING/],
  [{contentType:'text/html'},/RESPONSE_MEDIA/],[{body:Buffer.alloc(128*1024+1)},/RESPONSE_SIZE/],
  [{body:Buffer.from('{"success":false}')},/DATA_EVIDENCE_RESPONSE_ENVELOPE/],
 ];
 for(const [patch,error] of cases){
  const value=await input(t),calls=[];
  await assert.rejects(run(value,async url=>{calls.push(url);return response(url,patch);}),error);
  assert.deepEqual(calls,[plan.requestUrls[0]]);
  await assert.rejects(run(value,async()=>assert.fail('retry')),/TRUSTED_COLLECTION_PERMIT_ALREADY_USED/);
 }
});

test('expiry while collecting prevents receipt acceptance and the second request',async t=>{
 const value=await input(t),calls=[];let now=epoch;
 await assert.rejects(run(value,async url=>{calls.push(url);now=Date.parse(value.permit.expiresAt);return response(url);},()=>now),/TRUSTED_COLLECTION_PERMIT_WINDOW/);
 assert.deepEqual(calls,[plan.requestUrls[0]]);
 await assert.rejects(run(value,async()=>assert.fail('retry')),/TRUSTED_COLLECTION_PERMIT_ALREADY_USED/);
});

test('unsafe replay ledger directory and symlink fail closed',async t=>{
 const value=await input(t),never=async()=>assert.fail('unsafe directory');
 await chmod(value.ledgerDirectory,0o755);
 await assert.rejects(run(value,never),/TRUSTED_COLLECTION_LEDGER_DIRECTORY/);
 await chmod(value.ledgerDirectory,0o700);
 const alias=value.ledgerDirectory+'-link';await symlink(value.ledgerDirectory,alias);t.after(()=>rm(alias,{force:true}));
 await assert.rejects(run({...value,ledgerDirectory:alias},never),/TRUSTED_COLLECTION_LEDGER_DIRECTORY/);
 await assert.rejects(run({...value,ledgerDirectory:'relative-path'},never),/TRUSTED_COLLECTION_LEDGER_DIRECTORY/);
});
