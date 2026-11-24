import test from 'node:test';
import assert from 'node:assert/strict';
import {groupStories,storyThreadKey} from '../.build/src/iceo/story-grouping.js';
import {groupStories as browserGroups,storyThreadKey as browserKey} from '../public/story-grouping.js';
import {contextFromPublisherCategories} from '../.build/src/iceo/context.js';
import {editionChanges} from '../.build/src/iceo/live-edition.js';
import {NewsPageService} from '../.build/src/iceo/news-page.js';
import {validNewsPage,validNewsStorySourcesPage} from '../.build/src/iceo/news-page-contracts.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {article,epoch,CorpusMemoryStore,hash} from './fixtures/news-corpus.mjs';

const NOW=Date.parse('2026-11-24T19:00:00.000Z');
const KEY='publisher-headline-fixture-writer-key-'.repeat(3);
const HEADLINE='Elevii pot consulta rezultatele examenelor nationale pe platforma oficiala a ministerului';
function record(id,title=HEADLINE,{publisher='Digi24',sourceUrl='https://www.digi24.ro/stiri/actualitate/educatie/controlled-publication-'+(5000000+id),...extra}={}){
 const card={...article(id,{now:NOW,published:NOW-60000}),title,publisher,sourceUrl,identity:sourceUrl,...extra};
 card.id=hash(card.identity).slice(0,24);card.attribution='Source: '+publisher+'. Open the original publication.';
 card.contentHash=hash(cardContent(card));return card;
}
const hotnews=(id,title=HEADLINE+' - HotNews.ro',extra={})=>record(id,title,{publisher:'HotNews.ro',sourceUrl:'https://hotnews.ro/controlled-publication-'+(5000000+id),...extra});
const members=group=>[group.card,...group.related];
const view=group=>({card:group.card,related:group.related,storyKey:group.key,grouping:group.basis});

