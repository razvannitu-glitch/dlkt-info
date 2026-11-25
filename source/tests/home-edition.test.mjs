import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appendPublicEdition,appendPublicContinuation,dailyEditionSummary,publicEditionState} from '../.build/src/iceo/home-edition.js';
import {selectContextualToday} from '../.build/src/iceo/contextual-today.js';
import {PUBLIC_TOPICS} from '../.build/src/iceo/topics.js';
import {PUBLIC_EDITORIAL_CATEGORIES,EDITORIAL_CATEGORY_TOPICS} from '../.build/src/iceo/editorial-categories.js';

// Deterministic DOM and publication fixtures. These are not live articles or a visual test.
class ElementFixture {
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.id='';this.className='';this.textContent='';this.open=false;this.classList={add:value=>{this.className=[this.className,value].filter(Boolean).join(' ');}};}
  append(...nodes){this.children.push(...nodes);}
}
const now=Date.parse('2026-11-20T12:00:00.000Z');
const fixture=(id,patch={})=>({
  id:id.toString(16).padStart(24,'0'),identity:`controlled:${id}`,title:`Controlled publication ${id}`,
  topic:EDITORIAL_CATEGORY_TOPICS[PUBLIC_EDITORIAL_CATEGORIES[id%20]],kind:'publication',
  sourceUrl:`https://globalvoices.org/2026/11/20/controlled-${id}/`,publisher:`Publisher ${id}`,sourceIds:[`news-${PUBLIC_EDITORIAL_CATEGORIES[id%20]}`],
  date:'2026-11-20T10:00:00.000Z',dateLabel:'Published',observedAt:new Date(now).toISOString(),contentHash:id.toString(16).padStart(64,'0'),
  boundary:'Controlled fixture, not real reporting.',deadline:null,version:null,attribution:`Publisher ${id}`,sourceState:'verified',...patch,
});
function render(t,records,{loading=false,failed=false,snapshotState='ready',clock=now,limit=30}={}){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{value:{createElement:tag=>new ElementFixture(tag)},configurable:true});
  t.after(()=>descriptor?Object.defineProperty(globalThis,'document',descriptor):delete globalThis.document);
  const host=new ElementFixture('div');
  const selection=selectContextualToday(records,{countryCode:null,preferredTopics:[],limit},clock);
  const state=publicEditionState(selection,{snapshotState,loading,failed});
  appendPublicEdition(host,selection,(view,index,total)=>{
    const node=new ElementFixture('article');node.className='info-card';node.dataset.cardId=view.card.id;
    node.textContent=view.card.title;node.position=[index,total];return node;
  },state);
  return {host,selection,state};
}
test('the complete fresh stream is reachable in successive pages without repeating the top',t=>{
  const records=Array.from({length:95},(_,index)=>fixture(index+1));
  const {selection}=render(t,records);
  assert.equal(selection.first.length+selection.more.length,95);
  const renderMore=count=>{
    const host=new ElementFixture('div');
    appendPublicContinuation(host,selection,(view,index,total)=>{
      const node=new ElementFixture('article');node.dataset.cardId=view.card.id;node.position=[index,total];return node;
    },count);
    return host;
  };
  const collapsed=renderMore(0);assert.equal(collapsed.children.filter(node=>node.tagName==='article').length,0);
  assert.match(collapsed.children.at(-1).children[0].textContent,/Show 20 more/);
  const page=renderMore(20);const cards=page.children.filter(node=>node.tagName==='article');assert.equal(cards.length,20);
  assert.ok(cards.every(node=>!selection.first.some(view=>view.card.id===node.dataset.cardId)));
  const complete=renderMore(100);assert.equal(complete.children.filter(node=>node.tagName==='article').length,selection.more.length);
  assert.match(complete.children.at(-1).children[0].textContent,/reached the current connected-source selection/);
});
test('all thirty daily cards are directly visible before a finite end, with no collapsed publication list',t=>{
  const records=Array.from({length:60},(_,index)=>fixture(index+1));
  const {host,selection}=render(t,records);
  const visible=host.children.filter(node=>node.tagName==='article');
  assert.equal(visible.length,30);assert.deepEqual(visible.map(node=>node.dataset.cardId),selection.first.map(view=>view.card.id));
  assert.ok(visible.every((node,index)=>node.dataset.editionPart==='first'&&node.position[0]===index&&node.position[1]===30));
  assert.equal(host.children[30].id,'home-edition-end');assert.equal(host.children[30].children[0].textContent,"End of today's top.");
  assert.equal(host.children.filter(node=>node.tagName==='details').length,0);
  assert.equal(new Set(visible.map(node=>node.dataset.cardId)).size,30);assert.equal(host.dataset.dailyCoverage,'ready');
  assert.match(host.children[30].children[1].textContent,/30 selected publications from the last 24 hours · 20 topic groups/);
});
test('a forty-card requested edition also renders all forty directly',t=>{
  const {host}=render(t,Array.from({length:80},(_,index)=>fixture(index+1)),{limit:40});
  assert.equal(host.children.filter(node=>node.tagName==='article').length,40);
  assert.equal(host.children.filter(node=>node.tagName==='details').length,0);
});
test('a sparse selection shows the actual count, minimum shortfall and missing categories',t=>{
  const {host}=render(t,[fixture(1)]),visible=host.children.filter(node=>node.tagName==='article');
  assert.equal(visible.length,1);assert.ok(visible[0].className.includes('today-last'));
  assert.equal(host.dataset.dailyCoverage,'below-minimum');
  const end=host.children.find(node=>node.id==='home-edition-end');
  assert.match(end.children[1].textContent,/1 selected publication from the last 24 hours/);
  assert.match(end.children[1].textContent,/Fewer than 20/);
  assert.match(end.children[2].textContent,/No selected publication in this edition:/);
});
test('a successful zero-record acquisition has a true empty result and no completion claim',t=>{
  const {host,state}=render(t,[]);
  assert.equal(state,'empty');assert.equal(host.children.length,1);
  assert.equal(host.children[0].id,'home-edition-empty');assert.match(host.children[0].textContent,/No current publications from the last 24 hours/);
  assert.match(host.children[0].textContent,/Coverage is incomplete/);assert.doesNotMatch(host.children[0].textContent,/End of today's top/);
});
test('stale and future-dated records yield an eligible empty result, not a fabricated completed edition',t=>{
  const {host}=render(t,[fixture(1,{sourceState:'stale'}),fixture(2,{observedAt:new Date(now-3_600_000).toISOString()}),fixture(3,{date:new Date(now+1).toISOString()})]);
  assert.equal(host.children.length,1);assert.equal(host.children[0].id,'home-edition-empty');
  assert.match(host.children[0].textContent,/No current publications/);assert.doesNotMatch(host.children[0].textContent,/\bcomplete\b|all.clear/);
});
test('pending public acquisition is distinguished from a verified empty selection',t=>{
  const {host,state}=render(t,[],{loading:true,snapshotState:null,failed:true});
  assert.equal(state,'pending');assert.equal(host.children[0].id,'home-edition-pending');assert.match(host.children[0].textContent,/Checking publications/);
  assert.doesNotMatch(host.children[0].textContent,/No current/);
});
test('failed first acquisition is unavailable and offers refresh, never a true empty result',t=>{
  const {host,state}=render(t,[],{snapshotState:null,failed:true});
  assert.equal(state,'unavailable');assert.equal(host.dataset.editionState,'unavailable');
  assert.equal(host.children.length,1);assert.equal(host.children[0].id,'home-edition-unavailable');
  assert.match(host.children[0].textContent,/could not be checked.*Refresh/);
  assert.doesNotMatch(host.children[0].textContent,/No current publications|End of today's top/);
});
test('an unavailable source response does not report a successful empty or completed edition',t=>{
  const {host,state}=render(t,[],{snapshotState:'unavailable'});
  assert.equal(state,'unavailable');assert.equal(host.children.length,1);
  assert.equal(host.children[0].id,'home-edition-unavailable');assert.match(host.children[0].textContent,/not an empty result/);
});
test('a failed refresh retains eligible cards while an expired retained selection is unavailable',t=>{
  const {host,state,selection}=render(t,[fixture(1)],{failed:true});
  assert.equal(state,'ready');assert.equal(host.children.filter(node=>node.tagName==='article').length,1);
  assert.equal(publicEditionState({first:[],more:[]},{snapshotState:'ready',loading:false,failed:true}),'unavailable');
  assert.equal(publicEditionState(selection,{snapshotState:'unavailable',loading:false,failed:false}),'unavailable');
});
test('fresh visible cards survive an in-progress refresh without hiding after five',t=>{
  const {host}=render(t,Array.from({length:25},(_,index)=>fixture(index+1)),{loading:true});
  assert.equal(host.children.filter(node=>node.tagName==='article').length,25);
  assert.equal(host.children.filter(node=>node.tagName==='details').length,0);
});
test('clock expiry removes previously eligible publications instead of retaining a current label',t=>{
  const {host}=render(t,[fixture(1)],{clock:now+3_600_000});
  assert.equal(host.children.filter(node=>node.tagName==='article').length,0);
  assert.equal(host.children[0].id,'home-edition-empty');
});
test('a selection between minimum and target states its target shortfall honestly',()=>{
  const selection=selectContextualToday(Array.from({length:22},(_,index)=>fixture(index+1)),{countryCode:null,preferredTopics:[]},now);
  const copy=dailyEditionSummary(selection);assert.match(copy,/22 selected publications/);assert.match(copy,/Fewer than 30/);assert.doesNotMatch(copy,/Fewer than 20/);
});
test('homepage renders all server-ordered native pages and keeps operational records separate',()=>{
  const source=readFileSync('src/iceo/browser.ts','utf8');
  const body=source.slice(source.indexOf('function renderDiscovery():void'),source.indexOf('// Automatic location and saved choices'));
  assert.match(body,/newsContinuation\.start\(\{language,sourceScope:newsSourceScope,cityId:contextualCity\?\.id\?\?null,filter:newsFilter,/u);
  assert.match(body,/\.\.\.\(contextualCity\?\{city:contextualCity\}:\{\}\)\},restartNewsEdition\)/u);
  assert.match(body,/const server=newsContinuation\.view\(\),visible=continuationItems\(server.items,now\)/u);
  assert.match(body,/total:server.page\?\.total\?\?0,counts:server.page\?\.counts/u);
  assert.match(body,/topCount=server.page\?\.filteredTotal\?\?0/u);
  assert.doesNotMatch(body,/\b(?:selectNewsStream|newsStreamPage|continuationCount)\b/u,'page appends must preserve the server order and totals');
  assert.match(body,/newsReading.present\(today,local.cards,contextKey,language,now,applyPublicUpdate\)/u);
  assert.match(body,/liveEdition.present\(candidate,contextKey,now,applyPublicUpdate,newsReading.hasVisibleLocal\(now\)\)/u);
  assert.match(body,/if\(sentinel&&!server.loading&&\(server.error===null\|\|server.error==='expired'\)&&!server.manualContinuation&&!server.limitReached&&server.canContinue&&server.page\?\.nextCursor\)/u);
  assert.match(body,/observeNewsStream\(sentinel,\(\)=>\{void showNewsPage\(false\);\}\)/u);
  assert.match(body,/showNewsPage\(true\)/u);assert.match(body,/home-news-category/u);
  assert.match(body,/newsCategoryLabel\(category.id,language\)/u);assert.match(body,/stream.counts\[category.id\]/u);
  assert.match(body,/publicEditionState\(today,\{snapshotState:snapshot\?\.state\?\?null,loading:loading\|\|!initialCheckStarted,failed:lastLoadFailed\}\)/u);
  assert.match(body,/retained source checks are not newly verified/u);
  const newsLoop=body.indexOf('for(const entry of interleaveKnowledge(visible,inlineKnowledgeSelection))');
  const localLoop=body.indexOf('local.supporting.forEach(');
  assert.ok(newsLoop>=0&&localLoop>newsLoop,'both rendering paths exist and operational records stay separate from server-ordered news');
  assert.match(body,/selectHomeLanguage\(contextualLocal,contextualCity,now,language\)/u);
  assert.match(body,/selectNewsLanguage\(snapshot.cards,language\)/u);
  assert.match(body,/home-local-heading/u);assert.match(body,/node\.dataset\.homeLocalId=item\.card\.id/u);
  assert.match(body,/aria-busy',String\(loading\|\|newsContinuation.view\(\).loading\)/u);
  assert.match(body,/server.page\?Date.parse\(server.page.expiresAt\):null/u);
  assert.match(body,/nextDailyEditionDelay\(today,now\)/u);
  assert.match(source,/if\(document.visibilityState!=='visible'\)return/u);
  assert.match(source,/clearTimeout\(discoveryExpiry\);clearTimeout\(publicRefreshTimer\)/u);
  assert.match(source,/AbortSignal.timeout\(45000\)/u);
});

test('the individual topic forms expose each of the twenty stable category IDs once',()=>{
  const html=readFileSync('public/iceo.html','utf8');
  for(const name of ['topic','daily-topic']){
    const values=[...html.matchAll(new RegExp(`name="${name}" value="([^"]+)"`,'g'))].map(match=>match[1]);
    assert.equal(values.length,20);assert.deepEqual(new Set(values),new Set(PUBLIC_TOPICS.filter(topic=>topic!=='other')));
  }
});
