import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleProfileCountEdge,parseProfileCounts,PROFILE_COUNT_VERSION} from '../.build/src/admin/profile-count-edge.js';
import {readAnalytics} from '../.build/src/admin/analytics.js';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const token='aaaa.bbbb.cccc';
const config={origin:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_'+'x'.repeat(30),secretKey:'sb_secret_'+'y'.repeat(30),ownerDigest:createHash('sha256').update(owner).digest('hex')};
const user={id:owner,role:'authenticated',email_confirmed_at:'2026-11-20T12:00:00Z',is_anonymous:false};
const now=new Date('2026-11-27T12:00:00Z');
const req=(query='range=7d',auth='Bearer '+token,method='GET')=>new Request(config.origin+'/functions/v1/dlkt-control-profile-count?'+query,{method,headers:auth?{Authorization:auth}:{}});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
test('edge rejects missing credentials, bad queries and methods without provider reads',async()=>{
 for(const [request,status] of [[req('range=7d',''),401],[req('range=7d','Bearer invalid'),401],[req('range=7d&range=all'),400],[req('range=all&user='+owner),400],[req('range=bad'),400],[req('range=all','Bearer '+token,'POST'),405]]){
  let calls=0;const r=await handleProfileCountEdge(request,config,async()=>{calls++;throw Error('forbidden');},now);
  assert.equal(r.status,status);assert.equal(calls,0);assert.match(r.headers.get('cache-control'),/private, no-store/);
 }
});
test('edge uses authoritative user endpoint before any privileged count',async()=>{
 for(const identity of [{...user,id:other,user_metadata:{id:owner,admin:true}},{...user,is_anonymous:true},{...user,role:'anon'},{...user,email_confirmed_at:null}]){
  const paths=[];const r=await handleProfileCountEdge(req(),config,async(url,init)=>{paths.push(new URL(url).pathname);assert.equal(init.headers.Authorization,'Bearer '+token);assert.equal(init.headers.apikey,config.publishableKey);return json(identity);},now);
  assert.equal(r.status,403);assert.deepEqual(paths,['/auth/v1/user']);assert.doesNotMatch(await r.text(),/profiles|sb_secret_/);
 }
 const rejected=await handleProfileCountEdge(req(),config,async()=>json({},401),now);assert.equal(rejected.status,401);
});
test('edge authorized owner receives only bounded exact profile aggregates',async()=>{
 const paths=[];const r=await handleProfileCountEdge(req(),config,async(url,init)=>{
  const u=new URL(url);paths.push(u.pathname);
  assert.equal(u.origin,config.origin);assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  if(u.pathname==='/auth/v1/user')return json(user);
  assert.equal(u.pathname,'/rest/v1/dlkt_info_profiles');assert.equal(init.method,'HEAD');assert.equal(init.headers.apikey,config.secretKey);assert.equal(init.headers.Authorization,undefined);assert.equal(u.searchParams.get('select'),'id');
  const since=u.searchParams.get('created_at');if(since)assert.equal(since,'gte.2026-11-20T12:00:00.000Z');
  return new Response(null,{status:206,headers:{'content-range':since?'0-0/2':'0-0/3'}});
 },now);
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{version:PROFILE_COUNT_VERSION,range:'7d',profiles:3,newProfiles:2});assert.deepEqual(paths,['/auth/v1/user','/rest/v1/dlkt_info_profiles','/rest/v1/dlkt_info_profiles']);
});
test('edge all time uses one count; malformed upstream count fails closed',async()=>{
 let count=0;const r=await handleProfileCountEdge(req('range=all'),config,async(url)=>{if(new URL(url).pathname==='/auth/v1/user')return json(user);count++;return new Response(null,{status:200,headers:{'content-range':'*/0'}});},now);
 assert.equal(count,1);assert.deepEqual(await r.json(),{version:PROFILE_COUNT_VERSION,range:'all',profiles:0,newProfiles:0});
 const bad=await handleProfileCountEdge(req(),config,async(url)=>new URL(url).pathname==='/auth/v1/user'?json(user):new Response(null,{status:200,headers:{'content-range':'0-0/*'}}),now);assert.equal(bad.status,503);
 assert.equal(parseProfileCounts({version:PROFILE_COUNT_VERSION,range:'7d',profiles:1,newProfiles:2},'7d'),null);
});
test('dashboard reads one fixed edge function with verified session token and never falls back to privileged credential when enabled',async()=>{
 const env={DLKT_INFO_ADMIN_PROFILE_EDGE_ENABLED:'1',DLKT_INFO_SUPABASE_SECRET_KEY:config.secretKey};
 const p={url:config.origin,publishableKey:config.publishableKey};
 let calls=0;const data=await readAnalytics(p,env,'7d',async(url,init)=>{
  calls++;const u=new URL(url);assert.equal(u.pathname,'/functions/v1/dlkt-control-profile-count');assert.equal(u.searchParams.get('range'),'7d');assert.equal(init.headers.Authorization,'Bearer '+token);assert.equal(init.headers.apikey,config.publishableKey);assert.equal(init.redirect,'error');
  return json({version:PROFILE_COUNT_VERSION,range:'7d',profiles:3,newProfiles:2});
 },now,token);
 assert.equal(calls,1);assert.equal(data.profiles,3);assert.equal(data.newProfiles,2);assert.equal(data.totals,null);
 const failed=await readAnalytics(p,env,'7d',async()=>{calls++;return json({},503);},now,token);
 assert.equal(calls,2);assert.equal(failed.profiles,null);assert.equal(failed.newProfiles,null);
 const unauth=await readAnalytics(p,env,'7d',async()=>{throw Error('no network');},now);
 assert.equal(unauth.profiles,null);
});
