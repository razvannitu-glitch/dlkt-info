import test from 'node:test';
import assert from 'node:assert/strict';
import {setupLanguage} from '../.build/src/i18n/browser.js';
import {MESSAGES,CATEGORY_LABELS} from '../.build/src/i18n/catalog.js';

// A narrow native-control fixture. The actual compiled controller owns every update;
// no resolver, translation, history or storage behavior is reimplemented here.
class ElementFixture extends EventTarget {
  constructor(tag='div') {
    super();this.tagName=tag.toUpperCase();this.id='';this.className='';this.dataset={};this.attributes=new Map();
    this.children=[];this.parentElement=null;this.value='';this.checked=false;this.lang='';this.dir='';this.placeholder='';this.copy='';
  }
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  get textContent(){return this.copy+this.children.map(node=>node.textContent).join('');}
  set textContent(value){this.copy=String(value);this.children=[];}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  matches(selector){
    if(selector.startsWith('.'))return this.className.split(/\s+/u).includes(selector.slice(1));
    if(selector==='input[name="topic"]')return this.tagName==='INPUT'&&this.getAttribute('name')==='topic';
    if(selector.startsWith('[data-')&&selector.endsWith(']')){
      const key=selector.slice(6,-1).replace(/-([a-z])/gu,(_match,letter)=>letter.toUpperCase());
      return Object.hasOwn(this.dataset,key);
    }
    return this.tagName===selector.toUpperCase();
  }
  querySelectorAll(selector){
    const selectors=selector.split(','),found=[];
    const visit=node=>{for(const child of node.children){if(selectors.some(value=>child.matches(value)))found.push(child);visit(child);}};
    visit(this);return found;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
class SelectFixture extends ElementFixture {constructor(){super('select');}}
class CustomEventFixture extends Event {constructor(type,options={}){super(type,options);this.detail=options.detail;}}

const preferenceKey='dlkt-reader-language-v1';
function harness(t,url='https://www.dlkt.ee/?explore=1&city=1850147&country=JP&category=culture&keep=a&keep=b&lang=en#reading',options={}){
  const root=new ElementFixture('html'),body=new ElementFixture('body');root.append(body);
  const picker=new SelectFixture();picker.id='reader-language';picker.dataset.i18nLabel='language';
  const appearance=new ElementFixture('button');appearance.id='reader-theme-toggle';appearance.dataset.i18nLabel='switchToDarkMode';
  const icon=new ElementFixture('svg');appearance.append(icon);root.dataset.readerTheme='prism';
  const label=new ElementFixture('span');label.dataset.i18n='todayTop';label.textContent='Old UI text';
  const query=new ElementFixture('input');query.dataset.i18nPlaceholder='cityPlaceholder';query.value='東京';
  const topicLabel=new ElementFixture('label'),topic=new ElementFixture('input'),topicText=new ElementFixture('span');
  topic.setAttribute('name','topic');topic.value='culture';topic.checked=true;topicText.textContent='Culture';topicLabel.append(topic,topicText);
  const original=new ElementFixture('h3');original.lang='ja';original.dir='auto';original.setAttribute('translate','no');original.textContent='東京の美術館、2026年の展示を発表';
  const untouched=new ElementFixture('p');untouched.textContent='Publisher excerpt: original English wording.';
  const brand=new ElementFixture('a');brand.className='brand-header';brand.textContent='DLKT · Daily Life. Key Things.';
  body.append(picker,appearance,label,query,topicLabel,original,untouched,brand);
  const doc=new EventTarget();doc.documentElement=root;doc.body=body;doc.activeElement=picker;
  doc.getElementById=id=>id===picker.id?picker:id===appearance.id?appearance:null;
  doc.querySelectorAll=selector=>root.querySelectorAll(selector);
  doc.createElement=tag=>new ElementFixture(tag);
  const win=new EventTarget();win.location=new URL(url);
  const browser={languages:options.languages??['en-GB'],language:'en-GB'},historyCalls=[],sideEffects=[],localeEvents=[],storageCalls=[];
  const stored=options.stored??new Map();
  const denied=name=>(...args)=>{sideEffects.push([name,...args]);throw Error('UNEXPECTED_I18N_SIDE_EFFECT:'+name);};
  const storage={
    getItem(key){storageCalls.push(['get',key]);if(key!==preferenceKey)return denied('storage.getItem')(key);if(options.denyStorage)throw Error('STORAGE_DENIED');return stored.get(key)??null;},
    setItem(key,value){storageCalls.push(['set',key,value]);if(key!==preferenceKey)return denied('storage.setItem')(key,value);if(options.denyStorage)throw Error('STORAGE_DENIED');stored.set(key,value);},
    removeItem:denied('storage.removeItem'),clear:denied('storage.clear'),
  };
  Object.defineProperty(win,'localStorage',{get(){if(options.denyStorageAccess)throw Error('STORAGE_ACCESS_DENIED');return storage;}});
  const otherStorage={getItem:denied('sessionStorage.getItem'),setItem:denied('sessionStorage.setItem')};
  Object.defineProperty(doc,'cookie',{get:denied('cookie.read'),set:denied('cookie.write')});
  const history={pushState:(_data,_title,next)=>{historyCalls.push(next);win.location=new URL(next,win.location);}};
  const previous=new Map();
  for(const [name,value]of Object.entries({document:doc,window:win,navigator:browser,history,HTMLSelectElement:SelectFixture,CustomEvent:CustomEventFixture,
    fetch:denied('fetch'),localStorage:storage,sessionStorage:otherStorage,indexedDB:{open:denied('indexedDB.open')}})){
    previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  }
  let restored=false;
  const cleanup=()=>{if(restored)return;restored=true;for(const [name,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}};
  t.after(cleanup);
  doc.addEventListener('dlkt:language-changed',event=>localeEvents.push(event.detail.locale));
  setupLanguage();
  return{doc,win,browser,picker,appearance,icon,label,query,topic,topicText,original,untouched,brand,historyCalls,sideEffects,localeEvents,storageCalls,stored,cleanup,
    country(countryCode,flags={estimated:true,restored:false}){doc.dispatchEvent(new CustomEventFixture('dlkt:city-selected',{detail:{city:{countryCode},...flags}}));},
    choose(locale){picker.value=locale;picker.dispatchEvent(new Event('change'));},
    pop(next){win.location=new URL(next,win.location);win.dispatchEvent(new Event('popstate'));}};
}

test('native language selection changes RO, AR and EN without changing Explore geography, query, hash or focus',t=>{
  const h=harness(t),initial=new URL(h.win.location),expectedParams=[...initial.searchParams].filter(([key])=>key!=='lang');
  assert.equal(h.picker.children.length,30);
  assert.equal(new Set(h.picker.children.map(option=>option.value)).size,30);
  assert.equal(h.picker.children.find(option=>option.value==='ar').dir,'rtl');
  for(const [locale,direction]of [['ro','ltr'],['ar','rtl'],['en','ltr']]){
    h.choose(locale);
    assert.equal(h.doc.documentElement.lang,locale);assert.equal(h.doc.documentElement.dir,direction);assert.equal(h.picker.value,locale);
    assert.equal(h.label.textContent,MESSAGES[locale].todayTop);assert.equal(h.picker.getAttribute('aria-label'),MESSAGES[locale].language);
    assert.equal(h.query.placeholder,MESSAGES[locale].cityPlaceholder);assert.equal(h.topicText.textContent,CATEGORY_LABELS[locale].culture);
    assert.deepEqual([...h.win.location.searchParams].filter(([key])=>key!=='lang'),expectedParams);
    assert.equal(h.win.location.hash,'#reading');assert.equal(h.win.location.searchParams.get('lang'),locale);
    assert.equal(h.doc.activeElement,h.picker);assert.equal(h.doc.getElementById('reader-language'),h.picker);
    assert.equal(h.query.value,'東京');assert.equal(h.topic.value,'culture');assert.equal(h.topic.checked,true);
  }
  assert.deepEqual(h.localeEvents,['en','ro','ar','en']);assert.equal(h.historyCalls.length,3);assert.deepEqual(h.sideEffects,[]);
  assert.deepEqual(h.storageCalls,[['get',preferenceKey],['set',preferenceKey,'ro'],['set',preferenceKey,'ar'],['set',preferenceKey,'en']]);
});

test('appearance labels follow both theme and all30 language changes without changing content or preferences',t=>{
  const h=harness(t),original=h.original.textContent;
  for(const locale of Object.keys(MESSAGES)){
    h.choose(locale);
    for(const theme of ['night','prism']){
      const before=h.win.location.href,historyCount=h.historyCalls.length;
      h.doc.documentElement.dataset.readerTheme=theme;
      h.doc.dispatchEvent(new CustomEventFixture('dlkt:theme-changed',{detail:{theme}}));
      const key=theme==='night'?'switchToLightMode':'switchToDarkMode';
      assert.equal(h.appearance.dataset.i18nLabel,key);
      assert.equal(h.appearance.getAttribute('aria-label'),MESSAGES[locale][key]);
      assert.equal(h.appearance.getAttribute('title'),MESSAGES[locale][key]);
      assert.equal(h.appearance.children[0],h.icon);
      assert.equal(h.doc.documentElement.dataset.readerTheme,theme);
      assert.equal(h.doc.documentElement.lang,locale);
      assert.equal(h.doc.activeElement,h.picker);
      assert.equal(h.win.location.href,before);assert.equal(h.historyCalls.length,historyCount);
      assert.equal(h.original.textContent,original);assert.equal(h.query.value,'東京');
    }
  }
  h.doc.documentElement.dataset.readerTheme='night';h.choose('ar');
  assert.equal(h.appearance.getAttribute('aria-label'),MESSAGES.ar.switchToLightMode);
  assert.equal(h.doc.documentElement.dataset.readerTheme,'night');assert.equal(h.doc.documentElement.dir,'rtl');
  assert.deepEqual(h.sideEffects,[]);
});

test('popstate restores presentation from the historical URL without pushing another entry or touching preferences',t=>{
  const h=harness(t);h.choose('ro');const romanian=h.win.location.href;h.choose('ar');const arabic=h.win.location.href,storageCount=h.storageCalls.length;
  h.pop(romanian);assert.equal(h.doc.documentElement.lang,'ro');assert.equal(h.doc.documentElement.dir,'ltr');assert.equal(h.picker.value,'ro');
  h.pop(arabic);assert.equal(h.doc.documentElement.lang,'ar');assert.equal(h.doc.documentElement.dir,'rtl');assert.equal(h.picker.value,'ar');
  assert.equal(h.win.location.searchParams.get('city'),'1850147');assert.equal(h.win.location.searchParams.get('country'),'JP');assert.equal(h.win.location.searchParams.get('category'),'culture');
  assert.equal(h.historyCalls.length,2);assert.equal(h.storageCalls.length,storageCount);assert.equal(h.stored.get(preferenceKey),'ar');assert.deepEqual(h.sideEffects,[]);
});

test('language rebinding preserves original publisher wording and brand identity, including after an entry render',t=>{
  const h=harness(t),original=h.original.textContent,untouched=h.untouched.textContent,brand=h.brand.textContent;
  for(const locale of ['ro','ar','en']){
    h.choose(locale);h.label.textContent='Context controller replaced this UI label';h.doc.dispatchEvent(new Event('dlkt:entry-view'));
    assert.equal(h.label.textContent,MESSAGES[locale].todayTop);
    assert.equal(h.original.textContent,original);assert.equal(h.original.lang,'ja');assert.equal(h.original.dir,'auto');assert.equal(h.original.getAttribute('translate'),'no');
    assert.equal(h.untouched.textContent,untouched);
    assert.equal(h.brand.textContent,brand);assert.equal(h.brand.lang,'en');assert.equal(h.brand.dir,'ltr');assert.equal(h.brand.getAttribute('translate'),'no');
  }
  assert.deepEqual(h.localeEvents,['en','ro','ar','en']);assert.deepEqual(h.sideEffects,[]);
});

test('browser language changes update an implicit locale but cannot replace an explicit URL choice',t=>{
  const h=harness(t,'https://www.dlkt.ee/?explore=1&country=JP#reading');
  h.browser.languages=['ar'];h.win.dispatchEvent(new Event('languagechange'));
  assert.equal(h.doc.documentElement.lang,'ar');assert.equal(h.doc.documentElement.dir,'rtl');assert.equal(h.historyCalls.length,0);
  h.choose('ro');h.browser.languages=['en-GB'];h.win.dispatchEvent(new Event('languagechange'));
  assert.equal(h.doc.documentElement.lang,'ro');assert.equal(h.doc.documentElement.dir,'ltr');assert.equal(h.historyCalls.length,1);
  assert.equal(h.win.location.searchParams.get('country'),'JP');assert.equal(h.win.location.hash,'#reading');assert.deepEqual(h.sideEffects,[]);
});


test('automatic current-country hints update the default and reader event without saving a preference',t=>{
  const h=harness(t,'https://www.dlkt.ee/?country=JP#reading');
  assert.equal(h.doc.documentElement.lang,'en');
  h.country('RO');
  assert.equal(h.doc.documentElement.lang,'ro');assert.equal(h.picker.value,'ro');
  assert.equal(h.label.textContent,MESSAGES.ro.todayTop);
  assert.deepEqual(h.localeEvents,['en','ro']);assert.equal(h.historyCalls.length,0);
  assert.equal(h.win.location.searchParams.has('lang'),false);
  h.country('RO');assert.deepEqual(h.localeEvents,['en','ro']);
  assert.deepEqual(h.storageCalls,[['get',preferenceKey]]);assert.equal(h.stored.size,0);assert.deepEqual(h.sideEffects,[]);
});

test('manual English wins over late location and browser changes, including a URL without lang',t=>{
  const h=harness(t,'https://www.dlkt.ee/');h.choose('en');
  h.country('RO');h.browser.languages=['ar'];h.win.dispatchEvent(new Event('languagechange'));
  h.pop('https://www.dlkt.ee/?explore=1&country=FR');h.country('FR');
  assert.equal(h.doc.documentElement.lang,'en');assert.equal(h.picker.value,'en');
  assert.equal(h.stored.get(preferenceKey),'en');assert.deepEqual(h.localeEvents,['en']);
  assert.equal(h.historyCalls.length,1);assert.deepEqual(h.sideEffects,[]);
});

test('a manual preference survives a fresh controller and location detection after reload',t=>{
  const stored=new Map([['unrelated-setting','keep-me']]);
  const first=harness(t,'https://www.dlkt.ee/',{stored});first.choose('ro');
  assert.equal(stored.get(preferenceKey),'ro');first.cleanup();
  const reloaded=harness(t,'https://www.dlkt.ee/',{stored,languages:['en-GB']});
  assert.equal(reloaded.doc.documentElement.lang,'ro');assert.equal(reloaded.picker.value,'ro');
  reloaded.country('DE');assert.equal(reloaded.doc.documentElement.lang,'ro');
  assert.deepEqual(reloaded.storageCalls,[['get',preferenceKey]]);
  assert.equal(stored.get('unrelated-setting'),'keep-me');assert.equal(reloaded.historyCalls.length,0);assert.deepEqual(reloaded.sideEffects,[]);
});

test('only automatic current-location events affect defaults; explored, restored and malformed cities do not',t=>{
  const h=harness(t,'https://www.dlkt.ee/');
  h.country('RO',{estimated:false,restored:false});
  h.country('RO',{estimated:true,restored:true});
  for(const detail of [null,[],{},'RO',{city:null,estimated:true,restored:false},{city:{countryCode:'ro'},estimated:true,restored:false},{city:{countryCode:'RO'},estimated:'true',restored:false}]){
    h.doc.dispatchEvent(new CustomEventFixture('dlkt:city-selected',{detail}));
  }
  assert.equal(h.doc.documentElement.lang,'en');assert.deepEqual(h.localeEvents,['en']);
  h.country('RO');assert.equal(h.doc.documentElement.lang,'ro');
  h.country('JP',{estimated:false,restored:false});assert.equal(h.doc.documentElement.lang,'ro');
  assert.equal(h.stored.size,0);assert.deepEqual(h.sideEffects,[]);
});

test('multilingual countries use eligible browser choices and unsupported countries fall back to English',t=>{
  const h=harness(t,'https://www.dlkt.ee/',{languages:['fr-CA','en-CA']});
  h.country('CA');assert.equal(h.doc.documentElement.lang,'fr');
  h.browser.languages=['en-CA','fr-CA'];h.win.dispatchEvent(new Event('languagechange'));
  assert.equal(h.doc.documentElement.lang,'en');
  h.country('RO');assert.equal(h.doc.documentElement.lang,'ro');
  h.country('EE');assert.equal(h.doc.documentElement.lang,'en');
  assert.deepEqual(h.storageCalls,[['get',preferenceKey]]);assert.equal(h.historyCalls.length,0);
});

test('invalid stored data is ignored, explicit URLs win, and URL choices are never persisted automatically',t=>{
  const stored=new Map([[preferenceKey,'{"locale":"ar"}']]);
  const h=harness(t,'https://www.dlkt.ee/?lang=fr',{stored});
  h.country('RO');assert.equal(h.doc.documentElement.lang,'fr');
  h.pop('https://www.dlkt.ee/?lang=ro&lang=ar');assert.equal(h.doc.documentElement.lang,'en');
  h.pop('https://www.dlkt.ee/');assert.equal(h.doc.documentElement.lang,'ro');
  h.choose('__proto__');assert.equal(h.doc.documentElement.lang,'ro');assert.equal(h.historyCalls.length,0);
  assert.equal(stored.get(preferenceKey),'{"locale":"ar"}');assert.deepEqual(h.storageCalls,[['get',preferenceKey]]);
  assert.deepEqual(h.sideEffects,[]);
});

test('denied storage methods preserve manual choice for the session without throwing',t=>{
  const h=harness(t,'https://www.dlkt.ee/',{denyStorage:true});
  h.choose('ro');h.country('US');h.pop('https://www.dlkt.ee/');
  assert.equal(h.doc.documentElement.lang,'ro');assert.equal(h.picker.value,'ro');
  assert.equal(h.stored.size,0);assert.deepEqual(h.storageCalls,[['get',preferenceKey],['set',preferenceKey,'ro']]);
  assert.deepEqual(h.sideEffects,[]);
});

test('denied access to the storage object still allows the picker and automatic country default',t=>{
  const h=harness(t,'https://www.dlkt.ee/',{denyStorageAccess:true});
  h.country('RO');assert.equal(h.doc.documentElement.lang,'ro');
  h.choose('en');h.country('DE');h.pop('https://www.dlkt.ee/');
  assert.equal(h.doc.documentElement.lang,'en');assert.equal(h.picker.value,'en');
  assert.equal(h.stored.size,0);assert.deepEqual(h.sideEffects,[]);
});


test('a country-only hint sets the local default without a matching city or another locale event for the same city',t=>{
  const h=harness(t,'https://www.dlkt.ee/');
  h.doc.dispatchEvent(new CustomEventFixture('dlkt:country-detected',{detail:{countryCode:'RO',estimated:true}}));
  assert.equal(h.doc.documentElement.lang,'ro');assert.equal(h.picker.value,'ro');
  assert.equal(h.label.textContent,MESSAGES.ro.todayTop);assert.deepEqual(h.localeEvents,['en','ro']);
  h.country('RO');assert.deepEqual(h.localeEvents,['en','ro']);
  assert.equal(h.historyCalls.length,0);assert.equal(h.stored.size,0);
  assert.deepEqual(h.storageCalls,[['get',preferenceKey]]);assert.deepEqual(h.sideEffects,[]);
});

test('country-only hints require exactly the validated country and automatic-estimate fields',t=>{
  const h=harness(t,'https://www.dlkt.ee/');
  for(const detail of [
    null,[],{},'RO',{countryCode:'RO'},{estimated:true},
    {countryCode:null,estimated:true},{countryCode:'ro',estimated:true},{countryCode:'ROM',estimated:true},
    {countryCode:'RO',estimated:false},{countryCode:'RO',estimated:'true'},
    {countryCode:'RO',estimated:true,city:null},{countryCode:'RO',estimated:true,restored:false},
    Object.create({countryCode:'RO',estimated:true}),
    {countryCode:'RO',estimated:true,[Symbol('extra')]:true},
  ])h.doc.dispatchEvent(new CustomEventFixture('dlkt:country-detected',{detail}));
  assert.equal(h.doc.documentElement.lang,'en');assert.deepEqual(h.localeEvents,['en']);
  assert.equal(h.historyCalls.length,0);assert.equal(h.stored.size,0);assert.deepEqual(h.sideEffects,[]);
});

test('a saved manual English preference wins over a late country-only Romanian hint',t=>{
  const stored=new Map([[preferenceKey,'en']]);
  const h=harness(t,'https://www.dlkt.ee/',{stored,languages:['ro-RO']});
  h.doc.dispatchEvent(new CustomEventFixture('dlkt:country-detected',{detail:{countryCode:'RO',estimated:true}}));
  assert.equal(h.doc.documentElement.lang,'en');assert.equal(h.picker.value,'en');
  assert.equal(stored.get(preferenceKey),'en');assert.deepEqual(h.localeEvents,['en']);
  assert.deepEqual(h.storageCalls,[['get',preferenceKey]]);assert.equal(h.historyCalls.length,0);assert.deepEqual(h.sideEffects,[]);
});
