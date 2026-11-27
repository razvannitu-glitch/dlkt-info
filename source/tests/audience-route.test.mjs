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

test('only canonical Vercel production receives geographic metadata, after a valid token',async()=>{
 const geo={'x-vercel-ip-country':'RO','x-vercel-ip-city':'Bucure%C8%99ti'};
 const trusted={...environment,DLKT_INFO_AUDIENCE_TRUSTED_INGRESS:'1',VERCEL:'1',VERCEL_ENV:'production',VERCEL_URL:'dlkt-fixture.vercel.app'};
 const cases=[
  {env:trusted,host:'www.dlkt.ee',expected:{p_country:'RO',p_city:'București'}},
  {env:trusted,host:'info.dlkt.ee',expected:{p_country:null,p_city:null}},
  {env:trusted,host:'dlkt-fixture.vercel.app',expected:{p_country:null,p_city:null}},
  {env:{...trusted,VERCEL_ENV:'preview'},host:'www.dlkt.ee',expected:{p_country:null,p_city:null}},
  {env:{...trusted,VERCEL:'0'},host:'www.dlkt.ee',expected:{p_country:null,p_city:null}},
  {env:{...trusted,DLKT_INFO_AUDIENCE_TRUSTED_INGRESS:'0'},host:'www.dlkt.ee',expected:{p_country:null,p_city:null}}
 ];
 for(const item of cases){
  const requests=[];
  const fetch=async(url,init)=>{
   const name=new URL(url).pathname.split('/').pop();const body=JSON.parse(init.body);
   requests.push({name,body});
   return new Response(JSON.stringify(name==='record_activity'?'accepted':true),{headers:{'content-type':'application/json'}});
  };
  const make=(body)=>{const r=req(body);Object.assign(r.headers,geo,{host:item.host,origin:'https://'+item.host});return r;};
  const event={kind:'pageview',id:'00000000-0000-4000-8000-000000000001',source:'unknown'};
  const missing=res();await handleAudience(make({action:'event',event}),missing,{environment:item.env,fetch});assert.equal(missing.statusCode,401);assert.equal(requests.length,0);
  const opted=res();await handleAudience(make({action:'enable'}),opted,{environment:item.env,fetch});assert.equal(opted.statusCode,200);
  const cookie=opted.headers.get('Set-Cookie').split(';')[0];
  const r=make({action:'event',event});r.headers.cookie=cookie;
  const view=res();await handleAudience(r,view,{environment:item.env,fetch});assert.equal(view.statusCode,200);
  const activity=requests.filter(x=>x.name==='record_activity');assert.equal(activity.length,1);
  assert.equal(activity[0].body.p_country,item.expected.p_country);
  assert.equal(activity[0].body.p_city,item.expected.p_city);
  assert.equal(Object.keys(activity[0].body).sort().join(','),'p_browser,p_city,p_country,p_event,p_kind,p_source');
  const presence=make({action:'event',event:{kind:'presence'}});presence.headers.cookie=cookie;
  const state=res();await handleAudience(presence,state,{environment:item.env,fetch});assert.equal(state.statusCode,200);
  const heartbeat=requests.filter(x=>x.name==='record_activity').at(-1).body;assert.equal(heartbeat.p_country,null);assert.equal(heartbeat.p_city,null);
 }
});
