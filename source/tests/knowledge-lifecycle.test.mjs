import test from 'node:test';
import assert from 'node:assert/strict';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {validKnowledgeCard,safeKnowledgeSource,selectKnowledgeCards,nextKnowledgeBoundary} from '../.build/src/iceo/knowledge.js';
import {selectInlineKnowledge,isInlineKnowledgeCurrent,appendEligibleKnowledge,interleaveKnowledge} from '../.build/src/iceo/knowledge-stream.js';

const reviewed=Date.parse('2026-11-25T00:00:00.000Z');
const published=Date.parse('2026-11-26T00:00:00.000Z');
const expires=Date.parse('2026-11-28T00:00:00.000Z');
const context=Object.freeze({cityId:'683506',countryCode:'RO',timeZone:'Europe/Bucharest'});
const iso=value=>new Date(value).toISOString();
function card(id,changes={}){
 const base=structuredClone(KNOWLEDGE_CARDS[0]);
 delete base.geography;delete base.format;delete base.calendarDay;delete base.publishAt;
 return Object.freeze({...base,id,reviewedAt:iso(reviewed),reviewBy:iso(expires),...changes});
}
function area(countryCode,cityIds){return Object.freeze({countryCode,cityIds,label:{en:'Original place',ro:'Locul original',it:'Luogo originale'}});}

test('editorial publication has its own strict window and never changes source review timestamps',()=>{
 const scheduled=card('scheduled-useful',{format:'useful',publishAt:iso(published)});
 assert.equal(validKnowledgeCard(scheduled),true);
 for(const now of [reviewed-1,reviewed,published-1])assert.deepEqual(selectKnowledgeCards([scheduled],'all',now,'release'),[]);
 for(const now of [published,expires-1]){
  const selected=selectKnowledgeCards([scheduled],'all',now,'release');
  assert.equal(selected.length,1);assert.strictEqual(selected[0],scheduled);
  assert.equal(selected[0].reviewedAt,iso(reviewed));assert.equal(selected[0].publishAt,iso(published));
 }
 assert.deepEqual(selectKnowledgeCards([scheduled],'all',expires,'release'),[]);
 const legacy=card('legacy-reviewed');
 assert.deepEqual(selectKnowledgeCards([legacy],'all',reviewed,'release'),[legacy]);
 assert.equal(validKnowledgeCard({...scheduled,publishAt:iso(reviewed)}),true);
 for(const publishAt of [null,'2026-11-26',iso(reviewed-1),iso(expires),iso(expires+1),'2026-02-30T00:00:00.000Z']){
  assert.equal(validKnowledgeCard({...scheduled,publishAt}),false,String(publishAt));
 }
 for(const format of ['useful','elsewhere'])assert.equal(validKnowledgeCard({...scheduled,format}),true);
 assert.equal(validKnowledgeCard({...scheduled,format:'breaking-news'}),false);
});

test('new editorial source origins retain the original exact HTTPS no-query policy',()=>{
 const origins=['https://support.google.com','https://www.ncsc.gov.uk','https://www.repaircafe.org','https://oodihelsinki.fi','https://www.paris.fr','https://www.zooniverse.org'];
 for(const origin of origins){
  assert.equal(safeKnowledgeSource(origin+'/reviewed-article'),true,origin);
  for(const input of [origin,origin+'/',origin+'/reviewed-article?utm_source=x',origin+'/reviewed-article#anchor',origin.replace('https:','http:')+'/reviewed-article',origin+'.evil.example/reviewed-article',origin.replace('https://','https://name:password@')+'/reviewed-article']){
   assert.equal(safeKnowledgeSource(input),false,input);
  }
 }
});

