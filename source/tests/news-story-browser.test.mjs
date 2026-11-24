import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNewsStorySourcesState,appendNewsStorySources,newsStorySourcesNode} from '../.build/src/iceo/news-story-browser.js';
import {validNewsPage,validNewsStorySourcesPage,NEWS_PAGE_VERSION,NEWS_STORY_SOURCES_VERSION} from '../.build/src/iceo/news-page-contracts.js';
import {NEWS_CATEGORIES,newsCategory} from '../.build/src/iceo/news-taxonomy.js';
import {LOCALES,t as translate} from '../.build/src/i18n/locale.js';
import {findCity} from '../.build/src/local/cities.js';
import {newsCard} from '../.build/src/local/service.js';
import {NOW,iso,hash,article,local} from './fixtures/news-corpus.mjs';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {pressReviewCitation} from '../.build/src/iceo/source-links.js';

const TIME=NOW+1000,cursor=id=>'Y3Vyc29y'+id+'.'+'a'.repeat(43);
function fixture(count=27,{city,language='en',sources,sourceScope}={}){
 const originals=sources??Array.from({length:count},(_,index)=>({kind:'global',card:article(index,{language})}));
 const primary=originals[0];assert.ok(primary);
 const item={...primary,key:(primary.kind==='global'?'article:':'local:')+primary.card.id,category:newsCategory(primary.card),
  story:{key:'story:'+hash(originals.map(value=>value.card.id)),basis:'matching-headlines',related:originals.slice(1,4),sourceTotal:originals.length,
   nextSourcesCursor:originals.length>4?cursor(1):null}};
 const counts=Object.fromEntries(['other',...NEWS_CATEGORIES.map(value=>value.id)].map(key=>[key,0]));counts[item.category??'other']=1;
 const page={version:NEWS_PAGE_VERSION,epoch:'1',revision:1,generatedAt:iso(NOW),startedAt:iso(TIME),expiresAt:iso(NOW+120000),
  language,...(sourceScope===undefined?{}:{sourceScope}),cityId:city?.id??null,countryCode:city?.countryCode??null,coverage:{national:0,local:primary.kind==='local'?1:0,international:primary.kind==='global'?1:0},
  period:'recent',day:null,filter:'all',items:[item],total:1,articleTotal:originals.length,filteredTotal:1,counts,nextCursor:null};
 assert.equal(validNewsPage(page,TIME,city),true,'controlled public group is valid');
 const response=(offset=4,overrides={})=>{
  const values=originals.slice(offset,offset+20);
  return {version:NEWS_STORY_SOURCES_VERSION,epoch:page.epoch,revision:page.revision,generatedAt:page.generatedAt,startedAt:page.startedAt,expiresAt:page.expiresAt,
   language:page.language,...(sourceScope===undefined?{}:{sourceScope}),cityId:page.cityId,countryCode:page.countryCode,period:page.period,day:page.day,filter:page.filter,
   storyKey:item.story.key,sourceTotal:originals.length,offset,sources:values,nextCursor:offset+values.length<originals.length?cursor(offset===4?2:3):null,...overrides};
 };
 return {page,item,originals,response,city};
}
function stateOf(value){const state=createNewsStorySourcesState(value.item,value.page,TIME,value.city);assert.ok(state);return state;}

test('source pages append every original once, retain the exact prefix and end at the declared source total',()=>{
 const value=fixture(47),state=stateOf(value),before=JSON.stringify(value.originals);
 assert.equal(state.sources.length,4);assert.equal(state.nextCursor,value.item.story.nextSourcesCursor);
 assert.equal(validNewsStorySourcesPage(value.response(),TIME),true);
 const second=appendNewsStorySources(state,value.response(),TIME);assert.ok(second);
 assert.equal(second.sources.length,24);assert.deepEqual(second.sources.slice(0,4),state.sources);
 const third=appendNewsStorySources(second,value.response(24),TIME);assert.ok(third);assert.equal(third.sources.length,44);
 const final=appendNewsStorySources(third,value.response(44),TIME);assert.ok(final);
 assert.equal(final.sources.length,47);assert.equal(final.nextCursor,null);assert.deepEqual(final.sources,value.originals);
 assert.equal(new Set(final.sources.map(source=>source.card.sourceUrl)).size,47);assert.equal(JSON.stringify(value.originals),before);
 assert.equal(state.sources.length,4);assert.ok(Object.isFrozen(state));assert.ok(Object.isFrozen(state.sources));
 assert.equal(appendNewsStorySources(final,value.response(44),TIME),null);
});

