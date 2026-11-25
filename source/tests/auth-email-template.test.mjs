import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDocument,DomUtils} from 'htmlparser2';
import {LOCALES} from '../.build/src/i18n/locale.js';
import {WELCOME_COPY} from '../.build/src/brand/welcome-copy.js';
import {authenticationEmailRedirect} from '../.build/src/identity/email-locale.js';
import {authenticationEmailTemplate,authenticationEmailPreview,AUTHENTICATION_EMAIL_KATE,AUTHENTICATION_EMAIL_SUBJECT} from '../.build/src/identity/email-template.js';
const template=readFileSync('templates/auth-otp.html','utf8');
const tags=html=>DomUtils.findAll(node=>node.type==='tag',parseDocument(html).children);
// This bounded interpreter checks the generated if/else structure, not hosted Go execution.
function renderReviewedIfSubset(input,redirect,token){
  const rendered=input.replace(/\{\{ if eq \.RedirectTo "([^"]+)" \}\}([\s\S]*?)\{\{ end \}\}/gu,(_block,first,rest)=>{
    const parts=rest.split(/\{\{ else if eq \.RedirectTo "([^"]+)" \}\}/u);
    const choices=[[first,parts[0]]];
    for(let i=1;i<parts.length;i+=2)choices.push([parts[i],parts[i+1]]);
    const last=choices.at(-1),tail=last[1].split('{{ else }}');
    assert.equal(tail.length,2);last[1]=tail[0];
    return choices.find(([target])=>target===redirect)?.[1]??tail[1];
  }).replace('{{ .Token }}',token);
  assert.doesNotMatch(rendered,/\{\{|\}\}|__DLKT_/u);return rendered;
}
test('versioned hosted OTP template equals the reviewed builder and exposes no authentication link',()=>{
  assert.equal(template,authenticationEmailTemplate());
  assert.equal((template.match(/\{\{ \.Token \}\}/gu)??[]).length,1);
  assert.doesNotMatch(template,/\.(?:TokenHash|ConfirmationURL|Data|Email)|<a\b|<script\b|<iframe\b|<form\b|onload=|onclick=|url\(/iu);
  assert.equal(AUTHENTICATION_EMAIL_SUBJECT,'DLKT · Daily Life. Key Things.');
  assert.equal(AUTHENTICATION_EMAIL_KATE,'https://www.dlkt.ee/kate-head.png');
  assert.ok(Buffer.byteLength(template,'utf8')<65536);
});
test('every catalog language selects its own current-request copy, direction and readable synthetic code',()=>{
  assert.deepEqual(Object.keys(WELCOME_COPY).sort(),LOCALES.map(item=>item.code).sort());
  for(const locale of LOCALES){
    const rendered=renderReviewedIfSubset(template,authenticationEmailRedirect(locale.code),'00000000');
    assert.equal(rendered,authenticationEmailPreview(locale.code),locale.code);
    const nodes=tags(rendered),html=nodes.find(node=>node.name==='html');
    assert.equal(html.attribs.lang,locale.code);assert.equal(html.attribs.dir,locale.direction);
    const title=nodes.find(node=>node.name==='h1');assert.equal(DomUtils.textContent(title),WELCOME_COPY[locale.code].title);
    const code=nodes.find(node=>node.name==='p'&&DomUtils.textContent(node)==='00000000');
    assert.ok(code,locale.code);assert.equal(code.attribs.dir,'ltr');
    const images=nodes.filter(node=>node.name==='img');assert.equal(images.length,1);
    assert.equal(images[0].attribs.src,AUTHENTICATION_EMAIL_KATE);assert.equal(images[0].attribs.alt,'Kate');
    assert.ok(nodes.filter(node=>node.name==='p').some(node=>DomUtils.textContent(node)===WELCOME_COPY[locale.code].value),locale.code);
    for(const table of nodes.filter(node=>node.name==='table'))assert.equal(table.attribs.role,'presentation');
  }
});
test('unknown or altered redirect uses English; no stale metadata can override an explicit English request',()=>{
  for(const redirect of ['', 'https://www.dlkt.ee/', 'https://evil.example/account?lang=ro',
    'https://www.dlkt.ee/account?lang=ro&extra=1','https://www.dlkt.ee/account?lang=ro-RO',
    'https://www.dlkt.ee/account?lang=en']){
    assert.equal(renderReviewedIfSubset(template,redirect,'00000000'),authenticationEmailPreview('en'),redirect);
  }
  assert.doesNotMatch(template,/\.Data|metadata|user_metadata/u);
});
test('preview refuses a real code or unshipped locale and remains readable without images',()=>{
  for(const token of ['12345678','<img src=x onerror=alert(1)>','000','00000000000']){
    assert.throws(()=>authenticationEmailPreview('en',token),/PREVIEW_TOKEN_INVALID/u);
  }
  assert.throws(()=>authenticationEmailPreview('xx'),/LOCALE_INVALID/u);
  const preview=authenticationEmailPreview('ro').replace(/<img\b[^>]*>/gu,'');
  const text=DomUtils.textContent(parseDocument(preview));
  assert.ok(text.includes(WELCOME_COPY.ro.title));assert.ok(text.includes(WELCOME_COPY.ro.value));
  assert.ok(text.includes('00000000'));assert.ok(text.includes('Daily Life. Key Things.'));
});
