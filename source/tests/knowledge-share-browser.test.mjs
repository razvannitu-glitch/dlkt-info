import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {PUBLIC_ORIGIN,parseCardReference,parseKnowledgeCardReference,knowledgeReferencePath} from '../.build/src/share/link.js';
const compiled=readFileSync('.build/src/share/page-browser.js','utf8').replace(/^import .+;\r?\n/gmu,'');
const url=PUBLIC_ORIGIN+'/card/dlkt-elsewhere-test?v=1&lang=en&h='+'a'.repeat(64);
const newsUrl=PUBLIC_ORIGIN+'/card/'+'b'.repeat(24)+'?v='+'c'.repeat(64);
const until=10000;
class Element {
 constructor(){this.dataset={};this.attributes=new Map();this.handlers=new Map();this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.className='';this.tabIndex=0;}
 addEventListener(type,fn){const list=this.handlers.get(type)??[];list.push(fn);this.handlers.set(type,list);}
 setAttribute(name,value){this.attributes.set(name,value);}
 getAttribute(name){return this.attributes.get(name)??null;}
 removeAttribute(name){this.attributes.delete(name);}
 set href(value){this.setAttribute('href',value);}
 get href(){return this.getAttribute('href');}
 focus(){} select(){}
 fire(type){const event={prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};for(const fn of this.handlers.get(type)??[]){fn(event);if(event.stopped)break;}return event;}
}
class Button extends Element{}
class Input extends Element{}
function harness({standalone=true,initial=until-100,write}={}){
 let now=initial,timer=null;const writes=[];
 const button=new Button(),input=new Input(),message=new Element(),freshness=new Element(),social=Array.from({length:3},(_,i)=>new Element());
 button.dataset={cardUrl:standalone?url:newsUrl,copySuccess:'Copied',copyFallback:'Copy selected'};button.hidden=true;
 input.hidden=true;freshness.dataset={validUntil:String(until),expiredMessage:'Expired'};
 for(const [i,link] of social.entries()){link.dataset.knowledgeShareUrl='https://example.invalid/intent/'+i;link.setAttribute('aria-disabled','true');link.tabIndex=-1;}
 const document=new Element();document.visibilityState='visible';document.getElementById=id=>({'shared-copy':button,'shared-fallback':input,'shared-message':message,'shared-freshness':freshness}[id]??null);
 document.querySelector=()=>standalone?new Element():null;document.querySelectorAll=()=>standalone?social:[];
 const window=new Element(),clipboard=write===null?undefined:{writeText:value=>{writes.push(value);return write?write(value):Promise.resolve();}};
 runInNewContext(compiled,{document,window,navigator:{clipboard},HTMLButtonElement:Button,HTMLInputElement:Input,URL,Date:{now:()=>now},PUBLIC_ORIGIN,parseCardReference,parseKnowledgeCardReference,knowledgeReferencePath,watchCardPhotos:()=>{},setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;}});
 return {button,input,message,freshness,social,document,window,writes,setNow:value=>{now=value;},runTimer:()=>timer?.()};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function assertDisabled(h){
 assert.equal(h.button.disabled,true);assert.equal(h.button.hidden,true);assert.equal(h.input.value,'');assert.equal(h.input.hidden,true);
 for(const link of h.social){assert.equal(link.href,null);assert.equal(link.getAttribute('aria-disabled'),'true');assert.equal(link.tabIndex,-1);}
 assert.equal(h.freshness.textContent,'Expired');
}
test('standalone actions are enabled only while fresh and exact expiry blocks clicks even before the timer executes',async()=>{
 const h=harness();assert.equal(h.button.hidden,false);assert.ok(h.social.every(link=>link.href!==null));
 h.button.fire('click');await flush();assert.deepEqual(h.writes,[url]);
 h.input.value=url;h.input.hidden=false;h.setNow(until);h.button.fire('click');await flush();
 assert.deepEqual(h.writes,[url]);assertDisabled(h);
 h.setNow(until-1);h.window.fire('focus');assertDisabled(h);
});
test('expired social activations are blocked at the event, including auxiliary and context-menu actions',()=>{
 for(const type of ['click','auxclick','pointerdown','keydown','contextmenu']){
  const h=harness();h.setNow(until);const event=h.social[0].fire(type);
  assert.equal(event.prevented,true,type);assert.equal(event.stopped,true,type);assertDisabled(h);
 }
});
test('timer, foreground return and restored page independently clear stale fallback and destinations',async()=>{
 for(const trigger of ['timer','visibilitychange','pageshow','focus']){
  const h=harness({write:null});h.button.fire('click');await flush();assert.equal(h.input.value,url);assert.equal(h.input.hidden,false);
  h.document.visibilityState='hidden';h.document.fire('visibilitychange');h.setNow(until);h.document.visibilityState='visible';
  if(trigger==='timer'){h.document.fire('visibilitychange');h.runTimer();}
  else if(trigger==='visibilitychange')h.document.fire(trigger);else h.window.fire(trigger);
  assertDisabled(h);
 }
 const h=harness();h.setNow(until);h.runTimer();assertDisabled(h);
});
test('expired initial pages and delayed clipboard rejection cannot reveal a stale fallback',async()=>{
 const expired=harness({initial:until});assertDisabled(expired);assert.equal(expired.writes.length,0);
 let reject;const held=new Promise((_resolve,r)=>{reject=r;});
 const h=harness({write:()=>held});h.button.fire('click');h.setNow(until);h.window.fire('pageshow');reject(Error('clipboard denied'));await flush();
 assertDisabled(h);assert.equal(h.writes.length,1,'only the pre-expiry gesture initiated a write');
});
test('ordinary news copy behavior remains unchanged when its source check expires',async()=>{
 const h=harness({standalone:false});h.setNow(until);h.window.fire('pageshow');assert.equal(h.button.hidden,false);
 h.button.fire('click');await flush();assert.deepEqual(h.writes,[newsUrl]);
 assert.match(h.freshness.textContent,/source check has expired/);
});


test('manual copy from the selected fallback is also denied at the exact deadline before the timer',async()=>{
 for(const type of ['copy','cut','keydown','pointerdown','contextmenu']){
  const h=harness({write:null});h.button.fire('click');await flush();assert.equal(h.input.value,url);
  h.setNow(until);const event=h.input.fire(type);assert.equal(event.prevented,true,type);assert.equal(event.stopped,true,type);assertDisabled(h);assert.equal(h.input.disabled,true);
 }
});
