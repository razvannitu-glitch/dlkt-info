import test from 'node:test';
import assert from 'node:assert/strict';
import {adminIds,parseRange,rangeStart,parseTotals,parseRows,parseContentRange,readAnalytics} from '../.build/src/admin/analytics.js';
import {renderDashboard,escapeHtml} from '../.build/src/admin/render.js';
import {handleAdmin} from '../.build/api/admin.js';
const id='11111111-1111-4111-8111-111111111111';
test('admin allowlist fails closed and uses exact UUIDs',()=>{
 assert.equal(adminIds({DLKT_INFO_ADMIN_USER_IDS:id}).size,0);
 assert.equal(adminIds({DLKT_INFO_ADMIN_ENABLED:'1',DLKT_INFO_ADMIN_USER_IDS:id+',bad'}).size,0);
 assert.ok(adminIds({DLKT_INFO_ADMIN_ENABLED:'1',DLKT_INFO_ADMIN_USER_IDS:id}).has(id));
});
test('range and provider contracts do not confuse missing with zero',()=>{
 assert.equal(parseRange(null),'7d');assert.equal(parseRange('bad'),null);
 assert.equal(rangeStart('24h',new Date('2026-11-26T00:00:00Z')),'2026-11-25T00:00:00.000Z');
 assert.deepEqual(parseTotals({data:{visitors:0,pageviews:0}}),{visitors:0,pageviews:0});
 assert.equal(parseTotals({data:{visitors:-1,pageviews:0}}),null);
 assert.equal(parseContentRange('*/0'),0);assert.equal(parseContentRange('0-0/*'),null);
 assert.equal(parseRows({data:[{country:'RO',visitors:1,pageviews:'2'}]},'country'),null);
 assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});
test('disabled admin does not contact providers or reveal counts',async()=>{
 const headers=new Map();let body='';
 const res={setHeader:(k,v)=>headers.set(k,v),end:v=>{body=v;}};
 await handleAdmin({method:'GET',headers:{host:'www.dlkt.ee'},url:'/admin'},res,{environment:{},fetch:async()=>{throw Error('unexpected network');}});
 assert.equal(res.statusCode,404);assert.equal(headers.get('Cache-Control'),'private, no-store, max-age=0');assert.doesNotMatch(body,/Unique visitors/);
});
test('profile counts are aggregate only and missing audience remains unknown',async()=>{
 const config={url:'https://example.supabase.co'};
 const env={DLKT_INFO_SUPABASE_SECRET_KEY:'sb_secret_abcdefghijklmnopqrstuvwxyz'};
 let calls=0;
 const data=await readAnalytics(config,env,'7d',async(url,init)=>{
  calls++;assert.equal(init.method,'HEAD');assert.equal(url.pathname,'/rest/v1/dlkt_info_profiles');
  return new Response(null,{status:206,headers:{'content-range':calls===1?'0-0/3':'*/0'}});
 },new Date('2026-11-26T00:00:00Z'));
 assert.equal(calls,2);assert.equal(data.profiles,3);assert.equal(data.newProfiles,0);assert.equal(data.totals,null);
 const html=renderDashboard(data);assert.match(html,/Audience measurement not configured/);assert.match(html,/Reader profiles/);assert.match(html,/—/);
});

