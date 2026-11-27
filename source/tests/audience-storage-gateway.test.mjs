import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {audienceStorageConfig,parseAudienceSnapshot,SupabaseAudienceStore} from '../.build/src/audience/storage.js';
import {handleAudienceGateway} from '../.build/src/audience/gateway.js';
import {readAnalytics} from '../.build/src/admin/analytics.js';
import {renderDashboard} from '../.build/src/admin/render.js';
const now=new Date('2026-11-26T20:00:00Z');
const secret=Buffer.alloc(32,7).toString('base64url');
const config={projectRef:'abcdefghijklmnopqrst',secretKey:'sb_secret_'+'x'.repeat(30)};
const core={url:'https://example.supabase.co'};
const env={DLKT_INFO_AUDIENCE_SUPABASE_PROJECT_REF:config.projectRef,DLKT_INFO_AUDIENCE_SUPABASE_SECRET_KEY:config.secretKey,
 DLKT_INFO_AUDIENCE_READ_ENABLED:'1',DLKT_INFO_AUDIENCE_RETENTION_READY:'1',DLKT_INFO_AUDIENCE_ACTIVATED_AT:'2026-11-25T20:00:00Z'};
const raw={version:'dlkt-audience-1',asOf:'2026-11-26T20:00:00+00:00',since:'2026-11-25T20:00:00+00:00',bucket:'hour',retentionDays:90,
 visitors:3,sessionStarts:4,pageviews:7,repeatBrowsers:1,active5m:2,
 countries:[{country:'RO',visitors:3,sessions:4}],cities:[{country:'RO',city:'Bucharest',visitors:3,sessions:4}],
 sources:[{source:'direct',visitors:3,sessions:4}],series:[{timestamp:'2026-11-26T20:00:00Z',pageviews:7,sessionStarts:4}]};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('snapshot rejects inconsistent totals, stale timestamps, unsafe geography and small cohorts',()=>{
 assert.equal(parseAudienceSnapshot(raw,24,now).cities[0].label,'Bucharest · RO');
 for(const bad of [{...raw,active5m:4},{...raw,pageviews:8},{...raw,series:[{...raw.series[0],timestamp:'2026-11-26T20:30:00Z'}]},
 {...raw,countries:[{country:'RO',visitors:2,sessions:3}]},{...raw,cities:[{country:'RO',city:'<script>',visitors:3,sessions:4}]},{...raw,asOf:'2026-11-26T19:00:00Z'}])assert.throws(()=>parseAudienceSnapshot(bad,24,now),/AUDIENCE_INVALID_RESPONSE/);
});
test('separate storage configuration rejects reused application credentials',()=>{
 assert.deepEqual(audienceStorageConfig(env),config);
 assert.equal(audienceStorageConfig({...env,DLKT_INFO_SUPABASE_PROJECT_REF:config.projectRef}),null);
 assert.equal(audienceStorageConfig({...env,DLKT_INFO_SUPABASE_SECRET_KEY:config.secretKey}),null);
});
test('storage transport uses fixed schema, fixed RPCs, no redirect and only expected parameters',async()=>{
 const calls=[];const store=new SupabaseAudienceStore(config,async(url,init)=>{
  calls.push([url.pathname,JSON.parse(init.body)]);assert.equal(url.origin,'https://'+config.projectRef+'.supabase.co');
  assert.equal(init.headers['Content-Profile'],'dlkt_audience');assert.equal(init.headers.apikey,config.secretKey);assert.equal(init.redirect,'error');
  if(url.pathname.endsWith('/snapshot'))return json(raw);
  if(url.pathname.endsWith('/record_activity'))return json('accepted');
  return new Response(null,{status:204});
 },()=>now);
 const browser='a'.repeat(64);
 assert.equal((await store.snapshot(24)).visitors,3);
 assert.equal(await store.record(browser,{kind:'presence'},{country:'RO',city:'Bucharest'}),'accepted');
 await store.forget(browser);
 assert.deepEqual(calls,[['/rest/v1/rpc/snapshot',{p_hours:24}],['/rest/v1/rpc/record_activity',{p_browser:browser,p_kind:'presence',p_event:null,p_source:null,p_country:null,p_city:null}],['/rest/v1/rpc/forget_browser',{p_browser:browser}]]);
});
test('admin reads first-party metrics without blending Vercel estimates or emitting false zeroes',async()=>{
 const data=await readAnalytics(core,env,'24h',async(url)=>{assert.match(String(url),/\/rest\/v1\/rpc\/snapshot$/);return json(raw);},now);
 assert.equal(data.firstParty.status,'ready');assert.equal(data.totals,null);
 const html=renderDashboard(data);assert.match(html,/Consenting browsers/);assert.match(html,/Bucharest/);assert.match(html,/Active in last 5 min/);
 const missing=await readAnalytics(core,{...env,DLKT_INFO_AUDIENCE_RETENTION_READY:'0'},'24h',async()=>{throw Error('network forbidden');},now);
 assert.equal(missing.firstParty.status,'unavailable');assert.equal(missing.totals,null);
 assert.match(renderDashboard(missing),/First-party audience unavailable/);
});
const gateEnv={DLKT_INFO_AUDIENCE_COLLECT_ENABLED:'1',DLKT_INFO_AUDIENCE_RETENTION_READY:'1',DLKT_INFO_AUDIENCE_CONSENT_READY:'1'};
function req(body,headers={},method='POST',url='/api/audience'){
 const r=Readable.from([Buffer.from(JSON.stringify(body))]);r.method=method;r.url=url;r.headers={host:'www.dlkt.ee',origin:'https://www.dlkt.ee','x-forwarded-proto':'https','x-dlkt-info-request':'audience-v1','content-type':'application/json',...headers};return r;
}
function res(){return{statusCode:0,headers:new Map(),body:'',setHeader(k,v){this.headers.set(k,v);},end(v){this.body=v;}};}
test('consent gateway issues no cookie or event before explicit opt-in and blocks cross-origin and GPC',async()=>{
 const calls=[];const store={record:async(...a)=>{calls.push(a);return 'accepted';},forget:async()=>{throw Error('unexpected');},snapshot:async()=>{throw Error('unexpected');}};
 const deps={environment:gateEnv,store,secret,now:()=>now.getTime(),permit:async()=>true};
 for(const [request,status] of [[req({action:'status'}),200],[req({action:'event',event:{kind:'presence'}}),401],[req({action:'enable'},{origin:'https://evil.test'}),403],[req({action:'enable'},{'sec-gpc':'1'}),403]]){
  const r=res();await handleAudienceGateway(request,r,deps);assert.equal(r.statusCode,status);assert.equal(r.headers.has('Set-Cookie'),false);
 }
 const opted=res();await handleAudienceGateway(req({action:'enable'}),opted,deps);
 assert.equal(opted.statusCode,200);assert.equal(calls.length,0);
 const header=opted.headers.get('Set-Cookie');assert.match(header,/^__Host-dlkt_audience=v1\./);assert.match(header,/HttpOnly; SameSite=Lax/);
 const cookie=header.split(';')[0];
 const event=res();await handleAudienceGateway(req({action:'event',event:{kind:'presence'}},{cookie}),event,deps);
 assert.equal(event.statusCode,200);assert.equal(calls.length,1);assert.match(calls[0][0],/^[0-9a-f]{64}$/);assert.deepEqual(calls[0][2],{country:null,city:null});
});
test('shared abuse gate and disabled collector fail closed; withdrawal can run while collection disabled',async()=>{
 const calls=[];const store={record:async()=>{throw Error('unexpected');},forget:async(key)=>{calls.push(key);},snapshot:async()=>{throw Error('unexpected');}};
 const deps={environment:gateEnv,store,secret,now:()=>now.getTime(),permit:async()=>true};
 const blocked=res();await handleAudienceGateway(req({action:'enable'}),blocked,{...deps,permit:async()=>false});assert.equal(blocked.statusCode,429);assert.equal(blocked.headers.has('Set-Cookie'),false);
 const opted=res();await handleAudienceGateway(req({action:'enable'}),opted,deps);
 const cookie=opted.headers.get('Set-Cookie').split(';')[0];
 const disabled={...deps,environment:{}};
 const event=res();await handleAudienceGateway(req({action:'event',event:{kind:'presence'}},{cookie}),event,disabled);assert.equal(event.statusCode,403);
 const withdrawn=res();await handleAudienceGateway(req({action:'withdraw'},{cookie}),withdrawn,disabled);
 assert.equal(withdrawn.statusCode,200);assert.equal(calls.length,1);assert.match(withdrawn.headers.get('Set-Cookie'),/Max-Age=0/);
});

