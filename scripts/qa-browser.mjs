import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {extname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {personalProfileFixture,verifyPersonalProfileFlow,verifyAccountPreferencesFlow} from './qa-personal-profile.mjs';
import {syntheticEmailFixture,verifyAuthenticationEmailPreview} from './qa-auth-email.mjs';
import {knowledgeDistributionFixture,verifyKnowledgeDistribution} from './qa-knowledge-distribution.mjs';
import {audienceChoiceFixture,verifyAudienceChoice} from './qa-audience-choice.mjs';

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
 {width:440,height:956,label:'mobile-440-dpr3',mobile:true,dpr:3},
 {width:768,height:1024,label:'tablet',mobile:false},
 {width:1440,height:900,label:'desktop',mobile:false},
];
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));

// Real raster bytes for loopback layout acceptance only, never publisher/source evidence.
function localPhotoRaster(){
 const chunk=(type,data)=>{const payload=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
  for(const byte of payload){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const length=Buffer.alloc(4),end=Buffer.alloc(4);length.writeUInt32BE(data.length);end.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([length,payload,end]);};
 const width=640,height=360,ihdr=Buffer.alloc(13),rows=Buffer.alloc((width*3+1)*height);
 ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=y*(width*3+1)+1+x*3;rows[at]=32+Math.floor(x/4);rows[at+1]=64+Math.floor(y/3);rows[at+2]=124;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const localPhotoPixels=localPhotoRaster();

function localServer(fixture,personal,knowledge,audience){
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
  let url;try{url=new URL(req.url??'', 'http://'+HOST);}catch{res.writeHead(400).end();return;}
  // Private mutations exist only during the explicitly activated loopback QA phase.
  if(personal.handle(req,res,url))return;
  if(knowledge.handle(req,res,url))return;
  if(audience.handle(req,res,url))return;
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  const email=syntheticEmailFixture(url);
  if(email){res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");res.setHeader('Content-Type','text/html; charset=utf-8');res.writeHead(email.status).end(req.method==='HEAD'?undefined:email.html);return;}
  if(url.pathname==='/api/article-photo'){
   const photo=fixture.photo(url);
   res.setHeader('Content-Type',photo?'image/png':'application/json; charset=utf-8');
   res.writeHead(photo?200:404).end(req.method==='HEAD'?undefined:photo??JSON.stringify({error:'CONTROLLED_PHOTO_UNAVAILABLE'}));return;
  }
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
async function connectChrome(port,targetId=null){
 let targets=null;
 for(let i=0;i<40;i++){
  try{
   const response=await fetch('http://'+HOST+':'+port+'/json/list',{signal:AbortSignal.timeout(1000)});
   if(response.ok){targets=await response.json();if(targetId===null||Array.isArray(targets)&&targets.some(target=>target.id===targetId&&typeof target.webSocketDebuggerUrl==='string'))break;}
  }catch{/* browser booting */}
  await pause(100);
 }
 const page=Array.isArray(targets)?targets.find(x=>x.type==='page'&&(targetId===null||x.id===targetId)&&typeof x.webSocketDebuggerUrl==='string'):null;
 if(!page)throw Error('DLKT_UI_CHROME_PAGE_MISSING');
 const ws=new WebSocket(page.webSocketDebuggerUrl);
 await Promise.race([
  new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('DLKT_UI_CHROME_WS_ERROR')),{once:true});}),
  new Promise((_,reject)=>setTimeout(()=>reject(Error('DLKT_UI_CHROME_WS_TIMEOUT')),5000)),
 ]);
 return ws;
}
/** Separate cookies and IndexedDB inside the same ephemeral Chromium process. */
async function openIsolatedChrome(port){
 const response=await fetch('http://'+HOST+':'+port+'/json/version',{signal:AbortSignal.timeout(2000)});
 if(!response.ok)throw Error('DLKT_UI_BROWSER_ENDPOINT_MISSING');
 const version=await response.json();
 if(typeof version.webSocketDebuggerUrl!=='string')throw Error('DLKT_UI_BROWSER_SOCKET_MISSING');
 const browserSocket=new WebSocket(version.webSocketDebuggerUrl);
 let timer;
 await Promise.race([
  new Promise((resolve,reject)=>{browserSocket.addEventListener('open',resolve,{once:true});browserSocket.addEventListener('error',()=>reject(Error('DLKT_UI_BROWSER_SOCKET_ERROR')),{once:true});}),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DLKT_UI_BROWSER_SOCKET_TIMEOUT')),5000);}),
 ]).finally(()=>clearTimeout(timer));
 const browserCall=rpcClient(browserSocket);
 let contextId=null,pageSocket=null;
 try{
  const context=await browserCall('Target.createBrowserContext',{disposeOnDetach:true});
  if(typeof context.browserContextId!=='string')throw Error('DLKT_UI_ISOLATED_CONTEXT_MISSING');
  contextId=context.browserContextId;
  const target=await browserCall('Target.createTarget',{url:'about:blank',browserContextId:contextId});
  if(typeof target.targetId!=='string')throw Error('DLKT_UI_ISOLATED_TARGET_MISSING');
  pageSocket=await connectChrome(port,target.targetId);
  const call=rpcClient(pageSocket);
  await call('Page.enable');await call('Runtime.enable');
  let closed=false;
  return {call,async close(){
   if(closed)return;closed=true;
   try{await browserCall('Target.disposeBrowserContext',{browserContextId:contextId});}
   finally{pageSocket?.close();browserSocket.close();}
  }};
 }catch(error){
  try{if(contextId!==null)await browserCall('Target.disposeBrowserContext',{browserContextId:contextId});}catch{/* Preserve the original browser error. */}
  pageSocket?.close();browserSocket.close();throw error;
 }
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
 const [{NewsPageService,parseNewsPageRequest,parseNewsSourcesRequest},{article,epoch,CorpusMemoryStore,snapshot,hash},{cardContent},{findCity},{SPECIALIST_ROWS},{pressReviewCitation},{currentLocalSnapshot},{selectHomeLocal},{localReading}]=await Promise.all([
  import('../source/.build/src/iceo/news-page.js'),import('../source/tests/fixtures/news-corpus.mjs'),
  import('../source/.build/src/iceo/card-validation.js'),import('../source/.build/src/local/cities.js'),
  import('../source/tests/fixtures/romanian-specialists.mjs'),import('../source/.build/src/iceo/source-links.js'),
  import('../source/.build/src/local/contracts.js'),import('../source/.build/src/iceo/home-local.js'),import('../source/.build/src/local/presentation.js'),
 ]);
 const {parseArticlePhotoReference}=await import('../source/.build/src/media/article-photo-reference.js');
 const now=Date.now(),city=findCity('683506');assert.ok(city,'controlled Bucharest city is registered');
 const cmtebUrl='https://www.cmteb.ro/functionare_sistem_termoficare.php';
 const weatherUrl='https://api.met.no/weatherapi/locationforecast/2.0/compact?lat='+city.lat.toFixed(4)+'&lon='+city.lon.toFixed(4);
 const localIds=['bucharest:cmteb:sector-1','weather:'+city.id];
 let localRequests=0;
 function localSnapshot(clock){
  const checkedAt=new Date(clock).toISOString(),hour=Math.floor(clock/3600000)*3600000;
  const forecast={id:localIds[1],kind:'forecast',title:'Controlled city-centre forecast',
   text:'Hourly forecast temperatures 2.0–6.0 °C. Total precipitation 0.8 mm over the six hourly periods. Highest hourly wind-speed forecast 12.6 km/h (not gusts).',
   publisher:'MET Norway',sourceUrl:weatherUrl,sourceUpdatedAt:new Date(clock-60000).toISOString(),checkedAt,
   validFrom:new Date(hour).toISOString(),validTo:new Date(hour+6*3600000).toISOString(),
   weatherSymbols:Array.from({length:6},(_,index)=>({at:new Date(hour+index*3600000).toISOString(),symbol:'cloudy'})),
   facts:['Controlled browser QA forecast, not a live MET Norway source check.'],
   boundary:'Controlled forecast fixture for the selected city centre; not observed conditions or an official warning.'};
  const utility={id:localIds[0],kind:'utility-notice',title:'Controlled CMTEB sector 1 notice',
   text:'Controlled operator notice for sector 1. Check the official operator document for affected streets and estimated times.',
   publisher:'Termoenergetica Bucuresti (CMTEB)',sourceUrl:cmtebUrl,sourceUpdatedAt:null,checkedAt,
   validFrom:checkedAt,validTo:new Date(clock+300000).toISOString(),
   facts:['Controlled browser QA operator notice, not a live service advisory.'],
   boundary:'Controlled operator fixture. It does not establish that a reader building is affected.',
   context:{section:'essential',place:city.name+' · sector 1',when:'Controlled operator check; exact streets and estimated times remain at the source.',
    why:'The checked fixture contains a service notice for the selected city.',action:'Check the official operator list for your street and building.',
    sourceDate:checkedAt.slice(0,10),startsAt:null,status:'operator-notice',
    documentHash:hash('DLKT controlled browser QA CMTEB fixture'),documentUrl:cmtebUrl}};
  const events=localIds.slice(2).map((id,index)=>({id,kind:'event',title:'Controlled ARCUB agenda event '+(index+1),
   text:'Original controlled agenda listing with source access.',publisher:'ARCUB',photoRevision:hash('DLKT controlled event photo revision '+id),
   sourceUrl:'https://arcub.ro/eveniment/controlled-agenda-'+(index+1),sourceUpdatedAt:null,checkedAt,
   validFrom:checkedAt,validTo:new Date(clock+300000).toISOString(),facts:['Controlled agenda fixture; not a live event verification.'],
   boundary:'Confirm the programme and availability with the organiser.',
   context:{section:'discover',place:'Bucharest venue '+(index+1),when:'Undated controlled agenda listing',
    why:'The publisher lists this event for the selected city.',action:'Check the original organiser listing.',
    sourceDate:checkedAt.slice(0,10),startsAt:null,status:'scheduled',
    documentHash:hash('DLKT controlled ARCUB agenda fixture'),documentUrl:'https://arcub.ro/agenda'}}));
  const value={version:'dlkt-local-1',city,checkedAt,state:'partial',weatherState:'ready',transportState:'not-covered',
   cards:[forecast,utility,...events],coverage:[{domain:'utilities',state:'partial',checkedAt,sourceUrl:cmtebUrl,
    note:'Controlled CMTEB browser fixture; not a complete or live city service check.'},
    ...(events.length?[{domain:'events',state:'partial',checkedAt,sourceUrl:'https://arcub.ro/agenda',note:'Controlled ARCUB agenda, not live event verification.'}]:[])]};
  assert.equal(currentLocalSnapshot(value,city,clock),true,'local browser fixture passes the actual source identity and freshness contract');
  assert.deepEqual(selectHomeLocal(value,city,clock).cards.map(card=>card.id),localIds,'the real homepage selector retains every expected local fixture record');
  return value;
 }
 let servedLocal=localSnapshot(now);
 const localExpected=()=>selectHomeLocal(servedLocal,city,Date.parse(servedLocal.checkedAt)).cards.map(card=>({
  id:card.id,publisher:card.publisher,sourceUrl:card.sourceUrl,reading:localReading(card,city,Date.parse(servedLocal.checkedAt),'ro'),
  documentHash:card.context?.documentHash??null,facts:card.facts,
 }));
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
 const specialists=SPECIALIST_ROWS.map((row,index)=>{
  const card={...article(1000+index,{now,language:'ro',published:now-20_000-index*1000}),
   title:row.title,publisher:row.publisher,sourceUrl:row.url,identity:row.url,id:hash(row.url).slice(0,24),
   articleSubject:{basis:'publisher-jsonld',sections:row.sections,keywords:[],articleUrl:row.url},
   boundary:'Controlled browser QA evidence; source-check and publication dates are fixtures.',
   attribution:'Controlled QA fixture from observed publisher headline and URL.'};
  card.contentHash=hash(cardContent(card));return card;
 });
 const sourceOnly=specialists.map(card=>{
  const citation=pressReviewCitation(card.sourceUrl);assert.ok(citation,'reviewed source citation is available');
  return {id:card.id,title:card.title,sourceUrl:card.sourceUrl,...citation};
 });
 const english=article(960,{now,language:'en',category:'13000000'}),cards=[...reports,distinct,english,...specialists];
 const stored=epoch(cards,[],{now}),before=JSON.stringify(stored),memory=new CorpusMemoryStore([stored]),
  service=new NewsPageService(memory,'test-only-browser-qa-cursor-key-123456789012345678901234567890');
 let activeCards=cards,activeNow=now,activeStoryCount=7,updateRevision=1,lastNewsEpoch=null;
 const updates={
  async publish(stage){
   assert.ok(Number.isInteger(stage)&&stage>=0&&stage<=3,'controlled update stage is explicit');
   const checked=Date.now(),stamp=new Date(checked).toISOString();
   const corrected=reports[0].title.replace('pedepsiți','condamnați');
   assert.notEqual(corrected,reports[0].title,'the controlled publisher wording actually changes');
   const current=reports.slice(0,stage===0?2:3).map((original,index)=>{
    const card={...original,observedAt:stamp,...(stage>=2&&index===0?{title:corrected}:{}),
     ...(stage===3?{date:new Date(checked-2000-(2-index)*1000).toISOString()}: {})};
    card.contentHash=hash(cardContent(card));return card;
   });
   activeCards=[...(stage===3?[...current].reverse():current),distinct,english,...specialists];activeNow=checked;activeStoryCount=7;
   const revision=++updateRevision,storedUpdate=epoch(activeCards,[],{now:checked,id:String(revision),revision});
   memory.epochs.set(storedUpdate.epoch,storedUpdate);memory.latest=storedUpdate.epoch;
   const selectedUpdate=await service.read({language:'ro',cityId:city.id,filter:'all',cursor:null,period:'recent',sourceScope:'all'});
   const group=selectedUpdate.items.find(item=>item.card.id===reports[0].id||item.story?.related.some(source=>source.card.id===reports[0].id));
   assert.ok(group?.story,'the actual page service groups the controlled original reports');
   assert.equal(group.story.sourceTotal,stage===0?2:3);assert.equal(selectedUpdate.total,7);
   assert.ok(selectedUpdate.items.some(item=>item.card.id===distinct.id),'the different explicit penalty remains a distinct event');
   return {epoch:storedUpdate.epoch,primaryId:group.card.id,primaryTitle:group.card.title,storyKey:group.story.key,
    originalUrls:reports.slice(0,2).map(card=>card.sourceUrl),negativeId:distinct.id,
    added:{id:reports[2].id,url:reports[2].sourceUrl,title:reports[2].title,checkedAt:stamp},
    corrected:{id:reports[0].id,url:reports[0].sourceUrl,title:corrected,checkedAt:stamp}};
  },
  reset(){memory.latest=stored.epoch;activeCards=cards;activeNow=now;activeStoryCount=7;lastNewsEpoch=null;},
  get lastNewsEpoch(){return lastNewsEpoch;}
 };
 const selected=await service.read({language:'ro',cityId:city.id,filter:'all',cursor:null,period:'recent',sourceScope:'all'});
 assert.equal(selected.articleTotal,9,'all nine originals are eligible before testing layout');
 assert.equal(selected.total,7,'three reports share one event; six distinct reports remain separate');
 const groups=selected.items.filter(item=>item.story?.sourceTotal===3);assert.equal(groups.length,1);
 const grouped=groups[0],groupOriginals=[{kind:grouped.kind,card:grouped.card},...grouped.story.related];
 assert.deepEqual(new Set(groupOriginals.map(item=>item.card.sourceUrl)),new Set(reports.map(card=>card.sourceUrl)));
 assert.equal(selected.items.some(item=>item.card.id===distinct.id),true,'the different penalty cannot be silently merged');
 assert.equal(selected.items.some(item=>item.card.id===english.id),true,'all-source scope must include the English original');
 assert.equal(JSON.stringify(stored),before,'the reader cannot restamp the stored evidence');
 const owned={
  async activate(){
   const checked=Date.now();
   const titles=[
    'Controlled fixture: Harbour observatory records a distant blue comet',
    'Controlled fixture: Cedar library opens its restored manuscript collection',
    'Controlled fixture: Amber town starts a riverbank wetland project',
    'Controlled fixture: Quartz laboratory demonstrates a superconducting sensor',
    'Controlled fixture: Willow school awards its robotics scholarship',
    'Controlled fixture: Copper museum presents prehistoric pottery fragments',
    'Controlled fixture: Juniper theatre announces an original chamber opera',
    'Controlled fixture: Maple hospital publishes its neonatal equipment report',
    'Controlled fixture: Silver tram operator restores the eastern route',
    'Controlled fixture: Oak cooperative develops a drought-tolerant grain',
    'Controlled fixture: Violet university maps a newly identified marine species',
    'Controlled fixture: Granite archive releases historic postal maps',
    'Controlled fixture: Birch council approves an accessible swimming pool',
    'Controlled fixture: Pearl festival publishes its documentary programme',
    'Controlled fixture: Falcon astronomers measure a remote stellar orbit',
    'Controlled fixture: Linden conservatory repairs its concert organ',
    'Controlled fixture: Moss institute catalogs freshwater insect habitats',
    'Controlled fixture: Coral engineers present an electric ferry prototype',
    'Controlled fixture: Hazel foundation translates a medieval poetry volume',
    'Controlled fixture: Slate researchers measure glacier sediment layers',
   ];
   activeCards=titles.map((title,index)=>{
    const original=article(2000+index,{now:checked,language:'en',published:checked-10_000-index*1000});
    const card={...original,title,boundary:'Synthetic distinct event for owned-card browser acceptance; not live reporting.'};
    card.contentHash=hash(cardContent(card));return card;
   });
   activeNow=checked;
   const revision=++updateRevision,ownedEpoch=epoch(activeCards,[],{now:checked,id:String(revision),revision});
   memory.epochs.set(ownedEpoch.epoch,ownedEpoch);memory.latest=ownedEpoch.epoch;
   const selectedOwned=await service.read({language:'ro',cityId:city.id,filter:'all',cursor:null,period:'recent',sourceScope:'all'});
   assert.equal(selectedOwned.articleTotal,20,'owned-card mode contains exactly20 controlled original articles');
   assert.equal(selectedOwned.total,20,'the real service keeps all20 synthetic events distinct');
   assert.equal(selectedOwned.items.length,20,'one real page provides20 stories and reaches the eleventh-news insertion');
   assert.equal(new Set(selectedOwned.items.map(item=>item.key)).size,20,'owned-card mode has20 distinct page identities');
   activeStoryCount=selectedOwned.total;
   return {epoch:ownedEpoch.epoch,storyCount:activeStoryCount};
  },
  reset(){updates.reset();},
 };
 return {city,estimatedCity:true,groupKey:grouped.story.key,urls:reports.map(card=>card.sourceUrl),titles:reports.map(card=>card.title),get storyCount(){return activeStoryCount;},articleTotal:selected.articleTotal,sourceOnly,
  localIds,updates,owned,get localExpected(){return localExpected();},get localRequests(){return localRequests;},
  setLocalExpansion(enabled){
   assert.equal(typeof enabled,'boolean');
   localIds.splice(2,localIds.length-2,...(enabled?Array.from({length:8},(_,index)=>'bucharest:arcub:'+hash('https://arcub.ro/eveniment/controlled-agenda-'+(index+1)).slice(0,24)):[]));
   servedLocal=localSnapshot(Date.now());
  },
  photo(url){
   const reference=parseArticlePhotoReference(url.pathname+url.search),card=servedLocal.cards.find(value=>value.id===reference?.id);
   return reference&&reference.cityId===city.id&&card?.id===localIds[2]&&card.kind==='event'
    &&card.photoRevision===reference.revision&&card.photoRevision!==card.context?.documentHash?localPhotoPixels:null;
  },
  async response(url){
   if(url.pathname==='/api/places'&&url.searchParams.get('hint')==='1')return {status:200,value:{city,countryCode:city.countryCode,estimated:true}};
   if(url.pathname==='/api/places'&&url.searchParams.get('id')===city.id)return {status:200,value:{cities:[city],cityAliases:[]}};
   if(url.pathname==='/api/local'){
    if(url.searchParams.get('city')!==city.id)return {status:400,value:{error:'DLKT_QA_LOCAL_CITY_INVALID'}};
    servedLocal=localSnapshot(Date.now());localRequests++;return {status:200,value:servedLocal};
   }
   if(url.pathname==='/api/iceo')return {status:200,value:snapshot(activeCards,activeNow)};
   if(url.pathname==='/api/news-page'){
    const cursor=parseNewsSourcesRequest(url);
    const value=cursor===null?await service.read(parseNewsPageRequest(url)):await service.readSources(cursor);
    if(cursor===null)lastNewsEpoch=value.epoch;
    return {status:200,value};
   }
   return {status:503,value:{error:'DLKT_OFFLINE_UI_QA_ONLY'}};
  }};
}


