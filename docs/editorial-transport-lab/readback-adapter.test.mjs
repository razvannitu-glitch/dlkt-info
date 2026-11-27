import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {NEWS_TAXONOMY_VERSION} from '../../source/.build/src/iceo/news-taxonomy.js';
import {EDITORIAL_PILOT_CATEGORIES} from '../../source/.build/src/audience/editorial-pilot.js';
import {EDITORIAL_BATCH_VERSION,EDITORIAL_BATCH_SCOPE,encodeEditorialExposureBatch} from '../../source/.build/src/audience/editorial-batch.js';
import {QualifiedExposureLab} from '../../source/.build/src/audience/editorial-exposure.js';
import {createEditorialReadbackLab} from './readback-adapter.mts';

const container=process.env.TEST_CONTAINER;
if(!container||!/^[a-f0-9]{64}$/u.test(container))throw Error('DISPOSABLE_CONTAINER_REQUIRED');
const db='editorial_transport_test',s='dlkt_editorial_transport_lab';
const names={issuer:'dlkt_et_issuer',writer:'dlkt_et_writer',observer:'dlkt_et_observer'};
function sql(role,statement,parameters={}){
 const args=['exec','-i',...(role==='admin'?[]:['-e','PGPASSWORD=fixture-et-'+role+'-only']),container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
  ...(role==='admin'?[]:['-h','127.0.0.1']),'-U',role==='admin'?'postgres':names[role],'-d',db];
 for(const [key,value] of Object.entries(parameters))args.push('-v',key+'='+value);
 args.push('-f','-');
 return execFileSync('docker',args,{input:statement+'\n',encoding:'utf8',timeout:15000,maxBuffer:1024*1024}).trim();
}
function reset(){
 sql('admin',"truncate "+s+".grants;update "+s+".window_state set issued=0,accepted=0,held=false,utc_day=(clock_timestamp() at time zone 'UTC')::date,last_seen=clock_timestamp() where singleton;");
 return sql('admin',"select utc_day::text from "+s+".window_state where singleton;");
}
const digest=n=>n.toString(16).padStart(64,'0');
const grant=(k,day)=>assert.equal(sql('issuer',"select "+s+".issue(:'key',:'day'::date,'editorial-interactions','dlkt-editorial-notice-lab-1');",{key:k,day}),'created');
function envelope(role,expression,params={}){
 return JSON.parse(sql(role,"select jsonb_build_object('database',current_database(),'sessionUser',session_user,'currentUser',current_user,'result',"+expression+");",params));
}
async function call(command){
 switch(command.kind){
  case 'ingest':{
   const b=command.batch;
   return envelope('writer',s+".ingest(:'key',:'day'::date,:'version',:'scope',:'taxonomy',:'coverage',:'counts'::integer[])",{
    key:command.digest,day:b.day,version:b.version,scope:b.scope,taxonomy:b.taxonomyVersion,coverage:b.coverage,counts:'{'+b.rows.map(r=>r.qualifiedImpressions).join(',')+'}',
   });
  }
  case 'withdraw':return envelope('writer',s+".withdraw(:'key')",{key:command.digest});
  case 'inspect':return envelope('observer',s+'.inspect()');
  default:throw Error('UNKNOWN_COMMAND');
 }
}
const payload=(day,n=3)=>Buffer.from(JSON.stringify({version:EDITORIAL_BATCH_VERSION,scope:EDITORIAL_BATCH_SCOPE,taxonomyVersion:NEWS_TAXONOMY_VERSION,day,coverage:'document-only',rows:EDITORIAL_PILOT_CATEGORIES.map((category,i)=>({category,qualifiedImpressions:i===0?n:0}))}));
const projection=reason=>({status:'unavailable',reason,productionActivationAllowed:false,automationAllowed:false});
const raw=()=>envelope('observer',s+'.inspect()').result;
const pending=()=>raw().counts.reduce((a,b)=>a+b,0);

