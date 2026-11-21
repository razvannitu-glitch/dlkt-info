import test from 'node:test';
import assert from 'node:assert/strict';
import {localEventCalendar} from '../.build/src/local/event-calendar.js';
import {localCardNode} from '../.build/src/local/card-node.js';
import {parseCulture} from '../.build/src/local/publications.js';
import {parseArcubAgenda,parseArcubDetail} from '../.build/src/local/arcub.js';
import {findCity} from '../.build/src/local/cities.js';

const now=Date.parse('2026-11-20T12:00:00Z'),checkedAt=new Date(now).toISOString();
const palma=findCity('2512989'),bucharest=findCity('683506');
const culture=(at=now,day='20 noviembre de 2026')=>parseCulture({checkedAt:new Date(at).toISOString(),body:`<div class="box"><h3><a href="https://www.palmacultura.com/es/noticia/12478/concert">Concert in Palma</a></h3><p>Fecha: ${day}<br>Hora: 18 h<br>Lugar: Es Gremi<br>Dirección: c. Gremi de Porgadors, 16<br>Precio: entrada libre con reserva previa (aforo limitado)</p></div>`},at).cards[0];
const arcub=(at=now,when='21 noiembrie',body='21 noiembrie 2026, ora 19:30.')=>{
 const checkedAt=new Date(at).toISOString(),url='https://arcub.ro/eveniment/concert';
 const card=parseArcubAgenda({checkedAt,body:`<div class="pgrid-item"><a href="${url}"><h3>Concert at ARCUB</h3><div class="meta"><span>${when}</span><span>ARCUB - Hanul Gabroveni</span></div></a></div>`},at).cards[0];
 return parseArcubDetail({checkedAt,url,body:`<div class="phead"><h1 class="title">Concert at ARCUB</h1><table class="feat"><tr><td class="lbl">Când</td><td class="val">${when}</td></tr><tr><td class="lbl">Unde</td><td class="val">ARCUB - Hanul Gabroveni</td></tr></table><div class="content"><p>${body}</p></div></div>`},card,at);
};
const unfold=content=>content.replace(/\r\n[ \t]/gu,'');

test('Palma calendar retains admission restrictions, source, precise start and stable event identity',()=>{
 const card=culture(),before=JSON.stringify(card),file=localEventCalendar(card,palma,now);
 assert.ok(file);assert.equal(file.contentType,'text/calendar;charset=utf-8');assert.equal(file.filename,'dlkt-palma-event-12478.ics');
 const text=unfold(file.content);
 assert.match(text,/DTSTART:20261120T170000Z\r\n/u);
 assert.match(text,/Listed admission terms: entrada libre con reserva previa \(aforo limitado\)/u);
 assert.ok(text.includes('URL:'+card.sourceUrl+'\r\n'));
 assert.match(text,/LOCATION:Es Gremi · c\. Gremi de Porgadors\\, 16\r\n/u);
 assert.doesNotMatch(text,/\r\n(?:DTEND|DURATION|STATUS|ORGANIZER|ATTENDEE|BEGIN:VALARM)[:;]/u);
 assert.equal(JSON.stringify(card),before);
 const again=unfold(localEventCalendar(card,palma,now+1000).content);
 assert.equal(again.match(/^UID:.+$/mu)?.[0],text.match(/^UID:.+$/mu)?.[0]);
});

test('ARCUB calendar uses the verified event detail and preserves winter and summer UTC instants',()=>{
 const winter=arcub(),file=localEventCalendar(winter,bucharest,now);
 assert.ok(file);assert.match(file.content,/DTSTART:20261121T173000Z\r\n/u);
 const summerAt=Date.parse('2026-06-20T12:00:00Z'),summer=arcub(summerAt,'21 iunie','21 iunie 2026, ora 19:30.');
 assert.match(localEventCalendar(summer,bucharest,summerAt).content,/DTSTART:20260621T163000Z\r\n/u);
 const palmaAt=Date.parse('2026-06-20T12:00:00Z'),palmaSummer=culture(palmaAt,'20 junio de 2026');
 assert.match(localEventCalendar(palmaSummer,palma,palmaAt).content,/DTSTART:20260620T160000Z\r\n/u);
});

test('incomplete, day-only, stale, mismatched and impossible schedules never produce a calendar',()=>{
 const card=arcub(),day=arcub(now,'21 - 22 noiembrie','21–22 noiembrie 2026.');
 for(const bad of [null,{}, {...card,kind:'municipal-news'},day,
  {...card,context:{...card.context,startsAt:null}},
  {...card,context:{...card.context,datePrecision:undefined}},
  {...card,context:{...card.context,startsAt:'2026-11-31T17:30:00Z'}},
  {...card,context:{...card.context,startsAt:'2026-11-21T17:30:00'}},
  {...card,context:{...card.context,startsAt:'2026-11-21T18:30:00.000Z'}},
  {...card,context:{...card.context,endsAt:'2026-11-21T18:30:00.000Z'}},
  {...card,context:{...card.context,documentUrl:'https://arcub.ro/agenda'}},
  {...card,checkedAt:new Date(now+6000).toISOString()},
  {...card,validTo:new Date(now+300001).toISOString()},
  {...card,publisher:'Unverified publisher'},
  {...card,sourceUrl:'https://arcub.ro.evil.example/eveniment/concert'},
  {...card,sourceUrl:'https:\r\n//arcub.ro/eveniment/concert',context:{...card.context,documentUrl:'https:\r\n//arcub.ro/eveniment/concert'}},
 ])assert.equal(localEventCalendar(bad,bucharest,now),null);
 assert.equal(localEventCalendar(card,bucharest,now+300000),null);
 assert.equal(localEventCalendar(card,bucharest,Date.parse(card.context.startsAt)),null);
 assert.equal(localEventCalendar(card,palma,now),null);
 assert.equal(localEventCalendar(card,{...bucharest,timezone:'Europe/London'},now),null);
 assert.equal(localEventCalendar(card,bucharest,NaN),null);
});

