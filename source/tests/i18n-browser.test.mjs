import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {parseDocument,DomUtils} from 'htmlparser2';
import {MESSAGES,messageParameters} from '../.build/src/i18n/catalog.js';
import {t as localize} from '../.build/src/i18n/locale.js';
import {applyInterfaceLanguage,setupLanguage,getLocale} from '../.build/src/i18n/browser.js';
import {initializeCountryLanguage} from '../.build/src/i18n/country-hint.js';
const read=path=>readFileSync(path,'utf8');

test('existing photo badges update across all30 locales and retain only the reviewed archive year',t=>{
 const originals=new Map(['window','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 t.after(()=>{for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 const archive={dataset:{i18n:'photoArchiveLabel',i18nYear:'2018'},textContent:'Archive photo · 2018'};
 const editorial={dataset:{i18n:'photoEditorialLabel'},textContent:'Illustrative photo'};
 const invalid={dataset:{i18n:'photoArchiveLabel',i18nYear:'<script>'},textContent:'Retained label'};
 const root={documentElement:{dataset:{}},getElementById:()=>null,querySelectorAll:selector=>selector==='[data-i18n]'?[archive,editorial,invalid]:[]};
 Object.defineProperty(globalThis,'document',{configurable:true,value:root});
 const location={href:'https://www.dlkt.ee/?lang=en'};Object.defineProperty(globalThis,'window',{configurable:true,value:{location}});
 for(const locale of Object.keys(MESSAGES)){
  location.href='https://www.dlkt.ee/?lang='+locale;applyInterfaceLanguage(root);
  assert.equal(archive.textContent,localize(locale,'photoArchiveLabel',{year:'2018'}),locale);
  assert.equal(editorial.textContent,localize(locale,'photoEditorialLabel'),locale);
  assert.equal(invalid.textContent,'Retained label');assert.equal(archive.dataset.i18nYear,'2018');
 }
});

test('every explicitly translated HTML interface binding exists and requires no unprovided parameters',()=>{
 const doc=parseDocument(read('public/iceo.html'));
 const nodes=DomUtils.findAll(node=>node.type==='tag',doc.children);
 for(const node of nodes){
  for(const name of ['data-i18n','data-i18n-label','data-i18n-placeholder']){
   const key=node.attribs?.[name];if(!key)continue;
   assert.ok(Object.hasOwn(MESSAGES.en,key),`${name}=${key}`);assert.deepEqual(messageParameters(MESSAGES.en[key]),[]);
  }
 }
 const picker=nodes.find(node=>node.attribs?.id==='reader-language');assert.equal(picker?.name,'select');
 assert.ok(nodes.find(node=>node.name==='label'&&node.attribs?.for==='reader-language'));
});

test('all locale modules are compiled exactly and the curated public import graph resolves',()=>{
 for(const name of ['catalog','locale','browser','reading-messages','media-messages','country-hint']){
  const compiled=read(`.build/src/i18n/${name}.js`).replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll('../iceo/','./').replaceAll("'./reading-messages.js'","'./i18n-reading-messages.js'").replaceAll("'./media-messages.js'","'./i18n-media-messages.js'").replaceAll("'./catalog.js'","'./i18n-catalog.js'").replaceAll("'./locale.js'","'./i18n-locale.js'");
  const js=read(`public/i18n-${name}.js`);assert.equal(js,compiled);
  assert.doesNotMatch(js,/from\s*['"](?:node:|\.\.\/)|innerHTML|outerHTML|eval\s*\(/u);
  for(const match of js.matchAll(/from\s*['"]\.\/([^'"]+\.js)['"]/gu))assert.ok(existsSync('public/'+match[1]));
 }
});

test('language presentation stores only its manual preference without network side effects or source translation',()=>{
 const js=read('src/i18n/browser.ts');assert.doesNotMatch(js,/sessionStorage|indexedDB|document\.cookie|fetch\(|sendBeacon|navigator\.geolocation/u);
 assert.match(js,/const LANGUAGE_STORAGE_KEY='dlkt-reader-language-v1'/u);
 assert.match(js,/window\.localStorage\.getItem\(LANGUAGE_STORAGE_KEY\)/u);
 assert.match(js,/window\.localStorage\.setItem\(LANGUAGE_STORAGE_KEY,locale\)/u);
 assert.doesNotMatch(js,/localStorage\.(?:removeItem|clear)|JSON\.parse/u);
 assert.match(js,/history\.pushState/u);assert.match(js,/document\.documentElement\.dir/u);assert.match(js,/popstate/u);
 const main=read('src/iceo/browser.ts');assert.match(main,/element\.dir='auto'/u);assert.match(main,/element\.setAttribute\('translate','no'\)/u);assert.match(main,/originalText\(detail\)/u);assert.match(main,/originalText\(a,item\)/u);
 assert.doesNotMatch(main,/tr\(card\.(?:title|summary)/u);
});

class LanguageTarget{
 listeners=new Map();
 addEventListener(type,callback){const list=this.listeners.get(type)??[];list.push(callback);this.listeners.set(type,list);}
 dispatchEvent(event){for(const callback of this.listeners.get(event.type)??[])callback(event);return true;}
}
class LanguageEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}}
class LanguagePicker extends LanguageTarget{value='';children=[];append(...nodes){this.children.push(...nodes);}}
function replaceGlobals(t,values){
 const previous=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 t.after(()=>{for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
}
function languageHarness(t,{href='https://www.dlkt.ee/account?returnTo=wallet',saved=null,languages=['en-US'],blockedStorage=false}={}){
 const picker=new LanguagePicker(),events=[],reads=[],writes=[],historyCalls=[],stored=new Map();
 if(saved!==null)stored.set('dlkt-reader-language-v1',saved);
 const document=Object.assign(new LanguageTarget(),{documentElement:{dataset:{},lang:'',dir:''},
  getElementById:id=>id==='reader-language'?picker:null,createElement:()=>({}),querySelectorAll:()=>[]});
 const dispatch=document.dispatchEvent.bind(document);document.dispatchEvent=event=>{events.push(event);return dispatch(event);};
 const location={href};
 const history={pushState(state,title,url){historyCalls.push({state,title,url});location.href=new URL(url,location.href).href;}};
 const window=Object.assign(new LanguageTarget(),{location,history,localStorage:{
  getItem(key){reads.push(key);if(blockedStorage)throw Error('storage blocked');return stored.get(key)??null;},
  setItem(key,value){if(blockedStorage)throw Error('storage blocked');writes.push([key,value]);stored.set(key,value);}
 }});
 replaceGlobals(t,{document,window,history,navigator:{languages,language:languages[0]??'en'},HTMLSelectElement:LanguagePicker,CustomEvent:LanguageEvent});
 return {document,window,picker,events,reads,writes,historyCalls,stored,
  choose(locale){picker.value=locale;picker.dispatchEvent(new LanguageEvent('change'));},
  country(countryCode){document.dispatchEvent(new LanguageEvent('dlkt:country-detected',{detail:{countryCode,estimated:true}}));},
  countryEvents(){return events.filter(event=>event.type==='dlkt:country-detected');}};
}
function countryClock(t,window){
 let next=0;const pending=new Map(),scheduled=[],cleared=[];
 const setTimeout=(callback,milliseconds)=>{const id=++next;pending.set(id,callback);scheduled.push({id,milliseconds});return id;};
 const clearTimeout=id=>{cleared.push(id);pending.delete(id);};
 replaceGlobals(t,{setTimeout,clearTimeout});window.setTimeout=setTimeout;window.clearTimeout=clearTimeout;
 return {pending,scheduled,cleared,fire(){const first=pending.entries().next().value;assert.ok(first,'country timer missing');pending.delete(first[0]);first[1]();}};
}
const countryEncoder=new TextEncoder();
function countryResponse(payload,{status=200,contentType='application/json',contentLength=null,chunks}={}){
 const bytes=typeof payload==='string'?countryEncoder.encode(payload):payload;
 const parts=chunks??[bytes],stats={reads:0,cancels:0,releases:0,bodyCancels:0};let index=0;
 const reader={async read(){stats.reads++;return index<parts.length?{done:false,value:parts[index++]}:{done:true,value:undefined};},
  async cancel(){stats.cancels++;},releaseLock(){stats.releases++;}};
 const headers=new Headers();if(contentType!==null)headers.set('content-type',contentType);if(contentLength!==null)headers.set('content-length',contentLength);
 return {reader,stats,response:{ok:status>=200&&status<300,headers,body:{getReader:()=>reader,async cancel(){stats.bodyCancels++;}}}};
}
async function runCountryFixture(fixture){
 const calls=[];await initializeCountryLanguage(async(path,init)=>{calls.push({path,init});return fixture.response;});return calls;
}
function assertCountryTimerFinished(clock){
 assert.ok(clock.scheduled.length>0);assert.ok(clock.scheduled.every(timer=>timer.milliseconds===1800));
 assert.equal(clock.pending.size,0);assert.ok(clock.scheduled.every(timer=>clock.cleared.includes(timer.id)));
}
test('real language controller keeps saved manual preference ahead of URL, country and browser',t=>{
 const ui=languageHarness(t,{href:'https://www.dlkt.ee/?lang=fr',saved:'ro',languages:['de-DE']});
 setupLanguage({updateUrl:false});assert.equal(getLocale(),'ro');assert.equal(ui.picker.value,'ro');
 ui.country('JP');assert.equal(getLocale(),'ro');assert.deepEqual(ui.reads,['dlkt-reader-language-v1']);assert.deepEqual(ui.writes,[]);assert.deepEqual(ui.historyCalls,[]);
 ui.choose('ar');assert.equal(getLocale(),'ar');assert.equal(ui.document.documentElement.dir,'rtl');ui.country('RO');assert.equal(getLocale(),'ar');
 assert.deepEqual(ui.writes,[['dlkt-reader-language-v1','ar']]);
});
test('real language controller retains an explicit URL language ahead of automatic country context',t=>{
 const ui=languageHarness(t,{href:'https://www.dlkt.ee/?lang=fr',languages:['en-US']});
 setupLanguage({updateUrl:false});ui.country('RO');assert.equal(getLocale(),'fr');assert.deepEqual(ui.writes,[]);assert.deepEqual(ui.historyCalls,[]);
});
test('account language changes retain the exact Wallet return URL without any history call',t=>{
 const href='https://www.dlkt.ee/account?returnTo=wallet',ui=languageHarness(t,{href});
 setupLanguage({updateUrl:false});assert.equal(getLocale(),'en');ui.country('RO');assert.equal(getLocale(),'ro');assert.deepEqual(ui.writes,[]);
 ui.choose('ja');assert.equal(getLocale(),'ja');ui.country('FR');assert.equal(getLocale(),'ja');
 assert.equal(ui.window.location.href,href);assert.deepEqual(ui.historyCalls,[]);assert.equal(ui.stored.get('dlkt-reader-language-v1'),'ja');
});
test('default language setup still writes the chosen language to the URL and preserves other context',t=>{
 const ui=languageHarness(t,{href:'https://www.dlkt.ee/?view=saved#reading'});setupLanguage();
 ui.choose('fr');assert.equal(ui.historyCalls.length,1);assert.equal(getLocale(),'fr');
 let url=new URL(ui.window.location.href);assert.equal(url.searchParams.get('view'),'saved');assert.equal(url.hash,'#reading');assert.deepEqual(url.searchParams.getAll('lang'),['fr']);
 ui.choose('ro');assert.equal(ui.historyCalls.length,2);url=new URL(ui.window.location.href);
 assert.deepEqual(url.searchParams.getAll('lang'),['ro']);assert.equal(url.searchParams.get('view'),'saved');assert.equal(url.hash,'#reading');
});
test('account manual language remains usable without storage and without changing its URL',t=>{
 const href='https://www.dlkt.ee/account?returnTo=wallet',ui=languageHarness(t,{href,blockedStorage:true});
 setupLanguage({updateUrl:false});ui.choose('ro');ui.country('US');
 assert.equal(getLocale(),'ro');assert.equal(ui.window.location.href,href);assert.deepEqual(ui.historyCalls,[]);
});
test('country hint accepts exactly16384 UTF8bytes, projects only country and uses the existing anonymous endpoint',async t=>{
 const ui=languageHarness(t),clock=countryClock(t,ui.window);setupLanguage({updateUrl:false});
 const raw=JSON.stringify({estimated:true,countryCode:'RO',city:{name:'București'}});
 const bytes=countryEncoder.encode(raw+' '.repeat(16384-countryEncoder.encode(raw).length));
 const split=bytes.findIndex(byte=>byte>=128)+1;assert.ok(split>0);
 const fixture=countryResponse(bytes,{contentType:'application/json; charset=utf-8',contentLength:'16384',chunks:[bytes.slice(0,split),bytes.slice(split)]});
 const calls=await runCountryFixture(fixture);assert.equal(calls.length,1);
 const {path,init}=calls[0];assert.equal(path,'/api/places?hint=1');assert.equal(init.method??'GET','GET');
 assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.body,undefined);
 const headers=new Headers(init.headers);assert.equal(headers.get('accept'),'application/json');assert.deepEqual([...headers.keys()],['accept']);
 assert.ok(init.signal instanceof AbortSignal);assert.equal(init.signal.aborted,true);
 assert.deepEqual(ui.countryEvents().map(event=>event.detail),[{countryCode:'RO',estimated:true}]);
 assert.equal(getLocale(),'ro');assert.deepEqual(ui.writes,[]);assert.deepEqual(ui.historyCalls,[]);
 assert.equal(fixture.stats.releases,1);assert.ok(fixture.stats.cancels>=1);assertCountryTimerFinished(clock);
});
test('country hint rejects failed HTTP, invalid media type and invalid or oversized declared lengths before reading',async t=>{
 const ui=languageHarness(t),clock=countryClock(t,ui.window);setupLanguage({updateUrl:false});
 for(const options of [{status:503},{contentType:'text/html'},{contentType:null},{contentLength:'16385'},{contentLength:'invalid'},{contentLength:'-1'}]){
  const fixture=countryResponse('{"estimated":true,"countryCode":"RO"}',options);await runCountryFixture(fixture);
  assert.equal(fixture.stats.reads,0,JSON.stringify(options));assert.equal(ui.countryEvents().length,0);assert.equal(getLocale(),'en');assertCountryTimerFinished(clock);
 }
});
test('malformed country bodies produce no event and release their readers',async t=>{
 const ui=languageHarness(t),clock=countryClock(t,ui.window);setupLanguage({updateUrl:false});
 const cases=['{','null','[]','{"estimated":false,"countryCode":"RO"}','{"estimated":true,"countryCode":"ro"}','{"estimated":true,"countryCode":"ROM"}','{"estimated":true,"countryCode":7}','{"countryCode":"RO"}'];
 for(const payload of cases){const fixture=countryResponse(payload);await runCountryFixture(fixture);
  assert.equal(ui.countryEvents().length,0,payload);assert.equal(fixture.stats.releases,1,payload);assert.ok(fixture.stats.cancels>=1,payload);assert.equal(getLocale(),'en');assertCountryTimerFinished(clock);}
});
test('country hint enforces streamed byte limits and fatal UTF8 even inside otherwise ignorable metadata',async t=>{
 const ui=languageHarness(t),clock=countryClock(t,ui.window);setupLanguage({updateUrl:false});
 const raw=JSON.stringify({estimated:true,countryCode:'RO',extra:'é'.repeat(8200)}),oversize=countryEncoder.encode(raw);
 assert.ok(raw.length<16384);assert.ok(oversize.length>16384);
 const invalidUtf8=new Uint8Array([...countryEncoder.encode('{"estimated":true,"countryCode":"RO","extra":"'),0xc3,0x28,...countryEncoder.encode('"}')]);
 for(const bytes of [oversize,invalidUtf8]){const fixture=countryResponse(bytes,{chunks:[bytes.slice(0,4096),bytes.slice(4096)]});
  await runCountryFixture(fixture);assert.equal(ui.countryEvents().length,0);assert.equal(getLocale(),'en');
  assert.equal(fixture.stats.releases,1);assert.ok(fixture.stats.cancels>=1);assertCountryTimerFinished(clock);}
});
test('country hint timeout aborts a pending fetch after1800ms and leaves browser fallback usable',async t=>{
 const ui=languageHarness(t),clock=countryClock(t,ui.window);setupLanguage({updateUrl:false});let signal;
 const work=initializeCountryLanguage((_path,init)=>{signal=init.signal;return new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});});
 assert.equal(clock.pending.size,1);assert.equal(clock.scheduled[0].milliseconds,1800);clock.fire();await work;
 assert.equal(signal.aborted,true);assert.equal(ui.countryEvents().length,0);assert.equal(getLocale(),'en');assertCountryTimerFinished(clock);ui.choose('ro');assert.equal(getLocale(),'ro');
});
test('country hint timeout also cancels an unfinished body and releases its reader',async t=>{
 const ui=languageHarness(t),clock=countryClock(t,ui.window);setupLanguage({updateUrl:false});
 const fixture=countryResponse('');let started,rejectRead;const reading=new Promise(resolve=>{started=resolve;});
 fixture.reader.read=()=>{fixture.stats.reads++;started();return new Promise((_resolve,reject)=>{rejectRead=reject;});};
 const work=initializeCountryLanguage(async(_path,init)=>{init.signal.addEventListener('abort',()=>rejectRead?.(new DOMException('Aborted','AbortError')),{once:true});return fixture.response;});
 await reading;clock.fire();await work;assert.equal(ui.countryEvents().length,0);assert.equal(fixture.stats.releases,1);assert.ok(fixture.stats.cancels>=1);assertCountryTimerFinished(clock);
});
test('real country helper cannot override a restored or newly chosen manual language',async t=>{
 const ui=languageHarness(t,{saved:'ja'}),clock=countryClock(t,ui.window);setupLanguage({updateUrl:false});
 await runCountryFixture(countryResponse('{"estimated":true,"countryCode":"RO"}'));assert.equal(getLocale(),'ja');assert.deepEqual(ui.writes,[]);
 ui.choose('fr');await runCountryFixture(countryResponse('{"estimated":true,"countryCode":"JP"}'));assert.equal(getLocale(),'fr');
 assert.deepEqual(ui.countryEvents().map(event=>event.detail),[{countryCode:'RO',estimated:true},{countryCode:'JP',estimated:true}]);
 assert.deepEqual(ui.writes,[['dlkt-reader-language-v1','fr']]);assert.deepEqual(ui.historyCalls,[]);assertCountryTimerFinished(clock);
});