test('source pagination is independent of the main feed batch and its continuation cursor',()=>{
 const value=fixture(),items=Array.from({length:20},(_,index)=>{const card=article(100+index);return {kind:'global',key:'article:'+card.id,category:newsCategory(card),card};});
 const page={...value.page,items,total:21,filteredTotal:21,articleTotal:47,coverage:{national:0,local:0,international:21},counts:{...value.page.counts,[value.item.category]:21},nextCursor:cursor(9)};
 assert.equal(validNewsPage(page,TIME),true);
 const state=createNewsStorySourcesState(value.item,page,TIME);assert.ok(state);
 assert.equal(state.nextCursor,cursor(1));assert.equal(state.sources[0].card,value.item.card);
 assert.equal('nextCursor' in state.context,false);
});

test('another valid edition, language, city, period or category cannot contaminate a retained source group',()=>{
 const value=fixture(),state=stateOf(value),before=JSON.stringify(state);
 const alternatives=[
  value.response(4,{epoch:'2'}),value.response(4,{revision:2}),value.response(4,{generatedAt:iso(NOW-1000)}),
  value.response(4,{startedAt:iso(NOW+500)}),value.response(4,{expiresAt:iso(NOW+110000)}),
  value.response(4,{language:'ro',sources:Array.from({length:20},(_,id)=>({kind:'global',card:article(300+id,{language:'ro'})}))}),
  value.response(4,{filter:value.item.category}),
  value.response(4,{period:'today',day:{date:'2026-11-22',timeZone:'UTC',start:'2026-11-22T00:00:00.000Z',end:'2026-11-23T00:00:00.000Z'}}),
 ];
 for(const response of alternatives){assert.equal(validNewsStorySourcesPage(response,TIME),true);assert.equal(appendNewsStorySources(state,response,TIME),null);}
 const city=findCity('3165524');assert.ok(city);
 const otherCity=value.response(4,{cityId:city.id,countryCode:city.countryCode});
 assert.equal(validNewsStorySourcesPage(otherCity,TIME,city),true);assert.equal(appendNewsStorySources(state,otherCity,TIME,city),null);
 assert.equal(JSON.stringify(state),before);
});

test('story identity, total and offset are fixed independently of otherwise valid response metadata',()=>{
 const value=fixture(),state=stateOf(value);
 for(const response of [value.response(4,{storyKey:'story:'+hash('another story')}),value.response(4,{sourceTotal:28}),value.response(4,{offset:5})]){
  assert.equal(validNewsStorySourcesPage(response,TIME),true);assert.equal(appendNewsStorySources(state,response,TIME),null);
 }
 const otherDay=value.response(4,{period:'today',day:{date:'2026-11-22',timeZone:'UTC',start:'2026-11-22T00:00:00.000Z',end:'2026-11-23T01:00:00.000Z'}});
 assert.equal(appendNewsStorySources(state,otherDay,TIME),null);
 assert.equal(appendNewsStorySources(state,value.response(),Date.parse(value.page.expiresAt)),null);
});

test('duplicates from earlier pages and repeated or cyclic cursors leave every retained source unchanged',()=>{
 const value=fixture(67),state=stateOf(value),first=value.response(),before=JSON.stringify(state);
 const duplicate={...first,sources:[state.sources[0],...first.sources.slice(1)]};
 assert.equal(validNewsStorySourcesPage(duplicate,TIME),true);assert.equal(appendNewsStorySources(state,duplicate,TIME),null);
 for(const field of ['id','identity','sourceUrl']){
  const changed=structuredClone(first);changed.sources[0].card[field]=state.sources[0].card[field];
  assert.equal(appendNewsStorySources(state,changed,TIME),null,field);
 }
 assert.equal(appendNewsStorySources(state,{...first,nextCursor:state.nextCursor},TIME),null);
 const second=appendNewsStorySources(state,first,TIME);assert.ok(second);
 assert.equal(validNewsStorySourcesPage(value.response(24,{nextCursor:state.nextCursor}),TIME),true);
 assert.equal(appendNewsStorySources(second,value.response(24,{nextCursor:state.nextCursor}),TIME),null);
 assert.equal(JSON.stringify(state),before);
});