const other='22222222-2222-4222-8222-222222222222';
const token='aaaaaaaa.bbbbbbbb.cccccccc';
const adminEnvironment={
 NODE_ENV:'production',DLKT_INFO_ADMIN_ENABLED:'1',DLKT_INFO_ADMIN_USER_IDS:id,
 DLKT_INFO_ACCOUNT_BRIDGE_ENABLED:'1',DLKT_INFO_AUTH_EMAIL_READY:'1',
 DLKT_INFO_SUPABASE_PROJECT_REF:'abcdefghijklmnopqrst',
 DLKT_INFO_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',
 DLKT_INFO_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'x'.repeat(30),
 DLKT_INFO_DATA_FOUNDATION_READY:'1',DLKT_INFO_AUTH_ENABLED:'1',
 DLKT_INFO_SUPABASE_SECRET_KEY:'sb_secret_'+'x'.repeat(30)
};
const provision={configured:true,schemaVerified:true,capabilities:{auth:true,persistence:true}};
function makeRequest(extras={},url='/admin'){
 return {method:'GET',url,headers:{host:'www.dlkt.ee','sec-fetch-site':'same-origin',cookie:'__Host-dlkt_info_at='+token,...extras}};
}
function makeResponse(){
 return {statusCode:0,headers:new Map(),body:'',setHeader(k,v){this.headers.set(k,v);},end(v){this.body=v;}};
}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});}
function denied(res,status){
 assert.equal(res.statusCode,status);assert.doesNotMatch(res.body,/Unique visitors|Reader profiles/);
 assert.equal(res.headers.get('Cache-Control'),'private, no-store, max-age=0');
 assert.equal(res.headers.get('Vary'),'Cookie');
}
test('missing cookie, hostile host, cross-site navigation, duplicate or invalid ranges never query providers',async()=>{
 const cases=[
  [makeRequest({cookie:''}),401],
  [makeRequest({host:'evil.example'}),403],
  [makeRequest({'sec-fetch-site':'cross-site'}),403],
  [makeRequest({},'/admin?range=7d&range=30d'),400],
  [makeRequest({},'/admin?range=7d&user='+id),400],
  [makeRequest({},'/admin?range=unknown'),400],
  [{...makeRequest(),method:'POST'},405]
 ];
 for(const [req,status] of cases){
  let calls=0;const res=makeResponse();
  await handleAdmin(req,res,{environment:adminEnvironment,provisioning:provision,fetch:async()=>{calls++;throw Error('network forbidden');}});
  denied(res,status);assert.equal(calls,0);
 }
});
test('schema gate failure denies even a valid-looking cookie',async()=>{
 const res=makeResponse();let calls=0;
 await handleAdmin(makeRequest(),res,{environment:adminEnvironment,provisioning:{...provision,schemaVerified:false},fetch:async()=>{calls++;throw Error('network forbidden');}});
 denied(res,503);assert.equal(calls,0);
});
test('a normal account cannot gain admin access using editable metadata or request headers',async()=>{
 const res=makeResponse();const calls=[];
 await handleAdmin(makeRequest({'x-user-id':id,'x-admin':'1'}),res,{environment:adminEnvironment,provisioning:provision,fetch:async(url,init)=>{
  calls.push(String(url));assert.equal(init.headers.Authorization,'Bearer '+token);
  return json({id:other,email:'normal@example.test',user_metadata:{id,role:'admin',admin:true}});
 }});
 denied(res,403);assert.equal(calls.length,1);assert.match(calls[0],/\/auth\/v1\/user$/);
});
test('expired or rejected identity does not query aggregates',async()=>{
 const res=makeResponse();let calls=0;
 await handleAdmin(makeRequest(),res,{environment:adminEnvironment,provisioning:provision,fetch:async()=>{calls++;return json({message:'invalid token'},401);}});
 denied(res,401);assert.equal(calls,1);
});
test('verified administrator sees only aggregate data and no credentials',async()=>{
 const res=makeResponse();const calls=[];
 await handleAdmin(makeRequest({},'/admin?range=all'),res,{environment:adminEnvironment,provisioning:provision,fetch:async(url,init)=>{
  const u=new URL(url);calls.push(u.pathname);
  if(u.pathname==='/auth/v1/user')return json({id,email:'admin@example.test'});
  assert.equal(u.pathname,'/rest/v1/dlkt_info_profiles');assert.equal(init.method,'HEAD');assert.equal(u.searchParams.get('select'),'id');
  return new Response(null,{status:206,headers:{'content-range':'0-0/3'}});
 }});
 assert.equal(res.statusCode,200);assert.deepEqual(calls,['/auth/v1/user','/rest/v1/dlkt_info_profiles']);
 assert.match(res.body,/Reader profiles/);assert.match(res.body,/>3</);assert.doesNotMatch(res.body,/admin@example\.test|sb_secret_|aaaaaaaa\.bbbbbbbb/);
 assert.equal(res.headers.get('Cache-Control'),'private, no-store, max-age=0');
 assert.match(res.headers.get('Content-Security-Policy'),/default-src 'none'/);
});
test('audience queries remain fixed to the production project, actual activation and allowed dimensions',async()=>{
 const calls=[];const config={url:'https://example.supabase.co'};
 const env={DLKT_INFO_ANALYTICS_READ_ENABLED:'1',DLKT_INFO_ANALYTICS_VERCEL_TOKEN:'test-server-token',DLKT_INFO_ANALYTICS_SINCE:'2026-11-25T18:00:00Z'};
 const now=new Date('2026-11-26T00:00:00Z');
 const result=await readAnalytics(config,env,'7d',async(url,init)=>{
  const u=new URL(url);calls.push(u);
  assert.equal(u.hostname,'api.vercel.com');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  assert.equal(u.searchParams.get('projectId'),'prj_3JKAWw8EvzWKNPqFNFxk4iDL2l7P');
  assert.equal(u.searchParams.get('teamId'),'team_ohj6PflzAec8005UK4uiAqFw');
  assert.equal(u.searchParams.get('filter'),"environment eq 'production'");
  assert.equal(u.searchParams.get('until'),now.toISOString());
  const by=u.searchParams.get('by');
  if(!by)return json({data:{visitors:5,pageviews:8}});
  if(by==='day')return json({data:[{timestamp:'2026-11-25T00:00:00Z',visitors:5,pageviews:8}]});
  if(by==='country')return json({data:[{country:'RO',visitors:5,pageviews:8}]});
  if(by==='referrerHostname')return json({data:[{referrerHostname:'<script>alert(1)</script>',visitors:5,pageviews:8}]});
  return json({data:[]});
 },now);
 assert.equal(calls.length,7);
 assert.deepEqual(result.totals,{visitors:5,pageviews:8});
 assert.deepEqual(result.countries,[{label:'RO',visitors:5,pageviews:8}]);
 assert.equal(result.audienceSince,'2026-11-25T18:00:00.000Z');
 assert.ok(calls.some(u=>u.searchParams.get('since')==='2026-11-25T23:30:00.000Z'));
 assert.ok(calls.every(u=>u.searchParams.get('since')>=result.audienceSince));
 const html=renderDashboard(result);
 assert.doesNotMatch(html,/<script>alert/);
 assert.match(html,/&lt;script&gt;alert/);
});
test('upstream failure and invalid payload do not manufacture a zero count',async()=>{
 const data=await readAnalytics({url:'https://example.supabase.co'},{
 DLKT_INFO_ANALYTICS_READ_ENABLED:'1',DLKT_INFO_ANALYTICS_VERCEL_TOKEN:'test-token',DLKT_INFO_ANALYTICS_SINCE:'2026-11-25T18:00:00Z'
 },'7d',async()=>json({data:{visitors:'0',pageviews:0}}),new Date('2026-11-26T00:00:00Z'));
 assert.equal(data.totals,null);assert.equal(data.recent,null);assert.equal(data.daily,null);
 assert.match(renderDashboard(data),/Audience source unavailable/);
});