test('canonical exposure bytes bind to real authenticated SQL and idempotent committed writes',async()=>{
 const day=reset(),k=digest(101);grant(k,day);
 const exposure=new QualifiedExposureLab();
 for(let t=0;t<=1000;t+=100)exposure.frame(t,[{key:'article:'+'a'.repeat(24),category:'05000000',qualified:true}]);
 const bytes=encodeEditorialExposureBatch(exposure.snapshot(),day);assert.ok(bytes);
 const adapter=createEditorialReadbackLab(day,call);
 assert.equal(await adapter.submit(k,bytes),'accepted');assert.equal(await adapter.submit(k,bytes),'duplicate');
 assert.equal(await adapter.submit(k,payload(day,2)),'conflicting-replay');
 assert.equal(raw().pendingContributions,1);assert.deepEqual(raw().counts,[1,0,0,0,0]);
 assert.deepEqual(await adapter.controlBoundary(),projection('unsealed'));
});
test('malformed wire bytes, mismatched day and malformed digest stop before any database call',async()=>{
 const day=reset();let calls=0;
 const adapter=createEditorialReadbackLab(day,async command=>{calls++;return call(command);});
 const k=digest(102);
 assert.equal(await adapter.submit('bad',payload(day)),'unknown-grant');
 assert.equal(await adapter.withdraw('bad'),'unknown-grant');
 assert.equal(await adapter.submit(k,Buffer.concat([Buffer.from(' '),payload(day)])),'invalid-batch');
 const different=day==='2026-01-01'?'2026-01-02':'2026-01-01';
 assert.equal(await adapter.submit(k,payload(different)),'invalid-batch');assert.equal(calls,0);
 assert.equal(await adapter.submit(k,payload(day)),'unknown-grant');assert.equal(calls,1);
});
test('withdrawal through the authenticated writer removes the pending vector and fences replay',async()=>{
 const day=reset(),k=digest(103);grant(k,day);const adapter=createEditorialReadbackLab(day,call);
 assert.equal(await adapter.submit(k,payload(day)),'accepted');assert.equal(pending(),3);
 assert.equal(await adapter.withdraw(k),'withdrawn');assert.equal(await adapter.withdraw(k),'withdrawn');
 assert.equal(await adapter.submit(k,payload(day)),'revoked');assert.equal(pending(),0);
 assert.deepEqual(await adapter.controlBoundary(),projection('unsealed'));
});
test('ambiguous commit or cleanup response remains indeterminate; only an explicit retry can confirm',async()=>{
 const day=reset(),k=digest(104);grant(k,day);let ambiguousWrite=true,ambiguousCleanup=true;
 const adapter=createEditorialReadbackLab(day,async command=>{
  const result=await call(command);
  if(command.kind==='ingest'&&ambiguousWrite){ambiguousWrite=false;throw Error('synthetic lost acknowledgment');}
  if(command.kind==='withdraw'&&ambiguousCleanup){ambiguousCleanup=false;throw Error('synthetic lost cleanup acknowledgment');}
  return result;
 });
 assert.equal(await adapter.submit(k,payload(day)),'indeterminate');assert.equal(pending(),3);
 assert.equal(await adapter.submit(k,payload(day)),'duplicate');assert.equal(pending(),3);
 assert.equal(await adapter.withdraw(k),'indeterminate');assert.equal(pending(),0);
 assert.equal(await adapter.withdraw(k),'withdrawn');
});
test('pending quantities never cross the Control boundary, even when large or all zero',async()=>{
 const day=reset(),adapter=createEditorialReadbackLab(day,call);
 const before=await adapter.controlBoundary();assert.deepEqual(before,projection('unsealed'));
 for(let i=110;i<113;i++){const k=digest(i);grant(k,day);assert.equal(await adapter.submit(k,payload(day,500)),'accepted');}
 assert.equal(pending(),1500);assert.deepEqual(await adapter.controlBoundary(),before);
});
test('role mismatch, incorrect database and corrupt acknowledgment fail closed without leaking details',async()=>{
 const day=reset(),k=digest(105);
 for(const wrong of [{database:'other'},{sessionUser:'dlkt_et_observer'},{currentUser:'dlkt_et_owner'},{unexpected:'secret'}]){
  const adapter=createEditorialReadbackLab(day,async()=>({database:db,sessionUser:names.writer,currentUser:names.writer,result:'accepted',...wrong}));
  assert.equal(await adapter.submit(k,payload(day)),'indeterminate');assert.equal(await adapter.withdraw(k),'indeterminate');
 }
 const adapter=createEditorialReadbackLab(day,async()=>{throw Error('fixture connection secret');});
 assert.equal(await adapter.submit(k,payload(day)),'indeterminate');assert.equal(await adapter.withdraw(k),'indeterminate');
 assert.deepEqual(await adapter.controlBoundary(),projection('provider-unavailable'));
});
test('unverified or contradictory diagnostic responses cannot become a daily metric or numeric zero',async()=>{
 const day=reset(),valid=await call({kind:'inspect'}),value=valid.result;
 for(const bad of [{...valid,currentUser:names.writer},{...valid,sessionUser:names.writer},{...valid,database:'other'},null,
  ...[{day:'2026-01-01'},{coverage:'complete'},{status:'ready'},{automationAllowed:true},{productionActivationAllowed:true},
   {pendingContributions:1,acceptedInLifetime:0},{counts:[0,0,0,0,1]},{counts:[0,0,0,0]},{counts:[null,0,0,0,0]},
   {counts:[-1,0,0,0,0]},{pendingContributions:1,acceptedInLifetime:1,counts:[0,0,0,0,0]},
   {pendingContributions:1,acceptedInLifetime:1,counts:[500,1,0,0,0]},{acceptedInLifetime:129},
   {status:'held',counts:[0,0,0,0,0]},{unexpected:'secret'}].map(change=>({...valid,result:{...value,...change}}))]){
  const adapter=createEditorialReadbackLab(day,async()=>bad);
  assert.deepEqual(await adapter.controlBoundary(),projection('invalid-readback'));
 }
});
test('real held and ended-window snapshots stay unavailable with no pending numbers',async()=>{
 const day=reset(),k=digest(106);grant(k,day);let adapter=createEditorialReadbackLab(day,call);
 assert.equal(await adapter.submit(k,payload(day)),'accepted');
 sql('admin',"update "+s+".window_state set last_seen=clock_timestamp()+interval '1 hour' where singleton;");
 assert.deepEqual(await adapter.controlBoundary(),projection('held'));assert.equal(await adapter.submit(k,payload(day)),'held');
 reset();
 const old=sql('admin',"update "+s+".window_state set utc_day=utc_day-1 where singleton returning utc_day::text;");
 adapter=createEditorialReadbackLab(old,call);
 assert.deepEqual(await adapter.controlBoundary(),projection('outside-window'));
});
