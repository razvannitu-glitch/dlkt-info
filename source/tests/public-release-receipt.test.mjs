import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPublicBuildReceipt} from '../.build/src/service/public-release-receipt.js';

const manifest=JSON.stringify({product:'dlkt-info',version:'0.9.46',revision:'iceo-primary-mesh-1',files:{'test.txt':'f'.repeat(64)}});
test('release receipt fingerprints the exact verified source manifest without runtime assertions',()=>{
 const r=createPublicBuildReceipt(manifest,'f'.repeat(40));
 assert.deepEqual(r,{
  format:'dlkt-info-public-build-1',product:'dlkt-info',version:'0.9.46',revision:'iceo-primary-mesh-1',
  manifestSha256:createHash('sha256').update(manifest).digest('hex'),
  gitCommitSha:'f'.repeat(40),indexability:'prelaunch-noindex',runtimeVerification:'not-attested-by-receipt',
 });
 assert.ok(Object.isFrozen(r));assert.equal(JSON.stringify(r).includes('token'),false);
});
test('release receipt never exposes arbitrary build metadata or false git identity',()=>{
 assert.equal(createPublicBuildReceipt(manifest,'my-secret').gitCommitSha,null);
 assert.equal(createPublicBuildReceipt(manifest,undefined).gitCommitSha,null);
 assert.equal(createPublicBuildReceipt(manifest,'ABCDEF0123456789ABCDEF0123456789ABCDEF01').gitCommitSha,'abcdef0123456789abcdef0123456789abcdef01');
});
test('release receipt rejects malformed, wrong-product and oversized manifest evidence',()=>{
 for(const invalid of ['',undefined,'{}','{"product":"foreign"}',JSON.stringify({product:'dlkt-info',version:'0.9.46',revision:'iceo-primary-mesh-1',files:{}}),'x'.repeat(1_000_001)]){
  assert.throws(()=>createPublicBuildReceipt(invalid,null),/DLKT_PUBLIC_RECEIPT_MANIFEST/);
 }
});