test('an informative headline and the verified publisher suffix produce one group with every original unchanged',()=>{
 const first=record(1),expected=storyThreadKey(first);
 for(const suffix of [' - HotNews.ro',' – HotNews.ro',' — HotNews.ro',' | HotNews.ro']){
  const second=hotnews(2,HEADLINE+suffix),originals=[first,second],before=JSON.stringify(originals);
  const grouped=groupStories(originals);assert.equal(grouped.length,1,suffix);assert.equal(grouped[0].basis,'matching-headlines');
  assert.equal(grouped[0].key,expected);assert.deepEqual(new Set(members(grouped[0])),new Set(originals));
  assert.equal(storyThreadKey(second),expected);assert.equal(browserGroups(originals).length,1);assert.equal(browserKey(second),expected);
  assert.equal(JSON.stringify(originals),before,'displayed titles, hashes, URLs and timestamps remain original');
 }
});
test('publisher identity, canonical origin and separated terminal placement bound the comparison exception',()=>{
 const first=record(1);
 const distinct=[
  hotnews(2,HEADLINE+' - Digi24'),
  hotnews(3,HEADLINE+'HotNews.ro'),
  hotnews(4,HEADLINE+' - HotNews.ro: analiza noua'),
  hotnews(5,HEADLINE+' - HotNews.ro',{publisher:'Digi24'}),
  hotnews(6,HEADLINE+' - HotNews.ro',{sourceUrl:'https://hotnews.ro.attacker.invalid/controlled-publication-5000006'}),
  hotnews(7,HEADLINE+' - HotNews.ro',{sourceUrl:'http://hotnews.ro/controlled-publication-5000007'}),
  hotnews(8,HEADLINE+' - HotNews.ro',{sourceUrl:'https://user@hotnews.ro/controlled-publication-5000008'}),
  hotnews(9,HEADLINE+' - HotNews.ro',{sourceUrl:'https://hotnews.ro/'}),
 ];
 for(const changed of distinct){assert.equal(groupStories([first,changed]).length,2,changed.sourceUrl+' '+changed.title);assert.notEqual(storyThreadKey(first),storyThreadKey(changed));}
});
test('the publisher label cannot make a short generic headline informative enough to merge',()=>{
 const title='Rezultatele examenelor vor fi publicate maine - HotNews.ro';
 const first=hotnews(10,title),second=hotnews(11,title);
 assert.equal(groupStories([first,second]).length,2);assert.equal(storyThreadKey(first),null);assert.equal(browserKey(first),null);
});
test('headline suffix normalization preserves differing claims, numbers, summaries, geography and reporting windows',()=>{
 const gb=contextFromPublisherCategories('gv-world',['United Kingdom']),jp=contextFromPublisherCategories('gv-world',['Japan']);
 assert.ok(gb);assert.ok(jp);
 const pairs=[
  [record(20),hotnews(21,HEADLINE.replace('pot consulta','nu pot consulta')+' - HotNews.ro')],
  [record(22,HEADLINE+' pentru 12 judete'),hotnews(23,HEADLINE+' pentru 24 judete - HotNews.ro')],
  [record(24,HEADLINE,{summary:'Rezultatele sunt definitive.'}),hotnews(25,HEADLINE+' - HotNews.ro',{summary:'Rezultatele nu sunt definitive.'})],
  [record(26,HEADLINE,{context:gb,sourceIds:['gv-world']}),hotnews(27,HEADLINE+' - HotNews.ro',{context:jp,sourceIds:['gv-world']})],
  [record(28),hotnews(29,HEADLINE+' - HotNews.ro',{date:'2026-11-20T18:59:00.000Z'})],
 ];
 for(const pair of pairs){assert.equal(groupStories(pair).length,2);assert.notEqual(storyThreadKey(pair[0]),storyThreadKey(pair[1]));assert.equal(browserKey(pair[1]),storyThreadKey(pair[1]));}
});
test('representative changes and source ordering retain one story identity without fresh-story notifications',()=>{
 const originals=[record(30),hotnews(31)],before=JSON.stringify(originals);
 const first=groupStories(originals,(a,b)=>Number(a===originals[1])-Number(b===originals[1]))[0];
 const second=groupStories([...originals].reverse(),(a,b)=>Number(a===originals[0])-Number(b===originals[0]))[0];
 assert.notEqual(first.card.publisher,second.card.publisher);assert.equal(first.key,second.key);
 assert.deepEqual(editionChanges({first:[view(first)],more:[]},{first:[view(second)],more:[]}),{added:0,updated:0,removed:0,total:0});
 assert.equal(storyThreadKey(originals[1]),groupStories([originals[1]])[0].key);
 assert.equal(JSON.stringify(originals),before);
});
test('public pagination and source continuation expose one normalized headline with all six originals',async()=>{
 const originals=Array.from({length:6},(_,index)=>index%2?hotnews(50+index):record(50+index));
 const fillers=Array.from({length:24},(_,index)=>record(100+index,'Autoritatile publica rezultatele controlului tehnic pentru proiectul distinct cu numarul '+index));
 const stored=epoch([...originals,...fillers],[],{now:NOW}),before=JSON.stringify(stored),store=new CorpusMemoryStore([stored]);
 let current=NOW+1000;const service=new NewsPageService(store,KEY,()=>current),query={language:'ro',sourceScope:'all',cityId:null,filter:'all',cursor:null};
 const items=[];let cursor=null,count=0;
 do{
  const page=await service.read({...query,cursor});assert.ok(validNewsPage(page,current));assert.ok(++count<=3);
  assert.equal(page.total,25);assert.equal(page.articleTotal,30);items.push(...page.items);cursor=page.nextCursor;
 }while(cursor);
 assert.equal(items.length,25);assert.equal(new Set(items.map(item=>item.key)).size,25);
 const matched=items.filter(item=>item.story?.sourceTotal===6);assert.equal(matched.length,1);
 const grouped=matched[0],sources=[{kind:grouped.kind,card:grouped.card},...grouped.story.related];
 cursor=grouped.story.nextSourcesCursor;assert.ok(cursor);
 while(cursor){const page=await service.readSources(cursor);assert.ok(validNewsStorySourcesPage(page,current));assert.equal(page.storyKey,grouped.story.key);sources.push(...page.sources);cursor=page.nextCursor;}
 assert.equal(sources.length,6);assert.deepEqual(new Set(sources.map(source=>source.card.sourceUrl)),new Set(originals.map(card=>card.sourceUrl)));
 assert.equal(JSON.stringify(stored),before);
 const replacement=epoch([...originals,...fillers].filter(card=>card.id!==grouped.card.id),[],{now:NOW+2000,id:'2',revision:2});
 store.epochs.set('2',replacement);store.latest='2';current=NOW+3000;
 const next=[];cursor=null;count=0;
 do{const page=await service.read({...query,cursor});assert.ok(++count<=3);assert.equal(page.total,25);next.push(...page.items);cursor=page.nextCursor;}while(cursor);
 const changed=next.filter(item=>item.story?.sourceTotal===5);assert.equal(changed.length,1);assert.equal(changed[0].story.key,grouped.story.key);
 assert.notEqual(changed[0].card.id,grouped.card.id);
});
