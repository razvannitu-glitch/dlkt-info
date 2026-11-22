import test from 'node:test';
import assert from 'node:assert/strict';
import {admissionText,localReading,localCoverageReading} from '../.build/src/local/presentation.js';
import {findCity} from '../.build/src/local/cities.js';
import {renderLocalPlace} from '../.build/src/local/browser.js';
import {BUCHAREST_REFERENCES} from '../.build/src/local/reference-places.js';
import {EDITORIAL_PHOTOS} from '../.build/src/media/editorial-photos.js';
const city=findCity('2512989'),now=Date.parse('2026-11-15T16:00:00Z');
const event={id:'palma:event:1',kind:'event',title:'Final Pop-Rock 2026',text:'Original publisher listing.',publisher:'PalmaCultura',sourceUrl:'https://www.palmacultura.com/ca/noticia/12478/final-pop-rock-2026',sourceUpdatedAt:null,checkedAt:new Date(now).toISOString(),validFrom:new Date(now).toISOString(),validTo:new Date(now+300000).toISOString(),facts:['Listed admission terms: entrada libre con reserva previa (aforo limitado)'],boundary:'Availability not checked.',context:{section:'discover',place:'Es Gremi · c. Gremi de Porgadors, 16',when:'2026-11-15 · a partir de las 18 h (Europe/Madrid)',why:'Scheduled in your selected city today; its listed start is still ahead.',action:'Confirm with the organiser.',sourceDate:'2026-11-15',startsAt:'2026-11-15T17:00:00.000Z',status:'scheduled',documentHash:'a'.repeat(64),documentUrl:'https://www.palmacultura.com/index.php?Idi=2'}};
test('event foreground explains local time, venue, reservation and capacity in natural text',()=>{const r=localReading(event,city,now);assert.equal(r.title,event.title);assert.match(r.paragraphs[0],/Today from 18:00 \(Palma time\) at Es Gremi/);assert.match(r.paragraphs[1],/Free admission with advance reservation\. Capacity is limited\./);assert.equal(r.period,null);assert.doesNotMatch(r.paragraphs.join(' '),/2026-11-15|Europe\/Madrid|selected city|Recheck/);});
test('same city day is independent of the reader timezone and a later date is explicit',()=>{const r=localReading(event,city,Date.parse('2026-11-14T23:30:00Z'));assert.match(r.paragraphs[0],/Today/);const later=localReading({...event,context:{...event.context,startsAt:'2026-11-16T17:00:00.000Z'}},city,now);assert.match(later.paragraphs[0],/16 November/);assert.doesNotMatch(later.paragraphs[0],/Today/);});
test('unknown admission terms retain restrictions, prices and exceptions verbatim',()=>{for(const terms of ['20 euros; solo mayores de 18 años','gratuito excepto material obligatorio de 5 euros','entrada libre con reserva previa, lista de espera'])assert.equal(admissionText(terms),'Admission terms from the organiser: '+terms);});
test('known free wording does not become an availability guarantee',()=>{assert.equal(admissionText('gratuito con reserva de entrada'),'Free admission with a ticket reservation.');assert.match(admissionText('entrada libre hasta completar aforo'),/subject to capacity/);assert.doesNotMatch(localReading(event,city,now).nextStep,/tickets available|guaranteed|confirmed booking/i);});
test('missing structured admission falls back to complete original text',()=>{const r=localReading({...event,facts:[]},city,now);assert.deepEqual(r.paragraphs,[event.text]);assert.equal(r.period,event.context.when);});
test('readable presentation never changes machine-readable source, time, facts or evidence',()=>{const before=JSON.stringify(event);localReading(event,city,now);assert.equal(JSON.stringify(event),before);});
test('forecast window remains separate from event starts and source check expiry',()=>{const r=localReading({...event,kind:'forecast',context:undefined,text:'Forecast values.',validFrom:'2026-11-15T18:00:00Z',validTo:'2026-11-16T00:00:00Z'},city,now);assert.equal(r.title,'Weather in Palma');assert.match(r.period,/15 Nov.*16 Nov/);assert.deepEqual(r.paragraphs,['Forecast values.']);assert.equal(r.nextStep,null);});

test('exact event hour is not changed to a from-time',()=>{const r=localReading({...event,context:{...event.context,when:'2026-11-15 · 18 h (Europe/Madrid)'}},city,now);assert.match(r.paragraphs[0],/Today at 18:00/);assert.doesNotMatch(r.paragraphs[0],/from 18:00/);});

