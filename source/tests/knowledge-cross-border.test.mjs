import test from 'node:test';
import assert from 'node:assert/strict';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {validKnowledgeCard,selectKnowledgeCards} from '../.build/src/iceo/knowledge.js';
import {selectInlineKnowledge,appendEligibleKnowledge,isInlineKnowledgeCurrent,interleaveKnowledge} from '../.build/src/iceo/knowledge-stream.js';

const now=Date.parse('2026-11-26T12:00:00.000Z');
const ro={countryCode:'RO',cityId:'683506',timeZone:'Europe/Bucharest'};
const helsinki=KNOWLEDGE_CARDS.find(card=>card.id==='dlkt-elsewhere-helsinki-shared-workshop');
const paris=KNOWLEDGE_CARDS.find(card=>card.id==='dlkt-elsewhere-paris-schoolyard-oasis');
const seed='cross-border-20261126';
const select=(cards,context=ro,at=now)=>selectInlineKnowledge(cards,context,at,seed);

test('both reviewed discoveries preserve real origin, original review and source, and reach foreign readers',()=>{
 assert.ok(helsinki&&paris);
 for(const [card,country,url] of [[helsinki,'FI','https://oodihelsinki.fi/en/services/urban-workshop/'],[paris,'FR','https://www.paris.fr/pages/les-cours-oasis-7389']]){
  assert.equal(validKnowledgeCard(card),true);
  assert.equal(card.distribution,'cross-border');assert.equal(card.revision,2);
  assert.equal(card.geography.countryCode,country);assert.equal(card.source.url,url);
  assert.equal(card.reviewedAt,'2026-11-25T00:45:05.000Z');assert.equal(card.reviewBy,'2026-12-25T00:45:05.000Z');
  const item=select([card])[0];assert.equal(item.scope,'global');assert.strictEqual(item.card,card);
  assert.equal(select([card],{countryCode:country,cityId:null})[0].scope,'country');
  assert.equal(select([card],{countryCode:null,cityId:null})[0].scope,'global');
  assert.equal(isInlineKnowledgeCurrent(item,ro,now),true);
 }
});

test('foreign geography and format alone never grant cross-border distribution',()=>{
 const localOnly={...helsinki,id:'foreign-local-only'};delete localOnly.distribution;
 assert.equal(validKnowledgeCard(localOnly),true);
 assert.deepEqual(select([localOnly]),[]);
 assert.deepEqual(select([localOnly],{countryCode:null,cityId:null}),[]);
 assert.equal(select([localOnly],{countryCode:'FI',cityId:null})[0].scope,'country');
 for(const invalid of [
  {...helsinki,distribution:'worldwide'}, {...helsinki,distribution:null},
  {...helsinki,format:'useful'}, {...helsinki,format:'care'}, {...helsinki,geography:undefined},
  {...helsinki,geography:{...helsinki.geography,countryCode:'fi'}},
  {...helsinki,source:{publisher:'Unknown',url:'https://example.invalid/news'}},
 ]){assert.equal(validKnowledgeCard(invalid),false);assert.throws(()=>select([invalid]),/KNOWLEDGE_CARD_INVALID/);}
 const inherited={...helsinki};delete inherited.distribution;Object.setPrototypeOf(inherited,{distribution:'cross-border'});
 assert.equal(validKnowledgeCard(inherited),false);
});

test('city and country priority, global category rounds and identity remain intact',()=>{
 const local={...helsinki,id:'city-priority',geography:{...helsinki.geography,countryCode:'RO',cityIds:['683506']}};
 const national={...paris,id:'country-priority',geography:{...paris.geography,countryCode:'RO',cityIds:[]}};
 const general=KNOWLEDGE_CARDS.find(card=>card.id==='venus-rotation');assert.ok(general);
 const cards=Object.freeze([paris,general,national,helsinki,local]);const before=JSON.stringify(cards);
 const result=select(cards);assert.deepEqual(result.map(item=>item.scope),['city','country','global','global','global']);
 assert.strictEqual(result[0].card,local);assert.strictEqual(result[1].card,national);
 assert.deepEqual(result.slice(2).map(item=>item.card),selectKnowledgeCards([paris,general,helsinki],'all',now,seed,ro.timeZone));
 assert.deepEqual(select([...cards].reverse()),result);assert.equal(JSON.stringify(cards),before);
});

test('publication and source-review windows still block premature and expired discoveries',()=>{
 const publish=Date.parse(paris.publishAt),expiry=Date.parse(paris.reviewBy);
 assert.deepEqual(select([paris],ro,publish-1),[]);
 assert.equal(select([paris],ro,publish).length,1);
 assert.equal(select([paris],ro,expiry-1).length,1);
 assert.deepEqual(select([paris],ro,expiry),[]);
 assert.equal(isInlineKnowledgeCurrent({card:paris,scope:'global'},ro,expiry),false);
});

test('new eligible discoveries append once without rewriting the read prefix or any news identity',()=>{
 const prior=Object.freeze(select([helsinki]));
 const expanded=appendEligibleKnowledge(prior,[helsinki,paris],ro,now,seed);
 assert.strictEqual(expanded[0],prior[0]);assert.strictEqual(expanded[1].card,paris);
 assert.strictEqual(appendEligibleKnowledge(prior,[helsinki,paris],ro,now,seed,new Set([paris.id])),prior);
 const news=Object.freeze(Array.from({length:44},(_,i)=>Object.freeze({key:'news-'+i})));
 const first=interleaveKnowledge(news.slice(0,11),prior),second=interleaveKnowledge(news,expanded);
 assert.deepEqual(second.slice(0,first.length),first);
 assert.deepEqual(second.filter(item=>item.kind==='knowledge').map(item=>item.afterNews),[11,22]);
 for(const [index,item] of second.filter(item=>item.kind==='news').entries())assert.strictEqual(item.item,news[index]);
});
