import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {parseDocument,DomUtils} from 'htmlparser2';
const read=path=>readFileSync(path,'utf8');
test('following ships the exact typed controller and pure model through resolvable public imports',()=>{
 for(const name of ['story-grouping','follow-stories','category-follow','editorial-subject-semantics','follow-browser']){
  const expected=read(`.build/src/iceo/${name}.js`).replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'')
   .replaceAll("'../i18n/browser.js'","'./i18n-browser.js'").replaceAll("'../share/link.js'","'./shared-card-link.js'");
  const actual=read(`public/${name}.js`);assert.equal(actual,expected);
  for(const match of actual.matchAll(/from\s*['"]\.\/([^'"]+\.js)['"]/gu))assert.ok(existsSync('public/'+match[1]),name+':'+match[1]);
  assert.doesNotMatch(actual,/from\s*['"](?:node:|\.\.\/)|innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(/u);
 }
 assert.doesNotMatch(read('src/iceo/follow-browser.ts'),/\b(?:fetch|setTimeout|setInterval)\s*\(|localStorage|sessionStorage|sendBeacon|document\.cookie/u);
});
test('the followed-topic summary is inside the daily selection before cards and starts hidden',()=>{
 const doc=parseDocument(read('public/iceo.html'));
 const nodes=DomUtils.findAll(node=>node.type==='tag',doc.children);
 const host=nodes.find(node=>node.attribs?.id==='following-brief'),cards=nodes.find(node=>node.attribs?.id==='discovery-cards');
 assert.ok(host);assert.equal(host.parent.attribs.id,'discovery');assert.equal(host.parent,cards.parent);assert.ok(Object.hasOwn(host.attribs,'hidden'));
 assert.ok(host.parent.children.indexOf(host)<host.parent.children.indexOf(cards));assert.equal(host.attribs['aria-labelledby'],'following-title');
 const styles=nodes.filter(node=>node.name==='link'&&node.attribs?.rel==='stylesheet').map(node=>node.attribs.href);
 assert.ok(styles.includes('/reading-follow.css'));assert.ok(styles.indexOf('/reading-follow.css')<styles.indexOf('/reader-theme.css'));
});
