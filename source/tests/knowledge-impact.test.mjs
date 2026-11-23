import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {validKnowledgeCard,safeKnowledgeSource,selectKnowledgeCards} from '../.build/src/iceo/knowledge.js';

test('coral impact series is original source-linked information and never implies a donation or partnership',()=>{
 const ids=['impact-breast-health-awareness','impact-cervical-cancer-prevention','impact-voluntary-blood-donation'];
 const cards=ids.map(id=>KNOWLEDGE_CARDS.find(card=>card.id===id));
 assert.ok(cards.every(Boolean));
 for(const card of cards){
  assert.equal(card.kind,'knowledge');
  assert.equal(card.category,'07000000');
  assert.equal(card.format,'impact');
  assert.equal(card.source.publisher,'World Health Organization');
  assert.ok(card.source.url.startsWith('https://www.who.int/'));
  assert.ok(validKnowledgeCard(card));assert.equal(safeKnowledgeSource(card.source.url),true);
  assert.equal(Object.hasOwn(card,'donationUrl'),false);
  assert.equal(Object.hasOwn(card,'partnerId'),false);
  assert.equal(Object.hasOwn(card,'publishedAt'),false);
  for(const language of ['en','ro','it']){
   assert.ok(card.copy[language].title.length>20);
   assert.ok(card.copy[language].explanation.length>40);
  }
 }
 assert.equal(new Set(ids).size,ids.length);
 const css=readFileSync('public/knowledge.css','utf8');
 assert.match(css,/knowledge-card\[data-knowledge-format="impact"\]\{background:#F66061;color:#121416/u);
 const compiled=readFileSync('.build/src/iceo/knowledge-browser.js','utf8');
 assert.match(compiled,/dataset\.knowledgeFormat/u);
 assert.match(compiled,/copy\.disclaimer/u);
 assert.match(compiled,/card\.format === 'impact'/u);
 const eligible=selectKnowledgeCards(KNOWLEDGE_CARDS,'all',Date.parse('2026-11-23T15:00:00Z'),'day-seed','Europe/Bucharest');
 assert.ok(eligible.some(card=>card.format==='impact'));
});

test('campaign material and unsafe origins are not enabled by an information link',()=>{
 const card=KNOWLEDGE_CARDS.find(card=>card.id==='impact-breast-health-awareness');
 assert.ok(card);
 assert.equal(validKnowledgeCard({...card,source:{publisher:'Other',url:'https://who.int.example/initiatives'}}),false);
 assert.equal(validKnowledgeCard({...card,format:'unlicensed-fundraiser'}),false);
});
