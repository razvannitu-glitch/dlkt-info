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

function harness(t,url='https://www.dlkt.ee/?explore=1&city=1850147&country=JP&category=culture&keep=a&keep=b&lang=en#reading'){
  const root=new ElementFixture('html'),body=new ElementFixture('body');root.append(body);
  const picker=new SelectFixture();picker.id='reader-language';picker.dataset.i18nLabel='language';
  const label=new ElementFixture('span');label.dataset.i18n='todayTop';label.textContent='Old UI text';
  const query=new ElementFixture('input');query.dataset.i18nPlaceholder='cityPlaceholder';query.value='東京';
  const topicLabel=new ElementFixture('label'),topic=new ElementFixture('input'),topicText=new ElementFixture('span');
  topic.setAttribute('name','topic');topic.value='culture';topic.checked=true;topicText.textContent='Culture';topicLabel.append(topic,topicText);
  const original=new ElementFixture('h3');original.lang='ja';original.dir='auto';original.setAttribute('translate','no');original.textContent='東京の美術館、2026年の展示を発表';
  const untouched=new ElementFixture('p');untouched.textContent='Publisher excerpt: original English wording.';
  const brand=new ElementFixture('a');brand.className='brand-header';brand.textContent='DLKT · Daily Life. Key Things.';
  body.append(picker,label,query,topicLabel,original,untouched,brand);
  const doc=new EventTarget();doc.documentElement=root;doc.body=body;doc.activeElement=picker;
  doc.getElementById=id=>id===picker.id?picker:null;
  doc.querySelectorAll=selector=>root.querySelectorAll(selector);
  doc.createElement=tag=>new ElementFixture(tag);
  const win=new EventTarget();win.location=new URL(url);
  const browser={languages:['en-GB'],language:'en-GB'},historyCalls=[],sideEffects=[],localeEvents=[];
  const denied=name=>(...args)=>{sideEffects.push([name,...args]);throw Error('UNEXPECTED_I18N_SIDE_EFFECT:'+name);};
  const storage={getItem:denied('storage.getItem'),setItem:denied('storage.setItem'),removeItem:denied('storage.removeItem'),clear:denied('storage.clear')};
  Object.defineProperty(doc,'cookie',{get:denied('cookie.read'),set:denied('cookie.write')});
  const history={pushState:(_data,_title,next)=>{historyCalls.push(next);win.location=new URL(next,win.location);}};
  const previous=new Map();
  for(const [name,value]of Object.entries({document:doc,window:win,navigator:browser,history,HTMLSelectElement:SelectFixture,CustomEvent:CustomEventFixture,
    fetch:denied('fetch'),localStorage:storage,sessionStorage:storage,indexedDB:{open:denied('indexedDB.open')}})){
    previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  }
  t.after(()=>{for(const [name,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  doc.addEventListener('dlkt:language-changed',event=>localeEvents.push(event.detail.locale));
  setupLanguage();
  return{doc,win,browser,picker,label,query,topic,topicText,original,untouched,brand,historyCalls,sideEffects,localeEvents,
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
});

test('popstate restores presentation from the historical URL without pushing another entry or touching preferences',t=>{
  const h=harness(t);h.choose('ro');const romanian=h.win.location.href;h.choose('ar');const arabic=h.win.location.href;
  h.pop(romanian);assert.equal(h.doc.documentElement.lang,'ro');assert.equal(h.doc.documentElement.dir,'ltr');assert.equal(h.picker.value,'ro');
  h.pop(arabic);assert.equal(h.doc.documentElement.lang,'ar');assert.equal(h.doc.documentElement.dir,'rtl');assert.equal(h.picker.value,'ar');
  assert.equal(h.win.location.searchParams.get('city'),'1850147');assert.equal(h.win.location.searchParams.get('country'),'JP');assert.equal(h.win.location.searchParams.get('category'),'culture');
  assert.equal(h.historyCalls.length,2);assert.deepEqual(h.sideEffects,[]);
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
