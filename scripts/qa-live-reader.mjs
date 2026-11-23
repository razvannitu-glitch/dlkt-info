import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const ORIGIN = 'https://www.dlkt.ee';
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
async function evaluate(call,expression) {
  const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
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
    scrollWidth:Math.ceil(document.documentElement.scrollWidth),
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
async function main(){
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
      if(request&&typeof request.url==='string'&&request.url.startsWith(ORIGIN+'/api/')
        &&['POST','PUT','PATCH','DELETE'].includes(request.method))mutatingFirstPartyRequests++;
    });
    await cdp('Network.enable');
    for(const view of VIEWPORTS){
      const failures=[];
      await cdp('Emulation.setDeviceMetricsOverride',{
        width:view.width,height:view.height,deviceScaleFactor:1,mobile:view.mobile,scale:1,
      });
      await cdp('Page.navigate',{url:ORIGIN+'/'});
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
    const status=results.every(item=>item.failures.length===0)&&mutatingFirstPartyRequests===0
      ?'LIVE_READER_PASS':'LIVE_READER_BLOCKED';
    const report={
      version:'dlkt-info-live-browser-smoke-1',status,origin:ORIGIN,
      anonymous:true,mutatingFirstPartyRequests,viewports:results,
      limitations:[
        'Anonymous public homepage only; no OTP, wallet, payments, geo targeting or third-party article accuracy checked.',
        'Screenshots and browser DOM checks do not replace human visual review.',
      ],
    };
    writeFileSync(join(destination,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
    console.log('DLKT_LIVE_BROWSER_QA '+JSON.stringify(report));
    if(status!=='LIVE_READER_PASS')process.exitCode=1;
  }finally{
    try{ws?.close();}catch{}
    if(chrome&&chrome.exitCode===null){
      try{chrome.kill('SIGTERM');await pause(400);if(chrome.exitCode===null)chrome.kill('SIGKILL');}catch{}
    }
    try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
    catch(error){if(!['ENOTEMPTY','EBUSY'].includes(error?.code))throw error;}
  }
}
await main();
