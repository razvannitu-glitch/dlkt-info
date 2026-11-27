import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handleAudience} from '../.build/api/audience.js';
const req=body=>Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{method:'POST',url:'/api/audience',headers:{host:'www.dlkt.ee',origin:'https://www.dlkt.ee','x-forwarded-proto':'https','x-dlkt-info-request':'audience-v1','content-type':'application/json'}});
const res=()=>({statusCode:0,headers:new Map(),body:'',setHeader(k,v){this.headers.set(k,v);},end(v){this.body=v;}});
const environment={DLKT_INFO_AUDIENCE_ROUTE_ENABLED:'1',DLKT_INFO_AUDIENCE_COLLECT_ENABLED:'1',DLKT_INFO_AUDIENCE_RETENTION_READY:'1',DLKT_INFO_AUDIENCE_CONSENT_READY:'1',DLKT_INFO_AUDIENCE_EDGE_GATE_READY:'1',DLKT_INFO_AUDIENCE_SUPABASE_PROJECT_REF:'abcdefghijklmnopqrst',DLKT_INFO_AUDIENCE_SUPABASE_SECRET_KEY:'sb_secret_'+'x'.repeat(30),DLKT_INFO_AUDIENCE_TOKEN_SECRET:Buffer.alloc(32,9).toString('base64url')};
test('route dark by default; edge and retention gates precede token issuance',async()=>{
 const fetch=async()=>{throw Error('no network expected');};
 let r=res();await handleAudience(req({action:'enable'}),r,{environment:{},fetch});assert.equal(r.statusCode,404);
 r=res();await handleAudience(req({action:'enable'}),r,{environment:{...environment,DLKT_INFO_AUDIENCE_EDGE_GATE_READY:'0'},fetch});assert.equal(r.statusCode,403);
 assert.equal(r.headers.has('Set-Cookie'),false);
 r=res();await handleAudience(req({action:'enable'}),r,{environment,fetch:async(url)=>{assert.match(String(url),/\/admit_request$/);return new Response('false',{headers:{'content-type':'application/json'}});}});
 assert.equal(r.statusCode,429);assert.equal(r.headers.has('Set-Cookie'),false);
});
test('status reflects actual database readiness rather than configuration alone',async()=>{
 for(const ready of [false,true]){
  const r=res();await handleAudience(req({action:'status'}),r,{environment,fetch:async(url)=>{assert.match(String(url),/\/operational_ready$/);return new Response(JSON.stringify(ready),{headers:{'content-type':'application/json'}});}});
  assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).available,ready);assert.equal(r.headers.has('Set-Cookie'),false);
 }
});
