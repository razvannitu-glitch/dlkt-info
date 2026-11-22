import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {photoNode,contextPhotoNode,integratePhotoHeadline,watchCardPhotos} from '../.build/src/media/browser.js';
import {REVIEWED_PHOTOS} from '../.build/src/media/reviewed-photos.js';
import {CONTEXT_PHOTOS} from '../.build/src/media/context-photos.js';
import {EDITORIAL_PHOTOS} from '../.build/src/media/editorial-photos.js';

// This DOM fixture tests node ownership/error recovery; visual layout is checked separately.
class TextFixture {
 constructor(value){this.textContent=value;this.parentElement=null;}
 remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null;}}
}
class ElementFixture extends EventTarget {
 constructor(tag){
  super();this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.dataset={};this.className='';this.hidden=false;this.complete=false;this.naturalWidth=960;
  this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ');},toggle:(name,force)=>{const present=this.classList.contains(name),next=force??!present;if(next)this.classList.add(name);else this.className=this.className.split(/\s+/).filter(value=>value!==name).join(' ');return next;}};
 }
 get textContent(){return this.children.map(child=>child.textContent).join('');}
 set textContent(value){for(const child of this.children)child.parentElement=null;this.children=[];if(value)this.append(new TextFixture(value));}
 append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
 prepend(...nodes){for(const node of [...nodes].reverse()){node.remove();node.parentElement=this;this.children.unshift(node);}}
 before(node){const parent=this.parentElement;if(!parent)return;node.remove();node.parentElement=parent;parent.children.splice(parent.children.indexOf(this),0,node);}
 remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null;}}
 matches(selector){if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));if(selector==='img[data-reviewed-photo]')return this.tagName==='IMG'&&'reviewedPhoto' in this.dataset;return this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){const matches=[];for(const child of this.children){if(!(child instanceof ElementFixture))continue;if(child.matches(selector))matches.push(child);matches.push(...child.querySelectorAll(selector));}return matches;}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 closest(selector){for(let node=this;node;node=node.parentElement){if(node.matches(selector))return node;}return null;}
}
const cards=JSON.parse(readFileSync('tests/fixtures/card-photos.json','utf8'));
const now=Math.max(...REVIEWED_PHOTOS.map(photo=>Date.parse(photo.reviewedAt)),...CONTEXT_PHOTOS.map(photo=>Date.parse(photo.reviewedAt)))+1000;
function dom(t,{failedAtCreation=false}={}){
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createTextNode:value=>new TextFixture(value),createElement:tag=>{const element=new ElementFixture(tag);if(tag==='img'&&failedAtCreation){element.complete=true;element.naturalWidth=0;}return element;}}});
 t.after(()=>descriptor?Object.defineProperty(globalThis,'document',descriptor):delete globalThis.document);
 return tag=>document.createElement(tag);
}
function composed(t,options){const make=dom(t,options),article=make('article'),header=make('header'),heading=make('h3'),source=make('a');header.textContent='World';heading.textContent=cards[0].title;source.textContent='Open source';source.href=cards[0].sourceUrl;const figure=photoNode(cards[0],now);article.append(header,figure,heading,source);integratePhotoHeadline(figure,heading,header);return{article,header,heading,figure,source,image:figure.querySelector('img')};}

