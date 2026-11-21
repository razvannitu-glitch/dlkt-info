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
  // Full header redesign authorized 20 November 2026; original artwork remains pinned to the earlier release.
  const expected=file==='public/iceo.css'?'5cef7425d372494aa4ced0a7dc426bdbadbdf0ba271b2de7de1a15bb26b95585':file==='public/header.css'?'3438c5339e50762e5409d9a84b9e3220ab3f1a531a28fd3df8725fcf247fde4c':baseline.files[file];
  // Explore only extends existing card selectors; every original byte remains protected.
  const content=file==='public/iceo.css'?readFileSync(file,'utf8').replaceAll('#discovery-cards,#world-cards,','#discovery-cards,'):readFileSync(file);
  assert.equal(createHash('sha256').update(content).digest('hex'),expected,file);
 }
});