test('real parsed local originals require their validated city and retain all article metadata',()=>{
 const parsed=local(3),sources=parsed.snapshot.articles.map(value=>({kind:'local',card:newsCard(value,parsed.city)}));
 const value=fixture(sources.length,{city:parsed.city,language:'ro',sources}),before=JSON.stringify(sources),state=stateOf(value);
 assert.equal(state.sources.length,3);assert.equal(state.nextCursor,null);assert.equal(JSON.stringify(state.sources),before);
 assert.equal(createNewsStorySourcesState(value.item,value.page,TIME),null);
 assert.equal(createNewsStorySourcesState(value.item,value.page,TIME,findCity('3165524')),null);
 const plain={...value.item};delete plain.story;assert.equal(createNewsStorySourcesState(plain,value.page,TIME,parsed.city),null);
});

class TextFixture {
 constructor(text){this.textContent=text;this.parentElement=null;}
 remove(){if(this.parentElement){const list=this.parentElement.children;list.splice(list.indexOf(this),1);this.parentElement=null;}}
}
class ElementFixture extends EventTarget {
 constructor(tag,document){super();this.tagName=tag.toUpperCase();this.ownerDocument=document;this.parentElement=null;this.children=[];this.attributes={};this.dataset={};this.className='';this.open=false;this.hidden=false;this.disabled=false;this.focusCount=0;}
 get disabled(){return this._disabled;}
 set disabled(value){this._disabled=Boolean(value);if(this._disabled&&this.ownerDocument.activeElement===this)this.ownerDocument.activeElement=this.ownerDocument.body;}
 get isConnected(){return this===this.ownerDocument.body||Boolean(this.parentElement?.isConnected);}
 get textContent(){return this.children.map(child=>child.textContent).join('');}
 set textContent(value){for(const child of this.children)child.parentElement=null;this.children=[];if(value)this.append(new TextFixture(String(value)));}
 append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
 remove(){if(this.parentElement){const list=this.parentElement.children;list.splice(list.indexOf(this),1);this.parentElement=null;}}
 setAttribute(name,value){this.attributes[name]=String(value);}
 removeAttribute(name){delete this.attributes[name];}
 getAttribute(name){return this.attributes[name]??null;}
 matches(selector){return selector.startsWith('.')?this.className.split(/\s+/u).includes(selector.slice(1)):this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){const result=[];for(const child of this.children){if(!(child instanceof ElementFixture))continue;if(child.matches(selector))result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 focus(){this.ownerDocument.activeElement=this;this.focusCount++;}
}
function dom(t,fetcher){
 const previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),previousFetch=globalThis.fetch,previousNow=Date.now;
 const document={activeElement:null,createElement(tag){return new ElementFixture(tag,this);},createTextNode(text){return new TextFixture(text);}};document.body=document.createElement('body');
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});globalThis.fetch=fetcher;Date.now=()=>TIME;
 t.after(()=>{if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);else delete globalThis.document;globalThis.fetch=previousFetch;Date.now=previousNow;});
 return document;
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
function mounted(document,value,language='en'){
 const details=newsStorySourcesNode(value.item,value.page,language,value.city);assert.ok(details);document.body.append(details);details.open=true;
 return {details,button:details.querySelector('button'),list:details.querySelector('ol'),status:details.querySelector('.news-story-sources-status')};
}

test('constructing or opening a candidate disclosure makes no request, and every original label/link/date stays exact',t=>{
 let requests=0;const document=dom(t,()=>{requests++;throw Error('Unexpected automatic request');}),value=fixture(4),before=JSON.stringify(value);
 for(const {code} of LOCALES){
  const details=newsStorySourcesNode(value.item,value.page,code);assert.ok(details);assert.equal(details.isConnected,false);
  details.open=true;details.dispatchEvent(new Event('toggle'));
  const links=details.querySelectorAll('a'),times=details.querySelectorAll('time');
  assert.deepEqual(links.map(link=>link.textContent),value.originals.map(source=>source.card.title));
  assert.deepEqual(links.map(link=>link.href),value.originals.map(source=>source.card.sourceUrl));
  assert.deepEqual(times.map(time=>time.dateTime),value.originals.map(source=>source.card.date));
  assert.ok(links.every(link=>link.rel==='noopener noreferrer'&&link.target==='_blank'&&link.dir==='auto'));
  assert.ok(details.textContent.includes(translate(code,'storyReportsNote')));assert.equal(details.querySelector('button').hidden,true);
 }
 const pending=fixture(),detached=newsStorySourcesNode(pending.item,pending.page,'en');detached.open=true;detached.querySelector('button').dispatchEvent(new Event('click'));
 assert.equal(requests,0);assert.equal(JSON.stringify(value),before);assert.equal(document.body.children.length,0);
});

