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
 {width:360,height:800,label:'mobile-360',mobile:true},
 {width:390,height:844,label:'mobile',mobile:true},
 {width:430,height:932,label:'mobile-430',mobile:true},
 {width:768,height:1024,label:'tablet',mobile:false},
 {width:1440,height:900,label:'desktop',mobile:false},
];
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));

function localServer(fixture){
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
   void fixture.response(url).then(({status,value})=>res.writeHead(status).end(JSON.stringify(value))).catch(()=>res.writeHead(500).end(JSON.stringify({error:'DLKT_QA_FIXTURE_FAILED'})));return;
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


/** Controlled evidence exercises the real page service; it is never a claim of a live source check. */
async function newsFixture(){
 const [{NewsPageService,parseNewsPageRequest,parseNewsSourcesRequest},{article,epoch,CorpusMemoryStore,snapshot,hash},{cardContent},{findCity}]=await Promise.all([
  import('../source/.build/src/iceo/news-page.js'),import('../source/tests/fixtures/news-corpus.mjs'),
  import('../source/.build/src/iceo/card-validation.js'),import('../source/.build/src/local/cities.js'),
 ]);
 const now=Date.now(),city=findCity('683506');assert.ok(city,'controlled Bucharest city is registered');
 const observed=[
  {title:'O cântăreață iraniană și membrii trupei sale, pedepsiți cu 74 de lovituri de bici pentru un concert - HotNews.ro',publisher:'HotNews.ro',
   sourceUrl:'https://hotnews.ro/o-cantareata-iraniana-si-membrii-trupei-sale-pedepsiti-cu-74-de-lovituri-de-bici-pentru-un-concert-2412112'},
  {title:'O cântăreață iraniană a fost pedepsită cu 74 de lovituri de bici pentru un concert fără vălul islamic. VIDEO',publisher:'Știrile ProTV',
   sourceUrl:'https://stirileprotv.ro/stiri/international/o-cantareata-iraniana-a-fost-pedepsita-cu-74-de-lovituri-de-bici-pentru-un-concert-fara-valul-islamic-video.html'},
  {title:'O cântăreaţă iraniană şi membrii trupei sale au primit 74 de lovituri de bici din cauza unui concert pe YouTube',publisher:'Digi24',
   sourceUrl:'https://www.digi24.ro/stiri/externe/mapamond/o-cantareata-iraniana-si-membrii-trupei-sale-au-primit-74-de-lovituri-de-bici-din-cauza-unui-concert-pe-youtube-4049697'},
 ];
 const reports=observed.map((entry,index)=>{
  const card={...article(900+index,{now,language:'ro',category:'01000000',published:now-10_000-index*1000}),...entry,
   identity:entry.sourceUrl,id:hash(entry.sourceUrl).slice(0,24),boundary:'Controlled browser QA evidence; source-check and publication dates are fixtures.',
   attribution:'Controlled QA fixture from observed publisher headline and URL.'};
  card.contentHash=hash(cardContent(card));return card;
 });
 const distinct={...article(950,{now,language:'ro',category:'01000000'}),
  title:'O cântăreață iraniană a primit 75 de lovituri de bici pentru un concert in Teheran',
  boundary:'Synthetic negative-control event for browser QA; not live reporting.'};
 distinct.contentHash=hash(cardContent(distinct));
 const english=article(960,{now,language:'en',category:'13000000'}),cards=[...reports,distinct,english];
 const stored=epoch(cards,[],{now}),before=JSON.stringify(stored),service=new NewsPageService(new CorpusMemoryStore([stored]),'test-only-browser-qa-cursor-key-123456789012345678901234567890');
 const selected=await service.read({language:'ro',cityId:city.id,filter:'all',cursor:null,period:'recent',sourceScope:'all'});
 assert.equal(selected.articleTotal,5,'all five originals are eligible before testing layout');
 assert.equal(selected.total,3,'three reports share one event; two distinct reports remain separate');
 const groups=selected.items.filter(item=>item.story?.sourceTotal===3);assert.equal(groups.length,1);
 const grouped=groups[0],groupOriginals=[{kind:grouped.kind,card:grouped.card},...grouped.story.related];
 assert.deepEqual(new Set(groupOriginals.map(item=>item.card.sourceUrl)),new Set(reports.map(card=>card.sourceUrl)));
 assert.equal(selected.items.some(item=>item.card.id===distinct.id),true,'the different penalty cannot be silently merged');
 assert.equal(selected.items.some(item=>item.card.id===english.id),true,'all-source scope must include the English original');
 assert.equal(JSON.stringify(stored),before,'the reader cannot restamp the stored evidence');
 return {city,groupKey:grouped.story.key,urls:reports.map(card=>card.sourceUrl),titles:reports.map(card=>card.title),storyCount:selected.total,articleTotal:selected.articleTotal,
  async response(url){
   if(url.pathname==='/api/iceo')return {status:200,value:snapshot(cards,now)};
   if(url.pathname==='/api/news-page'){
    const cursor=parseNewsSourcesRequest(url);
    return {status:200,value:cursor===null?await service.read(parseNewsPageRequest(url)):await service.readSources(cursor)};
   }
   return {status:503,value:{error:'DLKT_OFFLINE_UI_QA_ONLY'}};
  }};
}


async function selectControlledEdition(call,fixture){
 for(let attempt=0;attempt<60;attempt++){
  if(await evaluate(call,"Boolean(document.querySelector('#reader-language option[value=\"ro\"]')&&document.querySelector('#home-news-source-scope'))"))break;
  if(attempt===59)throw Error('DLKT_UI_READER_CONTROLS_TIMEOUT');await pause(100);
 }
 await evaluate(call,'(()=>{const picker=document.querySelector("#reader-language");picker.value="ro";picker.dispatchEvent(new Event("change",{bubbles:true}));document.dispatchEvent(new CustomEvent("dlkt:city-selected",{detail:{city:'+JSON.stringify(fixture.city)+'}}));return true;})()');
 for(let attempt=0;attempt<80;attempt++){
  const current=await evaluate(call,'(()=>{const root=document.querySelector("#discovery-cards");return {scope:root?.dataset.sourceScope,count:root?.querySelectorAll("article[data-news-stream-key]").length,city:document.querySelector("#glance-city-label")?.textContent};})()');
  if(current.scope==='all'&&current.count===fixture.storyCount&&current.city===fixture.city.name)return;
  if(attempt===79)throw Error('DLKT_UI_NEWS_FIXTURE_TIMEOUT_'+JSON.stringify(current));await pause(100);
 }
}
/** Run inside Chrome: actual layout and computed styles, without replacing production DOM. */
function readerProbe(expected){
 const visible=node=>Boolean(node)&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none';
 const rect=node=>{const value=node.getBoundingClientRect();return {left:value.left,right:value.right,top:value.top,bottom:value.bottom,width:value.width,height:value.height};};
 const textFits=(node,container)=>{
  if(!visible(node)||!visible(container))return false;
  const range=document.createRange();range.selectNodeContents(node);const text=range.getBoundingClientRect(),bound=container.getBoundingClientRect();
  return text.left>=bound.left-1&&text.right<=bound.right+1&&text.top>=bound.top-1&&text.bottom<=bound.bottom+1
   &&(node.clientWidth===0||node.scrollWidth<=node.clientWidth+1)&&(node.clientHeight===0||node.scrollHeight<=node.clientHeight+1);
 };
 const calendar=document.querySelector('#glance-date'),city=document.querySelector('#glance-city-label'),country=document.querySelector('#glance-zone'),cityButton=document.querySelector('#glance-city');
 const normalized=value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
 const expectedCountry=new Intl.DisplayNames(['ro'],{type:'region'}).of(expected.city.countryCode);
 const cards=[...document.querySelectorAll('#discovery-cards article[data-news-stream-key]')],groups=cards.filter(node=>node.dataset.storyKey===expected.groupKey),group=groups[0];
 const originals=group?[...group.querySelectorAll('.news-story-source-link')]:[];
 const languageLabels=cards.map(card=>({id:card.dataset.cardId,labels:[...card.querySelectorAll('[data-original-language]')].filter(visible).map(node=>({language:node.dataset.originalLanguage,text:node.textContent}))}));
 const controls=[...document.querySelectorAll('#glance-city,#reader-language,#reader-theme-toggle,#home-news-source-scope,#home-news-english,#home-news-period,#home-news-category,#discovery-cards .card-actions > button,#discovery-cards .card-actions > a,#discovery-cards .evidence > summary,#discovery-cards .news-story-sources > summary')].filter(visible);
 return {scope:document.querySelector('#discovery-cards')?.dataset.sourceScope,documentWidth:document.documentElement.scrollWidth,
  date:calendar?.textContent??'',dateValue:calendar?.dateTime??'',dateAfter:calendar?getComputedStyle(calendar,'::after').content:null,dateVisible:visible(calendar),
  city:city?.textContent??'',country:country?.textContent??'',expectedCountry,
  cityComplete:city?.textContent===expected.city.name&&textFits(city,cityButton),
  countryComplete:normalized(country?.textContent??'')===normalized(expectedCountry??'')&&textFits(country,cityButton),
  cityButton:cityButton?rect(cityButton):null,storyCount:cards.length,groupCount:groups.length,
  groupUrls:originals.map(node=>node.href),groupTitles:originals.map(node=>node.textContent),languageLabels,
  controls:controls.map(node=>({id:node.id||node.className,tag:node.tagName,...rect(node)}))};
}
function assertReaderGeometry(measured,format,fixture){
 const width=format.width;
 assert.ok(measured.documentWidth<=width+2,'news document overflows at '+width+'px');
 assert.equal(measured.scope,'all');assert.equal(measured.dateVisible,true,'date visible at '+width+'px');
 assert.match(measured.dateValue,/^\d{4}-\d\d-\d\d$/u);assert.ok(measured.date.length>8,'date has real text');
 assert.ok(['none','normal','""'].includes(measured.dateAfter),'date must have one text rendering, without duplicate ::after content at '+width+'px');
 assert.equal(measured.cityComplete,true,'full city text must fit at '+width+'px: '+JSON.stringify(measured.cityButton));
 assert.equal(measured.countryComplete,true,'full country text must fit at '+width+'px');
 assert.equal(measured.storyCount,fixture.storyCount,'every distinct story remains represented');
 assert.equal(measured.groupCount,1,'the shared event appears once in the main feed');
 assert.deepEqual(new Set(measured.groupUrls),new Set(fixture.urls),'the single event keeps all three original source links');
 assert.deepEqual(new Set(measured.groupTitles),new Set(fixture.titles),'the three publisher headlines stay exact');
 assert.ok(measured.languageLabels.every(card=>card.labels.length>0),'every card has a visible original-language label');
 assert.deepEqual(new Set(measured.languageLabels.flatMap(card=>card.labels.map(label=>label.language))),new Set(['ro','en']),'all preserves both original languages');
 assert.ok(measured.controls.length>=10,'reader and card controls were actually measured');
 for(const control of measured.controls){
  assert.ok(control.width>=43.5&&control.height>=43.5,'tap target must be at least 44px at '+width+'px: '+JSON.stringify(control));
  assert.ok(control.left>=-1&&control.right<=width+1,'tap target must fit viewport at '+width+'px: '+JSON.stringify(control));
 }
}

async function run(){
 if(typeof WebSocket!=='function')throw Error('DLKT_UI_NODE_WEBSOCKET_UNAVAILABLE');
 const bin=process.env.DLKT_CHROME_BIN??'/usr/bin/google-chrome';
 if(!existsSync(bin))throw Error('DLKT_UI_CHROME_NOT_INSTALLED');
 const profile=mkdtempSync(join(process.env.RUNNER_TEMP??tmpdir(),'dlkt-ui-qa-'));
 const outputDir=join(process.env.RUNNER_TEMP??profile,'dlkt-ui-screenshots');
 mkdirSync(outputDir,{recursive:true});
 const fixture=await newsFixture(),server=localServer(fixture);
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
  for(let i=0;i<240;i++){
   if(browser.exitCode!==null)throw Error('DLKT_UI_BROWSER_EXITED');
   const file=join(profile,'DevToolsActivePort');
   if(existsSync(file)){const value=Number(readFileSync(file,'utf8').split('\n')[0]);if(Number.isSafeInteger(value)&&value>0){port=value;break;}}
   await pause(100);
  }
  if(port===null)throw Error('DLKT_UI_BROWSER_PORT_TIMEOUT_AFTER_24S');
  ws=await connectChrome(port);
  const cdp=rpcClient(ws);
  await cdp('Page.enable');await cdp('Runtime.enable');
  const observations=[];
  for(const f of formats){
   await cdp('Emulation.setDeviceMetricsOverride',{width:f.width,height:f.height,deviceScaleFactor:1,mobile:f.mobile,scale:1});
   await cdp('Page.navigate',{url:'http://'+HOST+':'+binding.port+'/'});
   await loaded(cdp);await pause(400);
   await selectControlledEdition(cdp,fixture);
   await evaluate(cdp,'(()=>{window.scrollTo(0,0);return true;})()');
   const news=await evaluate(cdp,'('+readerProbe.toString()+')('+JSON.stringify({city:fixture.city,groupKey:fixture.groupKey,urls:fixture.urls,titles:fixture.titles})+')');
   writeFileSync(join(outputDir,'measured-'+f.width+'.json'),JSON.stringify(news,null,2)+'\n',{mode:0o600});
   try{assertReaderGeometry(news,f,fixture);}catch(error){
    const failedImage=(await cdp('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data;
    if(typeof failedImage==='string')writeFileSync(join(outputDir,'failed-'+f.width+'.png'),Buffer.from(failedImage,'base64'),{mode:0o600});
    throw error;
   }
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
   await evaluate(cdp,"(()=>{document.querySelector('#discovery-cards article[data-news-stream-key]')?.scrollIntoView({block:'start'});return true;})()");
   const cardImage=(await cdp('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data;
   assert.ok(typeof cardImage==='string'&&cardImage.length>=1000,'card screenshot is present');
   const cardScreenshot='dlkt-cards-'+f.label+'-'+f.width+'.png';writeFileSync(join(outputDir,cardScreenshot),Buffer.from(cardImage,'base64'),{mode:0o600});
   observations.push({viewport:f.width,documentWidth:m.scroll,menuTested:f.mobile,brandVisible:true,reducedMotion:true,screenshot,cardScreenshot,news});
  }
  const result={version:'dlkt-info-offline-browser-smoke-1',status:'OFFLINE_BROWSER_PASS',
   scope:'local-built-reader-with-controlled-news-corpus',viewports:observations,fixture:{storyCount:fixture.storyCount,articleTotal:fixture.articleTotal,groupOriginals:fixture.urls.length},
   limitations:['News pages use the actual service over controlled corpus fixtures; no external publisher request, authenticated user, payment or production runtime availability is tested.',
    'The three publisher headlines and URLs reproduce an observed case; source-check and publication dates are controlled fixtures.',
    'Programmatic layout metrics and screenshots do not replace manual visual review.']};
  writeFileSync(join(outputDir,'report.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log('DLKT_UI_BROWSER_QA '+JSON.stringify(result));
 }finally{
  try{ws?.close();}catch{}
  if(browser&&browser.exitCode===null){
   try{
    await Promise.race([
     new Promise(resolve=>{browser.once('exit',resolve);browser.kill('SIGTERM');}),
     pause(1500).then(()=>{if(browser.exitCode===null)browser.kill('SIGKILL');}),
    ]);
   }catch{/* Process termination must not hide the measured browser result. */}
  }
  await new Promise(resolve=>server.close(resolve));
  // Chrome writes asynchronous profile files after SIGTERM. Retry transient
  // ENOTEMPTY/EBUSY rather than turning a successful UI audit into a false fail.
  try{
   rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }catch(error){
   // Only this ephemeral, blank Chrome profile can remain; GitHub's disposable
   // runner removes it after the job. Never mask a different cleanup failure.
   if(!['ENOTEMPTY','EBUSY'].includes(error?.code))throw error;
   console.warn('DLKT_UI_EPHEMERAL_BROWSER_PROFILE_CLEANUP_DEFERRED');
  }
 }
}
await run();

