import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NewsReadingState,newsEditionSeed} from '../.build/src/iceo/news-reading-state.js';
import {selectNewsStream,newsStreamPage} from '../.build/src/iceo/news-stream.js';
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

test('late local arrivals cannot reshuffle a visible global prefix between automatic pages',()=>{
 const records=Array.from({length:65},(_,index)=>global(index+1,'ro')),today={first:records.slice(0,30).map(view),more:records.slice(30).map(view)},state=new NewsReadingState();
 const first=state.present(today,[],'ro-city','ro',now),before=selectNewsStream(today,first.local,now,'all',first.seed);
 const local=selectHomeLanguage(localSnapshot(3),city,now,'ro').cards;
 const pending=state.present(today,local,'ro-city','ro',now+1000);
 assert.equal(pending.local.length,0);assert.equal(pending.pending,3);assert.equal(pending.seed,first.seed);
 const next=selectNewsStream(today,pending.local,now+1000,'all',pending.seed);
 assert.deepEqual(newsStreamPage(next,40).slice(0,20),newsStreamPage(before,20));
 assert.deepEqual(next.items.map(item=>item.key),before.items.map(item=>item.key));
 const applied=state.present(today,local,'ro-city','ro',now+1000,true),expanded=selectNewsStream(today,applied.local,now+1000,'all',applied.seed);
 assert.equal(applied.pending,0);assert.equal(applied.local.length,3);assert.equal(expanded.total,68);assert.notEqual(applied.seed,first.seed);
 assert.equal(new Set(expanded.items.map(item=>item.url)).size,68);
});
test('rechecks, category changes and pagination retain the adopted seed and exact original local objects',()=>{
 const today={first:[view(global(100,'ro'))],more:[]},original=selectHomeLanguage(localSnapshot(2),city,now,'ro').cards,state=new NewsReadingState();
 const before=JSON.stringify(original),first=state.present(today,original,'ro','ro',now);
 assert.strictEqual(first.local[0],original[0]);
 const fresh=original.map(card=>Object.freeze({...card,checkedAt:new Date(now+299000).toISOString(),news:{...card.news,checkedAt:new Date(now+299000).toISOString()}}));
 const rechecked=state.present({...today,first:today.first.map(item=>({...item,card:{...item.card,observedAt:new Date(now+299000).toISOString()}}))},fresh,'ro','ro',now+299000);
 assert.equal(rechecked.seed,first.seed);assert.equal(rechecked.pending,0);assert.strictEqual(rechecked.local[0],fresh[0]);
 const retained=state.present(today,[],'ro','ro',now+300100);assert.equal(retained.local.length,2);assert.equal(retained.seed,first.seed);
 const expired=state.present(today,[],'ro','ro',now+599000);assert.equal(expired.local.length,0);assert.equal(expired.seed,first.seed);
 assert.equal(JSON.stringify(original),before);
});
test('changed originals are staged until adoption and never renew the old article check',()=>{
 const today={first:[],more:[]},original=selectHomeLanguage(localSnapshot(1),city,now,'ro').cards[0],state=new NewsReadingState();
 const first=state.present(today,[original],'ro','ro',now);
 const changed={...original,title:'Changed publisher wording',checkedAt:new Date(now+1000).toISOString(),news:{...original.news,title:'Changed publisher wording',documentHash:'f'.repeat(64),checkedAt:new Date(now+1000).toISOString()}};
 const staged=state.present(today,[changed],'ro','ro',now+1000);
 assert.strictEqual(staged.local[0],original);assert.equal(staged.pending,1);assert.equal(staged.seed,first.seed);assert.equal(staged.expiresAt,now+300000);
 const expired=state.present(today,[changed],'ro','ro',now+300000);assert.equal(expired.local.length,0);assert.equal(expired.pending,1);
 const applied=state.present(today,[changed],'ro','ro',now+300000,true);assert.strictEqual(applied.local[0],changed);assert.equal(applied.pending,0);
});
test('empty first acquisition can populate, language/context choices adopt a new edition, and expired/future checks stay excluded',()=>{
 const state=new NewsReadingState(),empty={first:[],more:[]},local=selectHomeLanguage(localSnapshot(1),city,now,'ro').cards;
 const pending=state.present(empty,[],'ro','ro',now);assert.equal(pending.local.length,0);
 const loaded=state.present(empty,local,'ro','ro',now);assert.equal(loaded.local.length,1);
 const en=state.present({first:[view(global(200))],more:[]},[],'en','en',now);assert.equal(en.local.length,0);assert.equal(en.pending,0);assert.notEqual(en.seed,loaded.seed);
 const invalid=local.map(card=>({...card,checkedAt:new Date(now+5001).toISOString()}));
 assert.equal(new NewsReadingState().present(empty,invalid,'ro','ro',now).local.length,0);
 assert.equal(new NewsReadingState().present(empty,local,'ro','ro',now+300000).local.length,0);
});
test('seed material is the visible original edition, excludes check times and remains bounded',()=>{
 const a=global(301),b=global(302),today={first:[view(a)],more:[view(b)]};
 const first=newsEditionSeed(today,[],'en');
 assert.equal(first,newsEditionSeed({first:[view({...b,observedAt:new Date(now+30000).toISOString()})],more:[view(a)]},[],'en'));
 assert.notEqual(first,newsEditionSeed({first:[view({...a,contentHash:'a'.repeat(64)})],more:[view(b)]},[],'en'));
 assert.notEqual(first,newsEditionSeed(today,[],'ro'));assert.ok(first.length<1024);
 const source=readFileSync('src/iceo/browser.ts','utf8');
 assert.match(source,/newsReading.present\(today,local.cards,contextKey,language,now,applyPublicUpdate\)/u);
 assert.match(source,/selectNewsStream\(today,reading.local,now,newsFilter,reading.seed\)/u);
 const compiled=readFileSync('.build/src/iceo/news-reading-state.js','utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'');
 assert.equal(readFileSync('public/news-reading-state.js','utf8'),compiled);
});