test('a manual request appends validated sources after the prefix and focuses the first new original only when the button still has focus',async t=>{
 const value=fixture(),calls=[];let release;
 const document=dom(t,function(input,options){assert.equal(this,undefined);calls.push({input,options});return new Promise(resolve=>{release=resolve;});});
 const view=mounted(document,value),prefix=[...view.list.children];view.button.focus();view.button.dispatchEvent(new Event('click'));
 assert.equal(calls.length,1);assert.equal(view.button.disabled,false);assert.equal(view.button.getAttribute('aria-disabled'),'true');assert.equal(document.activeElement,view.button);assert.equal(view.details.getAttribute('aria-busy'),'true');
 assert.equal(calls[0].input,'/api/news-page?'+new URLSearchParams({sources:value.item.story.nextSourcesCursor}).toString());
 assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.cache,'no-store');
 view.button.dispatchEvent(new Event('click'));assert.equal(calls.length,1);
 release(json(value.response()));await flush();
 assert.equal(view.list.children.length,24);assert.deepEqual(view.list.children.slice(0,4),prefix);
 assert.equal(document.activeElement,view.list.children[4].querySelector('a'));assert.equal(view.button.disabled,false);
 assert.equal(view.details.getAttribute('aria-busy'),null);
 const another=document.createElement('button');document.body.append(another);view.button.focus();view.button.dispatchEvent(new Event('click'));another.focus();
 release(json(value.response(24)));await flush();
 assert.equal(view.list.children.length,27);assert.equal(view.button.hidden,true);assert.equal(document.activeElement,another);
 assert.deepEqual(view.list.querySelectorAll('a').map(link=>link.href),value.originals.map(source=>source.card.sourceUrl));
});

test('unavailable or cross-context responses leave the original list and cursor intact and permit a bounded manual retry',async t=>{
 const value=fixture(),calls=[];let response=new Response('',{status:503});
 const document=dom(t,(input)=>{calls.push(input);return Promise.resolve(response);}),view=mounted(document,value);
 view.button.dispatchEvent(new Event('click'));await flush();
 assert.equal(view.list.children.length,4);assert.equal(view.button.disabled,false);assert.match(view.status.textContent,/unavailable/iu);
 response=json(value.response(4,{epoch:'2'}));view.button.dispatchEvent(new Event('click'));await flush();assert.equal(view.list.children.length,4);
 response=json(value.response());view.button.dispatchEvent(new Event('click'));await flush();assert.equal(view.list.children.length,24);
 assert.equal(new Set(calls).size,1);assert.equal(calls.length,3);
});

test('an expired edition keeps its original links visible and never retries the expired cursor',async t=>{
 let requests=0;const value=fixture(),document=dom(t,()=>{requests++;return Promise.resolve(new Response('',{status:410}));}),view=mounted(document,value);
 view.button.dispatchEvent(new Event('click'));await flush();
 assert.equal(requests,1);assert.equal(view.list.children.length,4);assert.equal(view.button.disabled,true);assert.match(view.status.textContent,/expired/iu);
 view.button.dispatchEvent(new Event('click'));assert.equal(requests,1);
 const fresh=mounted(document,value);Date.now=()=>Date.parse(value.page.expiresAt);fresh.button.dispatchEvent(new Event('click'));await flush();
 assert.equal(requests,1);assert.equal(fresh.button.disabled,true);assert.equal(fresh.list.children.length,4);
});

test('closing or detaching a disclosure during a request cannot append into an abandoned view',async t=>{
 const value=fixture();let release,signal,requests=0;
 const document=dom(t,(_input,options)=>{requests++;signal=options.signal;return new Promise(resolve=>{release=resolve;});}),view=mounted(document,value);
 view.button.dispatchEvent(new Event('click'));view.details.open=false;view.details.dispatchEvent(new Event('toggle'));
 assert.equal(signal.aborted,true);release(json(value.response()));await flush();assert.equal(view.list.children.length,4);assert.equal(view.button.disabled,false);
 view.details.open=true;view.button.dispatchEvent(new Event('click'));view.details.remove();release(json(value.response()));await flush();
 assert.equal(requests,2);assert.equal(view.list.children.length,4);assert.equal(view.details.getAttribute('aria-busy'),null);
});

