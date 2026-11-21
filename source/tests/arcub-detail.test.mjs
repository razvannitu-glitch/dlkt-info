import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseArcubAgenda,parseArcubDetail} from '../.build/src/local/arcub.js';

const now=Date.parse('2026-11-18T12:00:00Z');
const checkedAt=new Date(now).toISOString();
const url='https://arcub.ro/eveniment/test-concert';
const title='Concert at ARCUB';
const venue='ARCUB - Hanul Gabroveni | Sala Mare';
const agenda=(when='20 noiembrie',place=venue)=>parseArcubAgenda({checkedAt,body:`<div class="pgrid-item"><a href="${url}"><h3>${title}</h3><div class="meta"><span>${when}</span><span>${place}</span></div></a></div>`},now).cards[0];
// Deliberately small fixtures reproduce the observed publisher structure, without importing page scripts.
const detail=(body,when='20 noiembrie',place=venue,heading=title)=>({url,checkedAt,body:`<div class="container phead"><div class="head"><h1 class="title">${heading}</h1><table class="feat"><tr><td class="lbl">Când</td><td class="val">${when}</td></tr><tr><td class="lbl">Unde</td><td class="val">${place}</td></tr><tr><td class="lbl">Premiera</td><td class="val">19 aprilie 2024</td></tr></table></div><div class="content"><p>${body}</p></div></div><footer>© 2026</footer>`});

test('ARCUB detail extracts an explicitly published local date and minute without inventing an end time',()=>{
 const document=detail('Pe 20 noiembrie 2026, de la ora 19:00, concertul are loc la ARCUB.');
 const card=parseArcubDetail(document,agenda(),now);
 assert.ok(card);
 assert.equal(card.context.startsAt,'2026-11-20T17:00:00.000Z');
 assert.equal(card.context.datePrecision,'minute');
 assert.equal(card.context.endsAt,undefined);
 assert.equal(card.context.documentUrl,url);
 assert.equal(card.context.documentHash,createHash('sha256').update(document.body).digest('hex'));
 assert.equal(card.sourceUpdatedAt,null);
 assert.equal(card.checkedAt,checkedAt);
 assert.equal(card.validTo,new Date(now+300000).toISOString());
 assert.match(card.context.when,/19:00 \(Europe\/Bucharest\)/u);
});

test('ARCUB published date range retains an ongoing listing with date precision and an exclusive end boundary',()=>{
 const when='14 noiembrie - 23 decembrie';
 const card=parseArcubDetail(detail('În perioada 14 noiembrie – 23 decembrie 2026 are loc expozitia.',when),agenda(when),now);
 assert.ok(card);
 assert.equal(card.context.datePrecision,'day');
 assert.equal(card.context.startsAt,'2026-11-13T22:00:00.000Z');
 assert.equal(card.context.endsAt,'2026-12-23T22:00:00.000Z');
 assert.match(card.context.when,/dates only; check opening hours/u);
 assert.match(card.boundary,/does not mean the venue is open now/u);
});

test('shared written month and year are parsed only within the exact published range',()=>{
 const when='26 - 29 noiembrie';
 const card=parseArcubDetail(detail('Perioada: 26–29 noiembrie 2026.',when),agenda(when),now);
 assert.equal(card?.context.startsAt,'2026-11-25T22:00:00.000Z');
 assert.equal(card?.context.endsAt,'2026-11-29T22:00:00.000Z');
});

test('missing event year is not taken from a premiere, footer, or unrelated reservation date',()=>{
 assert.equal(parseArcubDetail(detail('Rezervarile incep pe 2 noiembrie 2026. Concert in noiembrie.'),agenda(),now),null);
 assert.equal(parseArcubDetail(detail('Concert pe 20 noiembrie. Programul va fi confirmat.'),agenda(),now),null);
});

test('conflicting explicit years or times fail closed instead of choosing one',()=>{
 assert.throws(()=>parseArcubDetail(detail('20 noiembrie 2026, ora 19:00. 20 noiembrie 2027, ora 19:00.'),agenda(),now),/ARCUB_DETAIL_DATE_CONFLICT/u);
 assert.throws(()=>parseArcubDetail(detail('20 noiembrie 2026, ora 19:00. 20 noiembrie 2026, ora 20:00.'),agenda(),now),/ARCUB_DETAIL_TIME_CONFLICT/u);
 const when='20 noiembrie 2026';
 assert.throws(()=>parseArcubDetail(detail('20 noiembrie 2027, ora 19:00.',when),agenda(when),now),/ARCUB_DETAIL_DATE_CONFLICT/u);
});

test('wrong page, host spoof, mismatched venue and schedule cannot enrich another agenda item',()=>{
 const good=detail('20 noiembrie 2026, ora 19:00.');
 for(const bad of [
  {...good,url:'https://arcub.ro.evil.example/eveniment/test-concert'},
  {...good,url:'https://arcub.ro/eveniment/another-event'},
  detail('20 noiembrie 2026, ora 19:00.','20 noiembrie',venue,'Wrong event'),
  detail('20 noiembrie 2026, ora 19:00.','20 noiembrie','Another venue'),
  detail('21 noiembrie 2026, ora 19:00.','21 noiembrie'),
 ])assert.throws(()=>parseArcubDetail(bad,agenda(),now),/ARCUB_DETAIL_IDENTITY/u);
});

test('stale or oversized detail documents are rejected and invalid calendar dates are never normalized',()=>{
 const good=detail('20 noiembrie 2026, ora 19:00.');
 assert.throws(()=>parseArcubDetail({...good,checkedAt:new Date(now-300000).toISOString()},agenda(),now),/ARCUB_DETAIL_FRESHNESS/u);
 assert.throws(()=>parseArcubDetail({...good,body:'x'.repeat(1048577)},agenda(),now),/ARCUB_DETAIL_DOCUMENT/u);
 const when='31 noiembrie';
 assert.throws(()=>parseArcubDetail(detail('31 noiembrie 2026, ora 19:00.',when),agenda(when),now),/ARCUB_DETAIL_DATE/u);
});

test('verified past events use an explicit omission error so a caller cannot silently restore the undated fallback',()=>{
 const when='17 noiembrie';
 assert.throws(()=>parseArcubDetail(detail('17 noiembrie 2026, ora 19:00.',when),agenda(when),now),/ARCUB_DETAIL_PAST/u);
 const day='17 - 18 noiembrie',late=Date.parse('2026-11-18T22:00:00Z'),doc=detail('17–18 noiembrie 2026.',day);
 assert.throws(()=>parseArcubDetail({...doc,checkedAt:new Date(late).toISOString()},agenda(day),late),/ARCUB_DETAIL_PAST/u);
});

test('open-ended long programmes are not promoted as precise near-term event schedules',()=>{
 const when='21 septembrie 2026 - 30 septembrie 2027';
 assert.equal(parseArcubDetail(detail(when,when),agenda(when),now),null);
});

test('Bucharest daylight-saving ambiguity is rejected rather than selecting an arbitrary UTC hour',()=>{
 const when='25 octombrie',at=Date.parse('2026-10-20T12:00:00Z');
 const document={...detail('25 octombrie 2026, ora 03:30.',when),checkedAt:new Date(at).toISOString()};
 assert.throws(()=>parseArcubDetail(document,agenda(when),at),/ARCUB_DETAIL_TIME/u);
});
