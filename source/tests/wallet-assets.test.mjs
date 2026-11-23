import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

test('deployed Wallet import graph is closed inside browser-safe public assets',()=>{
 const root=path.resolve('public'),seen=new Set(),queue=['wallet-browser.js','wallet-home-browser.js'];
 while(queue.length){
  const name=queue.shift();if(seen.has(name))continue;seen.add(name);
  const file=path.resolve(root,name);assert.ok(file.startsWith(root+path.sep));assert.ok(existsSync(file),`Missing public module: ${name}`);
  const source=readFileSync(file,'utf8');
  assert.doesNotMatch(source,/node:|Authorization:|sb_secret_|service_role|gmail\.googleapis\.com/u,`Server-only content in ${name}`);
  for(const match of source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/gu)){
   assert.ok(match[2].startsWith('./'),`Unexpected browser import: ${name} -> ${match[2]}`);
   queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[2])));
  }
 }
 assert.ok(seen.has('wallet-contracts.js'));assert.ok(seen.has('wallet-providers.js'));assert.ok(seen.has('data-guards.js'));
 for(const name of ['connections-browser.js','connections-types.js','wallet-events.js']) assert.ok(seen.has(name),`New connection flow missing from emitted graph: ${name}`);
 assert.ok(!seen.has('wallet-gmail.js'));assert.ok(!seen.has('wallet-store.js'));
});

test('Info Wallet preserves the authorized shared frame and original Kate identity assets',()=>{
 const baseline=JSON.parse(readFileSync('RELEASE-0.9.42.json','utf8'));
 for(const file of ['public/iceo.css','public/header.css','public/kate-head.png','public/favicon-kate-fb7b2e60.png']){
  // Shared header/footer redesign authorized 22 November 2026; compact utility ribbon authorized 23 November 2026. Original reader-card geometry and Kate artwork retain their earlier pins.
  const expected=file==='public/iceo.css'?'ca44cec850985e847f47f01dee10fabe28009ad113ca37936c41153a99401728':file==='public/header.css'?'ec09ceb304ef27eeabf583ed9c6c21e83e8aff325c660e8e53b178a3fe0d1156':baseline.files[file];
  // The shared frame is pinned as raw bytes; only the existing reader-card normalizations remain.
  let content=file==='public/iceo.css'?readFileSync(file,'utf8').replaceAll('#discovery-cards,#world-cards,','#discovery-cards,'):readFileSync(file);
  if(file==='public/iceo.css'){
   // Uniform 16:9 photo frames with balanced 16px side insets authorized 22 November 2026. All other bytes remain pinned.
   const photoRules=[
    ['.card-photo-frame{position:relative;aspect-ratio:16/9;min-width:0;min-height:0;margin-inline:16px;border-radius:10px;background:var(--black);overflow:hidden}', '.card-photo-frame{aspect-ratio:16/9;background:var(--black);overflow:hidden}'],
    ['.card-photo img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover}', '.card-photo img{display:block;width:100%;height:100%;object-fit:cover}'],
   ];
   for(const [approved,original]of photoRules){
    assert.equal(content.split(approved).length,2,'Exactly one approved photo geometry rule');
    content=content.replace(approved,original);
   }
  }
  if(file==='public/header.css'){
   assert.equal(content.toString().split('@media(max-width:1152px){').length,2,'Exactly one compact navigation breakpoint');
   assert.equal(readFileSync('src/entry/header.ts','utf8').split("matchMedia('(max-width: 1152px)')").length,2,'Header disclosure matches the stylesheet breakpoint');
  }
  // Reader normalization preserves its earlier pin; the new shared frame and unchanged Kate assets are exact.
  assert.equal(createHash('sha256').update(content).digest('hex'),expected,file);
 }
});