test('source disclosure styles inherit approved card tones and keep readable wrapping and keyboard targets',()=>{
 const css=readFileSync('public/news-story.css','utf8');
 assert.match(css,/\.info-card \.news-story-sources\{[^}]*width:100%[^}]*var\(--card-bg/u);
 assert.match(css,/\.news-story-sources-more\{[^}]*min-height:44px/u);
 assert.match(css,/\.news-story-source-link\{[^}]*overflow-wrap:anywhere/u);
 assert.match(css,/:focus-visible\{outline:2px solid var\(--reader-focus,var\(--black\)\)/u);
 assert.match(css,/\.news-story-sources-more\[hidden\]/u);
 assert.doesNotMatch(css,/#(?:[0-9a-f]{3}){1,2}\b/iu);
});

test('story continuation binds source scope and accepts explicit edition for a legacy edition',()=>{
 const value=fixture(27,{sourceScope:'all'}),state=stateOf(value);
 const edition=value.response(4,{sourceScope:'edition'});assert.equal(validNewsStorySourcesPage(edition,TIME),true);
 assert.equal(appendNewsStorySources(state,edition,TIME),null);
 const missing=value.response();delete missing.sourceScope;assert.equal(validNewsStorySourcesPage(missing,TIME),true);
 assert.equal(appendNewsStorySources(state,missing,TIME),null);
 assert.equal(appendNewsStorySources(state,value.response(),TIME).sources.length,24);
 const legacy=fixture(),old=stateOf(legacy);
 assert.equal(appendNewsStorySources(old,legacy.response(4,{sourceScope:'edition'}),TIME).sources.length,24);
});

test('all-source disclosures label every original language without rewriting or relabelling headlines',t=>{
 const languages=['en','ro','ar','it'];
 const sources=languages.map((language,index)=>{
  const card=article(700+index,{language});
  if(language==='it'){
   const url='https://www.repubblica.it/politica/2026/11/22/news/national-fixture-425742775/';
   Object.assign(card,{sourceUrl:url,identity:url,id:hash(url).slice(0,24),publisher:'la Repubblica',title:'Il governo presenta la proposta al Parlamento',attribution:'Controlled Italian publisher fixture.'});
   card.contentHash=hash(cardContent(card));
  }
  return {kind:'global',card};
 });
 const value=fixture(4,{language:'ro',sourceScope:'all',sources}),before=JSON.stringify(value);
 const document=dom(t,()=>{throw Error('No automatic source request');}),view=mounted(document,value,'ro');
 const links=view.list.querySelectorAll('a'),labels=view.list.querySelectorAll('span').filter(node=>node.dataset.originalLanguage);
 assert.deepEqual(links.map(node=>node.textContent),sources.map(source=>source.card.title));
 assert.deepEqual(links.map(node=>node.lang),languages);assert.ok(links.every(node=>node.getAttribute('translate')==='no'));
 assert.deepEqual(labels.map(node=>node.dataset.originalLanguage),languages);
 assert.ok(labels.every(node=>node.textContent.length>0));
 assert.equal(JSON.stringify(value),before);assert.equal(document.body.children.length,1);
});

test('Romanian press-review citations stay visible and linked in grouped originals without automatic requests',t=>{
 let requests=0;const document=dom(t,()=>{requests++;throw Error('Unexpected source request');});
 const sources=[['Descopera','https://www.descopera.ro/stiinta/controlled-source'],['Spotmedia.ro','https://spotmedia.ro/stiri/stiinta/controlled-source']].map(([publisher,sourceUrl],index)=>{
  // Synthetic rendering record at the existing controlled test clock.
  const original=article(600+index,{language:'ro'}),card={...original,publisher,sourceUrl,identity:sourceUrl};
  card.id=hash(card.identity).slice(0,24);card.contentHash=hash(cardContent(card));
  return {kind:'global',card};
 });
 const value=fixture(2,{language:'ro',sources}),before=JSON.stringify(value);
 const details=newsStorySourcesNode(value.item,value.page,'ro');assert.ok(details);document.body.append(details);
 const rendered=details.querySelectorAll('li');assert.equal(rendered.length,2);
 for(let index=0;index<2;index++){
  const source=sources[index],citation=pressReviewCitation(source.card.sourceUrl),links=rendered[index].querySelectorAll('a');
  assert.ok(links.some(link=>link.textContent===citation.label&&link.href===citation.homeUrl));
  assert.ok(links.some(link=>link.textContent===source.card.title&&link.href===source.card.sourceUrl));
  assert.ok(links.some(link=>link.textContent===citation.originalLabel&&link.href===source.card.sourceUrl));
  assert.ok(links.every(link=>link.target==='_blank'&&link.rel==='noopener noreferrer'));
 }
 assert.equal(requests,0);assert.equal(JSON.stringify(value),before);
});
