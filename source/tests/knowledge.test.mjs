import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {DLKT_PLUS_PLAN,validKnowledgeCard,validateKnowledgeCatalog,safeKnowledgeSource,selectKnowledgeCards,knowledgeLanguage,knowledgeShareUrl,knowledgeTargetFromHash} from '../.build/src/iceo/knowledge.js';
import {NEWS_CATEGORIES} from '../.build/src/iceo/news-taxonomy.js';
const now=Date.parse('2026-11-23T12:00:00.000Z');
const copy=value=>JSON.parse(JSON.stringify(value));
test('knowledge preview keeps original multilingual copy, primary provenance and bounded review dates',()=>{
 assert.equal(KNOWLEDGE_CARDS.length,26);assert.equal(new Set(KNOWLEDGE_CARDS.filter(card=>!['useful','elsewhere'].includes(card.format)).map(card=>card.category)).size,9);
 assert.equal(validateKnowledgeCatalog(KNOWLEDGE_CARDS).length,26);
 for(const card of KNOWLEDGE_CARDS){
  assert.ok(validKnowledgeCard(card));assert.ok(NEWS_CATEGORIES.some(category=>category.id===card.category));
  for(const language of ['en','ro','it'])for(const field of ['title','explanation','connection'])assert.ok(card.copy[language][field].trim().length>15);
  assert.equal(Object.hasOwn(card,'image'),false);assert.equal(Object.hasOwn(card,'publishedAt'),false);
 }
});
test('knowledge rejects unreviewed sources, unsafe links, malformed copy and duplicated identities',()=>{
 for(const value of [
  'http://science.nasa.gov/venus/venus-facts/',
  'https://science.nasa.gov.evil.example/venus/',
  'https://science.nasa.gov@evil.example/venus/',
  'https://science.nasa.gov/venus/?redirect=https://evil.example',
  'https://science.nasa.gov/venus/#x',
  'https://science.nasa.gov:8443/venus/',
  'javascript:alert(1)',
  'https://science.nasa.gov/venus/ '+String.fromCharCode(10),
 ])assert.equal(safeKnowledgeSource(value),false,value);
 const invalid=[
  {...copy(KNOWLEDGE_CARDS[0]),category:'invented'},
  {...copy(KNOWLEDGE_CARDS[0]),revision:0},
  {...copy(KNOWLEDGE_CARDS[0]),reviewBy:'2026-01-01T00:00:00.000Z'},
  {...copy(KNOWLEDGE_CARDS[0]),reviewBy:'2030-01-01T00:00:00.000Z'},
  {...copy(KNOWLEDGE_CARDS[0]),reviewedAt:'2026-02-30T00:00:00.000Z'},
 ];
 const missing=copy(KNOWLEDGE_CARDS[0]);delete missing.copy.ro;invalid.push(missing);
 const markup=copy(KNOWLEDGE_CARDS[0]);markup.copy.en.explanation='<script>alert(1)</script>';invalid.push(markup);
 for(const card of invalid){assert.equal(validKnowledgeCard(card),false);assert.throws(()=>validateKnowledgeCatalog([card]),/KNOWLEDGE_CARD_INVALID/);}
 assert.throws(()=>validateKnowledgeCatalog([KNOWLEDGE_CARDS[0],KNOWLEDGE_CARDS[0]]),/KNOWLEDGE_CARD_INVALID/);
});
test('knowledge review windows exclude future and expired facts without inventing replacements',()=>{
 const card=KNOWLEDGE_CARDS[0],start=Date.parse(card.reviewedAt),end=Date.parse(card.reviewBy);
 assert.equal(selectKnowledgeCards([card],'all',start-1,'day').length,0);
 assert.equal(selectKnowledgeCards([card],'all',start,'day').length,1);
 assert.equal(selectKnowledgeCards([card],'all',end-1,'day').length,1);
 assert.equal(selectKnowledgeCards([card],'all',end,'day').length,0);
 assert.equal(selectKnowledgeCards([],'all',now,'day').length,0);
});
test('knowledge category rounds reach the entire finite collection without a20/40 cap or duplicate cards',()=>{
 const cards=Array.from({length:89},(_,index)=>({...copy(KNOWLEDGE_CARDS[0]),id:'fact-'+index,category:NEWS_CATEGORIES[index%NEWS_CATEGORIES.length].id}));
 const result=selectKnowledgeCards(cards,'all',now,'edition');
 assert.equal(result.length,89);assert.equal(new Set(result.map(card=>card.id)).size,89);
 assert.deepEqual(result.map(card=>card.id),selectKnowledgeCards(cards,'all',now,'edition').map(card=>card.id));
 const pending=new Map();for(const card of cards)pending.set(card.category,(pending.get(card.category)??0)+1);
 let offset=0,last=null;
 while(pending.size){
  const categories=[...pending.keys()],round=result.slice(offset,offset+categories.length);
  assert.equal(round.length,categories.length);assert.deepEqual([...new Set(round.map(card=>card.category))].sort(),categories.sort());
  if(last!==null&&categories.length>1)assert.notEqual(round[0].category,last);
  for(const card of round){const remaining=pending.get(card.category)-1;if(remaining)pending.set(card.category,remaining);else pending.delete(card.category);}
  last=round.at(-1).category;offset+=round.length;
 }
 assert.deepEqual(new Set(result.map(card=>card.id)),new Set(cards.map(card=>card.id)));
});
test('knowledge filtering and sharing preserve category, language and the canonical destination',()=>{
 for(const category of NEWS_CATEGORIES){
  const expected=KNOWLEDGE_CARDS.filter(card=>card.category===category.id&&Date.parse(card.publishAt??card.reviewedAt)<=now&&now<Date.parse(card.reviewBy));
  const selected=selectKnowledgeCards(KNOWLEDGE_CARDS,category.id,now,'day');
  assert.equal(selected.length,expected.length);assert.ok(selected.every(card=>card.category===category.id));
 }
 assert.equal(knowledgeLanguage('ro-RO'),'ro');assert.equal(knowledgeLanguage('it-IT'),'it');assert.equal(knowledgeLanguage('ja'),'en');
 for(const language of ['en','ro','it']){
  const card=KNOWLEDGE_CARDS[0],url=new URL(knowledgeShareUrl(card,language));
  assert.equal(url.origin,'https://www.dlkt.ee');assert.equal(url.searchParams.get('lang'),language);
  assert.equal(knowledgeTargetFromHash(url.hash),card.id);assert.equal([...url.searchParams].length,1);
 }
 for(const hash of ['#know/../../account','#know/%3Cscript%3E','#know/valid?id=1','#knowledge-plan'])assert.equal(knowledgeTargetFromHash(hash),null);
});
test('approved price is a planned offer and cannot represent a paid entitlement',()=>{
 assert.equal(DLKT_PLUS_PLAN.monthlyMinor,699);assert.equal(DLKT_PLUS_PLAN.currency,'EUR');assert.equal(DLKT_PLUS_PLAN.trialDays,7);
 assert.equal(DLKT_PLUS_PLAN.status,'planned');assert.equal(DLKT_PLUS_PLAN.billingAvailable,false);assert.ok(Object.isFrozen(DLKT_PLUS_PLAN));
});
test('knowledge assets integrate into the real reader without starting a second site or payment flow',()=>{
 const html=readFileSync('public/iceo.html','utf8'),browser=readFileSync('src/iceo/browser.ts','utf8');
 for(const id of ['reader-content-switch','reader-news-mode','reader-knowledge-mode','knowledge-discovery','knowledge-cards','knowledge-category','knowledge-plan'])assert.equal(html.includes('id="'+id+'"'),false,id);
 for(const id of ['home-news-period','home-news-day'])assert.equal((html.match(new RegExp('id="'+id+'"','g'))??[]).length,1,id);
 assert.match(html,/<link rel="stylesheet" href="\/knowledge\.css">/);
 assert.doesNotMatch(browser,/setupKnowledgeReader|knowledgeModeActive/);assert.match(browser,/let newsPeriod:NewsPeriod='recent'/);
 assert.match(browser,/filter:newsFilter,period:newsPeriod/);
 const controller=readFileSync('src/iceo/knowledge-browser.ts','utf8');
 assert.doesNotMatch(controller,/\.innerHTML\s*=|localStorage|sessionStorage|\/api\/checkout|\bfetch\(/);
 assert.doesNotMatch(controller,/setupKnowledgeReader|knowledgeModeActive|knowledge-explore/);
 assert.match(browser,/interleaveKnowledge\(visible,inlineKnowledgeSelection\)/);
});

test('knowledge geography is explicit, bounded and multilingual',()=>{
 const local=KNOWLEDGE_CARDS.filter(card=>card.geography!==undefined);
 assert.deepEqual(local.filter(card=>!['useful','elsewhere'].includes(card.format)).map(card=>[card.id,card.geography.countryCode,card.geography.cityIds]),[
  ['torino-museo-egizio-1824','IT',['3165524']],
  ['bucharest-athenaeum-circular-foundations','RO',['683506']],
  ['care-breast-screening-romania','RO',[]],
  ['care-palliative-romania','RO',[]],
 ]);
 for(const card of local)assert.ok(validKnowledgeCard(card));
 const base=copy(local[0]);
 for(const geography of [
  {...base.geography,countryCode:'it'},
  {...base.geography,countryCode:'ITALY'},
  {...base.geography,cityIds:['3165524','3165524']},
  {...base.geography,cityIds:['../3165524']},
  {...base.geography,cityIds:[3165524]},
  {...base.geography,label:{en:'Turin',ro:'Torino'}},
 ])assert.equal(validKnowledgeCard({...base,geography}),false);
 assert.ok(validKnowledgeCard({...base,geography:{...base.geography,cityIds:[]}}));
});

test('new knowledge formats carry reviewed sources and calendar eligibility, without pretending to be current news',()=>{
 const historical=KNOWLEDGE_CARDS.find(card=>card.id==='computer-industry-1992-nov-23');
 const recipe=KNOWLEDGE_CARDS.find(card=>card.id==='apple-cinnamon-oats');
 assert.ok(historical);assert.ok(recipe);
 assert.equal(historical.format,'on-this-day');assert.equal(historical.calendarDay,'11-23');
 assert.equal(historical.source.url,'https://www.computerhistory.org/tdih/november/23/');
 assert.equal(recipe.format,'recipe');assert.equal(recipe.source.url,'https://foodhero.org/recipes/apple-spice-oatmeal');
 const onDate=Date.parse('2026-11-23T12:00:00.000Z');
 const nextDate=Date.parse('2026-11-24T12:00:00.000Z');
 assert.ok(selectKnowledgeCards(KNOWLEDGE_CARDS,'all',onDate,'fixture','Europe/Bucharest').some(card=>card.id===historical.id));
 assert.ok(!selectKnowledgeCards(KNOWLEDGE_CARDS,'all',nextDate,'fixture','Europe/Bucharest').some(card=>card.id===historical.id));
 assert.ok(selectKnowledgeCards(KNOWLEDGE_CARDS,'all',nextDate,'fixture','Europe/Bucharest').some(card=>card.id===recipe.id));
 assert.equal(validKnowledgeCard({...historical,calendarDay:'02-30'}),false);
 assert.equal(validKnowledgeCard({...recipe,calendarDay:'11-23'}),false);
 assert.equal(validKnowledgeCard({...historical,format:'horoscope'}),false);
 assert.equal(Object.hasOwn(historical,'publishedAt'),false);
 assert.equal(Object.hasOwn(recipe,'publishedAt'),false);
});
