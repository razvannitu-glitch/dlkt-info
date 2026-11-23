import test from 'node:test';
import assert from 'node:assert/strict';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {validKnowledgeCard} from '../.build/src/iceo/knowledge.js';
import {INLINE_KNOWLEDGE_INTERVAL,selectInlineKnowledge,interleaveKnowledge} from '../.build/src/iceo/knowledge-stream.js';

const now=Date.parse('2026-11-23T12:00:00.000Z');
const context={cityId:'683506',countryCode:'RO'};
const categories=['01000000','06000000','13000000'];
function freeze(value){
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
 return value;
}
function fact(id,category='13000000',geography){
 const card={...structuredClone(KNOWLEDGE_CARDS[0]),id,category};delete card.geography;
 if(geography!==undefined)card.geography=geography;
 assert.equal(validKnowledgeCard(card),true,id);return freeze(card);
}
function area(countryCode,cityIds,label){
 return {countryCode,cityIds,label:{en:label,ro:label,it:label}};
}
function originals(count){
 return freeze(Array.from({length:count},(_,index)=>({
  key:'news-'+index,
  card:{id:index.toString(16).padStart(24,'0'),title:'Original report '+index,
   sourceUrl:'https://www.theguardian.com/world/2026/nov/23/inline-fixture-'+index,
   date:new Date(now-index*1000).toISOString(),dateLabel:'Published',publisher:'The Guardian',
   contentHash:index.toString(16).padStart(64,'0'),observedAt:new Date(now).toISOString(),
   facts:['Publisher fact '+index],attribution:'The Guardian'},
 })));
}
function facts(count){
 return freeze(Array.from({length:count},(_,index)=>fact('fact-'+index,categories[index%categories.length])));
}
function knowledgePositions(items){
 return items.flatMap((item,index)=>item.kind==='knowledge'?[index+1]:[]);
}
function assertRounds(items){
 const remaining=new Map();for(const item of items)remaining.set(item.card.category,(remaining.get(item.card.category)??0)+1);
 let start=0,previous=null;
 while(remaining.size){
  const expected=[...remaining.keys()].sort(),round=items.slice(start,start+remaining.size);
  assert.deepEqual([...new Set(round.map(item=>item.card.category))].sort(),expected);
  if(previous!==null&&remaining.size>1)assert.notEqual(round[0].card.category,previous);
  for(const item of round){const left=remaining.get(item.card.category)-1;if(left)remaining.set(item.card.category,left);else remaining.delete(item.card.category);}
  previous=round.at(-1).card.category;start+=round.length;
 }
 assert.equal(start,items.length);
}

test('inline knowledge ranks explicit city, country and global facts without deriving geography from publishers',()=>{
 const local=fact('bucharest-fact','01000000',area('RO',['683506'],'Bucharest'));
 const national=fact('romania-fact','06000000',area('RO',[],'Romania'));
 const otherCity=fact('timisoara-fact','13000000',area('RO',['665087'],'Timisoara'));
 const italian=fact('torino-fact','01000000',area('IT',['3165524'],'Torino'));
 const global=fact('global-fact');
 const cards=freeze([global,italian,otherCity,national,local]),before=JSON.stringify(cards);
 const selected=selectInlineKnowledge(cards,context,now,'edition');
 assert.deepEqual(selected.map(item=>item.scope),['city','country','country','global']);
 assert.strictEqual(selected[0].card,local);assert.strictEqual(selected.at(-1).card,global);
 assert.deepEqual(new Set(selected.filter(item=>item.scope==='country').map(item=>item.card.id)),new Set([national.id,otherCity.id]));
 assert.equal(selected.some(item=>item.card.id===italian.id),false);
 assert.strictEqual(selected.find(item=>item.card===otherCity).card.geography,otherCity.geography,'the actual other-city label is retained, not rewritten as the reader city');
 const it=selectInlineKnowledge(cards,{cityId:'3165524',countryCode:'IT'},now,'edition');
 assert.deepEqual(it.map(item=>[item.card.id,item.scope]),[[italian.id,'city'],[global.id,'global']]);
 for(const countryOnly of [{cityId:null,countryCode:'RO'},{cityId:'999999',countryCode:'RO'}]){
  const result=selectInlineKnowledge(cards,countryOnly,now,'edition');
  assert.equal(result.filter(item=>item.scope==='country').length,3);assert.equal(result.some(item=>item.scope==='city'),false);
 }
 for(const unknown of [{cityId:null,countryCode:null},{cityId:'683506',countryCode:null},{cityId:null,countryCode:'XX'}]){
  assert.deepEqual(selectInlineKnowledge(cards,unknown,now,'edition').map(item=>item.card.id),[global.id]);
 }
 for(const item of selected)assert.strictEqual(item.card,cards.find(card=>card.id===item.card.id));
 assert.equal(JSON.stringify(cards),before);
});

test('every priority tier retains category rounds, all eligible facts and deterministic ordering',()=>{
 const cards=[];
 for(const [scope,counts] of [['city',[7,4,2]],['country',[8,5,3]],['global',[9,6,4]]]){
  for(const [categoryIndex,count] of counts.entries())for(let index=0;index<count;index++){
   const geography=scope==='city'?area('RO',['683506'],'Bucharest'):scope==='country'?area('RO',[],'Romania'):undefined;
   cards.push(fact(scope+'-'+categoryIndex+'-'+index,categories[categoryIndex],geography));
  }
 }
 freeze(cards);const selected=selectInlineKnowledge(cards,context,now,'fixed-edition');
 assert.equal(selected.length,cards.length);assert.equal(new Set(selected.map(item=>item.card.id)).size,cards.length);
 const ranks={city:0,country:1,global:2};
 for(let index=1;index<selected.length;index++)assert.ok(ranks[selected[index-1].scope]<=ranks[selected[index].scope]);
 for(const scope of ['city','country','global'])assertRounds(selected.filter(item=>item.scope===scope));
 assert.deepEqual(selectInlineKnowledge(cards,context,now,'fixed-edition'),selected);
 assert.deepEqual(selectInlineKnowledge([...cards].reverse(),context,now,'fixed-edition'),selected);
});

