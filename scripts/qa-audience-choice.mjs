import assert from 'node:assert/strict';

/** Loopback-only fixture; no real user, production token, or provider call. */
export async function audienceChoiceFixture(){
 const {handleAudienceGateway}=await import('../source/.build/src/audience/gateway.js');
 let active=false,requests=0,failWithdrawal=false,forgot=0;
 const records=[],revoked=new Set();
 const environment={NODE_ENV:'development',DLKT_INFO_AUDIENCE_COLLECT_ENABLED:'1',DLKT_INFO_AUDIENCE_RETENTION_READY:'1',DLKT_INFO_AUDIENCE_CONSENT_READY:'1'};
 const store={
  async record(browser,event){
   assert.match(browser,/^[0-9a-f]{64}$/u);
   if(revoked.has(browser))return 'revoked';
   records.push({browser,event});return 'accepted';
  },
  async forget(browser){
   if(failWithdrawal)throw Error('CONTROLLED_WITHDRAWAL_FAILURE');
   revoked.add(browser);forgot++;
  },
  async snapshot(){throw Error('UNEXPECTED_SNAPSHOT');}
 };
 return {
  get requests(){return requests;},get records(){return records.slice();},get forgot(){return forgot;},
  activate(){active=true;requests=0;records.length=0;revoked.clear();forgot=0;failWithdrawal=false;},
  deactivate(){active=false;},
  setFailWithdrawal(value){failWithdrawal=value;},
  handle(req,res,url){
   if(url.pathname!=='/api/audience')return false;
   if(!active){res.writeHead(404,{'Content-Type':'application/json'}).end('{"error":"NOT_FOUND"}');return true;}
   requests++;
   void handleAudienceGateway(req,res,{environment,store,secret:Buffer.alloc(32,9).toString('base64url'),permit:async()=>true,available:async()=>true})
    .catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
   return true;
  }
 };
}
export async function verifyAudienceChoice({fixture,origin,openIsolated,evaluate,loaded,pause}){
 const browser=await openIsolated(),call=browser.call;
 const state=()=>evaluate(call,"({choice:localStorage.getItem('dlkt-audience-choice-v1'),status:document.getElementById('audience-choice-status')?.textContent??'',allow:!document.getElementById('audience-choice-allow')?.hidden,deny:!document.getElementById('audience-choice-deny')?.hidden,busy:document.getElementById('audience-choice-allow')?.disabled??false})");
 async function until(fn,label){
  for(let i=0;i<80;i++){if(await fn())return;await pause(100);}
  throw Error('DLKT_AUDIENCE_BROWSER_TIMEOUT_'+label);
 }
 async function go(path){await call('Page.navigate',{url:origin+path});await loaded(call);await pause(250);}
 async function click(id){await evaluate(call,"(()=>{const b=document.getElementById("+JSON.stringify(id)+");if(!b||b.hidden||b.disabled)throw Error('CONTROL_UNAVAILABLE');b.click();return true;})()");}
 fixture.activate();
 try{
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true,scale:1});
  await call('Page.bringToFront');
  await go('/');
  assert.equal(fixture.requests,0,'unconsented reader must not contact collector');
  await go('/cookies#cookies');
  await until(async()=>{const s=await state();return s.allow&&s.deny&&!s.busy&&s.status.includes('Measurement is off');},'CHOICES');
  assert.equal(await evaluate(call,"document.getElementById('audience-choice-allow').className===document.getElementById('audience-choice-deny').className"),true);
  assert.equal(await evaluate(call,"document.documentElement.scrollWidth<=innerWidth+1"),true);
  assert.equal(fixture.records.length,0);
  await click('audience-choice-allow');
  await until(async()=>{const s=await state();return s.choice==='allow'&&!s.busy&&s.status.includes('is on');},'OPT_IN');
  assert.equal(await evaluate(call,"document.cookie.includes('__Host-dlkt_audience')"),false,'HttpOnly token must not be readable by page JavaScript');
  assert.equal(fixture.records.length,0,'settings are not an audience pageview');
  await go('/');
  await until(()=>fixture.records.length===1,'FIRST_VIEW');
  await pause(350);
  assert.equal(fixture.records.length,1);
  assert.deepEqual(Object.keys(fixture.records[0].event).sort(),['id','kind','source']);
  assert.equal(fixture.records[0].event.kind,'pageview');
  await go('/companion');
  await until(()=>fixture.records.length===2,'SECOND_VIEW');
  assert.equal(fixture.records[0].browser,fixture.records[1].browser);
  assert.notEqual(fixture.records[0].event.id,fixture.records[1].event.id);
  await go('/cookies#cookies');
  await until(async()=>{const s=await state();return s.choice==='allow'&&s.deny&&!s.busy;},'WITHDRAW_CONTROL');
  fixture.setFailWithdrawal(true);
  await click('audience-choice-deny');
  await until(async()=>{const s=await state();return s.choice==='withdraw'&&!s.busy&&s.status.includes('could not be confirmed');},'WITHDRAW_FAILURE');
  assert.equal(fixture.forgot,0);
  const stoppedRequests=fixture.requests;
  await go('/');
  assert.equal(fixture.requests,stoppedRequests,'pending withdrawal must stop reader events');
  await go('/cookies#cookies');
  await until(async()=>{const s=await state();return s.choice==='withdraw'&&s.deny&&!s.busy;},'RETRY_CONTROL');
  fixture.setFailWithdrawal(false);
  await click('audience-choice-deny');
  await until(async()=>{const s=await state();return s.choice==='deny'&&!s.busy;},'WITHDRAW_CONFIRMED');
  assert.equal(fixture.forgot,1);
  const deniedRequests=fixture.requests;
  await go('/');
  assert.equal(fixture.requests,deniedRequests,'withdrawn reader must not contact collector');
  assert.equal(fixture.records.length,2);
  return {status:'AUDIENCE_BROWSER_PASS',measuredPageviews:2,withdrawalConfirmed:true,failedWithdrawalStopsCollection:true,noRequestsBeforeOrAfterConsent:true,scope:'Chromium loopback; synthetic server store and browser token; no live collection'};
 }finally{fixture.deactivate();await browser.close();}
}
