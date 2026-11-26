import test from 'node:test';
import assert from 'node:assert/strict';
import {adminIds,parseRange,rangeStart,parseTotals,parseRows,parseContentRange,readAnalytics} from '../.build/src/admin/analytics.js';
import {renderDashboard,escapeHtml} from '../.build/src/admin/render.js';
import {handleAdmin} from '../.build/api/admin.js';
const id='01234567-89ab-cdef-0123-456789abcdef';
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
