import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {Readable} from 'node:stream';
import {SupabaseAudienceStore} from '../../.build/src/audience/storage.js';
import {handleAudienceGateway} from '../../.build/src/audience/gateway.js';
import {readAnalytics} from '../../.build/src/admin/analytics.js';
import {renderDashboard} from '../../.build/src/admin/render.js';
let db;
const key=n=>n.toString(16).padStart(64,'0');
const event=n=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
async function asRole(role,fn){
 await db.exec('set role '+role);
 try{return await fn();}finally{await db.exec('reset role');}
}
async function record(browser,kind,id=null,country=null,city=null,source=null){
 return asRole('service_role',async()=>(await db.query('select dlkt_audience.record_activity($1,$2,$3,$4,$5,$6) as result',[browser,kind,id,country,city,source])).rows[0].result);
}
async function snapshot(hours=24){return asRole('service_role',async()=>(await db.query('select dlkt_audience.snapshot($1) as value',[hours])).rows[0].value);}
before(async()=>{
 db=new PGlite();await db.waitReady;
 await db.exec('create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;');
 const sql=await readFile('scripts/audience-schema.sql','utf8');
 assert.equal((sql.match(/create table dlkt_audience\./g)??[]).length,4);
 assert.equal((sql.match(/create function dlkt_audience\./g)??[]).length,4);
 assert.equal((sql.match(/\$\$/g)??[]).length,8);
 assert.equal((sql.match(/^commit;$/gm)??[]).length,1);
 await db.exec(sql);
});
after(async()=>{if(db)await db.close();});
test('isolated schema has no anonymous or normal authenticated access',async()=>{
 for(const role of ['anon','authenticated']){
  await asRole(role,async()=>{
   await assert.rejects(db.query('select dlkt_audience.snapshot(24)'),{code:'42501'});
   await assert.rejects(db.query('select * from dlkt_audience.browsers'),{code:'42501'});
   await assert.rejects(db.query('select dlkt_audience.record_activity($1,$2,$3,$4,$5,$6)',[key(1),'pageview',event(1),'RO','Bucharest','direct']),{code:'42501'});
  });
 }
 const tables=(await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dlkt_audience' and c.relkind='r' order by relname")).rows;
 assert.equal(tables.length,4);assert.ok(tables.every(row=>row.relrowsecurity));
 const functions=(await db.query("select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dlkt_audience'")).rows;
 assert.equal(functions.length,4);assert.ok(functions.every(row=>!row.prosecdef));
});
test('event retries do not inflate pageviews; presence does not create browsers or sessions',async()=>{
 assert.equal(await record(key(99),'presence'),'no-session');
 assert.equal(await record(key(1),'pageview',event(1),'RO','Bucharest','direct'),'accepted');
 assert.equal(await record(key(1),'pageview',event(1),'RO','Bucharest','direct'),'duplicate');
 assert.equal(await record(key(1),'presence'),'accepted');
 const s=await snapshot();
 assert.equal(s.visitors,1);assert.equal(s.pageviews,1);assert.equal(s.sessionStarts,1);assert.equal(s.active5m,1);
 assert.deepEqual(s.cities,[]);assert.deepEqual(s.countries,[]);
 await assert.rejects(record(key(2),'presence',null,'RO'),{code:'22023'});
 await assert.rejects(record('bad','pageview',event(2),'RO','Bucharest','direct'),{code:'22023'});
});
test('30-minute inactivity creates a new entry session, not a second visitor',async()=>{
 await db.query("update dlkt_audience.sessions set started_at=now()-interval '31 minutes',last_seen=now()-interval '31 minutes' where browser_key=$1",[key(1)]);
 assert.equal(await record(key(1),'presence'),'no-session');
 assert.equal(await record(key(1),'pageview',event(2),'RO','Bucharest','search'),'accepted');
 const s=await snapshot();
 assert.equal(s.visitors,1);assert.equal(s.pageviews,2);assert.equal(s.sessionStarts,2);assert.equal(s.repeatBrowsers,1);assert.equal(s.active5m,1);
});
test('cities and countries are shown only above the distinct-browser privacy threshold',async()=>{
 assert.equal(await record(key(2),'pageview',event(3),'RO','Bucharest','search'),'accepted');
 assert.equal(await record(key(3),'pageview',event(4),'RO','Bucharest','direct'),'accepted');
 assert.equal(await record(key(4),'pageview',event(5),'US','New York','referral'),'accepted');
 const s=await snapshot();
 assert.equal(s.visitors,4);assert.equal(s.pageviews,5);assert.equal(s.sessionStarts,5);assert.equal(s.active5m,4);
 assert.deepEqual(s.countries,[{country:'RO',visitors:3,sessions:4}]);
 assert.deepEqual(s.cities,[{country:'RO',city:'Bucharest',visitors:3,sessions:4}]);
 assert.equal(s.series.reduce((a,b)=>a+b.pageviews,0),5);
 assert.equal(s.series.reduce((a,b)=>a+b.sessionStarts,0),5);
 assert.equal(s.bucket,'hour');assert.equal((await snapshot(168)).bucket,'day');
 await assert.rejects(snapshot(1),{code:'22023'});
});
test('per-browser event limit bounds bursts without converting duplicate retries into views',async()=>{
 for(let n=100;n<130;n++)assert.equal(await record(key(5),'pageview',event(n),null,null,'unknown'),'accepted');
 assert.equal(await record(key(5),'pageview',event(130),null,null,'unknown'),'throttled');
 assert.equal(await record(key(5),'pageview',event(100),null,null,'unknown'),'duplicate');
 assert.equal((await snapshot()).pageviews,35);
});
test('withdrawal removes all linked session and pageview rows; expiry prunes retained history',async()=>{
 await asRole('service_role',()=>db.query('select dlkt_audience.forget_browser($1)',[key(5)]));
 assert.equal((await snapshot()).visitors,4);assert.equal((await snapshot()).pageviews,5);
 assert.equal(await record(key(5),'pageview',event(131),null,null,'unknown'),'revoked');
 assert.equal(await record(key(5),'presence'),'revoked');
 assert.equal((await snapshot()).pageviews,5);
 await db.query("update dlkt_audience.pageviews set observed_at=now()-interval '91 days' where browser_key=$1",[key(4)]);
 await db.query("update dlkt_audience.sessions set started_at=now()-interval '91 days',last_seen=now()-interval '91 days' where browser_key=$1",[key(4)]);
 await db.query("update dlkt_audience.revocations set expires_at=now()-interval '1 second' where browser_key=$1",[key(5)]);
 const purged=await asRole('service_role',async()=>(await db.query('select dlkt_audience.purge_expired() as value')).rows[0].value);
 assert.deepEqual(purged,{pageviews:1,sessions:1,browsers:1,revocations:1});
 assert.equal((await snapshot(null)).visitors,3);
 assert.equal((await snapshot(null)).pageviews,4);
});

test('integrated consent, gateway, SQL storage, admin snapshot and withdrawal use the same verified data contract',async()=>{
 const config={projectRef:'abcdefghijklmnopqrst',secretKey:'sb_secret_'+'x'.repeat(30)};
 const secret=Buffer.alloc(32,9).toString('base64url');
 const env={DLKT_INFO_AUDIENCE_COLLECT_ENABLED:'1',DLKT_INFO_AUDIENCE_RETENTION_READY:'1',DLKT_INFO_AUDIENCE_CONSENT_READY:'1',
  DLKT_INFO_AUDIENCE_READ_ENABLED:'1',DLKT_INFO_AUDIENCE_SUPABASE_PROJECT_REF:config.projectRef,DLKT_INFO_AUDIENCE_SUPABASE_SECRET_KEY:config.secretKey,
  DLKT_INFO_AUDIENCE_ACTIVATED_AT:new Date(Date.now()-86400000).toISOString()};
 const request=async(url,init)=>{
  const u=new URL(url),p=JSON.parse(init.body);
  assert.equal(u.origin,'https://'+config.projectRef+'.supabase.co');
  assert.equal(init.headers['Content-Profile'],'dlkt_audience');
  let value;
  switch(u.pathname){
   case '/rest/v1/rpc/snapshot':value=await snapshot(p.p_hours);break;
   case '/rest/v1/rpc/record_activity':value=await record(p.p_browser,p.p_kind,p.p_event,p.p_country,p.p_city,p.p_source);break;
   case '/rest/v1/rpc/forget_browser':
    await asRole('service_role',()=>db.query('select dlkt_audience.forget_browser($1)',[p.p_browser]));
    return new Response(null,{status:204});
   default:throw Error('UNEXPECTED_RPC');
  }
  return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
 };
 const store=new SupabaseAudienceStore(config,request);
 const deps={environment:env,store,secret,permit:async()=>true,trustedMetadata:true};
 async function send(body,cookie){
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.url='/api/audience';
  req.headers={host:'www.dlkt.ee',origin:'https://www.dlkt.ee','x-forwarded-proto':'https','x-dlkt-info-request':'audience-v1','content-type':'application/json','x-vercel-ip-country':'RO','x-vercel-ip-city':'Bucharest',...(cookie?{cookie}:{})};
  const res={statusCode:0,headers:new Map(),body:'',setHeader(k,v){this.headers.set(k,v);},end(v){this.body=v;}};
  await handleAudienceGateway(req,res,deps);return res;
 }
 const before=await store.snapshot(24);
 assert.equal((await send({action:'event',event:{kind:'pageview',id:event(999),source:'direct'}})).statusCode,401);
 const opt=await send({action:'enable'});assert.equal(opt.statusCode,200);
 const cookie=opt.headers.get('Set-Cookie').split(';')[0];
 const view={action:'event',event:{kind:'pageview',id:event(999),source:'direct'}};
 const first=await send(view,cookie);assert.equal(first.statusCode,200);assert.equal(JSON.parse(first.body).result,'accepted');
 const duplicate=await send(view,cookie);assert.equal(duplicate.statusCode,200);assert.equal(JSON.parse(duplicate.body).result,'duplicate');
 const stats=await readAnalytics({url:'https://example.supabase.co'},env,'24h',request,new Date());
 assert.equal(stats.firstParty.status,'ready');
 const measured=stats.firstParty.snapshot;
 assert.equal(measured.visitors,before.visitors+1);assert.equal(measured.pageviews,before.pageviews+1);
 assert.equal(measured.sessionStarts,before.sessionStarts+1);
 const html=renderDashboard(stats);assert.match(html,/Consenting browsers/);assert.match(html,/Bucharest/);
 assert.doesNotMatch(html,/__Host-dlkt_audience|sb_secret_|[a-f0-9]{64}/);
 const withdrew=await send({action:'withdraw'},cookie);assert.equal(withdrew.statusCode,200);
 assert.equal((await send(view,cookie)).statusCode,401);
 const after=await store.snapshot(24);assert.equal(after.visitors,before.visitors);assert.equal(after.pageviews,before.pageviews);
});
