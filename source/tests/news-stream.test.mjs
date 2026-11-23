import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {selectNewsStream,newsStreamPage,observeNewsStream,NEWS_PAGE_SIZE} from '../.build/src/iceo/news-stream.js';
import {NEWS_CATEGORIES,newsCategory} from '../.build/src/iceo/news-taxonomy.js';
import {selectContextualToday} from '../.build/src/iceo/contextual-today.js';
import {selectNewsLanguage} from '../.build/src/iceo/news-sources.js';
import {consistentCards} from '../.build/src/iceo/evidence-consistency.js';
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

const subjectTitles=Object.freeze({
 '01000000':'Concert opens a cultural festival',
 '02000000':'Court rules in criminal trial',
 '03000000':'Earthquake damages coastal town',
 '04000000':'Inflation report records price changes',
 '05000000':'Students receive scholarships',
 '06000000':'Wildlife conservation project begins',
 '07000000':'Vaccines reach hospitals',
 '08000000':'Hollywood celebrity announces wedding',
 '09000000':'Workers strike over employment contract',
 '10000000':'Gardening guide for a new season',
 '11000000':'Parliament debates proposal',
 '12000000':'Pope begins pilgrimage',
 '13000000':'Quantum computing research result',
 '14000000':'Human rights monitor releases report',
 '15000000':'Football team wins championship',
 '16000000':'Ceasefire negotiations resume',
 '17000000':'Weather forecast predicts temperatures',
 other:'A publication about an unspecified subject',
});
function subjectRecord(id,category){
 const title=subjectTitles[category];assert.ok(title,'controlled category fixture must be explicit');
 const card=Object.freeze({...global(id),title:title+' '+id,topic:'other',sourceIds:['news-unclassified']});
 assert.equal(newsCategory(card)??'other',category,'fixture must actually represent the intended category');return card;
}
const itemCategory=item=>item.category??'other';
function assertCompleteCycles(items){
 const remaining=new Map();
 for(const item of items){const category=itemCategory(item);remaining.set(category,(remaining.get(category)??0)+1);}
 let offset=0;
 while(offset<items.length){
  const active=[...remaining].filter(([,count])=>count>0).map(([category])=>category);
  const cycle=items.slice(offset,offset+active.length);
  assert.equal(cycle.length,active.length,'each cycle must include all still-available categories');
  assert.deepEqual(new Set(cycle.map(itemCategory)),new Set(active),'no category may repeat before the other active categories appear');
  if(offset>0&&active.length>1)assert.notEqual(itemCategory(items[offset-1]),itemCategory(cycle[0]),'a cycle boundary must use another category when possible');
  for(const item of cycle){const category=itemCategory(item);remaining.set(category,remaining.get(category)-1);}
  offset+=active.length;
 }
 assert.ok([...remaining.values()].every(count=>count===0));
}

