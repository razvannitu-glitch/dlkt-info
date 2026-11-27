import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {NEWS_TAXONOMY_VERSION} from '../.build/src/iceo/news-taxonomy.js';
import {EDITORIAL_PILOT_CATEGORIES} from '../.build/src/audience/editorial-pilot.js';
import {EditorialConsentLab,EDITORIAL_CONSENT_PURPOSE,EDITORIAL_NOTICE_VERSION} from '../.build/src/audience/editorial-consent.js';
import {QualifiedExposureLab} from '../.build/src/audience/editorial-exposure.js';
import {EDITORIAL_BATCH_BYTES,EDITORIAL_BATCH_SCOPE,EDITORIAL_BATCH_VERSION,encodeEditorialExposureBatch,parseEditorialExposureBatch} from '../.build/src/audience/editorial-batch.js';
import {EditorialTransportLab,EDITORIAL_LAB_GRANT_MS,EDITORIAL_LAB_GRANT_LIMIT,EDITORIAL_LAB_ACCEPT_LIMIT} from '../.build/src/audience/editorial-transport.js';
import {handleEditorialTransportLab,EDITORIAL_LAB_INGEST_PATH,EDITORIAL_LAB_WITHDRAW_PATH} from '../.build/src/audience/editorial-transport-http.js';

const day='2026-11-27',start=Date.parse(day+'T00:00:00.000Z'),noon=start+12*60*60*1000;
const context=()=>({operationalReady:true,globalPrivacyControl:false,doNotTrack:false,noticeVersion:EDITORIAL_NOTICE_VERSION});
const choice=()=>({choice:'allow',purpose:EDITORIAL_CONSENT_PURPOSE,noticeVersion:EDITORIAL_NOTICE_VERSION});
const permit=lab=>{lab.observeContext(context());const command=lab.requestGrant(choice());assert.ok(command);assert.equal(lab.acknowledge({...command,result:'granted'}),true);return lab;};
const consent=()=>permit(new EditorialConsentLab());
const payload=(n=3)=>({version:EDITORIAL_BATCH_VERSION,scope:EDITORIAL_BATCH_SCOPE,taxonomyVersion:NEWS_TAXONOMY_VERSION,day,coverage:'document-only',rows:EDITORIAL_PILOT_CATEGORIES.map((category,i)=>({category,qualifiedImpressions:i===0?n:0}))});
const bytes=value=>Buffer.from(JSON.stringify(value),'utf8');
const fixture=(time=noon)=>{let now=time;return {lab:new EditorialTransportLab(day,()=>now),setTime:value=>{now=value;}};};
const issue=(lab,c=consent())=>{const grant=lab.issue(c);assert.ok(grant);return grant;};
const total=lab=>lab.inspect().rows.reduce((sum,row)=>sum+row.qualifiedImpressions,0);

