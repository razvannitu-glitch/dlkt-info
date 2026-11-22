import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {knowledgeLanguage} from '../.build/src/iceo/knowledge.js';
import {newsCategoryLabel} from '../.build/src/iceo/news-taxonomy.js';

class Node {
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.textContent='';}
 append(...nodes){this.children.push(...nodes);}
 setAttribute(name,value){this.attributes[name]=value;}
}
const compiled=readFileSync('.build/src/iceo/knowledge-browser.js','utf8');
const end=compiled.indexOf('export function setupKnowledgeReader(');
assert.ok(end>0,'exercise the actual compiled shared renderer before reader setup');
const shared=compiled.slice(0,end).replace(/^import .+;\r?\n/gmu,'').replace(/^export function /gmu,'function ');
function renderer(language){
 const document={createElement:tag=>new Node(tag),createElementNS:(_namespace,tag)=>new Node(tag),createTextNode:text=>({textContent:text})};
 const context={document,getLocale:()=>language,knowledgeLanguage,newsCategoryLabel};
 runInNewContext(shared+'\nthis.render=knowledgeCardNode;',context);
 return context.render;
}
function descendants(node){return [node,...(node.children??[]).flatMap(descendants)];}

test('shared knowledge renderer keeps inline and collection IDs unique in every preview language',()=>{
 for(const language of ['en','ro','it']){
  const render=renderer(language),ids=[];
  for(const card of KNOWLEDGE_CARDS){
   const inline=render(card,card.geography?'city':'global'),collection=render(card);
   assert.equal(inline.tagName,'article');assert.equal(inline.lang,language);
   assert.equal(inline.dataset.newsStreamKey,'knowledge:'+card.id);
   assert.equal(inline.dataset.editionPart,'stream');
   const inlineTitle=descendants(inline).find(node=>node.className==='knowledge-card-title');
   const collectionTitle=descendants(collection).find(node=>node.className==='knowledge-card-title');
   assert.equal(inlineTitle.tagName,'h3');assert.equal(collectionTitle.tagName,'h2');
   assert.equal(inlineTitle.textContent,card.copy[language].title);
   assert.equal(inline.attributes['aria-labelledby'],inlineTitle.id);
   assert.equal(collection.attributes['aria-labelledby'],collectionTitle.id);
   ids.push(...[inline,collection].flatMap(root=>descendants(root).filter(node=>node.id).map(node=>node.id)));
   assert.equal(descendants(inline).some(node=>node.tagName==='img'),false);
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
   const action=descendants(node).find(value=>value.className==='knowledge-explore');
   assert.equal(action.href,'#know/'+local.id);assert.equal(node.children.some(value=>value.dataset?.knowledgeShare),false);
  }
  const node=render(general,'global'),label=descendants(node).find(value=>value.className==='knowledge-topic');
  assert.equal(label.textContent,{en:'General knowledge',ro:'Fapt general',it:'Conoscenza generale'}[language]);
  const review=descendants(node).find(value=>value.tagName==='time');assert.equal(review.dateTime,general.reviewedAt);
 }
});
