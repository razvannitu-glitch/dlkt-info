import test from 'node:test';
import assert from 'node:assert/strict';
import {runGrantCleanup,inspectSubscriptionCleanup} from '../.billing-build/docs/billing-ledger-sandbox/external-cleanup.js';
import {seal} from '../.billing-build/source/src/connections/crypto.js';
const now=1795695000,request='30000000-0000-4000-8000-000000000013',owner='00000000-0000-4000-8000-000000000013',connection='40000000-0000-4000-8000-000000000013',revision='50000000-0000-4000-8000-000000000013';
const key=Buffer.alloc(32,17).toString('base64url'),origin='https://info.dlkt.ee';
const env={DLKT_INFO_CONNECTIONS_TOKEN_KEY:key,DLKT_INFO_GMAIL_CLIENT_ID:'fixture-client',DLKT_INFO_GMAIL_CLIENT_SECRET:'fixture-secret',
 DLKT_INFO_FACEBOOK_PAGES_CLIENT_ID:'fixture-client',DLKT_INFO_FACEBOOK_PAGES_CLIENT_SECRET:'fixture-secret',DLKT_INFO_META_GRAPH_VERSION:'v24.0'};
const failed={kind:'unavailable'},recorded=outcome=>({kind:'recorded',outcome});
function fixture(providerId='gmail'){
 const grant={accountId:providerId==='facebook-pages'?'123456':'synthetic-account',accountLabel:'fixture@example.test',accessToken:'fixture-access-token',refreshToken:'fixture-refresh-token',expiresAt:new Date((now+3600)*1000).toISOString(),scopes:providerId==='facebook-pages'?['pages_show_list','pages_read_engagement','pages_read_user_content']:['openid','email','https://www.googleapis.com/auth/gmail.metadata'],resources:[]};
 const job={requestId:request,ownerId:owner,connectionId:connection,providerId,vaultRevision:revision,
 sealedGrant:['gmail','facebook-pages'].includes(providerId)?seal(grant,key,'grant:'+owner+':'+providerId+':'+connection):null,fence:'1',leaseUntil:now+60};
 const calls=[],store={claim:async r=>{calls.push(['claim',r]);return job},markDispatched:async(...args)=>{calls.push(['dispatch',...args]);return true},finish:async(...args)=>{calls.push(['finish',...args]);return true}};
 const fetcher=async(url,init)=>{calls.push(['network',String(url),init]);return providerId==='facebook-pages'?new Response(JSON.stringify({success:true}),{headers:{'content-type':'application/json'}}):new Response('',{status:200})};
 return {job,store,calls,fetcher,grant};
}
const run=(f,environment=env,clock=()=>now,mode='isolated_fixture_only')=>runGrantCleanup(request,mode,f.store,environment,origin,f.fetcher,clock);
test('Gmail revocation dispatch committed before provider request; only acknowledgement returned',async()=>{
 const f=fixture();assert.deepEqual(await run(f),recorded('provider_acknowledged'));
 assert.deepEqual(f.calls.map(x=>x[0]),['claim','dispatch','network','finish']);
 assert.equal(f.calls[2][1],'https://oauth2.googleapis.com/revoke');assert.equal(f.calls[2][2].method,'POST');
 assert.equal(new URLSearchParams(f.calls[2][2].body).get('token'),f.grant.refreshToken);
 assert.deepEqual(f.calls[3].slice(1),[request,connection,'1','provider_acknowledged']);
});
test('Facebook exact permission revocation receives successful acknowledgement',async()=>{
 const f=fixture('facebook-pages');assert.deepEqual(await run(f),recorded('provider_acknowledged'));
 assert.equal(f.calls[2][1],'https://graph.facebook.com/v24.0/123456/permissions');assert.equal(f.calls[2][2].method,'DELETE');
});
for(const provider of ['outlook','instagram'])test(provider+' requires manual revocation without provider call or decryption',async()=>{
 const f=fixture(provider);assert.deepEqual(await run(f,{}),recorded('manual_revocation_required'));
 assert.deepEqual(f.calls.map(x=>x[0]),['claim','finish']);
});
test('Missing/invalid key or tampered envelope records credential problem without dispatch',async()=>{
 const f=fixture();assert.deepEqual(await run(f,{}),recorded('credential_unavailable'));
 assert.deepEqual(f.calls.map(x=>x[0]),['claim','finish']);
 const g=fixture();g.job.ownerId='00000000-0000-4000-8000-000000000014';
 assert.deepEqual(await run(g),recorded('credential_unavailable'));assert.equal(g.calls.some(x=>x[0]==='network'),false);
});
test('Wrong case, fence, mode or expired lease cannot execute',async()=>{
 for(const patch of [{requestId:owner},{fence:'0'},{fence:'6'},{leaseUntil:now},{leaseUntil:now+61},{providerId:'other'}]){
  const f=fixture();Object.assign(f.job,patch);assert.deepEqual(await run(f),failed);assert.equal(f.calls.length,1);
 }
 const f=fixture();assert.deepEqual(await run(f,env,()=>now,'live'),failed);assert.equal(f.calls.length,0);
});
test('Dispatch rejection or storage outage prevents provider action',async()=>{
 for(const fn of [async()=>false,async()=>{throw Error('storage unavailable')}]){const f=fixture();f.store.markDispatched=fn;
  assert.deepEqual(await run(f),failed);assert.equal(f.calls.some(x=>x[0]==='network'),false);}
});
test('Unsupported or ambiguous HTTP acknowledgement cannot count as revoked',async()=>{
 for(const response of [()=>new Response('',{status:202}),()=>new Response('',{status:400}),()=>new Response('',{status:302}),()=>{throw Error('network')} ]){
  const f=fixture();let calls=0;f.fetcher=async()=>{calls++;return response()};
  assert.deepEqual(await run(f),recorded('provider_outcome_unknown'));assert.equal(calls,1);
 }
 const f=fixture('facebook-pages');f.fetcher=async()=>new Response(JSON.stringify({success:false}),{headers:{'content-type':'application/json'}});
 assert.deepEqual(await run(f),recorded('provider_outcome_unknown'));
});
test('Lost terminal receipt does not retry a potentially successful external operation',async()=>{
 const f=fixture();f.store.finish=async()=>{throw Error('response lost')};assert.deepEqual(await run(f),failed);
 assert.equal(f.calls.filter(x=>x[0]==='network').length,1);
});
test('Insufficient lease time and lease expiry during dispatch prevent another request',async()=>{
 const f=fixture();let i=0;assert.deepEqual(await run(f,env,()=>[now,now+50][i++]),failed);assert.deepEqual(f.calls.map(x=>x[0]),['claim']);
 const g=fixture();let j=0;assert.deepEqual(await run(g,env,()=>[now,now+1,now+50][j++]),failed);assert.deepEqual(g.calls.map(x=>x[0]),['claim','dispatch']);
});
const binding={ownerId:owner,accountId:'acct_fixture',liveMode:false,customerId:'cus_fixture',subscriptionId:'sub_fixture',itemId:'si_fixture',priceId:'price_fixture'};
const observation={...binding,status:'active',cancelAt:null,cancelAtPeriodEnd:false,latestInvoice:{status:'paid',amountRemaining:0},fundsConfirmed:false,riskState:'unknown'};
const inspect=x=>inspectSubscriptionCleanup(owner,binding,{observeSubscription:async()=>x},now);
test('Financial observation distinguishes ended, scheduled and unresolved without authorizing closure',async()=>{
 assert.deepEqual(await inspect(observation),{kind:'observed',subscriptionState:'unresolved',latestInvoice:'no_balance_reported',requiresReview:true});
 assert.deepEqual(await inspect({...observation,status:'canceled'}),{kind:'observed',subscriptionState:'ended',latestInvoice:'no_balance_reported',requiresReview:true});
 assert.deepEqual(await inspect({...observation,cancelAtPeriodEnd:true,cancelAt:now+120,latestInvoice:{status:'open',amountRemaining:699}}),{kind:'observed',subscriptionState:'scheduled_end',latestInvoice:'unresolved',requiresReview:true});
 assert.deepEqual(await inspect({...observation,status:'canceled',latestInvoice:null}),{kind:'observed',subscriptionState:'ended',latestInvoice:'not_observed',requiresReview:true});
});
test('Wrong Stripe mode, account, customer, price, item or unverified reader is denied',async()=>{
 for(const patch of [{liveMode:true},{accountId:'acct_other'},{customerId:'cus_other'},{subscriptionId:'sub_other'},{priceId:'price_other'},{itemId:'si_other'},{fundsConfirmed:true},{riskState:'clear'}])assert.deepEqual(await inspect({...observation,...patch}),failed);
 assert.deepEqual(await inspectSubscriptionCleanup(owner,binding,{observeSubscription:async()=>{throw Error('Stripe outage')}},now),failed);
});
