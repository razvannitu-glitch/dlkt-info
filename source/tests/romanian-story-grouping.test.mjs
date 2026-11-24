import test from 'node:test';
import assert from 'node:assert/strict';
import {groupStories,storyThreadKey} from '../.build/src/iceo/story-grouping.js';
import {groupStories as browserGroups,storyThreadKey as browserKey} from '../public/story-grouping.js';
import {editionChanges} from '../.build/src/iceo/live-edition.js';
import {NewsPageService} from '../.build/src/iceo/news-page.js';
import {validNewsPage,validNewsStorySourcesPage} from '../.build/src/iceo/news-page-contracts.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {article,epoch,CorpusMemoryStore,hash,CATEGORIES} from './fixtures/news-corpus.mjs';

const NOW=Date.parse('2026-11-23T21:00:00.000Z');
const KEY='reported-penalty-test-writer-key-'.repeat(3);
// Observed titles and canonical URLs, controlled source-check time. No article body is copied.
const observed=[
 {publisher:'Digi24',sourceUrl:'https://www.digi24.ro/stiri/externe/mapamond/o-cantareata-iraniana-si-membrii-trupei-sale-au-primit-74-de-lovituri-de-bici-din-cauza-unui-concert-pe-youtube-4049697',
  title:'O cântăreaţă iraniană şi membrii trupei sale au primit 74 de lovituri de bici din cauza unui concert pe YouTube',date:'2026-11-23T17:01:19.000Z'},
 {publisher:'HotNews.ro',sourceUrl:'https://hotnews.ro/o-cantareata-iraniana-si-membrii-trupei-sale-pedepsiti-cu-74-de-lovituri-de-bici-pentru-un-concert-2412112',
  title:'O cântăreață iraniană și membrii trupei sale, pedepsiți cu 74 de lovituri de bici pentru un concert - HotNews.ro',date:'2026-11-23T20:25:10.000Z'},
 {publisher:'Știrile ProTV',sourceUrl:'https://stirileprotv.ro/stiri/international/o-cantareata-iraniana-a-fost-pedepsita-cu-74-de-lovituri-de-bici-pentru-un-concert-fara-valul-islamic-video.html',
  title:'O cântăreață iraniană a fost pedepsită cu 74 de lovituri de bici pentru un concert fără vălul islamic. VIDEO',date:'2026-11-23T20:17:36.000Z'},
];
function report(index,title,extra={}){
 const sourceUrl='https://www.digi24.ro/stiri/externe/mapamond/controlled-related-report-'+(5000000+index);
 const card={...article(index,{now:NOW,published:NOW-60_000}),sourceUrl,identity:sourceUrl,publisher:'Digi24',topic:'culture',sourceIds:['news-culture'],
  title,attribution:'Source: Digi24. Open the original publication.',...extra};
 card.attribution='Source: '+card.publisher+'. Open the original publication.';
 card.id=hash(card.sourceUrl).slice(0,24);card.identity=card.sourceUrl;
 card.contentHash=hash(cardContent(card));return card;
}
const records=()=>observed.map((item,index)=>report(index+1,item.title,{...item,attribution:'Source: '+item.publisher+'. Open the original publication.'}));
const members=group=>[group.card,...group.related];
const view=group=>({card:group.card,related:group.related,storyKey:group.key,grouping:group.basis});

test('the three observed Romanian penalty reports become one attributed headline group without rewriting originals',()=>{
 const originals=records(),before=JSON.stringify(originals),groups=groupStories(originals);
 assert.equal(groups.length,1);assert.equal(groups[0].basis,'matching-headlines');
 assert.equal(groups[0].related.length,2);
 assert.deepEqual(new Set(members(groups[0])),new Set(originals));
 assert.deepEqual(new Set(members(groups[0]).map(card=>card.publisher)),new Set(['Digi24','HotNews.ro','Știrile ProTV']));
 assert.ok(originals.every(card=>storyThreadKey(card)===groups[0].key));
 assert.equal(browserGroups(originals).length,1);
 for(const card of originals)assert.equal(browserKey(card),storyThreadKey(card),'browser and server use the same event identity');
 assert.equal(JSON.stringify(originals),before);
});

