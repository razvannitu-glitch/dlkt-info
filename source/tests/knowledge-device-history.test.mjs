import assert from 'node:assert/strict';
import test from 'node:test';
import {KNOWLEDGE_SEEN_KEY,readKnowledgeSeen,writeKnowledgeSeen,interleaveKnowledge,selectInlineKnowledge} from '../.build/src/iceo/knowledge-stream.js';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';

const makeStore=()=>{const data=new Map();return{getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);}};};
test('knowledge identifiers remain seen after a browser reload, without storing account data',()=>{
 const storage=makeStore(),seen=readKnowledgeSeen(()=>storage);
 assert.equal(seen.size,0);
 seen.add('venus-rotation');seen.add('web-public-domain');
 assert.equal(writeKnowledgeSeen(seen,()=>storage),true);
 assert.deepEqual([...readKnowledgeSeen(()=>storage)],['venus-rotation','web-public-domain']);
 assert.equal(KNOWLEDGE_SEEN_KEY,'dlkt-info-knowledge-seen-v1');
 assert.ok(!storage.getItem(KNOWLEDGE_SEEN_KEY).includes('@'));
});
test('blocked or poisoned storage fails closed and leaves the news feed intact',()=>{
 const store=makeStore();
 for(const corrupted of ['{broken','[12]','["bad<script>"]',JSON.stringify(Array(5001).fill('valid-id'))]){
  store.setItem(KNOWLEDGE_SEEN_KEY,corrupted);assert.equal(readKnowledgeSeen(()=>store).size,0);
 }
 const blocked=()=>{throw Error('STORAGE_DENIED');};
 assert.equal(readKnowledgeSeen(blocked).size,0);
 assert.equal(writeKnowledgeSeen(new Set(['venus-rotation']),blocked),false);
 assert.equal(writeKnowledgeSeen(new Set(['../bad']),()=>store),false);
});
test('eleven original news appear between each knowledge card, without duplicates',()=>{
 const news=Array.from({length:45},(_,i)=>({key:'article-'+i}));
 const facts=[{card:{id:'fact-1'},scope:'global'},{card:{id:'fact-2'},scope:'global'},{card:{id:'fact-3'},scope:'global'}];
 const projected=interleaveKnowledge(news,facts);
 assert.deepEqual(projected.flatMap((item,i)=>item.kind==='knowledge'?[i+1]:[]),[12,24,36]);
 assert.equal(projected.filter(item=>item.kind==='news').length,45);
 assert.equal(new Set(projected.filter(item=>item.kind==='knowledge').map(item=>item.item.card.id)).size,3);
});
test('on-this-day evidence follows the selected date without bypassing geographic relevance',()=>{
 const at=Date.parse('2026-11-23T12:00:00.000Z');
 const context={countryCode:'RO',cityId:'683506',timeZone:'Europe/Bucharest'};
 const picked=selectInlineKnowledge(KNOWLEDGE_CARDS,context,at,'calendar-evidence');
 assert.equal(picked[0]?.scope,'city');
 assert.ok(picked.some(item=>item.card.id==='computer-industry-1992-nov-23'));
 assert.ok(picked.some(item=>item.card.format==='recipe'));
 const ranks={city:0,country:1,global:2};
 for(let index=1;index<picked.length;index++)assert.ok(ranks[picked[index-1].scope]<=ranks[picked[index].scope]);
 const next=selectInlineKnowledge(KNOWLEDGE_CARDS,context,at+86400000,'next-day');
 assert.ok(!next.some(item=>item.card.id==='computer-industry-1992-nov-23'));
});
