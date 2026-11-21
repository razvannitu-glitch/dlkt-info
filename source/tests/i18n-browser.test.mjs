import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {parseDocument,DomUtils} from 'htmlparser2';
import {MESSAGES,messageParameters} from '../.build/src/i18n/catalog.js';
const read=path=>readFileSync(path,'utf8');

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
 for(const name of ['catalog','locale','browser']){
  const compiled=read(`.build/src/i18n/${name}.js`).replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll('../iceo/','./').replaceAll("'./catalog.js'","'./i18n-catalog.js'").replaceAll("'./locale.js'","'./i18n-locale.js'");
  const js=read(`public/i18n-${name}.js`);assert.equal(js,compiled);
  assert.doesNotMatch(js,/from\s*['"](?:node:|\.\.\/)|innerHTML|outerHTML|eval\s*\(/u);
  for(const match of js.matchAll(/from\s*['"]\.\/([^'"]+\.js)['"]/gu))assert.ok(existsSync('public/'+match[1]));
 }
});

test('language presentation has no storage/network side effects and original card titles are not translation keys',()=>{
 const js=read('src/i18n/browser.ts');assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|sendBeacon|navigator\.geolocation/u);
 assert.match(js,/history\.pushState/u);assert.match(js,/document\.documentElement\.dir/u);assert.match(js,/popstate/u);
 const main=read('src/iceo/browser.ts');assert.match(main,/element\.dir='auto'/u);assert.match(main,/element\.setAttribute\('translate','no'\)/u);assert.match(main,/originalText\(detail\)/u);assert.match(main,/originalText\(a,item\)/u);
 assert.doesNotMatch(main,/tr\(card\.(?:title|summary)/u);
});
