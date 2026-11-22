import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {photoNode,contextPhotoNode,integratePhotoHeadline,watchCardPhotos} from '../.build/src/media/browser.js';
import {REVIEWED_PHOTOS} from '../.build/src/media/reviewed-photos.js';
import {CONTEXT_PHOTOS} from '../.build/src/media/context-photos.js';
import {articlePhotoPath,parseArticlePhotoReference} from '../.build/src/media/article-photo-reference.js';
import {localCardNode} from '../.build/src/local/card-node.js';
import {findCity} from '../.build/src/local/cities.js';
import {parseLocalNews} from '../.build/src/local/news-service.js';
import {newsFeed} from '../.build/src/local/news-policy.js';
import {newsCard} from '../.build/src/local/service.js';

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
 matches(selector){if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));if(selector==='img[data-reviewed-photo]')return this.tagName==='IMG'&&'reviewedPhoto' in this.dataset;if(selector==='img[data-article-photo]')return this.tagName==='IMG'&&'articlePhoto' in this.dataset;return this.tagName.toLowerCase()===selector;}
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
function composed(t,options,card=cards[0]){const make=dom(t,options),article=make('article'),header=make('header'),heading=make('h3'),source=make('a');header.textContent='World';heading.textContent=card.title;source.textContent='Open source';source.href=card.sourceUrl;const figure=photoNode(card,now);article.append(header,figure,heading,source);integratePhotoHeadline(figure,heading,header);return{article,header,heading,figure,source,image:figure.querySelector('img')};}

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
test('reviewed article photos retain their archive or source labels and a bare context receives no photo',async t=>{
 dom(t);assert.equal(photoNode(cards[0],now).querySelector('.card-photo-label').textContent,'Archive photo · 2018');
 assert.equal(photoNode(cards[1],now).querySelector('.card-photo-label').textContent,'Source photo');
 assert.equal(photoNode(cards[2],now).querySelector('.card-photo-label').textContent,'Source collage');
 for(const input of [{title:'University of Miskolc library reading room'},{title:'A public information update',editorialCategory:'world'},{title:'England win the cricket final',sourceUrl:'https://www.bbc.com/sport/cricket/articles/example'}]){
  assert.equal(contextPhotoNode(input,now),null);
 }
 await Promise.resolve();
});
const originalCard=Object.freeze({...cards[0],id:'d'.repeat(24),identity:'https://www.bbc.com/news/articles/photo-test',sourceUrl:'https://www.bbc.com/news/articles/photo-test',title:'A complete publisher headline for this particular article',publisher:'BBC fixture',sourceIds:['news-world'],contentHash:'e'.repeat(64)});
test('an unpinned publication requests only its exact article revision and reveals source credit after a successful load',async t=>{
 dom(t);const before=JSON.stringify(originalCard),figure=photoNode(originalCard,now),image=figure.querySelector('img'),badge=figure.querySelector('.card-photo-label'),caption=figure.querySelector('figcaption');
 assert.equal(figure.dataset.photoKind,'source');assert.equal(image.src,articlePhotoPath({id:originalCard.id,revision:originalCard.contentHash}));
 assert.deepEqual(parseArticlePhotoReference(image.src),{id:originalCard.id,revision:originalCard.contentHash});
 assert.equal(image.dataset.articlePhoto,originalCard.id);assert.equal(image.dataset.reviewedPhoto,undefined);
 assert.equal(image.width,960);assert.equal(image.height,540);assert.equal(image.loading,'lazy');assert.equal(image.decoding,'async');assert.equal(image.referrerPolicy,'no-referrer');
 assert.equal(badge.hidden,true);assert.equal(caption.hidden,true);image.dispatchEvent(new Event('load'));await Promise.resolve();
 assert.equal(badge.hidden,false);assert.equal(caption.hidden,false);assert.equal(badge.dataset.i18n,'photoSourceLabel');assert.equal(badge.textContent,'Source photo');
 assert.deepEqual(caption.querySelectorAll('a').map(link=>[link.href,link.textContent,link.target,link.rel]),[[originalCard.sourceUrl,'Source photo','_blank','noopener noreferrer']]);
 assert.doesNotMatch(figure.textContent,/CC BY|Commons|Illustrative|Not the reported event|Christophe95/u);assert.equal(JSON.stringify(originalCard),before);
});
test('different article identities and revisions never share a category or portrait photo path',async t=>{
 dom(t);const revised={...originalCard,contentHash:'a'.repeat(64)},other={...originalCard,id:'c'.repeat(24),sourceUrl:'https://www.bbc.com/news/articles/another-report',title:'Another report with the same subject'};
 const paths=[originalCard,revised,other].map(card=>photoNode(card,now).querySelector('img').src);
 assert.equal(new Set(paths).size,3);for(const path of paths){assert.match(path,/^\/api\/article-photo\?/u);assert.doesNotMatch(path,/card-media|https:|title|topic/u);}
 await Promise.resolve();
});
test('non-article kinds and invalid article references never render a substitute image',async t=>{
 dom(t);
 for(const patch of [{kind:'legal-document'},{kind:'software-release'},{kind:'procurement-notice'},{id:'invalid'},{contentHash:'not-a-hash'},{sourceUrl:'javascript:alert(1)'}])assert.equal(photoNode({...originalCard,...patch},now),null);
 assert.equal(photoNode(originalCard,NaN),null);
 const input={title:'A local report',sourceUrl:'https://b365.ro/restrictii-trafic-123456/'},reference={id:'local-news:683506:bucharest-b365:'+'a'.repeat(24),revision:'b'.repeat(64),cityId:'683506'};
 const figure=contextPhotoNode(input,now,reference);assert.ok(figure);assert.deepEqual(parseArticlePhotoReference(figure.querySelector('img').src),reference);
 for(const malformed of [{...reference,cityId:'2988507'},{id:reference.id,revision:reference.revision},{...reference,url:input.sourceUrl},{...reference,revision:'bad'}])assert.equal(contextPhotoNode(input,now,malformed),null);
 assert.equal(contextPhotoNode({title:'Local news'},now,reference),null);await Promise.resolve();
});
test('failed article images preserve integrated headline nodes and actions without retrying a stock image',async t=>{
 const {article,figure,heading,header,source,image}=composed(t,undefined,originalCard),initial=image.src;
 let activations=0;source.addEventListener('click',()=>activations++);
 image.dispatchEvent(new Event('error'));await Promise.resolve();image.dispatchEvent(new Event('error'));image.dispatchEvent(new Event('load'));await Promise.resolve();
 assert.equal(figure.querySelector('h3'),heading);assert.equal(heading.textContent,originalCard.title);assert.equal(figure.querySelector('header'),header);assert.equal(figure.parentElement,article);
 assert.equal(source.parentElement,article);assert.equal(source.href,originalCard.sourceUrl);source.dispatchEvent(new Event('click'));assert.equal(activations,1);
 assert.equal(image.src,initial);assert.equal(figure.querySelectorAll('img').length,1);assert.equal(figure.classList.contains('photo-unavailable'),true);
 assert.equal(figure.querySelector('.card-photo-frame').hidden,true);assert.equal(figure.querySelector('.card-photo-label').hidden,true);assert.equal(figure.querySelector('figcaption').hidden,true);
});
test('a cached missing article image preserves the original heading at parser time',async t=>{
 const {article,figure,heading,source}=composed(t,{failedAtCreation:true},originalCard);await Promise.resolve();
 assert.equal(figure.parentElement,article);assert.equal(figure.querySelector('h3'),heading);assert.equal(heading.textContent,originalCard.title);
 assert.equal(source.href,originalCard.sourceUrl);assert.equal(figure.querySelector('.card-photo-frame').hidden,true);
 assert.equal(figure.querySelector('figcaption').hidden,true);
});
test('actual parsed local news cards bind their photo request to the document hash and keep publisher evidence',async t=>{
 dom(t);const city=findCity('683506'),checkedAt='2026-11-22T12:00:00.000Z',time=Date.parse(checkedAt);assert.ok(city);
 for(const sourceId of ['bucharest-b365','bucharest-buletin']){
  const feed=newsFeed(sourceId),url=sourceId==='bucharest-b365'?'https://b365.ro/restrictii-trafic-123456/':'https://buletin.de/bucuresti/restrictii-trafic-123456/';
  const title='București: restricții de trafic la Metrorex';
  const xml='<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>'+feed.title+'</title><link>'+feed.home+'</link><item><title>'+title+'</title><link>'+url+'</link><pubDate>Sun, 22 Nov 2026 10:00:00 +0000</pubDate><description>Metrorex publică programul complet.</description><dc:creator>Autor Exemplu</dc:creator></item></channel></rss>';
  const parsed=parseLocalNews(xml,sourceId,city,checkedAt,time);assert.equal(parsed.articles.length,1);
  const record=parsed.articles[0],card=newsCard(record,city),before=JSON.stringify(card),article=localCardNode(card,city,time),figure=article.querySelector('figure'),image=figure.querySelector('img');
  assert.deepEqual(parseArticlePhotoReference(image.src),{id:record.id,revision:record.documentHash,cityId:city.id});
  assert.equal(article.querySelector('h3').textContent,title);assert.equal(article.dataset.newsSourceId,sourceId);assert.equal(JSON.stringify(card),before);
  assert.ok(article.querySelectorAll('a').some(link=>link.href===record.url&&link.textContent==='Read the full report'));
  assert.ok(article.textContent.includes(record.attribution));if(record.licenseUrl)assert.ok(article.querySelectorAll('a').some(link=>link.href===record.licenseUrl));
  image.dispatchEvent(new Event('error'));await Promise.resolve();assert.equal(article.querySelector('figure'),null);assert.equal(article.querySelector('h3').textContent,title);
  assert.ok(article.querySelectorAll('a').some(link=>link.href===record.url&&link.textContent==='Read the full report'));assert.equal(JSON.stringify(card),before);
 }
});
