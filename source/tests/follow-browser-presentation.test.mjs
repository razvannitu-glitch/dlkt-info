import test from 'node:test';
import assert from 'node:assert/strict';
import {CategoryFollowing} from '../.build/src/iceo/follow-browser.js';
import {changeCategoryFollow} from '../.build/src/iceo/category-follow.js';
import {getLocale,translatedCategory} from '../.build/src/i18n/browser.js';

class ElementFixture extends EventTarget {
 constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.dataset={};this.attributes={};this.className='';this.hidden=false;this.open=false;this.ownText='';}
 get textContent(){return this.ownText+this.children.map(child=>child.textContent).join('');}
 set textContent(value){this.ownText=String(value);for(const child of this.children)child.parentElement=null;this.children=[];}
 append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.ownText='';this.append(...nodes);}
 remove(){if(!this.parentElement)return;const siblings=this.parentElement.children,index=siblings.indexOf(this);if(index>=0)siblings.splice(index,1);this.parentElement=null;}
 setAttribute(name,value){this.attributes[name]=String(value);}
 getAttribute(name){return this.attributes[name]??null;}
 contains(node){for(let current=node;current;current=current.parentElement)if(current===this)return true;return false;}
 focus(){document.activeElement=this;}
 matches(selector){
  if(selector.startsWith('.'))return this.className.split(/\s+/u).includes(selector.slice(1));
  if(selector==='[data-follow-category]')return this.dataset.followCategory!==undefined;
  if(selector==='[data-follow-action]')return this.dataset.followAction!==undefined;
  if(selector==='details[open][data-follow-topic]')return this.tagName==='DETAILS'&&this.open&&this.dataset.followTopic!==undefined;
  return this.tagName.toLowerCase()===selector;
 }
 querySelectorAll(selector){const found=[];for(const child of this.children){if(child.matches(selector))found.push(child);found.push(...child.querySelectorAll(selector));}return found;}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
function environment(t){
 const descriptors=new Map(['document','window','navigator','HTMLElement'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const body=new ElementFixture('body'),host=new ElementFixture('section');host.id='following-brief';body.append(host);
 const document={body,activeElement:null,createElement:tag=>new ElementFixture(tag),getElementById:id=>id==='following-brief'?host:null,querySelectorAll:selector=>body.querySelectorAll(selector)};
 Object.defineProperties(globalThis,{document:{configurable:true,value:document},window:{configurable:true,value:{location:{href:'https://www.dlkt.ee/?lang=en'}}},
 navigator:{configurable:true,value:{language:'en',languages:['en']}},HTMLElement:{configurable:true,value:ElementFixture}});
 t.after(()=>{for(const [key,descriptor] of descriptors)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 return {body,host};
}
test('news-stream follow labels and feedback remain neutral through toggle, render and language changes while preserving the saved filter',async t=>{
 const {body}=environment(t);let stored=null,write=Promise.resolve(),revision=0;const calls=[],messages=[];
 let controller;
 controller=new CategoryFollowing({
  device:{readCategoryFollows:async()=>stored,setCategoryFollow:async(category,followed,snapshot,expected)=>{
   calls.push({category,followed,snapshot,expected});stored=changeCategoryFollow(stored,category,followed,snapshot,Date.now(),'11111111-1111-4111-8111-'+String(++revision).padStart(12,'0')).state;return stored;}},
  snapshot:()=>null,available:()=>false,loading:()=>false,busy:()=>false,refresh:()=>{},personalise:()=>{},
  write:(action,message)=>{write=(async()=>{await action();messages.push(message);controller.render();})();return write;},
 });
 const article=document.createElement('article'),content=document.createElement('div');content.className='card-content';article.append(content);body.append(article);
 controller.attach(article,'shopping','related');await controller.read();
 const button=article.querySelector('.follow-category');assert.equal(button.dataset.followCategory,'shopping');assert.equal(button.dataset.followPresentation,'related');
 assert.equal(button.textContent,'+ Follow related coverage');assert.match(button.getAttribute('aria-label'),/Associated filter:/u);
 assert.ok(button.title.includes(translatedCategory('shopping')));assert.match(button.title,/not every article in the displayed category/u);
 button.dispatchEvent(new Event('click'));await write;
 assert.equal(calls.length,1);assert.equal(calls[0].category,'shopping');assert.equal(calls[0].followed,true);assert.equal(calls[0].snapshot,null);assert.equal(calls[0].expected,null);
 assert.equal(stored.entries.length,1);assert.equal(stored.entries[0].category,'shopping');
 assert.equal(button.textContent,'✓ Following related coverage');assert.equal(button.getAttribute('aria-pressed'),'true');
 controller.render();controller.render();assert.equal(button.textContent,'✓ Following related coverage');
 assert.equal(messages[0],'Related coverage is followed in this browser.');
 window.location.href='https://www.dlkt.ee/?lang=ro';assert.equal(getLocale(),'ro');controller.render();
 assert.equal(button.textContent,'✓ Urmaresti stiri conexe');assert.match(button.title,/Filtru asociat:/u);
 button.dispatchEvent(new Event('click'));await write;
 assert.equal(calls[1].category,'shopping');assert.equal(calls[1].followed,false);assert.equal(stored,null);
 assert.equal(button.textContent,'+ Urmareste stiri conexe');assert.equal(messages[1],'Urmarirea stirilor conexe a fost oprita in acest browser.');
 assert.ok(messages.every(message=>!message.includes(translatedCategory('shopping'))));
 const existing=document.createElement('article'),existingContent=document.createElement('div');existingContent.className='card-content';existing.append(existingContent);body.append(existing);
 controller.attach(existing,'education');controller.render();
 assert.equal(existing.querySelector('.follow-category').dataset.followPresentation,'category');
 assert.ok(existing.querySelector('.follow-category').textContent.includes(translatedCategory('education')));
 assert.doesNotMatch(existing.querySelector('.follow-category').textContent,/stiri conexe|related coverage/u);
});
