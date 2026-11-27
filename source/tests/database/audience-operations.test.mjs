import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db;
async function role(name,fn){await db.exec('set role '+name);try{return await fn();}finally{await db.exec('reset role');}}
async function value(sql,p=[]){return role('service_role',async()=>(await db.query(sql,p)).rows[0].value);}
before(async()=>{
 db=new PGlite();await db.waitReady;
 await db.exec('create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;');
 await db.exec(await readFile('scripts/audience-schema.sql','utf8'));
 await db.exec(await readFile('scripts/audience-operational.sql','utf8'));
});
after(async()=>{if(db)await db.close();});
test('admission closes before successful maintenance or after stale maintenance',async()=>{
 const ready=()=>value('select dlkt_audience.operational_ready() as value');
 const admit=action=>value('select dlkt_audience.admit_request($1) as value',[action]);
 assert.equal(await ready(),false);assert.equal(await admit('event'),false);
 await value('select dlkt_audience.run_maintenance() as value');
 assert.equal(await ready(),true);assert.equal(await admit('event'),true);
 await db.exec("update dlkt_audience.maintenance set last_success_at=now()-interval '3 hours'");
 assert.equal(await ready(),false);assert.equal(await admit('enable'),false);
 await value('select dlkt_audience.run_maintenance() as value');
 assert.equal(await admit('enable'),true);assert.equal(await admit('other'),false);
});
test('shared pilot caps reject additional requests',async()=>{
 await db.exec("insert into dlkt_audience.usage_windows(action,period,bucket,used) values('enable','minute',date_trunc('minute',now()),60) on conflict(action,period,bucket) do update set used=60");
 assert.equal(await value("select dlkt_audience.admit_request('enable') as value"),false);
 await db.exec("insert into dlkt_audience.usage_windows(action,period,bucket,used) values('event','day',date_trunc('day',now(),'UTC'),50000) on conflict(action,period,bucket) do update set used=50000");
 assert.equal(await value("select dlkt_audience.admit_request('event') as value"),false);
});
test('operational functions and rate windows are inaccessible to ordinary roles',async()=>{
 for(const r of ['anon','authenticated'])await role(r,async()=>{
  await assert.rejects(db.query('select dlkt_audience.run_maintenance()'),{code:'42501'});
  await assert.rejects(db.query("select dlkt_audience.admit_request('enable')"),{code:'42501'});
  await assert.rejects(db.query('select * from dlkt_audience.usage_windows'),{code:'42501'});
 });
});
