import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {localReading as typedReading} from '../.build/src/local/presentation.js';
import {localReading as publicReading} from '../public/local-presentation.js';

const readers=[typedReading,publicReading];
const city={id:'683506',name:'Bucharest',countryCode:'RO',country:'Romania',region:'Bucuresti',lat:44.43225,lon:26.10626,timezone:'Europe/Bucharest'};
const now=Date.parse('2026-11-24T12:00:00.000Z');
const action='Check the organiser for opening hours, admission and any schedule changes.';
const summary=context=>`${context.place}. Published schedule: ${context.when}. Check the organiser for current admission and availability.`;
const foreground=reading=>[...reading.paragraphs,reading.period,reading.nextStep].filter(Boolean).join(' ');
const count=(value,fragment)=>value.split(fragment).length-1;

// Titles, places, dates and URLs were observed in the public reader on 24 Nov 2026.
// Check timestamps and document digests below are a controlled test envelope, not a new source check.
const observed=[
 {title:'Magia Crăciunului, patru experiențe interactive pentru întreaga familie',place:'Bd. Decebal nr. 11, bloc S14, sector 3, București',when:'2026-11-14 to 2026-12-23 · dates only; check opening hours',startsAt:'2026-11-13T22:00:00.000Z',endsAt:'2026-12-23T22:00:00.000Z',url:'https://arcub.ro/eveniment/magia-craciunului-patru-experiente-interactive-pentru-intreaga-familie'},
 {title:'România – identitate prin tradiție',place:'ARCUB - Sala Lahovari',when:'2026-11-26 to 2026-12-09 · dates only; check opening hours',startsAt:'2026-11-25T22:00:00.000Z',endsAt:'2026-12-09T22:00:00.000Z',url:'https://arcub.ro/eveniment/romania-identitate-prin-traditie'},
];
function event(overrides={}){
 const record={...observed[0],...overrides};
 const context={section:'discover',place:record.place,when:record.when,why:'The event page supplies an explicit year and schedule matching its agenda entry.',action,sourceDate:'2026-11-24',startsAt:record.startsAt,...(record.endsAt?{endsAt:record.endsAt}:{}),datePrecision:record.datePrecision??'day',status:'scheduled',documentHash:'a'.repeat(64),documentUrl:record.url};
 return {id:'bucharest:arcub:'+createHash('sha256').update(record.url).digest('hex').slice(0,24),kind:'event',title:record.title,text:summary(context),publisher:'ARCUB',sourceUrl:record.url,sourceUpdatedAt:null,checkedAt:new Date(now).toISOString(),validFrom:new Date(now).toISOString(),validTo:new Date(now+300000).toISOString(),facts:[`Published event schedule: ${record.when}`,`Venue as published: ${record.place}`],boundary:'Schedule and venue from the official ARCUB event page. A published date range does not mean the venue is open now. Tickets, capacity, cancellations and availability are not verified. SourceDate is the retrieval date, not a publication date.',context};
}

test('both observed ARCUB cards show the venue and schedule once in Romanian without generated-summary repetition',()=>{
 for(const row of observed)for(const read of readers){
  const card=event(row),before=JSON.stringify(card),result=read(card,city,now,'ro'),text=foreground(result);
  assert.equal(result.title,row.title);assert.deepEqual(result.paragraphs,[row.place]);assert.equal(count(text,row.place),1);
  assert.match(result.period,/^Cand: /u);assert.equal(count(result.period,'2026'),1);
  assert.equal(count(text,'Verifica'),1);assert.match(result.nextStep,/Datele nu confirma orele de acces/u);
  assert.match(result.nextStep,/biletele si disponibilitatea/u);assert.doesNotMatch(text,/Published schedule|dates only|Check the organiser|00:00/u);
  assert.equal(JSON.stringify(card),before,'source values and evidence remain unchanged');
 }
 const first=typedReading(event(observed[0]),city,now,'ro'),second=typedReading(event(observed[1]),city,now,'ro');
 assert.match(first.period,/14 nov\..*23 dec\. 2026/u);assert.match(second.period,/26 nov\..*9 dec\. 2026/u);
});

test('English event presentation retains one clear opening-hours and availability qualification',()=>{
 for(const read of readers){
  const card=event(),result=read(card,city,now,'en'),text=foreground(result);
  assert.deepEqual(result.paragraphs,[card.context.place]);assert.match(result.period,/^When: 14 Nov.*23 Dec 2026/u);
  assert.equal(count(text,'opening hours'),1);assert.equal(count(text,'Check the organiser'),1);
  assert.match(result.nextStep,/tickets and availability/u);assert.doesNotMatch(text,/Published schedule|current admission and availability/u);
 }
});

test('a date-only single day never becomes a midnight appointment or the exclusive following day',()=>{
 const card=event({when:'2026-11-24 · dates only; check opening hours',startsAt:'2026-11-23T22:00:00.000Z',endsAt:'2026-11-24T22:00:00.000Z'});
 for(const read of readers){
  const result=read(card,city,now,'ro');assert.equal(result.period,'Cand: 24 nov. 2026');
  assert.doesNotMatch(foreground(result),/25 nov|00:00/u);assert.match(result.nextStep,/nu confirma orele de acces/u);
 }
});

