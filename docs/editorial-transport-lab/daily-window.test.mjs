import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile),container=process.env.TEST_CONTAINER;
if(!container||!/^[a-f0-9]{64}$/u.test(container))throw Error('DISPOSABLE_CONTAINER_REQUIRED');
const db='editorial_transport_test',s='dlkt_editorial_transport_lab';
const roles=['issuer','writer','observer','reaper','untrusted','sealer'];
const day='2026-01-01',start=Date.parse(day+'T00:00:00.000Z'),end=start+86400000;
const time=ms=>new Date(ms).toISOString();
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
function args(role,sql){
 if(role!=='admin'&&!roles.includes(role))throw Error('UNKNOWN_ROLE');
 return ['exec','-i',...(role==='admin'?[]:['-e','PGPASSWORD=fixture-et-'+role+'-only']),container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',
  ...(role==='admin'?[]:['-h','127.0.0.1']),'-U',role==='admin'?'postgres':'dlkt_et_'+role,'-d',db,'-c',sql];
}
const options={encoding:'utf8',timeout:15000,maxBuffer:1024*1024};
const query=(role,sql)=>execFileSync('docker',args(role,sql),options).trim();
const independent=async(role,sql)=>(await exec('docker',args(role,sql),options)).stdout.trim();
const digest=n=>n.toString(16).padStart(64,'0');
const keyExpr="lpad(to_hex(n),64,'0')";
const issueSql=k=>"select "+s+".issue("+literal(k)+","+literal(day)+"::date,'editorial-interactions','dlkt-editorial-notice-lab-1');";
const batchSql=(k,counts=[5,5,5,5,5])=>"select "+s+".ingest("+literal(k)+","+literal(day)+"::date,'dlkt-editorial-exposure-batch-lab-1','public-home-global-news-opt-in-lab','iptc-media-topics-top-level-2026-10-16-dlkt-6','document-only',array["+counts.join(',')+"]);";
const withdrawSql=k=>"select "+s+".withdraw("+literal(k)+");";
const sealSql='select '+s+'.seal_daily();',readSql='select '+s+'.read_daily();';
const issue=k=>query('issuer',issueSql(k)),ingest=(k,counts)=>query('writer',batchSql(k,counts));
const withdraw=k=>query('writer',withdrawSql(k)),seal=()=>query('sealer',sealSql),read=()=>JSON.parse(query('observer',readSql));
const countGrants=()=>Number(query('admin','select count(*) from '+s+'.grants;'));
const countVectors=()=>Number(query('admin','select count(*) from '+s+'.grants where counts is not null;'));
const setClock=ms=>query('admin',"update "+s+".window_state set fixture_clock="+literal(time(ms))+"::timestamptz where singleton;");
const reset=()=>{
 query('admin',"truncate "+s+".grants;update "+s+".window_state set utc_day="+literal(day)+"::date,last_seen="+literal(time(start))+"::timestamptz,fixture_clock="+literal(time(start))+"::timestamptz,held=false,daily_phase='open',sealed_counts=null,sealed_at=null,issued=0,accepted=0 where singleton;");
};
const denied=(role,sql)=>assert.throws(()=>query(role,sql),err=>typeof err.stderr==='string'&&err.stderr.includes('42501'));
function seed(n,counts=[5,5,5,5,5]){
 const issued=query('issuer',"select "+s+".issue("+keyExpr+","+literal(day)+"::date,'editorial-interactions','dlkt-editorial-notice-lab-1') from generate_series(1,"+n+") n;");
 assert.equal(issued.split('\n').length,n);assert.ok(issued.split('\n').every(v=>v==='created'));
 const written=query('writer',"select "+s+".ingest("+keyExpr+","+literal(day)+"::date,'dlkt-editorial-exposure-batch-lab-1','public-home-global-news-opt-in-lab','iptc-media-topics-top-level-2026-10-16-dlkt-6','document-only',array["+counts.join(',')+"]) from generate_series(1,"+n+") n;");
 assert.equal(written.split('\n').length,n);assert.ok(written.split('\n').every(v=>v==='accepted'));
}
const rows=n=>['05000000','06000000','13000000','15000000','17000000'].map(category=>({category,qualifiedImpressions:n}));
function status(expected,expectedRows=[]){
 const v=read();
 assert.deepEqual(Object.keys(v).sort(),['automationAllowed','coverage','day','productionActivationAllowed','rows','scope','sealedAt','status','taxonomyVersion','version']);
 assert.equal(v.status,expected);assert.equal(v.day,day);assert.equal(v.coverage,'observed-documents-only');
 assert.equal(v.productionActivationAllowed,false);assert.equal(v.automationAllowed,false);
 assert.equal(v.version,'dlkt-editorial-daily-lab-1');
 assert.equal(v.scope,'public-home-global-news-opt-in-lab');
 assert.equal(v.taxonomyVersion,'iptc-media-topics-top-level-2026-10-16-dlkt-6');
 assert.deepEqual(v.rows,expectedRows);
 if(['sealed-lab','suppressed'].includes(expected))assert.match(v.sealedAt,/^2026-01-02T00:1[5-9]:\d{2}\.\d{6}Z$/u);else assert.equal(v.sealedAt,null);
 return v;
}

