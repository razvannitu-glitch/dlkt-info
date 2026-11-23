import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {extname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const publicDir=join(root,'.dlkt-local-build','public-launch');
const HOST='127.0.0.1';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
 '.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml',
 '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
 '.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};
const formats=[
 {width:320,height:750,label:'small-mobile',mobile:true},
 {width:390,height:844,label:'mobile',mobile:true},
 {width:768,height:1024,label:'tablet',mobile:false},
 {width:1440,height:900,label:'desktop',mobile:false},
];
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));

function localServer(){
 if(!existsSync(join(publicDir,'index.html')))throw Error('DLKT_UI_BUILD_MISSING');
 const config=JSON.parse(readFileSync(join(root,'vercel.json'),'utf8'));
 const csp=(config.headers??[]).flatMap(x=>x.headers??[]).find(x=>x.key==='Content-Security-Policy')?.value;
 if(!csp?.includes("default-src 'none'"))throw Error('DLKT_UI_CSP_MISSING');
 const routes=new Map((config.rewrites??[]).filter(x=>typeof x.source==='string'&&!x.source.includes(':')&&typeof x.destination==='string')
  .map(x=>[x.source,x.destination]));
 return createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',csp);
  res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  let url;try{url=new URL(req.url??'', 'http://'+HOST);}catch{res.writeHead(400).end();return;}
  if(url.pathname.startsWith('/api/')){
   res.setHeader('Content-Type','application/json; charset=utf-8');
   res.writeHead(503).end(JSON.stringify({error:'DLKT_OFFLINE_UI_QA_ONLY'}));return;
  }
  const candidate=routes.get(url.pathname)??(url.pathname==='/'?'/index.html':url.pathname);
  if(!candidate.startsWith('/')||candidate.includes('..')||candidate.includes('\\')||candidate.includes('\0')){
   res.writeHead(400).end();return;
  }
  const file=resolve(publicDir,'.'+candidate);
  if(!file.startsWith(publicDir+sep)){res.writeHead(403).end();return;}
  try{
   if(!statSync(file).isFile())throw Error('not-file');
   res.setHeader('Content-Type',MIME[extname(file).toLowerCase()]??'application/octet-stream');
   res.writeHead(200).end(req.method==='HEAD'?undefined:readFileSync(file));
  }catch{res.writeHead(404).end('not found');}
 });
}
function rpcClient(socket){
 let serial=0;
 const pending=new Map();
 socket.addEventListener('message',event=>{
  let data;try{data=JSON.parse(String(event.data));}catch{return;}
  if(typeof data.id!=='number')return;
  const task=pending.get(data.id);if(!task)return;
  pending.delete(data.id);clearTimeout(task.timer);
  if(data.error)task.reject(Error('DLKT_UI_CDP_'+data.error.message));else task.resolve(data.result??{});
 });
 socket.addEventListener('close',()=>{
  for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('DLKT_UI_CDP_DISCONNECTED'));}
  pending.clear();
 });
 return (method,params={})=>new Promise((resolve,reject)=>{
  const seq=++serial;
  const timer=setTimeout(()=>{pending.delete(seq);reject(Error('DLKT_UI_CDP_TIMEOUT_'+method));},6000);
  pending.set(seq,{resolve,reject,timer});
  socket.send(JSON.stringify({id:seq,method,params}));
 });
}
async function connectChrome(port){
 let targets=null;
 for(let i=0;i<40;i++){
  try{
   const response=await fetch('http://'+HOST+':'+port+'/json/list',{signal:AbortSignal.timeout(1000)});
   if(response.ok){targets=await response.json();break;}
  }catch{/* browser booting */}
  await pause(100);
 }
 const page=Array.isArray(targets)?targets.find(x=>x.type==='page'&&typeof x.webSocketDebuggerUrl==='string'):null;
 if(!page)throw Error('DLKT_UI_CHROME_PAGE_MISSING');
 const ws=new WebSocket(page.webSocketDebuggerUrl);
 await Promise.race([
  new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('DLKT_UI_CHROME_WS_ERROR')),{once:true});}),
  new Promise((_,reject)=>setTimeout(()=>reject(Error('DLKT_UI_CHROME_WS_TIMEOUT')),5000)),
 ]);
 return ws;
}
async function evaluate(call,expression){
 const output=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(output.exceptionDetails||!output.result||!Object.hasOwn(output.result,'value'))throw Error('DLKT_UI_EVAL_FAILED');
 return output.result.value;
}
const probe=[
 '(()=>{',
 "const visible=n=>Boolean(n)&&!n.hidden&&getComputedStyle(n).display!=='none'&&n.getBoundingClientRect().width>0;",
 "const brand=document.querySelector('.brand-header'),menu=document.getElementById('header-menu');",
 "const header=document.querySelector('.site-header');",
 'return {',
 'width:innerWidth,scroll:document.documentElement.scrollWidth,main:document.querySelectorAll("main").length,',
 'brand:visible(brand),brandRight:Math.round(brand?.getBoundingClientRect().right??0),',
 'menu:visible(menu),menuExpanded:menu?.getAttribute("aria-expanded"),',
 'header:visible(header),skipTarget:Boolean(document.getElementById("briefing")),',
 'cardTemplate:Boolean(document.getElementById("card-template")),',
 'navReady:Boolean(header?.hasAttribute("data-navigation-ready"))',
 '};',
 '})()',
].join('');
async function loaded(call){
 for(let i=0;i<40;i++){if(await evaluate(call,'document.readyState==="complete"'))return;await pause(100);}
 throw Error('DLKT_UI_DOCUMENT_TIMEOUT');
}

