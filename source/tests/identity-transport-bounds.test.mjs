import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SupabaseIdentityTransport} from '../.build/src/identity/rest.js';

const MAX_BYTES=131_072;
const config={
  state:'ready',
  url:'https://abcdefghijklmnopqrst.supabase.co',
  publishableKey:'sb_publishable_'+'x'.repeat(32),
};
const email='safe@example.test';
const metadata={locale:'en',timezone:'UTC'};
const makeTransport=(reply)=>new SupabaseIdentityTransport(config,async (_url,init)=>{
  assert.equal(init.method,'POST');
  assert.equal(init.redirect,'error');
  assert.equal(init.cache,'no-store');
  assert.equal(new Headers(init.headers).get('apikey'),config.publishableKey);
  return reply;
});
function streamResponse(parts,headers={'content-type':'application/json'},status=200){
  let cancelled=0;
  const stream=new ReadableStream({
    start(controller){for(const part of parts)controller.enqueue(part);controller.close();},
    cancel(){cancelled++;}
  });
  const response=new Response(stream,{status,headers});
  return {response,wasCancelled:()=>cancelled>0};
}
const encoder=new TextEncoder();
const utf8=value=>encoder.encode(value);

test('genuine small chunked provider JSON succeeds without Content-Length',async()=>{
  const raw=utf8('{}');
  const {response}=streamResponse([raw.subarray(0,1),raw.subarray(1)]);
  await makeTransport(response).requestCode(email,metadata);
});
test('exact 128-KiB response size succeeds without retaining extra bytes',async()=>{
  const json=JSON.stringify({pad:'x'.repeat(MAX_BYTES-10)});
  assert.equal(utf8(json).byteLength,MAX_BYTES);
  const data=utf8(json);
  const {response}=streamResponse([data.subarray(0,30_000),data.subarray(30_000,90_000),data.subarray(90_000)]);
  await makeTransport(response).requestCode(email,metadata);
});
test('oversize streamed provider response is cancelled and rejected',async()=>{
  const bytes=utf8(JSON.stringify({pad:'x'.repeat(MAX_BYTES)}));
  const {response,wasCancelled}=streamResponse([bytes.subarray(0,64_000),bytes.subarray(64_000,128_000),bytes.subarray(128_000)]);
  await assert.rejects(makeTransport(response).requestCode(email,metadata),{message:'DLKT_INFO_IDENTITY_RESPONSE_TOO_LARGE'});
  assert.equal(wasCancelled(),true);
});
test('a lying small Content-Length does not bypass streamed byte limit',async()=>{
  const huge=utf8(JSON.stringify({pad:'x'.repeat(MAX_BYTES+1)}));
  const {response,wasCancelled}=streamResponse([huge],{'content-type':'application/json','content-length':'12'});
  await assert.rejects(makeTransport(response).requestCode(email,metadata),{message:'DLKT_INFO_IDENTITY_RESPONSE_TOO_LARGE'});
  assert.equal(wasCancelled(),true);
});
test('advertised oversize is rejected and body cancelled without parsing',async()=>{
  const {response,wasCancelled}=streamResponse([utf8('{}')],{'content-type':'application/json','content-length':String(MAX_BYTES+1)});
  await assert.rejects(makeTransport(response).requestCode(email,metadata),{message:'DLKT_INFO_IDENTITY_RESPONSE_TOO_LARGE'});
  assert.equal(wasCancelled(),true);
});
test('invalid content type is rejected and stream cancelled',async()=>{
  const {response,wasCancelled}=streamResponse([utf8('<html>injected</html>')],{'content-type':'text/html'});
  await assert.rejects(makeTransport(response).requestCode(email,metadata),{message:'DLKT_INFO_IDENTITY_RESPONSE_CONTENT_TYPE_INVALID'});
  assert.equal(wasCancelled(),true);
});
test('provider throttling preserves exact HTTP status for caller mapping',async()=>{
  const {response}=streamResponse([utf8(JSON.stringify({message:'rate limited'}))],{'content-type':'application/json'},429);
  await assert.rejects(makeTransport(response).requestCode(email,metadata),{message:'DLKT_INFO_IDENTITY_HTTP_429'});
});
test('malformed JSON and empty response are rejected',async()=>{
  for(const body of ['{invalid','']){
    const {response}=streamResponse([utf8(body)]);
    await assert.rejects(makeTransport(response).requestCode(email,metadata),{message:'DLKT_INFO_IDENTITY_RESPONSE_INVALID'});
  }
});
