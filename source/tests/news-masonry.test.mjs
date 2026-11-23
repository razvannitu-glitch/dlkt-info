import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseDocument,DomUtils} from 'htmlparser2';
import {NewsMasonry,newsMasonryPositions} from '../.build/src/iceo/news-masonry.js';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {selectInlineKnowledge,interleaveKnowledge} from '../.build/src/iceo/knowledge-stream.js';

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
 assert.match(css,/\.news-category:after\{[^}]*border:solid var\(--black\)[^}]*pointer-events:none/u);
 assert.match(css,/#home-news-category:focus-visible\{outline:2px solid var\(--reader-focus,var\(--black\)\)/u);
 assert.doesNotMatch(module,/\.sort\(|appendChild|insertBefore|gridRow|gridColumn|innerHTML/u);
 assert.match(css,/\.photo-editorial \.card-photo-frame\{aspect-ratio:16\/9;min-width:0;min-height:0/u);
 assert.match(css,/@media\(max-width:700px\)\{[\s\S]*?#discovery-cards\{--news-columns:1\}/u);
 const compiled=readFileSync('.build/src/iceo/news-masonry.js','utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'');
 assert.equal(readFileSync('public/news-masonry.js','utf8'),compiled);
});

test('manual continuation awaits its page and focuses after final placement while automatic continuation preserves focus',async()=>{
 const source=readFileSync('.build/src/iceo/browser.js','utf8'),start=source.indexOf('async function showNewsPage(focus)'),end=source.indexOf("required('#discovery').addEventListener('click'",start);
 assert.ok(start>=0&&end>start);const body=source.slice(start,end);
 let laidOut=false,focuses=0,scrolls=0,requests=0,renders=0,finishNext;
 const old={dataset:{newsStreamKey:'old'},height:300};
 const heading={tabIndex:0,focus(options){assert.equal(laidOut,true);assert.equal(options.preventScroll,true);focuses++;},
  getBoundingClientRect(){assert.equal(laidOut,true);return {top:-140,bottom:-100};},
  scrollIntoView(options){assert.equal(options.block,'nearest');assert.equal(options.behavior,'auto');scrolls++;}};
 const added={dataset:{newsStreamKey:'new-manual'},height:160,querySelector(selector){assert.equal(selector,'h3');return heading;}};
 const automatic={dataset:{newsStreamKey:'new-auto'},height:200,querySelector(){throw Error('automatic continuation must not move focus');}};
 let nodes=[old],state={loading:false,error:null,page:{nextCursor:'next'},items:[old]};
 let placements=newsMasonryPositions(nodes.map(node=>node.height),2),language='en';
 const announcement={textContent:''};
 const context={document:{visibilityState:'visible',body:{dataset:{entryView:'start'}}},innerHeight:700,newsFilter:'all',newsPeriod:'today',newsInteractionRevision:0,contextualCity:{id:'683506'},
  newsContinuation:{view:()=>state,next(){
   requests++;state={...state,loading:true};return new Promise(resolve=>{finishNext=items=>{state={...state,loading:false,items};resolve();};});
  }},
  required:selector=>{assert.equal(selector,'#discovery-cards');return {querySelectorAll:()=>nodes};},
  renderDiscovery:()=>{
   assert.deepEqual(state.items.slice(0,nodes.length),nodes,'existing DOM articles retain their prefix');
   const next=newsMasonryPositions(state.items.map(node=>node.height),2);
   assert.deepEqual(next.slice(0,placements.length),placements,'existing geometry survives append');
   placements=next;nodes=[...state.items];laidOut=true;renders++;
  },
  announcement,getLocale:()=>language};
 runInNewContext(body+'\nthis.manual = showNewsPage(true);',context);
 assert.equal(requests,1);assert.equal(renders,0);assert.equal(focuses,0);assert.equal(scrolls,0);assert.deepEqual(nodes,[old]);
 finishNext([old,added]);await context.manual;
 assert.equal(renders,1);assert.equal(focuses,1);assert.equal(scrolls,1);assert.equal(heading.tabIndex,-1);
 assert.deepEqual(nodes,[old,added]);assert.equal(announcement.textContent,'More current reports are available below.');
 const manualAnnouncement=announcement.textContent;laidOut=false;
 runInNewContext('this.automatic = showNewsPage(false);',context);
 assert.equal(requests,2);assert.equal(renders,1);assert.equal(focuses,1);assert.deepEqual(nodes,[old,added]);
 finishNext([old,added,automatic]);await context.automatic;
 assert.equal(renders,2);assert.equal(focuses,1);assert.equal(scrolls,1);assert.equal(announcement.textContent,manualAnnouncement);
 assert.deepEqual(nodes,[old,added,automatic]);
 // A late page for a different language must not rerender or focus the previous context.
 laidOut=false;runInNewContext('this.changedContext = showNewsPage(true);',context);language='ro';
 finishNext([...nodes,{dataset:{newsStreamKey:'late'},height:100}]);await context.changedContext;
 assert.equal(renders,2);assert.equal(focuses,1);assert.equal(scrolls,1);assert.equal(nodes.length,3);
 const render=source.slice(source.indexOf('function renderDiscovery()'),source.indexOf('async function showNewsPage(focus)'));
 assert.ok(render.indexOf('newsMasonry.update()')>=0);assert.ok(render.indexOf('observeNewsStream(sentinel')>=0);assert.ok(render.indexOf('const anchor = anchors.find')>=0);
 assert.ok(render.indexOf('newsMasonry.update()')<render.indexOf('observeNewsStream(sentinel'));
 assert.ok(render.indexOf('newsMasonry.update()')<render.indexOf('const anchor = anchors.find'));
});

test('the English shortcut leaves keyboard focus in the visible toolbar after selecting the language',()=>{
 const source=readFileSync('.build/src/iceo/browser.js','utf8'),start=source.indexOf("required('#home-news-english').addEventListener"),end=source.indexOf('// Automatic location and saved choices',start);
 assert.ok(start>=0&&end>start);let action,focuses=0,changes=0;
 const picker={value:'ro',dispatchEvent(event){assert.equal(this.value,'en');assert.equal(event.type,'change');assert.equal(event.bubbles,true);changes++;}};
 const category={focus(){focuses++;}};
 const context={Event:class{constructor(type,options){this.type=type;this.bubbles=options.bubbles;}},
  required:selector=>selector==='#home-news-english'?{addEventListener(type,callback){assert.equal(type,'click');action=callback;}}:selector==='#reader-language'?picker:selector==='#home-news-category'?category:null};
 runInNewContext(source.slice(start,end),context);action();assert.equal(changes,1);assert.equal(focuses,1);
});

test('compiled inline rendering preserves 11-plus-1 cadence, append prefixes and unseen facts without expired slots',()=>{
 const source=readFileSync('.build/src/iceo/browser.js','utf8'),renderStart=source.indexOf('function renderDiscovery()');
 const start=source.indexOf('const inlinePage = server.page;',renderStart),end=source.indexOf('if (!visible.length && loadingPhase',start);
 assert.ok(renderStart>=0&&start>renderStart&&end>start);
 const body=source.slice(start,end),now=Date.parse('2026-11-23T12:00:00.000Z');
 const originals=Array.from({length:80},(_,index)=>{
  const card=Object.freeze({id:'original-'+index,title:'Original article '+index,sourceUrl:'https://www.theguardian.com/world/2026/nov/23/inline-fixture-'+index,date:new Date(now-index*1000).toISOString(),observedAt:new Date(now).toISOString(),contentHash:index.toString(16).padStart(64,'0')});
  return Object.freeze(index%7===0?{kind:'local',key:'news-'+index,category:'13000000',card}:{kind:'global',key:'news-'+index,category:'13000000',view:Object.freeze({card})});
 });
 const originalsBefore=JSON.stringify(originals);
 const originalCard=item=>item.kind==='global'?item.view.card:item.card;
 const sequence=nodes=>nodes.map(node=>node.fixtureKind==='knowledge'?'knowledge:'+node.card.id:node.dataset.newsStreamKey);
 const facts=nodes=>nodes.filter(node=>node.fixtureKind==='knowledge');
 function harness(catalog=KNOWLEDGE_CARDS){
  const host={children:[],append(node){this.children.push(node);}};
  function newsNode(card){
   const heading={setAttribute(){}},topic={},link={},details={};
   return {fixtureKind:'news',card,dataset:{},querySelector:selector=>selector==='h3'?heading:selector==='.card-topic'?topic:selector==='.card-content > .source-link'?link:selector==='.evidence > summary'?details:null};
  }
  const context={
   server:{page:{epoch:17,revision:9,startedAt:new Date(now).toISOString(),language:'en',cityId:'683506',countryCode:'RO',filter:'all',period:'today',day:{date:'2026-11-23'}}},
   now,language:'en',topCount:80,visible:[],host,document:{body:{dataset:{}}},
   contextualCity:{id:'683506',name:'Bucharest',countryCode:'RO'},inlineKnowledgeSeen:new Set(),inlineKnowledgeContext:'',inlineKnowledgeSelection:[],
   pageItemByKey:new Map(originals.map(item=>[item.key,{kind:item.kind,key:item.key,category:item.category,card:originalCard(item)}])),
   newsStorySourcesNode(){throw Error('Ungrouped originals must not create a source-group disclosure');},
   KNOWLEDGE_CARDS:catalog,selectInlineKnowledge,interleaveKnowledge,
   writeKnowledgeSeen:seen=>{assert.ok(seen instanceof Set);return true;},
   knowledgeCardNode:(card,scope)=>({fixtureKind:'knowledge',card,scope,dataset:{}}),
   cardNode:view=>newsNode(view.card),localCardNode:card=>newsNode(card),
   editionCardSignature:card=>card.id,editionStorySignature:view=>view.card.id,newsCategoryLabel:category=>category,tr:key=>key,
  };
  runInNewContext('function renderInline(){\n'+body+'\n}',context);
  return {context,render(count){
   context.visible=originals.slice(0,count);host.children=[];runInNewContext('renderInline();',context);
   const nodes=[...host.children],news=nodes.filter(node=>node.fixtureKind==='news');
   assert.equal(news.length,count);news.forEach((node,index)=>{assert.strictEqual(node.card,originalCard(originals[index]));assert.equal(node.dataset.newsStreamKey,originals[index].key);});
   return nodes;
  }};
 }
 const h=harness();let previous=h.render(10);const selected=h.context.inlineKnowledgeSelection;
 assert.ok(selected.length>=8);assert.equal(facts(previous).length,0);assert.equal(h.context.inlineKnowledgeSeen.size,0);
 for(const count of [11,22,33,44,66]){
  const next=h.render(count);
  assert.deepEqual(sequence(next).slice(0,previous.length),sequence(previous),'existing prefix at '+count+' news');
  assert.strictEqual(h.context.inlineKnowledgeSelection,selected,'append reuses the same selected catalogue');
  previous=next;
 }
 assert.deepEqual(previous.flatMap((node,index)=>node.fixtureKind==='knowledge'?[index+1]:[]),[12,24,36,48,60,72]);
 assert.deepEqual(facts(previous).map(node=>node.card.id),selected.slice(0,6).map(item=>item.card.id));
 assert.equal(h.context.inlineKnowledgeSeen.size,6);assert.deepEqual(sequence(h.render(66)),sequence(previous));
 const seen=new Set(h.context.inlineKnowledgeSeen);
 h.context.server.page={...h.context.server.page,filter:'13000000',period:'recent',day:null};
 const changed=h.render(22);
 assert.equal(facts(changed).length,2);assert.equal(changed.length,24);
 assert.ok(facts(changed).every(node=>!seen.has(node.card.id)),'a new context never reuses a fact already displayed');
 assert.equal(h.context.inlineKnowledgeSeen.size,seen.size+2);
 const firstId=selected[0].card.id,expires=now+1000;
 const bounded=KNOWLEDGE_CARDS.map(card=>({...card,reviewedAt:new Date(now-1000).toISOString(),reviewBy:new Date(card.id===firstId?expires:now+10000).toISOString()}));
 const expiring=harness(bounded);assert.equal(facts(expiring.render(10)).length,0);
 const slots=expiring.context.inlineKnowledgeSelection;assert.equal(slots[0].card.id,firstId);
 expiring.context.now=expires;
 const afterExpiry=expiring.render(44),shown=facts(afterExpiry);
 assert.strictEqual(expiring.context.inlineKnowledgeSelection,slots,'expiry does not compact the selected slots');
 assert.equal(shown.length,3);assert.deepEqual(shown.map(node=>node.card.id),slots.slice(1,4).map(item=>item.card.id));
 assert.deepEqual(shown.map(node=>afterExpiry.indexOf(node)+1),[23,35,47],
  'an expired fact is not replaced early; later facts keep their eleven-story slots');
 assert.equal(expiring.context.inlineKnowledgeSeen.has(firstId),false);assert.equal(expiring.context.inlineKnowledgeSeen.has(slots[1].card.id),true);
 assert.equal(JSON.stringify(originals),originalsBefore);
});