test('UTF-8 folding preserves complete text and hostile newlines cannot introduce calendar properties',()=>{
 const card=culture(),hostile='é😀'.repeat(45)+'\\,;\r\nBEGIN:VEVENT\r\nSUMMARY:Injected';
 const file=localEventCalendar({...card,title:hostile,facts:[...card.facts,'A qualifier; with commas, and a slash\\ remains.']},palma,now);
 assert.ok(file);
 for(const line of file.content.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75);
 assert.equal(file.content.replace(/\r\n/gu,'').includes('\n'),false);
 const plain=unfold(file.content);
 assert.equal((plain.match(/^BEGIN:VEVENT\r?$/gmu)??[]).length,1);
 assert.equal((plain.match(/^SUMMARY:/gmu)??[]).length,1);
 assert.ok(plain.includes('\\nBEGIN:VEVENT\\nSUMMARY:Injected'));
 assert.ok(plain.includes('A qualifier\\; with commas\\, and a slash\\\\ remains.'));
 const summary=plain.match(/^SUMMARY:(.*)\r$/mu)?.[1];
 assert.ok(summary?.includes('é😀'.repeat(45)));
 assert.equal(localEventCalendar({...card,title:'Invalid\u0000title'},palma,now),null);
});

// A small DOM fixture exercises the real shared card renderer and its click handler.
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.hidden=false;this.textContent='';}
 append(...children){for(const child of children){this.children.push(child);if(child&&typeof child==='object')child.parent=this;}}
 setAttribute(name,value){this.attributes[name]=value;}
 addEventListener(name,listener){this.listeners[name]=listener;}
 click(){if(this.tagName==='a'&&this.download)downloads.push({href:this.href,filename:this.download});return this.listeners.click?.();}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
}
const all=root=>[root,...root.children.flatMap(child=>child instanceof Element?all(child):[])];
let downloads=[];

test('actual local card action prepares the calendar and refuses a click after source expiry',async t=>{
 const savedDocument=globalThis.document,body=new Element('body'),blobs=[],revoked=[],callbacks=[];
 globalThis.document={createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),body};
 t.after(()=>{if(savedDocument===undefined)delete globalThis.document;else globalThis.document=savedDocument;});
 t.mock.method(URL,'createObjectURL',blob=>{blobs.push(blob);return'blob:calendar-test';});
 t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
 t.mock.method(globalThis,'setTimeout',callback=>{callbacks.push(callback);return 1;});
 let clock=now;t.mock.method(Date,'now',()=>clock);downloads=[];
 const rendered=localCardNode(culture(),palma,now),button=all(rendered).find(node=>node.dataset.calendarEvent);
 assert.ok(button);assert.equal(button.textContent,'Add to calendar');button.click();
 assert.deepEqual(downloads,[{href:'blob:calendar-test',filename:'dlkt-palma-event-12478.ics'}]);
 assert.equal(blobs[0].type,'text/calendar;charset=utf-8');assert.match(await blobs[0].text(),/BEGIN:VEVENT/u);
 assert.ok(all(rendered).some(node=>node.attributes.role==='status'&&/Calendar file prepared/.test(node.textContent)));
 for(const callback of callbacks)callback();assert.deepEqual(revoked,['blob:calendar-test']);
 assert.equal(body.children.length,0);
 clock+=300000;button.click();assert.equal(downloads.length,1);assert.equal(button.disabled,true);
 assert.ok(all(rendered).some(node=>node.attributes.role==='status'&&/fresh check/.test(node.textContent)));
});

test('calendar preparation failure remains recoverable and never claims the event was saved',t=>{
 const savedDocument=globalThis.document;
 globalThis.document={createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),body:new Element('body')};
 t.after(()=>{if(savedDocument===undefined)delete globalThis.document;else globalThis.document=savedDocument;});
 t.mock.method(Date,'now',()=>now);t.mock.method(URL,'createObjectURL',()=>{throw Error('blocked');});
 const rendered=localCardNode(culture(),palma,now),button=all(rendered).find(node=>node.dataset.calendarEvent);button.click();
 assert.ok(all(rendered).some(node=>node.attributes.role==='status'&&/could not be prepared/.test(node.textContent)));
 assert.notEqual(button.disabled,true);
 assert.equal(all(localCardNode({...culture(),context:{...culture().context,startsAt:null}},palma,now)).some(node=>node.dataset.calendarEvent),false);
});
