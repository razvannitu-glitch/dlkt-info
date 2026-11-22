import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {NewsReadingState,newsEditionSeed} from '../.build/src/iceo/news-reading-state.js';
import {selectNewsStream,newsStreamPage} from '../.build/src/iceo/news-stream.js';
import {continuationItems} from '../.build/src/iceo/news-continuation.js';
import {readingCard} from '../.build/src/iceo/reader.js';
import {LiveEdition} from '../.build/src/iceo/live-edition.js';
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
function localSnapshot(count=18,published='Sun, 22 Nov 2026 10:00:00 +0000'){
 const source=CITY_NEWS_FEEDS.find(value=>value.id==='bucharest-b365');
 const entries=Array.from({length:count},(_,i)=>'<item><title>Bucuresti: Metrorex publica programul liniei '+(i+1)+'</title><link>https://b365.ro/control-'+(123450+i)+'/</link><pubDate>'+published+'</pubDate><description>Consultati articolul pentru detalii.</description></item>').join('');
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
 const fresh=original.map(card=>newsCard({...card.news,documentHash:'e'.repeat(64),checkedAt:new Date(now+299000).toISOString(),validUntil:new Date(now+599000).toISOString()},city));
 const rechecked=state.present({...today,first:today.first.map(item=>({...item,card:{...item.card,observedAt:new Date(now+299000).toISOString()}}))},fresh,'ro','ro',now+299000);
 assert.equal(rechecked.seed,first.seed);assert.equal(rechecked.pending,0);assert.strictEqual(rechecked.local[0],fresh[0]);
 const retained=state.present(today,[],'ro','ro',now+300100);assert.equal(retained.local.length,2);assert.equal(retained.seed,first.seed);
 const expired=state.present(today,[],'ro','ro',now+599000);assert.equal(expired.local.length,0);assert.equal(expired.seed,first.seed);
 assert.equal(JSON.stringify(original),before);
});
test('changed originals are staged until adoption and never renew the old article check',()=>{
 const today={first:[],more:[]},original=selectHomeLanguage(localSnapshot(1),city,now,'ro').cards[0],state=new NewsReadingState();
 const first=state.present(today,[original],'ro','ro',now);
 const changed=newsCard({...original.news,title:'Bucuresti: Metrorex actualizeaza programul liniei 1',documentHash:'f'.repeat(64),checkedAt:new Date(now+1000).toISOString(),validUntil:new Date(now+301000).toISOString()},city);
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
test('source-edition seed stays bounded while the homepage preserves the server page sequence',()=>{
 const a=global(301),b=global(302),today={first:[view(a)],more:[view(b)]};
 const first=newsEditionSeed(today,[],'en');
 assert.equal(first,newsEditionSeed({first:[view({...b,observedAt:new Date(now+30000).toISOString()})],more:[view(a)]},[],'en'));
 assert.notEqual(first,newsEditionSeed({first:[view({...a,contentHash:'a'.repeat(64)})],more:[view(b)]},[],'en'));
 assert.notEqual(first,newsEditionSeed(today,[],'ro'));assert.ok(first.length<1024);
 const source=readFileSync('src/iceo/browser.ts','utf8');
 assert.match(source,/newsReading.present\(today,local.cards,contextKey,language,now,applyPublicUpdate\)/u);
 assert.match(source,/visible=continuationItems\(server.items,now\)/u);
 assert.doesNotMatch(source,/\bselectNewsStream\(/u,'the homepage must not reshuffle the server edition');
 const serverItems=[{kind:'global',key:'article:'+b.id,category:'13000000',card:b},{kind:'global',key:'article:'+a.id,category:'13000000',card:a}];
 const original=JSON.stringify(serverItems),initial=continuationItems(serverItems,now);
 assert.deepEqual(initial.map(item=>item.key),serverItems.map(item=>item.key),'the server sequence survives the presentation adapter');
 initial.forEach((item,index)=>{assert.strictEqual(item.view.card,serverItems[index].card);assert.equal(item.category,serverItems[index].category);});
 const c=global(303),extended=continuationItems([...serverItems,{kind:'global',key:'article:'+c.id,category:'13000000',card:c}],now+1000);
 assert.deepEqual(extended.slice(0,initial.length).map(item=>item.key),initial.map(item=>item.key),'append cannot alter the visible prefix');
 extended.slice(0,initial.length).forEach((item,index)=>assert.strictEqual(item.view.card,initial[index].view.card));
 assert.equal(JSON.stringify(serverItems),original,'original records and hashes remain unchanged');
 const compiled=readFileSync('.build/src/iceo/news-reading-state.js','utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll("'../local/news-policy.js'","'./local-news-policy.js'");
 assert.equal(readFileSync('public/news-reading-state.js','utf8'),compiled);
});

test('local reports aged48hours and exactly72hours remain eligible with the existing72hour boundary',()=>{
 const empty={first:[],more:[]},fortyEight=selectHomeLanguage(localSnapshot(1,'Fri, 20 Nov 2026 12:00:00 +0000'),city,now,'ro').cards;
 assert.equal(fortyEight.length,1);const recent=new NewsReadingState().present(empty,fortyEight,'ro','ro',now);
 assert.strictEqual(recent.local[0],fortyEight[0]);assert.equal(selectNewsStream(empty,recent.local,now,'all',recent.seed).total,1);
 const seventyTwo=selectHomeLanguage(localSnapshot(1,'Thu, 19 Nov 2026 12:00:00 +0000'),city,now,'ro').cards;
 assert.equal(seventyTwo.length,1);const state=new NewsReadingState(),edge=state.present(empty,seventyTwo,'ro','ro',now);
 assert.strictEqual(edge.local[0],seventyTwo[0]);assert.equal(edge.expiresAt,now+1);
 const expired=state.present(empty,seventyTwo,'ro','ro',now+1);assert.equal(expired.local.length,0);assert.equal(expired.expiresAt,null);
});
test('a first global response arriving after visible local news stays staged until Show updates',()=>{
 const local=selectHomeLanguage(localSnapshot(3),city,now,'ro').cards,empty={first:[],more:[]},live=new LiveEdition(),state=new NewsReadingState();
 const initial=live.present(empty,'ro',now),reading=state.present(initial.selection,local,'ro','ro',now);
 assert.equal(state.hasVisibleLocal(now),true);
 const before=selectNewsStream(initial.selection,reading.local,now,'all',reading.seed),candidate={first:[view(global(402,'ro'))],more:[]};
 const staged=live.present(candidate,'ro',now+1000,false,state.hasVisibleLocal(now+1000));
 assert.equal(staged.selection.first.length,0);assert.equal(staged.changes.added,1);
 const stable=state.present(staged.selection,local,'ro','ro',now+1000),same=selectNewsStream(staged.selection,stable.local,now+1000,'all',stable.seed);
 assert.deepEqual(same.items.map(item=>item.key),before.items.map(item=>item.key));assert.equal(stable.seed,reading.seed);
 const accepted=live.present(candidate,'ro',now+1000,true,state.hasVisibleLocal(now+1000));
 const updated=state.present(accepted.selection,local,'ro','ro',now+1000,true);
 assert.equal(selectNewsStream(accepted.selection,updated.local,now+1000,'all',updated.seed).total,4);assert.equal(accepted.changes.total,0);
});

test('a changed RSS hash refreshes unchanged originals and stages only the added article',()=>{
 const empty={first:[],more:[]},first=selectHomeLanguage(localSnapshot(1),city,now,'ro').cards;
 const incoming=selectHomeLanguage(localSnapshot(2),city,now,'ro').cards.map(card=>newsCard({...card.news,checkedAt:new Date(now+299000).toISOString(),validUntil:new Date(now+599000).toISOString()},city));
 const same=incoming.find(card=>card.id===first[0].id);assert.ok(same);assert.notEqual(same.news.documentHash,first[0].news.documentHash);
 assert.equal(same.title,first[0].title);assert.equal(same.sourceUrl,first[0].sourceUrl);
 const state=new NewsReadingState(),initial=state.present(empty,first,'ro','ro',now),updated=state.present(empty,incoming,'ro','ro',now+299000);
 assert.equal(updated.local.length,1);assert.strictEqual(updated.local[0],same);assert.equal(updated.pending,1);assert.equal(updated.seed,initial.seed);
 const retained=state.present(empty,incoming,'ro','ro',now+300100);
 assert.strictEqual(retained.local[0],same);assert.equal(retained.pending,1);assert.equal(retained.expiresAt,now+599000);
});

test('the real startup load stages its first200 after local news is already readable, while manual refresh adopts it',async()=>{
 const source=readFileSync('.build/src/iceo/browser.js','utf8'),start=source.indexOf('async function load('),end=source.indexOf('/** Reuse unchanged article nodes',start);
 assert.ok(start>=0&&end>start);
 const startup=source.match(/if\s*\(!organizationPreview\)\s*void load\(false, false\);/u)?.[0];assert.ok(startup,'startup must not imply an explicit acceptance');
 const live=new LiveEdition(),state=new NewsReadingState();let local=[],shown,reading,resolveInitial,requests=0,renders=0,checks=0;
 const value={generatedAt:checkedAt,state:'partial',cards:[global(501,'ro')],sources:[]};
 const response={status:200,ok:true,headers:{get:()=>null},json:async()=>value};
 const initial=new Promise(resolve=>{resolveInitial=resolve;});
 const draw=()=>{
  const candidate={first:(context.snapshot?.cards??[]).map(view),more:[]};
  shown=live.present(candidate,'ro',now,context.applyPublicUpdate,state.hasVisibleLocal(now));
  reading=state.present(shown.selection,local,'ro','ro',now,context.applyPublicUpdate);context.applyPublicUpdate=false;
 };
 const context={loading:false,publicRefreshTimer:undefined,lastPublicCheckAttempt:0,initialCheckStarted:false,automaticPublicLoad:false,refresh:{disabled:false},
  briefing:{setAttribute(){}},status:{textContent:''},savedView:false,publicEtag:null,snapshot:null,lastLoadFailed:true,lastLoadRegressed:false,
  publicRefreshFailures:0,applyPublicUpdate:false,changesView:false,organizationPreview:false,
  discoveryLoading:{begin(){},finish(){}},Date:class extends Date{static now(){return now;}},clearTimeout(){},
  AbortSignal:{timeout(ms){assert.equal(ms,45000);return {timeout:ms};}},
  fetch:async(url,options)=>{assert.equal(url,'/api/iceo');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-cache');requests++;return requests===1?initial:response;},
  valid:incoming=>{assert.strictEqual(incoming,value);return true;},snapshotProgress:{accept(incoming,at){assert.strictEqual(incoming,value);assert.equal(at,now);checks++;return 'accepted';}},
  renderDiscovery:draw,render:()=>{renders++;draw();},renderHealth(){},savedCards(){},memoryControls(){},schedulePublicRefresh(){},
 };
 runInNewContext(source.slice(start,end)+'\n'+startup.replace('void load(', 'this.pendingLoad = load('),context);
 assert.equal(context.loading,true);assert.equal(requests,1);
 local=selectHomeLanguage(localSnapshot(3),city,now,'ro').cards;draw();
 const first=selectNewsStream(shown.selection,reading.local,now,'all',reading.seed),seed=reading.seed;assert.equal(first.total,3);
 resolveInitial(response);await context.pendingLoad;
 assert.equal(context.loading,false);assert.equal(checks,1);assert.equal(renders,1,'startup still renders restored reader views');
 assert.equal(shown.selection.first.length,0);assert.equal(shown.changes.added,1);assert.equal(reading.seed,seed);
 assert.deepEqual(selectNewsStream(shown.selection,reading.local,now,'all',reading.seed).items.map(item=>item.key),first.items.map(item=>item.key));
 await context.load();
 assert.equal(requests,2);assert.equal(checks,2);assert.equal(renders,2);assert.equal(shown.changes.total,0);
 assert.equal(selectNewsStream(shown.selection,reading.local,now,'all',reading.seed).total,4);
});
