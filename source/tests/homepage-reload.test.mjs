import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const compiled=readFileSync(new URL('../.build/src/entry/reload.js',import.meta.url),'utf8').replace(/^export \{\};\r?\n?/gmu,'');
const script=new Script(compiled,{filename:'entry-reload.js'});
function harness({type='reload',hash='',pathname='/',restoration='auto'}={}){
 const window=new EventTarget(),document=new EventTarget(),frames=new Map();
 let scroll=900,id=0,calls=0;
 Object.assign(window,{location:{hash,pathname},history:{scrollRestoration:restoration},
  performance:{getEntriesByType:name=>name==='navigation'?[{type}]:[]},
  scrollTo(options){assert.equal(options.top,0);assert.equal(options.left,0);assert.equal(options.behavior,'instant');scroll=0;calls++;},
  requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame(n){frames.delete(n);}});
 script.runInNewContext({window,document});
 return {window,document,get scroll(){return scroll},get calls(){return calls},setScroll(value){scroll=value},
  fire(target,type,persisted=false){const e=new Event(type);Object.defineProperty(e,'persisted',{value:persisted});target.dispatchEvent(e);},
  frame(){const f=[...frames.values()];frames.clear();for(const callback of f)callback();},frames};
}
test('plain homepage reload resets before and after the browser restores the previous position',()=>{
 const h=harness();assert.equal(h.scroll,0);assert.equal(h.window.history.scrollRestoration,'manual');
 h.setScroll(600);h.fire(h.document,'DOMContentLoaded');assert.equal(h.scroll,0);
 h.setScroll(750);h.fire(h.window,'load');assert.equal(h.scroll,0);
 h.setScroll(810);h.fire(h.window,'pageshow');assert.equal(h.scroll,0);
 h.setScroll(700);h.frame();assert.equal(h.scroll,0);
 h.setScroll(900);h.frame();assert.equal(h.scroll,0);
 assert.equal(h.window.history.scrollRestoration,'auto');assert.equal(h.frames.size,0);
 h.setScroll(300);h.fire(h.window,'load');assert.equal(h.scroll,300);
});
test('ordinary navigation, back forward, deep links and other pages are not affected',()=>{
 for(const opts of [{type:'navigate'},{type:'back_forward'},{hash:'#know/example'},{hash:'#saved'},{hash:'#briefing'},{pathname:'/wallet'}]){
  const h=harness(opts);assert.equal(h.calls,0);assert.equal(h.scroll,900);assert.equal(h.window.history.scrollRestoration,'auto');
 }
});
test('real user interaction or a new fragment cancels all remaining resets and restores navigation policy',()=>{
 for(const event of ['wheel','touchstart','pointerdown','keydown','hashchange','pagehide']){
  const h=harness();h.fire(h.window,'pageshow');h.fire(h.window,event);h.setScroll(350);h.frame();h.fire(h.window,'load');
  assert.equal(h.scroll,350,event);assert.equal(h.window.history.scrollRestoration,'auto',event);assert.equal(h.frames.size,0,event);
 }
 const restored=harness({restoration:'manual'});restored.fire(restored.window,'pageshow',true);assert.equal(restored.window.history.scrollRestoration,'manual');
});
test('homepage loads the independent synchronous guard before CSS; no styling or data dependency',()=>{
 const html=readFileSync(new URL('../public/iceo.html',import.meta.url),'utf8');
 const tag='<script src="/entry-reload.js"></script>';assert.equal(html.split(tag).length,2);
 assert.ok(html.indexOf(tag)<html.indexOf('rel="stylesheet"'));
});
