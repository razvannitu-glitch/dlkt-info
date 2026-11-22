import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseDocument,DomUtils} from 'htmlparser2';
import {NewsMasonry,newsMasonryPositions} from '../.build/src/iceo/news-masonry.js';

test('two hundred variable-height articles retain DOM order and exact gaps beyond grid track limits',()=>{
 const heights=Array.from({length:200},(_,index)=>260.25+(index%7)*67.5),positions=newsMasonryPositions(heights,2);
 assert.equal(positions.length,heights.length);
 const bottom=[0,0];let priorTop=-1,max=0;
 positions.forEach((position,index)=>{
  assert.ok(position.top>=priorTop,'visual starts follow the DOM sequence');priorTop=position.top;
  assert.equal(position.top,bottom[position.column-1]);assert.equal(position.height,heights[index]);
  bottom[position.column-1]=position.top+position.height+16;max=Math.max(max,position.top+position.height);
 });
 assert.ok(max>40000,'long feeds do not depend on implicit grid track counts');
 const single=newsMasonryPositions(heights,1);single.forEach((position,index)=>{assert.equal(position.column,1);if(index)assert.equal(position.top,single[index-1].top+heights[index-1]+16);});
 assert.deepEqual(newsMasonryPositions(heights.slice(0,20),2),positions.slice(0,20),'appending retains every existing placement');
});

