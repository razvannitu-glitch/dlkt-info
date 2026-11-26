import test from 'node:test';
import assert from 'node:assert/strict';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {safeKnowledgeSource,validKnowledgeCard,knowledgeRightsForCard,validateKnowledgeCatalog} from '../.build/src/iceo/knowledge.js';
import {selectInlineKnowledge,interleaveKnowledge} from '../.build/src/iceo/knowledge-stream.js';
import {knowledgeRightsCandidates} from './fixtures/knowledge-rights-candidates.mjs';
const [nsw,nz]=knowledgeRightsCandidates;
const ctx={countryCode:'RO',cityId:'683506',timeZone:'Europe/Bucharest'};
const now=Date.parse('2026-11-27T12:00:00.000Z');
const select=(cards,at=now)=>selectInlineKnowledge(cards,ctx,at,'rights-lab');

test('both exact candidate bindings are valid but neither candidate is active in the public catalogue',()=>{
 assert.equal(KNOWLEDGE_CARDS.length,25);
 assert.ok(KNOWLEDGE_CARDS.every(card=>knowledgeRightsForCard(card)===null));
 for(const card of knowledgeRightsCandidates){
  assert.equal(validKnowledgeCard(card),true);
  assert.equal(safeKnowledgeSource(card.source.url),true);
  assert.equal(KNOWLEDGE_CARDS.some(item=>item.id===card.id),false);
  const rights=knowledgeRightsForCard(card);assert.ok(Object.isFrozen(rights));
  assert.equal(rights.licenseUrl,'https://creativecommons.org/licenses/by/4.0/');
  assert.equal(select([card])[0].scope,'global');
 }
 assert.match(knowledgeRightsForCard(nsw).credit,/State of New South Wales/);
 assert.match(knowledgeRightsForCard(nz).credit,/Commerce Commission/);
});

test('new publishers do not gain blanket origin approval',()=>{
 for(const url of ['https://www.nsw.gov.au/','https://www.nsw.gov.au/unreviewed','https://www.comcom.govt.nz/using-our-website/copyright/',nsw.source.url+'?x=1',nz.source.url+'#fragment',nz.source.url.replace('www.comcom.govt.nz','www.comcom.govt.nz.evil.example')])assert.equal(safeKnowledgeSource(url),false,url);
});

test('reserved card identities and source URLs cannot be cross-bound or impersonated',()=>{
 const legacy=KNOWLEDGE_CARDS[0];
 const variants=[{...nsw,id:'different-card'},{...nsw,source:nz.source},{...nsw,source:legacy.source},{...legacy,source:nsw.source},{...nsw,source:{...nsw.source,publisher:'DLKT'}},{...nsw,distribution:undefined},{...nsw,format:'useful'},{...nsw,category:'13000000'},{...nsw,geography:undefined},{...nsw,geography:{...nsw.geography,countryCode:'NZ'}},{...nsw,geography:{...nsw.geography,cityIds:['683506']}},{...nsw,geography:{...nsw.geography,label:{...nsw.geography.label,ro:'Bucuresti'}}}];
 for(const card of variants){assert.equal(validKnowledgeCard(card),false,card.id);assert.throws(()=>validateKnowledgeCatalog([card]),/KNOWLEDGE_CARD_INVALID/);}
 assert.throws(()=>knowledgeRightsForCard({...nsw,source:nz.source}),/KNOWLEDGE_RIGHTS_BINDING_INVALID/);
});

test('untrusted additional metadata cannot override canonical attribution or links',()=>{
 const spoof={...nsw,rights:{credit:'Fake rights',licenseUrl:'javascript:alert(1)'},source:{...nsw.source,rights:{policyUrl:'https://evil.example/'}}};
 assert.deepEqual(knowledgeRightsForCard(spoof),knowledgeRightsForCard(nsw));
 assert.equal(knowledgeRightsForCard(KNOWLEDGE_CARDS[0]),null);
});

test('original lifecycle, geographic priority and news sequence still apply to licensed fixtures',()=>{
 for(const card of knowledgeRightsCandidates){
  assert.deepEqual(select([card],Date.parse(card.publishAt)-1),[]);
  assert.equal(select([card],Date.parse(card.publishAt)).length,1);
  assert.deepEqual(select([card],Date.parse(card.reviewBy)),[]);
  assert.equal(selectInlineKnowledge([card],{countryCode:card.geography.countryCode,cityId:null},now,'rights-lab')[0].scope,'country');
 }
 const news=Object.freeze(Array.from({length:44},(_,i)=>Object.freeze({key:'n-'+i})));
 const selected=select(knowledgeRightsCandidates),items=interleaveKnowledge(news,selected);
 assert.deepEqual(items.filter(item=>item.kind==='knowledge').map(item=>item.afterNews),[11,22]);
 for(const [i,item] of items.filter(item=>item.kind==='news').entries())assert.strictEqual(item.item,news[i]);
 assert.throws(()=>validateKnowledgeCatalog([nsw,nsw]),/KNOWLEDGE_CARD_INVALID/);
});
