import test from 'node:test';
import assert from 'node:assert/strict';
import {setupGlance} from '../.build/src/glance/browser.js';
import {keyThing,currentLocalCards,forecastRange} from '../.build/src/glance/presentation.js';
import {GLANCE_VERSION,eligiblePublication,validGlance} from '../.build/src/glance/contracts.js';
import {sourceLanguage} from '../.build/src/iceo/news-sources.js';
import {findCity} from '../.build/src/local/cities.js';
import {currentLocalSnapshot} from '../.build/src/local/contracts.js';
import {CITY_NEWS_FEEDS} from '../.build/src/local/news-policy.js';
import {parseLocalNews} from '../.build/src/local/news-service.js';
import {newsCard} from '../.build/src/local/service.js';
import {weatherCard} from '../.build/src/local/weather.js';

const now=Date.parse('2026-11-22T12:00:00.000Z'),checkedAt=new Date(now).toISOString(),city=findCity('683506');
const originalTitle='Bucuresti: Metrorex publica programul magistralei 6';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function localFixture(){
 const source=CITY_NEWS_FEEDS.find(feed=>feed.id==='bucharest-b365');
 const xml='<rss><channel><title>B365</title><link>https://b365.ro/</link><item><title>'+originalTitle+'</title><link>https://b365.ro/ticker-language-control-123456/</link><pubDate>'+new Date(now-3600000).toUTCString()+'</pubDate></item></channel></rss>';
 const parsed=parseLocalNews(xml,source.id,city,checkedAt,now);assert.equal(parsed.rejected,0);assert.equal(parsed.articles.length,1);
 const start=Math.ceil(now/3600000)*3600000;
 const payload={type:'Feature',geometry:{coordinates:[city.lon,city.lat]},properties:{meta:{updated_at:checkedAt,units:{air_temperature:'celsius',wind_speed:'m/s',precipitation_amount:'mm'}},timeseries:Array.from({length:7},(_,index)=>({time:new Date(start+index*3600000).toISOString(),data:{instant:{details:{air_temperature:7,wind_speed:1}},next_1_hours:{details:{precipitation_amount:0}}}}))}};
 const forecast=weatherCard(payload,city,checkedAt,now);
 const snapshot=freeze({version:'dlkt-local-1',city,checkedAt,state:'partial',weatherState:'ready',transportState:'not-covered',
  cards:[forecast,...parsed.articles.map(article=>newsCard(article,city))],
  newsSources:CITY_NEWS_FEEDS.map(feed=>({sourceId:feed.id,publisher:feed.publisher,feedUrl:feed.endpoint,termsUrl:feed.termsUrl,state:'ready',checkedAt,count:parsed.articles.filter(article=>article.sourceId===feed.id).length,rejected:0,error:null}))});
 assert.equal(currentLocalSnapshot(snapshot,city,now),true);return snapshot;
}
function officialPublications(){
 return freeze([
  ['nasa-news','NASA','science','https://www.nasa.gov/news-release/ticker-language-fixture/'],
  ['usgs-news','U.S. Geological Survey','environment','https://www.usgs.gov/news/national-news-release/ticker-language-fixture'],
  ['fda-news','U.S. Food and Drug Administration','health','https://www.fda.gov/news-events/press-announcements/ticker-language-fixture'],
  ['govuk-news','UK Government','public-affairs','https://www.gov.uk/government/news/ticker-language-fixture'],
 ].map(([sourceId,publisher,topic,sourceUrl],index)=>({
  id:(index+1).toString(16).padStart(24,'0'),identity:'glance-language:'+sourceId,title:publisher+' controlled publication',
  topic,kind:'publication',sourceUrl,publisher,sourceIds:[sourceId],date:new Date(now-3600000).toISOString(),dateLabel:'Published',
  observedAt:checkedAt,contentHash:(index+1).toString(16).padStart(64,'0'),boundary:'Controlled publisher fixture.',
  deadline:null,version:null,attribution:publisher,sourceState:'verified',
 })));
}