async function selectControlledEdition(call,fixture){
 for(let attempt=0;attempt<60;attempt++){
  if(await evaluate(call,"Boolean(document.querySelector('#reader-language option[value=\"ro\"]')&&document.querySelector('#home-news-source-scope'))"))break;
  if(attempt===59)throw Error('DLKT_UI_READER_CONTROLS_TIMEOUT');await pause(100);
 }
 await evaluate(call,'(()=>{const picker=document.querySelector("#reader-language");picker.value="ro";picker.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
 for(let attempt=0;attempt<80;attempt++){
  const current=await evaluate(call,'(()=>{const root=document.querySelector("#discovery-cards");return {scope:root?.dataset.sourceScope,count:root?.querySelectorAll("article[data-news-stream-key]:not([data-knowledge-id])").length,city:document.querySelector("#glance-city-label")?.textContent,localIds:[...document.querySelectorAll("#home-local-cards article[data-local-id]")].map(card=>card.dataset.localId)};})()');
  if(current.scope==='all'&&current.count===fixture.storyCount&&current.city===fixture.city.name&&JSON.stringify(current.localIds)===JSON.stringify(fixture.localIds))return;
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
 const titleReport=node=>{
  const style=node?getComputedStyle(node):null;
  return {text:node?.textContent??'',visible:visible(node),fits:Boolean(node&&textFits(node,node)),lineClamp:style?.webkitLineClamp??'',
   overflow:style?.textOverflow??'',...(node?rect(node):{})};
 };
 const calendar=document.querySelector('#glance-date'),city=document.querySelector('#glance-city-label'),country=document.querySelector('#glance-zone'),cityButton=document.querySelector('#glance-city');
 const normalized=value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
 const expectedCountry=new Intl.DisplayNames(['ro'],{type:'region'}).of(expected.city.countryCode)+(expected.estimatedCity?' · aproximativ':'');
 const cards=[...document.querySelectorAll('#discovery-cards article[data-news-stream-key]')],groups=cards.filter(node=>node.dataset.storyKey===expected.groupKey),group=groups[0];
 const originals=group?[...group.querySelectorAll('.news-story-source-link')]:[];
 const sourceOnly=expected.sourceOnly.map(expectedCard=>{
  const card=cards.find(node=>node.dataset.cardId===expectedCard.id),citation=card?.querySelector('.publisher-citation'),title=card?.querySelector('h3'),original=card?.querySelector('.source-link');
  return {id:expectedCard.id,found:Boolean(card),citationVisible:visible(citation),title:title?.textContent??'',
   citationLabel:citation?.textContent??'',citationUrl:citation?.href??'',originalLabel:original?.textContent?.trim()??'',originalUrl:original?.href??'',
   citationBeforeTitle:Boolean(citation&&title&&(citation.compareDocumentPosition(title)&Node.DOCUMENT_POSITION_FOLLOWING)),
   citationAboveTitle:Boolean(citation&&title&&rect(citation).bottom<=rect(title).top+1),
   photographCount:card?.querySelectorAll('figure.card-photo,img[data-article-photo],img[data-reviewed-photo],img[src*="/api/article-photo"]').length??0};
 });
 const languageLabels=cards.map(card=>({id:card.dataset.cardId,labels:[...card.querySelectorAll('[data-original-language]')].filter(visible).map(node=>({language:node.dataset.originalLanguage,text:node.textContent}))}));
 const localCards=[...document.querySelectorAll('#home-local-cards article[data-local-id]')];
 const local=expected.localExpected.map(expectedCard=>{
  const card=localCards.find(node=>node.dataset.localId===expectedCard.id),reading=card?.querySelector('details.local-reading');
  const source=card?[...card.querySelectorAll('a.source-link')].find(node=>node.href===expectedCard.sourceUrl&&!node.closest('details')):null;
  const credit=card?[...card.querySelectorAll('.card-boundary')].find(node=>node.textContent===expectedCard.publisher&&!node.closest('details')):null;
  return {id:expectedCard.id,found:Boolean(card),title:titleReport(card?.querySelector('h3')),
   readingExists:Boolean(reading),readingOpen:reading?.open??null,summaryVisible:visible(reading?.querySelector('summary')),
   sourceVisible:visible(source),sourceLabel:source?.textContent?.trim()??'',sourceUrl:source?.href??'',sourceTarget:source?.target??'',sourceRel:source?.rel??'',
   creditVisible:visible(credit),creditText:credit?.textContent??'',...(card?rect(card):{})};
 });
 const useful=[...localCards,...cards].filter(visible);
 const controls=[...document.querySelectorAll('#glance-city,#glance-read,#reader-language,#reader-theme-toggle,#home-news-source-scope,#home-news-english,#home-news-period,#home-news-category,#discovery-cards .card-actions > button,#discovery-cards .card-actions > a,#discovery-cards .evidence > summary,#discovery-cards .news-story-sources > summary,#header-menu,#header-navigation button,#header-navigation a,#discovery-refresh,#home-city,#glance-weather-quick,#glance-forex-quick,#home-news-options-toggle,#discovery-details > summary,#home-local-cards .source-link,#home-local-cards .local-reading > summary,#home-local-cards .evidence > summary')].filter(visible);
 return {scope:document.querySelector('#discovery-cards')?.dataset.sourceScope,documentWidth:document.documentElement.scrollWidth,
  date:calendar?.textContent??'',dateValue:calendar?.dateTime??'',dateAfter:calendar?getComputedStyle(calendar,'::after').content:null,dateVisible:visible(calendar),
  city:city?.textContent??'',country:country?.textContent??'',expectedCountry,
  cityComplete:city?.textContent===expected.city.name&&textFits(city,cityButton),
  countryComplete:normalized(country?.textContent??'')===normalized(expectedCountry??'')&&textFits(country,cityButton),
  cityButton:cityButton?rect(cityButton):null,storyCount:cards.length,groupCount:groups.length,
  groupUrls:originals.map(node=>node.href),groupTitles:originals.map(node=>node.textContent),languageLabels,sourceOnly,
  titles:cards.map(card=>({id:card.dataset.cardId,...titleReport(card.querySelector('h3'))})),local,localIds:localCards.map(card=>card.dataset.localId),
  firstUsefulTop:useful.length?Math.min(...useful.map(node=>rect(node).top)):null,
  firstEditorialTop:cards.length?rect(cards[0]).top:null,
  layout:{header:rect(document.querySelector('.site-header')),glance:rect(document.querySelector('#today-glance')),
   toolbar:rect(document.querySelector('#home-news-toolbar')),sourceLanguage:rect(document.querySelector('#home-news-language')),toolbarRowGap:parseFloat(getComputedStyle(document.querySelector('#home-news-toolbar')).rowGap),filtersOpen:document.querySelector('#home-news-options')?.open??null,
   categoryVisible:visible(document.querySelector('#home-news-category')),filtersToggleVisible:visible(document.querySelector('#home-news-options-toggle'))},
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
 assert.equal(measured.sourceOnly.length,fixture.sourceOnly.length,'all reviewed-source cards are measured');
 for(const expected of fixture.sourceOnly){
  const card=measured.sourceOnly.find(value=>value.id===expected.id);assert.ok(card);
  assert.equal(card.found,true,'reviewed-source card is present at '+width+'px');
  assert.equal(card.title,expected.title,'original title stays unchanged');
  assert.equal(card.citationVisible,true,'source citation stays visible at '+width+'px');
  assert.equal(card.citationLabel,expected.label);assert.equal(card.citationUrl,expected.homeUrl);
  assert.equal(card.originalLabel,'Deschide sursa','primary source action has the consistent Romanian label');assert.equal(card.originalUrl,expected.sourceUrl);
  assert.equal(card.citationBeforeTitle,true,'source citation precedes title in the actual DOM at '+width+'px');
  assert.equal(card.citationAboveTitle,true,'source citation appears above title at '+width+'px');
  assert.equal(card.photographCount,0,'title/date/link-only source creates no photograph request at '+width+'px');
 }
 assert.ok(measured.controls.length>=10,'reader and card controls were actually measured');
 for(const control of measured.controls){
  assert.ok(control.width>=43.5&&control.height>=43.5,'tap target must be at least 44px at '+width+'px: '+JSON.stringify(control));
  assert.ok(control.left>=-1&&control.right<=width+1,'tap target must fit viewport at '+width+'px: '+JSON.stringify(control));
 }
}

function assertFullTitle(title,label){
 assert.equal(title.visible,true,label+' is visible');
 assert.ok(title.text.trim().length>0,label+' has text');
 assert.equal(title.fits,true,label+' keeps its complete painted text: '+JSON.stringify(title));
 assert.ok(['','none','0','normal'].includes(title.lineClamp),label+' must not be line-clamped');
 assert.notEqual(title.overflow,'ellipsis',label+' must not use ellipsis');
}
function addedLanguageRowHeight(measured){
 const height=measured.layout.sourceLanguage.height+measured.layout.toolbarRowGap;
 assert.ok(Number.isFinite(height)&&height>0,'visible language row has positive measured geometry');
 return height;
}
function assertReadingLayout(measured,format,fixture,{compact=true}={}){
 assertReadingDetails(measured,format);assertActionSpacing(measured.actionSpacing,format);
 for(const title of measured.titles)assertFullTitle(title,'editorial title '+title.id+' at '+format.width+'px');
 assert.deepEqual(measured.localIds,fixture.localIds,'all expected local fixture cards are present in homepage order');
 for(const expected of fixture.localExpected){
  const card=measured.local.find(value=>value.id===expected.id);assert.ok(card);
  assert.equal(card.found,true,'local fixture card is rendered');assertFullTitle(card.title,'local title '+card.id);
  assert.equal(card.title.text,expected.reading.title,'the production local reading title is retained');
  assert.equal(card.readingExists,true,'local information has an accessible disclosure');
  assert.equal(card.summaryVisible,true,'local reading action stays visible');
  assert.equal(card.sourceVisible,true,'official source action stays outside collapsed details');
  assert.equal(card.sourceLabel,'Deschide sursa','local source action uses the same label as global cards');
  assert.equal(card.sourceUrl,expected.sourceUrl);assert.equal(card.sourceTarget,'_blank');
  assert.ok(card.sourceRel.split(/\s+/u).includes('noopener')&&card.sourceRel.split(/\s+/u).includes('noreferrer'));
  assert.equal(card.creditVisible,true,'local publisher credit stays visible outside details');
  assert.equal(card.creditText,expected.publisher);
  if(compact)assert.equal(card.readingOpen,false,'utility starts compact without removing its information');
 }
 assert.equal(measured.layout.categoryVisible,true,'primary category stays immediately available');
 assert.equal(measured.layout.filtersToggleVisible,true,'secondary filters have a visible action');
 if(compact){
  assert.equal(measured.layout.filtersOpen,false,'initial geometry measures the closed filters');
  assert.ok(measured.firstUsefulTop!==null,'a useful card is measured');
  // Keep the previous content budget while accounting exactly for the newly visible language row.
  // Raw positions and the measured row height/gap remain in the report; no fixed offset is guessed.
  const languageRow=addedLanguageRowHeight(measured);
  const previousUsefulTop=measured.firstUsefulTop-languageRow;
  if(format.width===320)assert.ok(measured.firstUsefulTop<=650,'mobile first useful card must start within 650px at 320px: '+measured.firstUsefulTop);
  if(format.width===390)assert.ok(measured.firstUsefulTop<=610,'mobile first useful card must start within 610px at 390px: '+measured.firstUsefulTop);
  if(format.width===320)assert.ok(previousUsefulTop<=620,'existing content before the added language row stays within 620px at 320px: '+previousUsefulTop);
  if(format.width===390){
   assert.ok(previousUsefulTop<=550,'existing content before the added language row stays within 550px at 390px: '+previousUsefulTop);
   assert.ok(measured.firstEditorialTop!==null&&measured.firstEditorialTop-languageRow<=1100,'existing editorial position excluding the added language row stays within 1100px: '+(measured.firstEditorialTop-languageRow));
  }
  assert.ok(measured.local.every(card=>card.bottom<=measured.firstEditorialTop+1),'the two local utilities precede the editorial feed');
 }
}
function expectedReader(fixture){
 return {city:fixture.city,estimatedCity:fixture.estimatedCity,groupKey:fixture.groupKey,urls:fixture.urls,titles:fixture.titles,sourceOnly:fixture.sourceOnly,localExpected:fixture.localExpected};
}
async function measureReader(call,fixture){
 const measured=await evaluate(call,'('+readerProbe.toString()+')('+JSON.stringify(expectedReader(fixture))+')');
 measured.details=await evaluate(call,'('+readingDetailProbe.toString()+')()');
 measured.actionSpacing=await evaluate(call,'('+actionSpacingProbe.toString()+')()');return measured;
}


function localPhotosProbe(ids){
 const first=document.querySelector('#home-local-cards article[data-local-id="'+ids[0]+'"]'),failed=document.querySelector('#home-local-cards article[data-local-id="'+ids[1]+'"]');
 const image=first?.querySelector('img[data-article-photo]'),figure=image?.closest('figure'),caption=figure?.querySelector('figcaption');
 const bounds=figure?.getBoundingClientRect(),card=first?.getBoundingClientRect();
 return {loaded:Boolean(image?.complete&&image.naturalWidth>0),width:image?.naturalWidth??0,request:image?.getAttribute('src')??null,
  remainingImages:document.querySelectorAll('#home-local-cards img[data-article-photo]').length,
  creditVisible:Boolean(caption&&!caption.hidden&&caption.getBoundingClientRect().height>0),
  sourceIntact:first?.querySelector('.local-utility-actions>.source-link')?.getAttribute('href')==='https://arcub.ro/eveniment/controlled-agenda-1',
  failedTitleIntact:failed?.querySelector('h3')?.textContent==='Controlled ARCUB agenda event 2',
  failedRemoved:Boolean(failed&&!failed.querySelector('figure.card-photo')),
  figureFits:Boolean(bounds&&card&&bounds.left>=card.left&&bounds.right<=card.right&&bounds.left>=0&&bounds.right<=innerWidth)};
}

/** Additional source-valid records must be visible without opening a group. */
async function verifyInlineLocalFlow(call,origin,fixture,outputDir){
 const observations=[];
 fixture.updates.reset();fixture.setLocalExpansion(true);
 try{
  for(const format of [{width:320,height:750,mobile:true},{width:390,height:844,mobile:true},{width:1440,height:900,mobile:false}]){
   await call('Emulation.setDeviceMetricsOverride',{width:format.width,height:format.height,deviceScaleFactor:1,mobile:format.mobile,scale:1});
   await call('Page.navigate',{url:origin+'/'});await loaded(call);await selectControlledEdition(call,fixture);
   await evaluate(call,'(()=>{window.scrollTo(0,0);return true;})()');
   // Exercise real lazy image loading for every local event, including controlled 404s.
   for(const id of fixture.localIds.slice(2)){
    await evaluate(call,'(()=>{document.querySelector('+JSON.stringify('#home-local-cards article[data-local-id="'+id+'"]')+').scrollIntoView({block:"center",behavior:"instant"});return true;})()');await pause(70);
   }
   let photoState;
   for(let attempt=0;attempt<40;attempt++){
    photoState=await evaluate(call,'('+localPhotosProbe.toString()+')('+JSON.stringify(fixture.localIds.slice(2,4))+')');
    if(photoState?.loaded&&photoState.remainingImages===1&&photoState.failedRemoved)break;
    if(attempt===39)throw Error('DLKT_LOCAL_PHOTO_FIXTURE_TIMEOUT');await pause(50);
   }
   assert.equal(photoState.loaded,true);assert.equal(photoState.width,640);
   assert.equal(photoState.creditVisible,true);assert.equal(photoState.sourceIntact,true);assert.equal(photoState.failedTitleIntact,true);
   assert.equal(photoState.failedRemoved,true);assert.equal(photoState.figureFits,true);
   const actual=await evaluate(call,'fetch('+JSON.stringify('/api/article-photo?id='+encodeURIComponent(fixture.localIds[2])+'&v='+'0'.repeat(64)+'&city='+fixture.city.id)+').then(response=>response.status)');
   assert.equal(actual,404,'wrong fixture revision has no photograph');
   await evaluate(call,'(()=>{window.scrollTo(0,0);return true;})()');
   const measured=await measureReader(call,fixture);
   assertReaderGeometry(measured,format,fixture);assertReadingLayout(measured,format,fixture,{compact:false});
   assert.equal(measured.localIds.length,10,'two utilities and eight agenda records exercise the former fold');
   assert.ok(measured.local.every(card=>card.readingOpen===false),'only individual evidence starts closed');
   const structure=await evaluate(call,`(()=>{
    const cards=[...document.querySelectorAll('#home-local-cards article[data-local-id]')],editorial=document.querySelector('#discovery-cards article[data-news-stream-key]');
    const visible=node=>{
     for(let p=node;p&&p!==document.body;p=p.parentElement){
      const style=getComputedStyle(p);
      if(style.display==='none'||style.visibility==='hidden'||p.tagName==='DETAILS'&&!p.open)return false;
     }
     return node.getClientRects().length>0&&node.getBoundingClientRect().height>0;
    };
    const bounds=cards.map(node=>{const r=node.getBoundingClientRect();return {id:node.dataset.localId,top:r.top,bottom:r.bottom,left:r.left,right:r.right};});
    return {allIds:cards.map(n=>n.dataset.localId),visibleIds:cards.filter(visible).map(n=>n.dataset.localId),
     folded:document.querySelectorAll('#home-local-more,.home-local-more').length,
     allBeforeNews:cards.every(n=>Boolean(editorial&&(n.compareDocumentPosition(editorial)&Node.DOCUMENT_POSITION_FOLLOWING))),
     editorialGap:editorial.getBoundingClientRect().top-Math.max(...bounds.map(b=>b.bottom)),bounds};
   })()`);
   assert.deepEqual(structure.allIds,fixture.localIds);assert.deepEqual(structure.visibleIds,fixture.localIds);
   assert.equal(new Set(structure.allIds).size,10);assert.equal(structure.folded,0);assert.equal(structure.allBeforeNews,true);
   assert.ok(structure.editorialGap>=0&&structure.editorialGap<=100,'editorial follows the final local row without a blank artificial section: '+JSON.stringify(structure));
   assert.ok(measured.firstUsefulTop!==null);
   const previousUsefulTop=measured.firstUsefulTop-addedLanguageRowHeight(measured);
   if(format.width===320)assert.ok(previousUsefulTop<=620,'continuous local feed retains the existing content budget at 320px');
   if(format.width===390)assert.ok(previousUsefulTop<=550,'continuous local feed retains the existing content budget at 390px');
   for(const a of structure.bounds)for(const b of structure.bounds)if(a.id!==b.id){
    const overlaps=Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
    assert.equal(overlaps,false,'inline local cards do not overlap');
   }
   const screenshot='dlkt-continuous-local-'+format.width+'.png';
   const captured=(await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data;
   assert.ok(typeof captured==='string'&&captured.length>=1000);
   writeFileSync(join(outputDir,screenshot),Buffer.from(captured,'base64'),{mode:0o600});
   if(format.width===390){
    const selector='#home-local-cards article[data-local-id="'+fixture.localIds.at(-1)+'"] .local-reading>summary';
    await focusSelector(call,selector);await keyboard(call,'Enter');
    const expanded=await measureReader(call,fixture);assertReaderGeometry(expanded,format,fixture);assertReadingLayout(expanded,format,fixture,{compact:false});
    assert.equal(expanded.local.find(card=>card.id===fixture.localIds.at(-1))?.readingOpen,true,'last formerly hidden event has keyboard-accessible evidence');
   }
   const photoScreenshot='dlkt-local-source-photo-'+format.width+'.png';
   await evaluate(call,'(()=>{document.querySelector('+JSON.stringify('#home-local-cards article[data-local-id="'+fixture.localIds[2]+'"]')+').scrollIntoView({block:"start",behavior:"instant"});return true;})()');
   writeFileSync(join(outputDir,photoScreenshot),Buffer.from((await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64'),{mode:0o600});
   observations.push({viewport:format.width,localCards:structure.allIds.length,structure,actionSpacing:measured.actionSpacing,photos:photoState,screenshot,photoScreenshot});
  }
 }finally{fixture.setLocalExpansion(false);fixture.updates.reset();}
 return {status:'CONTINUOUS_LOCAL_PASS',observations};
}

/** Measure rendered text-line boxes, not rasterized glyph outlines. */
function actionSpacingProbe(){
 const visible=node=>{
  if(!node||node.getClientRects().length===0||getComputedStyle(node).display==='none'||getComputedStyle(node).visibility==='hidden')return false;
  for(let p=node;p&&p!==document.body;p=p.parentElement){
   const s=getComputedStyle(p),r=p.getBoundingClientRect();
   if(s.visibility==='hidden'||s.display==='none')return false;
   if(s.position==='absolute'&&r.width<=1&&r.height<=1&&(s.overflow==='hidden'||s.clipPath!=='none'))return false;
   if(p.parentElement?.tagName==='DETAILS'&&!p.parentElement.open){
    const summary=[...p.parentElement.children].find(child=>child.tagName==='SUMMARY');
    if(!summary?.contains(node))return false;
   }
  }
  return true;
 };
 const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
 const selector='button,a.primary,a.secondary,a.focus-button,a.text-button,a.source-link,a.footer-link,.more-menu a,summary';
 const nodes=[...document.querySelectorAll(selector)].filter(visible),violations=[],samples=[];
 let textControls=0,iconControls=0,minInlineInset=null,minBlockInset=null;
 for(const node of nodes){
  const r=box(node),s=getComputedStyle(node),id=node.id||node.className||node.tagName.toLowerCase();
  const tree=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),rects=[];let child;
  while((child=tree.nextNode())){
   const parent=child.parentElement,raw=child.textContent??'';
   if(!raw.trim()||!parent||parent.closest('svg')||!visible(parent))continue;
   const range=document.createRange(),start=raw.search(/\S/u),end=raw.search(/\s*$/u);
   range.setStart(child,start);range.setEnd(child,end);
   for(const line of range.getClientRects())if(line.width>0&&line.height>0)rects.push(line);
  }
  const iconOnly=node.matches('.icon-button,.reader-more>summary,.entry-field>button')
   ||rects.length===0;
  if(iconOnly){iconControls++;continue;}
  textControls++;
  const ink={left:Math.min(...rects.map(v=>v.left)),right:Math.max(...rects.map(v=>v.right)),top:Math.min(...rects.map(v=>v.top)),bottom:Math.max(...rects.map(v=>v.bottom))};
  const inline=Math.min(ink.left-r.left,r.right-ink.right),block=Math.min(ink.top-r.top,r.bottom-ink.bottom);
  minInlineInset=Math.min(minInlineInset??Infinity,inline);minBlockInset=Math.min(minBlockInset??Infinity,block);
  const reasons=[];
  if(r.width<43.5||r.height<43.5)reasons.push('target-smaller-than-44px');
  if(r.left< -1||r.right>innerWidth+1)reasons.push('outside-viewport');
  if(inline<7||block<3)reasons.push('text-line-too-close-to-edge');
  if(!['','none','0','normal'].includes(s.webkitLineClamp)||s.textOverflow==='ellipsis')reasons.push('truncated-label');
  for(let p=node;p&&p!==document.body;p=p.parentElement){
   const style=getComputedStyle(p),bound=box(p);
   if(['hidden','clip'].includes(style.overflowX)&&(ink.left<bound.left-1||ink.right>bound.right+1))reasons.push('ancestor-clips-label-inline');
   if(['hidden','clip'].includes(style.overflowY)&&(ink.top<bound.top-1||ink.bottom>bound.bottom+1))reasons.push('ancestor-clips-label-block');
  }
  const row={id,text:node.textContent?.trim().slice(0,100),...r,inlineInset:inline,blockInset:block,
   paddingInlineStart:parseFloat(s.paddingInlineStart),paddingInlineEnd:parseFloat(s.paddingInlineEnd),background:s.backgroundColor,color:s.color};
  if(reasons.length)violations.push({...row,reasons:[...new Set(reasons)]});
  if(['home-city','glance-city','discovery-refresh','world-back'].includes(node.id))samples.push(row);
 }
 const local=[...document.querySelectorAll('#home-local-cards article.local-utility')].filter(visible).map(card=>{
  const topic=card.querySelector('header .card-topic'),source=card.querySelector('.local-utility-actions>.source-link'),actions=card.querySelector('.local-utility-actions'),reading=card.querySelector('.local-reading');
  if(!topic||!source||!actions)return {id:card.dataset.localId,missing:true};
  const r=box(card),t=box(topic),a=box(source),footer=box(actions),style=getComputedStyle(card),f=getComputedStyle(actions);
  const summary=reading?.querySelector('summary'),lastBottom=Math.max(a.bottom,summary&&visible(summary)?box(summary).bottom:a.bottom);
  return {id:card.dataset.localId,open:Boolean(reading?.open),topInset:t.top-r.top,sourceBottomInset:r.bottom-a.bottom,
   rowBottomInset:r.bottom-lastBottom,footerPadding:parseFloat(f.paddingBottom),borderBottom:parseFloat(style.borderBottomWidth),
   footerBottom:footer.bottom,cardBottom:r.bottom,sourceHeight:a.height,summaryHeight:summary?box(summary).height:null};
 });
 return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,locale:document.documentElement.lang,direction:document.documentElement.dir,
  inspectedControls:nodes.length,textControls,iconControls,minInlineInset,minBlockInset,violations,samples,local};
}
function assertActionSpacing(measured,format){
 assert.ok(measured.textControls>=3,'actual text actions are measured');
 assert.ok(measured.documentWidth<=format.width+2,'action spacing does not cause horizontal document overflow');
 assert.deepEqual(measured.violations,[],'all measured action text boxes retain their internal space');
 for(const item of measured.samples)assert.ok(item.paddingInlineStart>=12&&item.paddingInlineEnd>=12,'named text action keeps at least12px inline padding: '+JSON.stringify(item));
 for(const card of measured.local){
  assert.notEqual(card.missing,true,'local action geometry is present');
  if(!card.open){
   assert.ok(Math.abs(card.topInset-card.rowBottomInset)<=1,'closed local action row matches top category inset: '+JSON.stringify(card));
   assert.ok(Math.abs(card.topInset-card.sourceBottomInset)<=1,'the actual official-source button shares the balanced bottom inset: '+JSON.stringify(card));
  }
  assert.ok(card.footerPadding>=14,'expanded and compact local cards retain a comfortable bottom inset');
 }
}


async function verifyVisibleSourceLanguage(call,format){
 await toggleDetails(call,'#home-news-options',false);
 const state=await evaluate(call,'(()=>{const root=document.getElementById("home-news-language"),button=document.getElementById("home-news-source-scope"),details=document.getElementById("home-news-options");if(!root||!button||!details)throw Error("SOURCE_LANGUAGE_CONTROL_MISSING");const r=root.getBoundingClientRect(),b=button.getBoundingClientRect(),s=getComputedStyle(button);return {visible:root.getClientRects().length>0&&s.visibility!=="hidden",insideDetails:root.closest("details")!==null,periodOpen:details.open,parent:root.parentElement.id,left:r.left,right:r.right,buttonHeight:b.height,paddingStart:parseFloat(s.paddingInlineStart),paddingEnd:parseFloat(s.paddingInlineEnd),text:button.textContent,scope:button.dataset.sourceScope,documentWidth:document.documentElement.scrollWidth};})()');
 assert.equal(state.visible,true);assert.equal(state.insideDetails,false);assert.equal(state.periodOpen,false);assert.equal(state.parent,'home-news-toolbar');
 assert.ok(state.left>=-1&&state.right<=format.width+1&&state.documentWidth<=format.width+2);
 assert.ok(state.buttonHeight>=43.5&&state.paddingStart>=12&&state.paddingEnd>=12);
 assert.ok(state.text.trim());assert.ok(['all','edition'].includes(state.scope));
 return state;
}

async function verifyTitleLinkPresentation(call){
 const selector='#discovery-cards .card-title-link';
 await evaluate(call,'(()=>{const a=document.querySelector('+JSON.stringify(selector)+');if(!a)throw Error("TITLE_LINK_MISSING");a.scrollIntoView({block:"center",behavior:"instant"});document.activeElement?.blur();return true;})()');
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
 const read=()=>evaluate(call,'(()=>{const a=document.querySelector('+JSON.stringify(selector)+'),card=a.closest("article"),button=card.querySelector(".source-link");const r=a.getBoundingClientRect(),s=getComputedStyle(a);return {href:a.href,button:button?.href,decoration:s.textDecorationLine,outlineStyle:s.outlineStyle,outlineWidth:parseFloat(s.outlineWidth),hover:a.matches(":hover"),focus:a.matches(":focus-visible"),x:r.left+Math.min(r.width/2,20),y:r.top+Math.min(r.height/2,10)};})()');
 const before=await read();assert.equal(before.decoration,'none');assert.ok(before.href);assert.equal(before.href,before.button);
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:before.x,y:before.y});
 const hover=await read();assert.equal(hover.hover,true);assert.ok(hover.decoration.includes('underline'));
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
 await keyboard(call,'Tab');await focusSelector(call,selector);
 const focus=await read();assert.equal(focus.focus,true);assert.ok(focus.outlineWidth>=2&&focus.outlineStyle!=='none');assert.equal(focus.href,before.href);
 return {restingUnderline:false,hoverIndication:true,keyboardOutline:true,sameSourceDestination:true};
}

async function verifyActionStates(call,format){
 const pointerMedia=await evaluate(call,"({hover:matchMedia('(hover: hover)').matches,fine:matchMedia('(pointer: fine)').matches})");
 assert.deepEqual(pointerMedia,{hover:true,fine:true},'desktop hover scenario has a real mouse-capable media environment');
 const observations=[];
 for(const selector of ['#home-city','#glance-city']){
  await evaluate(call,'(()=>{document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center",behavior:"instant"});document.activeElement?.blur();return true;})()');
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  const resting=await evaluate(call,'('+actionSpacingProbe.toString()+')()');assertActionSpacing(resting,format);
  const before=resting.samples.find(row=>row.id===selector.slice(1));assert.ok(before);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:before.left+before.width/2,y:before.top+before.height/2});
  const hovering=await evaluate(call,'('+actionSpacingProbe.toString()+')()');assertActionSpacing(hovering,format);
  assert.equal(await evaluate(call,'document.querySelector('+JSON.stringify(selector)+').matches(":hover")'),true,'real pointer hover is exercised');
  const hovered=hovering.samples.find(row=>row.id===before.id);assert.ok(hovered);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});await keyboard(call,'Tab');await focusSelector(call,selector);
  const focused=await evaluate(call,'('+actionSpacingProbe.toString()+')()');assertActionSpacing(focused,format);
  assert.equal(await evaluate(call,'document.querySelector('+JSON.stringify(selector)+').matches(":focus-visible")'),true,'keyboard focus state is exercised');
  const focus=focused.samples.find(row=>row.id===before.id);assert.ok(focus);
  for(const after of [hovered,focus])for(const key of ['width','height','paddingInlineStart','paddingInlineEnd'])assert.ok(Math.abs(after[key]-before[key])<=.1,'hover/focus preserves action geometry');
  assert.notEqual(hovered.background,before.background,'hover paints the actual button surface');
  observations.push({id:before.id,resting:before,hovered,focused:focus});
 }
 await evaluate(call,'(()=>{document.activeElement?.blur();window.scrollTo(0,0);return true;})()');
 return {status:'ACTION_STATES_PASS',pointerMedia,observations};
}
async function verifyActionLocales(call,format){
 const original=await evaluate(call,"document.querySelector('#reader-language').value"),observations=[];
 async function choose(locale){
  await evaluate(call,'(()=>{const picker=document.querySelector("#reader-language");picker.value='+JSON.stringify(locale)+';picker.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
  for(let i=0;i<40;i++){if(await evaluate(call,'document.documentElement.lang')===locale)return;await pause(50);}
  throw Error('DLKT_ACTION_LOCALE_TIMEOUT');
 }
 try{
  for(const locale of ['en','de','ar']){
   await choose(locale);
   const measured=await evaluate(call,'('+actionSpacingProbe.toString()+')()');assertActionSpacing(measured,format);
   assert.equal(measured.locale,locale);if(locale==='ar')assert.equal(measured.direction,'rtl');
   observations.push(measured);
  }
 }finally{await choose(original);}
 return {status:'ACTION_LOCALES_PASS',observations};
}

/** CSS-pixel geometry: DPR changes raster density, not this padding contract. */
function readingDetailProbe(){
 const visible=node=>{
  if(!node||node.getClientRects().length===0||getComputedStyle(node).visibility==='hidden'||getComputedStyle(node).display==='none')return false;
  // Closed details can retain layout boxes for descendants that are not painted.
  // Only their first summary is visible; expanded evidence is still measured.
  for(let parent=node.parentElement;parent;parent=parent.parentElement){
   if(parent.tagName==='DETAILS'&&!parent.open){
    const summary=[...parent.children].find(child=>child.tagName==='SUMMARY');
    if(!summary?.contains(node))return false;
   }
  }
  return true;
 };
 const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
 const painted=node=>{
  const range=document.createRange();range.selectNodeContents(node);const text=range.getBoundingClientRect(),box=rect(node),style=getComputedStyle(node);
  let fits=text.left>=box.left-1&&text.right<=box.right+1&&text.top>=box.top-1&&text.bottom<=box.bottom+1;
  for(let parent=node.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
   const parentStyle=getComputedStyle(parent),bound=rect(parent);
   if(['hidden','clip'].includes(parentStyle.overflowX))fits&&=text.left>=bound.left-1&&text.right<=bound.right+1;
   if(['hidden','clip'].includes(parentStyle.overflowY))fits&&=text.top>=bound.top-1&&text.bottom<=bound.bottom+1;
  }
  return {text:node.textContent?.trim()??'',fits,clamp:style.webkitLineClamp,overflow:style.textOverflow,
   insetLeft:text.left-box.left,insetRight:box.right-text.right,insetTop:text.top-box.top,insetBottom:box.bottom-text.bottom,...box};
 };
 const badges=[...document.querySelectorAll('#discovery-cards .card-topic,#home-local-cards .card-topic')].filter(visible).map(node=>{
  const style=getComputedStyle(node),background=style.backgroundColor;
  return {card:node.closest('article')?.dataset.cardId??node.closest('article')?.dataset.localId??'',
   news:Boolean(node.closest('article[data-news-stream-key]')),photoUnavailable:Boolean(node.closest('.photo-unavailable')),filled:background!=='transparent'&&background!=='rgba(0, 0, 0, 0)',
   background,paddingInlineStart:parseFloat(style.paddingInlineStart),paddingInlineEnd:parseFloat(style.paddingInlineEnd),
   paddingBlockStart:parseFloat(style.paddingBlockStart),paddingBlockEnd:parseFloat(style.paddingBlockEnd),...painted(node)};
 });
 const actions=[...document.querySelectorAll('#discovery-cards .card-actions>.source-link,#home-local-cards .source-link')].filter(visible).map(node=>({
  card:node.closest('article')?.dataset.cardId??node.closest('article')?.dataset.localId??'',...painted(node)}));
 return {viewport:innerWidth,devicePixelRatio,visualScale:visualViewport?.scale??null,badges,actions};
}
function assertReadingDetails(measured,format,{requireFallback=false}={}){
 const details=measured.details;assert.ok(details.badges.length>=fixtureMinimumBadges,'category labels are actually measured');
 assert.ok(details.actions.length>=7,'source actions are actually measured');
 for(const badge of details.badges){
  assert.equal(badge.fits,true,'complete category text stays inside its painted surface: '+JSON.stringify(badge));
  assert.ok(['','none','0','normal'].includes(badge.clamp));assert.notEqual(badge.overflow,'ellipsis');
  if(badge.filled||badge.photoUnavailable){
   assert.ok(badge.paddingInlineStart>=8&&badge.paddingInlineEnd>=8&&badge.paddingBlockStart>=4&&badge.paddingBlockEnd>=4,
    'filled category badges retain inner spacing, including unavailable photos: '+JSON.stringify(badge));
   assert.ok(badge.insetLeft>=7&&badge.insetRight>=7&&badge.insetTop>=3&&badge.insetBottom>=3,
    'category glyphs remain inset from all four surface edges: '+JSON.stringify(badge));
  }
 }
 if(requireFallback){
  assert.ok(details.badges.some(value=>value.photoUnavailable),'the actual failed-photo layout is exercised');
  assert.ok(details.badges.some(value=>value.news&&value.text.length>=18),'a long editorial category label is actually exercised');
 }
 for(const action of details.actions){
  assert.equal(action.fits,true,'the full source CTA text fits its wrapping control: '+JSON.stringify(action));
  assert.ok(['','none','0','normal'].includes(action.clamp));assert.notEqual(action.overflow,'ellipsis');
  assert.ok(action.width>=43.5&&action.height>=43.5&&action.left>=-1&&action.right<=format.width+1,'source action remains a 44px target inside the CSS viewport');
 }
 if(format.dpr===3){
  assert.equal(details.devicePixelRatio,3,'the 440px scenario actually uses DPR 3');
  assert.ok(details.visualScale!==null&&Math.abs(details.visualScale-1)<.01,'DPR 3 is measured at normal visual scale, not claimed as zoom');
 }
}
const fixtureMinimumBadges=7;
/** Trigger the real lazy-image failure path, without replacing card DOM or records. */
async function settleFixturePhotos(call){
 const count=await evaluate(call,"document.querySelectorAll('#discovery-cards img[data-article-photo]').length");
 assert.ok(count>0&&count<=9,'bounded fixture contains normal article-photo requests');
 for(let index=0;index<count;index++){
  await evaluate(call,'(()=>{document.querySelectorAll("#discovery-cards img[data-article-photo]")['+index+']?.scrollIntoView({block:"center"});return true;})()');
  for(let attempt=0;attempt<30;attempt++){
   const settled=await evaluate(call,'(()=>{const n=document.querySelectorAll("#discovery-cards img[data-article-photo]")['+index+'];return !n||n.complete||n.closest(".card-photo")?.dataset.photoFailed==="true";})()');
   if(settled)break;if(attempt===29)throw Error('DLKT_QA_PHOTO_FALLBACK_TIMEOUT');await pause(50);
  }
 }
 await evaluate(call,'(()=>{window.scrollTo(0,0);return true;})()');
}

async function keyboard(call,key){
 const code={Enter:13,Escape:27,Tab:9,Space:32}[key];assert.ok(code,'only the tested keyboard actions are used');
 const actualKey=key==='Space'?' ':key,text=key==='Enter'?'\r':key==='Space'?' ':null;
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:actualKey,code:key,windowsVirtualKeyCode:code,...(text===null?{}:{text,unmodifiedText:text})});
 await call('Input.dispatchKeyEvent',{type:'keyUp',key:actualKey,code:key,windowsVirtualKeyCode:code});
 await pause(30);
}
async function focusSelector(call,selector){
 assert.equal(await evaluate(call,'(()=>{const node=document.querySelector('+JSON.stringify(selector)+');if(!node)return false;node.scrollIntoView({block:"center"});node.focus();return document.activeElement===node;})()'),true,'keyboard target exists and receives focus: '+selector);
}
async function toggleDetails(call,selector,open){
 if(await evaluate(call,'document.querySelector('+JSON.stringify(selector)+')?.open')===open)return;
 const summary=selector+' > summary';await focusSelector(call,summary);await keyboard(call,'Enter');
 assert.equal(await evaluate(call,'document.querySelector('+JSON.stringify(selector)+')?.open'),open,'native disclosure responds to Enter: '+selector);
}
async function verifyNavigation(call,format){
 const compact=await evaluate(call,"matchMedia('(max-width:1152px)').matches");
 if(!compact){
  assert.equal(await evaluate(call,"getComputedStyle(document.getElementById('header-navigation')).display!=='none'"),true,'desktop navigation remains visible');
  return {compact:false,keyboard:false};
 }
 await focusSelector(call,'#header-menu');await keyboard(call,'Enter');
 assert.equal(await evaluate(call,"document.getElementById('header-menu').getAttribute('aria-expanded')"),'true','keyboard opens the compact menu at '+format.width+'px');
 assert.equal(await evaluate(call,"getComputedStyle(document.getElementById('header-navigation')).display!=='none'"),true,'expanded navigation remains visible');
 assert.equal(await evaluate(call,"Boolean(document.activeElement?.closest('#header-navigation'))"),true,'opening the menu moves focus into its links');
 const targets=await evaluate(call,"[...document.querySelectorAll('#header-navigation a,#header-navigation button')].filter(node=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden').map(node=>{const r=node.getBoundingClientRect();return {id:node.id||node.textContent,width:r.width,height:r.height,left:r.left,right:r.right};})");
 assert.ok(targets.length>=5,'the compact navigation exposes its actions');
 for(const target of targets)assert.ok(target.width>=43.5&&target.height>=43.5&&target.left>=-1&&target.right<=format.width+1,'compact navigation controls remain accessible 44px targets: '+JSON.stringify(target));
 const actionSpacing=await evaluate(call,'('+actionSpacingProbe.toString()+')()');assertActionSpacing(actionSpacing,format);
 await keyboard(call,'Tab');
 assert.equal(await evaluate(call,"Boolean(document.activeElement?.closest('#header-navigation'))"),true,'Tab reaches another navigation action');
 await keyboard(call,'Escape');
 assert.equal(await evaluate(call,"document.getElementById('header-menu').getAttribute('aria-expanded')"),'false','Escape closes the menu');
 assert.equal(await evaluate(call,"document.activeElement===document.getElementById('header-menu')"),true,'Escape restores focus to the menu control');
 await evaluate(call,'(()=>{window.scrollTo(0,0);return true;})()');return {compact:true,keyboard:true,actionSpacing};
}
function disclosureTextProbe(expected){
 const visible=node=>Boolean(node)&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none';
 const fits=node=>{
  if(!visible(node))return false;const range=document.createRange();range.selectNodeContents(node);
  const text=range.getBoundingClientRect(),bound=node.getBoundingClientRect(),style=getComputedStyle(node);
  return text.left>=bound.left-1&&text.right<=bound.right+1&&text.top>=bound.top-1&&text.bottom<=bound.bottom+1
   &&node.scrollWidth<=node.clientWidth+1&&node.scrollHeight<=node.clientHeight+1
   &&['','none','0','normal'].includes(style.webkitLineClamp)&&style.textOverflow!=='ellipsis';
 };
 const card=[...document.querySelectorAll('#home-local-cards article[data-local-id]')].find(node=>node.dataset.localId===expected.id);
 const reading=card?.querySelector('details.local-reading');
 const wanted=[...expected.reading.paragraphs,...(expected.reading.period?[expected.reading.period]:[]),...(expected.reading.nextStep?[expected.reading.nextStep]:[])];
 const paragraphs=[...(card?.querySelectorAll('p')??[])],evidence=card?.querySelector('.evidence');
 const evidenceParagraphs=[...(evidence?.querySelectorAll('p')??[])];
 return {open:reading?.open??false,evidenceOpen:evidence?.open??false,
  evidenceFacts:expected.facts.map(text=>evidenceParagraphs.some(node=>node.textContent===text&&fits(node))),
  documentHashVisible:expected.documentHash===null||evidenceParagraphs.some(node=>node.textContent.includes(expected.documentHash)&&fits(node)),paragraphs:wanted.map(text=>({found:paragraphs.some(node=>node.textContent===text),fits:paragraphs.some(node=>node.textContent===text&&fits(node))})),
  evidenceExists:Boolean(card?.querySelector('.evidence')),documentHashRetained:expected.documentHash===null||Boolean(card?.textContent.includes(expected.documentHash)),
  factsRetained:expected.facts.every(text=>card?.textContent.includes(text))};
}
function expandedSourcesProbe(groupKey){
 const card=[...document.querySelectorAll('#discovery-cards article[data-news-stream-key]')].find(node=>node.dataset.storyKey===groupKey);
 return [...(card?.querySelectorAll('.news-story-source-link')??[])].map(node=>{
  const style=getComputedStyle(node),range=document.createRange();range.selectNodeContents(node);
  const text=range.getBoundingClientRect(),bound=node.getBoundingClientRect();
  return {title:node.textContent,url:node.href,visible:node.getClientRects().length>0&&style.visibility!=='hidden',
   fits:text.left>=bound.left-1&&text.right<=bound.right+1&&text.top>=bound.top-1&&text.bottom<=bound.bottom+1
    &&node.scrollWidth<=node.clientWidth+1&&node.scrollHeight<=node.clientHeight+1,
   lineClamp:style.webkitLineClamp,overflow:style.textOverflow,width:bound.width,height:bound.height};
 });
}
async function verifyDisclosures(call,format,fixture){
 await toggleDetails(call,'#home-news-options',true);
 const expanded=await measureReader(call,fixture);assertReaderGeometry(expanded,format,fixture);assertReadingLayout(expanded,format,fixture,{compact:false});
 assert.ok(expanded.controls.some(control=>control.id==='home-news-period'),'period control is available in the open filters');
 assert.ok(expanded.controls.some(control=>control.id==='home-news-source-scope'),'source-language control stays visible while the period panel is open');
 // Leaving the non-modal filter panel must not strand focus under its overlay.
 await focusSelector(call,'#home-news-period');await keyboard(call,'Tab');
 assert.equal(await evaluate(call,"document.getElementById('home-news-options').open"),false,'Tab out closes the filter overlay');
 const outside=await evaluate(call,"(()=>{const n=document.activeElement,r=n?.getBoundingClientRect();return Boolean(n&&r&&r.width>0&&r.height>0&&!n.closest('#home-news-options')&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('a,button,summary,select')===n);})()");
 assert.equal(outside,true,'the focused control after the filters is visible and uncovered');
 await toggleDetails(call,'#home-news-options',true);
 await focusSelector(call,'#home-news-period');await keyboard(call,'Escape');
 assert.equal(await evaluate(call,"document.getElementById('home-news-options').open"),false,'Escape closes the filter panel');
 assert.equal(await evaluate(call,"document.activeElement?.id"),'home-news-options-toggle','Escape restores the filter action');

 // The static information action replaces the old ticker route to sources/preferences.
 await focusSelector(call,'#glance-read');await keyboard(call,'Enter');
 assert.equal(await evaluate(call,"document.getElementById('glance-list').open"),true,'visible context action opens sources and preferences');
 assertActionSpacing(await evaluate(call,'('+actionSpacingProbe.toString()+')()'),format);
 await keyboard(call,'Escape');
 assert.equal(await evaluate(call,"document.getElementById('glance-list').open"),false);
 assert.equal(await evaluate(call,"document.activeElement?.id"),'glance-read','context dialog restores its visible trigger');
 assert.equal(await evaluate(call,"document.getElementById('glance-ribbon').hidden"),true,'ordinary headlines are not repeated in the moving ribbon');
 const local=[];
 for(const expected of fixture.localExpected){
  const selector='#home-local-cards article[data-local-id="'+expected.id+'"] details.local-reading';
  await toggleDetails(call,selector,true);
  const details=await evaluate(call,'('+disclosureTextProbe.toString()+')('+JSON.stringify(expected)+')');
  assert.equal(details.open,true);assert.ok(details.paragraphs.length>0,'local reading contains useful information');
  assert.ok(details.paragraphs.every(value=>value.found&&value.fits),'every local reading paragraph and period is accessible without clipping: '+expected.id);
  assert.equal(details.evidenceExists,true,'local source provenance remains available');
  assert.equal(details.documentHashRetained,true,'operator evidence identity is retained');assert.equal(details.factsRetained,true,'local evidence facts are retained');
  const provenance='#home-local-cards article[data-local-id="'+expected.id+'"] .evidence';
  await toggleDetails(call,provenance,true);
  const evidence=await evaluate(call,'('+disclosureTextProbe.toString()+')('+JSON.stringify(expected)+')');
  assert.equal(evidence.evidenceOpen,true,'local provenance opens with the keyboard');
  assert.equal(evidence.documentHashVisible,true,'operator evidence identity is readable when expanded');
  assert.ok(evidence.evidenceFacts.every(Boolean),'local evidence facts are readable when expanded');
  const expandedLocal=await measureReader(call,fixture);assertReaderGeometry(expandedLocal,format,fixture);assertActionSpacing(expandedLocal.actionSpacing,format);
  await toggleDetails(call,provenance,false);
  await toggleDetails(call,selector,false);local.push({id:expected.id,paragraphs:details.paragraphs.length,evidence:true});
 }
 const groupSelector='#discovery-cards article[data-story-key="'+fixture.groupKey+'"] .news-story-sources';
 const sourcesWereOpen=await evaluate(call,'document.querySelector('+JSON.stringify(groupSelector)+')?.open');
 if(sourcesWereOpen===true)await toggleDetails(call,groupSelector,false);
 await toggleDetails(call,groupSelector,true);
 const originals=await evaluate(call,'('+expandedSourcesProbe.toString()+')('+JSON.stringify(fixture.groupKey)+')');
 assertActionSpacing(await evaluate(call,'('+actionSpacingProbe.toString()+')()'),format);
 assert.deepEqual(new Set(originals.map(value=>value.url)),new Set(fixture.urls),'expanded sources expose every original URL');
 assert.deepEqual(new Set(originals.map(value=>value.title)),new Set(fixture.titles),'expanded sources keep every exact original title');
 for(const original of originals){
  assert.equal(original.visible,true);assert.equal(original.fits,true,'expanded source headline is complete');
  assert.ok(['','none','0','normal'].includes(original.lineClamp));assert.notEqual(original.overflow,'ellipsis');
  assert.ok(original.width>=43.5&&original.height>=43.5,'expanded original source links remain 44px targets');
 }
 if(sourcesWereOpen!==true)await toggleDetails(call,groupSelector,false);
 await evaluate(call,'(()=>{window.scrollTo(0,0);return true;})()');return {filters:true,local,originals:originals.length};
}
function contrastProbe({allCards=false,rootSelector=null}={}){
 const rgba=value=>{
  const match=/^rgba?\(([^)]+)\)$/u.exec(value),srgb=/^color\(srgb ([^)]+)\)$/u.exec(value);
  if(!match&&!srgb)return null;
  const parts=(match??srgb)[1].split(/[,\s/]+/u).filter(Boolean).map(Number);
  return parts.length>=3&&parts.every(Number.isFinite)?[parts[0]*(srgb?255:1),parts[1]*(srgb?255:1),parts[2]*(srgb?255:1),parts[3]??1]:null;
 };
 const blend=(front,back)=>front.slice(0,3).map((channel,index)=>channel*front[3]+back[index]*(1-front[3]));
 const luminance=color=>color.map(channel=>{const c=channel/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((value,c,index)=>value+c*[.2126,.7152,.0722][index],0);
 const background=node=>{
  const ancestors=[];for(let current=node;current;current=current.parentElement)ancestors.push(current);
  let result=[255,255,255];for(const current of ancestors.reverse()){const color=rgba(getComputedStyle(current).backgroundColor);if(!color)return null;result=blend(color,result);}return result;
 };
 const visible=node=>{
  if(!node||node.getClientRects().length===0||getComputedStyle(node).visibility==='hidden'||getComputedStyle(node).display==='none')return false;
  for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open){
   const summary=[...parent.children].find(child=>child.tagName==='SUMMARY');if(!summary?.contains(node))return false;
  }
  return true;
 };
 const over=(front,back)=>{
  const alpha=front[3]+back[3]*(1-front[3]);
  return [...front.slice(0,3).map((channel,index)=>alpha?(channel*front[3]+back[index]*back[3]*(1-front[3]))/alpha:0),alpha];
 };
 // Composite the text and its adjacent background through every actual opacity
 // group. Reading text has solid panels; a background image cannot be inferred.
 const pixels=node=>{
  let ink=rgba(getComputedStyle(node).color),back=[0,0,0,0];const opacity=[];
  if(!ink)return null;
  for(let current=node;current;current=current.parentElement){
   const style=getComputedStyle(current),layer=rgba(style.backgroundColor),alpha=Number(style.opacity);
   if(!layer||!Number.isFinite(alpha)||alpha<0||alpha>1)return null;
   // An opaque descendant panel shields text from an ancestor's photo/gradient.
   if(style.backgroundImage!=='none'&&(ink[3]<1||back[3]<1))return null;
   ink=over(ink,layer);back=over(back,layer);ink[3]*=alpha;back[3]*=alpha;
   if(alpha!==1)opacity.push({tag:current.tagName,className:current.className,value:alpha});
  }
  return {ink:over(ink,[255,255,255,1]).slice(0,3),background:over(back,[255,255,255,1]).slice(0,3),opacity};
 };
 const role=node=>{
  if(node.closest('.source-link'))return 'source-button';
  if(node.closest('.card-topic'))return 'badge';
  if(node.closest('h3,.card-title-link'))return 'title';
  if(node.closest('.publisher-citation,.card-publisher,.card-boundary,.card-photo-caption'))return 'source-credit';
  if(node.closest('.card-date,[data-original-language],.card-meta,.news-origin-meta'))return 'meta';
  if(node.closest('button'))return 'button';if(node.closest('a'))return 'link';return 'body';
 };
 const cards=rootSelector!==null?[...document.querySelectorAll(rootSelector)]:allCards?[...document.querySelectorAll('#discovery-cards article[data-news-stream-key],#home-local-cards article[data-local-id]')]
  :[document.querySelector('#discovery-cards article[data-news-stream-key]')].filter(Boolean);
 const samples=cards.flatMap(card=>{
  const nodes=allCards?[...card.querySelectorAll('*')].filter(node=>node instanceof HTMLElement&&visible(node)
   &&[...node.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent?.trim()))
   :[...new Set(card.querySelectorAll('h3,.publisher-citation,.card-publisher,.card-date,[data-original-language],.card-actions .source-link'))].filter(node=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden');
  return nodes.map(node=>{
   const style=getComputedStyle(node),foreground=rgba(style.color),composite=allCards?pixels(node):null,back=allCards?composite?.background??null:background(node);
   const fontSize=parseFloat(style.fontSize),weight=parseInt(style.fontWeight,10),large=fontSize>=24||(fontSize>=18.66&&weight>=700);
   const painted=allCards?composite?.ink??null:foreground&&back?blend(foreground,back):null,a=painted?luminance(painted):null,b=back?luminance(back):null;
   return {tag:node.tagName,className:node.className,text:node.textContent?.slice(0,100),foreground:style.color,background:back,
    ...(allCards?{cardId:card.dataset.cardId??card.dataset.localId,surface:card.dataset.readerSurface,role:role(node),opacity:composite?.opacity??null}:{}),
    ratio:a!==null&&b!==null?(Math.max(a,b)+.05)/(Math.min(a,b)+.05):null,minimum:large?3:4.5};
  });
 });
 return {theme:document.documentElement.dataset.readerTheme,page:background(document.body),samples,
  ...(allCards?{cards:cards.map(card=>({id:card.dataset.cardId??card.dataset.localId,kind:rootSelector!==null?'surface':card.hasAttribute('data-news-stream-key')?'news':'local',
   surface:card.dataset.readerSurface,visible:visible(card),backgroundColor:rgba(getComputedStyle(card).backgroundColor),background:pixels(card)?.background??null,
   photoUnavailable:Boolean(card.querySelector('.photo-unavailable')),validPhoto:[...card.querySelectorAll('img[data-article-photo]')].some(img=>img.complete&&img.naturalWidth>0)}))}:{})};
};
// Product-approved paints are checked against browser results, not re-derived from CSS tokens.
const approvedPrismSurfaces={paper:'#F0EDE5',ivory:'#D8D6CD',coral:'#F66061',berry:'#142D44',wine:'#7D969B',gold:'#B7C4C3'};
function assertPaletteContrast(measured,fixture,{prism=false}={}){
 assert.equal(measured.theme,prism?'prism':'night');
 const news=measured.cards.filter(card=>card.kind==='news'),local=measured.cards.filter(card=>card.kind==='local');
 assert.equal(news.length,fixture.storyCount);assert.deepEqual(new Set(local.map(card=>card.id)),new Set(fixture.localIds));
 assert.deepEqual(new Set(news.slice(0,6).map(card=>card.surface)),new Set(Object.keys(approvedPrismSurfaces)),'the actual first news cycle paints all six approved variants');
 for(const card of measured.cards){
  assert.equal(card.visible,true,'palette card is rendered: '+card.id);assert.ok(Object.hasOwn(approvedPrismSurfaces,card.surface),'card has an approved assigned surface');
  if(prism){
   const expected=[1,3,5].map(offset=>parseInt(approvedPrismSurfaces[card.surface].slice(offset,offset+2),16));
   assert.deepEqual(card.backgroundColor,[...expected,1],'computed card paint matches its assigned Prism swatch: '+JSON.stringify(card));
   assert.deepEqual(card.background,expected,'effective card paint preserves its full approved color: '+JSON.stringify(card));
  }
  const samples=measured.samples.filter(sample=>sample.cardId===card.id);
  for(const role of ['title','source-credit','source-button','badge'])assert.ok(samples.some(sample=>sample.role===role),'actual '+role+' text is measured on '+card.surface+': '+card.id);
  if(card.kind==='news')assert.ok(samples.some(sample=>sample.role==='meta'),'actual news metadata is measured: '+card.id);
  for(const sample of samples)assert.ok(sample.ratio!==null&&sample.ratio>=sample.minimum,'actual '+measured.theme+' card text has readable contrast after opacity compositing: '+JSON.stringify(sample));
 }
 assert.ok(measured.samples.some(sample=>sample.role==='body'),'visible body copy is actually measured where supplied by the fixture');
 assert.ok(news.some(card=>card.photoUnavailable),'the natural failed-photo reading panel remains covered');
 // Existing geometry assertions independently retain full titles, source URLs,
 // badge padding and 44px controls. No article or surface attribute is replaced.
}
async function verifyNight(call,format,fixture,outputDir){
 await settleFixturePhotos(call);
 const prism=await evaluate(call,'('+contrastProbe.toString()+')({allCards:true})');assertPaletteContrast(prism,fixture,{prism:true});
 const before=await evaluate(call,'('+contrastProbe.toString()+')()');assert.equal(before.theme,'prism','day layout is the baseline');
 await focusSelector(call,'#reader-theme-toggle');await keyboard(call,'Enter');
 await evaluate(call,'(()=>{window.scrollTo(0,0);return true;})()');
 const measured=await measureReader(call,fixture);assertReaderGeometry(measured,format,fixture);assertReadingLayout(measured,format,fixture);
 const contrast=await evaluate(call,'('+contrastProbe.toString()+')()');
 assert.equal(contrast.theme,'night');assert.notDeepEqual(contrast.page,before.page,'night changes the effective computed page background');
 assert.ok(contrast.samples.length>=3,'night reads actual title, attribution and action colors');
 for(const sample of contrast.samples)assert.ok(sample.ratio!==null&&sample.ratio+.01>=sample.minimum,'night text contrast falls below its readable threshold: '+JSON.stringify(sample));
 const nightPalette=await evaluate(call,'('+contrastProbe.toString()+')({allCards:true})');assertPaletteContrast(nightPalette,fixture);
 assert.deepEqual(nightPalette.cards.map(card=>[card.id,card.surface]),prism.cards.map(card=>[card.id,card.surface]),'Night preserves actual article identities and palette assignments');
 const screenshots=[];
 for(const section of ['top','cards']){
  if(section==='cards')await evaluate(call,"(()=>{document.querySelector('#discovery-cards article[data-news-stream-key]').scrollIntoView({block:'start'});return true;})()");
  const data=(await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data;
  assert.ok(typeof data==='string'&&data.length>=1000,'night screenshot is present');
  const filename='dlkt-night-'+section+'-'+format.width+'.png';writeFileSync(join(outputDir,filename),Buffer.from(data,'base64'),{mode:0o600});screenshots.push(filename);
  if(section==='top')await emitVisualPreview(call,'night-top',format.width);
 }
 await focusSelector(call,'#reader-theme-toggle');await keyboard(call,'Enter');
 assert.equal(await evaluate(call,'document.documentElement.dataset.readerTheme'),'prism','theme action restores day mode');
 await evaluate(call,'(()=>{window.scrollTo(0,0);return true;})()');
 const restored=await evaluate(call,'('+contrastProbe.toString()+')({allCards:true})');assertPaletteContrast(restored,fixture,{prism:true});
 assert.deepEqual(restored.cards.map(card=>[card.id,card.surface]),prism.cards.map(card=>[card.id,card.surface]),'returning to Prism restores the same assigned variants');
 return {contrast,screenshots,palette:{prism,night:nightPalette,restored}};
}

/** Small fixture-only previews make visual review possible without downloading the ZIP.
 * Full-resolution PNGs remain in the normal artifact. Only the explicit label/viewport pairs below are exported.
 */
async function emitVisualPreview(call,label,width){
 const selected=(label==='top'&&[390,1440].includes(width))||(width===390&&['cards','night-top'].includes(label))||(['reading-updates','owned-card','personal-wallet','account-profile','wallet-saved'].includes(label)&&[390,1440].includes(width));
 if(!selected&&!(width===320&&['auth-email-ro','auth-email-ar'].includes(label)))return;
 const data=(await call('Page.captureScreenshot',{format:'jpeg',quality:72,fromSurface:true,captureBeyondViewport:false})).data;
 if(typeof data!=='string'||data.length<1000||data.length>160000){console.log('DLKT_UI_VISUAL_SKIPPED',label,width);return;}
 const bytes=Buffer.from(data,'base64'),sha256=createHash('sha256').update(bytes).digest('hex'),chunks=Math.ceil(data.length/4096);
 console.log('DLKT_UI_VISUAL_BEGIN '+JSON.stringify({label,width,encoding:'base64',mimeType:'image/jpeg',bytes:bytes.length,sha256,chunks}));
 for(let i=0;i<chunks;i++)console.log('DLKT_UI_VISUAL_CHUNK '+String(i+1).padStart(4,'0')+' '+data.slice(i*4096,(i+1)*4096));
 console.log('DLKT_UI_VISUAL_END '+sha256);
}

/** Shared bounded control measurements for Explore and the anonymous account shell. */
function surfaceProbe(rootSelector,fieldSelector,controlSelector='a[href],button,input,select,textarea,summary'){
 const visible=node=>Boolean(node)&&node.getClientRects().length>0&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden';
 const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
 const textFits=node=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(node.tagName)||!node.textContent?.trim())return true;
  const r=document.createRange();r.selectNodeContents(node);const t=r.getBoundingClientRect(),b=box(node),s=getComputedStyle(node);
  return t.left>=b.left-1&&t.right<=b.right+1&&t.top>=b.top-1&&t.bottom<=b.bottom+1&&['','none','0','normal'].includes(s.webkitLineClamp)&&s.textOverflow!=='ellipsis';
 };
 const root=document.querySelector(rootSelector),style=root?getComputedStyle(root):null;
 return {found:visible(root),root:root?box(root):null,documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,
  contentLeft:root?box(root).left+parseFloat(style.paddingLeft):null,contentRight:root?box(root).right-parseFloat(style.paddingRight):null,
  controls:[...(root?.querySelectorAll(controlSelector)??[])].filter(visible).map(node=>({id:node.id||node.className,tag:node.tagName,text:node.textContent?.trim().slice(0,100)??'',textFits:textFits(node),...box(node)})),
  fields:[...document.querySelectorAll(fieldSelector)].filter(visible).map(node=>({id:node.id,fontSize:parseFloat(getComputedStyle(node).fontSize),...box(node)})),
  headings:[...(root?.querySelectorAll('h1,h2,h3')??[])].filter(visible).map(node=>({text:node.textContent,textFits:textFits(node)}))};
}
function assertSurface(measured,format,label){
 assert.equal(measured.found,true,label+' is visible');assert.ok(measured.documentWidth<=format.width+2,label+' does not introduce horizontal document scrolling');
 assert.ok(measured.root.left>=-1&&measured.root.right<=format.width+1,label+' fits the CSS viewport');
 for(const control of measured.controls)assert.ok(control.width>=43.5&&control.height>=43.5&&control.left>=-1&&control.right<=format.width+1&&control.textFits,
  label+' control keeps its full label and 44px target: '+JSON.stringify(control));
 for(const field of measured.fields)assert.ok(field.fontSize>=16&&field.width>=43.5&&field.height>=43.5,label+' fields use at least 16px text and 44px targets: '+JSON.stringify(field));
 for(const heading of measured.headings)assert.equal(heading.textFits,true,label+' heading is complete: '+heading.text);
}
async function verifyExploreSurface(call,format,fixture){
 await focusSelector(call,'#world-open');await keyboard(call,'Enter');
 assert.equal(await evaluate(call,"document.getElementById('world-explore').hidden"),false,'Explore opens using its real action');
 const measured=await evaluate(call,'('+surfaceProbe.toString()+')("#world-explore","#world-city-query,#world-country,#world-category",".world-controls button,.world-controls input,.world-controls select,.world-explore-top button,#world-refresh,#world-more,.world-coverage>summary,#world-empty button")');
 assertSurface(measured,format,'Explore');
 const actionSpacing=await evaluate(call,'('+actionSpacingProbe.toString()+')()');assertActionSpacing(actionSpacing,format);
 assert.equal(measured.fields.length,3,'all three Explore fields are measured');
 await focusSelector(call,'#world-back');await keyboard(call,'Enter');
 assert.equal(await evaluate(call,"document.getElementById('world-explore').hidden"),true,'Explore returns to the existing reader');
 assert.equal(await evaluate(call,'document.activeElement?.id'),'world-open','Explore restores its launch action');
 await evaluate(call,'(()=>{window.scrollTo(0,0);return true;})()');
 assertReaderGeometry(await measureReader(call,fixture),format,fixture);return measured;
}
/** Test-only font-size doubling; explicitly not browser zoom or Safari text autosizing. */
function startTypographyStress(){
 if(window.__dlktQaTypography)throw Error('DLKT_QA_TYPOGRAPHY_ALREADY_ACTIVE');
 const nodes=[...document.querySelectorAll('body *')].filter(node=>node instanceof HTMLElement
  &&!['SCRIPT','STYLE','NOSCRIPT'].includes(node.tagName)
  &&(['INPUT','SELECT','TEXTAREA','BUTTON','SUMMARY'].includes(node.tagName)||[...node.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent?.trim())));
 const saved=nodes.map(node=>({node,fontValue:node.style.getPropertyValue('font-size'),fontPriority:node.style.getPropertyPriority('font-size'),font:parseFloat(getComputedStyle(node).fontSize)})).filter(row=>Number.isFinite(row.font)&&row.font>0);
 if(saved.length<20||saved.length>5000)throw Error('DLKT_QA_TYPOGRAPHY_SCOPE_INVALID');
 window.__dlktQaTypography=saved;
 for(const row of saved)row.node.style.setProperty('font-size',String(row.font*2)+'px','important');
 const samples=saved.filter(row=>row.node.matches('#discovery-cards h3 a,#discovery-cards .card-topic,#discovery-cards .source-link,#world-city-query,#home-news-category')).map(row=>({
  tag:row.node.tagName,id:row.node.id||row.node.className,before:row.font,after:parseFloat(getComputedStyle(row.node).fontSize)}));
 return {mode:'computed-font-size-times-two',nativeBrowserZoom:false,elementCount:saved.length,samples,devicePixelRatio,visualScale:visualViewport?.scale??null};
}
function restoreTypographyStress(){
 const saved=window.__dlktQaTypography;if(!Array.isArray(saved))return false;
 for(const row of saved){if(row.fontValue==='')row.node.style.removeProperty('font-size');else row.node.style.setProperty('font-size',row.fontValue,row.fontPriority);}
 delete window.__dlktQaTypography;return true;
}
async function verifyTypographyStress(call,format,fixture,outputDir){
 const scale=await evaluate(call,'('+startTypographyStress.toString()+')()');
 try{
  assert.ok(scale.samples.length>=8,'font stress reaches actual headlines, badges and actions');
  for(const sample of scale.samples)assert.ok(Math.abs(sample.after-sample.before*2)<.02,'the requested text-size stress was applied: '+JSON.stringify(sample));
  assert.equal(scale.devicePixelRatio,3);assert.ok(scale.visualScale!==null&&Math.abs(scale.visualScale-1)<.01);
  await evaluate(call,'(()=>{window.scrollTo(0,0);return true;})()');
  const measured=await measureReader(call,fixture);
  assertReaderGeometry(measured,format,fixture);
  // Density budgets belong to the normal layout. Enlarged text may grow vertically.
  assertReadingLayout(measured,format,fixture,{compact:false});
  assertReadingDetails(measured,format,{requireFallback:true});
  const navigation=await verifyNavigation(call,format);
  const explore=await verifyExploreSurface(call,format,fixture);
  const disclosures=await verifyDisclosures(call,format,fixture);
  await evaluate(call,"(()=>{document.querySelector('#discovery-cards .photo-unavailable')?.scrollIntoView({block:'center'});return true;})()");
  const data=(await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data;
  assert.ok(typeof data==='string'&&data.length>=1000);
  const screenshot='dlkt-typography-200-percent-440-dpr3.png';writeFileSync(join(outputDir,screenshot),Buffer.from(data,'base64'),{mode:0o600});
  return {scale,measured,navigation,explore,disclosures,screenshot};
 }finally{
  assert.equal(await evaluate(call,'('+restoreTypographyStress.toString()+')()'),true,'the test-only typography override is removed');
  await evaluate(call,'(()=>{window.scrollTo(0,0);return true;})()');
 }
}

/** A separate controlled edition sequence exercises the shipped refresh handler without replacing its DOM or controller. */
function readingUpdateProbe(primaryId){
 const cards=[...document.querySelectorAll('#discovery-cards article[data-news-stream-key]')];
 const owner=cards.find(card=>card.dataset.cardId===primaryId),updates=owner?.querySelector('details[data-news-updates]');
 const original=owner?[...owner.querySelectorAll('.news-story-sources')].find(panel=>!panel.closest('[data-news-updates]')):null;
 const visible=node=>Boolean(node)&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none';
 const linkDetails=node=>{
  const bound=node.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(node);
  const text=range.getBoundingClientRect(),style=getComputedStyle(node);
  return {text:node.textContent,url:node.href,visible:visible(node),width:bound.width,height:bound.height,
   fits:text.left>=bound.left-1&&text.right<=bound.right+1&&text.top>=bound.top-1&&text.bottom<=bound.bottom+1
    &&node.scrollWidth<=node.clientWidth+1&&node.scrollHeight<=node.clientHeight+1,
   lineClamp:style.webkitLineClamp,overflow:style.textOverflow};
 };
 return {
  documentWidth:document.documentElement.scrollWidth,busy:document.querySelector('#discovery-cards')?.getAttribute('aria-busy'),
  ownerCount:cards.filter(card=>card.dataset.cardId===primaryId).length,
  cards:cards.map(card=>({id:card.dataset.cardId,key:card.dataset.newsStreamKey,title:card.querySelector('h3')?.textContent,
   surface:card.dataset.readerSurface,background:getComputedStyle(card).backgroundColor})),
  original:{open:original?.open??false,links:[...(original?.querySelectorAll('.news-story-source-link')??[])].map(node=>({text:node.textContent,url:node.href})),
   dates:[...(original?.querySelectorAll('time')??[])].map(node=>node.dateTime),evidence:owner?.querySelector('.evidence')?.textContent??null},
  updates:updates?{open:updates.open,label:updates.querySelector('summary')?.textContent,
   rows:[...updates.querySelectorAll('.news-reading-updates-list > li[data-update-source-id]')].map(row=>({
    id:row.dataset.updateSourceId,epoch:row.dataset.updateEpoch,
    links:[...row.querySelectorAll('.news-story-source-link')].map(linkDetails),
    checks:[...row.querySelectorAll('time[data-update-checked]')].map(node=>({at:node.dateTime,text:node.textContent,visible:visible(node)})),
   }))}:null,
 };
}
async function verifyReadingUpdates(call,format,fixture,origin,outputDir){
 const group='dlkt-reading-updates-'+format.width;
 let heldCard=null,heldSources=null;
 try{
  const initial=await fixture.updates.publish(0);
  await call('Page.navigate',{url:origin+'/'});await loaded(call);await selectControlledEdition(call,fixture);await settleFixturePhotos(call);
  const selector='#discovery-cards article[data-card-id="'+initial.primaryId+'"]',sourceSelector=selector+' .news-story-sources:not([data-news-updates])';
  await toggleDetails(call,sourceSelector,true);
  const before=await evaluate(call,'('+readingUpdateProbe.toString()+')('+JSON.stringify(initial.primaryId)+')');
  assert.equal(before.ownerCount,1);assert.equal(before.cards.length,fixture.storyCount);assert.equal(before.updates,null);
  assert.equal(before.original.open,true);assert.deepEqual(new Set(before.original.links.map(link=>link.url)),new Set(initial.originalUrls));
  assert.ok(before.cards.some(card=>card.id===initial.negativeId),'the distinct negative event is initially displayed');
  const hold=async selector=>{
   const output=await call('Runtime.evaluate',{expression:'document.querySelector('+JSON.stringify(selector)+')',objectGroup:group,returnByValue:false});
   assert.equal(output.exceptionDetails,undefined);assert.ok(output.result?.objectId,'actual existing DOM node is retained for identity verification');
   return output.result.objectId;
  };
  heldCard=await hold(selector);heldSources=await hold(sourceSelector);
  const read=()=>evaluate(call,'('+readingUpdateProbe.toString()+')('+JSON.stringify(initial.primaryId)+')');
  const retain=async current=>{
   assert.equal(current.ownerCount,1,'an update never creates a second owner card');
   assert.deepEqual(current.cards,before.cards,'refresh preserves actual original card order, identities, headlines and palette');
   assert.deepEqual(current.original,before.original,'original source links, dates, evidence and open state are unchanged');
   for(const [objectId,expectedSelector]of [[heldCard,selector],[heldSources,sourceSelector]]){
    const output=await call('Runtime.callFunctionOn',{objectId,
     functionDeclaration:'function(selector){return this.isConnected&&document.querySelector(selector)===this;}',
     arguments:[{value:expectedSelector}],returnByValue:true});
    assert.equal(output.exceptionDetails,undefined);assert.equal(output.result?.value,true,'the original card/source disclosure DOM node survives refresh');
   }
   assert.ok(current.documentWidth<=format.width+2,'update disclosure cannot introduce horizontal overflow');
  };
  const refresh=async(stage,expectedIds)=>{
   const edition=await fixture.updates.publish(stage);
   await focusSelector(call,'#discovery-refresh');await keyboard(call,'Enter');
   let stable=0,current=null;
   for(let attempt=0;attempt<80;attempt++){
    current=await read();
    const ids=current.updates?.rows.map(row=>row.id)??[];
    if(fixture.updates.lastNewsEpoch===edition.epoch&&current.busy==='false'
      &&expectedIds.every(id=>ids.includes(id))){if(++stable===2)break;}else stable=0;
    if(attempt===79)throw Error('DLKT_UI_READING_UPDATES_TIMEOUT_'+JSON.stringify({epoch:edition.epoch,served:fixture.updates.lastNewsEpoch,busy:current.busy,ids}));
    await pause(100);
   }
   await retain(current);return {edition,current};
  };
  const added=await refresh(1,[initial.added.id]);
  const updatesSelector=selector+' details[data-news-updates]';
  await toggleDetails(call,updatesSelector,true);
  const withSource=await read(),addedRows=withSource.updates.rows;
  assert.equal(addedRows.length,1,'one newly checked original adds one meaningful source row');
  assert.equal(addedRows[0].id,initial.added.id);assert.equal(addedRows[0].epoch,added.edition.epoch);
  assert.deepEqual(addedRows[0].checks.map(check=>check.at),[added.edition.added.checkedAt],'new-source check uses its own validated source timestamp');
  assert.equal(addedRows[0].links.length,1);assert.equal(addedRows[0].links[0].url,initial.added.url);
  assert.equal(addedRows[0].links[0].text,initial.added.title);
  assert.ok(addedRows[0].checks.every(check=>check.visible),'source-check time is readable when expanded');
  for(const link of addedRows[0].links){
   assert.equal(link.visible,true);assert.equal(link.fits,true);assert.ok(link.width>=43.5&&link.height>=43.5);
   assert.ok(['','none','0','normal'].includes(link.lineClamp));assert.notEqual(link.overflow,'ellipsis');
  }
  await focusSelector(call,updatesSelector+' > summary');await keyboard(call,'Tab');
  assert.equal(await evaluate(call,'Boolean(document.activeElement?.closest('+JSON.stringify(updatesSelector)+'))'),true,'keyboard navigation reaches update contents');
  await toggleDetails(call,updatesSelector,false);await toggleDetails(call,updatesSelector,true);
  const corrected=await refresh(2,[initial.added.id,initial.corrected.id]);
  await toggleDetails(call,updatesSelector,true);
  const withCorrection=await read(),rows=withCorrection.updates.rows;
  assert.equal(rows.length,2,'the publisher correction enriches the same card alongside the added original');
  const changed=rows.find(row=>row.id===initial.corrected.id);assert.ok(changed);
  assert.equal(changed.epoch,corrected.edition.epoch);assert.deepEqual(changed.checks.map(check=>check.at),[corrected.edition.corrected.checkedAt]);
  assert.equal(changed.links.length,1);assert.equal(changed.links[0].url,initial.corrected.url);assert.equal(changed.links[0].text,initial.corrected.title);
  assert.equal(changed.links[0].visible,true);assert.equal(changed.links[0].fits,true);assert.ok(changed.links[0].height>=43.5);
  assert.deepEqual(rows.find(row=>row.id===initial.added.id).checks,addedRows[0].checks,'a later edition cannot restamp the earlier update receipt');
  const meaningful=rows.map(row=>({id:row.id,epoch:row.epoch,links:row.links.map(link=>({text:link.text,url:link.url})),checks:row.checks.map(check=>check.at)}));
  await refresh(3,[initial.added.id,initial.corrected.id]);await toggleDetails(call,updatesSelector,true);
  const rechecked=await read();
  assert.deepEqual(rechecked.updates.rows.map(row=>({id:row.id,epoch:row.epoch,links:row.links.map(link=>({text:link.text,url:link.url})),checks:row.checks.map(check=>check.at)})),meaningful,
   'source reordering, publication-date changes and rechecking alone neither add a novelty nor rewrite retained update receipts');
  assert.equal(rechecked.updates.label,withCorrection.updates.label,'unchanged information cannot inflate the update count');
  await retain(rechecked);
  await evaluate(call,'(()=>{document.querySelector('+JSON.stringify(updatesSelector)+').scrollIntoView({block:"center"});return true;})()');
  const screenshot='dlkt-reading-updates-'+format.width+'.png';
  const picture=(await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data;
  assert.ok(typeof picture==='string'&&picture.length>=1000);writeFileSync(join(outputDir,screenshot),Buffer.from(picture,'base64'),{mode:0o600});
  await emitVisualPreview(call,'reading-updates',format.width);
  return {status:'SAME_CARD_UPDATES_PASS',originalCards:before.cards.length,meaningfulSources:meaningful.length,
   originalDomIdentity:true,originalDisclosureRetained:true,sourceAddition:true,publisherCorrection:true,metadataOnlyIgnored:true,
   distinctEventRetained:true,keyboard:true,documentWidth:rechecked.documentWidth,screenshot};
 }finally{
  fixture.updates.reset();
  try{await call('Runtime.releaseObjectGroup',{objectGroup:group});}catch{/* Cleanup must not hide the original assertion. */}
 }
}

/** Test-only observation of the actual owned/news nodes; no production DOM is replaced. */
function knowledgeExposureProbe(seenKey,selectedId=null){
 const root=document.querySelector('#discovery-cards');
 const owned=[...root.querySelectorAll('article[data-knowledge-id]')];
 const current=selectedId===null?owned[0]:owned.find(card=>card.dataset.knowledgeId===selectedId);
 const news=[...root.querySelectorAll('article[data-news-stream-key]:not([data-knowledge-id])')];
 const bound=current?.getBoundingClientRect();
 const possible=bound?Math.min(bound.width,innerWidth)*Math.min(bound.height,innerHeight):0;
 const visible=bound?Math.max(0,Math.min(bound.right,innerWidth)-Math.max(bound.left,0))*Math.max(0,Math.min(bound.bottom,innerHeight)-Math.max(bound.top,0)):0;
 const raw=localStorage.getItem(seenKey),seen=raw===null?[]:JSON.parse(raw);
 return {theme:document.documentElement.dataset.readerTheme,focused:document.hasFocus(),visibility:document.visibilityState,documentWidth:document.documentElement.scrollWidth,
  seen,ownedIds:owned.map(card=>card.dataset.knowledgeId),current:current?{id:current.dataset.knowledgeId,
   afterNews:news.filter(card=>Boolean(card.compareDocumentPosition(current)&Node.DOCUMENT_POSITION_FOLLOWING)).length,
   fraction:possible>0?visible/possible:0,top:bound.top,bottom:bound.bottom}:null,
  news:news.map(card=>({id:card.dataset.cardId,key:card.dataset.newsStreamKey,title:card.querySelector('h3')?.textContent,
   surface:card.dataset.readerSurface,background:getComputedStyle(card).backgroundColor,
   dates:[...card.querySelectorAll('time')].map(node=>({at:node.dateTime,text:node.textContent})),
   evidence:card.querySelector('.evidence')?.textContent??null})),
 };
}

async function verifyKnowledgeExposure(call,format,fixture,origin,outputDir){
 const seenKey='dlkt-info-knowledge-seen-v1',group='dlkt-owned-exposure-'+format.width;
 let heldNews=null;
 try{
  // This dedicated blank-profile test clears only owned-card history before navigation.
  await evaluate(call,'(()=>{localStorage.removeItem('+JSON.stringify(seenKey)+');return true;})()');
  await fixture.owned.activate();
  await call('Page.bringToFront');
  await call('Emulation.setFocusEmulationEnabled',{enabled:true});
  await call('Page.navigate',{url:origin+'/'});await loaded(call);await selectControlledEdition(call,fixture);
  await evaluate(call,'(()=>{window.scrollTo({top:0,behavior:"instant"});return true;})()');
  const read=id=>evaluate(call,'('+knowledgeExposureProbe.toString()+')('+JSON.stringify(seenKey)+','+JSON.stringify(id??null)+')');
  let initial=null;
  for(let attempt=0;attempt<60;attempt++){
   initial=await read();
   if(initial.current&&initial.news.length===20)break;
   if(attempt===59)throw Error('DLKT_UI_OWNED_CARD_TIMEOUT_'+JSON.stringify(initial));await pause(100);
  }
  assert.equal(initial.focused,true,'the real Chrome page has focus');
  assert.equal(initial.visibility,'visible');
  assert.equal(initial.current.afterNews,11,'the actual owned card follows eleven actual news articles');
  assert.equal(initial.current.fraction,0,'the first owned card starts outside the viewport');
  assert.deepEqual(initial.seen,[],'DOM insertion alone cannot mark a card exposed');
  const id=initial.current.id,before=initial.news;
  const assertApprovedPalette=current=>{
   assert.equal(current.theme,'prism','owned-card exposure uses the approved light palette');
   for(const card of current.news){
    assert.ok(Object.hasOwn(approvedPrismSurfaces,card.surface),'every news card retains an approved assigned surface');
    const rgb=[1,3,5].map(offset=>parseInt(approvedPrismSurfaces[card.surface].slice(offset,offset+2),16));
    assert.equal(card.background,'rgb('+rgb.join(', ')+')','every news card paints its assigned approved swatch: '+card.id);
   }
  };
  assertApprovedPalette(initial);
  const selector='#discovery-cards article[data-knowledge-id="'+id+'"]';
  const output=await call('Runtime.evaluate',{expression:'[...document.querySelectorAll("#discovery-cards article[data-news-stream-key]:not([data-knowledge-id])")]',objectGroup:group,returnByValue:false});
  assert.equal(output.exceptionDetails,undefined);assert.ok(output.result?.objectId);
  heldNews=output.result.objectId;
  const retain=async current=>{
   assert.deepEqual(current.news,before,'exposure retains news identity/order, original source dates/evidence and palette');
   const result=await call('Runtime.callFunctionOn',{objectId:heldNews,
    functionDeclaration:'function(){const current=[...document.querySelectorAll("#discovery-cards article[data-news-stream-key]:not([data-knowledge-id])")];return current.length===this.length&&this.every((node,index)=>node.isConnected&&current[index]===node);}',
    returnByValue:true});
   assert.equal(result.exceptionDetails,undefined);assert.equal(result.result?.value,true,'every original news DOM node survives exposure bookkeeping');
   assert.ok(current.documentWidth<=format.width+2,'owned-card exposure introduces no horizontal overflow');
  };
  await pause(2200);
  const offscreen=await read(id);
  assert.equal(offscreen.current.fraction,0);assert.equal(offscreen.seen.includes(id),false,'offscreen dwell never records exposure');
  await retain(offscreen);
  const partialStarted=Date.now();
  await evaluate(call,'(()=>{document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center",behavior:"instant"});return true;})()');
  await pause(550);
  const partial=await read(id);assert.ok(partial.current.fraction>=0.5,'brief exposure reaches the qualifying visible area');
  assert.equal(partial.seen.includes(id),false,'less than two seconds does not qualify');
  await evaluate(call,'(()=>{window.scrollTo({top:0,behavior:"instant"});return true;})()');
  const partialMs=Date.now()-partialStarted;
  assert.ok(partialMs<1900,'controlled brief exposure remains below the two-second threshold');
  await pause(2200);
  const reset=await read(id);
  assert.equal(reset.current.fraction,0);assert.equal(reset.seen.includes(id),false,'leaving the viewport resets the continuous dwell');
  await retain(reset);
  await evaluate(call,'(()=>{document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center",behavior:"instant"});return true;})()');
  const visible=await read(id);
  assert.equal(visible.focused,true);assert.equal(visible.visibility,'visible');assert.ok(visible.current.fraction>=0.5);
  const qualifiedStarted=Date.now();
  await pause(2300);
  const qualified=await read(id);
  assert.ok(Date.now()-qualifiedStarted>=2000);
  assert.ok(qualified.current.fraction>=0.5,'the owned card stays visibly eligible during the dwell');
  assert.equal(qualified.seen.filter(value=>value===id).length,1,'qualified exposure writes the stableID once');
  await retain(qualified);
  const screenshot='dlkt-owned-exposure-'+format.width+'.png';
  const picture=(await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data;
  assert.ok(typeof picture==='string'&&picture.length>=1000);
  writeFileSync(join(outputDir,screenshot),Buffer.from(picture,'base64'),{mode:0o600});
  await emitVisualPreview(call,'owned-card',format.width);
  await call('Page.reload',{ignoreCache:true});await loaded(call);await selectControlledEdition(call,fixture);
  await evaluate(call,'(()=>{window.scrollTo({top:0,behavior:"instant"});return true;})()');
  let reloaded=null;
  for(let attempt=0;attempt<60;attempt++){
   reloaded=await read();
   if(reloaded.ownedIds.length>0&&reloaded.news.length===20)break;
   if(attempt===59)throw Error('DLKT_UI_OWNED_RELOAD_TIMEOUT_'+JSON.stringify(reloaded));await pause(100);
  }
  assert.equal(reloaded.seen.includes(id),true,'the real local history survives reload');
  assert.equal(reloaded.ownedIds.includes(id),false,'an exposed stableID does not recur after reload');
  // The existing theme assigns a new random six-surface cycle on navigation.
  // Content/receipts persist across visits; exact painted assignments persist within this visit.
  const originalNews=cards=>cards.map(({surface,background,...content})=>content);
  assert.deepEqual(originalNews(reloaded.news),originalNews(before),'a return visit keeps the same original news content and source receipt');
  assertApprovedPalette(reloaded);
  assert.ok(reloaded.documentWidth<=format.width+2);
  return {status:'OWNED_CARD_EXPOSURE_PASS',newsCount:20,afterNews:initial.current.afterNews,ownedId:id,
   offscreenUnseen:true,briefExposureMs:partialMs,continuousDwellReset:true,qualifiedExposure:true,
   originalNewsDomIdentity:true,originalSourceDatesRetained:true,paletteRetained:true,reloadApprovedPalette:true,reloadSuppressesExposedId:true,screenshot,
   scope:'actual browser.ts with real NewsPageService over20 controlled stories; publication scheduling is tested separately in model tests, not an autonomous research worker'};
 }finally{
  fixture.owned.reset();
  try{await call('Runtime.releaseObjectGroup',{objectGroup:group});}catch{/* Preserve the measured assertion. */}
 }
}

async function verifyAccountSurfaces(call,origin,outputDir){
 // Establish the preference using the production toggle, before leaving the reader.
 await focusSelector(call,'#reader-theme-toggle');await keyboard(call,'Enter');
 const expected=await evaluate(call,'('+contrastProbe.toString()+')()');assert.equal(expected.theme,'night');
 const observations=[];
 for(const format of [{width:320,height:750,mobile:true},{width:1440,height:900,mobile:false}]){
  await call('Emulation.setDeviceMetricsOverride',{width:format.width,height:format.height,deviceScaleFactor:1,mobile:format.mobile,scale:1});
  await call('Page.navigate',{url:origin+'/account'});await loaded(call);await pause(150);
  const measured=await evaluate(call,'('+surfaceProbe.toString()+')("main.account-page","#account-email,#account-otp")');
  assertSurface(measured,format,'anonymous account shell');
  const actionSpacing=await evaluate(call,'('+actionSpacingProbe.toString()+')()');assertActionSpacing(actionSpacing,format);
  assert.ok(measured.root.width<=1122,'account container has a bounded reading width');
  assert.ok(measured.contentLeft>=15&&measured.contentRight<=format.width-15,'account content keeps its responsive side gutters');
  assert.ok(measured.controls.length>=2,'visible anonymous account controls are actually measured');
  assert.equal(await evaluate(call,"document.getElementById('account-data').hidden"),true,'offline account data remains inaccessible');
  const actual=await evaluate(call,'('+contrastProbe.toString()+')()');assert.equal(actual.theme,'night','account bootstrap restores the stored Night preference');
  assert.deepEqual(actual.page,expected.page,'account uses the actual computed Night page background');
  const data=(await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data;
  assert.ok(typeof data==='string'&&data.length>=1000);
  const screenshot='dlkt-account-night-'+format.width+'.png';writeFileSync(join(outputDir,screenshot),Buffer.from(data,'base64'),{mode:0o600});
  observations.push({viewport:format.width,theme:actual.theme,background:actual.page,measured,actionSpacing,screenshot,scope:'unavailable anonymous fixture; no login, OTP or private account data exercised'});
 }
 return observations;
}

async function verifyLocalePreference({openIsolated,origin,fixture,personal}) {
 assert.equal(personal.active,false,'private fixture is inactive before locale acceptance');
 assert.equal(fixture.city.countryCode,'RO','the existing initial location fixture is Romanian');
 const isolated=await openIsolated(),{call}=isolated,key='dlkt-reader-language-v1';
 const read=()=>evaluate(call,`(() => ({
  ready:document.readyState,timeOrigin:performance.timeOrigin,href:location.href,
  locale:document.documentElement.lang,picker:document.querySelector('#reader-language')?.value,
  stored:localStorage.getItem(${JSON.stringify(key)})
 }))()`);
 async function expect(locale,stored,{oldTime=null,href=null}={}) {
  let current;
  for(let attempt=0;attempt<60;attempt++) {
   current=await read();
   if(current.ready==='complete'&&current.locale===locale&&current.picker===locale&&current.stored===stored
    &&(oldTime===null||current.timeOrigin!==oldTime)&&(href===null||current.href===href))return current;
   await pause(100);
  }
  throw Error('DLKT_UI_LOCALE_TIMEOUT_'+JSON.stringify({locale,stored,current}));
 }
 async function visit(url,locale,stored) {
  const oldTime=await evaluate(call,'performance.timeOrigin');
  await call('Page.navigate',{url});await loaded(call);
  return expect(locale,stored,{oldTime,href:url});
 }
 async function reload(locale) {
  const before=await read();
  await call('Page.reload',{ignoreCache:true});await loaded(call);
  return expect(locale,locale,{oldTime:before.timeOrigin,href:before.href});
 }
 async function choose(locale) {
  assert.equal(await evaluate(call,`(() => {
   const picker=document.querySelector('#reader-language');if(!picker)return false;
   picker.value=${JSON.stringify(locale)};picker.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`),true);
  await expect(locale,locale);
 }
 async function country(countryCode) {
  await evaluate(call,`(() => {
   document.dispatchEvent(new CustomEvent('dlkt:country-detected',{detail:${JSON.stringify({countryCode,estimated:true})}}));return true;
  })()`);
 }
 async function city(restored=false) {
  await evaluate(call,`(() => {
   document.dispatchEvent(new CustomEvent('dlkt:city-selected',{detail:${JSON.stringify({city:fixture.city,estimated:false,restored})}}));return true;
  })()`);
 }
 try {
  await visit(origin+'/','ro',null);
  await country('FR');await expect('fr',null);
  await city();await expect('fr',null);
  await city(true);await expect('fr',null);
  await country('DE');await expect('de',null);

  await choose('en');
  await visit(origin+'/?lang=ro&country=FR#reading','en','en');
  await reload('en');
  await country('RO');await city();await expect('en','en');

  await choose('ro');
  await visit(origin+'/?lang=en&country=DE#reading','ro','ro');
  await reload('ro');
  await country('FR');await city(true);await expect('ro','ro');
  await visit(origin+'/?lang=fr&lang=ar#reading','ro','ro');

  return {status:'LOCALE_PREFERENCE_BROWSER_PASS',automaticCountryDefault:true,
   manualCityPreservesLanguage:true,restoredCityPreservesLanguage:true,lateAutomaticHintRemainsUsable:true,
   manualEnglishOverridesConflictingUrl:true,manualRomanianOverridesConflictingUrl:true,
   malformedUrlCannotOverrideManual:true,realReloadPersistence:true,lateCountryCannotOverrideManual:true,
   scope:'Actual compiled locale controller and localStorage in an isolated Chromium context; country events are controlled fixtures. No translation, hosted account or live IP check.'};
 }finally{await isolated.close();}
}


/** Browser-only checks follow, without changing, the private owner-header gates. */
async function verifyWalletSavedNavigation(call,origin,fixture,personal,savedLink,outputDir,openIsolated){
 assert.equal(personal.active,false,'private transport is deactivated before public-reader navigation');
 assert.equal(savedLink.href,'/#saved');
 const writesBefore=personal.writes.length;
 const memoryExpression='(async function(){const {DeviceMemory}=await import("/device-memory.js");const m=new DeviceMemory();return {device:await m.read(),daily:await m.readDaily(),checkpoint:await m.readCheckpoint()};})()';
 const readMemory=target=>evaluate(target,memoryExpression);
 const click=async(target,selector)=>{await focusSelector(target,selector);await keyboard(target,'Enter');};
 const waitSaved=async(target,id=null)=>{
  for(let attempt=0;attempt<60;attempt++){
   const state=await evaluate(target,'(function(){const button=document.querySelector("[data-view=saved]"),root=document.getElementById("topic-workspace");return {view:document.body.dataset.entryView,visible:Boolean(root&&!root.hidden),saved:button?.getAttribute("aria-pressed"),heading:document.getElementById("result-heading")?.textContent,active:document.activeElement?.id,ids:[...document.querySelectorAll("#cards [data-card-id],#cards [data-related-card-id]")].map(n=>n.dataset.cardId??n.dataset.relatedCardId)};})()');
   if(state.view==='topics'&&state.visible&&state.saved==='true'&&state.heading==='Saved in this browser'&&state.active==='result-heading'&&(id===null||state.ids.includes(id)))return state;
   if(attempt===59)throw Error('DLKT_SAVED_VIEW_TIMEOUT_'+JSON.stringify(state));await pause(100);
  }
 };
 const publicSnapshot=await fixture.response(new URL(origin+'/api/iceo'));
 assert.equal(publicSnapshot.status,200);
 const other=publicSnapshot.value.cards.find(card=>card.id!==savedLink.id);
 assert.ok(other,'a distinct public original is available as an isolation control');
 // Disposable QA setup only; the target card came from the actual Wallet Save.
 await evaluate(call,'(async function(seed){const {DeviceMemory}=await import("/device-memory.js");const m=new DeviceMemory();await m.save(seed.card);await m.remember({topics:["science"],query:"controlled saved-navigation focus",budget:1,mode:"briefing"});if(await m.readCheckpoint()===null)await m.saveCheckpoint(seed.snapshot,null);return true;})('+JSON.stringify({card:other,snapshot:publicSnapshot.value})+')');
 const before=await readMemory(call);
 assert.ok(before.device.cards.some(card=>card.id===savedLink.id));
 assert.ok(before.device.cards.some(card=>card.id===other.id));
 assert.ok(before.device.focus&&before.daily&&before.checkpoint,'nonempty focus, DailyState and comparison controls are present');
 const walletLink=await evaluate(call,'(function(){const a=document.getElementById("wallet-saved");return {href:a?.getAttribute("href"),visible:Boolean(a&&a.getClientRects().length),target:a?.target};})()');
 assert.deepEqual(walletLink,{href:savedLink.href,visible:true,target:''},'the same Saved destination remains accessible in signed-out Wallet');
 await click(call,'#wallet-saved');await loaded(call);await waitSaved(call,savedLink.id);
 assert.equal(await evaluate(call,'location.pathname+location.hash'),savedLink.href,'the real Wallet link opens the Saved entry fragment');
 assert.equal(await evaluate(call,'document.activeElement?.id'),'result-heading','existing Saved behavior focuses its heading');
 assert.deepEqual(await readMemory(call),before,'opening Saved preserves all browser records');
 const originalUrl=await evaluate(call,'document.querySelector('+JSON.stringify('#cards [data-card-id="'+savedLink.id+'"] a.source-link')+')?.href??null');
 assert.equal(originalUrl,savedLink.sourceUrl,'the saved original retains its exact source link');
 await call('Page.reload',{ignoreCache:true});await loaded(call);await waitSaved(call,savedLink.id);
 assert.deepEqual(await readMemory(call),before,'direct fragment reload is read-only and survives remembered focus restoration');
 await emitVisualPreview(call,'wallet-saved',390);
 const screenshot='dlkt-wallet-saved-390.png';
 writeFileSync(join(outputDir,screenshot),Buffer.from((await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64'),{mode:0o600});
 await click(call,'#cards [data-save-card="'+savedLink.id+'"]');
 let after;
 for(let attempt=0;attempt<60;attempt++){
  after=await readMemory(call);if(!after.device.cards.some(card=>card.id===savedLink.id))break;
  if(attempt===59)throw Error('DLKT_SAVED_REMOVE_TIMEOUT');await pause(100);
 }
 const expected={...before,device:{...before.device,cards:before.device.cards.filter(card=>card.id!==savedLink.id)}};
 assert.deepEqual(after,expected,'explicit removal changes only the chosen public original');
 await call('Page.reload',{ignoreCache:true});await loaded(call);await waitSaved(call,other.id);
 assert.deepEqual(await readMemory(call),expected,'the removal persists after reload and leaves all other originals intact');
 const empty=await openIsolated();
 try{
  await empty.call('Emulation.setDeviceMetricsOverride',{width:320,height:750,deviceScaleFactor:1,mobile:true,scale:1});
  await empty.call('Page.navigate',{url:origin+'/#saved-extra'});await loaded(empty.call);
  assert.equal(await evaluate(empty.call,'document.body.dataset.entryView'),'start','a near-match fragment does not open Saved');
  const initial=await readMemory(empty.call);assert.deepEqual(initial.device.cards,[]);
  await empty.call('Page.navigate',{url:origin+savedLink.href});await waitSaved(empty.call);
  assert.deepEqual(await readMemory(empty.call),initial,'hashchange into an empty collection does not write memory');
  assert.equal(await evaluate(empty.call,'document.activeElement?.id'),'result-heading');
  assert.equal(await evaluate(empty.call,'document.getElementById("empty").hidden'),false,'the existing empty state is visible');
  await empty.call('Page.reload',{ignoreCache:true});await loaded(empty.call);await waitSaved(empty.call);
  assert.deepEqual(await readMemory(empty.call),initial,'an empty direct entry stays read-only');
  await empty.call('Page.navigate',{url:origin+'/#briefing-topic=science'});await pause(100);
  assert.equal(await evaluate(empty.call,'document.body.dataset.entryView'),'daily','shared-topic entry retains its existing view');
  await empty.call('Page.navigate',{url:origin+'/#org=teams&topics=science&query=controlled&cards=6'});await pause(100);
  assert.equal(await evaluate(empty.call,'document.body.dataset.entryView'),'topics','organization entry retains its existing view');
  assert.equal(await evaluate(empty.call,'document.getElementById("query").value'),'controlled');
  assert.equal(await evaluate(empty.call,'document.querySelector("[data-view=saved]").getAttribute("aria-pressed")'),'false');
 }finally{await empty.close();await call('Page.bringToFront');}
 assert.equal(personal.writes.length,writesBefore,'collection navigation never writes a private account profile');
 return {status:'WALLET_SAVED_NAVIGATION_PASS',confirmedLink:savedLink.href,actualWalletLink:true,originalSourceRetained:true,
  directEntryAndReload:true,hashchange:true,strictFragment:true,emptyCollection:true,removeOnlyChosenOriginal:true,
  otherRecordsUnchanged:true,sharedTopicAndOrganizationPreserved:true,screenshot,
  scope:'Actual compiled reader and IndexedDB in Chromium after the private fixture is deactivated. Other public records and nonempty comparison/focus are controlled test setup; no live account or source check.'};
}

async function run(){
 if(typeof WebSocket!=='function')throw Error('DLKT_UI_NODE_WEBSOCKET_UNAVAILABLE');
 const bin=process.env.DLKT_CHROME_BIN??'/usr/bin/google-chrome';
 if(!existsSync(bin))throw Error('DLKT_UI_CHROME_NOT_INSTALLED');
 const profile=mkdtempSync(join(process.env.RUNNER_TEMP??tmpdir(),'dlkt-ui-qa-'));
 const outputDir=join(process.env.RUNNER_TEMP??profile,'dlkt-ui-screenshots');
 mkdirSync(outputDir,{recursive:true});
 const fixture=await newsFixture();
 const personal=await personalProfileFixture(fixture),knowledge=await knowledgeDistributionFixture(),audience=await audienceChoiceFixture(),server=localServer(fixture,personal,knowledge,audience);
 let browser=null,ws=null;
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,HOST,resolve);});
  const binding=server.address();if(!binding||typeof binding==='string')throw Error('DLKT_UI_INVALID_SERVER');
  browser=spawn(bin,[
   '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',
   // Match headless desktop mouse capabilities used by Playwright's Chromium launcher.
   // https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromium.ts
   '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
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
  const knowledgeDistribution=await verifyKnowledgeDistribution({fixture:knowledge,origin:'http://'+HOST+':'+binding.port,openIsolated:()=>openIsolatedChrome(port),evaluate,loaded,focusSelector,keyboard,pause,outputDir});
  const audienceChoice=await verifyAudienceChoice({fixture:audience,origin:'http://'+HOST+':'+binding.port,openIsolated:()=>openIsolatedChrome(port),evaluate,loaded,pause});
  await cdp('Page.bringToFront');
  const observations=[];
  for(const f of formats){
   const previousLocalRequests=fixture.localRequests;
   await cdp('Emulation.setDeviceMetricsOverride',{width:f.width,height:f.height,deviceScaleFactor:f.dpr??1,mobile:f.mobile,scale:1});
   await cdp('Page.navigate',{url:'http://'+HOST+':'+binding.port+'/'});
   await loaded(cdp);await pause(400);
   await selectControlledEdition(cdp,fixture);
   if(f.width===440)await settleFixturePhotos(cdp);
   assert.ok(fixture.localRequests>previousLocalRequests,'each page loads the local fixture through the actual API path');
   await evaluate(cdp,'(()=>{window.scrollTo(0,0);return true;})()');
   const news=await measureReader(cdp,fixture);
   await emitVisualPreview(cdp,'top',f.width);
   writeFileSync(join(outputDir,'measured-'+f.width+'.json'),JSON.stringify(news,null,2)+'\n',{mode:0o600});
   try{assertReaderGeometry(news,f,fixture);assertReadingLayout(news,f,fixture);if(f.width===440)assertReadingDetails(news,f,{requireFallback:true});}catch(error){
    console.error('DLKT_READER_GEOMETRY_FAILURE',JSON.stringify({viewport:f.width,date:news.date,city:news.city,country:news.country,expectedCountry:news.expectedCountry,cityComplete:news.cityComplete,countryComplete:news.countryComplete,cityButton:news.cityButton,firstUsefulTop:news.firstUsefulTop,firstEditorialTop:news.firstEditorialTop,layout:news.layout,controls:news.controls.filter(c=>c.width<43.5||c.height<43.5),titles:news.titles.filter(t=>!t.fits),local:news.local,details:news.details}));
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
   const navigation=await verifyNavigation(cdp,f);
   if(navigation.compact)assert.equal(m.menu,true,'compact menu hidden at '+f.width+'px');
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
   await emitVisualPreview(cdp,'cards',f.width);
   try{
    const sourceLanguage=await verifyVisibleSourceLanguage(cdp,f);
    const disclosures=await verifyDisclosures(cdp,f,fixture);
    const night=[390,1440].includes(f.width)?await verifyNight(cdp,f,fixture,outputDir):null;
    const explore=f.width===440?await verifyExploreSurface(cdp,f,fixture):null;
    const typography=f.width===440?await verifyTypographyStress(cdp,f,fixture,outputDir):null;
    const titleLinks=f.width===1440?await verifyTitleLinkPresentation(cdp):null;
    const actionStates=f.width===1440?await verifyActionStates(cdp,f):null;
    const actionLocales=[390,1440].includes(f.width)?await verifyActionLocales(cdp,f):null;
    const readingUpdates=[390,1440].includes(f.width)?await verifyReadingUpdates(cdp,f,fixture,'http://'+HOST+':'+binding.port,outputDir):null;
    const ownedExposure=[390,1440].includes(f.width)?await verifyKnowledgeExposure(cdp,f,fixture,'http://'+HOST+':'+binding.port,outputDir):null;
    observations.push({viewport:f.width,devicePixelRatio:f.dpr??1,visualScale:news.details.visualScale,documentWidth:m.scroll,menuTested:navigation.compact,brandVisible:true,reducedMotion:true,screenshot,cardScreenshot,news,navigation,sourceLanguage,disclosures,night,explore,typography,titleLinks,actionStates,actionLocales,readingUpdates,ownedExposure});
   }catch(error){
    try{
     const failedImage=(await cdp('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data;
     if(typeof failedImage==='string')writeFileSync(join(outputDir,'failed-interaction-'+f.width+'.png'),Buffer.from(failedImage,'base64'),{mode:0o600});
    }catch{/* Preserve the original assertion if the browser itself is unavailable. */}
    throw error;
   }
  }
  const continuousLocal=await verifyInlineLocalFlow(cdp,'http://'+HOST+':'+binding.port,fixture,outputDir);
  const account=await verifyAccountSurfaces(cdp,'http://'+HOST+':'+binding.port,outputDir);
  const personalProfile=await verifyPersonalProfileFlow({call:cdp,origin:'http://'+HOST+':'+binding.port,
   fixture:personal,evaluate,loaded,focusSelector,keyboard,openIsolated:()=>openIsolatedChrome(port),outputDir,emitVisualPreview});
  const savedNavigation=await verifyWalletSavedNavigation(cdp,'http://'+HOST+':'+binding.port,fixture,personal,personalProfile.savedCardLink,outputDir,()=>openIsolatedChrome(port));
  const accountPreferences=await verifyAccountPreferencesFlow({call:cdp,origin:'http://'+HOST+':'+binding.port,fixture:personal,evaluate,loaded,focusSelector,keyboard,outputDir,emitVisualPreview,actionSpacingProbe,assertActionSpacing,contrastProbe,startTypographyStress,restoreTypographyStress});
  const authenticationEmail=await verifyAuthenticationEmailPreview({call:cdp,origin:'http://'+HOST+':'+binding.port,evaluate,loaded,outputDir,emitVisualPreview});
  const localePreference=await verifyLocalePreference({openIsolated:()=>openIsolatedChrome(port),
   origin:'http://'+HOST+':'+binding.port,fixture,personal});
  const result={version:'dlkt-info-offline-browser-smoke-3',status:'OFFLINE_BROWSER_PASS',
   scope:'local-built-reader-with-controlled-news-local-and-private-profile-transport',viewports:observations,knowledgeDistribution,audienceChoice,continuousLocal,account,personalProfile,savedNavigation,accountPreferences,authenticationEmail,localePreference,fixture:{storyCount:fixture.storyCount,articleTotal:fixture.articleTotal,groupOriginals:fixture.urls.length,sourceOnlyOriginals:fixture.sourceOnly.length,localCards:fixture.localIds.length,localContract:'currentLocalSnapshot'},
   limitations:['News pages use the actual service over controlled corpus fixtures. The additional private phase uses synthetic account identities; no external publisher request, hosted authentication, payment or production runtime availability is tested.',
    'The three grouped publisher headlines and four reviewed-source originals reproduce observed metadata; source-check and publication dates are controlled fixtures.',
    'Local weather and CMTEB records are synthetic controlled fixtures validated by the actual city/source contracts, not live operator or forecast checks.',
    'The 440px DPR 3 scenario is Chrome at visual scale 1. Font-size doubling is a test-only typography stress, not physical Safari zoom or Safari text autosizing.',
    'The original anonymous account-layout checks remain unchanged. The private Wallet and account-preference phases use synthetic loopback profiles; login, OTP delivery and hosted account isolation are not claimed as verified.',
    'Palette checks use actual computed card paints and visible text at 390 and 1440px. Existing body copy is measured where rendered; source-only articles are not given fabricated excerpts.',
    'One exact local-event reference serves a real synthetic PNG in the loopback fixture; other photo requests fail. Loaded and failed local-photo layouts are measured separately from live publisher image verification.',
    'Same-card update scenarios use controlled edition publication through the real page service and real refresh handler; no external publisher change is attested.',
    'Owned-card exposure runs at390 and1440px against20 distinct controlled stories. It verifies actual foreground dwell and local history, not actual reading, autonomous editorial generation or continuous source research.',
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

