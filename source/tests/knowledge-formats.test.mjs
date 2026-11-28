import test from 'node:test';
import assert from 'node:assert/strict';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {selectKnowledgeCards,validKnowledgeCard} from '../.build/src/iceo/knowledge.js';
import {selectInlineKnowledge,interleaveKnowledge} from '../.build/src/iceo/knowledge-stream.js';

const history=KNOWLEDGE_CARDS.find(card=>card.format==='on-this-day');
const recipe=KNOWLEDGE_CARDS.find(card=>card.format==='recipe');
test('source-reviewed editorial formats carry clear identities and provenance',()=>{
 assert.ok(history&&recipe);
 assert.equal(history.calendarDay,'11-23');
 for(const card of [history,recipe]){
  assert.equal(validKnowledgeCard(card),true);
  assert.ok(card.source.url.startsWith('https://'));
  for(const language of ['en','ro','it'])assert.ok(card.copy[language].title.length>15);
 }
});
test('historical anniversaries only qualify on the selected calendar day',()=>{
 const utc=Date.parse('2026-11-23T22:30:00.000Z');
 const catalog=[history,recipe];
 const inBucharest=selectKnowledgeCards(catalog,'all',utc,'calendar-test','Europe/Bucharest');
 const inNewYork=selectKnowledgeCards(catalog,'all',utc,'calendar-test','America/New_York');
 assert.equal(inBucharest.some(card=>card.id===history.id),false);
 assert.equal(inNewYork.some(card=>card.id===history.id),true);
 assert.ok(inBucharest.some(card=>card.id===recipe.id));
 assert.ok(inNewYork.some(card=>card.id===recipe.id));
});
test('historical cards do not leak into unrelated dates and malformed days fail closed',()=>{
 const utc=Date.parse('2026-11-25T12:00:00.000Z');
 assert.equal(selectKnowledgeCards([history], 'all',utc,'test').length,0);
 assert.throws(()=>selectKnowledgeCards([history],'all',utc,'test','Not/A_TimeZone'),/KNOWLEDGE_TIMEZONE_INVALID/);
 assert.equal(validKnowledgeCard({...history,calendarDay:'02-30'}),false);
 assert.equal(validKnowledgeCard({...history,calendarDay:'13-01'}),false);
 assert.equal(validKnowledgeCard({...history,format:'invented'}),false);
});
test('knowledge and new formats retain news order and never fake infinite cards',()=>{
 const now=Date.parse('2026-11-23T12:00:00.000Z');
 const selected=selectInlineKnowledge(KNOWLEDGE_CARDS,{countryCode:'RO',cityId:null,timeZone:'Europe/Bucharest'},now,'insertion-test');
 assert.equal(selected.some(item=>item.card.id===history.id),true);
 const news=Array.from({length:50},(_,i)=>({key:'n-'+i}));
 const items=interleaveKnowledge(news,selected);
 assert.equal(items.filter(item=>item.kind==='news').length,50);
 assert.equal(new Set(items.filter(item=>item.kind==='knowledge').map(item=>item.item.card.id)).size,4);
 assert.deepEqual(items.filter(item=>item.kind==='knowledge').map(item=>item.afterNews),[11,22,33,44]);
});

test('weighted format variety preserves category rounds and spreads rare formats through the complete eligible inventory',()=>{
 const base=KNOWLEDGE_CARDS[0];assert.ok(base&&base.format===undefined);
 const now=Date.parse('2026-11-23T12:00:00Z');
 const cards=Array.from({length:24},(_,index)=>({...structuredClone(base),id:'format-fixture-'+index,
  format:index%2===0?(index%4===0?undefined:'did-you-know'):'useful'}));
 const a=selectKnowledgeCards(cards,'all',now,'format-balanced');
 assert.equal(a.length,24);assert.equal(new Set(a.map(card=>card.id)).size,24);
 assert.deepEqual(a,selectKnowledgeCards([...cards].reverse(),'all',now,'format-balanced'));
 for(let i=1;i<a.length;i++)assert.notEqual(a[i-1].format??'did-you-know',a[i].format??'did-you-know');
 const skewed=Array.from({length:24},(_,index)=>({...structuredClone(base),id:'format-skewed-'+index,
  format:index===23?'useful':'did-you-know'}));
 const b=selectKnowledgeCards(skewed,'all',now,'format-skewed');
 const rare=b.findIndex(card=>card.format==='useful');
 assert.equal(b.length,24);assert.ok(rare>=8&&rare<=16,'a single rare format should not be consumed immediately or hidden at the end');
});