test('reconciled dashboard preserves authenticated profile counts with a separate first-party snapshot',async()=>{
 const token='aaaa.bbbb.cccc',calls=[];
 const current={...env,DLKT_INFO_ADMIN_PROFILE_EDGE_ENABLED:'1',DLKT_INFO_ANALYTICS_READ_ENABLED:'1',DLKT_INFO_ANALYTICS_VERCEL_TOKEN:'unused',DLKT_INFO_ANALYTICS_SINCE:'2026-11-25T18:00:00Z'};
 const data=await readAnalytics({...core,publishableKey:'sb_publishable_'+'p'.repeat(30)},current,'24h',async(url,init)=>{
  const u=new URL(url);calls.push(u.pathname);
  if(u.pathname==='/functions/v1/dlkt-control-profile-count'){
   assert.equal(u.origin,core.url);assert.equal(init.headers.Authorization,'Bearer '+token);assert.equal(u.searchParams.get('range'),'24h');
   return json({version:'dlkt-control-profile-count-1',range:'24h',profiles:3,newProfiles:1});
  }
  assert.equal(u.pathname,'/rest/v1/rpc/snapshot');assert.equal(u.origin,'https://'+config.projectRef+'.supabase.co');assert.equal(init.headers.Authorization,undefined);return json(raw);
 },now,token);
 assert.equal(calls.length,2);assert.equal(data.firstParty.status,'ready');assert.equal(data.profiles,3);assert.equal(data.newProfiles,1);assert.equal(data.totals,null);
 const html=renderDashboard(data);assert.match(html,/Reader profiles/);assert.match(html,/Consenting browsers/);assert.match(html,/Bucharest/);
 assert.doesNotMatch(html,/sb_secret_|aaaa\.bbbb/);
});
