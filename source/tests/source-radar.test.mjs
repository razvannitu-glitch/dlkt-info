import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {worldSourceAtlas} from '../.build/src/iceo/world-source-atlas.js';
import {isRadarEntry,isRadarPayload,selectRadarEntries} from '../.build/src/iceo/source-radar-browser.js';

const data=JSON.parse(readFileSync('public/source-radar-data.json','utf8'));
const entries=worldSourceAtlas().map(({id,name,origin,vertical,scope,countryCode,status,acquisition,rights})=>
 ({id,name,origin,vertical,scope,countryCode,status,acquisition,rights}));
test('public world source directory is exact and source-pin reproducible',()=>{
 assert.equal(data.version,'dlkt-source-radar-1');
 assert.ok(isRadarPayload(data));
 assert.deepEqual(data.entries,entries,'catalog must not drift from trusted runtime definitions');
 const counts={
  configured:entries.filter(e=>e.status==='configured').length,
  reviewed:entries.filter(e=>e.status==='origin-reviewed').length,
  candidate:entries.filter(e=>e.status==='candidate').length,
 };
 assert.equal(counts.configured,51);
 assert.equal(counts.reviewed,73);
 assert.ok(counts.candidate>=40);
 assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
 assert.ok(entries.some(e=>e.scope==='country'&&e.countryCode==='RO'));
});
test('source discovery has no acquisition or rights escalation',()=>{
 const candidate=entries.find(e=>e.status==='candidate');
 assert.ok(candidate);
 assert.equal(isRadarEntry({...candidate,status:'configured'}),false);
 assert.equal(isRadarEntry({...candidate,rights:'reviewed-until-expiry'}),false);
 assert.equal(isRadarEntry({...candidate,acquisition:'configured'}),false);
 for(const origin of ['javascript:alert(1)','http://example.com','https://user@public.example.org',
  'https://public.example.org/relative','https://public.example.org?trick=1','https://public.example.org#fake','https://192.168.0.20','https://news.internal']){
  assert.equal(isRadarEntry({...candidate,origin}),false,origin);
 }
 assert.equal(isRadarEntry({...candidate,name:'<img src=x onerror=alert(1)>'}),false);
 assert.equal(isRadarPayload({...data,entries:[candidate,candidate]}),false);
});
test('inventory filters by true acquisition state, city/country scope and sector without mutating',()=>{
 const frozen=JSON.stringify(data.entries);
 const ro=selectRadarEntries(data.entries,{query:'RO',scope:'country',status:'all',vertical:'all'});
 assert.ok(ro.some(e=>e.countryCode==='RO'));
 assert.ok(ro.every(e=>e.scope==='country'));
 const candidate=selectRadarEntries(data.entries,{query:'',scope:'all',status:'candidate',vertical:'all'});
 assert.ok(candidate.length>0&&candidate.every(e=>e.acquisition==='discovery-only'));
 const news=selectRadarEntries(data.entries,{query:'',scope:'all',status:'all',vertical:'news'});
 assert.ok(news.length>0&&news.every(e=>e.vertical==='news'));
 assert.equal(JSON.stringify(data.entries),frozen);
});
test('source radar is accessible only on the existing sources page and uses curated public assets',()=>{
 const html=readFileSync('public/sources.html','utf8');
 const homepage=readFileSync('public/iceo.html','utf8');
 const style=readFileSync('public/source-radar.css','utf8');
 const browser=readFileSync('public/source-radar-browser.js','utf8');
 const script=readFileSync('scripts/prepare-public-release.mjs','utf8');
 for(const id of ['source-radar','source-radar-title','source-radar-search','source-radar-status',
  'source-radar-scope','source-radar-sector','source-radar-items','source-radar-more','source-radar-summary']) {
   assert.match(html,new RegExp('id="'+id+'"'),id);
 }
 assert.match(html,/href="#source-radar"/u);
 assert.match(html,/source-radar-browser\.js/u);
 assert.match(html,/source-radar\.css/u);
 assert.doesNotMatch(homepage,/source-radar-browser\.js/u);
 for(const file of ['source-radar-data.json','source-radar-browser.js','source-radar.css'])
  assert.ok(script.includes("'"+file+"'"),file+' missing from published asset set');
 assert.match(style,/@media\(max-width:680px\)/u);
 assert.match(style,/min-height:44px/u);
 assert.doesNotMatch(browser,/innerHTML|outerHTML|insertAdjacentHTML|document\.cookie|localStorage|eval\s*\(/u);
 assert.match(browser,/fetch\('\/source-radar-data\.json'/u);
 const compiled=readFileSync('.build/src/iceo/source-radar-browser.js','utf8')
  .replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'');
 assert.equal(browser,compiled,'runtime UI must equal compiled strict TypeScript');
});
test('source radar frontend renders, filters, paginates and never fetches arbitrary domains',async()=>{
 class Node {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.handlers=new Map();this.value='';this.hidden=false;this.textContent='';this.href='';this.rel='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children.flatMap(n=>n.tagName==='fragment'?n.children:[n]);}
  addEventListener(name,fn){this.handlers.set(name,fn);}
  dispatch(name){this.handlers.get(name)?.();}
 }
 const nodes=new Map();
 for(const id of ['source-radar-search','source-radar-status','source-radar-scope','source-radar-sector','source-radar-items','source-radar-summary','source-radar-count','source-radar-more'])nodes.set(id,new Node());
 nodes.get('source-radar-status').value='all';
 nodes.get('source-radar-scope').value='all';
 nodes.get('source-radar-sector').value='all';
 const root={querySelector(selector){return nodes.get(selector.slice(1))??null;}};
 const originalDocument=globalThis.document,originalFetch=globalThis.fetch;
 const requested=[];
 globalThis.document={
  getElementById(id){return id==='source-radar'?root:null;},
  createElement(tag){return new Node(tag);},
  createTextNode(text){const node=new Node('text');node.textContent=text;return node;},
  createDocumentFragment(){return new Node('fragment');}
 };
 globalThis.fetch=async(url,options)=>{requested.push({url,options});return{ok:true,json:async()=>data};};
 try{
  const mod=new URL('../.build/src/iceo/source-radar-browser.js?dom-test',import.meta.url);
  await import(mod.href);
  for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requested.length,1);
  assert.equal(requested[0].url,'/source-radar-data.json');
  assert.equal(requested[0].options.credentials,'omit');
  assert.match(nodes.get('source-radar-summary').textContent,/configured definitions/u);
  assert.equal(nodes.get('source-radar-items').children.length,24);
  assert.equal(nodes.get('source-radar-more').hidden,false);
  nodes.get('source-radar-more').dispatch('click');
  assert.equal(nodes.get('source-radar-items').children.length,48);
  nodes.get('source-radar-status').value='candidate';
  nodes.get('source-radar-status').dispatch('change');
  assert.equal(nodes.get('source-radar-items').children.length,24);
  assert.ok(nodes.get('source-radar-items').children.every(child=>child.children.some(node=>node.children.some(text=>text.textContent.includes('Discovery candidate')))));
  nodes.get('source-radar-search').value='unrelated fictional 0000';
  nodes.get('source-radar-search').dispatch('input');
  assert.equal(nodes.get('source-radar-items').children.length,0);
  assert.equal(nodes.get('source-radar-more').hidden,true);
 }finally{
  if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
  if(originalFetch===undefined)delete globalThis.fetch;else globalThis.fetch=originalFetch;
 }
});

