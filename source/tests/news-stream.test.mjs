import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {selectNewsStream,newsStreamPage,observeNewsStream,NEWS_PAGE_SIZE} from '../.build/src/iceo/news-stream.js';
import {NEWS_CATEGORIES} from '../.build/src/iceo/news-taxonomy.js';
import {selectContextualToday} from '../.build/src/iceo/contextual-today.js';
import {selectNewsLanguage} from '../.build/src/iceo/news-sources.js';
import {readingCard} from '../.build/src/iceo/reader.js';
import {selectHomeLanguage} from '../.build/src/iceo/home-local.js';
import {parseLocalNews} from '../.build/src/local/news-service.js';
import {newsCard} from '../.build/src/local/service.js';
import {CITY_NEWS_FEEDS} from '../.build/src/local/news-policy.js';
import {findCity} from '../.build/src/local/cities.js';
const now=Date.parse('2026-11-22T12:00:00.000Z'),checkedAt=new Date(now).toISOString(),city=findCity('683506');
const global=(id,language='en')=>Object.freeze({id:id.toString(16).padStart(24,'0'),identity:'controlled:'+id,title:'Scientists publish research result '+id,topic:'science',kind:'publication',
 sourceUrl:'https://www.dw.com/'+language+'/controlled-research-'+id+'/a-'+(12340000+id),publisher:id%2?'DW':'DW controlled second publisher',sourceIds:['news-science'],
 date:new Date(now-id*1000).toISOString(),dateLabel:'Published',observedAt:checkedAt,contentHash:id.toString(16).padStart(64,'0'),
 boundary:'Controlled test record, not live reporting.',deadline:null,version:null,attribution:'Controlled publisher',sourceState:'verified'});
