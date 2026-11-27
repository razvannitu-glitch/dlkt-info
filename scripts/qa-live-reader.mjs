import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {KNOWLEDGE_ORIGIN,KNOWLEDGE_IDENTITY,knowledgeCases,knowledgeCanonicalUrl,knowledgeCreditText,knowledgeCreditLinks,knowledgeCopyMessage,readKnowledgeProbeOptions,readKnowledgeReceipt,knowledgeRunBoundary} from './verify-live-knowledge.mjs';

const HOST = '127.0.0.1';
const MAX_WAIT_MS = 18_000;
const VIEWPORTS = Object.freeze([
  {label:'mobile-small',width:320,height:750,mobile:true},
  {label:'mobile',width:390,height:844,mobile:true},
  {label:'tablet',width:768,height:1024,mobile:false},
  {label:'desktop',width:1440,height:900,mobile:false},
]);
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));

function rpcClient(ws) {
  let serial=0;
  const pending=new Map();
  ws.addEventListener('message',event=>{
    let payload;try{payload=JSON.parse(String(event.data));}catch{return;}
    const task=pending.get(payload.id);if(!task)return;
    pending.delete(payload.id);clearTimeout(task.timer);
    if(payload.error)task.reject(Error('LIVE_CDP_COMMAND_FAILED'));
    else task.resolve(payload.result??{});
  });
  ws.addEventListener('close',()=>{
    for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('LIVE_CDP_DISCONNECTED'));}
    pending.clear();
  });
  return (method,params={})=>new Promise((resolve,reject)=>{
    const id=++serial;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('LIVE_CDP_TIMEOUT'));},10_000);
    pending.set(id,{resolve,reject,timer});
    ws.send(JSON.stringify({id,method,params}));
  });
}

async function connectChrome(port) {
  let targets;
  for(let i=0;i<45;i++){
    try {
      const res=await fetch('http://'+HOST+':'+port+'/json/list',{signal:AbortSignal.timeout(1000)});
      if(res.ok){targets=await res.json();break;}
    }catch{/* Chrome may still be starting. */}
    await pause(150);
  }
  const page=Array.isArray(targets)?targets.find(x=>x.type==='page'&&typeof x.webSocketDebuggerUrl==='string'):null;
  if(!page)throw Error('LIVE_BROWSER_TARGET_MISSING');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await Promise.race([
    new Promise((resolve,reject)=>{
      ws.addEventListener('open',resolve,{once:true});
      ws.addEventListener('error',()=>reject(Error('LIVE_BROWSER_SOCKET_FAILED')),{once:true});
    }),
    pause(6000).then(()=>{throw Error('LIVE_BROWSER_SOCKET_TIMEOUT');}),
  ]);
  return ws;
}
async function evaluate(call,expression,userGesture=false) {
  const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture});
  if(result.exceptionDetails) {
    const firstLine=String(result.exceptionDetails.exception?.description??result.exceptionDetails.text??'unknown')
      .split('\\n')[0].slice(0,160);
    throw Error('LIVE_BROWSER_EVALUATION_FAILED: '+firstLine);
  }
  if(!result.result||!Object.hasOwn(result.result,'value'))
    throw Error('LIVE_BROWSER_EVALUATION_NO_VALUE: '+String(result.result?.type??'missing'));
  return result.result.value;
}

