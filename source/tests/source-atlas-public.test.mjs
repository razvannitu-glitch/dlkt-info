import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderSourceAtlas} from '../scripts/source-atlas-public.mjs';
import {worldSourceAtlas} from '../.build/src/iceo/world-source-atlas.js';

test('render ICEO directory from exact configured, reviewed and discovery-only provenance without implied live counts',()=>{
 const registry=worldSourceAtlas();
 const view=renderSourceAtlas(registry);
 assert.match(view,/ICEO source universe/u);
 assert.match(view,/Configured source definitions/u);
 assert.match(view,/Recognised publisher origins/u);
 assert.match(view,/Discovery candidates/u);
 assert.ok(view.includes(registry.length+' source records'));
 assert.ok(view.includes('not real-time checks'));
 assert.ok(view.includes('Candidates are never enabled'));
 assert.equal((view.match(/<li>/gu)??[]).length,registry.length);
 assert.match(view,/GDELT Project/u);
 assert.match(view,/Fundatia Renasterea/u);
 assert.match(view,/HOSPICE Casa Sperantei/u);
 const page=readFileSync('public/sources.html','utf8');
 assert.equal(page.includes('id="iceo-source-atlas"'),false,'source template is unchanged; projection happens in isolated public build');
});

test('reject unsafe public HTML and do not permit candidate privilege escalation',()=>{
 const base=worldSourceAtlas().find(x=>x.status==='candidate');
 assert.ok(base);
 for(const entry of [
  {...base,name:'<svg onload=alert(1)>'},
  {...base,origin:'javascript:alert(1)'},
  {...base,origin:'http://example.com'},
  {...base,origin:'https://trusted.example.com/path'},
  {...base,origin:'https://trusted.example.com/?redirect=bad'},
  {...base,acquisition:'configured'},
  {...base,rights:'reviewed-until-expiry'},
 ]) {
  if(entry.name.includes('<svg')) assert.match(renderSourceAtlas([entry]),/&lt;svg onload=alert\(1\)&gt;/u);
  else assert.throws(()=>renderSourceAtlas([entry]),/ATLAS_PUBLIC_/u);
 }
 assert.throws(()=>renderSourceAtlas([base,base]),/ATLAS_PUBLIC_ENTRY_INVALID/u);
});

test('original HTML uses safe origin-only links, not active HTML from publisher names',()=>{
 const source=worldSourceAtlas().find(x=>x.status==='origin-reviewed');
 assert.ok(source);
 const output=renderSourceAtlas([{...source,name:'Reuters & More "News"'}]);
 assert.match(output,/Reuters &amp; More &quot;News&quot;/u);
 assert.doesNotMatch(output,/<script|onerror=|javascript:/iu);
});
