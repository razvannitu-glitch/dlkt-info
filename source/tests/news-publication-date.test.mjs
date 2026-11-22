import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync('.build/src/iceo/browser.js','utf8');
const start=source.indexOf('function formatted('),end=source.indexOf('function make(',start);
assert.ok(start>=0&&end>start,'the real compiled formatter is available');
const formatter=source.slice(start,end);
function formatFor(locale){
 const context={getLocale:()=>locale};
 runInNewContext(formatter+'\nthis.formatDate = formatted;',context);
 return context.formatDate;
}
const footer=source.split('\n').find(line=>line.includes("put('.card-date',"));
assert.ok(footer,'the real card footer uses the shared formatter');
function renderDate(card,timeZone,locale='en'){
 const writes=[],before=JSON.stringify(card);
 const context={card,view:{dateLabel:card.dateLabel},publicationTimeZone:timeZone,formatted:formatFor(locale),put:(selector,text)=>writes.push([selector,text])};
 runInNewContext(footer,context);
 assert.equal(JSON.stringify(card),before,'formatting preserves the original publication value');
 assert.equal(writes.length,1);assert.equal(writes[0][0],'.card-date');
 return writes[0][1];
}

test('published dates use the edition timezone across midnight in Rome, Bucharest and New York',()=>{
 for(const sample of [
  {locale:'it',instant:'2026-11-21T23:30:00.000Z',zone:'Europe/Rome',day:'22'},
  {locale:'ro',instant:'2026-11-22T22:30:00.000Z',zone:'Europe/Bucharest',day:'23'},
  {locale:'en',instant:'2026-11-23T02:30:00.000Z',zone:'America/New_York',day:'22'},
 ]){
  const options={year:'numeric',month:'short',day:'numeric',timeZone:sample.zone};
  const expected=new Intl.DateTimeFormat(sample.locale,options),date=new Date(sample.instant);
  assert.equal(expected.formatToParts(date).find(part=>part.type==='day').value,sample.day);
  const formatted=formatFor(sample.locale),actual=renderDate({date:sample.instant,dateLabel:'Published'},sample.zone,sample.locale);
  assert.equal(actual,expected.format(date));
  assert.equal(actual,formatted(sample.instant,true,false,sample.zone));
  assert.notEqual(actual,formatted(sample.instant,true),'legacy UTC would show the adjacent date');
 }
});

test('date-only documents, closing dates and explicit UTC source checks keep their existing meaning',()=>{
 const formatted=formatFor('en'),calendar='2026-11-22';
 for(const zone of ['Europe/Rome','Europe/Bucharest','America/New_York']){
  assert.equal(renderDate({date:calendar,dateLabel:'Document date'},zone),'Document date: Nov 22, 2026');
  assert.equal(formatted(calendar,true),'Nov 22, 2026');
 }
 assert.equal(renderDate({date:'2026-11-21T23:30:00.000Z',dateLabel:'Published'},undefined),'Nov 21, 2026','the optional publication timezone defaults to UTC');
 const deadlineStatement=source.match(/deadline\.textContent =[^;]+;/u)?.[0];
 assert.ok(deadlineStatement,'the real deadline rendering remains separately testable');
 const deadline={textContent:''};
 runInNewContext(deadlineStatement,{deadline,card:{deadline:calendar},view:{noticeState:'open'},formatted,publicationTimeZone:'America/New_York'});
 assert.equal(deadline.textContent,'Listed closing date: Nov 22, 2026');
 const stamp='2026-11-21T23:30:00.000Z';
 assert.equal(formatted(stamp,false,true,'America/New_York'),formatted(stamp,false,true),'an explicit UTC source check is unaffected by publication formatting');
});

test('the compiled news renderer passes the validated edition zone before the city fallback and UTC',()=>{
 const renderStart=source.indexOf('function renderDiscovery()'),renderEnd=source.indexOf('async function showNewsPage(',renderStart);
 assert.ok(renderStart>=0&&renderEnd>renderStart);
 const call=source.slice(renderStart,renderEnd).match(/node = cardNode\([^;]+;/u)?.[0];
 assert.ok(call);
 assert.match(source,/function cardNode\([^)]*publicationTimeZone = 'UTC'\)/u);
 for(const [page,city,expected]of [
  [{day:{timeZone:'Europe/Rome'}},{timezone:'America/New_York'},'Europe/Rome'],
  [{day:null},{timezone:'Europe/Bucharest'},'Europe/Bucharest'],
  [null,{timezone:'America/New_York'},'America/New_York'],
  [{day:null},null,'UTC'],
 ]){
  const view={card:{id:'original-publication'}},calls=[];
  const context={server:{page},contextualCity:city,item:{view},index:3,topCount:40,node:null,
   cardNode:(...args)=>{calls.push(args);return {dataset:{}};}};
  runInNewContext(call,context);
  assert.equal(calls.length,1);assert.strictEqual(calls[0][0],view);
  assert.deepEqual(calls[0].slice(1),[3,40,undefined,false,'related',expected]);
 }
});
