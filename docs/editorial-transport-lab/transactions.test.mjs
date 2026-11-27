import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';

const exec=promisify(execFile),container=process.env.TEST_CONTAINER;
if(!container||!/^[a-f0-9]{64}$/u.test(container))throw Error('DISPOSABLE_CONTAINER_REQUIRED');
const db='editorial_transport_test',s='dlkt_editorial_transport_lab';
const roles={issuer:'dlkt_et_issuer',writer:'dlkt_et_writer',observer:'dlkt_et_observer',reaper:'dlkt_et_reaper',untrusted:'dlkt_et_untrusted'};
function args(role,sql,app){
 const credentials=role==='admin'?[]:['-e','PGPASSWORD=fixture-et-'+role+'-only'];
 const application=app?['-e','PGAPPNAME='+app]:[];
 return ['exec','-i',...credentials,...application,container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',
  ...(role==='admin'?[]:['-h','127.0.0.1']),'-U',role==='admin'?'postgres':roles[role],'-d',db,'-c',sql];
}
const options={encoding:'utf8',timeout:15000,maxBuffer:1024*1024};
const query=(role,sql)=>execFileSync('docker',args(role,sql),options).trim();
const independent=async(role,sql,app)=>(await exec('docker',args(role,sql,app),options)).stdout.trim();
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const digest=n=>n.toString(16).padStart(64,'0');
const dayExpr="(clock_timestamp() at time zone 'UTC')::date";
const issueSql=(key,day=dayExpr,purpose="'editorial-interactions'",notice="'dlkt-editorial-notice-lab-1'")=>
 "select "+s+".issue("+literal(key)+","+day+","+purpose+","+notice+");";
const batchSql=(key,counts='array[3,0,0,0,0]',overrides={})=>
 "select "+s+".ingest("+literal(key)+","+(overrides.day??dayExpr)+","+(overrides.version??"'dlkt-editorial-exposure-batch-lab-1'")+","+
 (overrides.scope??"'public-home-global-news-opt-in-lab'")+","+(overrides.taxonomy??"'iptc-media-topics-top-level-2026-10-16-dlkt-6'")+","+
 (overrides.coverage??"'document-only'")+","+counts+");";
const withdrawSql=key=>"select "+s+".withdraw("+literal(key)+");";
const inspect=()=>JSON.parse(query('observer','select '+s+'.inspect();'));
const issue=key=>query('issuer',issueSql(key));
const ingest=(key,counts,overrides)=>query('writer',batchSql(key,counts,overrides));
const withdraw=key=>query('writer',withdrawSql(key));
const reset=()=>{
 query('admin',"truncate "+s+".grants;update "+s+".window_state set issued=0,accepted=0,held=false,utc_day="+dayExpr+",last_seen=clock_timestamp() where singleton;");
};
const denied=(role,sql)=>assert.throws(()=>query(role,sql),error=>typeof error.stderr==='string'&&error.stderr.includes('42501'));
const sum=()=>inspect().counts.reduce((a,b)=>a+b,0);

