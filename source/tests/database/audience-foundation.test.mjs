import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
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