test('all original global and local articles survive publisher, category and page boundaries',()=>{
 const records=Array.from({length:95},(_,index)=>global(index+1)),local=selectHomeLanguage(localSnapshot(),city,now,'ro');
 assert.equal(local.cards.length,18);assert.equal(local.supporting.length,0);
 const before=JSON.stringify([records,local.cards]),editorial=[...records.slice(0,6)].reverse().concat(records.slice(6,30)),today={first:editorial.map(view),more:records.slice(30).map(view)};
 const selection=selectNewsStream(today,local.cards,now);assert.equal(selection.total,113);assert.equal(selection.filtered.length,113);
 assert.equal(new Set(selection.items.map(item=>item.url)).size,113);
 assert.equal(selection.highlighted,0);assert.deepEqual(selection.items.filter(item=>item.kind==='global').map(item=>item.view.card),editorial.concat(records.slice(30)));
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
 const merged=selectNewsStream({first:[view(duplicate)],more:[]},local,now);assert.equal(merged.total,1);assert.equal(merged.highlighted,0);assert.strictEqual(merged.items[0].view.card,duplicate);
});
test('IPTC category counts cover the whole corpus and filtering never changes source records or available totals',()=>{
 const records=[global(301),global(302),{...global(303),topic:'sport',sourceIds:['news-sport'],title:'Football team wins championship 303'},
 {...global(304),topic:'other',sourceIds:['news-unclassified'],title:'A publication about an unspecified subject'}];
 const today={first:records.map(view),more:[]},all=selectNewsStream(today,[],now);
 assert.equal(NEWS_CATEGORIES.length,17);assert.equal(Object.values(all.counts).reduce((a,b)=>a+b,0),all.total);
 for(const category of [...NEWS_CATEGORIES.map(value=>value.id),'other']){
  const selected=selectNewsStream(today,[],now,category);assert.equal(selected.total,all.total);assert.equal(selected.highlighted,0);
  assert.deepEqual(selected.items.map(item=>item.key),all.items.map(item=>item.key));
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
 const registration=source.match(/required\('#discovery'\)\.addEventListener\('change', event => \{[\s\S]*?\n\}\);/u)?.[0];assert.ok(registration);
 const document={activeElement:null};let handler,select,renders=0;
 class Select {constructor(value){this.id='home-news-category';this.value=value;this.focusCount=0;}focus(options){this.focusCount++;this.options=options;document.activeElement=this;}}
 const host={addEventListener(type,callback){assert.equal(type,'change');handler=callback;}};
 const context={document,HTMLSelectElement:Select,isNewsCategoryId:value=>NEWS_CATEGORIES.some(category=>category.id===value),
  required:selector=>selector==='#discovery'?host:selector==='#home-news-category'?select:null,
  renderDiscovery:()=>{renders++;select=new Select(context.newsFilter);if(document.activeElement instanceof Select)document.activeElement=null;}};
 runInNewContext("var newsFilter='all';\n"+registration,context);
 const original=new Select(NEWS_CATEGORIES[0].id);document.activeElement=original;handler({target:original});
 assert.equal(renders,1);assert.equal(context.newsFilter,original.value);assert.equal(select.value,original.value,'the replacement picker reflects the selected server category');
 assert.equal(document.activeElement,select);assert.equal(select.focusCount,1);assert.equal(select.options.preventScroll,true);
 const programmatic=new Select('other'),unrelated={id:'source-action'};document.activeElement=unrelated;handler({target:programmatic});
 assert.equal(renders,2);assert.equal(context.newsFilter,'other');assert.equal(select.value,'other');assert.equal(select.focusCount,0,'a programmatic change must not focus the picker');assert.equal(document.activeElement,unrelated);
 const before=renders,previous=select;handler({target:new Select('unknown-category')});assert.equal(renders,before);
 assert.equal(context.newsFilter,'other');assert.strictEqual(select,previous);assert.strictEqual(document.activeElement,unrelated);
});

test('editorial queue relevance and exact deduplication survive without a highlighted prefix',()=>{
 const records=Array.from({length:10},(_,index)=>global(700+index)),first=[view(records[4]),view(records[4]),view(records[2]),view(records[8]),view(records[1]),view(records[9]),view(records[0]),view(records[5])];
 const selection=selectNewsStream({first,more:records.map(view)},[],now);
 assert.equal(selection.total,10);assert.equal(selection.highlighted,0);
 assert.deepEqual(selection.items.map(item=>item.view.card),[records[4],records[2],records[8],records[1],records[9],records[0],records[5],records[3],records[6],records[7]]);
 assert.deepEqual(new Set(selection.items.map(item=>item.view.card)),new Set(records));
 const short=selectNewsStream({first:[{...view(records[0]),related:records.slice(1)}],more:[]},[],now);
 assert.equal(short.highlighted,0);assert.equal(short.total,10);assert.strictEqual(short.items[0].view.card,records[0]);
 const local=selectHomeLanguage(localSnapshot(2),city,now,'ro').cards;
 const noGlobal=selectNewsStream({first:[],more:[]},local,now);assert.equal(noGlobal.highlighted,0);assert.equal(noGlobal.total,2);
});
test('home global selection uses explicit source scope without city or topic bias',()=>{
 const source=readFileSync('.build/src/iceo/browser.js','utf8');
 const declaration=source.match(/const language = getLocale\(\), globalContext = \{ countryCode: null, preferredTopics: \[\] \};/u)?.[0];
 const candidate=source.match(/const candidate = snapshot \? selectContextualToday\(newsSourceScope === 'all' \? consistentCards\(snapshot.cards\) : selectNewsLanguage\(snapshot.cards, language\), globalContext, now\) : \{ first: \[\], more: \[\] \};/u)?.[0];
 assert.ok(declaration);assert.ok(candidate);
 const snapshot={cards:[global(801,'ro'),global(802,'en')]},ranking={first:[],more:[]};
 for(const newsSourceScope of ['all','edition']){
  const calls=[],context={getLocale:()=> 'ro',newsSourceScope,snapshot,now,selectNewsLanguage,consistentCards,selectContextualToday:(cards,rankContext,time)=>{calls.push({cards,rankContext,time});return ranking;}};
  runInNewContext(declaration+'\n'+candidate+'\nthis.result = candidate;',context);
  assert.strictEqual(context.result,ranking);assert.deepEqual(calls[0].cards,newsSourceScope==='all'?snapshot.cards:[snapshot.cards[0]]);assert.equal(calls[0].time,now);
  assert.equal(calls[0].rankContext.countryCode,null);assert.equal(calls[0].rankContext.preferredTopics.length,0);assert.equal('city' in calls[0].rankContext,false);
 }
 assert.match(source,/const contextKey = JSON.stringify\(\[language, newsSourceScope, context.countryCode, city\?\.id \?\? null, newsPeriod, \[\.\.\.interests\]\.sort\(\)\]\);/u);
 assert.doesNotMatch(source,/Selectia globala/u);assert.doesNotMatch(source,/Global selection/u);
});


test('all 17 categories and Other cycle from the first article without a six-report exemption or a page reset',()=>{
 const categories=[...NEWS_CATEGORIES.map(category=>category.id),'other'];
 const records=categories.flatMap((category,index)=>Array.from({length:4},(_,position)=>subjectRecord(1000+index*4+position,category)));
 const today={first:records.slice(0,6).map(view),more:records.slice(6).map(view)};
 const selection=selectNewsStream(today,[],now,'all','edition:all-subjects:ro');
 assert.equal(selection.total,72);assert.equal(selection.highlighted,0);assertCompleteCycles(selection.items);
 assert.deepEqual(new Set(selection.items.map(item=>item.view.card)),new Set(records));
 assert.equal(new Set(selection.items.slice(0,6).map(itemCategory)).size,6,'the formerly highlighted first six must also obey the cycles');
 assert.equal(new Set(selection.items.slice(0,18).map(itemCategory)).size,18);
 const cycleOrders=Array.from({length:4},(_,index)=>selection.items.slice(index*18,(index+1)*18).map(itemCategory).join(','));
 assert.ok(new Set(cycleOrders).size>1,'later complete cycles receive their own seeded shuffle');
 let previous=[];
 for(const visible of [20,40,60,80]){
  const page=newsStreamPage(selection,visible);
  assert.deepEqual(page.slice(0,previous.length),previous,'append retains every already-visible position');
  assert.deepEqual(page,selection.items.slice(0,visible),'pagination cannot restart or reshuffle a category cycle');
  previous=page;
 }
 assert.equal(previous.length,72);
 assert.equal(new Set(newsStreamPage(selection,40).slice(18,36).map(itemCategory)).size,18,'the second cycle continues across the first 20-item page boundary');
 for(const category of categories){
  assert.equal(selection.counts[category],4);
  assert.deepEqual(selection.items.filter(item=>itemCategory(item)===category).map(item=>item.view.card),records.filter(card=>(newsCategory(card)??'other')===category));
 }
});
test('uneven and exhausted categories keep every article and preserve editorial relevance through the one-category tail',()=>{
 const science=Array.from({length:45},(_,index)=>subjectRecord(2000+index,'13000000')).reverse();
 const sport=Array.from({length:4},(_,index)=>subjectRecord(2100+index,'15000000'));
 const weather=Array.from({length:2},(_,index)=>subjectRecord(2200+index,'17000000'));
 const other=Array.from({length:3},(_,index)=>subjectRecord(2300+index,'other'));
 const records=[...science,...sport,...weather,...other],today={first:science.slice(0,6).map(view),more:records.slice(6).map(view)};
 const before=JSON.stringify(records);
 for(const seed of ['edition:uneven:a','edition:uneven:b','edition:uneven:c']){
  const selection=selectNewsStream(today,[],now,'all',seed);
  assert.equal(selection.total,54);assertCompleteCycles(selection.items);
  assert.deepEqual(new Set(selection.items.map(item=>item.view.card)),new Set(records));
  assert.deepEqual(selection.items.filter(item=>item.category==='13000000').map(item=>item.view.card),science,'editorial relevance outranks recency or publisher rotation within a category');
  assert.equal(selection.items.slice(-41).filter(item=>item.category==='13000000').length,41,'the only remaining category must not be discarded to avoid an unavoidable repeat');
  const filtered=selectNewsStream(today,[],now,'13000000',seed);
  assert.deepEqual(filtered.items.map(item=>item.key),selection.items.map(item=>item.key));
  assert.deepEqual(filtered.filtered.map(item=>item.view.card),science);
  assert.equal(newsStreamPage(filtered,20).length,20);assert.equal(newsStreamPage(filtered,40).length,40);assert.equal(newsStreamPage(filtered,60).length,45);
 }
 assert.equal(JSON.stringify(records),before);
});
test('a fixed edition seed is independent of render time and filtering while another seed changes only category order',()=>{
 const categories=['02000000','05000000','13000000','15000000','17000000','other'];
 const records=categories.flatMap((category,index)=>Array.from({length:5},(_,position)=>subjectRecord(3000+index*5+position,category)));
 const today={first:records.slice(0,6).map(view),more:records.slice(6).map(view)},seed='edition:fixed-digest:ro';
 const original=selectNewsStream(today,[],now,'all',seed),keys=original.items.map(item=>item.key);
 const expectedRecords=new Set(records),orders=new Set();
 for(let index=0;index<12;index++){
  const rerendered=selectNewsStream(today,[],now+index*1000,'all',seed);
  assert.deepEqual(rerendered.items.map(item=>item.key),keys);
  assert.deepEqual(newsStreamPage(rerendered,40).slice(0,20).map(item=>item.key),newsStreamPage(original,20).map(item=>item.key));
  const changed=selectNewsStream(today,[],now,'all','edition:alternate:'+index);
  assertCompleteCycles(changed.items);assert.deepEqual(new Set(changed.items.map(item=>item.view.card)),expectedRecords);
  orders.add(changed.items.map(itemCategory).join(','));
  for(const category of categories)assert.deepEqual(changed.items.filter(item=>itemCategory(item)===category).map(item=>item.key),original.items.filter(item=>itemCategory(item)===category).map(item=>item.key));
 }
 assert.ok(orders.size>1,'the supplied seed must affect category order');
 for(const filter of categories){
  const selected=selectNewsStream(today,[],now,filter,seed);
  assert.deepEqual(selected.items.map(item=>item.key),keys);
  assert.deepEqual(selected.filtered.map(item=>item.key),original.items.filter(item=>itemCategory(item)===filter).map(item=>item.key));
 }
 const defaultSeed=selectNewsStream(today,[],now);
 assert.deepEqual(defaultSeed.items.map(item=>item.key),selectNewsStream(today,[],now+1000).items.map(item=>item.key));
 for(const invalid of ['', '   ', 'x'.repeat(1025),null,42])assert.throws(()=>selectNewsStream(today,[],now,'all',invalid),/NEWS_STREAM_CONTEXT_INVALID/u);
 assert.throws(()=>selectNewsStream(today,[],Number.NaN,'all',seed),/NEWS_STREAM_CONTEXT_INVALID/u);
});
test('empty editions, single categories and exact duplicates stay complete without artificial category slots',()=>{
 const empty=selectNewsStream({first:[],more:[]},[],now,'all','edition:empty');
 assert.equal(empty.total,0);assert.deepEqual(empty.items,[]);assert.deepEqual(newsStreamPage(empty),[]);assert.equal(Object.values(empty.counts).reduce((a,b)=>a+b,0),0);
 const records=Array.from({length:47},(_,index)=>subjectRecord(4000+index,'other')).reverse();
 const duplicateId={...subjectRecord(4100,'other'),id:records[0].id},duplicateIdentity={...subjectRecord(4101,'other'),identity:records[1].identity},duplicateUrl={...subjectRecord(4102,'other'),sourceUrl:records[2].sourceUrl};
 const today={first:records.slice(0,6).map(view),more:[...records.slice(6),duplicateId,duplicateIdentity,duplicateUrl].map(view)};
 const selection=selectNewsStream(today,[],now,'all','edition:one-category');
 assert.equal(selection.total,47);assert.equal(selection.counts.other,47);assertCompleteCycles(selection.items);
 assert.deepEqual(selection.items.map(item=>item.view.card),records);
 assert.deepEqual(newsStreamPage(selection,60).map(item=>item.view.card),records);
 assert.deepEqual(selectNewsStream(today,[],now,'other','edition:another-seed').filtered.map(item=>item.view.card),records);
});