const view=card=>Object.freeze({...readingCard(card,now),reason:'Controlled current selection.',localMatch:false,grouping:'single'});
function localSnapshot(count=18){
 const source=CITY_NEWS_FEEDS.find(value=>value.id==='bucharest-b365');
 const entries=Array.from({length:count},(_,i)=>'<item><title>Bucuresti: Metrorex publica programul liniei '+(i+1)+'</title><link>https://b365.ro/control-'+(123450+i)+'/</link><pubDate>Sun, 22 Nov 2026 10:00:00 +0000</pubDate><description>Consultati articolul pentru detalii.</description></item>').join('');
 const body='<rss version="2.0"><channel><title>'+source.title+'</title><link>'+source.home+'</link>'+entries+'</channel></rss>';
 const parsed=parseLocalNews(body,source.id,city,checkedAt,now);assert.equal(parsed.articles.length,count);assert.equal(parsed.rejected,0);
 const cards=parsed.articles.map(article=>newsCard(article,city));
 return {version:'dlkt-local-1',city,checkedAt,state:'partial',weatherState:'unavailable',transportState:'not-covered',cards,
 newsSources:CITY_NEWS_FEEDS.map(feed=>({sourceId:feed.id,publisher:feed.publisher,feedUrl:feed.endpoint,termsUrl:feed.termsUrl,state:'ready',checkedAt,count:feed.id===source.id?count:0,rejected:0,error:null}))};
}
test('all original global and local articles survive publisher, category and page boundaries',()=>{
 const records=Array.from({length:95},(_,index)=>global(index+1)),local=selectHomeLanguage(localSnapshot(),city,now,'ro');
 assert.equal(local.cards.length,18);assert.equal(local.supporting.length,0);
 const before=JSON.stringify([records,local.cards]),editorial=[...records.slice(0,6)].reverse().concat(records.slice(6,30)),today={first:editorial.map(view),more:records.slice(30).map(view)};
 const selection=selectNewsStream(today,local.cards,now);assert.equal(selection.total,113);assert.equal(selection.filtered.length,113);
 assert.equal(new Set(selection.items.map(item=>item.url)).size,113);
 assert.equal(selection.highlighted,6);assert.deepEqual(selection.items.slice(0,6).map(item=>item.kind==='global'?item.view.card:null),editorial.slice(0,6));
 assert.ok(selection.items.slice(6).some(item=>item.kind==='global'));assert.ok(selection.items.slice(6).some(item=>item.kind==='local'));
 assert.ok(selection.items.slice(0,20).some(item=>item.kind==='local'));assert.ok(selection.items.slice(0,20).some(item=>item.kind==='global'));
 assert.equal(selection.items.filter(item=>item.kind==='local').length,18);
 let previous=[];for(const count of [20,40,60,80,100,120]){
  const page=newsStreamPage(selection,count);assert.deepEqual(page.slice(0,previous.length),previous);assert.equal(new Set(page.map(item=>item.key)).size,page.length);previous=page;
 }
 assert.equal(previous.length,113);assert.equal(NEWS_PAGE_SIZE,20);
 assert.equal(JSON.stringify([records,local.cards]),before);
 for(const item of selection.items)assert.strictEqual(item.kind==='global'?item.view.card:item.card,item.kind==='global'?records.find(card=>card.id===item.view.card.id):local.cards.find(card=>card.id===item.card.id));
});
test('related reports become individual original articles and only exact article identities are deduplicated',()=>{
 const a=global(201),b=global(202),c=global(203),before=JSON.stringify([a,b,c]);
 const grouped={...view(a),related:[b],grouping:'shared-event',storyKey:'controlled-event'};
 const selection=selectNewsStream({first:[grouped],more:[view(a),view(c)]},[],now);
 assert.equal(selection.total,3);assert.deepEqual(new Set(selection.items.map(item=>item.view.card)),new Set([a,b,c]));
 assert.ok(selection.items.every(item=>item.view.related.length===0&&item.view.grouping==='single'));
 assert.equal(JSON.stringify([a,b,c]),before);
 const local=selectHomeLanguage(localSnapshot(1),city,now,'ro').cards;
 const duplicate={...global(204),sourceUrl:local[0].sourceUrl,identity:local[0].sourceUrl};
 const merged=selectNewsStream({first:[view(duplicate)],more:[]},local,now);assert.equal(merged.total,1);assert.equal(merged.highlighted,1);assert.strictEqual(merged.items[0].view.card,duplicate);
});
test('IPTC category counts cover the whole corpus and filtering never changes source records or available totals',()=>{
 const records=[global(301),global(302),{...global(303),topic:'sport',sourceIds:['news-sport'],title:'Football team wins championship 303'},
 {...global(304),topic:'other',sourceIds:['news-unclassified'],title:'A publication about an unspecified subject'}];
 const today={first:records.map(view),more:[]},all=selectNewsStream(today,[],now);
 assert.equal(NEWS_CATEGORIES.length,17);assert.equal(Object.values(all.counts).reduce((a,b)=>a+b,0),all.total);
 for(const category of [...NEWS_CATEGORIES.map(value=>value.id),'other']){
  const selected=selectNewsStream(today,[],now,category);assert.equal(selected.total,all.total);assert.equal(selected.highlighted,0);
  assert.deepEqual(new Set(selected.items.map(item=>item.key)),new Set(all.items.map(item=>item.key)));
  assert.equal(selected.filtered.length,all.counts[category]);assert.ok(selected.filtered.every(item=>(item.category??'other')===category));
 }
 assert.throws(()=>selectNewsStream(today,[],now,'invented-category'),/NEWS_STREAM_CONTEXT_INVALID/u);
 assert.throws(()=>newsStreamPage(all,0),/NEWS_STREAM_PAGE_INVALID/u);
});
test('native language and freshness remain eligibility gates before the complete stream is paginated',()=>{
 const records=[global(401,'ro'),global(402,'en'),{...global(403,'ro'),date:new Date(now-86_400_000).toISOString()},
 {...global(404,'en'),sourceState:'stale'},{...global(405,'ro'),date:new Date(now+1).toISOString()}];
 const local=localSnapshot(2),context={countryCode:'RO',preferredTopics:[]};
 for(const [language,expectedGlobal,expectedLocal] of [['ro',records[0],2],['en',records[1],0]]){
  const today=selectContextualToday(selectNewsLanguage(records,language),context,now),native=selectHomeLanguage(local,city,now,language);
  const selection=selectNewsStream(today,native.cards,now);assert.equal(selection.total,1+expectedLocal);
  assert.strictEqual(selection.items.find(item=>item.kind==='global').view.card,expectedGlobal);
  assert.equal(selection.items.filter(item=>item.kind==='local').length,expectedLocal);
 }
 assert.equal(selectHomeLanguage(local,city,now+300000,'ro').cards.length,0);
 const expired=selectContextualToday(selectNewsLanguage(records,'ro'),context,now+3_600_000);
 assert.equal(selectNewsStream(expired,[],now+3_600_000).total,0);
});
test('automatic paging observes once, disconnects after advancement and leaves the manual page function available',t=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'IntersectionObserver'),instances=[];
 class Observer {constructor(callback,options){this.callback=callback;this.options=options;this.disconnected=false;instances.push(this);}observe(target){this.target=target;}disconnect(){this.disconnected=true;}}
 Object.defineProperty(globalThis,'IntersectionObserver',{configurable:true,value:Observer});
 t.after(()=>descriptor?Object.defineProperty(globalThis,'IntersectionObserver',descriptor):delete globalThis.IntersectionObserver);
 let pages=0;const sentinel={},stop=observeNewsStream(sentinel,()=>pages++),observer=instances[0];
 assert.equal(observer.target,sentinel);assert.equal(observer.options.rootMargin,'600px 0px');
 observer.callback([{isIntersecting:false}]);assert.equal(pages,0);
 observer.callback([{isIntersecting:true}]);observer.callback([{isIntersecting:true}]);assert.equal(pages,1);assert.equal(observer.disconnected,true);
 stop();
 Object.defineProperty(globalThis,'IntersectionObserver',{configurable:true,value:undefined});
 assert.doesNotThrow(()=>observeNewsStream(sentinel,()=>pages++)());assert.equal(pages,1);
 const selection=selectNewsStream({first:Array.from({length:45},(_,i)=>view(global(500+i))),more:[]},[],now);
 assert.equal(newsStreamPage(selection).length,20);assert.equal(newsStreamPage(selection,40).length,40);assert.equal(newsStreamPage(selection,60).length,45);
});

