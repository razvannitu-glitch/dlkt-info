import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorialConsentLab,EDITORIAL_CONSENT_PURPOSE,EDITORIAL_NOTICE_VERSION} from '../.build/src/audience/editorial-consent.js';

const context=()=>({operationalReady:true,globalPrivacyControl:false,doNotTrack:false,noticeVersion:EDITORIAL_NOTICE_VERSION});
const choice=()=>({choice:'allow',purpose:EDITORIAL_CONSENT_PURPOSE,noticeVersion:EDITORIAL_NOTICE_VERSION});
const receipt=(command)=>({...command,result:command.operation==='grant'?'granted':'withdrawn'});
const ready=()=>{const lab=new EditorialConsentLab();lab.observeContext(context());return lab;};
const stopped=(lab,phase)=>{const s=lab.snapshot();assert.equal(s.phase,phase);assert.equal(s.wouldPermitInLab,false);assert.equal(s.productionActivationAllowed,false);};
const grant=lab=>{const command=lab.requestGrant(choice());assert.ok(command);assert.equal(lab.acknowledge(receipt(command)),true);return command;};

test('editorial choice is off by default and cannot inherit general audience consent',()=>{
 const lab=new EditorialConsentLab();stopped(lab,'off');
 assert.equal(lab.requestGrant(choice()),null);lab.observeContext(context());
 for(const value of [true,'allow',{choice:'allow',purpose:'audience',noticeVersion:EDITORIAL_NOTICE_VERSION},{...choice(),noticeVersion:'old'},{...choice(),browserId:'forbidden'},null])assert.equal(lab.requestGrant(value),null);
 stopped(lab,'off');
});
test('grant requires exact purpose, current notice, explicit choice and correlated acknowledgment',()=>{
 const lab=ready();const command=lab.requestGrant(choice());assert.equal(command.operation,'grant');stopped(lab,'grant-pending');
 assert.equal(lab.requestGrant(choice()),null);
 assert.equal(lab.acknowledge(receipt({...command,revision:command.revision+1n})),false);
 assert.equal(lab.acknowledge({...receipt(command),purpose:'audience'}),false);
 assert.equal(lab.acknowledge({...receipt(command),noticeVersion:'old'}),false);
 assert.equal(lab.acknowledge({...receipt(command),accountId:'forbidden'}),false);
 assert.equal(lab.acknowledge({...receipt(command),result:'unknown'}),false);
 stopped(lab,'grant-pending');assert.equal(lab.acknowledge(receipt(command)),true);
 assert.equal(lab.snapshot().wouldPermitInLab,true);assert.equal(lab.snapshot().productionActivationAllowed,false);
 assert.equal(lab.acknowledge(receipt(command)),false);
});
test('privacy signals, missing context, obsolete notice and failed readiness block grants',()=>{
 for(const bad of [{...context(),globalPrivacyControl:true},{...context(),doNotTrack:true},{...context(),operationalReady:false},{...context(),noticeVersion:'old'},null,{}, {...context(),globalPrivacyControl:undefined},{...context(),browserId:'forbidden'}]){
  const lab=ready();assert.equal(lab.observeContext(bad),null);assert.equal(lab.requestGrant(choice()),null);stopped(lab,'off');
 }
});
test('withdrawal before any grant is local and does not issue a request',()=>{
 const lab=ready();assert.equal(lab.requestWithdrawal(),null);stopped(lab,'denied');
 assert.equal(lab.requestWithdrawal(),null);
 assert.ok(lab.requestGrant(choice()));stopped(lab,'grant-pending');
});
test('withdrawal races a grant: stop immediately, ignore late receipt, block renewal until cleanup',()=>{
 const lab=ready();const pending=lab.requestGrant(choice());const cleanup=lab.requestWithdrawal();
 assert.equal(cleanup.operation,'withdraw');assert.ok(cleanup.revision>pending.revision);stopped(lab,'withdrawal-pending');
 assert.equal(lab.acknowledge(receipt(pending)),false);assert.equal(lab.requestGrant(choice()),null);
 assert.deepEqual(lab.requestWithdrawal(),cleanup);
 assert.equal(lab.acknowledge(receipt({...cleanup,revision:pending.revision})),false);
 assert.equal(lab.acknowledge(receipt(cleanup)),true);stopped(lab,'denied');
 const next=lab.requestGrant(choice());assert.ok(next.revision>cleanup.revision);
 assert.equal(lab.acknowledge(receipt(cleanup)),false);assert.equal(lab.acknowledge(receipt(pending)),false);
 stopped(lab,'grant-pending');
});
test('withdrawal after acknowledged grant stops permission synchronously and rejects stale duplicate receipts',()=>{
 const lab=ready();const old=grant(lab);const cleanup=lab.requestWithdrawal();stopped(lab,'withdrawal-pending');
 assert.equal(lab.acknowledge(receipt(old)),false);
 assert.equal(lab.acknowledge({...receipt(cleanup),result:'pending'}),false);
 assert.equal(lab.acknowledge({...receipt(cleanup),url:'forbidden'}),false);
 assert.deepEqual(lab.requestWithdrawal(),cleanup);assert.equal(lab.acknowledge(receipt(cleanup)),true);stopped(lab,'denied');
 assert.equal(lab.acknowledge(receipt(cleanup)),false);assert.equal(lab.requestWithdrawal(),null);
});
test('ambiguous grant response forces cleanup instead of assuming denial or retrying enable',()=>{
 const lab=ready();const old=lab.requestGrant(choice());
 assert.equal(lab.grantUncertain(old.revision+1n),null);
 const cleanup=lab.grantUncertain(old.revision);assert.equal(cleanup.operation,'withdraw');stopped(lab,'withdrawal-pending');
 assert.equal(lab.grantUncertain(old.revision),null);assert.equal(lab.acknowledge(receipt(old)),false);
 assert.equal(lab.requestGrant(choice()),null);assert.deepEqual(lab.requestWithdrawal(),cleanup);
 assert.equal(lab.acknowledge(receipt(cleanup)),true);stopped(lab,'denied');
});
test('GPC, DNT, readiness loss and changed notice invalidate active and pending grants',()=>{
 for(const bad of [{...context(),globalPrivacyControl:true},{...context(),doNotTrack:true},{...context(),operationalReady:false},{...context(),noticeVersion:'old'},null]){
  for(const acknowledged of [false,true]){
   const lab=ready();const old=acknowledged?grant(lab):lab.requestGrant(choice());const cleanup=lab.observeContext(bad);
   assert.equal(cleanup.operation,'withdraw');stopped(lab,'withdrawal-pending');
   assert.equal(lab.acknowledge(receipt(old)),false);
   assert.equal(lab.observeContext(context()),null);stopped(lab,'withdrawal-pending');
   assert.equal(lab.requestGrant(choice()),null);
   assert.equal(lab.acknowledge(receipt(cleanup)),true);stopped(lab,'denied');
   assert.equal(lab.observeContext(context()),null);stopped(lab,'denied');
  }
 }
});
test('withdrawal confirmation remains accepted with operational or privacy gate closed',()=>{
 const lab=ready();grant(lab);
 const cleanup=lab.observeContext({...context(),globalPrivacyControl:true});
 assert.equal(lab.acknowledge(receipt(cleanup)),true);stopped(lab,'denied');assert.equal(lab.requestGrant(choice()),null);
});
test('state snapshots are detached and never grant production authority',()=>{
 const lab=ready();const snapshot=lab.snapshot();snapshot.phase='granted';snapshot.wouldPermitInLab=true;snapshot.productionActivationAllowed=true;stopped(lab,'off');
 grant(lab);assert.equal(lab.snapshot().productionActivationAllowed,false);
 assert.equal(new EditorialConsentLab().snapshot().wouldPermitInLab,false);
});
