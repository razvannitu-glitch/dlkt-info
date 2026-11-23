import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {safeKnowledgeSource,validKnowledgeCard} from '../.build/src/iceo/knowledge.js';
import {selectInlineKnowledge} from '../.build/src/iceo/knowledge-stream.js';

test('Coral Care consists of four reviewed, attributable campaigns and independent information',()=>{
 const care=KNOWLEDGE_CARDS.filter(card=>card.format==='care');
 assert.equal(care.length,4);
 assert.equal(new Set(care.map(card=>card.id)).size,4);
 assert.equal(care.filter(card=>card.geography?.countryCode==='RO').length,2);
 assert.equal(care.filter(card=>card.geography===undefined).length,2);
 for(const card of care){
  assert.equal(card.category,'07000000');
  assert.ok(validKnowledgeCard(card));
  assert.ok(safeKnowledgeSource(card.source.url));
  assert.ok(Date.parse(card.reviewBy)>Date.parse(card.reviewedAt));
  assert.ok(card.copy.ro.title.length>20);
  assert.ok(card.copy.en.explanation.length>50);
  assert.equal(Object.hasOwn(card,'paymentUrl'),false);
  assert.equal(Object.hasOwn(card,'donationAmount'),false);
 }
 assert.equal(care.some(card=>card.source.publisher==='World Health Organization'),true);
 assert.equal(care.some(card=>card.source.publisher==='Fundatia Renasterea'),true);
 assert.equal(care.some(card=>card.source.publisher==='HOSPICE Casa Sperantei'),true);
});
test('Coral Care design is limited to designated cards and has no payments or invented affiliations',()=>{
 const css=readFileSync('public/knowledge.css','utf8');
 const reader=readFileSync('src/iceo/knowledge-browser.ts','utf8');
 assert.match(css,/\.knowledge-card\[data-knowledge-format="care"\]\{background:#F66061/u);
 assert.match(css,/\.knowledge-card\[data-knowledge-format="care"\] \.knowledge-card-title\{color:#fff/u);
 assert.match(reader,/article\.dataset\.knowledgeFormat=card\.format\?\?'did-you-know'/u);
 assert.match(reader,/card\.format==='care'\?copy\.careSource:copy\.source/u);
 assert.match(reader,/if\(card\.format==='care'\)article\.append\(make\('p','knowledge-care-notice'/u);
 assert.doesNotMatch(reader,/fetch\(|\/api\/checkout|Stripe|localStorage|innerHTML/u);
});
test('local care appears only in the intended country and does not fake a neighborhood',()=>{
 const at=Date.parse('2026-11-23T11:45:00.000Z');
 const ro=selectInlineKnowledge(KNOWLEDGE_CARDS,{cityId:'683506',countryCode:'RO',timeZone:'Europe/Bucharest'},at,'care-fixture');
 const us=selectInlineKnowledge(KNOWLEDGE_CARDS,{cityId:null,countryCode:'US',timeZone:'America/New_York'},at,'care-fixture');
 assert.equal(ro[0]?.card.format,'care','the first knowledge slot exposes Coral Care');
 assert.equal(us[0]?.card.format,'care','the international edition also shows Coral Care');
 const roIds=ro.filter(value=>value.card.format==='care').map(value=>value.card.id);
 const usIds=us.filter(value=>value.card.format==='care').map(value=>value.card.id);
 assert.ok(roIds.includes('care-breast-screening-romania'));
 assert.ok(roIds.includes('care-palliative-romania'));
 assert.ok(!usIds.includes('care-breast-screening-romania'));
 assert.ok(!usIds.includes('care-palliative-romania'));
 assert.ok(usIds.includes('care-breast-cancer-global'));
 assert.ok(usIds.includes('care-blood-donation-global'));
 assert.equal(ro.find(entry=>entry.card.id==='care-breast-screening-romania')?.scope,'country');
});