test('inline selection applies the original model review window and rejects duplicate catalogue identities',()=>{
 const original=fact('review-current');
 const active=freeze({...original,reviewedAt:new Date(now-1000).toISOString(),reviewBy:new Date(now+1).toISOString()});
 const future=freeze({...original,id:'review-future',reviewedAt:new Date(now+1).toISOString(),reviewBy:new Date(now+10000).toISOString()});
 const expired=freeze({...original,id:'review-expired',reviewedAt:new Date(now-1000).toISOString(),reviewBy:new Date(now).toISOString()});
 for(const card of [active,future,expired])assert.equal(validKnowledgeCard(card),true);
 assert.deepEqual(selectInlineKnowledge([active,future,expired],context,now,'review').map(item=>item.card.id),[active.id]);
 assert.equal(selectInlineKnowledge([active],context,now+1,'review').length,0);
 assert.equal(selectInlineKnowledge([future],context,now,'review').length,0);
 const duplicate={...original,geography:area('RO',['683506'],'Bucharest')};
 assert.throws(()=>selectInlineKnowledge([original,duplicate],context,now,'review'),/KNOWLEDGE_CARD_INVALID/);
 assert.throws(()=>selectInlineKnowledge([original],{cityId:'',countryCode:'RO'},now,'review'),/INLINE_KNOWLEDGE_CONTEXT_INVALID/);
 assert.throws(()=>selectInlineKnowledge([original],context,NaN,'review'),/KNOWLEDGE_CONTEXT_INVALID/);
});

test('270 original news include distinct knowledge after each eleven stories',()=>{
 assert.equal(INLINE_KNOWLEDGE_INTERVAL,12);
 const news=originals(270),selected=selectInlineKnowledge(facts(15),context,now,'270'),before=JSON.stringify(news);
 const result=interleaveKnowledge(news,selected),inserted=result.filter(item=>item.kind==='knowledge'),retained=result.filter(item=>item.kind==='news');
 assert.equal(result.length,285);assert.equal(retained.length,270);assert.equal(inserted.length,15);
 assert.deepEqual(knowledgePositions(result),Array.from({length:15},(_,i)=>(i+1)*12));
 assert.deepEqual(inserted.map(item=>item.afterNews),Array.from({length:15},(_,i)=>(i+1)*11));
 for(const [index,item] of retained.entries())assert.strictEqual(item.item,news[index]);
 for(const [index,item] of inserted.entries())assert.strictEqual(item.item,selected[index]);
 assert.equal(new Set(retained.map(item=>item.item.key)).size,270);
 assert.equal(new Set(inserted.map(item=>item.item.card.id)).size,15);
 assert.equal(JSON.stringify(news),before);
});

test('knowledge requires11 news, repeats after another11 and never pads an exhausted catalogue',()=>{
 const news=originals(100),selected=selectInlineKnowledge(facts(3),context,now,'thresholds');
 for(const [count,positions] of [[0,[]],[1,[]],[10,[]],[11,[12]],[12,[12]],[21,[12]],[22,[12,24]],[23,[12,24]]]){
  const result=interleaveKnowledge(news.slice(0,count),selected);
  assert.deepEqual(knowledgePositions(result),positions);assert.equal(result.filter(item=>item.kind==='news').length,count);
  if(result.length)assert.equal(result[0].kind,'news');
 }
 const limited=interleaveKnowledge(news,selected.slice(0,2));
 assert.deepEqual(knowledgePositions(limited),[12,24]);assert.equal(limited.length,102);
 assert.strictEqual(limited.at(-1).item,news.at(-1));
 assert.deepEqual(interleaveKnowledge(news,[]).map(item=>item.item),news);
 assert.deepEqual(interleaveKnowledge([],selected),[]);
 assert.throws(()=>interleaveKnowledge(news,[selected[0],selected[0]]),/INLINE_KNOWLEDGE_DUPLICATE/);
 assert.throws(()=>interleaveKnowledge([news[0],news[0]],selected),/INLINE_NEWS_IDENTITY_INVALID/);
});

test('successive20-news page appends preserve the entire previously displayed prefix',()=>{
 const news=originals(270),selected=selectInlineKnowledge(facts(11),context,now,'one-edition');
 let previous=[];
 for(const count of [20,40,60,80,100,120,140,160,180,200,220,240,260,270]){
  const next=interleaveKnowledge(news.slice(0,count),selected);
  assert.deepEqual(next.slice(0,previous.length),previous,'prefix at '+count+' original news');
  assert.equal(next.filter(item=>item.kind==='news').length,count);
  for(const [index,entry] of next.filter(item=>item.kind==='news').entries())assert.strictEqual(entry.item,news[index]);
  previous=next;
 }
 assert.equal(previous.filter(item=>item.kind==='knowledge').length,11);
 assert.equal(new Set(previous.filter(item=>item.kind==='knowledge').map(item=>item.item.card.id)).size,11);
});
