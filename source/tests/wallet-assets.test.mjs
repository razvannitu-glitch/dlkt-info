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

test('Info Wallet preserves the approved header stylesheet and original Kate identity assets',()=>{
 const baseline=JSON.parse(readFileSync('RELEASE-0.9.42.json','utf8'));
 for(const file of ['public/iceo.css','public/header.css','public/kate-head.png','public/favicon-kate-fb7b2e60.png']){
  // Header redesign authorized 20 November; identical card selectors now include the separate local host, authorized 22 November 2026. Original artwork keeps its earlier pin.
  const expected=file==='public/iceo.css'?'ca44cec850985e847f47f01dee10fabe28009ad113ca37936c41153a99401728':file==='public/header.css'?'3438c5339e50762e5409d9a84b9e3220ab3f1a531a28fd3df8725fcf247fde4c':baseline.files[file];
  // Explore only extends existing card selectors; the header adds approved head sizing and the matching compact breakpoint.
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
   const sizing='/* The original 180px head has 6px transparent edges; 64px balances the full visible wordmark and tagline. */\n.site-header a.brand.brand-header{grid-template-columns:64px max-content}\n.site-header .brand-header .kate-mark{grid-row:1/-1;width:64px;height:64px;align-self:end}\n';
   const header=content.toString();assert.equal(header.split(sizing).length,2,'Exactly one header-only sizing override');
   const compact='@media(max-width:1152px){';
   assert.equal(header.split(compact).length,2,'Exactly one approved compact breakpoint');
   assert.equal(readFileSync('src/entry/header.ts','utf8').split("matchMedia('(max-width: 1152px)')").length,2,'Header disclosure matches the stylesheet breakpoint');
   content=header.replace(sizing,'').replace(compact,'@media(max-width:1024px){');
  }
  // Reverting only those approved changes must reproduce every original byte, including footer and navigation.
  assert.equal(createHash('sha256').update(content).digest('hex'),expected,file);
 }
});