test('scheduled discoveries append with the original references and do not replay exposed or revised IDs',()=>{
 const local=card('existing-local',{geography:area('RO',['683506'])});
 const global=card('existing-global');
 const release=card('tomorrow-useful',{format:'useful',publishAt:iso(published)});
 const alreadySeen=card('already-exposed',{format:'elsewhere',publishAt:iso(published)});
 const expired=card('expired-new',{reviewBy:iso(published)});
 const foreign=card('foreign-private-area',{geography:area('IT',['3165524']),publishAt:iso(published)});
 const catalogue=Object.freeze([release,alreadySeen,foreign,global,local,expired]);
 const history=new Set([alreadySeen.id]);
 const existing=Object.freeze(selectInlineKnowledge([global,local],context,reviewed,'stable'));
 const before=JSON.stringify(existing),originalRefs=[...existing];
 assert.strictEqual(appendEligibleKnowledge(existing,[global,local,release],context,reviewed,'stable',history),existing);
 const next=appendEligibleKnowledge(existing,catalogue,context,published,'different-seed',history);
 assert.equal(next.length,3);assert.deepEqual(next.slice(0,2),existing);
 for(let i=0;i<existing.length;i++)assert.strictEqual(next[i],originalRefs[i]);
 assert.strictEqual(next[2].card,release);assert.equal(JSON.stringify(existing),before);
 assert.strictEqual(appendEligibleKnowledge(next,catalogue,context,published,'again',history),next);
 const revision=Object.freeze({...release,revision:release.revision+1});
 assert.strictEqual(appendEligibleKnowledge(next,[revision],context,published,'again'),next);
 const news=Object.freeze(Array.from({length:66},(_,i)=>Object.freeze({key:'news-'+i})));
 const mixed=interleaveKnowledge(news,next);
 assert.equal(mixed.filter(item=>item.kind==='news').length,66);
 for(const [i,item] of mixed.filter(item=>item.kind==='news').entries())assert.strictEqual(item.item,news[i]);
 assert.deepEqual(mixed.filter(item=>item.kind==='knowledge').map(item=>item.afterNews),[11,22,33]);
});

test('expiry reserves an existing selection position while new expired cards cannot enter it',()=>{
 const old=card('older-slot',{reviewBy:iso(published)});
 const next=card('new-slot',{publishAt:iso(published)});
 const existing=Object.freeze(selectInlineKnowledge([old],context,reviewed,'slots'));
 const result=appendEligibleKnowledge(existing,[old,next],context,published,'slots');
 assert.strictEqual(result[0],existing[0]);assert.strictEqual(result[1].card,next);
 assert.deepEqual(selectKnowledgeCards([result[0].card],'all',published,'slots'),[],'renderer must hide an expired reserved entry');
 assert.deepEqual(appendEligibleKnowledge([], [old],context,published,'slots'),[]);
 assert.throws(()=>appendEligibleKnowledge([existing[0],existing[0]],[next],context,published,'slots'),/KNOWLEDGE_CARD_INVALID/);
 assert.throws(()=>appendEligibleKnowledge([],[next],context,published,'slots',new Set(['../bad'])),/INLINE_KNOWLEDGE_HISTORY_INVALID/);
});

test('care and recipes never jump above a geographic tier or override category rounds',()=>{
 const cards=[
  card('city-ordinary',{category:'01000000',geography:area('RO',['683506'])}),
  card('country-recipe',{category:'06000000',format:'recipe',geography:area('RO',[])}),
  card('global-care',{category:'07000000',format:'care'}),
  card('global-ordinary',{category:'13000000'}),
 ];
 const selected=selectInlineKnowledge(cards,context,reviewed,'format-tiers');
 assert.deepEqual(selected.map(item=>item.scope),['city','country','global','global']);
 assert.strictEqual(selected[0].card,cards[0]);assert.strictEqual(selected[1].card,cards[1]);
 const globals=cards.filter(item=>item.geography===undefined);
 assert.deepEqual(selected.slice(2).map(item=>item.card),selectKnowledgeCards(globals,'all',reviewed,'format-tiers',context.timeZone));
});

