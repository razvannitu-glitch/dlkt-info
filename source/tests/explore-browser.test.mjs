import test from 'node:test';
import assert from 'node:assert/strict';
import {setupExplore} from '../.build/src/explore/browser.js';

// This event/DOM fixture exercises the actual controller and deferred responses.
// It does not claim CSS layout, browser rendering or live provider coverage.
class ElementFixture extends EventTarget {
 constructor(tag='div') {super();this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.dataset={};this.attributes=new Map();this.className='';this.id='';this.value='';this.hidden=false;this.disabled=false;this.ownText='';}
 get textContent(){return this.ownText+this.children.map(child=>child.textContent).join('');}
 set textContent(value){this.ownText=String(value);for(const child of this.children)child.parentElement=null;this.children=[];}
 get isConnected(){return this===document.body||Boolean(this.parentElement?.isConnected);}
 remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null;}}
 append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
 prepend(...nodes){for(const node of [...nodes].reverse()){node.remove();node.parentElement=this;this.children.unshift(node);}}
 replaceChildren(...nodes){this.textContent='';this.append(...nodes);}
 setAttribute(name,value){this.attributes.set(name,String(value));}
 getAttribute(name){return this.attributes.get(name)??null;}
 removeAttribute(name){this.attributes.delete(name);}
 matches(selector){if(selector==='[data-world-city]')return typeof this.dataset.worldCity==='string';if(selector.startsWith('.'))return this.className.split(/\s+/u).includes(selector.slice(1));return this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 focus(){document.activeElement=this;}
 scrollIntoView(){}
 getBoundingClientRect(){return{top:0,bottom:100,width:300,height:100};}
}
const cities={
 tokyo:{id:'1850147',name:'Tokyo',countryCode:'JP',country:'Japan',region:'Tokyo',lat:35.68,lon:139.69,timezone:'Asia/Tokyo'},
 paris:{id:'2988507',name:'Paris',countryCode:'FR',country:'France',region:'Île-de-France',lat:48.85,lon:2.35,timezone:'Europe/Paris'},
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=data=>({ok:true,text:async()=>JSON.stringify(data)});

function harness(t,url='https://www.dlkt.ee/?explore=1',{snapshot=null}={}){
 const originals=new Map(),restore=()=>{for(const[key,descriptor]of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];};
 const install=(key,value)=>{originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
 const doc=new EventTarget();doc.body=new ElementFixture('body');doc.visibilityState='hidden';doc.activeElement=doc.body;doc.createElement=tag=>new ElementFixture(tag);
 const ids=new Map();
 const names=['world-explore','world-title','world-open','world-nav','world-city-query','world-search','world-city-results','world-search-status','world-country','world-category','world-cards','world-status','world-place-title','world-place-date','world-empty','world-empty-title','world-empty-copy','world-more-wrap','world-more','world-country-view','world-reset-category','world-refresh','world-coverage-copy','world-copy-status','world-copy-fallback','world-everywhere','world-back','world-reset-place','world-copy','entry-today','entry-return','entry-saved','entry-show-city'];
 for(const id of names){const node=new ElementFixture(id.includes('query')||id.includes('fallback')?'input':id==='world-search'?'form':'div');node.id=id;ids.set(id,node);doc.body.append(node);}
 const section=ids.get('world-explore');for(const id of names.filter(id=>id.startsWith('world-')&&!['world-explore','world-open','world-nav'].includes(id)))section.append(ids.get(id));
 const destinations=new Map();for(const city of Object.values(cities)){const button=new ElementFixture('button');button.dataset.worldCity=city.id;section.append(button);destinations.set(city.id,button);}
 doc.getElementById=id=>ids.get(id)??null;
 const win=new EventTarget();win.location=new URL(url);win.scrollBy=()=>{};
 const historyCalls=[],history={pushState:(_state,_title,next)=>{historyCalls.push(['push',next]);win.location=new URL(next,win.location);},replaceState:(_state,_title,next)=>{historyCalls.push(['replace',next]);win.location=new URL(next,win.location);}};
 const requests=[],events=[],writes=[];
 for(const type of ['dlkt:city-selected','dlkt:reader-selected','dlkt:daily-selected'])doc.addEventListener(type,event=>events.push({type,detail:event.detail}));
 const fetch=(target,options)=>{
  const parsed=new URL(target,win.location);assert.equal(parsed.origin,win.location.origin,'only local public lookup endpoints are used');assert.equal(parsed.pathname,'/api/places');assert.equal(options.credentials,'omit');
  if(parsed.searchParams.get('countries')==='1')return Promise.resolve(response({countries:[{code:'FR',name:'France'},{code:'JP',name:'Japan'}]}));
  return new Promise(resolve=>requests.push({url:parsed,signal:options.signal,resolve:data=>resolve(response(data))}));
 };
 for(const[key,value]of Object.entries({document:doc,window:win,history,HTMLElement:ElementFixture,innerHeight:800,fetch,
  localStorage:{setItem:(...args)=>writes.push(['localStorage',...args]),removeItem:(...args)=>writes.push(['localStorage.remove',...args]),getItem:()=>null},
  sessionStorage:{setItem:(...args)=>writes.push(['sessionStorage',...args]),removeItem:(...args)=>writes.push(['sessionStorage.remove',...args]),getItem:()=>null},
  indexedDB:{open:(...args)=>{writes.push(['indexedDB.open',...args]);throw Error('EXPLORE_MUST_NOT_OPEN_PRIVATE_STORAGE');}}}))install(key,value);
 const renderings=[],renderedCards=[];
 const controller=setupExplore({snapshot:()=>snapshot,loading:()=>false,failed:()=>false,refresh:()=>{},saved:()=>{},
  card:view=>{renderedCards.push(view.card);const article=new ElementFixture('article');article.dataset.cardId=view.card.id;const content=new ElementFixture('div');content.className='card-content';const title=new ElementFixture('h3');title.textContent=view.heading;content.append(title);const evidence=new ElementFixture('details');evidence.className='evidence';article.append(content,evidence);return article;},
  reconcile:(target,next)=>{renderings.push(next.querySelectorAll('article').map(article=>({id:article.dataset.cardId,signature:article.dataset.liveSignature,scope:article.dataset.exploreScope,text:article.textContent})));target.replaceChildren(...next.children);}});
 t.after(()=>{ids.get('world-back').dispatchEvent(new Event('click'));restore();});
 const click=id=>(ids.get(id)??destinations.get(id)).dispatchEvent(new Event('click'));
 const pending=(key,value)=>requests.find(request=>request.url.searchParams.get(key)===value);
 return{doc,win,ids,click,pending,requests,writes,events,historyCalls,controller,renderings,renderedCards,
  resolveCity:async city=>{const request=pending('id',city.id);assert.ok(request,'city lookup was requested');request.resolve({cities:[city],cityAliases:[city.name]});await tick();},
  pop:next=>{win.location=new URL(next,win.location);win.dispatchEvent(new Event('popstate'));}};
}

test('restored profiles do not close an explicitly opened Explore URL; explicit navigation still closes it',async t=>{
 const h=harness(t);await tick();
 for(const type of ['dlkt:reader-selected','dlkt:daily-selected','dlkt:city-selected'])h.doc.dispatchEvent(new CustomEvent(type,{detail:{restored:true,city:cities.tokyo}}));
 h.doc.dispatchEvent(new CustomEvent('dlkt:city-selected',{detail:{estimated:true,city:cities.tokyo}}));
 assert.equal(h.doc.body.dataset.worldExplore,'active');assert.equal(h.ids.get('world-explore').hidden,false);assert.equal(h.win.location.searchParams.get('explore'),'1');
 h.click('entry-today');assert.equal(h.ids.get('world-explore').hidden,true);assert.equal(h.win.location.searchParams.has('explore'),false);
});

test('rapid Tokyo to Paris selection retains category and ignores a late Tokyo response',async t=>{
 const h=harness(t,'https://www.dlkt.ee/?explore=1&city=1850147&category=culture');
 const tokyoRequest=h.pending('id',cities.tokyo.id);assert.ok(tokyoRequest);h.click(cities.paris.id);assert.equal(tokyoRequest.signal.aborted,true);
 await h.resolveCity(cities.paris);tokyoRequest.resolve({cities:[cities.tokyo],cityAliases:['Tokyo','東京']});await tick();
 assert.equal(h.ids.get('world-place-title').textContent,'Paris, France');assert.equal(h.ids.get('world-city-query').value,'Paris');
 assert.equal(h.win.location.searchParams.get('city'),cities.paris.id);assert.equal(h.win.location.searchParams.get('country'),'FR');assert.equal(h.win.location.searchParams.get('category'),'culture');
});

test('history navigation invalidates a previous search even when the aborted response arrives late',async t=>{
 const h=harness(t);await tick();h.ids.get('world-city-query').value='Paris';h.ids.get('world-search').dispatchEvent(new Event('submit',{cancelable:true}));
 const old=h.pending('q','Paris');assert.ok(old);
 h.pop('https://www.dlkt.ee/?explore=1&country=JP');assert.equal(old.signal.aborted,true);old.resolve({cities:[cities.paris]});await tick();
 assert.equal(h.ids.get('world-city-results').hidden,true);assert.equal(h.ids.get('world-city-results').children.length,0);assert.equal(h.ids.get('world-search-status').textContent,'');
 assert.equal(h.ids.get('world-place-title').textContent,'Japan');assert.equal(h.win.location.searchParams.get('country'),'JP');
});

test('public place/category navigation and history leave private preferences untouched',async t=>{
 const h=harness(t,'https://www.dlkt.ee/?explore=1&category=science');await tick();h.click(cities.tokyo.id);await h.resolveCity(cities.tokyo);
 h.ids.get('world-category').value='culture';h.ids.get('world-category').dispatchEvent(new Event('change'));
 h.click('world-everywhere');h.pop('https://www.dlkt.ee/?explore=1&country=FR&category=culture');await tick();h.click('world-back');
 assert.deepEqual(h.writes,[]);assert.deepEqual(h.events,[],'Explore does not publish home/profile selection events');
 assert.equal(h.win.location.searchParams.has('explore'),false);assert.equal(h.ids.get('world-explore').hidden,true);
});

test('same publication changes reconciliation identity when geographical evidence changes',async t=>{
 const now=new Date().toISOString();const card=Object.freeze({id:'a'.repeat(24),identity:'explore-controller-fixture',title:'Tokyo opens a new public museum',kind:'publication',topic:'culture',publisher:'BBC',sourceUrl:'https://www.bbc.com/news/articles/controller-geography-fixture',sourceIds:Object.freeze(['news-culture']),date:now,dateLabel:'Published',observedAt:now,contentHash:'b'.repeat(64),boundary:'Controlled fixture.',deadline:null,version:null,attribution:'BBC',sourceState:'verified'});
 const before=JSON.stringify(card),snapshot={cards:[card],generatedAt:now,state:'ready'};
 const h=harness(t,'https://www.dlkt.ee/?explore=1&lang=en',{snapshot});await tick();
 const world=h.renderings.at(-1)[0];assert.ok(world);assert.equal(world.scope,'world');
 h.click(cities.tokyo.id);await h.resolveCity(cities.tokyo);const local=h.renderings.at(-1)[0];
 assert.equal(local.id,world.id);assert.equal(local.scope,'city');assert.notEqual(local.signature,world.signature);assert.match(local.text,/Mentioning Tokyo/);assert.match(local.text,/not independently verified/);
 h.click('world-everywhere');const again=h.renderings.at(-1)[0];assert.equal(again.id,world.id);assert.equal(again.signature,world.signature);assert.doesNotMatch(again.text,/not independently verified/);
 assert.ok(h.renderedCards.every(record=>record===card));assert.equal(JSON.stringify(card),before);assert.equal(card.contentHash,'b'.repeat(64));
});

test('Romanian presentation changes country/category labels without changing the selected geography',async t=>{
 const h=harness(t,'https://www.dlkt.ee/?explore=1&country=JP&category=culture&lang=ro');await tick();
 assert.equal(h.ids.get('world-place-title').textContent,'Japonia');
 assert.equal(h.ids.get('world-country').value,'JP');assert.equal(h.ids.get('world-category').value,'culture');
 assert.match(h.ids.get('world-category').textContent,/Cultură/);
 assert.equal(h.ids.get('world-empty-title').textContent,'Știrile actuale nu sunt disponibile.');
 assert.deepEqual(h.writes,[]);assert.deepEqual(h.events,[]);
});

test('changing language cancels an in-flight search and late city results cannot restore old-language UI',async t=>{
 const h=harness(t);await tick();h.ids.get('world-city-query').value='Paris';h.ids.get('world-search').dispatchEvent(new Event('submit',{cancelable:true}));
 const old=h.pending('q','Paris');assert.ok(old);
 h.win.location.searchParams.set('lang','ar');h.doc.dispatchEvent(new CustomEvent('dlkt:language-changed',{detail:{locale:'ar'}}));
 assert.equal(old.signal.aborted,true);old.resolve({cities:[cities.paris]});await tick();
 assert.equal(h.ids.get('world-city-results').hidden,true);assert.equal(h.ids.get('world-city-results').children.length,0);
 assert.match(h.ids.get('world-place-title').textContent,/[\u0600-\u06ff]/u);assert.deepEqual(h.writes,[]);
});

test('locale changes select reviewed national and international editorial languages and preserve exact original records',async t=>{
 const now=new Date().toISOString();
 const english=Object.freeze({id:'c'.repeat(24),identity:'english-source-fixture',title:'Tokyo opens a new public museum',kind:'publication',topic:'culture',publisher:'BBC',sourceUrl:'https://www.bbc.com/news/articles/controller-language-fixture',sourceIds:Object.freeze(['news-culture']),date:now,dateLabel:'Published',observedAt:now,contentHash:'d'.repeat(64),boundary:'Controlled fixture.',deadline:null,version:null,attribution:'BBC',sourceState:'verified'});
 const japanese=Object.freeze({...english,id:'e'.repeat(24),identity:'japanese-source-fixture',title:'東京で新しい美術館が開館',sourceUrl:'https://www.bbc.com/japanese/articles/controller-language-fixture',contentHash:'f'.repeat(64)});
 const international=Object.freeze({...english,id:'1'.repeat(24),identity:'international-language-fixture',title:'An English international publication without national edition provenance',publisher:'Global Voices',sourceUrl:'https://globalvoices.org/2026/11/21/controller-language-fixture/',sourceIds:Object.freeze(['gv-world']),contentHash:'2'.repeat(64),attribution:'Global Voices'});
 const unknown=Object.freeze({...english,id:'3'.repeat(24),identity:'unknown-language-fixture',title:'An original publication with unreviewed language',publisher:'Reuters',sourceUrl:'https://www.reuters.com/world/controller-language-fixture/',sourceIds:Object.freeze(['news-culture']),contentHash:'4'.repeat(64),attribution:'Reuters'});
 const records=Object.freeze([english,japanese,international,unknown]),before=JSON.stringify(records);
 const h=harness(t,'https://www.dlkt.ee/?explore=1&lang=en',{snapshot:{cards:records,generatedAt:now,state:'ready'}});await tick();
 assert.equal(h.renderings.at(-1).length,2);const firstEnglish=h.renderings.at(-1).find(item=>item.id===english.id),firstInternational=h.renderings.at(-1).find(item=>item.id===international.id);assert.ok(firstEnglish);assert.ok(firstInternational);assert.ok(firstEnglish.text.includes(english.title));assert.ok(firstInternational.text.includes(international.title));assert.equal(firstInternational.scope,'world');
 h.win.location.searchParams.set('lang','ja');h.doc.dispatchEvent(new CustomEvent('dlkt:language-changed',{detail:{locale:'ja'}}));
 assert.equal(h.renderings.at(-1).length,1);const shownJapanese=h.renderings.at(-1)[0];
 assert.equal(shownJapanese.id,japanese.id);assert.notEqual(shownJapanese.signature,firstEnglish.signature);assert.ok(shownJapanese.text.includes(japanese.title));assert.ok(!shownJapanese.text.includes(english.title));
 h.win.location.searchParams.set('lang','en');h.doc.dispatchEvent(new CustomEvent('dlkt:language-changed',{detail:{locale:'en'}}));
 assert.equal(h.renderings.at(-1).length,2);const returnedEnglish=h.renderings.at(-1).find(item=>item.id===english.id),returnedInternational=h.renderings.at(-1).find(item=>item.id===international.id);assert.ok(returnedEnglish);assert.ok(returnedInternational);assert.equal(returnedInternational.signature,firstInternational.signature);
 assert.equal(returnedEnglish.id,english.id);assert.equal(returnedEnglish.signature,firstEnglish.signature);
 assert.ok(h.renderedCards.includes(english));assert.ok(h.renderedCards.includes(japanese));assert.ok(h.renderedCards.includes(international));assert.ok(!h.renderedCards.includes(unknown));
 assert.ok(h.renderedCards.every(record=>record===english||record===japanese||record===international));assert.equal(JSON.stringify(records),before);assert.deepEqual(h.writes,[]);
 h.pop('https://www.dlkt.ee/?explore=1&country=FR&lang=ro');await tick();assert.equal(h.ids.get('world-place-title').textContent,'Franța');
 assert.equal(h.renderings.at(-1).length,0,'an uncovered edition does not silently keep English or Japanese headlines');
 assert.equal(JSON.stringify(records),before);
});

test('shared Explore URLs retain the chosen language and exclude unrelated private query values',async t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'navigator'),copied=[];
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{languages:['de-DE'],clipboard:{writeText:async value=>{copied.push(value);}}}});
 t.after(()=>original?Object.defineProperty(globalThis,'navigator',original):delete globalThis.navigator);
 const h=harness(t,'https://www.dlkt.ee/?explore=1&country=JP&category=culture&lang=ro&private=excluded#private-anchor');await tick();
 h.click('world-copy');await tick();assert.equal(copied.length,1);const url=new URL(copied[0]);
 assert.equal(url.searchParams.get('lang'),'ro');assert.equal(url.searchParams.get('country'),'JP');assert.equal(url.searchParams.get('category'),'culture');
 assert.equal(url.searchParams.has('private'),false);assert.equal(url.hash,'');assert.deepEqual(h.writes,[]);
});