test('an integrated image failing after display preserves the exact title, header and source action',async t=>{
 const view=composed(t),{article,figure,heading,header,source,image}=view;
 let activations=0;source.addEventListener('click',()=>activations++);
 image.dispatchEvent(new Event('error'));await Promise.resolve();
 assert.equal(figure.parentElement,article);assert.equal(figure.hidden,false);assert.equal(figure.classList.contains('photo-unavailable'),true);
 assert.equal(figure.querySelector('.card-photo-frame').hidden,true);
 assert.equal(figure.querySelector('.card-photo-label').hidden,true);
 assert.equal(figure.querySelector('h3'),heading);assert.equal(heading.textContent,cards[0].title);assert.equal(figure.querySelector('header'),header);
 assert.equal(source.parentElement,article);assert.equal(source.href,cards[0].sourceUrl);source.dispatchEvent(new Event('click'));assert.equal(activations,1);
 assert.ok(figure.textContent.includes(REVIEWED_PHOTOS[0].credit));assert.ok(figure.textContent.includes(REVIEWED_PHOTOS[0].license));
});
test('a parser-time image failure also keeps the newly integrated title and uncut text',async t=>{
 const {article,figure,heading}=composed(t,{failedAtCreation:true});await Promise.resolve();
 assert.equal(figure.parentElement,article);assert.equal(figure.hidden,false);assert.equal(figure.classList.contains('photo-unavailable'),true);
 assert.equal(figure.querySelector('h3'),heading);assert.equal(heading.textContent,cards[0].title);
});
test('legacy figures with no relocated headline can still disappear without removing reading text',async t=>{
 const make=dom(t),article=make('article'),heading=make('h3'),source=make('a'),figure=photoNode(cards[0],now);heading.textContent=cards[0].title;source.textContent='Open source';article.append(figure,heading,source);
 watchCardPhotos(article);figure.querySelector('img').dispatchEvent(new Event('error'));await Promise.resolve();
 assert.equal(figure.parentElement,null);assert.equal(heading.parentElement,article);assert.equal(source.parentElement,article);assert.equal(heading.textContent,cards[0].title);
});
test('headline integration is idempotent and a long title remains the original heading node',async t=>{
 const {figure,header,heading}=composed(t);let events=0;heading.addEventListener('click',()=>events++);
 const title='A long institutional headline with a complete decision, its affected participants and a qualification that must never be cut away';heading.textContent=title;
 integratePhotoHeadline(figure,heading,header);integratePhotoHeadline(figure,heading,header);
 assert.equal(figure.querySelectorAll('.card-photo-visual').length,1);assert.equal(figure.querySelectorAll('.card-photo-headline').length,1);assert.equal(figure.querySelectorAll('header').length,1);assert.equal(figure.querySelectorAll('h3').length,1);
 assert.equal(figure.classList.contains('photo-title-long'),true);assert.equal(figure.querySelector('h3').textContent,title);heading.dispatchEvent(new Event('click'));assert.equal(events,1);
 heading.textContent='Short headline';integratePhotoHeadline(figure,heading);assert.equal(figure.classList.contains('photo-title-long'),false);
 await Promise.resolve();
});
test('compact credits preserve full author, licence, source URL and the original photographic disclosure',async t=>{
 dom(t);for(const card of cards){const photo=REVIEWED_PHOTOS.find(item=>item.cardId===card.id),figure=photoNode(card,now),caption=figure.querySelector('figcaption'),details=caption.querySelector('details'),credit=caption.querySelector('.card-photo-credit');
  assert.ok(credit.textContent.includes(photo.credit));assert.ok(credit.textContent.includes(photo.license));
  assert.equal(details.className,'photo-details');assert.equal(details.querySelector('summary').textContent,'About this image');assert.ok(details.textContent.includes(photo.caption));assert.ok(details.textContent.includes(photo.changeNote));
  assert.deepEqual(credit.querySelectorAll('a').map(link=>[link.href,link.target,link.rel]),[[photo.creditUrl,'_blank','noopener noreferrer'],[photo.licenseUrl,'_blank','noopener noreferrer']]);
  const image=figure.querySelector('img');assert.equal(image.alt,photo.alt);assert.equal(image.width,photo.width);assert.equal(image.height,photo.height);assert.equal(image.loading,'lazy');assert.equal(image.decoding,'async');assert.equal(image.referrerPolicy,'no-referrer');
 }
 await Promise.resolve();
});
test('visible photographic labels distinguish context, explicit archive years and source collages',async t=>{
 dom(t);assert.equal(photoNode(cards[0],now).querySelector('.card-photo-label').textContent,'Archive photo · 2018');
 assert.equal(photoNode(cards[1],now).querySelector('.card-photo-label').textContent,'Source photo');
 assert.equal(photoNode(cards[2],now).querySelector('.card-photo-label').textContent,'Source collage');
 const figure=contextPhotoNode({title:'University of Miskolc library reading room'},now);assert.ok(figure);assert.equal(figure.dataset.photoKind,'context');assert.equal(figure.querySelector('.card-photo-label').textContent,'Context photo');assert.ok(figure.querySelector('.photo-details').textContent.includes('Not the reported event'));
 await Promise.resolve();
});
test('editorial figures expose translated disclosure hooks separately from the original English photographic description',async t=>{
 dom(t);const checkedAt=Math.max(...EDITORIAL_PHOTOS.map(photo=>Date.parse(photo.reviewedAt)))+1000;
 const figure=contextPhotoNode({title:'A public information update',editorialCategory:'world'},checkedAt),image=figure.querySelector('img');
 assert.equal(figure.dataset.photoKind,'editorial');assert.equal(figure.querySelector('.card-photo-label').dataset.i18n,'photoEditorialLabel');
 assert.equal(figure.querySelector('.card-photo-note').dataset.i18n,'photoEditorialNote');
 assert.equal(figure.querySelector('.photo-details').querySelector('summary').dataset.i18n,'photoDetailsLabel');
 assert.match(image.alt,/Illustrative photograph: .*Not the reported event\./u);assert.equal(image.lang,'en');assert.equal(image.translate,false);
 assert.equal(figure.querySelector('.photo-details').querySelector('p').lang,'en');
 await Promise.resolve();
});
test('an unavailable editorial fallback keeps the original heading and source with no recursive image substitutions',async t=>{
 const make=dom(t),checkedAt=Math.max(...EDITORIAL_PHOTOS.map(photo=>Date.parse(photo.reviewedAt)))+1000;
 const article=make('article'),heading=make('h3'),source=make('a'),figure=contextPhotoNode({title:'A public information update'},checkedAt);
 heading.textContent='A public information update';source.href='https://example.org/source';source.textContent='Open source';article.append(figure,heading,source);integratePhotoHeadline(figure,heading);
 const image=figure.querySelector('img'),initial=image.src;image.dispatchEvent(new Event('error'));await Promise.resolve();image.dispatchEvent(new Event('error'));await Promise.resolve();
 assert.equal(figure.querySelector('h3'),heading);assert.equal(figure.parentElement,article);assert.equal(source.parentElement,article);
 assert.equal(source.href,'https://example.org/source');assert.equal(image.src,initial);assert.equal(figure.querySelectorAll('img').length,1);
 assert.equal(figure.classList.contains('photo-unavailable'),true);assert.equal(figure.querySelector('.card-photo-frame').hidden,true);
});