test('the reported-penalty rule is not tied to one artist, country, amount or punishment unit',()=>{
 const pairs=[
  ['Un jurnalist iranian a fost condamnat la 3 ani de inchisoare pentru o postare',
   'Un jurnalist iranian, condamnat la 3 ani de inchisoare pentru o postare'],
  ['O actrita rusa a fost pedepsita cu 20 de lovituri de bici pentru un spectacol',
   'O actrita rusa si membrii echipei sale au primit 20 de lovituri de bici din cauza unui spectacol'],
 ];
 for(const [index,titles] of pairs.entries()){
  const cards=titles.map((title,position)=>report(20+index*2+position,title)),groups=groupStories(cards);
  assert.equal(groups.length,1);assert.equal(groups[0].related.length,1);
  assert.equal(browserKey(cards[0]),storyThreadKey(cards[0]));
 }
});

test('negation, another actor, penalty, cause, place, date or explicit outcome cannot borrow the observed group',()=>{
 const original=records()[0],titles=[
  'O cantareata iraniana a fost pedepsita cu 75 de lovituri de bici pentru un concert',
  'O cantareata rusa a fost pedepsita cu 74 de lovituri de bici pentru un concert',
  'O cantareata iraniana Narges Mohammadi a fost pedepsita cu 74 de lovituri de bici pentru un concert',
  'O alta cantareata iraniana a fost pedepsita cu 74 de lovituri de bici pentru un concert',
  'O cantareata iraniana nu a fost pedepsita cu 74 de lovituri de bici pentru un concert',
  'O cantareata iraniana ar putea primi 74 de lovituri de bici pentru un concert',
  'O cantareata iraniana a fost achitata de pedeapsa cu 74 de lovituri de bici pentru un concert',
  'O cantareata iraniana a fost pedepsita cu 74 de lovituri de bici pentru un protest',
  'O cantareata iraniana a fost pedepsita cu 74 de lovituri de bici pentru un concert la Shiraz',
  'O cantareata iraniana a fost pedepsita cu 74 de lovituri de bici pentru un concert pe Facebook',
  'O cantareata iraniana a fost pedepsita cu 74 de lovituri de bici pentru un concert in 2024',
  'O cantareata iraniana a fost pedepsita cu 7 ani de inchisoare pentru un concert',
  'O cantareata iraniana a fost pedepsita cu 74 de lovituri de bici pentru un concert, sentinta anulata in apel',
  'O cantareata iraniana a fost biciuita cu 74 de lovituri de bici pentru un concert',
  'O cantareata iraniana a fost pedepsita cu 74 de lovituri de bici pentru un concert, pedeapsa executata',
  'Documentar: o cantareata iraniana a fost pedepsita cu 74 de lovituri de bici pentru un concert',
  'O femeie iraniana a fost pedepsita cu 74 de lovituri de bici pentru un concert',
 ];
 for(const [index,title] of titles.entries()){
  const changed=report(100+index,title);
  assert.equal(groupStories([original,changed]).length,2,title);
  assert.notEqual(storyThreadKey(changed),storyThreadKey(original),title);
  assert.equal(browserKey(changed),storyThreadKey(changed));
 }
 const later=report(150,observed[2].title,{date:'2026-11-25T20:17:36.000Z'});
 assert.equal(groupStories([original,later]).length,2,'the fixed time window must not merge another reporting period');
 const left=report(151,observed[0].title,{summary:'Controlled excerpt naming performer A.'});
 const right=report(152,observed[2].title,{summary:'Controlled excerpt naming performer B.'});
 assert.equal(groupStories([left,right]).length,2,'incompatible supplied excerpts remain distinct');
});