test('qualified exposure snapshot encodes exactly the category vector, never card keys or invented opens',()=>{
 const exposure=new QualifiedExposureLab(),card={key:'article:'+'a'.repeat(24),category:'05000000',qualified:true};
 for(let t=0;t<=1000;t+=100)exposure.frame(t,[card]);
 const encoded=encodeEditorialExposureBatch(exposure.snapshot(),day);assert.ok(encoded);
 assert.deepEqual(parseEditorialExposureBatch(encoded),payload(1));
 assert.equal(Buffer.from(encoded).includes(card.key),false);
 assert.equal(encodeEditorialExposureBatch(new QualifiedExposureLab().snapshot(),day),null);
 exposure.stop();assert.equal(encodeEditorialExposureBatch(exposure.snapshot(),day),null);
});
test('canonical wire rejects unknown fields, wrong order, duplicate keys, alternate encodings and invalid scope',()=>{
 const variants=[{...payload(),url:'https://example.invalid'},{...payload(),accountId:'x'},{...payload(),coverage:'complete'},{...payload(),scope:'public-home-opt-in'},{...payload(),day:'2026-02-30'},{...payload(),taxonomyVersion:'old'},{...payload(),version:'old'},{...payload(),rows:[...payload().rows].reverse()},{...payload(),rows:payload().rows.slice(1)},{...payload(),rows:payload().rows.map(r=>({...r,attributableOpens:0}))}];
 for(const value of variants)assert.equal(parseEditorialExposureBatch(bytes(value)),null);
 const canonical=JSON.stringify(payload());
 for(const text of [' '+canonical,canonical+'\n',canonical.replace('"coverage":"document-only"','"coverage":"document-only","coverage":"document-only"'),canonical.replace('"qualifiedImpressions":3','"qualifiedImpressions":3.0'),canonical.replace('"qualifiedImpressions":3','"qualifiedImpressions":3e0')])assert.equal(parseEditorialExposureBatch(Buffer.from(text)),null);
 assert.equal(parseEditorialExposureBatch(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes(payload())])),null);
 assert.equal(parseEditorialExposureBatch(Buffer.from([0xff,0xfe])),null);
 assert.equal(parseEditorialExposureBatch(Buffer.alloc(EDITORIAL_BATCH_BYTES+1)),null);
 assert.equal(parseEditorialExposureBatch(canonical),null);
});
test('bounded integer counts across the vector and nonempty contribution are enforced',()=>{
 for(const n of [0,-1,1.5,501,Infinity,NaN,'3'])assert.equal(parseEditorialExposureBatch(bytes(payload(n))),null);
 const v=payload(500);v.rows[1].qualifiedImpressions=1;assert.equal(parseEditorialExposureBatch(bytes(v)),null);
 assert.deepEqual(parseEditorialExposureBatch(bytes(payload(500))),payload(500));
});
test('grant issuance is internal, purpose-specific and one per synthetic consent revision',()=>{
 const {lab}=fixture();const c=new EditorialConsentLab();
 assert.equal(lab.issue(c),null);c.observeContext(context());const command=c.requestGrant(choice());assert.ok(command);
 assert.equal(lab.issue(c),null);assert.equal(lab.issue({snapshot:()=>({wouldPermitInLab:true})}),null);
 assert.equal(c.acknowledge({...command,result:'granted'}),true);
 const g=issue(lab,c);assert.match(g.token,/^edlab1\.[A-Za-z0-9_-]{43}$/u);assert.equal(g.expiresAt,noon+EDITORIAL_LAB_GRANT_MS);
 assert.equal(g.purpose,EDITORIAL_CONSENT_PURPOSE);assert.equal(g.noticeVersion,EDITORIAL_NOTICE_VERSION);
 assert.equal(g.productionActivationAllowed,false);assert.equal(lab.issue(c),null);
});
test('unknown, foreign and malformed tokens cannot submit or withdraw',()=>{
 const {lab}=fixture(),other=fixture().lab,g=issue(lab);
 assert.equal(other.ingest(g.token,bytes(payload())),'unknown-grant');
 for(const token of ['audience-v1.x','edlab1.'+'a'.repeat(43),g.token+'x',null]){
  assert.equal(lab.ingest(token,bytes(payload())),'unknown-grant');assert.equal(lab.withdraw(token),'unknown-grant');
 }
 assert.equal(total(lab),0);
});
test('accepted replay is idempotent and conflicting replay cannot change the pending totals',()=>{
 const {lab}=fixture(),g=issue(lab);
 assert.equal(lab.ingest(g.token,bytes({...payload(),day:'2026-11-26'})),'invalid-batch');
 assert.equal(lab.ingest(g.token,bytes(payload())),'accepted');
 assert.equal(lab.ingest(g.token,bytes(payload())),'duplicate');
 assert.equal(lab.ingest(g.token,bytes(payload(4))),'conflicting-replay');
 const result=lab.inspect();assert.equal(result.pendingContributions,1);assert.equal(result.acceptedInLifetime,1);
 assert.equal(result.coverage,'unsealed');assert.equal(result.automationAllowed,false);assert.equal(total(lab),3);
});
test('revocation before or after a write fences replay and deletes its reversible contribution',()=>{
 for(const before of [true,false]){
  const {lab}=fixture(),c=consent(),g=issue(lab,c);
  if(!before)assert.equal(lab.ingest(g.token,bytes(payload())),'accepted');
  assert.equal(lab.withdraw(g.token),'withdrawn');assert.equal(lab.withdraw(g.token),'withdrawn');
  assert.equal(lab.ingest(g.token,bytes(payload())),'revoked');assert.equal(total(lab),0);assert.equal(lab.issue(c),null);
 }
});
test('consent withdrawal and privacy gate loss invalidate already issued grants even without transport cleanup',()=>{
 for(const action of [c=>c.requestWithdrawal(),c=>c.observeContext({...context(),globalPrivacyControl:true}),c=>c.observeContext({...context(),doNotTrack:true}),c=>c.observeContext({...context(),operationalReady:false})]){
  const {lab}=fixture(),c=consent(),g=issue(lab,c);
  assert.equal(lab.ingest(g.token,bytes(payload())),'accepted');const cleanup=action(c);assert.ok(cleanup);
  assert.equal(lab.ingest(g.token,bytes(payload())),'revoked');assert.equal(total(lab),0);
  assert.equal(lab.withdraw(g.token),'withdrawn');assert.equal(c.acknowledge({...cleanup,result:'withdrawn'}),true);
  permit(c);const fresh=issue(lab,c);assert.notEqual(fresh.token,g.token);
  assert.equal(lab.ingest(g.token,bytes(payload())),'revoked');assert.equal(lab.ingest(fresh.token,bytes(payload(2))),'accepted');assert.equal(total(lab),2);
 }
});
test('grant expiry and UTC-day boundary discard pending contributions and never permit late writes',()=>{
 const f=fixture(),g=issue(f.lab);assert.equal(f.lab.ingest(g.token,bytes(payload())),'accepted');
 f.setTime(g.expiresAt-1);assert.equal(total(f.lab),3);f.setTime(g.expiresAt);
 assert.equal(f.lab.ingest(g.token,bytes(payload())),'expired');assert.equal(f.lab.withdraw(g.token),'expired');assert.equal(total(f.lab),0);
 const last=fixture(start+86_400_000-1000),end=issue(last.lab);
 assert.equal(end.expiresAt,start+86_400_000);assert.equal(last.lab.ingest(end.token,bytes(payload())),'accepted');
 last.setTime(end.expiresAt);assert.equal(last.lab.inspect().status,'outside-window');assert.deepEqual(last.lab.inspect().rows,[]);
 assert.equal(last.lab.issue(consent()),null);assert.equal(last.lab.ingest(end.token,bytes(payload())),'expired');
});
test('clock regression fails closed, removes pending values and prevents reactivation',()=>{
 const f=fixture(),g=issue(f.lab);assert.equal(f.lab.ingest(g.token,bytes(payload())),'accepted');
 f.setTime(noon-1);assert.equal(f.lab.inspect().status,'held');assert.deepEqual(f.lab.inspect().rows,[]);
 f.setTime(noon+1);assert.equal(f.lab.issue(consent()),null);assert.equal(f.lab.ingest(g.token,bytes(payload())),'held');
 assert.equal(f.lab.withdraw(g.token),'unknown-grant');
});
test('lifetime capacity cannot be recycled through withdrawal, while exact accepted replay costs no second admission',()=>{
 const {lab}=fixture();let last;
 for(let i=0;i<EDITORIAL_LAB_ACCEPT_LIMIT;i++){last=issue(lab);assert.equal(lab.ingest(last.token,bytes(payload(1))),'accepted');}
 assert.equal(lab.ingest(last.token,bytes(payload(1))),'duplicate');assert.equal(lab.withdraw(last.token),'withdrawn');
 const extra=issue(lab);assert.equal(lab.ingest(extra.token,bytes(payload(1))),'capacity');
 for(let i=EDITORIAL_LAB_ACCEPT_LIMIT+1;i<EDITORIAL_LAB_GRANT_LIMIT;i++)issue(lab);
 assert.equal(lab.issue(consent()),null);assert.equal(lab.inspect().acceptedInLifetime,EDITORIAL_LAB_ACCEPT_LIMIT);
 assert.equal(total(lab),EDITORIAL_LAB_ACCEPT_LIMIT-1);
});
async function loopback(fn){
 const {lab}=fixture();
 const server=createServer((req,res)=>{void handleEditorialTransportLab(req,res,lab).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
 const request=(grant,options={})=>fetch(origin+(options.path??EDITORIAL_LAB_INGEST_PATH),{
  method:options.method??'POST',redirect:'error',headers:{Origin:origin,'X-DLKT-Info-Request':'editorial-exposure-lab-v1','Content-Type':'application/json',Authorization:'Bearer '+grant.token,...options.headers},
  ...(options.method==='GET'?{}:{body:options.body??bytes(payload())}),
 });
 try{await fn({lab,request,origin});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('real loopback HTTP accepts only the strict same-origin credential-isolated transport',async()=>{
 await loopback(async({lab,request})=>{
  const g=issue(lab);
  for(const [options,expected] of [
   [{method:'GET'},405],[{path:EDITORIAL_LAB_INGEST_PATH+'?x=1'},404],[{headers:{Origin:'https://example.invalid'}},403],
   [{headers:{'X-DLKT-Info-Request':'audience-v1'}},403],[{headers:{'Sec-Fetch-Site':'cross-site'}},403],
   [{headers:{Cookie:'__Host-dlkt_audience=forbidden'}},403],[{headers:{'X-Forwarded-Host':'www.dlkt.ee'}},403],
   [{headers:{Authorization:'Bearer wrong'}},401],[{headers:{'Content-Type':'text/plain'}},415],
   [{headers:{'Content-Encoding':'gzip'}},415],[{body:Buffer.alloc(EDITORIAL_BATCH_BYTES+1)},413],
   [{body:bytes({...payload(),articleId:'x'})},400],
  ]){
   const response=await request(g,options);assert.equal(response.status,expected);await response.arrayBuffer();
  }
  assert.equal(total(lab),0);
  const accepted=await request(g);assert.equal(accepted.status,200);assert.deepEqual(await accepted.json(),{result:'accepted'});
  assert.equal(accepted.headers.get('cache-control'),'private, no-store');assert.equal(accepted.headers.get('set-cookie'),null);
  const duplicate=await request(g);assert.deepEqual(await duplicate.json(),{result:'duplicate'});
  const conflict=await request(g,{body:bytes(payload(4))});assert.equal(conflict.status,409);await conflict.arrayBuffer();
  assert.equal(total(lab),3);
 });
});
test('loopback privacy signal closes the grant and withdrawal remains available without collection permission',async()=>{
 await loopback(async({lab,request})=>{
  const g=issue(lab);const accepted=await request(g);await accepted.arrayBuffer();
  const denied=await request(g,{headers:{'Sec-GPC':'1'}});assert.equal(denied.status,403);await denied.arrayBuffer();
  assert.equal(total(lab),0);
  const replay=await request(g);assert.equal(replay.status,401);await replay.arrayBuffer();
  const removed=await request(g,{path:EDITORIAL_LAB_WITHDRAW_PATH,headers:{DNT:'1'},body:'{}'});
  assert.equal(removed.status,200);assert.deepEqual(await removed.json(),{result:'withdrawn'});
 });
});
test('loopback consent revoked before submission and withdrawal after commit never leaves pending data',async()=>{
 await loopback(async({lab,request})=>{
  const c=consent(),g=issue(lab,c);c.requestWithdrawal();
  const rejected=await request(g);assert.equal(rejected.status,401);await rejected.arrayBuffer();
  const fresh=issue(lab);const result=await request(fresh);assert.deepEqual(await result.json(),{result:'accepted'});
  const wrong=await request(fresh,{path:EDITORIAL_LAB_WITHDRAW_PATH,body:'[]'});assert.equal(wrong.status,400);await wrong.arrayBuffer();
  const removed=await request(fresh,{path:EDITORIAL_LAB_WITHDRAW_PATH,body:'{}'});assert.deepEqual(await removed.json(),{result:'withdrawn'});
  assert.equal(total(lab),0);
 });
});
