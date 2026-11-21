import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseDocument,DomUtils} from 'htmlparser2';
import {BRAND_NAME,BRAND_DESCRIPTOR,footerBrandLink,headerBrandLink} from '../.build/src/brand/identity.js';
import {LEGAL_DOCUMENTS,renderLegalDocument} from '../.build/src/legal/documents.js';
import {renderSharedError} from '../.build/src/share/render.js';
const read=p=>readFileSync(p,'utf8');
test('public wordmarks use the approved DLKT INFO name and the original Kate asset with accessible names',()=>{
 assert.equal(BRAND_NAME,'DLKT INFO');assert.equal(BRAND_DESCRIPTOR,'Daily Life. Key Things.');
 const pages=['public/iceo.html','public/account.html','public/wallet.html','public/organizations.html',...LEGAL_DOCUMENTS.map(d=>'public/'+d.slug+'.html')];
 for(const path of pages){const html=read(path),doc=parseDocument(html);assert.ok(html.includes(footerBrandLink()),path);assert.ok(html.includes(headerBrandLink()),path);const marks=DomUtils.findAll(n=>n.name==='a'&&n.attribs?.class?.split(/\s+/u).includes('brand'),doc.children);assert.ok(marks.length>=1,path);for(const a of marks){assert.equal(a.attribs['aria-label'],'DLKT INFO home');const imgs=DomUtils.findAll(n=>n.name==='img',a.children);assert.equal(imgs.length,1);assert.equal(imgs[0].attribs.src,'/kate-head.png');assert.equal(imgs[0].attribs.alt,'');const names=DomUtils.findAll(n=>n.attribs?.class==='brand-name',a.children),tags=DomUtils.findAll(n=>n.attribs?.class==='brand-tagline',a.children);assert.equal(names.length,1);assert.equal(DomUtils.textContent(names[0]),'DLKT');assert.equal(tags.length,1);assert.equal(DomUtils.textContent(tags[0]),BRAND_DESCRIPTOR);}}
 for(const path of pages){const doc=parseDocument(read(path));const icons=DomUtils.findAll(n=>n.name==='link'&&n.attribs?.rel==='icon',doc.children);assert.ok(icons.some(n=>n.attribs.href==='/favicon-kate-fb7b2e60.png'&&n.attribs.type==='image/png'),path);}
 assert.ok(renderSharedError(404).includes('/favicon-kate-fb7b2e60.png'));assert.ok(read('public/iceo.html').includes(footerBrandLink()));assert.ok(renderSharedError(404).includes(footerBrandLink()));
 for(const d of LEGAL_DOCUMENTS)assert.equal(read('public/'+d.slug+'.html'),renderLegalDocument(d));
});
test('favicon and touch artwork preserve the exact operator-hosted Kate image bytes',()=>{
 const bytes=readFileSync('public/kate-head.png');assert.equal(createHash('sha256').update(bytes).digest('hex'),'fb7b2e601e79a87cb984cb1445ed08687a81943d8ccbd4060570c2a21ef90309');assert.equal(bytes.readUInt32BE(16),180);assert.equal(bytes.readUInt32BE(20),180);
 const encoded=/href="data:image\/png;base64,([^"]+)"/u.exec(read('public/favicon.svg'))?.[1];assert.ok(encoded);assert.deepEqual(Buffer.from(encoded,'base64'),bytes);
 assert.deepEqual(readFileSync('public/favicon-kate-fb7b2e60.png'),bytes);assert.deepEqual(readFileSync('public/apple-touch-icon.png'),bytes);const ico=readFileSync('public/favicon.ico');assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),1);assert.equal(ico.readUInt32LE(18),22);assert.equal(ico.readUInt32LE(14),bytes.length);assert.deepEqual(ico.subarray(22),bytes);
 const m=JSON.parse(read('public/manifest.webmanifest'));assert.equal(m.name,'DLKT INFO');assert.equal(m.short_name,'DLKT INFO');assert.equal(m.icons[0].src,'/kate-head.png');
});
test('public curation ships the self-hosted identity assets and keeps the internal product identity stable',()=>{
 const script=read('scripts/prepare-public-release.mjs');assert.ok(script.includes("'kate-head.png'"));assert.ok(script.includes("'manifest.webmanifest'"));assert.match(read('src/core/contracts.ts'),/PRODUCT_ID = 'dlkt-info'/u);assert.match(read('src/legal/documents.ts'),/coverage limits remain visible/u);
});