const sourceCard=(kind)=>({...event,id:'palma:'+kind,kind,text:'Generic source introduction.',facts:['Operator notice published: 2026-11-15','Affected lines: 101','Desde las 8 h hasta las 22 h, las paradas A y B quedan suprimidas en dirección a Palma.'],context:{...event.context,section:kind==='municipal-news'?'context':'essential',startsAt:null,status:kind==='municipal-news'?'publisher-announcement':'operator-notice'}});
const coverage=(domain,state)=>({domain,state,sourceUrl:domain==='events'?'https://www.palmacultura.com/index.php?Idi=2':domain==='transport'?'https://www.tib.org/es/avisos':domain==='administration'?'https://noticies.palma.es/inici':null,checkedAt:new Date(now).toISOString(),note:'Detailed source scope.'});
const snapshot=(cards,items)=>({version:'dlkt-local-1',city,checkedAt:new Date(now).toISOString(),state:'partial',weatherState:'unavailable',transportState:'not-covered',cards,coverage:items});
test('operator body with stops, directions and qualifiers is visible verbatim in primary reading',()=>{const card=sourceCard('transport-notice'),before=JSON.stringify(card);const r=localReading(card,city,now);assert.equal(r.paragraphs[0],card.text);assert.equal(r.paragraphs[1],'Operator notice (original wording): '+card.facts[2]);assert.equal(JSON.stringify(card),before);});
test('council reading says exactly what is available and does not invent a document summary',()=>{const card=sourceCard('municipal-news'),r=localReading(card,city,now);assert.match(r.paragraphs[0],/Published 15 November 2026/);assert.match(r.paragraphs[0],/headline and date/);assert.equal(r.paragraphs[1],card.boundary);});
test('checked sources with no eligible records stay distinct from unavailable sources',()=>{const r=localCoverageReading(snapshot([],[coverage('transport','ready'),coverage('events','ready'),coverage('administration','unavailable')]),now);assert.equal(r.length,3);assert.match(r[0].text,/No verified TIB notice/);assert.match(r[0].text,/other transport are not covered/);assert.match(r[1].text,/Events already started and ticket availability are not checked/);assert.match(r[2].text,/could not be verified/);assert.doesNotMatch(r.map(x=>x.text).join(' '),/no disruptions|normal service|no events today/i);});
test('expired records lead to refresh advice without being described as a fresh empty result',()=>{const expired={...event,validTo:new Date(now-1).toISOString()};const r=localCoverageReading(snapshot([expired],[coverage('events','ready')]),now);assert.match(r[0].text,/check has expired/);assert.doesNotMatch(r[0].text,/No verified event/);});
test('accepted records stay visible while partial coverage is disclosed',()=>{const r=localCoverageReading(snapshot([event],[coverage('events','partial')]),now);assert.equal(r.length,1);assert.match(r[0].text,/Some source records could not be verified/);assert.doesNotMatch(r[0].text,/No verified event/);assert.deepEqual(localCoverageReading(snapshot([event],[coverage('events','ready')]),now),[]);});
test('every disconnected category stays explicit in one readable paragraph and creates no source link',()=>{const categories=['utilities','emergency-alerts','exchange','accommodation','opportunities'];const r=localCoverageReading(snapshot([],categories.map(d=>coverage(d,'not-covered'))),now);assert.equal(r.length,1);assert.equal(r[0].sourceUrl,null);for(const label of ['utility interruptions','official emergency warnings','currency reference rates','accommodation prices and availability','local opportunities and deadlines'])assert.ok(r[0].text.includes(label));});
test('other cities without the Palma source coverage keep their existing presentation',()=>{const v=snapshot([],[]);delete v.coverage;assert.deepEqual(localCoverageReading(v,now),[]);});

test('source-index checks expire even when the source returned no card',()=>{const r=localCoverageReading(snapshot([],[coverage('events','ready')]),now+300001);assert.match(r[0].text,/check has expired/);assert.doesNotMatch(r[0].text,/No verified event/);});

test('affected lines remain explicit when the operator body omits their identifiers',()=>{const card={...sourceCard('transport-notice'),text:'TIB reports a change affecting 101 and 102 on access to Palma.'};const r=localReading(card,city,now);assert.match(r.paragraphs.join(' '),/101 and 102/);assert.ok(r.paragraphs.join(' ').includes(card.facts[2]));});