test('minute precision uses the published time in the city timezone, never source-check time or a guessed duration',()=>{
 const card=event({datePrecision:'minute',when:'2026-11-26 · 19:30 (Europe/Bucharest)',startsAt:'2026-11-26T17:30:00.000Z',endsAt:null});
 for(const read of readers){
  const result=read(card,city,now,'ro');assert.equal(result.period,'Cand: 26 nov. 2026 · 19:30 (ora locala)');
  assert.match(result.nextStep,/modificari de program/u);assert.doesNotMatch(foreground(result),/17:30|14:00|nu confirma orele|dates only/u);
  assert.equal(count(foreground(result),'19:30'),1);assert.equal(card.context.endsAt,undefined);
 }
});

test('inclusive published dates survive a year boundary and the 25-hour daylight-saving day',()=>{
 const crossYear=event({when:'2026-12-31 to 2027-01-01 · dates only; check opening hours',startsAt:'2026-12-30T22:00:00.000Z',endsAt:'2027-01-01T22:00:00.000Z'});
 const dstDay=event({when:'2026-10-25 · dates only; check opening hours',startsAt:'2026-10-24T21:00:00.000Z',endsAt:'2026-10-25T22:00:00.000Z'});
 for(const read of readers){
  const year=read(crossYear,city,now,'ro');assert.match(year.period,/31 dec\. 2026.*1 ian\. 2027/u);assert.doesNotMatch(year.period,/2 ian/u);
  assert.equal(read(dstDay,city,now,'ro').period,'Cand: 25 oct. 2026');
 }
});

test('additional source text or changed admission instructions remains completely visible through the original fallback',()=>{
 const text=event();text.text+=' Copiii au acces numai insotiti de un adult.';
 const instruction=event();instruction.context.action='Advance reservation is mandatory; no tickets are sold at the entrance.';
 for(const card of [text,instruction])for(const read of readers){
  const result=read(card,city,now,'ro');assert.deepEqual(result.paragraphs,[card.text]);assert.equal(result.period,card.context.when);assert.equal(result.nextStep,card.context.action);
 }
});

test('a mismatched evidence link, displayed schedule or date precision does not silently replace source wording',()=>{
 const link=event();link.context.documentUrl='https://arcub.ro/agenda';
 const date=event();date.context.startsAt='2026-11-14T22:00:00.000Z';
 const hour=event();hour.context.startsAt='2026-11-13T23:00:00.000Z';
 const invalid=event();invalid.context.endsAt='not-a-date';
 const seconds=event();seconds.context.startsAt='2026-11-13T22:00:30.000Z';
 const milliseconds=event();milliseconds.context.startsAt='2026-11-13T22:00:00.500Z';
 const endSeconds=event({when:'2026-11-14 to 2026-12-24 · dates only; check opening hours',endsAt:'2026-12-23T22:00:30.000Z'});
 const endMilliseconds=event({when:'2026-11-14 to 2026-12-24 · dates only; check opening hours',endsAt:'2026-12-23T22:00:00.500Z'});
 for(const card of [link,date,hour,invalid,seconds,milliseconds,endSeconds,endMilliseconds])for(const read of readers){
  const result=read(card,city,now,'ro');assert.deepEqual(result.paragraphs,[card.text]);assert.equal(result.period,card.context.when);assert.equal(result.nextStep,card.context.action);
 }
});

test('an agenda-only listing with no verified year or time is not promoted to a dated event',()=>{
 const card=event();delete card.context.datePrecision;delete card.context.endsAt;card.context.startsAt=null;
 card.context.when='14 noiembrie - 23 decembrie';card.context.documentUrl='https://arcub.ro/agenda';card.text='Publisher agenda listing; event year and time are not verified.';
 for(const read of readers){const result=read(card,city,now,'ro');assert.deepEqual(result.paragraphs,[card.text]);assert.equal(result.period,card.context.when);assert.doesNotMatch(result.period,/2026|Cand:|00:00/u);}
});

test('unrelated native cards and the existing Palma reservation details retain their original foreground behavior',()=>{
 const transport={...event(),kind:'transport',context:undefined,text:'Operator notice with an exact stop restriction.'};
 const palma={...event(),context:{...event().context,datePrecision:undefined,endsAt:undefined,place:'Es Gremi',when:'2026-11-24 · a partir de las 18 h (Europe/Madrid)',startsAt:'2026-11-24T17:00:00.000Z'},facts:['Listed admission terms: entrada libre con reserva previa (aforo limitado)']};
 const palmaCity={...city,id:'2512989',name:'Palma',countryCode:'ES',timezone:'Europe/Madrid'};
 for(const read of readers){
  assert.deepEqual(read(transport,city,now,'ro').paragraphs,[transport.text]);
  const result=read(palma,palmaCity,now,'en');assert.match(result.paragraphs[0],/Today from 18:00 \(Palma time\) at Es Gremi/u);
  assert.equal(result.paragraphs[1],'Free admission with advance reservation. Capacity is limited.');assert.equal(result.period,null);
 }
});

test('typed and public event presentation agree without mutating any original record or evidence',()=>{
 for(const row of observed)for(const locale of ['ro','en','fr']){
  const card=event(row),before=JSON.stringify(card);
  assert.deepEqual(typedReading(card,city,now,locale),publicReading(card,city,now,locale));assert.equal(JSON.stringify(card),before);
 }
});
