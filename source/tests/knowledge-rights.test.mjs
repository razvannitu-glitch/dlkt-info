import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {safeKnowledgeSource,validKnowledgeCard,knowledgeRightsForCard,validateKnowledgeCatalog,knowledgeEditorialPayload,matchesKnowledgeEditorialApproval,KNOWLEDGE_EDITORIAL_APPROVALS} from '../.build/src/iceo/knowledge.js';
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
  assert.throws(()=>select([card]),/KNOWLEDGE_EDITORIAL_APPROVAL_REQUIRED/);
  assert.throws(()=>validateKnowledgeCatalog([card]),/KNOWLEDGE_EDITORIAL_APPROVAL_REQUIRED/);
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

// Synthetic review decisions test the exact-content boundary. No production approval.
const digest=payload=>createHash('sha256').update(payload,'utf8').digest('hex');
function decision(card){const payload=knowledgeEditorialPayload(card);return Object.freeze({id:card.id,revision:card.revision,payload,digest:digest(payload)});}

test('source attribution is separate from exact editorial admission',()=>{
 for(const card of knowledgeRightsCandidates){
  const approval=decision(card);
  assert.equal(matchesKnowledgeEditorialApproval(card,approval),true);
  const changed=structuredClone(card);changed.copy.en.explanation+=' New wording.';
  const revised={...card,revision:card.revision+1};
  for(const altered of [changed,revised]){
   assert.equal(validKnowledgeCard(altered),true,'structural validity is not admission');
   assert.deepEqual(knowledgeRightsForCard(altered),knowledgeRightsForCard(card),'source credit is not content approval');
   assert.equal(matchesKnowledgeEditorialApproval(altered,approval),false);
   assert.throws(()=>validateKnowledgeCatalog([altered]),/KNOWLEDGE_EDITORIAL_APPROVAL_REQUIRED/);
  }
  assert.equal(matchesKnowledgeEditorialApproval(card,{...approval,revision:2}),false);
  assert.equal(matchesKnowledgeEditorialApproval(card,{...approval,digest:'bad'}),false);
  assert.equal(matchesKnowledgeEditorialApproval(card,{...approval,payload:approval.payload+' '}),false);
 }
});

test('canonical content binds all languages, provenance, origin and review dates',()=>{
 const approval=decision(nsw);
 for(const language of ['en','ro','it'])for(const field of ['title','explanation','connection']){
  const copy=structuredClone(nsw);copy.copy[language][field]+=' X';
  assert.equal(matchesKnowledgeEditorialApproval(copy,approval),false,language+' '+field);
 }
 for(const change of [{topic:{...nsw.topic,en:'Different topic'}},{reviewBy:'2026-12-25T00:00:00.000Z'},{publishAt:'2026-11-28T06:00:00.000Z'}]){
  assert.equal(matchesKnowledgeEditorialApproval({...nsw,...change},approval),false);
 }
 const reordered=Object.fromEntries(Object.entries(nsw).reverse());
 assert.equal(knowledgeEditorialPayload(reordered),approval.payload);
 assert.equal(knowledgeEditorialPayload({...nsw,privateContext:'ignored'}),approval.payload);
});

test('committed editorial decisions carry verified SHA-256 and unique identities; fixtures stay denied',()=>{
 const ids=new Set();
 for(const approval of KNOWLEDGE_EDITORIAL_APPROVALS){
  assert.equal(approval.digest,digest(approval.payload));
  assert.equal(ids.has(approval.id),false);ids.add(approval.id);
  const card=KNOWLEDGE_CARDS.find(item=>item.id===approval.id);
  assert.ok(card,'no orphaned editorial approval');
  assert.equal(matchesKnowledgeEditorialApproval(card,approval),true);
 }
 assert.equal(KNOWLEDGE_EDITORIAL_APPROVALS.length,0,'lab must not contain real approvals');
 for(const card of knowledgeRightsCandidates)assert.throws(()=>validateKnowledgeCatalog([card]),/KNOWLEDGE_EDITORIAL_APPROVAL_REQUIRED/);
});

test('denied fixtures never enter feed selection even within their review window',()=>{
 for(const card of knowledgeRightsCandidates){
  for(const at of [Date.parse(card.publishAt)-1,Date.parse(card.publishAt),Date.parse(card.reviewBy)]){
   assert.throws(()=>select([card],at),/KNOWLEDGE_EDITORIAL_APPROVAL_REQUIRED/);
  }
  assert.throws(()=>selectInlineKnowledge([card],{countryCode:card.geography.countryCode,cityId:null},now,'rights-lab'),/KNOWLEDGE_EDITORIAL_APPROVAL_REQUIRED/);
 }
 const selected=select(KNOWLEDGE_CARDS),news=Object.freeze(Array.from({length:44},(_,i)=>Object.freeze({key:'n-'+i})));
 const items=interleaveKnowledge(news,selected);
 for(const [i,item] of items.filter(item=>item.kind==='news').entries())assert.strictEqual(item.item,news[i]);
 assert.equal(selected.some(item=>knowledgeRightsCandidates.some(card=>card.id===item.card.id)),false);
});
