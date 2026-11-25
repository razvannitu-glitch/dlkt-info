import test from 'node:test';
import assert from 'node:assert/strict';
import {admissionText,localReading,localReadingPreview,localCoverageReading} from '../.build/src/local/presentation.js';
import {findCity} from '../.build/src/local/cities.js';
import {renderLocalPlace} from '../.build/src/local/browser.js';
import {BUCHAREST_REFERENCES} from '../.build/src/local/reference-places.js';
import {localCardNode} from '../.build/src/local/card-node.js';
import {newsFeedsFor,newsGeographicAnchors,newsTopic,validLocalNewsArticle} from '../.build/src/local/news-policy.js';
import {articlePhotoPath} from '../.build/src/media/article-photo-reference.js';
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
 matches(selector){if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));if(selector==='img[data-reviewed-photo]')return this.tagName==='IMG'&&'reviewedPhoto' in this.dataset;if(selector==='img[data-article-photo]')return this.tagName==='IMG'&&'articlePhoto' in this.dataset;return this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){const matches=[];for(const child of this.children){if(!(child instanceof ElementFixture))continue;if(child.matches(selector))matches.push(child);matches.push(...child.querySelectorAll(selector));}return matches;}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 closest(selector){for(let element=this;element;element=element.parentElement)if(element.matches(selector))return element;return null;}
}
function directoryDom(t,failedAtCreation=false){
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createTextNode:value=>new TextFixture(value),createElement:tag=>{const element=new ElementFixture(tag);if(tag==='img'&&failedAtCreation){element.complete=true;element.naturalWidth=0;}return element;}}});
 t.after(()=>descriptor?Object.defineProperty(globalThis,'document',descriptor):delete globalThis.document);
}
const photoNow=Date.parse('2026-11-22T10:00:01.000Z');
test('all six directory cards keep the venue, provenance and category without an unrelated article photo',async t=>{
 directoryDom(t);const bucharest=findCity('683506'),before=JSON.stringify(BUCHAREST_REFERENCES);assert.ok(bucharest);assert.equal(BUCHAREST_REFERENCES.length,6);
 for(const place of BUCHAREST_REFERENCES){
  const article=renderLocalPlace(place,bucharest,null,photoNow),source=article.querySelector('.source-link');
  assert.equal(article.dataset.placeId,place.id);assert.equal(article.dataset.editorialCategory,place.category==='outdoors'?'environment':place.category);
  assert.equal(article.querySelector('h3').textContent,place.name);assert.equal(source.href,place.sourceUrl);assert.equal(source.target,'_blank');assert.equal(source.rel,'noopener noreferrer');
  assert.equal(article.querySelector('figure'),null);assert.equal(article.querySelectorAll('img').length,0);assert.equal(article.querySelector('.card-photo-label'),null);
  assert.match(article.querySelector('.card-boundary').textContent,/Wikidata structured data · CC0/);assert.equal(article.querySelector('.card-date'),null);
  const facebook=article.querySelectorAll('a').find(link=>link.textContent==='Facebook');assert.equal(facebook.href,'https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(place.sourceUrl));
 }
 assert.equal(JSON.stringify(BUCHAREST_REFERENCES),before);await Promise.resolve();
});
test('venue-name keywords never select a sports, campus or category image',async t=>{
 directoryDom(t);const check={checkedAt:'2026-11-22T10:00:00Z',dataAsOf:'2026-11-22T09:00:00Z'};
 for(const name of ['Football Cafe','University of Miskolc library reading room']){
  const place={...BUCHAREST_REFERENCES[0],id:'node/123',source:'osm',sourceUrl:'https://www.openstreetmap.org/node/123',name},before=JSON.stringify(place);
  const article=renderLocalPlace(place,city,check,photoNow);
  assert.equal(article.querySelector('figure'),null);assert.equal(article.querySelectorAll('img').length,0);
  assert.equal(article.querySelector('h3').textContent,name);assert.equal(article.querySelector('.source-link').href,place.sourceUrl);
  assert.match(article.querySelector('.card-boundary').textContent,/OpenStreetMap contributors · ODbL/);assert.match(article.querySelector('.card-date').textContent,/Map fetched .*Data as of/);assert.equal(JSON.stringify(place),before);
 }
 await Promise.resolve();
});
test('a photo-free directory card retains the same title and working original source action',async t=>{
 directoryDom(t);const place=BUCHAREST_REFERENCES[0],article=renderLocalPlace(place,city,null,photoNow),heading=article.querySelector('h3'),source=article.querySelector('.source-link');
 let activations=0;source.addEventListener('click',()=>activations++);await Promise.resolve();
 assert.equal(article.querySelector('figure'),null);assert.equal(article.querySelector('h3'),heading);assert.equal(heading.textContent,place.name);assert.equal(article.querySelector('.source-link'),source);assert.equal(source.href,place.sourceUrl);
 source.dispatchEvent(new Event('click'));assert.equal(activations,1);assert.equal(article.querySelectorAll('img').length,0);
});
test('directory rendering does not create an image request even when the browser would report a cached failure',async t=>{
 directoryDom(t,true);const place=BUCHAREST_REFERENCES[0],article=renderLocalPlace(place,city,null,photoNow),heading=article.querySelector('h3'),source=article.querySelector('.source-link');await Promise.resolve();
 assert.equal(article.querySelectorAll('img').length,0);assert.equal(article.querySelector('figure'),null);assert.equal(article.querySelector('h3'),heading);assert.equal(heading.textContent,place.name);assert.equal(article.querySelector('.source-link'),source);assert.equal(source.href,place.sourceUrl);
});

test('Romanian rendering uses measured weather numbers and source-backed CMTEB sector context',()=>{
 const roCity=findCity('683506'),stamp=new Date(now).toISOString();
 const weather={...event,kind:'forecast',id:'weather:'+roCity.id+':x',text:'Hourly forecast temperatures 2.3–3.9 °C. Total precipitation 0.8 mm over the six hourly periods. Highest hourly wind-speed forecast 17.6 km/h (not gusts).',validFrom:stamp,validTo:new Date(now+21600000).toISOString()};
 const before=JSON.stringify(weather);
 const ro=localReading(weather,roCity,now,'ro');
 assert.equal(ro.title,'Vremea in Bucuresti');
 assert.match(ro.paragraphs.join(' '),/2.3 si 3.9 °C/);
 assert.match(ro.paragraphs.join(' '),/0.8 mm/);
 assert.match(ro.paragraphs.join(' '),/17.6 km\/h/);
 assert.doesNotMatch(ro.paragraphs.join(' '),/Hourly forecast/);
 assert.equal(JSON.stringify(weather),before);
 const cmteb={...event,kind:'utility-notice',id:'bucharest:cmteb:overview',context:{...event.context,place:'Bucharest · sectors 1, 4, 6'}};
 const local=localReading(cmteb,roCity,now,'ro');
 assert.equal(local.title,'Situatia incalzirii si apei calde in Bucuresti');
 assert.match(local.paragraphs.join(' '),/1, 4, 6/);
 assert.match(local.nextStep,/CMTEB/);
 assert.equal(localReading(weather,roCity,now).title,'Weather in Bucharest');
});

test('compact local preview carries actual measurements and keeps forecast qualifiers',()=>{
 const card={...event,kind:'forecast',text:'Hourly forecast temperatures -1.3–0.8 °C. Total precipitation 0.8 mm over the six hourly periods. Highest hourly wind-speed forecast 14.8 km/h (not gusts).'},before=JSON.stringify(card);
 assert.equal(localReadingPreview(card,city,'ro'),'Prognoza: -1.3–0.8 °C · precipitatii 0.8 mm / 6 h.');
 assert.equal(localReadingPreview(card,city,'en'),'Forecast: -1.3–0.8 °C · precipitation 0.8 mm / 6 h.');
 assert.ok(localReading(card,city,now).paragraphs[0].includes('not gusts'));
 assert.equal(JSON.stringify(card),before);
 for(const text of ['Forecast unavailable.','Hourly forecast temperatures 1–2 °C. Warning: uncertainty.','Hourly forecast temperatures 1–2 °C. Total precipitation 0 mm over the six hourly periods. Highest hourly wind-speed forecast 3 km/h (not gusts). Additional restriction.']){
  assert.equal(localReadingPreview({...card,text},city,'ro'),null,'unknown or qualified wording is not silently shortened');
 }
});
test('compact operator preview uses only identified sectors and does not claim a building is affected',()=>{
 const bucharest=findCity('683506'),card={...event,id:'bucharest:cmteb:overview',kind:'utility-notice',context:{...event.context,place:'Bucharest · sectors 1, 4, 6'}},before=JSON.stringify(card);
 assert.equal(localReadingPreview(card,bucharest,'ro'),'CMTEB: anunturi pentru sectoarele 1, 4, 6.');
 assert.equal(localReadingPreview({...card,id:'bucharest:cmteb:sector-2'},bucharest,'en'),'CMTEB: notices for sectors 2.');
 assert.equal(localReadingPreview(card,city,'ro'),null);
 assert.equal(localReadingPreview({...card,context:{...card.context,place:'Unknown area'}},bucharest,'ro'),null);
 assert.equal(localReadingPreview({...card,id:'bucharest:cmteb:sector-7'},bucharest,'ro'),null);
 assert.equal(JSON.stringify(card),before);
});


test('private local rendering suppresses image requests while preserving provenance and default photos',async t=>{
 directoryDom(t);
 const images=[],imageRequests=[],transportRequests=[];
 const createElement=document.createElement;
 document.createElement=tag=>{
  const element=createElement(tag);
  if(tag==='img'){
   images.push(element);let src='';
   Object.defineProperty(element,'src',{configurable:true,get:()=>src,set:value=>{src=String(value);imageRequests.push(src);}});
  }
  return element;
 };
 const fetchDescriptor=Object.getOwnPropertyDescriptor(globalThis,'fetch');
 Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(...args)=>{
  transportRequests.push(args);throw Error('Unexpected local-card transport');
 }});
 t.after(()=>fetchDescriptor?Object.defineProperty(globalThis,'fetch',fetchDescriptor):delete globalThis.fetch);
 const bucharest=findCity('683506');assert.ok(bucharest);
 const source=newsFeedsFor(bucharest).find(item=>item.id==='bucharest-b365');assert.ok(source);
 const checkedAt=new Date(photoNow).toISOString(),title='Bucuresti: trafic modificat in zona centrala';
 const news={
  id:'local-news:'+bucharest.id+':'+source.id+':'+'b'.repeat(24),
  sourceId:source.id,publisher:source.publisher,cityId:bucharest.id,title,
  url:'https://b365.ro/fixture-bucuresti-123456/',publishedAt:new Date(photoNow-3_600_000).toISOString(),
  checkedAt,validUntil:new Date(photoNow+300_000).toISOString(),topic:newsTopic(title),
  geographyBasis:'article-place-reference',geoAnchors:newsGeographicAnchors(title,undefined,source.id,bucharest),
  documentHash:'c'.repeat(64),documentUrl:source.endpoint,attribution:source.attribution,
 };
 assert.equal(validLocalNewsArticle(news,bucharest,photoNow),true,'the photo-capable local report passes its real source contract');
 const card={id:news.id,kind:'local-news',title,text:'Controlled renderer fixture; read the original report.',
  publisher:source.publisher,sourceUrl:news.url,sourceUpdatedAt:null,checkedAt,
  validFrom:checkedAt,validTo:news.validUntil,facts:[],news,
  boundary:'Controlled city-referenced publisher record; no household impact is established.'};
 const before=JSON.stringify(card);
 const privateCard=localCardNode(card,bucharest,photoNow,{photos:false});
 await Promise.resolve();
 assert.equal(images.length,0,'private rendering never creates an image capable of sending account cookies');
 assert.deepEqual(imageRequests,[],'private rendering does not assign an image transport URL');
 assert.deepEqual(transportRequests,[],'private rendering does not start fetch transport');
 assert.equal(privateCard.querySelector('figure'),null);
 assert.equal(privateCard.querySelectorAll('img').length,0);
 const assertProvenance=article=>{
  assert.equal(article.querySelector('h3').textContent,title);
  assert.equal(article.dataset.localId,news.id);
  const original=article.querySelector('.source-link');
  assert.equal(original.href,news.url);assert.equal(original.target,'_blank');assert.equal(original.rel,'noopener noreferrer');
  assert.equal(article.querySelector('.card-content').querySelector('.card-boundary').textContent,source.publisher);
  assert.ok(article.querySelector('details').textContent.includes(source.attribution));
  assert.ok(article.querySelector('details').textContent.includes(card.boundary));
 };
 assertProvenance(privateCard);
 const publicCard=localCardNode(card,bucharest,photoNow);
 await Promise.resolve();
 assert.equal(images.length,1,'omitting the option preserves the existing public local-photo behavior');
 assert.deepEqual(imageRequests,[articlePhotoPath({id:news.id,revision:news.documentHash,cityId:bucharest.id})]);
 assert.deepEqual(transportRequests,[],'the default renderer uses the image element, not a fetch substitute');
 assert.equal(publicCard.querySelectorAll('img').length,1);
 assert.equal(publicCard.querySelector('img'),images[0]);
 assert.equal(images[0].dataset.articlePhoto,news.id);
 assert.equal(publicCard.querySelector('figure').dataset.photoKind,'source');
 assert.equal(publicCard.querySelector('figure').querySelector('a').href,news.url);
 assertProvenance(publicCard);
 assert.equal(JSON.stringify(card),before,'neither rendering mode mutates the checked source record');
});