test('changing the category restores keyboard focus on the replacement select without stealing unrelated focus',()=>{
 const source=readFileSync('.build/src/iceo/browser.js','utf8');
 const registration=source.match(/required\('#discovery-cards'\)\.addEventListener\('change', event => \{[\s\S]*?\n\}\);/u)?.[0];assert.ok(registration);
 const document={activeElement:null};let handler,select,renders=0;
 class Select {constructor(value){this.id='home-news-category';this.value=value;this.focusCount=0;}focus(options){this.focusCount++;this.options=options;document.activeElement=this;}}
 const host={addEventListener(type,callback){assert.equal(type,'change');handler=callback;}};
 const context={document,HTMLSelectElement:Select,NEWS_PAGE_SIZE,isNewsCategoryId:value=>NEWS_CATEGORIES.some(category=>category.id===value),
  required:selector=>selector==='#discovery-cards'?host:selector==='#home-news-category'?select:null,
  renderDiscovery:()=>{renders++;select=new Select(context.newsFilter);if(document.activeElement instanceof Select)document.activeElement=null;}};
 runInNewContext("var newsFilter='all',continuationCount=999;\n"+registration,context);
 const original=new Select(NEWS_CATEGORIES[0].id);document.activeElement=original;handler({target:original});
 assert.equal(renders,1);assert.equal(context.newsFilter,original.value);assert.equal(context.continuationCount,NEWS_PAGE_SIZE);
 assert.equal(document.activeElement,select);assert.equal(select.focusCount,1);assert.equal(select.options.preventScroll,true);
 const programmatic=new Select('other'),unrelated={id:'source-action'};document.activeElement=unrelated;handler({target:programmatic});
 assert.equal(renders,2);assert.equal(select.focusCount,0,'a programmatic change must not focus the picker');assert.equal(document.activeElement,unrelated);
 const before=renders;handler({target:new Select('unknown-category')});assert.equal(renders,before);
});

test('global highlights deduplicate primary reports without promoting related reports or reducing the remaining corpus',()=>{
 const records=Array.from({length:10},(_,index)=>global(700+index)),first=[view(records[4]),view(records[4]),view(records[2]),view(records[8]),view(records[1]),view(records[9]),view(records[0]),view(records[5])];
 const selection=selectNewsStream({first,more:records.map(view)},[],now);
 assert.equal(selection.total,10);assert.equal(selection.highlighted,6);
 assert.deepEqual(selection.items.slice(0,6).map(item=>item.view.card),[records[4],records[2],records[8],records[1],records[9],records[0]]);
 assert.deepEqual(new Set(selection.items.map(item=>item.view.card)),new Set(records));
 const short=selectNewsStream({first:[{...view(records[0]),related:records.slice(1)}],more:[]},[],now);
 assert.equal(short.highlighted,1);assert.equal(short.total,10);assert.strictEqual(short.items[0].view.card,records[0]);
 const local=selectHomeLanguage(localSnapshot(2),city,now,'ro').cards;
 const noGlobal=selectNewsStream({first:[],more:[]},local,now);assert.equal(noGlobal.highlighted,0);assert.equal(noGlobal.total,2);
});
test('home global ranking keeps the reading language but receives no city or topic preference',()=>{
 const source=readFileSync('.build/src/iceo/browser.js','utf8');
 const declaration=source.match(/const language = getLocale\(\), globalContext = \{ countryCode: null, preferredTopics: \[\] \};/u)?.[0];
 const candidate=source.match(/const candidate = snapshot \? selectContextualToday\(selectNewsLanguage\(snapshot.cards, language\), globalContext, now\) : \{ first: \[\], more: \[\] \};/u)?.[0];
 assert.ok(declaration);assert.ok(candidate);
 const snapshot={cards:[global(801,'ro'),global(802,'en')]},calls=[],ranking={first:[],more:[]};
 const context={getLocale:()=> 'ro',snapshot,now,selectNewsLanguage,selectContextualToday:(cards,rankContext,time)=>{calls.push({cards,rankContext,time});return ranking;}};
 runInNewContext(declaration+'\n'+candidate+'\nthis.result = candidate;',context);
 assert.strictEqual(context.result,ranking);assert.deepEqual(calls[0].cards,[snapshot.cards[0]]);assert.equal(calls[0].time,now);
 assert.equal(calls[0].rankContext.countryCode,null);assert.equal(calls[0].rankContext.preferredTopics.length,0);assert.equal('city' in calls[0].rankContext,false);
 assert.match(source,/const contextKey = JSON.stringify\(\[language, context.countryCode, city\?\.id \?\? null, \[\.\.\.interests\]\.sort\(\)\]\);/u);
 assert.match(source,/Selectia globala/u);assert.match(source,/Global selection/u);
});