function harness(t,heights=[300,160,200,120]){
 const original=Object.getOwnPropertyDescriptor(globalThis,'ResizeObserver'),observers=[],frames=new Map(),events=new Map();let nextFrame=0,scroll=0;
 class Observer{
  constructor(callback){this.callback=callback;this.observed=new Set();this.removed=[];this.closed=false;observers.push(this);}
  observe(node){this.observed.add(node);}unobserve(node){this.observed.delete(node);this.removed.push(node);}
  disconnect(){this.closed=true;this.observed.clear();}
 }
 Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:Observer});
 t.after(()=>original?Object.defineProperty(globalThis,'ResizeObserver',original):delete globalThis.ResizeObserver);
 const style=()=>({removeProperty(name){delete this[name.replace(/-([a-z])/gu,(_,letter)=>letter.toUpperCase())];}});
 const doc={activeElement:null,defaultView:null};
 const win={innerHeight:500,requestAnimationFrame(fn){const id=++nextFrame;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},
  addEventListener(type,fn){events.set(type,fn);},removeEventListener(type,fn){if(events.get(type)===fn)events.delete(type);},
  getComputedStyle(){return {getPropertyValue:name=>name==='--news-columns'?String(root.columns):''};},scrollBy(x,y){assert.equal(x,0);scroll+=y;}};
 doc.defaultView=win;
 const root={dataset:{},style:style(),ownerDocument:doc,isConnected:true,columns:2,width:784,cards:[],listeners:new Map(),
  querySelectorAll(selector){assert.equal(selector,':scope > [data-news-stream-key]');return this.cards;},
  addEventListener(type,fn,capture){assert.equal(capture,true);this.listeners.set(type,fn);},
  removeEventListener(type,fn,capture){assert.equal(capture,true);if(this.listeners.get(type)===fn)this.listeners.delete(type);},
  getBoundingClientRect(){return {width:this.width,top:100-scroll,bottom:100-scroll+Number.parseFloat(this.style.height??'0')};}};
 const card=(height,id)=>({id,style:style(),height,isConnected:true,ownerDocument:doc,
  closest(){return this;},getBoundingClientRect(){const top=100-scroll+Number.parseFloat(this.style.top??'0');return {top,bottom:top+this.height,height:this.height,width:Number.parseFloat(this.style.width??'0')};}});
 root.cards=heights.map((height,index)=>card(height,index));
 const layout=new NewsMasonry(root);
 const flush=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(0);};
 return {root,doc,layout,observers,frames,events,flush,card,scroll:()=>scroll,scrollTo:value=>{scroll=value;}};
}
test('the controller measures final width, preserves order, sizes its container and reflows details or failed photos once',t=>{
 const h=harness(t),nodes=[...h.root.cards];h.layout.update();
 assert.deepEqual(h.root.cards,nodes);assert.equal(h.root.dataset.newsMasonry,'true');
 assert.ok(nodes.every(node=>node.style.width==='384px'));
 assert.deepEqual(nodes.map(node=>[node.style.insetInlineStart,node.style.top]),[['0px','0px'],['400px','0px'],['400px','176px'],['0px','316px']]);
 assert.equal(h.root.style.height,'436px','the continuation follows the actual lowest card');
 nodes[1].height=400;h.root.listeners.get('toggle')();h.root.listeners.get('load')();h.root.listeners.get('error')();
 assert.equal(h.frames.size,1);h.flush();assert.equal(nodes[2].style.top,'316px');assert.equal(nodes[3].style.top,'416px');assert.equal(h.root.style.height,'536px');
 const observer=h.observers[0];observer.callback([{target:h.root,contentRect:{width:784,height:536}}]);h.flush();
 observer.callback([{target:h.root,contentRect:{width:784,height:800}}]);assert.equal(h.frames.size,0,'container height changes do not create a ResizeObserver loop');
 h.layout.disconnect();
});
test('320px viewports use one unbroken column and append positions keep the first page intact',t=>{
 const h=harness(t),nodes=[...h.root.cards];h.layout.update();
 const before=nodes.map(node=>[node.style.top,node.style.insetInlineStart]);
 h.root.cards.push(h.card(180,5));h.layout.update();assert.deepEqual(nodes.map(node=>[node.style.top,node.style.insetInlineStart]),before);
 h.root.columns=1;h.root.width=292;h.events.get('resize')();h.flush();
 assert.ok(h.root.cards.every(node=>node.style.width==='292px'&&node.style.insetInlineStart==='0px'));
 h.root.cards.forEach((node,index)=>{if(index)assert.equal(Number.parseFloat(node.style.top),Number.parseFloat(h.root.cards[index-1].style.top)+h.root.cards[index-1].height+16);});
 assert.deepEqual(h.root.cards.slice(0,4),nodes);
 h.layout.disconnect();
});
test('image/detail reflow retains the focused visible article and disconnect releases every observer and listener',t=>{
 const h=harness(t,[300,160,200,120,250]);h.layout.update();h.scrollTo(200);h.doc.activeElement=h.root.cards[2];
 const anchor=h.root.cards[2],before=anchor.getBoundingClientRect().top;
 h.root.cards[1].height=450;h.observers[0].callback([{target:h.root.cards[1]}]);h.flush();
 assert.equal(anchor.getBoundingClientRect().top,before);assert.ok(h.scroll()>200);
 const removed=h.root.cards.pop();removed.isConnected=false;h.layout.update();assert.ok(h.observers[0].removed.includes(removed));
 h.root.listeners.get('error')();assert.equal(h.frames.size,1);h.layout.disconnect();h.layout.disconnect();
 assert.equal(h.frames.size,0);assert.equal(h.observers[0].closed,true);assert.equal(h.events.size,0);assert.equal(h.root.listeners.size,0);
 assert.equal(h.root.dataset.newsMasonry,undefined);assert.equal(h.root.style.height,undefined);
 assert.ok(h.root.cards.every(node=>node.style.top===undefined&&node.style.width===undefined&&node.style.insetInlineStart===undefined));
 h.observers[0].callback([{target:h.root,contentRect:{width:500}}]);assert.equal(h.frames.size,0);
});
test('empty and unsupported-observer layouts keep a readable fallback and no abandoned scheduled frame',t=>{
 const h=harness(t,[]);h.layout.update();assert.equal(h.root.dataset.newsMasonry,undefined);assert.equal(h.root.style.height,undefined);h.layout.disconnect();
 Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:undefined});
 const next=new NewsMasonry(h.root);h.root.cards.push(h.card(120,1));next.update();assert.equal(h.root.style.height,'120px');
 h.root.cards=[];next.update();assert.equal(h.root.style.height,undefined);assert.equal(h.root.dataset.newsMasonry,undefined);next.disconnect();
});
test('News has one compact accessible toolbar and separate continuation/supporting regions, preserving original photo geometry',()=>{
 const html=readFileSync('public/iceo.html','utf8'),doc=parseDocument(html),nodes=DomUtils.findAll(node=>Boolean(node.attribs?.id),doc.children);
 const byId=id=>{const matches=nodes.filter(node=>node.attribs.id===id);assert.equal(matches.length,1,id);return matches[0];};
 const news=byId('discovery'),cards=byId('discovery-cards'),toolbar=byId('home-news-toolbar');
 for(const id of ['home-more-controls','home-local-cards'])assert.equal(byId(id).parent,news);
 assert.equal(cards.parent,news);assert.equal(toolbar.parent,news);
 const picker=byId('home-news-category');assert.equal(picker.name,'select');assert.equal(picker.attribs['aria-describedby'],'home-news-progress');
 assert.equal(byId('home-news-category-label').attribs.for,'home-news-category');
 assert.equal(byId('discovery-status').attribs['aria-live'],'polite');assert.equal(byId('home-news-progress').attribs['aria-live'],'off');
 const css=readFileSync('public/editorial-cards.css','utf8'),module=readFileSync('src/iceo/news-masonry.ts','utf8');
 assert.match(css,/#discovery-cards\[data-news-masonry=true\]\{display:block;position:relative;overflow-anchor:none\}/u);
 assert.doesNotMatch(module,/\.sort\(|appendChild|insertBefore|gridRow|gridColumn|innerHTML/u);
 assert.match(css,/\.photo-editorial \.card-photo-frame\{aspect-ratio:16\/9;min-width:0;min-height:0/u);
 assert.match(css,/@media\(max-width:700px\)\{[\s\S]*?#discovery-cards\{--news-columns:1\}/u);
 const compiled=readFileSync('.build/src/iceo/news-masonry.js','utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'');
 assert.equal(readFileSync('public/news-masonry.js','utf8'),compiled);
});

test('manual continuation focuses a visible new title after final placement while automatic continuation preserves focus',()=>{
 const source=readFileSync('.build/src/iceo/browser.js','utf8'),start=source.indexOf('function showNewsPage(focus)'),end=source.indexOf("required('#discovery').addEventListener('click'",start);
 assert.ok(start>=0&&end>start);const body=source.slice(start,end);
 let laidOut=false,focuses=0,scrolls=0;const old={dataset:{newsStreamKey:'old'}},heading={tabIndex:0,focus(options){assert.equal(laidOut,true);assert.equal(options.preventScroll,true);focuses++;},getBoundingClientRect(){assert.equal(laidOut,true);return {top:-140,bottom:-100};},scrollIntoView(options){assert.equal(options.block,'nearest');scrolls++;}};
 const added={dataset:{newsStreamKey:'new'},querySelector(){return heading;}};let nodes=[old];
 const context={document:{visibilityState:'visible',body:{dataset:{entryView:'start'}}},innerHeight:700,NEWS_PAGE_SIZE:20,newsAvailable:60,
  required:()=>({querySelectorAll:()=>nodes}),renderDiscovery:()=>{laidOut=true;nodes=[old,added];},announcement:{textContent:''},getLocale:()=> 'en'};
 runInNewContext('var continuationCount=20;'+body+';showNewsPage(true);',context);
 assert.equal(context.continuationCount,40);assert.equal(focuses,1);assert.equal(scrolls,1);assert.equal(heading.tabIndex,-1);
 runInNewContext('showNewsPage(false);',context);assert.equal(context.continuationCount,60);assert.equal(focuses,1);assert.equal(scrolls,1);
 const render=source.slice(source.indexOf('function renderDiscovery()'),source.indexOf('function showNewsPage(focus)'));
 assert.ok(render.indexOf('newsMasonry.update()')<render.indexOf('observeNewsStream(sentinel'));
 assert.ok(render.indexOf('newsMasonry.update()')<render.indexOf('const anchor = anchors.find'));
});