test('next lifecycle boundary reports publication, expiry and local midnight without rewriting evidence',()=>{
 const scheduled=card('boundary-release',{publishAt:iso(published)});
 assert.equal(nextKnowledgeBoundary([scheduled],reviewed),published);
 assert.equal(nextKnowledgeBoundary([scheduled],published),expires);
 assert.equal(nextKnowledgeBoundary([scheduled],expires),null);
 assert.equal(nextKnowledgeBoundary([],reviewed),null);
 const legacy=card('boundary-legacy');
 assert.equal(nextKnowledgeBoundary([legacy],reviewed-1),reviewed);
 const anniversary=card('boundary-anniversary',{format:'on-this-day',calendarDay:'11-26'});
 const now=Date.parse('2026-11-25T21:30:00.000Z');
 assert.equal(nextKnowledgeBoundary([anniversary],now,'Europe/Bucharest'),Date.parse('2026-11-25T22:00:00.000Z'));
 assert.equal(nextKnowledgeBoundary([anniversary],now,'America/New_York'),Date.parse('2026-11-26T05:00:00.000Z'));
 const beforeExpiry=card('boundary-early-expiry',{format:'on-this-day',calendarDay:'11-25',reviewBy:iso(now+1000)});
 assert.equal(nextKnowledgeBoundary([beforeExpiry],now,'Europe/Bucharest'),now+1000);
 for(const invalid of [NaN,Infinity,8_640_000_000_000_000])assert.throws(()=>nextKnowledgeBoundary([legacy],invalid),/KNOWLEDGE_CONTEXT_INVALID/);
 assert.throws(()=>nextKnowledgeBoundary([legacy],reviewed,'Not/A_TimeZone'),/KNOWLEDGE_TIMEZONE_INVALID/);
});

test('calendar boundaries follow the25-hour autumn day instead of a fixed24-hour timer',()=>{
 const start=Date.parse('2026-10-31T00:00:00.000Z'),end=Date.parse('2026-11-04T00:00:00.000Z');
 const anniversary=card('dst-anniversary',{format:'on-this-day',calendarDay:'11-02',reviewedAt:iso(start),reviewBy:iso(end)});
 const midnight=Date.parse('2026-11-01T04:00:00.000Z');
 assert.equal(nextKnowledgeBoundary([anniversary],midnight,'America/New_York'),Date.parse('2026-11-02T05:00:00.000Z'));
 assert.deepEqual(selectKnowledgeCards([anniversary],'all',midnight,'dst','America/New_York'),[]);
 assert.equal(selectKnowledgeCards([anniversary],'all',Date.parse('2026-11-02T05:00:00.000Z'),'dst','America/New_York').length,1);
});

test('an exposed anniversary keeps its reserved position but stops displaying at local midnight',()=>{
 const anniversary=card('exposed-anniversary',{format:'on-this-day',calendarDay:'11-25'});
 const regular=card('retained-general');
 const beforeMidnight=Date.parse('2026-11-25T21:59:59.999Z'),midnight=beforeMidnight+1;
 const existing=Object.freeze(selectInlineKnowledge([anniversary,regular],context,beforeMidnight,'rollover'));
 const seen=new Set([anniversary.id]),after=appendEligibleKnowledge(existing,[anniversary,regular],context,midnight,'rollover',seen);
 assert.strictEqual(after,existing,'exposure and expiry do not shift the selected slots');
 const event=after.find(item=>item.card.id===anniversary.id),general=after.find(item=>item.card.id===regular.id);
 assert.equal(isInlineKnowledgeCurrent(event,context,beforeMidnight),true);
 assert.equal(isInlineKnowledgeCurrent(event,context,midnight),false,'seen history does not override current calendar applicability');
 assert.equal(isInlineKnowledgeCurrent(general,context,midnight),true);
 const scheduled={card:card('not-published',{publishAt:iso(published)}),scope:'global'};
 assert.equal(isInlineKnowledgeCurrent(scheduled,context,reviewed),false);
 assert.equal(isInlineKnowledgeCurrent(scheduled,context,published),true);
 assert.equal(isInlineKnowledgeCurrent(scheduled,context,expires),false);
 const national={card:card('country-change',{geography:area('RO',[])}),scope:'country'};
 assert.equal(isInlineKnowledgeCurrent(national,{...context,countryCode:'IT'},reviewed),false);
});