async function run(){
 if(typeof WebSocket!=='function')throw Error('DLKT_UI_NODE_WEBSOCKET_UNAVAILABLE');
 const bin=process.env.DLKT_CHROME_BIN??'/usr/bin/google-chrome';
 if(!existsSync(bin))throw Error('DLKT_UI_CHROME_NOT_INSTALLED');
 const profile=mkdtempSync(join(process.env.RUNNER_TEMP??tmpdir(),'dlkt-ui-qa-'));
 const outputDir=join(process.env.RUNNER_TEMP??profile,'dlkt-ui-screenshots');
 mkdirSync(outputDir,{recursive:true});
 const server=localServer();
 let browser=null,ws=null;
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,HOST,resolve);});
  const binding=server.address();if(!binding||typeof binding==='string')throw Error('DLKT_UI_INVALID_SERVER');
  browser=spawn(bin,[
   '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',
   '--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
   '--remote-allow-origins=*','--user-data-dir='+profile,'about:blank'
  ],{stdio:'ignore'});
  let port=null;
  for(let i=0;i<80;i++){
   if(browser.exitCode!==null)throw Error('DLKT_UI_BROWSER_EXITED');
   const file=join(profile,'DevToolsActivePort');
   if(existsSync(file)){const value=Number(readFileSync(file,'utf8').split('\n')[0]);if(Number.isSafeInteger(value)&&value>0){port=value;break;}}
   await pause(100);
  }
  if(port===null)throw Error('DLKT_UI_BROWSER_PORT_TIMEOUT');
  ws=await connectChrome(port);
  const cdp=rpcClient(ws);
  await cdp('Page.enable');await cdp('Runtime.enable');
  const observations=[];
  for(const f of formats){
   await cdp('Emulation.setDeviceMetricsOverride',{width:f.width,height:f.height,deviceScaleFactor:1,mobile:f.mobile,scale:1});
   await cdp('Page.navigate',{url:'http://'+HOST+':'+binding.port+'/'});
   await loaded(cdp);await pause(400);
   const m=await evaluate(cdp,probe);
   assert.equal(m.main,1,'reader main absent');
   assert.equal(m.header,true,'header missing');
   assert.equal(m.brand,true,'brand missing');
   assert.equal(m.skipTarget,true,'skip link target missing');
   assert.equal(m.cardTemplate,true,'card template missing');
   assert.ok(m.scroll<=f.width+2,'horizontal overflow at '+f.width+'px, documentWidth='+m.scroll);
   assert.ok(m.brandRight<=f.width+2,'brand outside viewport at '+f.width+'px');
   if(f.mobile){
    assert.equal(m.menu,true,'mobile menu hidden at '+f.width+'px');
    await cdp('Runtime.evaluate',{expression:"document.getElementById('header-menu').click()",returnByValue:true});
    assert.equal(await evaluate(cdp,"document.getElementById('header-menu').getAttribute('aria-expanded')"),'true','mobile menu did not open');
    assert.equal(await evaluate(cdp,"getComputedStyle(document.getElementById('header-navigation')).display!=='none'"),true,'expanded menu inaccessible');
    await cdp('Runtime.evaluate',{expression:"document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",returnByValue:true});
    assert.equal(await evaluate(cdp,"document.getElementById('header-menu').getAttribute('aria-expanded')"),'false','Escape did not close menu');
   }
   await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   assert.equal(await evaluate(cdp,"matchMedia('(prefers-reduced-motion: reduce)').matches"),true);
   const image=(await cdp('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data;
   if(typeof image!=='string'||image.length<1000)throw Error('DLKT_UI_EMPTY_SCREENSHOT');
   const screenshot='dlkt-'+f.label+'-'+f.width+'.png';
   writeFileSync(join(outputDir,screenshot),Buffer.from(image,'base64'),{mode:0o600});
   observations.push({viewport:f.width,documentWidth:m.scroll,menuTested:f.mobile,brandVisible:true,reducedMotion:true,screenshot});
  }
  const result={version:'dlkt-info-offline-browser-smoke-1',status:'OFFLINE_BROWSER_PASS',
   scope:'local-built-static-reader',viewports:observations,
   limitations:['No API, authenticated user, current news, payment or runtime availability tested.',
    'Programmatic layout metrics and screenshots do not replace manual visual review.']};
  writeFileSync(join(outputDir,'report.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log('DLKT_UI_BROWSER_QA '+JSON.stringify(result));
 }finally{
  try{ws?.close();}catch{}
  try{browser?.kill('SIGTERM');}catch{}
  await new Promise(resolve=>server.close(resolve));
  rmSync(profile,{recursive:true,force:true});
 }
}
await run();