// Exercise the actual directory renderer without a network or browser session.
class TextFixture {
 constructor(value){this.textContent=value;this.parentElement=null;}
 remove(){if(this.parentElement){const children=this.parentElement.children;children.splice(children.indexOf(this),1);this.parentElement=null;}}
}
class ElementFixture extends EventTarget {
 constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.dataset={};this.attributes={};this.className='';this.hidden=false;this.complete=false;this.naturalWidth=960;this.classList={contains:name=>this.className.split(/\s+/).includes(name)};}
 get textContent(){return this.children.map(child=>child.textContent).join('');}
 set textContent(value){for(const child of this.children)child.parentElement=null;this.children=[];if(value)this.append(new TextFixture(value));}
 append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
 remove(){if(this.parentElement){const children=this.parentElement.children;children.splice(children.indexOf(this),1);this.parentElement=null;}}
 setAttribute(name,value){this.attributes[name]=String(value);}
 matches(selector){if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));if(selector==='img[data-reviewed-photo]')return this.tagName==='IMG'&&'reviewedPhoto' in this.dataset;return this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){const matches=[];for(const child of this.children){if(!(child instanceof ElementFixture))continue;if(child.matches(selector))matches.push(child);matches.push(...child.querySelectorAll(selector));}return matches;}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 closest(selector){for(let element=this;element;element=element.parentElement)if(element.matches(selector))return element;return null;}
}
function directoryDom(t,failedAtCreation=false){
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createTextNode:value=>new TextFixture(value),createElement:tag=>{const element=new ElementFixture(tag);if(tag==='img'&&failedAtCreation){element.complete=true;element.naturalWidth=0;}return element;}}});
 t.after(()=>descriptor?Object.defineProperty(globalThis,'document',descriptor):delete globalThis.document);
}
const photoNow=Math.max(...EDITORIAL_PHOTOS.map(photo=>Date.parse(photo.reviewedAt)))+1000;
test('all six Bucharest directory cards receive a labelled illustration and category without changing the venue or source',async t=>{
 directoryDom(t);const bucharest=findCity('683506'),before=JSON.stringify(BUCHAREST_REFERENCES);assert.ok(bucharest);assert.equal(BUCHAREST_REFERENCES.length,6);
 for(const place of BUCHAREST_REFERENCES){
  const article=renderLocalPlace(place,bucharest,null,photoNow),figure=article.querySelector('figure'),source=article.querySelector('.source-link');
  assert.equal(article.dataset.placeId,place.id);assert.equal(article.dataset.editorialCategory,place.category==='outdoors'?'environment':place.category);
  assert.equal(article.querySelector('h3').textContent,place.name);assert.equal(source.href,place.sourceUrl);assert.equal(source.target,'_blank');assert.equal(source.rel,'noopener noreferrer');
  assert.equal(article.querySelectorAll('img[data-reviewed-photo]').length,1);assert.equal(figure.dataset.photoKind,'editorial');
  assert.equal(figure.querySelector('.card-photo-label').dataset.i18n,'photoEditorialLabel');assert.equal(figure.querySelector('.card-photo-note').dataset.i18n,'photoEditorialNote');
  assert.match(figure.querySelector('img').alt,/Illustrative photograph: .*Not the reported event\./u);
  assert.match(article.querySelector('.card-boundary').textContent,/Wikidata structured data · CC0/);assert.equal(article.querySelector('.card-date'),null);
  const facebook=article.querySelectorAll('a').find(link=>link.textContent==='Facebook');assert.equal(facebook.href,'https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(place.sourceUrl));
 }
 assert.equal(JSON.stringify(BUCHAREST_REFERENCES),before);await Promise.resolve();
});
test('venue-name keywords do not turn a neutral directory illustration into purported sports or campus context',async t=>{
 directoryDom(t);const check={checkedAt:'2026-11-22T10:00:00Z',dataAsOf:'2026-11-22T09:00:00Z'};
 for(const name of ['Football Cafe','University of Miskolc library reading room']){
  const place={...BUCHAREST_REFERENCES[0],id:'node/123',source:'osm',sourceUrl:'https://www.openstreetmap.org/node/123',name},before=JSON.stringify(place);
  const article=renderLocalPlace(place,city,check,photoNow);
  assert.equal(article.querySelector('figure').dataset.photoKind,'editorial');assert.equal(article.querySelector('h3').textContent,name);assert.equal(article.querySelector('.source-link').href,place.sourceUrl);
  assert.match(article.querySelector('.card-boundary').textContent,/OpenStreetMap contributors · ODbL/);assert.match(article.querySelector('.card-date').textContent,/Map fetched .*Data as of/);assert.equal(JSON.stringify(place),before);
 }
 await Promise.resolve();
});
test('a directory image failure preserves the same venue title and source action without image retries',async t=>{
 directoryDom(t);const place=BUCHAREST_REFERENCES[0],article=renderLocalPlace(place,city,null,photoNow),heading=article.querySelector('h3'),source=article.querySelector('.source-link'),image=article.querySelector('img'),initial=image.src;
 let activations=0;source.addEventListener('click',()=>activations++);image.dispatchEvent(new Event('error'));await Promise.resolve();
 assert.equal(article.querySelector('figure'),null);assert.equal(article.querySelector('h3'),heading);assert.equal(heading.textContent,place.name);assert.equal(article.querySelector('.source-link'),source);assert.equal(source.href,place.sourceUrl);
 source.dispatchEvent(new Event('click'));assert.equal(activations,1);assert.equal(image.src,initial);assert.equal(article.querySelectorAll('img').length,0);
});
test('a cached directory image failure retains the venue and original source',async t=>{
 directoryDom(t,true);const place=BUCHAREST_REFERENCES[0],article=renderLocalPlace(place,city,null,photoNow),heading=article.querySelector('h3'),source=article.querySelector('.source-link');await Promise.resolve();
 assert.equal(article.querySelector('figure'),null);assert.equal(article.querySelector('h3'),heading);assert.equal(heading.textContent,place.name);assert.equal(article.querySelector('.source-link'),source);assert.equal(source.href,place.sourceUrl);
});
