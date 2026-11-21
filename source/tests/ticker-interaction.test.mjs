import test from 'node:test';
import assert from 'node:assert/strict';
import {NewsTicker} from '../.build/src/glance/ticker.js';
// A deterministic DOM/WAAPI fixture: validates user choices, never a screenshot substitute.
class ElementFixture {
 dataset={};children=[];listeners=new Map();textContent='';className='';disabled=false;clientWidth=320;tabIndex=-1;attrs={};
 addEventListener(name,cb){this.listeners.set(name,cb);}
 dispatch(name,event={}){this.listeners.get(name)?.(event);}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 getBoundingClientRect(){return {width:this.children.length?this.children.reduce((n,c)=>n+c.getBoundingClientRect().width,0):500};}
 setAttribute(name,value){this.attrs[name]=value;}
 matches(selector){return selector===':focus-visible'&&this.focusVisible===true;}
 contains(target){return target===this||this.children.some(c=>c.contains(target));}
 cloneNode(){const copy=new ElementFixture();copy.className=this.className;copy.children=this.children.map(c=>c.cloneNode());return copy;}
 animate(frames,options){this.lastAnimation={currentTime:0,state:'running',frames,options,pause(){this.state='paused';},play(){this.state='running';},cancel(){this.state='cancelled';}};return this.lastAnimation;}
}
function environment(t,reduced,stored=new Map(),canHover=false){
 const ids=new Map(['glance-ticker-viewport','glance-ticker-track','glance-screen-summary'].map(id=>[id,new ElementFixture()]));
 const root=new ElementFixture();root.append(...ids.values());
 const media={matches:reduced,addEventListener(_name,cb){this.changed=cb;}};
 const hoverMedia={matches:canHover,addEventListener(_name,cb){this.changed=cb;}};
 const doc={visibilityState:'visible',body:new ElementFixture(),modal:false,listeners:new Map(),getElementById:id=>ids.get(id),createElement:()=>new ElementFixture(),addEventListener(name,cb){this.listeners.set(name,cb);},querySelector(){return this.modal?{}:null;}};
 const win={listeners:new Map(),addEventListener(name,cb){this.listeners.set(name,cb);},sessionStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)}};
 for(const [name,value] of Object.entries({matchMedia:query=>query.includes('prefers-reduced-motion')?media:hoverMedia,document:doc,window:win,ResizeObserver:class {observe(){}},MutationObserver:class {constructor(cb){doc.mutate=cb;}observe(){}},Element:ElementFixture,Node:ElementFixture})){
  const before=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});t.after(()=>before?Object.defineProperty(globalThis,name,before):delete globalThis[name]);
 }
 const ticker=new NewsTicker(root,()=>{}),track=ids.get('glance-ticker-track');
 const update=()=>ticker.update([{signal:'forex',label:'Currency',value:'1 EUR = 1.1 USD',note:'ECB reference · dated source'}]);
 return {root,media,hoverMedia,doc,win,stored,track,ticker,update,viewport:ids.get('glance-ticker-viewport')};
}


