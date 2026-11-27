import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const BASE='/__qa/editorial-exposure/';
const modules=new Set(['editorial-pilot.js','editorial-exposure.js','editorial-consent.js']);
const html='<!doctype html><html lang="en"><meta charset="utf-8"><title>Exposure laboratory</title><style>body{margin:0}article{width:300px;height:200px;background:#eee}#tall{height:1600px}.space{height:1100px}</style><body data-entry-view="start"><main id="discovery-cards"><article id="first" class="info-card editorial-card" data-edition-part="stream" data-card-id="000000000000000000000001" data-news-stream-key="article:000000000000000000000001" data-news-category="05000000">Synthetic education</article><article class="info-card editorial-card" data-edition-part="stream" data-card-id="000000000000000000000004" data-news-stream-key="article:000000000000000000000004" data-news-category="07000000">Excluded category</article><div class="space"></div><article id="second" class="info-card editorial-card" data-edition-part="stream" data-card-id="000000000000000000000002" data-news-stream-key="article:000000000000000000000002" data-news-category="13000000">Synthetic technology</article><div class="space"></div><article id="tall" class="info-card editorial-card" data-edition-part="stream" data-card-id="000000000000000000000003" data-news-stream-key="article:000000000000000000000003" data-news-category="17000000">Too tall for half-card exposure</article><div class="space"></div></main><dialog id="modal">Synthetic modal</dialog></body></html>';

/** Exact allowlist on the existing loopback-only QA server, never a public route. */
export function editorialExposureFixture(req,res,url){
 if(!url.pathname.startsWith(BASE))return false;
 if(url.search||!['GET','HEAD'].includes(req.method)){res.writeHead(404).end();return true;}
 const file=url.pathname.slice(BASE.length);
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
 if(file===''){res.setHeader('Content-Type','text/html; charset=utf-8');res.writeHead(200).end(req.method==='HEAD'?undefined:html);return true;}
 if(!modules.has(file)){res.writeHead(404).end();return true;}
 const source=readFileSync(new URL('../source/.build/src/audience/'+file,import.meta.url),'utf8');
 res.setHeader('Content-Type','text/javascript; charset=utf-8');res.writeHead(200).end(req.method==='HEAD'?undefined:source);return true;
}

export async function verifyEditorialExposure({origin,openIsolated,evaluate,loaded,pause}){
 const browser=await openIsolated(),call=browser.call;
 const state=()=>evaluate(call,'window.exposureLab.snapshot()');
 const total=async()=>{const s=await state();assert.equal(s.status,'observing-lab');return s.rows.reduce((sum,row)=>sum+row.qualifiedImpressions,0);};
 const until=async(expected,label)=>{for(let i=0;i<80;i++){if(await total()===expected)return;await pause(100);}throw Error('DLKT_EDITORIAL_EXPOSURE_TIMEOUT_'+label);};
 const run=expression=>evaluate(call,'(()=>{'+expression+';return true;})()');
 try{
  await call('Emulation.setDeviceMetricsOverride',{width:900,height:600,deviceScaleFactor:1,mobile:false,scale:1});
  await call('Page.navigate',{url:origin+BASE});await loaded(call);await call('Page.bringToFront');
  assert.equal(await evaluate(call,'document.visibilityState==="visible"&&document.hasFocus()'),true);
  const inactive=await evaluate(call,`(async()=>{const e=await import('${BASE}editorial-exposure.js'),c=await import('${BASE}editorial-consent.js');window.editorialModules={e,c};window.editorialConsent=new c.EditorialConsentLab();window.exposureLab=e.observeEditorialExposureLab(document.getElementById('discovery-cards'),()=>window.editorialConsent.snapshot().wouldPermitInLab);return window.exposureLab.snapshot();})()`);
  assert.equal(inactive.status,'stopped');assert.deepEqual(inactive.rows,[]);
  await run("const {e,c}=window.editorialModules,lab=window.editorialConsent;lab.observeContext({operationalReady:true,globalPrivacyControl:false,doNotTrack:false,noticeVersion:c.EDITORIAL_NOTICE_VERSION});const command=lab.requestGrant({choice:'allow',purpose:c.EDITORIAL_CONSENT_PURPOSE,noticeVersion:c.EDITORIAL_NOTICE_VERSION});if(!command||!lab.acknowledge({...command,result:'granted'}))throw Error('LAB_CONSENT');window.exposureLab=e.observeEditorialExposureLab(document.getElementById('discovery-cards'),()=>lab.snapshot().wouldPermitInLab)");
  await pause(350);assert.equal(await total(),0,'short view is not qualified');
  await until(1,'FIRST');
  await run("const first=document.getElementById('first');first.replaceWith(first.cloneNode(true))");
  await pause(1300);assert.equal(await total(),1,'stable key rerender is not a new exposure');
  await run("document.getElementById('second').scrollIntoView({block:'start',behavior:'instant'})");
  await pause(250);
  await run("window.scrollTo(0,0)");
  await pause(1300);assert.equal(await total(),1,'fast scroll past another card is not an exposure');
  await run("document.getElementById('second').scrollIntoView({block:'start',behavior:'instant'});document.getElementById('modal').showModal()");
  await pause(1300);assert.equal(await total(),1,'open modal blocks dwell');
  await run("document.getElementById('modal').close()");
  await until(2,'SECOND');
  await run("document.getElementById('tall').scrollIntoView({block:'start',behavior:'instant'})");
  await pause(1600);assert.equal(await total(),2,'half of a 1600px card cannot fit a 600px viewport');
  const measured=await state();assert.equal(measured.productionActivationAllowed,false);
  assert.deepEqual(measured.rows.filter(row=>row.qualifiedImpressions>0),[{category:'05000000',qualifiedImpressions:1},{category:'13000000',qualifiedImpressions:1}]);
  await run("window.editorialConsent.requestWithdrawal();window.exposureLab.stop()");
  const withdrawn=await state();assert.equal(withdrawn.status,'stopped');assert.deepEqual(withdrawn.rows,[]);
  const privateState=await evaluate(call,'({cookie:document.cookie,local:localStorage.length,session:sessionStorage.length})');
  assert.deepEqual(privateState,{cookie:'',local:0,session:0});
  return {status:'EDITORIAL_EXPOSURE_LAB_PASS',qualifiedImpressions:2,shortViewExcluded:true,modalExcluded:true,oversizeExcluded:true,rerenderDeduplicated:true,withdrawalClears:true,scope:'Chromium loopback synthetic card markup only; no live telemetry, open actions, storage or production authorization'};
 }finally{await browser.close();}
}
