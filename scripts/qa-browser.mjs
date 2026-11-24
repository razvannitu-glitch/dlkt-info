import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
 const [{NewsPageService,parseNewsPageRequest,parseNewsSourcesRequest},{article,epoch,CorpusMemoryStore,snapshot,hash},{cardContent},{findCity},{SPECIALIST_ROWS},{pressReviewCitation},{currentLocalSnapshot},{selectHomeLocal},{localReading}]=await Promise.all([
  import('../source/.build/src/iceo/news-page.js'),import('../source/tests/fixtures/news-corpus.mjs'),
  import('../source/.build/src/iceo/card-validation.js'),import('../source/.build/src/local/cities.js'),
  import('../source/tests/fixtures/romanian-specialists.mjs'),import('../source/.build/src/iceo/source-links.js'),
  import('../source/.build/src/local/contracts.js'),import('../source/.build/src/iceo/home-local.js'),import('../source/.build/src/local/presentation.js'),
 ]);
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
  const value={version:'dlkt-local-1',city,checkedAt,state:'partial',weatherState:'ready',transportState:'not-covered',
   cards:[forecast,utility],coverage:[{domain:'utilities',state:'partial',checkedAt,sourceUrl:cmtebUrl,
    note:'Controlled CMTEB browser fixture; not a complete or live city service check.'}]};
  assert.equal(currentLocalSnapshot(value,city,clock),true,'local browser fixture passes the actual source identity and freshness contract');
  assert.deepEqual(selectHomeLocal(value,city,clock).cards.map(card=>card.id),localIds,'the real homepage selector retains both utility kinds');
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
 const stored=epoch(cards,[],{now}),before=JSON.stringify(stored),service=new NewsPageService(new CorpusMemoryStore([stored]),'test-only-browser-qa-cursor-key-123456789012345678901234567890');
 const selected=await service.read({language:'ro',cityId:city.id,filter:'all',cursor:null,period:'recent',sourceScope:'all'});
 assert.equal(selected.articleTotal,9,'all nine originals are eligible before testing layout');
 assert.equal(selected.total,7,'three reports share one event; six distinct reports remain separate');
 const groups=selected.items.filter(item=>item.story?.sourceTotal===3);assert.equal(groups.length,1);
 const grouped=groups[0],groupOriginals=[{kind:grouped.kind,card:grouped.card},...grouped.story.related];
 assert.deepEqual(new Set(groupOriginals.map(item=>item.card.sourceUrl)),new Set(reports.map(card=>card.sourceUrl)));
 assert.equal(selected.items.some(item=>item.card.id===distinct.id),true,'the different penalty cannot be silently merged');
 assert.equal(selected.items.some(item=>item.card.id===english.id),true,'all-source scope must include the English original');
 assert.equal(JSON.stringify(stored),before,'the reader cannot restamp the stored evidence');
 return {city,estimatedCity:true,groupKey:grouped.story.key,urls:reports.map(card=>card.sourceUrl),titles:reports.map(card=>card.title),storyCount:selected.total,articleTotal:selected.articleTotal,sourceOnly,
  localIds,get localExpected(){return localExpected();},get localRequests(){return localRequests;},
  async response(url){
   if(url.pathname==='/api/places'&&url.searchParams.get('hint')==='1')return {status:200,value:{city,countryCode:city.countryCode,estimated:true}};
   if(url.pathname==='/api/places'&&url.searchParams.get('id')===city.id)return {status:200,value:{cities:[city],cityAliases:[]}};
   if(url.pathname==='/api/local'){
    if(url.searchParams.get('city')!==city.id)return {status:400,value:{error:'DLKT_QA_LOCAL_CITY_INVALID'}};
    servedLocal=localSnapshot(Date.now());localRequests++;return {status:200,value:servedLocal};
   }
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
 await evaluate(call,'(()=>{const picker=document.querySelector("#reader-language");picker.value="ro";picker.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
 for(let attempt=0;attempt<80;attempt++){
  const current=await evaluate(call,'(()=>{const root=document.querySelector("#discovery-cards");return {scope:root?.dataset.sourceScope,count:root?.querySelectorAll("article[data-news-stream-key]").length,city:document.querySelector("#glance-city-label")?.textContent,localIds:[...document.querySelectorAll("#home-local-cards article[data-local-id]")].map(card=>card.dataset.localId)};})()');
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
   sourceVisible:visible(source),sourceUrl:source?.href??'',sourceTarget:source?.target??'',sourceRel:source?.rel??'',
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
   toolbar:rect(document.querySelector('#home-news-toolbar')),filtersOpen:document.querySelector('#home-news-options')?.open??null,
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
  assert.equal(card.originalLabel,expected.originalLabel);assert.equal(card.originalUrl,expected.sourceUrl);
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
function assertReadingLayout(measured,format,fixture,{compact=true}={}){
 for(const title of measured.titles)assertFullTitle(title,'editorial title '+title.id+' at '+format.width+'px');
 assert.deepEqual(measured.localIds,fixture.localIds,'both real local fixture cards are present in homepage order');
 for(const expected of fixture.localExpected){
  const card=measured.local.find(value=>value.id===expected.id);assert.ok(card);
  assert.equal(card.found,true,'local fixture card is rendered');assertFullTitle(card.title,'local title '+card.id);
  assert.equal(card.title.text,expected.reading.title,'the production local reading title is retained');
  assert.equal(card.readingExists,true,'local information has an accessible disclosure');
  assert.equal(card.summaryVisible,true,'local reading action stays visible');
  assert.equal(card.sourceVisible,true,'official source action stays outside collapsed details');
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
  if(format.width===320)assert.ok(measured.firstUsefulTop<=620,'first useful card must begin within 620px at 320px: '+measured.firstUsefulTop);
  if(format.width===390){
   assert.ok(measured.firstUsefulTop<=550,'first useful card must begin within 550px at 390px: '+measured.firstUsefulTop);
   assert.ok(measured.firstEditorialTop!==null&&measured.firstEditorialTop<=1100,'first editorial follows two compact utilities within 1100px: '+measured.firstEditorialTop);
  }
  assert.ok(measured.local.every(card=>card.bottom<=measured.firstEditorialTop+1),'the two local utilities precede the editorial feed');
 }
}
function expectedReader(fixture){
 return {city:fixture.city,estimatedCity:fixture.estimatedCity,groupKey:fixture.groupKey,urls:fixture.urls,titles:fixture.titles,sourceOnly:fixture.sourceOnly,localExpected:fixture.localExpected};
}
async function measureReader(call,fixture){
 return evaluate(call,'('+readerProbe.toString()+')('+JSON.stringify(expectedReader(fixture))+')');
}
async function keyboard(call,key){
 const code={Enter:13,Escape:27,Tab:9}[key];assert.ok(code,'only the tested keyboard actions are used');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});
 await call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});
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
 await keyboard(call,'Tab');
 assert.equal(await evaluate(call,"Boolean(document.activeElement?.closest('#header-navigation'))"),true,'Tab reaches another navigation action');
 await keyboard(call,'Escape');
 assert.equal(await evaluate(call,"document.getElementById('header-menu').getAttribute('aria-expanded')"),'false','Escape closes the menu');
 assert.equal(await evaluate(call,"document.activeElement===document.getElementById('header-menu')"),true,'Escape restores focus to the menu control');
 await evaluate(call,'(()=>{window.scrollTo(0,0);return true;})()');return {compact:true,keyboard:true};
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
 assert.ok(expanded.controls.some(control=>control.id==='home-news-source-scope'),'source-scope control is available in the open filters');
 // Leaving the non-modal filter panel must not strand focus under its overlay.
 await focusSelector(call,'#home-news-english');await keyboard(call,'Tab');
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
  assertReaderGeometry(await measureReader(call,fixture),format,fixture);
  await toggleDetails(call,provenance,false);
  await toggleDetails(call,selector,false);local.push({id:expected.id,paragraphs:details.paragraphs.length,evidence:true});
 }
 const groupSelector='#discovery-cards article[data-story-key="'+fixture.groupKey+'"] .news-story-sources';
 const sourcesWereOpen=await evaluate(call,'document.querySelector('+JSON.stringify(groupSelector)+')?.open');
 if(sourcesWereOpen===true)await toggleDetails(call,groupSelector,false);
 await toggleDetails(call,groupSelector,true);
 const originals=await evaluate(call,'('+expandedSourcesProbe.toString()+')('+JSON.stringify(fixture.groupKey)+')');
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
function contrastProbe(){
 const rgba=value=>{
  const match=/^rgba?\(([^)]+)\)$/u.exec(value);if(!match)return null;
  const parts=match[1].split(/[,\s/]+/u).filter(Boolean).map(Number);
  return parts.length>=3&&parts.every(Number.isFinite)?[parts[0],parts[1],parts[2],parts[3]??1]:null;
 };
 const blend=(front,back)=>front.slice(0,3).map((channel,index)=>channel*front[3]+back[index]*(1-front[3]));
 const luminance=color=>color.map(channel=>{const c=channel/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((value,c,index)=>value+c*[.2126,.7152,.0722][index],0);
 const background=node=>{
  const ancestors=[];for(let current=node;current;current=current.parentElement)ancestors.push(current);
  let result=[255,255,255];for(const current of ancestors.reverse()){const color=rgba(getComputedStyle(current).backgroundColor);if(!color)return null;result=blend(color,result);}return result;
 };
 const card=document.querySelector('#discovery-cards article[data-news-stream-key]');
 const nodes=[...new Set(card?.querySelectorAll('h3,.publisher-citation,.card-publisher,.card-date,[data-original-language],.card-actions .source-link')??[])].filter(node=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden');
 return {theme:document.documentElement.dataset.readerTheme,page:background(document.body),
  samples:nodes.map(node=>{
   const style=getComputedStyle(node),foreground=rgba(style.color),back=background(node);
   const fontSize=parseFloat(style.fontSize),weight=parseInt(style.fontWeight,10),large=fontSize>=24||(fontSize>=18.66&&weight>=700);
   const painted=foreground&&back?blend(foreground,back):null,a=painted?luminance(painted):null,b=back?luminance(back):null;
   return {tag:node.tagName,className:node.className,text:node.textContent?.slice(0,100),foreground:style.color,background:back,
    ratio:a!==null&&b!==null?(Math.max(a,b)+.05)/(Math.min(a,b)+.05):null,minimum:large?3:4.5};
  })};
}
async function verifyNight(call,format,fixture,outputDir){
 const before=await evaluate(call,'('+contrastProbe.toString()+')()');assert.equal(before.theme,'prism','day layout is the baseline');
 await focusSelector(call,'#reader-theme-toggle');await keyboard(call,'Enter');
 await evaluate(call,'(()=>{window.scrollTo(0,0);return true;})()');
 const measured=await measureReader(call,fixture);assertReaderGeometry(measured,format,fixture);assertReadingLayout(measured,format,fixture);
 const contrast=await evaluate(call,'('+contrastProbe.toString()+')()');
 assert.equal(contrast.theme,'night');assert.notDeepEqual(contrast.page,before.page,'night changes the effective computed page background');
 assert.ok(contrast.samples.length>=3,'night reads actual title, attribution and action colors');
 for(const sample of contrast.samples)assert.ok(sample.ratio!==null&&sample.ratio+.01>=sample.minimum,'night text contrast falls below its readable threshold: '+JSON.stringify(sample));
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
 return {contrast,screenshots};
}

/** Small fixture-only previews make visual review possible without downloading the ZIP.
 * Full-resolution PNGs remain in the normal artifact. Four bounded JPEGs at most.
 */
async function emitVisualPreview(call,label,width){
 const selected=(label==='top'&&[390,1440].includes(width))||(width===390&&['cards','night-top'].includes(label));
 if(!selected)return;
 const data=(await call('Page.captureScreenshot',{format:'jpeg',quality:72,fromSurface:true,captureBeyondViewport:false})).data;
 if(typeof data!=='string'||data.length<1000||data.length>160000){console.log('DLKT_UI_VISUAL_SKIPPED',label,width);return;}
 const bytes=Buffer.from(data,'base64'),sha256=createHash('sha256').update(bytes).digest('hex'),chunks=Math.ceil(data.length/4096);
 console.log('DLKT_UI_VISUAL_BEGIN '+JSON.stringify({label,width,encoding:'base64',mimeType:'image/jpeg',bytes:bytes.length,sha256,chunks}));
 for(let i=0;i<chunks;i++)console.log('DLKT_UI_VISUAL_CHUNK '+String(i+1).padStart(4,'0')+' '+data.slice(i*4096,(i+1)*4096));
 console.log('DLKT_UI_VISUAL_END '+sha256);
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
   const previousLocalRequests=fixture.localRequests;
   await cdp('Emulation.setDeviceMetricsOverride',{width:f.width,height:f.height,deviceScaleFactor:1,mobile:f.mobile,scale:1});
   await cdp('Page.navigate',{url:'http://'+HOST+':'+binding.port+'/'});
   await loaded(cdp);await pause(400);
   await selectControlledEdition(cdp,fixture);
   assert.ok(fixture.localRequests>previousLocalRequests,'each page loads the local fixture through the actual API path');
   await evaluate(cdp,'(()=>{window.scrollTo(0,0);return true;})()');
   const news=await measureReader(cdp,fixture);
   await emitVisualPreview(cdp,'top',f.width);
   writeFileSync(join(outputDir,'measured-'+f.width+'.json'),JSON.stringify(news,null,2)+'\n',{mode:0o600});
   try{assertReaderGeometry(news,f,fixture);assertReadingLayout(news,f,fixture);}catch(error){
    console.error('DLKT_READER_GEOMETRY_FAILURE',JSON.stringify({viewport:f.width,date:news.date,city:news.city,country:news.country,expectedCountry:news.expectedCountry,cityComplete:news.cityComplete,countryComplete:news.countryComplete,cityButton:news.cityButton,firstUsefulTop:news.firstUsefulTop,firstEditorialTop:news.firstEditorialTop,layout:news.layout,controls:news.controls.filter(c=>c.width<43.5||c.height<43.5),titles:news.titles.filter(t=>!t.fits),local:news.local}));
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
    const disclosures=await verifyDisclosures(cdp,f,fixture);
    const night=[390,1440].includes(f.width)?await verifyNight(cdp,f,fixture,outputDir):null;
    observations.push({viewport:f.width,documentWidth:m.scroll,menuTested:navigation.compact,brandVisible:true,reducedMotion:true,screenshot,cardScreenshot,news,navigation,disclosures,night});
   }catch(error){
    try{
     const failedImage=(await cdp('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data;
     if(typeof failedImage==='string')writeFileSync(join(outputDir,'failed-interaction-'+f.width+'.png'),Buffer.from(failedImage,'base64'),{mode:0o600});
    }catch{/* Preserve the original assertion if the browser itself is unavailable. */}
    throw error;
   }
  }
  const result={version:'dlkt-info-offline-browser-smoke-2',status:'OFFLINE_BROWSER_PASS',
   scope:'local-built-reader-with-controlled-news-and-local-corpus',viewports:observations,fixture:{storyCount:fixture.storyCount,articleTotal:fixture.articleTotal,groupOriginals:fixture.urls.length,sourceOnlyOriginals:fixture.sourceOnly.length,localCards:fixture.localIds.length,localContract:'currentLocalSnapshot'},
   limitations:['News pages use the actual service over controlled corpus fixtures; no external publisher request, authenticated user, payment or production runtime availability is tested.',
    'The three grouped publisher headlines and four reviewed-source originals reproduce observed metadata; source-check and publication dates are controlled fixtures.',
    'Local weather and CMTEB records are synthetic controlled fixtures validated by the actual city/source contracts, not live operator or forecast checks.',
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

