import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';

function browserImports(source, name) {
 const file = ts.createSourceFile(name, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
 assert.equal(file.parseDiagnostics.length, 0, `Invalid browser module syntax: ${name}`);
 const imports = [];
 const visit = node => {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
   assert.ok(ts.isStringLiteral(node.moduleSpecifier), `Nonliteral browser import: ${name}`);
   imports.push(node.moduleSpecifier.text);
  } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
   assert.ok(node.arguments.length >= 1 && ts.isStringLiteral(node.arguments[0]), `Nonliteral browser import: ${name}`);
   imports.push(node.arguments[0].text);
  }
  ts.forEachChild(node, visit);
 };
 visit(file);
 return imports;
}

test('browser import discovery distinguishes stopwords from static and dynamic module edges', () => {
 const source = "const words = ['from', 'import', 'source']; import {read} from './reader.js'; "
  + "export {city} from './local-contracts.js'; const lazy = import('./daily-reading.js');";
 assert.deepEqual(browserImports(source, 'fixture.js'), ['./reader.js', './local-contracts.js', './daily-reading.js']);
 assert.throws(() => browserImports("const path = './reader.js'; import(path);", 'fixture.js'), /Nonliteral browser import/u);
 assert.throws(() => browserImports("import {broken from './reader.js';", 'fixture.js'), /Invalid browser module syntax/u);
});

test('deployed Wallet import graph is closed inside browser-safe public assets',()=>{
 const root=path.resolve('public'),seen=new Set(),queue=['wallet-browser.js','wallet-home-browser.js'];
 while(queue.length){
  const name=queue.shift();if(seen.has(name))continue;seen.add(name);
  const file=path.resolve(root,name);assert.ok(file.startsWith(root+path.sep));assert.ok(existsSync(file),`Missing public module: ${name}`);
  const source=readFileSync(file,'utf8');
  assert.doesNotMatch(source,/node:|Authorization:|sb_secret_|service_role|gmail\.googleapis\.com/u,`Server-only content in ${name}`);
  for(const specifier of browserImports(source, name)){
   assert.ok(specifier.startsWith('./'),`Unexpected browser import: ${name} -> ${specifier}`);
   queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(name),specifier)));
  }
 }
 assert.ok(seen.has('wallet-contracts.js'));assert.ok(seen.has('wallet-providers.js'));assert.ok(seen.has('data-guards.js'));
 for(const name of ['connections-browser.js','connections-types.js','wallet-events.js']) assert.ok(seen.has(name),`New connection flow missing from emitted graph: ${name}`);
 assert.ok(!seen.has('wallet-gmail.js'));assert.ok(!seen.has('wallet-store.js'));
});

test('Info Wallet preserves the authorized shared frame and original Kate identity assets',()=>{
 const baseline=JSON.parse(readFileSync('RELEASE-0.9.42.json','utf8'));
 for(const file of ['public/iceo.css','public/header.css','public/kate-head.png','public/favicon-kate-fb7b2e60.png']){
  // Shared header/footer redesign authorized 22 November; mobile date and layout
  // stabilization requested 24 November; category and account control refinements
  // authorized 25 November 2026. Shared header and Kate artwork stay pinned.
  const expected=file==='public/iceo.css'?'4c65659c7ff37941ab10f3aef887f921ac663f375167696f6d535dabcb4c15f8':file==='public/header.css'?'0c6bbc8d515c798b377592ad91afa720fa71adda521a7f27d78cc2c95b19aef5':baseline.files[file];
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