test('ticker chooses the original Romanian news only for a matching reader language without renewing evidence',()=>{
 const local=localFixture(),before=JSON.stringify(local),original=local.cards.find(card=>card.kind==='local-news');
 const ro=keyThing([],local,city,[],now,city.timezone,'ro');
 assert.equal(ro.kind,'local-news');assert.strictEqual(ro.news,original);assert.equal(ro.title,originalTitle);
 assert.strictEqual(keyThing([],local,city,[],now,city.timezone,'ro-RO').news,original);
 assert.equal(keyThing([],local,city,[],now,city.timezone,'en'),null);
 assert.equal(keyThing([],local,city,[],now,city.timezone,'fr'),null);
 assert.equal(keyThing([],local,city,[],now+300000,city.timezone,'ro'),null);
 const forecast=currentLocalCards(local,city,now).find(card=>card.kind==='forecast');assert.ok(forecastRange(forecast));
 assert.equal(original.checkedAt,checkedAt);assert.equal(original.news.checkedAt,checkedAt);assert.equal(JSON.stringify(local),before);
});

test('eligible glance publishers with unknown language are not silently treated as English fallback',()=>{
 const records=officialPublications(),before=JSON.stringify(records);
 for(const record of records){
  assert.equal(eligiblePublication(record,now),true,record.publisher);
  assert.equal(sourceLanguage(record),null,record.publisher);
  assert.strictEqual(keyThing([record],null,null,[record.topic],now,'UTC').publication,record,'legacy eligibility remains independently exercised');
  for(const language of ['en','ro'])assert.equal(keyThing([record],null,null,[record.topic],now,'UTC',language),null,record.publisher+' / '+language);
 }
 assert.equal(keyThing(records,null,city,['science','environment','health','public-affairs'],now,city.timezone,'en'),null);
 const malformed={...records[0],sourceUrl:undefined};assert.equal(eligiblePublication(malformed,now),false);
 assert.equal(keyThing([malformed],null,null,['science'],now,'UTC','en'),null,'invalid evidence is rejected before reading its language provenance');
 assert.equal(JSON.stringify(records),before);
});

