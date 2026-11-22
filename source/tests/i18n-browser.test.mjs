import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {parseDocument,DomUtils} from 'htmlparser2';
import {MESSAGES,messageParameters} from '../.build/src/i18n/catalog.js';
import {t as localize} from '../.build/src/i18n/locale.js';
import {applyInterfaceLanguage} from '../.build/src/i18n/browser.js';
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
 for(const name of ['catalog','locale','browser','reading-messages','media-messages']){
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
