import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {parseDocument,DomUtils} from 'htmlparser2';

const preferenceKey='dlkt-reader-theme-v1';
const compiled=readFileSync('.build/src/theme/browser.js','utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'');
const classic=compiled.replace(/^export \{\};\r?\n?/mu,'');
const script=new Script(classic,{filename:'reader-theme.js'});

class ElementFixture extends EventTarget {
  constructor(tag,id=''){
    super();this.tagName=tag.toUpperCase();this.id=id;this.dataset={};this.attributes=new Map();
    this.children=[];this.title='';this.textContent='';this.lang='';this.dir='';
  }
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
}
class ButtonFixture extends ElementFixture {
  constructor(){super('button','reader-theme-toggle');this.type='button';}
  click(){return this.dispatchEvent(new Event('click',{bubbles:true,cancelable:true}));}
}
class CustomEventFixture extends Event {
  constructor(type,options={}){super(type,options);this.detail=options.detail;}
}

/** Execute the compiled classic script; fixtures expose browser primitives only. */
function harness({saved=null,readyState='loading',denyRead=false,denyWrite=false,denyAccess=false,missingButton=false,memory,onTheme}={}){
  const data=memory??new Map([['private-profile-sentinel','unchanged']]);
  if(saved!==null)data.set(preferenceKey,saved);
  const reads=[],writeAttempts=[],writes=[],sideEffects=[],themeEvents=[];
  const denied=name=>(...args)=>{sideEffects.push([name,...args]);throw Error('UNEXPECTED_THEME_SIDE_EFFECT:'+name);};
  const storage={
    getItem(key){reads.push(key);assert.equal(key,preferenceKey);if(denyRead)throw Error('STORAGE_READ_DENIED');return data.get(key)??null;},
    setItem(key,value){writeAttempts.push([key,value]);assert.equal(key,preferenceKey);if(denyWrite)throw Error('STORAGE_WRITE_DENIED');data.set(key,String(value));writes.push([key,String(value)]);},
    removeItem:denied('storage.removeItem'),clear:denied('storage.clear'),key:denied('storage.key'),
  };
  const root=new ElementFixture('html');root.lang='ar';root.dir='rtl';root.dataset.unrelated='preserved';
  const body=new ElementFixture('body'),button=new ButtonFixture();
  const moon=new ElementFixture('svg'),sun=new ElementFixture('svg');moon.dataset.themeIcon='moon';sun.dataset.themeIcon='sun';button.children=[moon,sun];
  const headline=new ElementFixture('h3');headline.textContent='東京の美術館、2026年の展示を発表';headline.lang='ja';headline.dir='auto';headline.setAttribute('translate','no');
  const summary=new ElementFixture('p');summary.textContent='Original publisher excerpt remains unchanged.';
  body.children=[button,headline,summary];root.children=[body];
  const doc=new EventTarget();doc.documentElement=root;doc.body=body;doc.activeElement=button;doc.readyState=readyState;
  let available=readyState!=='loading';
  doc.getElementById=id=>{assert.equal(id,'reader-theme-toggle');return available&&!missingButton?button:null;};
  doc.querySelectorAll=denied('querySelectorAll');doc.createElement=denied('createElement');
  Object.defineProperty(doc,'cookie',{get:denied('cookie.read'),set:denied('cookie.write')});
  const win=new EventTarget(),url=new URL('https://www.dlkt.ee/?explore=1&city=1850147&country=JP&category=culture&lang=ar#reading');
  Object.defineProperty(win,'location',{get:()=>url,set:denied('location.write')});
  Object.defineProperty(win,'localStorage',{get:()=>{if(denyAccess)throw Error('STORAGE_ACCESS_DENIED');return storage;}});
  win.scrollY=482;win.scrollTo=denied('scrollTo');win.fetch=denied('fetch');win.matchMedia=denied('matchMedia');
  const history={pushState:denied('pushState'),replaceState:denied('replaceState')};
  const navigator={languages:['ar'],language:'ar',sendBeacon:denied('sendBeacon')};
  Object.defineProperty(navigator,'geolocation',{get:denied('geolocation')});
  const context={document:doc,window:win,navigator,history,HTMLButtonElement:ButtonFixture,CustomEvent:CustomEventFixture,
    fetch:denied('fetch'),indexedDB:{open:denied('indexedDB.open')},sessionStorage:{getItem:denied('sessionStorage.getItem')}};
  Object.defineProperty(context,'localStorage',{get:()=>win.localStorage});
  doc.addEventListener('dlkt:theme-changed',event=>{
    assert.deepEqual(Object.keys(event.detail),['theme']);themeEvents.push(event.detail.theme);
    onTheme?.({event,button,root,doc});
  });
  script.runInNewContext(context);
  return{data,reads,writeAttempts,writes,sideEffects,themeEvents,root,body,doc,win,url,button,moon,sun,headline,summary,
    ready(){available=true;doc.readyState='interactive';doc.dispatchEvent(new Event('DOMContentLoaded'));},
    choose(){return button.click();}};
}

test('published bootstrap is the exact compiled classic script with no module dependency',()=>{
  assert.equal(readFileSync('public/reader-theme.js','utf8'),classic);
  assert.doesNotMatch(classic,/^\s*(?:import|export)\b/mu);
  assert.doesNotMatch(classic,/sourceMappingURL|\b(?:eval|fetch)\s*\(|innerHTML|outerHTML/u);
});

test('actual reader HTML keeps the synchronous theme bootstrap before CSS and an accessible native action',()=>{
  const doc=parseDocument(readFileSync('public/iceo.html','utf8'),{withStartIndices:true});
  const elements=DomUtils.findAll(node=>typeof node.name==='string',doc.children);
  const roots=elements.filter(node=>node.name==='html');assert.equal(roots.length,1);assert.equal(roots[0].attribs['data-reader-theme'],'prism');
  const scripts=elements.filter(node=>node.name==='script'&&/reader-theme\.js(?:[?#]|$)/u.test(node.attribs.src??''));
  assert.equal(scripts.length,1);const bootstrap=scripts[0];
  assert.equal(bootstrap.parent.name,'head');assert.equal(bootstrap.attribs.src,'/reader-theme.js');
  assert.equal(new URL(bootstrap.attribs.src,'https://www.dlkt.ee/').origin,'https://www.dlkt.ee');
  for(const attribute of ['type','defer','async'])assert.equal(Object.hasOwn(bootstrap.attribs,attribute),false,attribute);
  assert.ok(bootstrap.children.every(node=>node.type==='text'&&node.data.trim()===''),'external bootstrap has no inline script');
  const stylesheets=elements.filter(node=>node.name==='link'&&(node.attribs.rel??'').split(/\s+/u).includes('stylesheet'));
  assert.ok(stylesheets.length>1);
  for(const stylesheet of stylesheets)assert.ok(bootstrap.startIndex<stylesheet.startIndex,stylesheet.attribs.href);
  const themeStyles=stylesheets.filter(node=>/reader-theme\.css(?:[?#]|$)/u.test(node.attribs.href??''));
  assert.equal(themeStyles.length,1);assert.equal(themeStyles[0].attribs.href,'/reader-theme.css');
  assert.equal(themeStyles[0].parent.name,'head');assert.equal(stylesheets.at(-1),themeStyles[0]);
  const buttons=elements.filter(node=>node.attribs.id==='reader-theme-toggle');assert.equal(buttons.length,1);
  const button=buttons[0];assert.equal(button.name,'button');assert.equal(button.attribs.type,'button');
  assert.equal(Object.hasOwn(button.attribs,'aria-pressed'),false);assert.equal(Object.hasOwn(button.attribs,'disabled'),false);
  assert.equal(button.attribs['aria-label'],'Switch to dark mode');assert.equal(button.attribs.title,'Switch to dark mode');
  const icons=DomUtils.findAll(node=>node.name==='svg',button.children);assert.equal(icons.length,2);
  assert.deepEqual(icons.map(node=>node.attribs['data-theme-icon']).sort(),['moon','sun']);
  for(const icon of icons)assert.equal(icon.attribs['aria-hidden'],'true');
});

test('first visit applies Prism before DOM ready without persisting or reading private data',()=>{
  const h=harness();
  assert.equal(h.root.dataset.readerTheme,'prism');assert.deepEqual(h.reads,[preferenceKey]);
  assert.deepEqual(h.writeAttempts,[]);assert.equal(h.button.getAttribute('aria-label'),null);assert.deepEqual(h.themeEvents,[]);
  h.ready();
  assert.equal(h.button.getAttribute('aria-label'),'Switch to dark mode');assert.equal(h.button.title,'Switch to dark mode');
  assert.equal(h.button.dataset.i18nLabel,'switchToDarkMode');assert.equal(h.button.getAttribute('aria-pressed'),null);
  assert.deepEqual(h.themeEvents,['prism']);assert.deepEqual(h.writeAttempts,[]);assert.deepEqual(h.reads,[preferenceKey]);
  assert.equal(h.data.get('private-profile-sentinel'),'unchanged');assert.deepEqual(h.sideEffects,[]);
});

test('explicit Night is restored before DOM ready and is not written again at initialization',()=>{
  const h=harness({saved:'night'});
  assert.equal(h.root.dataset.readerTheme,'night');assert.deepEqual(h.writes,[]);
  h.ready();
  assert.equal(h.root.dataset.readerTheme,'night');assert.equal(h.button.getAttribute('aria-label'),'Switch to light mode');
  assert.equal(h.button.title,'Switch to light mode');assert.equal(h.button.dataset.i18nLabel,'switchToLightMode');
  assert.deepEqual(h.themeEvents,['night']);assert.deepEqual(h.writeAttempts,[]);assert.deepEqual(h.sideEffects,[]);
});

test('manual toggles persist only the dedicated appearance key and restore on a subsequent load',()=>{
  const h=harness({readyState:'complete'});
  assert.equal(h.choose(),true);assert.equal(h.root.dataset.readerTheme,'night');
  assert.equal(h.button.getAttribute('aria-label'),'Switch to light mode');assert.equal(h.button.dataset.i18nLabel,'switchToLightMode');
  const reloaded=harness({memory:h.data});
  assert.equal(reloaded.root.dataset.readerTheme,'night');assert.deepEqual(reloaded.writeAttempts,[]);reloaded.ready();
  assert.equal(reloaded.button.getAttribute('aria-label'),'Switch to light mode');
  h.choose();assert.equal(h.root.dataset.readerTheme,'prism');assert.equal(h.button.title,'Switch to dark mode');
  assert.deepEqual(h.writes,[[preferenceKey,'night'],[preferenceKey,'prism']]);assert.deepEqual(h.themeEvents,['prism','night','prism']);
  assert.equal(h.data.get('private-profile-sentinel'),'unchanged');assert.deepEqual(h.sideEffects,[]);
});

test('only exact supported values are restored and invalid preferences are never rewritten automatically',()=>{
  for(const saved of ['','Night','PRISM','dark','null','{"theme":"night"}','night prism','<script>alert(1)</script>']){
    const h=harness({saved,readyState:'complete'});
    assert.equal(h.root.dataset.readerTheme,'prism',saved);assert.equal(h.data.get(preferenceKey),saved);
    assert.deepEqual(h.writeAttempts,[]);assert.deepEqual(h.sideEffects,[]);
    h.choose();assert.equal(h.root.dataset.readerTheme,'night');assert.deepEqual(h.writes,[[preferenceKey,'night']]);
  }
  const valid=harness({saved:'prism',readyState:'complete'});assert.equal(valid.root.dataset.readerTheme,'prism');assert.deepEqual(valid.writeAttempts,[]);
});

test('denied storage access, reads or writes never prevent live appearance changes',()=>{
  for(const options of [{denyAccess:true},{denyRead:true},{denyWrite:true}]){
    const h=harness({...options,readyState:'complete'});
    assert.equal(h.root.dataset.readerTheme,'prism');assert.deepEqual(h.writeAttempts,[]);
    h.choose();assert.equal(h.root.dataset.readerTheme,'night');assert.equal(h.button.title,'Switch to light mode');
    h.doc.dispatchEvent(new Event('dlkt:language-changed'));h.ready();
    assert.equal(h.root.dataset.readerTheme,'night');
    h.choose();assert.equal(h.root.dataset.readerTheme,'prism');assert.equal(h.button.title,'Switch to dark mode');
    assert.deepEqual(h.themeEvents,['prism','night','prism']);assert.deepEqual(h.sideEffects,[]);
  }
});

test('language changes cannot reset appearance and translations can replace the action label synchronously',()=>{
  const h=harness({onTheme:({button,root})=>{
    const label=root.dataset.readerTheme==='night'?'Activeaza modul luminos':'Activeaza modul intunecat';
    button.title=label;button.setAttribute('aria-label',label);
  }});
  h.ready();assert.equal(h.button.title,'Activeaza modul intunecat');
  h.choose();assert.equal(h.button.getAttribute('aria-label'),'Activeaza modul luminos');
  h.root.lang='ro';h.root.dir='ltr';h.doc.dispatchEvent(new Event('dlkt:language-changed'));
  assert.equal(h.root.dataset.readerTheme,'night');assert.equal(h.button.title,'Activeaza modul luminos');
  assert.deepEqual(h.reads,[preferenceKey]);assert.deepEqual(h.writes,[[preferenceKey,'night']]);
});

test('toggling preserves URL, geography, focus, reading position, original nodes and icon identity',()=>{
  const h=harness({readyState:'interactive'}),href=h.url.href,bodyChildren=[...h.body.children],icons=[...h.button.children];
  for(let index=0;index<4;index++){
    h.choose();
    assert.equal(h.doc.activeElement,h.button);assert.equal(h.url.href,href);assert.equal(h.win.scrollY,482);
    assert.deepEqual(h.body.children,bodyChildren);assert.deepEqual(h.button.children,icons);
    assert.equal(h.headline.textContent,'東京の美術館、2026年の展示を発表');assert.equal(h.headline.lang,'ja');assert.equal(h.headline.dir,'auto');
    assert.equal(h.headline.getAttribute('translate'),'no');assert.equal(h.summary.textContent,'Original publisher excerpt remains unchanged.');
    assert.equal(h.root.lang,'ar');assert.equal(h.root.dir,'rtl');assert.equal(h.root.dataset.unrelated,'preserved');
    assert.equal(h.button.getAttribute('aria-pressed'),null);
  }
  assert.deepEqual(h.sideEffects,[]);assert.equal(h.data.get('private-profile-sentinel'),'unchanged');
});

test('DOM readiness binds once and a page without the optional control does not throw',()=>{
  const h=harness();h.ready();h.ready();h.choose();
  assert.equal(h.root.dataset.readerTheme,'night');assert.deepEqual(h.writes,[[preferenceKey,'night']]);assert.deepEqual(h.themeEvents,['prism','night']);
  const without=harness({missingButton:true});without.ready();
  assert.equal(without.root.dataset.readerTheme,'prism');assert.deepEqual(without.writeAttempts,[]);assert.deepEqual(without.themeEvents,[]);assert.deepEqual(without.sideEffects,[]);
});