for(const reduced of [false,true])for(const saved of [null,'pause'])test(`autoplay needs no motion control or input; reduced=${reduced}, legacy choice=${saved}`,t=>{
 const stored=new Map(saved?[['dlkt-ticker-motion-v1',saved]]:[]),e=environment(t,reduced,stored);e.update();
 assert.equal(e.root.dataset.staticTicker,'false');assert.equal(e.track.lastAnimation.state,'running');
 assert.ok(e.track.lastAnimation.frames[1].transform.startsWith('translateX(-'));assert.equal(stored.get('dlkt-ticker-motion-v1')??null,saved);
});
test('refreshed and repopulated signals animate automatically; hidden pages temporarily stop motion',t=>{
 const e=environment(t,false);e.update();assert.equal(e.root.dataset.tickerPaused,'false');
 e.ticker.update([{signal:'key',label:'Today',value:'An updated publication',note:'Publisher date'}]);assert.equal(e.track.lastAnimation.state,'running');
 e.doc.visibilityState='hidden';e.doc.listeners.get('visibilitychange')();assert.equal(e.track.lastAnimation.state,'paused');
 e.doc.visibilityState='visible';e.doc.listeners.get('visibilitychange')();assert.equal(e.track.lastAnimation.state,'running');
 e.ticker.update([]);assert.equal(e.root.dataset.tickerEmpty,'true');e.update();assert.equal(e.track.lastAnimation.state,'running');assert.equal(e.root.dataset.tickerEmpty,'false');
});
test('ordinary mobile motion resumes after touch end, cancellation and window blur',t=>{
 const e=environment(t,false);e.update();assert.equal(e.track.lastAnimation.state,'running');
 for(const event of ['pointerup','pointercancel','blur']){e.viewport.dispatch('pointerdown',{pointerType:'touch'});assert.equal(e.track.lastAnimation.state,'paused');e.win.listeners.get(event)();assert.equal(e.track.lastAnimation.state,'running');}
});
test('a touch-only device cannot latch synthetic mouse hover; desktop hover remains temporary',t=>{
 const e=environment(t,false);e.update();e.viewport.dispatch('pointerenter',{pointerType:'mouse'});assert.equal(e.track.lastAnimation.state,'running');
 e.hoverMedia.matches=true;e.viewport.dispatch('pointerenter',{pointerType:'mouse'});assert.equal(e.track.lastAnimation.state,'paused');
 e.viewport.dispatch('pointerleave');assert.equal(e.track.lastAnimation.state,'running');
 e.viewport.dispatch('pointerenter',{pointerType:'mouse'});e.viewport.dispatch('pointerdown',{pointerType:'touch'});e.win.listeners.get('pointercancel')();assert.equal(e.track.lastAnimation.state,'running');
 e.viewport.dispatch('pointerenter',{pointerType:'mouse'});e.hoverMedia.matches=false;e.hoverMedia.changed();assert.equal(e.track.lastAnimation.state,'running');
});
test('pointer focus does not stop motion, while keyboard focus and open dialogs pause temporarily',t=>{
 const e=environment(t,false);e.update();const control=new ElementFixture();e.root.append(control);
 e.root.dispatch('focusin',{target:control});assert.equal(e.track.lastAnimation.state,'running');
 control.focusVisible=true;e.root.dispatch('focusin',{target:control});assert.equal(e.track.lastAnimation.state,'paused');
 e.root.dispatch('focusout',{relatedTarget:new ElementFixture()});assert.equal(e.track.lastAnimation.state,'running');
 e.doc.modal=true;e.doc.mutate();assert.equal(e.track.lastAnimation.state,'paused');
 e.doc.modal=false;e.doc.mutate();assert.equal(e.track.lastAnimation.state,'running');
});
test('system motion preference changes cannot gate autoplay or defeat a temporary dialog pause',t=>{
 const e=environment(t,false);e.update();e.media.matches=true;e.media.changed();assert.equal(e.track.lastAnimation.state,'running');
 e.doc.modal=true;e.doc.mutate();e.media.matches=false;e.media.changed();assert.equal(e.track.lastAnimation.state,'paused');
 e.doc.modal=false;e.doc.mutate();assert.equal(e.track.lastAnimation.state,'running');
});
test('autoplay needs neither session storage nor a saved playback preference',t=>{
 const e=environment(t,true);e.win.sessionStorage.getItem=()=>{throw Error('blocked');};e.win.sessionStorage.setItem=()=>{throw Error('blocked');};
 const reloaded=new NewsTicker(e.root,()=>{});reloaded.update([{signal:'weather',label:'Weather',value:'12 C',note:'Forecast'}]);assert.equal(e.track.lastAnimation.state,'running');
});
test('source updates preserve travelled pixels instead of rescaling them with the content width',t=>{
 const e=environment(t,false);e.update();e.track.lastAnimation.currentTime=10000;e.doc.visibilityState='hidden';e.doc.listeners.get('visibilitychange')();const original=e.track.lastAnimation.currentTime;
 e.ticker.update([{signal:'forex',label:'Currency',value:'1 EUR =1.1USD',note:'Reference'},{signal:'key',label:'Today',value:'Another source publication',note:'Date'}]);
 assert.equal(e.track.lastAnimation.currentTime,original);assert.equal(e.track.lastAnimation.state,'paused');
 e.doc.visibilityState='visible';e.doc.listeners.get('visibilitychange')();assert.equal(e.track.lastAnimation.state,'running');
});
test('visibility and page lifecycle release interrupted touch and preserve a deliberate dialog pause',t=>{
 const e=environment(t,false);e.update();e.viewport.dispatch('pointerdown',{pointerType:'touch'});e.doc.visibilityState='hidden';e.doc.listeners.get('visibilitychange')();assert.equal(e.track.lastAnimation.state,'paused');
 e.doc.visibilityState='visible';e.doc.listeners.get('visibilitychange')();assert.equal(e.track.lastAnimation.state,'running');
 e.win.listeners.get('pagehide')();assert.equal(e.track.lastAnimation.state,'paused');e.win.listeners.get('pageshow')();assert.equal(e.track.lastAnimation.state,'running');
 e.doc.modal=true;e.doc.mutate();e.win.listeners.get('pagehide')();e.win.listeners.get('pageshow')();assert.equal(e.track.lastAnimation.state,'paused');
 e.doc.modal=false;e.doc.mutate();assert.equal(e.track.lastAnimation.state,'running');
});