test('daily role boundaries hide pending diagnostics, raw rows, test clock and sealing authority',()=>{
 reset();
 assert.equal(query('sealer','select current_user;'),'dlkt_et_sealer');
 for(const role of roles){
  denied(role,'select * from '+s+'.grants;');
  denied(role,'select * from '+s+'.window_state;');
  denied(role,'update '+s+'.window_state set fixture_clock=now();');
  denied(role,'select '+s+'.inspect();');
  if(role!=='sealer')denied(role,sealSql);
  if(role!=='observer')denied(role,readSql);
 }
 denied('sealer',issueSql(digest(1)));denied('sealer',batchSql(digest(1)));denied('sealer',withdrawSql(digest(1)));
 status('pending');
});
test('authorization expires after 15 minutes but the reversible vector survives until withdrawal',()=>{
 reset();const k=digest(1);assert.equal(issue(k),'created');assert.equal(ingest(k),'accepted');
 setClock(start+15*60000-1);assert.equal(ingest(k),'duplicate');assert.equal(countVectors(),1);
 setClock(start+15*60000);assert.equal(ingest(k),'expired');assert.equal(issue(k),'expired');assert.equal(countVectors(),1);
 assert.equal(withdraw(k),'withdrawn');assert.equal(withdraw(k),'withdrawn');assert.equal(ingest(k),'revoked');assert.equal(countVectors(),0);
 status('pending');
});
test('UTC closure rejects new writes and a fixed 15-minute grace precedes any seal',()=>{
 reset();seed(20);assert.equal(seal(),'not-eligible');
 setClock(end);assert.equal(issue(digest(21)),'outside-window');assert.equal(ingest(digest(1)),'expired');assert.equal(countVectors(),20);
 setClock(end+15*60000-1);assert.equal(seal(),'not-eligible');status('pending');
 setClock(end+15*60000);assert.equal(seal(),'sealed-lab');status('sealed-lab',rows(100));
 assert.equal(countGrants(),0);
});
test('one immutable sealed report releases all five cells together and discards all grant links',()=>{
 reset();seed(20);setClock(end+15*60000);
 assert.equal(seal(),'sealed-lab');const first=status('sealed-lab',rows(100));assert.equal(countGrants(),0);
 setClock(end+16*60000);assert.equal(seal(),'sealed-lab');assert.deepEqual(read(),first);
 assert.equal(withdraw(digest(1)),'window-closed');assert.equal(withdraw(digest(999)),'window-closed');
 assert.equal(ingest(digest(1)),'unknown-grant');assert.equal(issue(digest(1)),'outside-window');
 assert.deepEqual(read(),first);
 const other=JSON.parse(query('observer',"set timezone to 'Pacific/Honolulu';"+readSql));assert.deepEqual(other,first);
});
test('empty, insufficient support and insufficient exposures suppress the whole result permanently',()=>{
 for(const [n,counts] of [[0,[5,5,5,5,5]],[19,[5,5,5,5,5]],[20,[1,5,5,5,5]],[20,[5,5,5,5,0]]]){
  reset();if(n)seed(n,counts);setClock(end+15*60000);
  assert.equal(seal(),'suppressed');const first=status('suppressed');
  assert.equal(countGrants(),0);assert.equal(seal(),'suppressed');assert.deepEqual(read(),first);
 }
});
test('one disproportionately large grant in any category suppresses the complete vector',()=>{
 reset();seed(20);const k=digest(21);assert.equal(issue(k),'created');assert.equal(ingest(k,[480,5,5,5,5]),'accepted');
 setClock(end+15*60000);assert.equal(seal(),'suppressed');status('suppressed');assert.equal(countGrants(),0);
});
test('withdrawal during grace changes the eventual release only before the irreversible seal',()=>{
 reset();seed(21);setClock(end+14*60000);assert.equal(withdraw(digest(1)),'withdrawn');assert.equal(countVectors(),20);status('pending');
 setClock(end+15*60000);assert.equal(seal(),'sealed-lab');status('sealed-lab',rows(100));
 assert.equal(withdraw(digest(2)),'window-closed');assert.equal(countGrants(),0);
});
test('a concurrent final withdrawal and sealing serialize, with no second release or partial vector',async()=>{
 reset();seed(20);setClock(end+15*60000);
 const [a,b]=await Promise.all([independent('writer',withdrawSql(digest(1))),independent('sealer',sealSql)]);
 if(a==='withdrawn'){assert.equal(b,'suppressed');status('suppressed');}
 else{assert.equal(a,'window-closed');assert.equal(b,'sealed-lab');status('sealed-lab',rows(100));}
 assert.equal(countGrants(),0);assert.equal(seal(),b);
});
test('two concurrent sealers produce only one terminal report',async()=>{
 reset();seed(20);setClock(end+15*60000);
 const result=await Promise.all([independent('sealer',sealSql),independent('sealer',sealSql)]);
 assert.deepEqual(result,['sealed-lab','sealed-lab']);status('sealed-lab',rows(100));assert.equal(countGrants(),0);
});
test('a rolled-back seal never reveals a result to the next transaction',()=>{
 reset();seed(20);setClock(end+15*60000);
 assert.equal(query('sealer','begin;'+sealSql+'rollback;'),'sealed-lab');
 status('pending');assert.equal(countGrants(),20);
 assert.equal(withdraw(digest(1)),'withdrawn');assert.equal(seal(),'suppressed');status('suppressed');
});
test('hard discard at day end plus 20 minutes prevents late finalization',()=>{
 reset();seed(20);setClock(end+20*60000);
 assert.equal(query('reaper','select '+s+'.sweep();'),'swept');
 status('expired');assert.equal(countGrants(),0);assert.equal(seal(),'expired');assert.equal(withdraw(digest(1)),'window-closed');
});
test('the sealed result expires at day end plus 24 hours and cannot be reopened',()=>{
 reset();seed(20);setClock(end+15*60000);assert.equal(seal(),'sealed-lab');
 setClock(end+86400000-1);status('sealed-lab',rows(100));
 setClock(end+86400000);status('expired');assert.equal(seal(),'expired');assert.equal(countGrants(),0);
});
test('clock regression before or after sealing removes pending or published synthetic data and holds',()=>{
 for(const sealed of [false,true]){
  reset();seed(20);setClock(end+15*60000);
  if(sealed)assert.equal(seal(),'sealed-lab');else status('pending');
  setClock(end+14*60000);status('held');assert.equal(countGrants(),0);assert.equal(seal(),'held');
  setClock(end+16*60000);status('held');assert.equal(ingest(digest(1)),'held');
 }
});
test('inconsistent grant ledger is held rather than sealed',()=>{
 reset();seed(20);
 query('admin',"delete from "+s+".grants where grant_digest="+literal(digest(1))+";");
 setClock(end+15*60000);assert.equal(seal(),'held');status('held');assert.equal(countGrants(),0);
});