function browserProbe() {
  const get=id=>document.getElementById(id);
  const visible=n=>Boolean(n)&&!n.hidden&&getComputedStyle(n).display!=='none'
    &&n.getBoundingClientRect().width>0;
  const cards=[...document.querySelectorAll('#discovery-cards article')];
  const anchors=cards.flatMap(node=>[...node.querySelectorAll('a.source-link[href]')]);
  const sourceLinks=anchors.filter(anchor=>{
    try {
      const url=new URL(anchor.href);
      return url.protocol==='https:'&&url.hostname!==location.hostname;
    }catch{return false;}
  });
  const brand=document.querySelector('.brand-header');
  const menu=get('header-menu');
  return {
    ready:document.readyState,
    main:document.querySelectorAll('main').length,
    header:visible(document.querySelector('.site-header')),
    brand:visible(brand),
    brandRight:Math.ceil(brand?.getBoundingClientRect().right??0),
    menu:visible(menu),
    scrollWidth:Math.ceil(document.documentElement?.scrollWidth??0),
    innerWidth,
    cards:cards.length,
    sourceLinks:sourceLinks.length,
    editionState:get('discovery-cards')?.dataset.editionState??null,
    busy:get('discovery-cards')?.getAttribute('aria-busy')??null,
    loadingState:get('discovery')?.dataset.loading??null,
    skipTarget:Boolean(get('briefing')),
    title:document.title==='DLKT INFO — Daily Life. Key Things.',
  };
}
const PROBE='('+browserProbe.toString()+')()';
async function waitForEdition(call){
  const deadline=Date.now()+MAX_WAIT_MS;
  let last;
  while(Date.now()<deadline){
    last=await evaluate(call,PROBE);
    if(last.ready==='complete'&&last.cards>0&&last.sourceLinks>0&&last.busy==='false')break;
    await pause(300);
  }
  return last;
}
// Executed inside the real Chromium document, not against server HTML strings.
export function inspectKnowledgeDocument(){
  const normalize=value=>typeof value==='string'?value.replace(/\s+/gu,' ').trim():'';
  const visible=node=>{
    if(!node||node.getClientRects().length===0||node.getBoundingClientRect().width<=0||node.getBoundingClientRect().height<=0)return false;
    for(let n=node;n;n=n.parentElement){
      const style=getComputedStyle(n);
      if(n.hidden||n.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0||style.contentVisibility==='hidden')return false;
    }
    return true;
  };
  const articles=[...document.querySelectorAll('[data-shared-knowledge-id]')],a=articles[0],f=a?.querySelector('#shared-freshness');
  const credits=[...a?.querySelectorAll('.card-credits')??[]],credit=credits[0];
  const buttons=[...document.querySelectorAll('#shared-copy')],b=buttons[0];
  const canonical=[...document.querySelectorAll('head link[rel="canonical"]')];
  return {ready:document.readyState,url:location.href,lang:document.documentElement.lang,articleCount:articles.length,id:a?.getAttribute('data-shared-knowledge-id')??null,
    expiry:f?.dataset.validUntil??null,canonical:canonical.length===1?canonical[0].href:null,
    source:[...a?.querySelectorAll('a.source-link[href]')??[]].filter(visible).map(n=>n.href),
    creditCount:credits.length,creditVisible:visible(credit),creditText:normalize(credit?.innerText),
    creditLinks:[...credit?.querySelectorAll('a')??[]].map(n=>({href:n.href,text:normalize(n.innerText),visible:visible(n)})),
    copyCount:buttons.length,copyVisible:visible(b),copyEnabled:Boolean(b&&!b.disabled&&a?.contains(b)),copyUrl:b?.dataset.cardUrl??null,
    main:document.querySelectorAll('main').length,width:document.documentElement.scrollWidth,
    status:performance.getEntriesByType('navigation')[0]?.responseStatus??null};
}
export function assessKnowledgeBrowser(item,state,url,width){
  const failures=[];
  if(state?.ready!=='complete'||state.url!==url)failures.push('document');
  if(state?.lang!==item.language)failures.push('language');
  if(state?.status!==item.status)failures.push('http-status');
  if(state?.main!==1)failures.push('main');
  if(typeof state?.width!=='number'||state.width>width+2)failures.push('horizontal-overflow');
  if(item.status===200){
    if(state?.articleCount!==1||state?.id!==KNOWLEDGE_IDENTITY.id||state.expiry!==String(KNOWLEDGE_IDENTITY.expiresAt)||state.canonical!==knowledgeCanonicalUrl(item.language))failures.push('exact-card');
    if(state?.source?.length!==1||state.source[0]!==KNOWLEDGE_IDENTITY.source)failures.push('source');
    const expected=knowledgeCreditLinks(item.language);
    if(state?.creditCount!==1||!state.creditVisible||state.creditText!==knowledgeCreditText(item.language)||state.creditLinks?.length!==2||
      !expected.every((link,i)=>state.creditLinks[i]?.visible&&state.creditLinks[i].href===link.href&&state.creditLinks[i].text===link.text))failures.push('visible-exact-credit');
    if(state?.copyCount!==1||!state.copyVisible||!state.copyEnabled||state.copyUrl!==knowledgeCanonicalUrl(item.language))failures.push('copy-control');
  }else if(state?.articleCount!==0||state?.copyCount!==0)failures.push('unexpected-admission');
  return failures;
}
export async function verifyKnowledgeCopy(cdp,item){
  const canonical=knowledgeCanonicalUrl(item.language),message=knowledgeCopyMessage(item.language);
  // This clipboard belongs to the disposable browser runner. Seed a known
  // different value so a stale clipboard cannot satisfy the assertion.
  const seeded=await evaluate(cdp,"(async()=>{await navigator.clipboard.writeText('DLKT-QA-NOT-COPIED');return (await navigator.clipboard.readText())==='DLKT-QA-NOT-COPIED';})()",true);
  if(!seeded)return false;
  const focused=await evaluate(cdp,"(()=>{const b=document.getElementById('shared-copy');if(!b||b.hidden||b.disabled)return false;b.scrollIntoView({block:'center',inline:'nearest'});b.focus();const r=b.getBoundingClientRect();return document.activeElement===b&&r.width>0&&r.height>0;})()");
  if(!focused)return false;
  // Match the native Enter activation already exercised by offline browser QA.
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
  await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  for(let i=0;i<30;i++){
    const result=await evaluate(cdp,"(async()=>{const b=document.getElementById('shared-copy'),f=document.getElementById('shared-fallback'),m=document.getElementById('shared-message');return {copied:await navigator.clipboard.readText(),message:m?.innerText??null,enabled:Boolean(b&&!b.hidden&&!b.disabled),fallbackHidden:Boolean(f&&f.hidden)};})()",true);
    if(result?.copied===canonical&&result.message===message&&result.enabled&&result.fallbackHidden)return true;
    await pause(100);
  }
  return false;
}
async function probeKnowledgeBrowser(cdp,options,started,before){
  const items=knowledgeCases(started).filter(item=>item.key.startsWith('canonical-')),results=[];
  const expression='('+inspectKnowledgeDocument.toString()+')()';
  let clipboardReady=false;
  if(items.some(item=>item.status===200)){
    try{
      await cdp('Page.bringToFront');
      await cdp('Browser.grantPermissions',{origin:options.origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
      clipboardReady=true;
    }catch{/* An unavailable clipboard is a failed active-admission check. */}
  }
  for(const item of items){
    const url=options.origin+item.path,view=item.language==='it'?VIEWPORTS[3]:item.language==='ro'?VIEWPORTS[1]:VIEWPORTS[0];
    const failures=[];let state=null,copyVerified=false;
    try{
      await cdp('Emulation.setDeviceMetricsOverride',{width:view.width,height:view.height,deviceScaleFactor:1,mobile:view.mobile,scale:1});
      await cdp('Page.navigate',{url});
      const deadline=Date.now()+MAX_WAIT_MS;
      while(Date.now()<deadline){
        try{state=await evaluate(cdp,expression);}catch{state=null;}
        if(state?.ready==='complete'&&state.url===url&&(state.status!==200||state.copyEnabled&&state.copyVisible||item.status!==200))break;
        await pause(250);
      }
    }catch{failures.push('navigation');}
    failures.push(...assessKnowledgeBrowser(item,state,url,view.width));
    if(item.status===200&&failures.length===0&&clipboardReady){
      try{copyVerified=await verifyKnowledgeCopy(cdp,item)&&await evaluate(cdp,'location.href')===url;}catch{/* Fail closed. */}
    }
    if(item.status===200&&!copyVerified)failures.push('clipboard-copy');
    results.push({language:item.language,viewport:view.width,expected:item.status,observed:state?.status??null,copyVerified,failures});
  }
  const after=await readKnowledgeReceipt(fetch,options),completed=Date.now();
  const boundary=knowledgeRunBoundary(before,after,started,completed,options);
  const passed=boundary.failures.length===0&&results.every(item=>item.failures.length===0);
  const recoveryVerified=passed&&options.mode==='recovery';
  const status=!passed?'LIVE_KNOWLEDGE_BROWSER_BLOCKED':recoveryVerified?'LIVE_KNOWLEDGE_BROWSER_RECOVERY_PASS':boundary.activeAtStart?'LIVE_KNOWLEDGE_BROWSER_MONITOR_PASS':'LIVE_KNOWLEDGE_BROWSER_DENIAL_PASS';
  return {status,passed,recoveryVerified,mode:options.mode,activeAtStart:boundary.activeAtStart,commit:boundary.stable?before.commit:null,manifest:boundary.stable?before.manifest:null,failures:boundary.failures,results};
}
async function main(){
  const options=readKnowledgeProbeOptions(),origin=options.origin;
  assert.equal(typeof WebSocket,'function','Node 22 WebSocket required');
  const bin=process.env.DLKT_CHROME_BIN??'/usr/bin/google-chrome';
  if(!existsSync(bin))throw Error('LIVE_BROWSER_CHROME_MISSING');
  const profile=mkdtempSync(join(process.env.RUNNER_TEMP??tmpdir(),'dlkt-live-browser-'));
  const destination=join(process.env.RUNNER_TEMP??profile,'dlkt-live-reader');
  mkdirSync(destination,{recursive:true});
  let chrome=null,ws=null;
  const results=[];
  try{
    chrome=spawn(bin,[
      '--headless=new','--no-sandbox','--disable-dev-shm-usage',
      '--disable-background-networking','--disable-sync',
      '--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
      '--remote-allow-origins=*','--user-data-dir='+profile,'about:blank',
    ],{stdio:'ignore'});
    let port=null;
    for(let i=0;i<240;i++){
      if(chrome.exitCode!==null)throw Error('LIVE_BROWSER_EXITED');
      const f=join(profile,'DevToolsActivePort');
      if(existsSync(f)){
        const value=Number(readFileSync(f,'utf8').split('\n')[0]);
        if(Number.isSafeInteger(value)&&value>0){port=value;break;}
      }
      await pause(100);
    }
    if(port===null)throw Error('LIVE_BROWSER_PORT_TIMEOUT');
    ws=await connectChrome(port);
    const cdp=rpcClient(ws);
    await cdp('Page.enable');await cdp('Runtime.enable');
    let mutatingFirstPartyRequests=0;
    ws.addEventListener('message',event=>{
      let eventData;try{eventData=JSON.parse(String(event.data));}catch{return;}
      const request=eventData.method==='Network.requestWillBeSent'?eventData.params?.request:null;
      if(request&&typeof request.url==='string'&&[origin,KNOWLEDGE_ORIGIN].some(value=>request.url.startsWith(value+'/api/'))
        &&['POST','PUT','PATCH','DELETE'].includes(request.method))mutatingFirstPartyRequests++;
    });
    await cdp('Network.enable');
    const started=Date.now(),before=await readKnowledgeReceipt(fetch,options);
    for(const view of VIEWPORTS){
      const failures=[];
      await cdp('Emulation.setDeviceMetricsOverride',{
        width:view.width,height:view.height,deviceScaleFactor:1,mobile:view.mobile,scale:1,
      });
      await cdp('Page.navigate',{url:origin+'/'});
      const state=await waitForEdition(cdp);
      if(state.main!==1)failures.push('missing-main');
      if(!state.header||!state.brand||!state.title)failures.push('brand-or-header');
      if(!state.skipTarget)failures.push('skip-target');
      if(state.scrollWidth>view.width+2)failures.push('horizontal-overflow');
      if(state.brandRight>view.width+2)failures.push('brand-overflow');
      if(state.cards===0||state.sourceLinks===0||state.busy!=='false')
        failures.push('published-cards-unavailable');
      if(view.mobile){
        if(!state.menu)failures.push('mobile-menu-hidden');
        else{
          await cdp('Runtime.evaluate',{expression:"document.getElementById('header-menu').click()",returnByValue:true});
          if(await evaluate(cdp,"document.getElementById('header-menu').getAttribute('aria-expanded')")!=='true')
            failures.push('mobile-menu-open');
          await cdp('Runtime.evaluate',{expression:"document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",returnByValue:true});
          if(await evaluate(cdp,"document.getElementById('header-menu').getAttribute('aria-expanded')")!=='false')
            failures.push('mobile-menu-escape');
        }
      }
      const image=await cdp('Page.captureScreenshot',{
        format:'png',fromSurface:true,captureBeyondViewport:false,
      });
      const name='live-'+view.label+'-'+view.width+'.png';
      if(typeof image.data!=='string'||image.data.length<1000)failures.push('screenshot-missing');
      else writeFileSync(join(destination,name),Buffer.from(image.data,'base64'),{mode:0o600});
      results.push({
        viewport:view.width,documentWidth:state.scrollWidth,cards:state.cards,
        sourceLinks:state.sourceLinks,editionState:state.editionState,
        loadingState:state.loadingState,menuTested:view.mobile,
        screenshot:name,failures,
      });
    }
    const knowledgeDistribution=await probeKnowledgeBrowser(cdp,options,started,before);
    const passed=results.every(item=>item.failures.length===0)&&mutatingFirstPartyRequests===0&&knowledgeDistribution.passed;
    const recoveryVerified=passed&&knowledgeDistribution.recoveryVerified;
    const status=!passed?'LIVE_READER_BLOCKED':recoveryVerified?'LIVE_READER_RECOVERY_PASS':knowledgeDistribution.activeAtStart?'LIVE_READER_MONITOR_PASS':'LIVE_READER_DENIAL_PASS';
    const report={
      version:'dlkt-info-live-browser-smoke-1',status,origin,mode:options.mode,recoveryVerified,
      anonymous:true,mutatingFirstPartyRequests,viewports:results,knowledgeDistribution,
      limitations:[
        'Anonymous homepage and exact NSW standalone links at the selected origin; no OTP, wallet, payments, authenticated Control, geo targeting or third-party article accuracy checked.',
        'Screenshots and browser DOM checks do not replace human visual review.',
      ],
    };
    writeFileSync(join(destination,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
    console.log('DLKT_LIVE_BROWSER_QA '+JSON.stringify(report));
    if(!passed)process.exitCode=1;
  }finally{
    try{ws?.close();}catch{}
    if(chrome&&chrome.exitCode===null){
      try{chrome.kill('SIGTERM');await pause(400);if(chrome.exitCode===null)chrome.kill('SIGKILL');}catch{}
    }
    try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
    catch(error){if(!['ENOTEMPTY','EBUSY'].includes(error?.code))throw error;}
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