// Narrow DOM/event fixture for the real controller, ticker and drawer. It performs no visual QA.
class ElementFixture extends EventTarget {
 constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.id='';this.className='';this.dataset={};this.attributes=new Map();this.children=[];this.parentElement=null;this.copy='';this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.open=false;this.clientWidth=320;}
 get textContent(){return this.copy+this.children.map(child=>child.textContent).join('');}
 set textContent(value){this.copy=String(value);for(const child of this.children)child.parentElement=null;this.children=[];}
 get isConnected(){return this===document.body||this===document.documentElement||Boolean(this.parentElement?.isConnected);}
 append(...nodes){for(const child of nodes){child.parentElement=this;this.children.push(child);}}
 replaceChildren(...nodes){this.textContent='';this.append(...nodes);}
 setAttribute(name,value){this.attributes.set(name,String(value));if(name==='class')this.className=String(value);}
 getAttribute(name){return this.attributes.get(name)??null;}
 matches(selector){if(selector==='dialog[open]')return this.tagName==='DIALOG'&&this.open;if(selector.startsWith('.'))return this.className.split(/\s+/u).includes(selector.slice(1));if(selector===':focus-visible')return false;return this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 contains(target){return this===target||this.children.some(child=>child.contains(target));}
 cloneNode(deep=false){const node=new ElementFixture(this.tagName);node.className=this.className;node.copy=this.copy;node.dataset={...this.dataset};if(deep)node.append(...this.children.map(child=>child.cloneNode(true)));return node;}
 getBoundingClientRect(){return{top:0,bottom:100,width:500,height:100};}
 getClientRects(){return[this.getBoundingClientRect()];}
 animate(){return{currentTime:0,pause(){},play(){},cancel(){}};}
 focus(){document.activeElement=this;}
 click(){this.dispatchEvent(new Event('click'));}
 showModal(){this.open=true;}
 close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
class CustomEventFixture extends Event {constructor(type,options={}){super(type,options);this.detail=options.detail;}}
async function harness(t){
 const previous=new Map();
 const install=(name,value)=>{previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});};
 const doc=new EventTarget();doc.documentElement=new ElementFixture('html');doc.body=new ElementFixture('body');doc.documentElement.append(doc.body);doc.body.dataset.entryView='start';doc.visibilityState='hidden';
 const names=['today-glance','glance-customize','glance-detail','glance-detail-body','glance-status','glance-refresh','glance-list','glance-read','glance-weather','glance-forex','glance-key','glance-headsup','glance-detail-title','glance-date','glance-zone','glance-city','glance-weather-value','glance-weather-note','glance-forex-value','glance-forex-note','glance-key-value','glance-key-note','glance-empty','glance-show-weather','glance-show-forex','glance-show-key','glance-currency','glance-save-status','glance-customize-open','glance-customize-close','glance-detail-close','glance-list-close','glance-preferences','entry-show-city','choose-place','glance-ticker-viewport','glance-ticker-track','glance-screen-summary'];
 const dialogs=new Set(['glance-customize','glance-detail','glance-list']),ids=new Map(names.map(id=>{const node=new ElementFixture(dialogs.has(id)?'dialog':'div');node.id=id;doc.body.append(node);return[id,node];}));
 doc.getElementById=id=>ids.get(id)??null;doc.createElement=tag=>new ElementFixture(tag);doc.createElementNS=(_namespace,tag)=>new ElementFixture(tag);
 doc.querySelectorAll=selector=>doc.body.querySelectorAll(selector);doc.querySelector=selector=>doc.querySelectorAll(selector)[0]??null;
 const win=new EventTarget();win.location=new URL('https://www.dlkt.ee/?lang=ro');
 const requests=[],writes=[];
 const fx=freeze({checkedAt,date:'2026-11-20',previousDate:'2026-11-19',rates:{USD:1.1,RON:5.2},previousRates:{USD:1.09,RON:5.19}});
 const publicSnapshot=freeze({version:GLANCE_VERSION,generatedAt:checkedAt,forex:fx,publications:officialPublications()});
 assert.equal(validGlance(publicSnapshot,now),true);
 const fetch=async(url,options)=>{requests.push({url,options});assert.equal(url,'/api/glance');return{ok:true,text:async()=>JSON.stringify(publicSnapshot)};};
 const storage={getItem:()=>null,setItem:(...args)=>writes.push(['set',...args]),removeItem:(...args)=>writes.push(['remove',...args])};
 class OptionFixture extends ElementFixture {constructor(text,value){super('option');this.textContent=text;this.value=value;}}
 for(const [name,value] of Object.entries({document:doc,window:win,navigator:{languages:['en-GB'],language:'en-GB'},localStorage:storage,fetch,
  HTMLElement:ElementFixture,Element:ElementFixture,Node:ElementFixture,CustomEvent:CustomEventFixture,Option:OptionFixture,innerHeight:800,
  matchMedia:()=>({matches:false,addEventListener(){}}),ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}},
  requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{}}))install(name,value);
 const originalNow=Date.now;Date.now=()=>now;
 t.after(async()=>{win.dispatchEvent(new Event('pagehide'));await tick();Date.now=originalNow;for(const [name,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 setupGlance();await tick();
 return{doc,win,ids,requests,writes,
  selectLocal(snapshot){doc.dispatchEvent(new CustomEventFixture('dlkt:city-selected',{detail:{city,restored:false,estimated:true}}));doc.dispatchEvent(new CustomEventFixture('dlkt:local-snapshot',{detail:{city,snapshot}}));},
  language(locale){win.location.searchParams.set('lang',locale);doc.dispatchEvent(new CustomEventFixture('dlkt:language-changed',{detail:{locale}}));}};
}

test('RO to EN to RO updates the ticker and an open drawer without another request or changing weather and currency',async t=>{
 const h=await harness(t),local=localFixture(),before=JSON.stringify(local);
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.credentials,'omit');
 h.selectLocal(local);
 const value=id=>h.ids.get(id).textContent;
 assert.equal(value('glance-key-value'),originalTitle);assert.ok(value('glance-screen-summary').includes(originalTitle));
 const weather=value('glance-weather-value'),currency=value('glance-forex-value');assert.notEqual(weather,'Unavailable');assert.match(currency,/RON/u);
 h.ids.get('glance-key').click();assert.equal(h.ids.get('glance-detail').open,true);assert.equal(value('glance-detail-title'),originalTitle);
 h.language('en');await tick();
 assert.equal(value('glance-key-value'),'No current item available');assert.ok(!value('glance-screen-summary').includes(originalTitle));
 assert.notEqual(value('glance-detail-title'),originalTitle);assert.ok(!value('glance-detail-body').includes(originalTitle));
 assert.match(value('glance-detail-body'),/No recent item/u);assert.equal(h.ids.get('glance-detail').open,true);
 assert.equal(value('glance-weather-value'),weather);assert.equal(value('glance-forex-value'),currency);
 h.language('ro');await tick();
 assert.equal(value('glance-key-value'),originalTitle);assert.equal(value('glance-detail-title'),originalTitle);assert.ok(value('glance-screen-summary').includes(originalTitle));
 assert.equal(value('glance-weather-value'),weather);assert.equal(value('glance-forex-value'),currency);
 assert.equal(h.requests.length,1,'language changes only reproject existing evidence');assert.deepEqual(h.writes,[]);assert.equal(JSON.stringify(local),before);
});
