import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {NEWS_TAXONOMY_VERSION} from '../../source/.build/src/iceo/news-taxonomy.js';
import {EDITORIAL_PILOT_CATEGORIES} from '../../source/.build/src/audience/editorial-pilot.js';
import {EDITORIAL_BATCH_SCOPE} from '../../source/.build/src/audience/editorial-batch.js';
import {readDailyControlLab} from './daily-readback.mts';
import {renderEditorialControlPreview} from './control-preview.mts';

const container=process.env.TEST_CONTAINER;
if(!container||!/^[a-f0-9]{64}$/u.test(container))throw Error('DISPOSABLE_CONTAINER_REQUIRED');
const db='editorial_transport_test',s='dlkt_editorial_transport_lab';
const day='2026-01-01',start=Date.parse(day+'T00:00:00.000Z'),end=start+86400000,seal=end+15*60000;
const time=ms=>new Date(ms).toISOString(),literal=v=>"'"+String(v).replaceAll("'","''")+"'";
function query(role,statement){
 const args=['exec','-i',...(role==='admin'?[]:['-e','PGPASSWORD=fixture-et-'+role+'-only']),container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',...(role==='admin'?[]:['-h','127.0.0.1']),'-U',role==='admin'?'postgres':'dlkt_et_'+role,'-d',db,'-c',statement];
 return execFileSync('docker',args,{encoding:'utf8',timeout:15000,maxBuffer:1024*1024}).trim();
}
function reset(){
 query('admin',"truncate "+s+".grants;update "+s+".window_state set utc_day="+literal(day)+"::date,last_seen="+literal(time(start))+"::timestamptz,fixture_clock="+literal(time(start))+"::timestamptz,held=false,daily_phase='open',sealed_counts=null,sealed_at=null,issued=0,accepted=0 where singleton;");
}
const clock=ms=>query('admin',"update "+s+".window_state set fixture_clock="+literal(time(ms))+"::timestamptz where singleton;");
function seed(n){
 const issued=query('issuer',"select "+s+".issue(lpad(to_hex(n),64,'0'),"+literal(day)+"::date,'editorial-interactions','dlkt-editorial-notice-lab-1') from generate_series(1,"+n+") n;");
 assert.equal(issued.split('\n').length,n);assert.ok(issued.split('\n').every(v=>v==='created'));
 const written=query('writer',"select "+s+".ingest(lpad(to_hex(n),64,'0'),"+literal(day)+"::date,'dlkt-editorial-exposure-batch-lab-1','public-home-global-news-opt-in-lab','iptc-media-topics-top-level-2026-10-16-dlkt-6','document-only',array[5,6,7,8,9]) from generate_series(1,"+n+") n;");
 assert.equal(written.split('\n').length,n);assert.ok(written.split('\n').every(v=>v==='accepted'));
}
const rows=EDITORIAL_PILOT_CATEGORIES.map((category,i)=>({category,qualifiedImpressions:100+20*i}));
const raw=()=>JSON.parse(query('observer',"select jsonb_build_object('database',current_database(),'sessionUser',session_user,'currentUser',current_user,'result',"+s+".read_daily());"));
const read=async()=>raw();
const valid=()=>({database:db,sessionUser:'dlkt_et_observer',currentUser:'dlkt_et_observer',result:{version:'dlkt-editorial-daily-lab-1',scope:EDITORIAL_BATCH_SCOPE,taxonomyVersion:NEWS_TAXONOMY_VERSION,day,status:'sealed-lab',coverage:'observed-documents-only',rows:structuredClone(rows),sealedAt:'2026-01-02T00:15:00.000000Z',productionActivationAllowed:false,automationAllowed:false}});
const absent=reason=>({status:'unavailable',reason,productionActivationAllowed:false,automationAllowed:false});
const parse=(value,now=seal)=>readDailyControlLab(day,now,async()=>value);

test('authenticated committed daily result reaches the isolated Control preview with exact exposure counts',async()=>{
 reset();seed(20);clock(seal);assert.equal(query('sealer','select '+s+'.seal_daily();'),'sealed-lab');
 const report=await readDailyControlLab(day,seal,read);
 assert.deepEqual(report,{status:'sealed-lab',day,sealedAt:'2026-01-02T00:15:00.000000Z',coverage:'observed-documents-only',rows,productionActivationAllowed:false,automationAllowed:false});
 const html=await renderEditorialControlPreview(day,seal,read);
 assert.match(html,/SYNTHETIC LAB PREVIEW — NOT LIVE ANALYTICS/);
 assert.match(html,/name="robots" content="noindex,nofollow"/);
 assert.match(html,/href="\/admin\.css"/);
 assert.match(html,/Science &amp; technology<\/th><td>140<\/td>/);
 assert.match(html,/Weather<\/th><td>180<\/td>/);
 assert.match(html,/coverage is not complete/);
 assert.doesNotMatch(html,/<script\b|\bstyle=|[a-f0-9]{64}|fixture-et-/u);
 assert.ok(html.indexOf('Education</th>')<html.indexOf('Environment</th>'));
 assert.ok(html.indexOf('Sport</th>')<html.indexOf('Weather</th>'));
});
test('pending and suppressed states remain unavailable without numerical cells',async()=>{
 reset();seed(19);
 assert.deepEqual(await readDailyControlLab(day,start,read),absent('pending'));
 let html=await renderEditorialControlPreview(day,start,read);
 assert.match(html,/not been finalized/);assert.doesNotMatch(html,/Qualified exposures \(synthetic\)<\/th>|<td>/);
 clock(seal);assert.equal(query('sealer','select '+s+'.seal_daily();'),'suppressed');
 assert.deepEqual(await readDailyControlLab(day,seal,read),absent('suppressed'));
 html=await renderEditorialControlPreview(day,seal,read);
 assert.match(html,/complete report has been withheld/);assert.doesNotMatch(html,/<td>/);
});
test('expired and held real SQL states cannot expose a previously sealed vector',async()=>{
 reset();seed(20);clock(seal);assert.equal(query('sealer','select '+s+'.seal_daily();'),'sealed-lab');
 clock(end+86400000);assert.deepEqual(await readDailyControlLab(day,end+86400000,read),absent('expired'));
 reset();seed(20);clock(seal);assert.equal(query('sealer','select '+s+'.seal_daily();'),'sealed-lab');
 clock(seal-1);assert.deepEqual(await readDailyControlLab(day,seal-1,read),absent('held'));
});
test('wrong authenticated role, database, schema shape or source contract fails closed',async()=>{
 for(const bad of [{...valid(),database:'other'},{...valid(),sessionUser:'dlkt_et_sealer'},{...valid(),currentUser:'dlkt_et_owner'},{...valid(),secret:'test'},null,
  ...[{day:'2026-01-02'},{version:'other'},{scope:'other'},{taxonomyVersion:'old'},{coverage:'complete'},{status:'ready'},{automationAllowed:true},{productionActivationAllowed:true},{grantCount:20}].map(change=>({...valid(),result:{...valid().result,...change}}))]){
  assert.deepEqual(await parse(bad),absent('invalid-readback'));
 }
});
test('wrong UTC chronology, noncanonical timestamps, stale results and invalid clocks are rejected',async()=>{
 for(const value of [null,'2026-01-02T00:14:59.999999Z','2026-01-02T00:20:00.000000Z','2026-01-02T00:16:00.000000Z','2026-01-02T00:15:00.000Z','2026-01-02T00:15:00.000000+00:00','2026-02-30T00:15:00.000000Z','2026-01-02T24:00:00.000000Z']){
  assert.deepEqual(await parse({...valid(),result:{...valid().result,sealedAt:value}}),absent('invalid-readback'));
 }
 assert.deepEqual(await parse(valid(),end+86400000),absent('invalid-readback'));
 assert.deepEqual(await parse(valid(),NaN),absent('invalid-readback'));
 assert.deepEqual(await parse(valid(),start-1),absent('invalid-readback'));
});
test('missing, reordered, extra, malformed and impossible exposure vectors are rejected',async()=>{
 for(const vector of [rows.slice(1),[...rows].reverse(),[...rows,rows[0]],rows.map(r=>({...r,accountId:'x'})),rows.map(r=>({...r,qualifiedImpressions:99})),rows.map(r=>({...r,qualifiedImpressions:64000})),rows.map(r=>({...r,qualifiedImpressions:100.5})),rows.map(r=>({...r,qualifiedImpressions:'100'})),rows.map(r=>({...r,qualifiedImpressions:null})),[null,...rows.slice(1)]]){
  assert.deepEqual(await parse({...valid(),result:{...valid().result,rows:vector}}),absent('invalid-readback'));
 }
});
test('contradictory status and missing coverage cannot produce counts or numeric zero',async()=>{
 for(const state of ['pending','suppressed','expired','held']){
  const value=valid();value.result.status=state;
  assert.deepEqual(await parse(value),absent('invalid-readback'));
 }
 const pending={...valid(),result:{...valid().result,status:'pending',rows:[],sealedAt:null}};
 assert.deepEqual(await parse(pending,end+20*60000),absent('invalid-readback'));
 const expired={...pending,result:{...pending.result,status:'expired'}};
 assert.deepEqual(await parse(expired,seal),absent('invalid-readback'));
});
test('provider failures and malicious strings never enter markup; lab modules are not mounted',async()=>{
 const provider=async()=>{throw Error('<script>alert(1)</script> fixture-et-observer-only');};
 assert.deepEqual(await readDailyControlLab(day,seal,provider),absent('provider-unavailable'));
 const html=await renderEditorialControlPreview(day,seal,provider);
 assert.match(html,/isolated data source is unavailable/);assert.doesNotMatch(html,/alert\(1\)|fixture-et-|<script\b|<td>/u);
 const injected=valid();injected.result.rows[0].category='<img src=x onerror=alert(1)>';
 const bad=await renderEditorialControlPreview(day,seal,async()=>injected);
 assert.match(bad,/report failed verification/);assert.doesNotMatch(bad,/onerror=|<td>/u);
 const production=readFileSync(new URL('../../source/api/admin.ts',import.meta.url),'utf8')+readFileSync(new URL('../../source/src/admin/render.ts',import.meta.url),'utf8');
 assert.doesNotMatch(production,/control-preview|daily-readback|renderEditorialControlPreview|sealed-lab/u);
});
