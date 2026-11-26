import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {knowledgeLanguage,knowledgeRightsForCard} from '../.build/src/iceo/knowledge.js';
import {knowledgeRightsCandidates} from './fixtures/knowledge-rights-candidates.mjs';
import {newsCategoryLabel} from '../.build/src/iceo/news-taxonomy.js';

class Node {
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.textContent='';}
 append(...nodes){this.children.push(...nodes);}
 setAttribute(name,value){this.attributes[name]=value;}
}
const compiled=readFileSync('.build/src/iceo/knowledge-browser.js','utf8');
const shared=compiled.replace(/^import .+;\r?\n/gmu,'').replace(/^export function /gmu,'function ');
function renderer(language){
 const document={createElement:tag=>new Node(tag),createElementNS:(_namespace,tag)=>new Node(tag),createTextNode:text=>({textContent:text})};
 const context={document,getLocale:()=>language,knowledgeLanguage,knowledgeRightsForCard,newsCategoryLabel};
 runInNewContext(shared+'\nthis.render=knowledgeCardNode;',context);
 return context.render;
}
function descendants(node){return [node,...(node.children??[]).flatMap(descendants)];}

test('knowledge renderer creates only inline news cards with unique accessible identities',()=>{
 for(const language of ['en','ro','it']){
  const render=renderer(language),ids=[];
  for(const card of KNOWLEDGE_CARDS){
   const inline=render(card,card.geography?'city':'global');
   assert.equal(inline.tagName,'article');assert.equal(inline.lang,language);
   assert.equal(inline.dataset.newsStreamKey,'knowledge:'+card.id);assert.equal(inline.dataset.editionPart,'stream');
   const title=descendants(inline).find(node=>node.className==='knowledge-card-title');
   assert.equal(title.tagName,'h3');assert.equal(title.textContent,card.copy[language].title);
   assert.equal(inline.attributes['aria-labelledby'],title.id);
   ids.push(...descendants(inline).filter(node=>node.id).map(node=>node.id));
   assert.equal(descendants(inline).some(node=>node.tagName==='img'),false);
   assert.equal(descendants(inline).some(node=>node.className==='knowledge-explore'),false);
   const links=descendants(inline).filter(node=>node.tagName==='a');assert.equal(links.length,1);
   assert.equal(links[0].href,card.source.url);
  }
  assert.equal(new Set(ids).size,ids.length);
 }
});

test('inline knowledge keeps the real city label for country fallback and labels general facts honestly',()=>{
 const local=KNOWLEDGE_CARDS.find(card=>card.id==='torino-museo-egizio-1824');
 const general=KNOWLEDGE_CARDS.find(card=>card.id==='venus-rotation');
 for(const language of ['en','ro','it']){
  const render=renderer(language);
  for(const scope of ['city','country']){
   const node=render(local,scope),label=descendants(node).find(value=>value.className==='knowledge-topic');
   assert.equal(node.dataset.knowledgeScope,scope);assert.equal(label.textContent,local.geography.label[language]);
   const source=descendants(node).find(value=>value.className==='knowledge-source');
   assert.equal(source.href,local.source.url);assert.equal(source.target,'_blank');assert.equal(source.rel,'noopener noreferrer');
   assert.equal(descendants(node).some(value=>value.className==='knowledge-explore'),false);
   assert.equal(node.children.some(value=>value.dataset?.knowledgeShare),false);
  }
  const node=render(general,'global'),label=descendants(node).find(value=>value.className==='knowledge-topic');
  assert.equal(label.textContent,{en:'General knowledge',ro:'Fapt general',it:'Conoscenza generale'}[language]);
  const review=descendants(node).find(value=>value.tagName==='time');assert.equal(review.dateTime,general.reviewedAt);
 }
});

test('useful and elsewhere formats have distinct translated labels and truthful source checks',()=>{
 const labels={en:{useful:'One useful thing',elsewhere:'Works elsewhere'},ro:{useful:'Un lucru util',elsewhere:'Functioneaza in alta parte'},it:{useful:'Una cosa utile',elsewhere:'Funziona altrove'}};
 for(const language of ['en','ro','it']){
  for(const format of ['useful','elsewhere']){
   const card=KNOWLEDGE_CARDS.find(item=>item.format===format);assert.ok(card);
   const node=renderer(language)(card,'global'),all=descendants(node);
   assert.equal(all.find(item=>item.className==='knowledge-category-tag').textContent,labels[language][format]);
   assert.equal(all.find(item=>item.tagName==='time').dateTime,card.reviewedAt,'publishing never restamps evidence review');
   assert.equal(all.find(item=>item.tagName==='a').href,card.source.url);
   assert.equal(node.dataset.knowledgeFormat,format);
  }
 }
});


test('reviewed cross-border cards retain their real geographic origin in the global slot',()=>{
 const card=KNOWLEDGE_CARDS.find(item=>item.id==='dlkt-elsewhere-helsinki-shared-workshop');assert.ok(card);
 for(const language of ['en','ro','it']){
  const node=renderer(language)(card,'global'),all=descendants(node);
  assert.equal(node.dataset.knowledgeScope,'global');
  assert.equal(all.find(item=>item.className==='knowledge-topic').textContent,card.geography.label[language]);
  assert.equal(all.find(item=>item.tagName==='a').href,card.source.url);
  assert.equal(all.find(item=>item.tagName==='time').dateTime,card.reviewedAt);
 }
});


test('licensed pilot fixtures render exact credits and safe links inside existing provenance in each language',()=>{
 const disclosures={en:'Original DLKT synthesis and translations',ro:'Sinteza originala si traduceri DLKT',it:'Sintesi originale e traduzioni DLKT'};
 for(const card of knowledgeRightsCandidates){
  const rights=knowledgeRightsForCard(card);assert.ok(rights);
  for(const language of ['en','ro','it']){
   const node=renderer(language)(card,'global'),all=descendants(node);
   const provenance=all.find(item=>item.className==='knowledge-provenance');assert.ok(provenance);
   assert.ok(provenance.children.some(item=>item.textContent.includes(rights.credit)&&item.textContent.includes(disclosures[language])));
   const links=all.filter(item=>item.tagName==='a');
   assert.deepEqual(links.map(item=>item.href),[rights.licenseUrl,rights.policyUrl,card.source.url]);
   assert.ok(links.every(item=>item.target==='_blank'&&item.rel==='noopener noreferrer'));
   assert.equal(all.find(item=>item.className==='knowledge-topic').textContent,card.geography.label[language]);
   assert.equal(all.find(item=>item.tagName==='time').dateTime,card.reviewedAt);
   assert.equal(all.some(item=>item.tagName==='img'),false);
  }
 }
});

test('the renderer refuses mismatched rights bindings rather than silently dropping their credit',()=>{
 const card=structuredClone(knowledgeRightsCandidates[0]);card.source.publisher='Unverified publisher';
 assert.throws(()=>renderer('en')(card,'global'),/KNOWLEDGE_RIGHTS_BINDING_INVALID/);
});