test('fixture roles are independently authenticated, restricted and cannot read or change raw rows',()=>{
 for(const [role,name] of Object.entries(roles))assert.equal(query(role,'select current_user;'),name);
 for(const role of Object.keys(roles)){
  denied(role,'select * from '+s+'.grants;');denied(role,'select * from '+s+'.window_state;');
  denied(role,'delete from '+s+'.grants;');
  denied(role,'select '+s+'.advance();');
  denied(role,'select '+s+'.valid_counts(array[1,0,0,0,0]);');
 }
 denied('writer',issueSql(digest(1)));denied('issuer',batchSql(digest(1)));
 denied('observer',withdrawSql(digest(1)));denied('reaper','select '+s+'.inspect();');
 denied('untrusted','select '+s+'.inspect();');denied('writer','select '+s+'.sweep();');
 assert.equal(query('admin',"select rolcanlogin||':'||rolsuper||':'||rolbypassrls from pg_roles where rolname='dlkt_et_owner';"),'false:false:false');
 assert.equal(query('admin',"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='"+s+"' and c.relkind='r' and c.relrowsecurity;"),'2');
 assert.equal(query('admin',"select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='"+s+"' and p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig);"),'6');
});
test('issuance requires exact synthetic purpose and notice and never refreshes an existing grant',()=>{
 reset();const k=digest(1);
 assert.equal(query('issuer',issueSql(k,dayExpr,"'audience'")),'invalid');
 assert.equal(query('issuer',issueSql(k,dayExpr,"'editorial-interactions'","'old'")),'invalid');
 assert.equal(query('issuer',issueSql('bad')),'invalid');
 assert.equal(query('issuer',issueSql(k,"("+dayExpr+"-1)")),'outside-window');
 assert.equal(issue(k),'created');
 const receipt=query('admin',"select issued_at||'|'||expires_at from "+s+".grants where grant_digest="+literal(k)+";");
 assert.equal(issue(k),'duplicate');
 assert.equal(query('admin',"select issued_at||'|'||expires_at from "+s+".grants where grant_digest="+literal(k)+";"),receipt);
 assert.equal(query('admin',"select count(*) from "+s+".grants where expires_at>issued_at and expires_at<=issued_at+interval '15 minutes' and expires_at<=((("+dayExpr+")+1)::timestamp at time zone 'UTC');"),'1');
});
test('wire projection has strict independent version scope day coverage and bounded vector checks',()=>{
 reset();const k=digest(2);assert.equal(issue(k),'created');
 assert.equal(ingest(digest(9)),'unknown-grant');assert.equal(ingest('bad'),'unknown-grant');
 for(const overrides of [{day:"("+dayExpr+"-1)"},{version:"'old'"},{scope:"'other'"},{taxonomy:"'old'"},{coverage:"'complete'"},{coverage:'null'}])assert.equal(ingest(k,undefined,overrides),'invalid-batch');
 for(const counts of ['null::integer[]','array[0,0,0,0,0]','array[1,0,0,0]','array[1,0,0,0,0,0]','array[1,null,0,0,0]','array[-1,2,0,0,0]','array[501,0,0,0,0]','array[500,1,0,0,0]','array[[1,0,0,0,0],[1,0,0,0,0]]',"'[0:4]={1,0,0,0,0}'::integer[]"])assert.equal(ingest(k,counts),'invalid-batch');
 assert.equal(sum(),0);assert.equal(ingest(k,'array[0,2,0,0,0]'),'accepted');assert.deepEqual(inspect().counts,[0,2,0,0,0]);
});
test('exact replay counts once and conflicting retry cannot overwrite the vector',()=>{
 reset();const k=digest(3);assert.equal(issue(k),'created');
 assert.equal(ingest(k),'accepted');assert.equal(ingest(k),'duplicate');
 assert.equal(ingest(k,'array[4,0,0,0,0]'),'conflicting-replay');
 const v=inspect();assert.equal(v.status,'pending-only');assert.equal(v.coverage,'unsealed');
 assert.equal(v.pendingContributions,1);assert.equal(v.acceptedInLifetime,1);
 assert.equal(v.productionActivationAllowed,false);assert.equal(v.automationAllowed,false);assert.equal(sum(),3);
});
test('withdrawal removes a contribution, fences later writes and does not restore spent budget',()=>{
 reset();const a=digest(4),b=digest(5);assert.equal(issue(a),'created');assert.equal(issue(b),'created');
 assert.equal(ingest(a),'accepted');assert.equal(withdraw(a),'withdrawn');assert.equal(withdraw(a),'withdrawn');
 assert.equal(ingest(a),'revoked');assert.equal(issue(a),'revoked');
 assert.equal(withdraw(b),'withdrawn');assert.equal(ingest(b),'revoked');assert.equal(withdraw(digest(99)),'unknown-grant');
 const v=inspect();assert.equal(v.acceptedInLifetime,1);assert.equal(v.pendingContributions,0);assert.equal(sum(),0);
 assert.equal(query('admin',"select count(*) from "+s+".grants where state='revoked' and counts is null;"),'2');
});
test('database clock expiry and reaper remove pending data and prevent old grant reuse',()=>{
 reset();const k=digest(6);assert.equal(issue(k),'created');assert.equal(ingest(k),'accepted');
 query('admin',"update "+s+".grants set issued_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute' where grant_digest="+literal(k)+";");
 assert.equal(query('reaper','select '+s+'.sweep();'),'swept');
 assert.equal(ingest(k),'expired');assert.equal(issue(k),'expired');assert.equal(withdraw(k),'expired');assert.equal(sum(),0);
});
test('ended UTC window denies new issuance and never reports pending counts as a sealed daily snapshot',()=>{
 reset();const k=digest(7);assert.equal(issue(k),'created');assert.equal(ingest(k),'accepted');
 query('admin',"update "+s+".window_state set utc_day=utc_day-1 where singleton;update "+s+".grants set issued_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute';");
 const v=inspect();assert.equal(v.status,'outside-window');assert.deepEqual(v.counts,[]);assert.equal(v.coverage,'unsealed');
 assert.equal(issue(digest(8)),'outside-window');assert.equal(ingest(k),'expired');
});
test('database clock regression holds the instance, removes data and allows known-grant cleanup',()=>{
 reset();const k=digest(8);assert.equal(issue(k),'created');assert.equal(ingest(k),'accepted');
 query('admin',"update "+s+".window_state set last_seen=clock_timestamp()+interval '1 hour' where singleton;");
 const v=inspect();assert.equal(v.status,'held');assert.deepEqual(v.counts,[]);assert.equal(v.pendingContributions,0);
 assert.equal(ingest(k),'held');assert.equal(issue(digest(9)),'held');assert.equal(withdraw(k),'withdrawn');
 assert.equal(query('admin',"select count(*) from "+s+".grants where counts is not null;"),'0');
});
test('two independent authenticated connections cannot issue or accept the same grant twice',async()=>{
 reset();const k=digest(10);
 const issued=await Promise.all([independent('issuer',issueSql(k)),independent('issuer',issueSql(k))]);
 assert.deepEqual(issued.sort(),['created','duplicate']);
 const written=await Promise.all([independent('writer',batchSql(k)),independent('writer',batchSql(k))]);
 assert.deepEqual(written.sort(),['accepted','duplicate']);assert.equal(sum(),3);assert.equal(inspect().acceptedInLifetime,1);
});
test('conflicting simultaneous writes retain exactly one original vector',async()=>{
 reset();const k=digest(11);assert.equal(issue(k),'created');
 const results=await Promise.all([independent('writer',batchSql(k,'array[3,0,0,0,0]')),independent('writer',batchSql(k,'array[4,0,0,0,0]'))]);
 assert.deepEqual(results.slice().sort(),['accepted','conflicting-replay']);
 assert.equal(sum(),results[0]==='accepted'?3:4);assert.equal(inspect().pendingContributions,1);
});
test('withdrawal and ingestion from independent workers cannot leave a surviving revoked vector',async()=>{
 reset();const k=digest(12);assert.equal(issue(k),'created');
 const [write,removed]=await Promise.all([independent('writer',batchSql(k)),independent('writer',withdrawSql(k))]);
 assert.ok(['accepted','revoked'].includes(write));assert.equal(removed,'withdrawn');
 assert.equal(ingest(k),'revoked');assert.equal(sum(),0);
});
async function waitForActivity(app,predicate){
 for(let attempt=0;attempt<30;attempt++){
  const rows=JSON.parse(query('admin',"select coalesce(json_agg(json_build_object('state',state,'waitType',wait_event_type,'wait',wait_event)),'[]'::json) from pg_stat_activity where application_name="+literal(app)+";"));
  if(rows.some(predicate))return;
  await delay(80);
 }
 throw Error('EXPECTED_INDEPENDENT_SESSION_WAIT_NOT_OBSERVED');
}
test('a concurrent withdrawal is actually blocked by the ingestion transaction until commit, then erases its vector',async()=>{
 reset();const k=digest(13);assert.equal(issue(k),'created');
 const first=independent('writer','begin;'+batchSql(k)+'select pg_sleep(4);commit;','edlab-ingest-hold');
 let second;
 try{
  await waitForActivity('edlab-ingest-hold',row=>row.wait==='PgSleep');
  second=independent('writer',withdrawSql(k),'edlab-withdraw-wait');
  await waitForActivity('edlab-withdraw-wait',row=>row.waitType==='Lock');
  assert.equal((await first).split('\n')[0],'accepted');
  assert.equal(await second,'withdrawn');assert.equal(ingest(k),'revoked');assert.equal(sum(),0);
 }finally{await Promise.allSettled([first,...(second?[second]:[])]);}
});
test('rollback of an uncommitted write cannot consume admission or create an accepted replay',()=>{
 reset();const k=digest(14);assert.equal(issue(k),'created');
 assert.equal(query('writer','begin;'+batchSql(k)+'rollback;'),'accepted');
 assert.equal(sum(),0);assert.equal(inspect().acceptedInLifetime,0);
 assert.equal(ingest(k),'accepted');assert.equal(sum(),3);
});
test('lifetime caps serialize the last admission and are not recycled by withdrawal',async()=>{
 reset();
 const issued=query('issuer',"select "+s+".issue(lpad(to_hex(n),64,'0'),"+dayExpr+",'editorial-interactions','dlkt-editorial-notice-lab-1') from generate_series(1,256) n;");
 assert.equal(issued.split('\n').length,256);assert.ok(issued.split('\n').every(v=>v==='created'));
 assert.equal(issue(digest(257)),'capacity');
 const accepted=query('writer',"select "+s+".ingest(lpad(to_hex(n),64,'0'),"+dayExpr+",'dlkt-editorial-exposure-batch-lab-1','public-home-global-news-opt-in-lab','iptc-media-topics-top-level-2026-10-16-dlkt-6','document-only',array[1,0,0,0,0]) from generate_series(1,127) n;");
 assert.equal(accepted.split('\n').length,127);assert.ok(accepted.split('\n').every(v=>v==='accepted'));
 const a=digest(128),b=digest(129),results=await Promise.all([independent('writer',batchSql(a,'array[1,0,0,0,0]')),independent('writer',batchSql(b,'array[1,0,0,0,0]'))]);
 assert.deepEqual(results.slice().sort(),['accepted','capacity']);
 const winner=results[0]==='accepted'?a:b,loser=winner===a?b:a;
 assert.equal(ingest(winner,'array[1,0,0,0,0]'),'duplicate');assert.equal(sum(),128);
 assert.equal(withdraw(winner),'withdrawn');assert.equal(ingest(loser,'array[1,0,0,0,0]'),'capacity');
 assert.equal(inspect().acceptedInLifetime,128);assert.equal(sum(),127);assert.equal(issue(digest(257)),'capacity');
});