test('the semantic key survives representative changes and does not become a new story on refresh',()=>{
 const originals=records(),first=groupStories(originals,(a,b)=>Number(a.id!==originals[0].id)-Number(b.id!==originals[0].id))[0];
 const next=groupStories(originals,(a,b)=>Number(a.id!==originals[2].id)-Number(b.id!==originals[2].id))[0];
 assert.notEqual(first.card.publisher,next.card.publisher);assert.equal(first.key,next.key);
 assert.deepEqual(editionChanges({first:[view(first)],more:[]},{first:[view(next)],more:[]}),{added:0,updated:0,removed:0,total:0});
 const reduced=groupStories(originals.filter(card=>card.id!==first.card.id))[0];
 assert.equal(reduced.key,first.key);
 const changes=editionChanges({first:[view(first)],more:[]},{first:[view(reduced)],more:[]});
 assert.equal(changes.added,0);assert.equal(changes.removed,0);assert.equal(changes.updated,1);
});

test('server pagination, source continuation and a new edition keep one penalty group with every original reachable',async()=>{
 const originals=records(),extra=Array.from({length:3},(_,index)=>report(200+index,observed[index].title,{publisher:observed[index].publisher,
  sourceUrl:index===0?'https://www.digi24.ro/stiri/externe/mapamond/controlled-related-report-6000001'
   :index===1?'https://hotnews.ro/controlled-related-report-6000002':'https://stirileprotv.ro/stiri/international/controlled-related-report-6000003.html'}));
 const fillers=Array.from({length:45},(_,index)=>article(index+900,{now:NOW,category:Object.keys(CATEGORIES)[index%18]}));
 const stored=epoch([...originals,...extra,...fillers],[],{now:NOW}),before=JSON.stringify(stored),store=new CorpusMemoryStore([stored]);
 let current=NOW+1000;const service=new NewsPageService(store,KEY,()=>current),query={language:'ro',sourceScope:'all',cityId:null,filter:'all',cursor:null};
 const items=[];let cursor=null,pageCount=0;
 do{
  const page=await service.read({...query,cursor});pageCount++;assert.ok(pageCount<=4);assert.ok(validNewsPage(page,current));
  assert.equal(page.total,46);assert.equal(page.articleTotal,51);items.push(...page.items);cursor=page.nextCursor;
 }while(cursor);
 assert.equal(items.length,46);assert.equal(new Set(items.map(item=>item.key)).size,46);
 const groups=items.filter(item=>item.story?.sourceTotal===6);assert.equal(groups.length,1);
 const group=groups[0],sources=[{kind:group.kind,card:group.card},...group.story.related];
 cursor=group.story.nextSourcesCursor;assert.ok(cursor);
 while(cursor){
  const page=await service.readSources(cursor);assert.ok(validNewsStorySourcesPage(page,current));
  assert.equal(page.storyKey,group.story.key);assert.equal(page.sourceScope,'all');sources.push(...page.sources);cursor=page.nextCursor;
 }
 assert.equal(sources.length,6);assert.equal(new Set(sources.map(source=>source.card.sourceUrl)).size,6);
 for(const original of originals)assert.ok(sources.some(source=>source.card.sourceUrl===original.sourceUrl));
 assert.equal(JSON.stringify(stored),before);
 const replacement=epoch([...originals,...extra,...fillers].filter(card=>card.id!==group.card.id),[],{now:NOW+2000,id:'2',revision:2});
 store.epochs.set('2',replacement);store.latest='2';current=NOW+3000;
 const refreshed=[];cursor=null;
 do{const page=await service.read({...query,cursor});refreshed.push(...page.items);cursor=page.nextCursor;}while(cursor);
 const next=refreshed.filter(item=>item.story?.sourceTotal===5);
 assert.equal(next.length,1);assert.equal(next[0].story.key,group.story.key);assert.notEqual(next[0].card.id,group.card.id);
});
