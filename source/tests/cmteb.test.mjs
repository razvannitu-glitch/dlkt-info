import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseCmteb,CMTEB_SOURCE} from '../.build/src/local/cmteb.js';

const now=Date.parse('2026-11-18T20:00:00.000Z'),checkedAt=new Date(now).toISOString();
const header='<tr><th>Sector</th><th>Zone afectate</th><th>Agentul termic afectat</th><th>Cauza / Descrierea intervenției</th><th>Data/ora estimării punerii în funcțiune</th></tr>';
const row=(sector=1,service='Oprire ACC/INC',estimate='18.11.2026 23:30',area='Punct termic: <strong>Private resident name</strong> -- 4 blocuri/imobile<br>• Str Exemplu - bl. SECRET, apartament 55<br>• Cal Alta - imob. 99')=>`<tr><td>${sector}</td><td>${area}</td><td>${service}</td><td>Operator cause</td><td>${estimate}</td></tr>`;
const html=(rows,id='ST')=>`<div id="${id}"><table>${header}${rows}</table></div>`;
const parse=(body,time=now)=>parseCmteb({body,checkedAt:new Date(time).toISOString()},time);

test('CMTEB groups exact sector notices and distinguishes interrupted from reduced service',()=>{
 const body=html(row()+row(1,'Deficienta INC','19.11.2026 23:00')+row(6,'Oprire ACC'))+html(row(),'S1');
 const result=parse(body);
 assert.equal(result.scanned,3);assert.equal(result.rejected,0);assert.equal(result.cards.length,2);
 const card=result.cards[0];assert.equal(card.kind,'utility-notice');assert.equal(card.id,'bucharest:cmteb:sector-1');
 assert.match(card.text,/2 entries/u);assert.match(card.text,/hot water and heating interruptions/u);assert.match(card.text,/reduced heating service/u);
 assert.equal(card.sourceUrl,CMTEB_SOURCE);assert.equal(card.sourceUpdatedAt,null);assert.equal(card.context.documentHash,createHash('sha256').update(body).digest('hex'));
 assert.equal(card.context.sourceDate,'2026-11-18');assert.equal(card.context.startsAt,null);assert.equal(card.context.status,'operator-notice');
 assert.equal(card.validTo,'2026-11-18T20:05:00.000Z');assert.equal(card.validFrom,checkedAt);
});

test('CMTEB cards only retain street examples, never residents, buildings or full area text',()=>{
 const card=parse(html(row())).cards[0],output=JSON.stringify(card);
 assert.match(output,/Str Exemplu/u);assert.match(output,/Cal Alta/u);
 assert.doesNotMatch(output,/Private resident name|SECRET|apartament 55|imob\. 99|Operator cause/u);
 assert.match(card.boundary,/not.*confirmation that your address is affected/u);
});

test('past estimates remain explicitly unresolved operator listings, not an all clear',()=>{
 const card=parse(html(row(2,'Oprire ACC','18.11.2026 20:00')+row(2,'Deficienta INC','19.11.2026 23:00'))).cards[0];
 assert.match(card.context.when,/Past estimate still listed: 18\.11\.2026 20:00/u);
 assert.match(card.context.when,/Estimated restoration: 19\.11\.2026 23:00/u);
 assert.match(card.context.when,/Europe\/Bucharest; not guaranteed/u);
 assert.match(card.boundary,/does not establish restoration or continued interruption/u);
});

test('invalid rows and duplicate copies are rejected without changing valid source entry counts',()=>{
 const good=row();const result=parse(html(good+good+row(7)+row(2,'Unknown')+row(2,'Oprire ACC','31.11.2026 23:00')+row(6)));
 assert.equal(result.scanned,6);assert.equal(result.rejected,4);assert.equal(result.cards.length,2);
 assert.match(result.cards[0].text,/1 entry/u);
});

test('Bucharest calendar validation rejects nonexistent and ambiguous DST times',()=>{
 for(const estimate of ['29.03.2026 03:30','25.10.2026 03:30','29.02.2026 23:00','18.11.2026 24:00','18.11.2026 12:60','2026-11-18T23:00Z']){
  assert.throws(()=>parse(html(row(1,'Oprire ACC',estimate))),/CMTEB_NO_VALID_NOTICES/u,estimate);
 }
 assert.equal(parse(html(row(1,'Oprire ACC','18.07.2026 23:30'))).cards.length,1);
});

test('stale, future or malformed retrieval timestamps never produce utility cards',()=>{
 const body=html(row());
 for(const stamp of [new Date(now-300000).toISOString(),new Date(now+5001).toISOString(),'2026-02-31T00:00:00.000Z','invalid']){
  assert.throws(()=>parseCmteb({body,checkedAt:stamp},now),/CMTEB_FRESHNESS/u,stamp);
 }
 assert.throws(()=>parseCmteb({body,checkedAt},NaN),/CMTEB_DOCUMENT/u);
});

test('changed, oversized or absent source tables fail closed, never fabricate normal service',()=>{
 for(const body of [html(row(),'S1'),html(row())+html(row()),html(''),html(row()).replace('Zone afectate','Unrelated field'),html(row()).replace('<td>1</td>','<td colspan="2">1</td>')]){
  assert.throws(()=>parse(body),/CMTEB_(?:STRUCTURE|NO_VALID_NOTICES)/u);
 }
 assert.throws(()=>parse(html(Array.from({length:101},()=>row()).join(''))),/CMTEB_STRUCTURE/u);
 assert.throws(()=>parse('é'.repeat(524289)),/CMTEB_DOCUMENT/u);
 assert.throws(()=>parse('<!DOCTYPE x [<!ENTITY x "a">]>'+html(row())),/CMTEB_DOCUMENT/u);
});

test('sector output is bounded and deterministic even when the table order changes',()=>{
 const result=parse(html([6,3,1,4,2,5].map(sector=>row(sector)).join('')));
 assert.equal(result.cards.length,6);
 assert.deepEqual(result.cards.map(card=>card.id),[1,2,3,4,5,6].map(sector=>'bucharest:cmteb:sector-'+sector));
});
