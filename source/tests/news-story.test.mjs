import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {groupNewsStories} from '../.build/src/iceo/news-story.js';
import {NewsPageService,parseNewsSourcesRequest} from '../.build/src/iceo/news-page.js';
import {validNewsPage,validNewsStorySourcesPage,NEWS_MAX_RESPONSE_BYTES} from '../.build/src/iceo/news-page-contracts.js';
import {NewsContinuation,continuationItems,fetchNewsStorySources,NewsStorySourcesError} from '../.build/src/iceo/news-continuation.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {newsCategory,NEWS_CATEGORIES} from '../.build/src/iceo/news-taxonomy.js';
import {newsCard} from '../.build/src/local/service.js';
import {parseLocalNews} from '../.build/src/local/news-service.js';
import {CITY_NEWS_FEEDS} from '../.build/src/local/news-policy.js';
import {findCity} from '../.build/src/local/cities.js';
import {NOW,iso,hash,article,epoch,CorpusMemoryStore} from './fixtures/news-corpus.mjs';

const KEY='story-fixture-writer-key-'.repeat(3),query=(extra={})=>({language:'en',cityId:null,filter:'all',cursor:null,...extra});
const guardian='Cop31 live: A new draft deal on the table as talks go into final hours';
const bbc='COP31: New draft deal aims to avert collapse of talks at climate summit';
function report(id,title,extra={}){
 const base=article(id,{language:extra.language??'en',published:extra.published??NOW-10000,observed:extra.observed??NOW});
 const {language:_language,published:_published,observed:_observed,...fields}=extra;
 const value={...base,title,...fields},url=value.sourceUrl;
 value.id=hash(url).slice(0,24);value.identity=url;value.contentHash=hash(cardContent(value));return value;
}
const original=card=>({kind:'global',key:'article:'+card.id,category:newsCategory(card),card});
const service=cards=>new NewsPageService(new CorpusMemoryStore([epoch(cards)]),KEY,()=>NOW);
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
function localOriginal(title,index=0,summary=''){
 const city=findCity('683506'),feed=CITY_NEWS_FEEDS[index];
 const url=feed.id==='bucharest-b365'?'https://b365.ro/stire-control-123456/':'https://buletin.de/bucuresti/stire-control-123456/';
 const body='<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>'+feed.title+'</title><link>'+feed.home+'</link><item><title>'+title+'</title><link>'+url+'</link><pubDate>'+new Date(NOW-10000).toUTCString()+'</pubDate>'+(feed.licenseUrl?'<dc:creator>Autor Test</dc:creator>':'')+(summary?'<description>'+summary+'</description>':'')+'</item></channel></rss>';
 const parsed=parseLocalNews(body,feed.id,city,iso(NOW),NOW,{full:true});assert.equal(parsed.articles.length,1);assert.equal(parsed.rejected,0);
 if(feed.licenseUrl){assert.equal(parsed.articles[0].byline,'By Autor Test');assert.equal(parsed.articles[0].licenseUrl,feed.licenseUrl);}
 const card=newsCard(parsed.articles[0],city);return {kind:'local',key:'local:'+card.id,category:newsCategory(card),card};
}
const sign=value=>{
 const encoded=Buffer.from(JSON.stringify(value)).toString('base64url'),key=createHmac('sha256',KEY).update('dlkt-info/news-page/cursor-key/v1').digest();
 return encoded+'.'+createHmac('sha256',key).update('dlkt-info/news-page/cursor/v1:'+encoded).digest('base64url');
};
const decoded=token=>JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString('utf8'));

test('the existing BBC and Guardian event group survives server pagination and the reader preserves both originals',async()=>{
 const records=[report(1,guardian,{publisher:'The Guardian',sourceUrl:'https://www.theguardian.com/environment/live/2026/nov/22/cop31-climate-crisis-talks-turkey-latest-news-updates'}),
  report(2,bbc,{publisher:'BBC',sourceUrl:'https://www.bbc.com/news/articles/cq7827z2841zo'})];
 const before=JSON.stringify(records),reader=service(records),page=await reader.read(query());
 assert.equal(page.total,1);assert.equal(page.articleTotal,2);assert.equal(page.items.length,1);assert.equal(page.filteredTotal,1);
 assert.equal(page.items[0].story.basis,'shared-event');assert.equal(page.items[0].story.sourceTotal,2);assert.equal(page.items[0].story.nextSourcesCursor,null);
 const originals=[page.items[0].card,...page.items[0].story.related.map(source=>source.card)];
 assert.deepEqual(new Set(originals.map(card=>card.sourceUrl)),new Set(records.map(card=>card.sourceUrl)));
 assert.deepEqual(new Set(originals.map(card=>card.title)),new Set(records.map(card=>card.title)));
 assert.equal(JSON.stringify(records),before);assert.equal(validNewsPage(page,NOW),true);
 const view=continuationItems(page.items,NOW)[0];
 assert.equal(view.view.grouping,'shared-event');assert.equal(view.view.related.length,1);assert.equal(view.story,page.items[0].story);
 assert.equal(view.view.card,page.items[0].card);assert.equal(view.view.related[0],page.items[0].story.related[0].card);
});

test('same person, separate actions, numbered events and distinct claims remain separately accessible',()=>{
 const records=[
  report(10,'COP31 negotiators discuss a new draft agreement'),
  report(11,'COP31 protesters hold a demonstration outside the summit'),
  report(12,'COP32 negotiators discuss a new draft agreement'),
  report(13,'Alex Morgan opens a new sports academy'),
  report(14,'Alex Morgan announces retirement from professional football'),
  report(15,'Bucuresti: Council approves 20 new school buildings after the public consultation'),
  report(16,'Bucuresti: Council does not approve 20 new school buildings after the public consultation'),
 ];
 const before=JSON.stringify(records),groups=groupNewsStories(records.map(original));
 assert.equal(groups.length,records.length);assert.ok(groups.every(group=>group.sources.length===1));assert.equal(JSON.stringify(records),before);
 const conflicting={...records[0],title:'A different original title'};conflicting.contentHash=hash(cardContent(conflicting));
 assert.equal(groupNewsStories([original(records[0]),original(conflicting)]).length,0);
});

test('a presentation group retains a stable identity when the representative changes and rejects a stale duplicate copy',()=>{
 const first=report(21,guardian),second=report(22,bbc),before=JSON.stringify([first,second]);
 const a=groupNewsStories([original(first),original(second)])[0],b=groupNewsStories([original(second),original(first)])[0];
 assert.equal(a.storyKey,b.storyKey);assert.equal(a.primary.card,first);assert.equal(b.primary.card,second);
 assert.equal(JSON.stringify([first,second]),before);
 const old={...first,observedAt:iso(NOW-1000)},fresh={...first,observedAt:iso(NOW)};
 const group=groupNewsStories([original(fresh),original(old)])[0];
 assert.equal(group.sources.length,1);assert.equal(group.primary.card,fresh);
});

test('local duplicates require the same informative headline, city and excerpt; crossing to global needs a printed local place',()=>{
 const title='Bucuresti: Consiliul aproba construirea a doua scoli noi dupa consultarea publica din aceasta saptamana';
 const one=localOriginal(title,0),two=localOriginal(title,1),before=JSON.stringify([one,two]);
 let groups=groupNewsStories([one,two]);assert.equal(groups.length,1);assert.equal(groups[0].sources.length,2);assert.equal(groups[0].basis,'matching-headlines');
 assert.equal(JSON.stringify([one,two]),before);
 const changed=localOriginal(title.replace('doua scoli','trei scoli'),1);assert.equal(groupNewsStories([one,changed]).length,2);
 const opposed=localOriginal(title.replace('aproba','nu aproba'),1);assert.equal(groupNewsStories([one,opposed]).length,2);
 const otherCity={...two,card:{...two.card,news:{...two.card.news,cityId:'2643743'}}};assert.equal(groupNewsStories([one,otherCity]).length,2);
 const excerpt=localOriginal(title,1,'Un fragment diferit despre raportul original.');assert.equal(groupNewsStories([one,excerpt]).length,2);
 const national=report(25,title,{language:'ro'});groups=groupNewsStories([original(national),one,two]);
 assert.equal(groups.length,1);assert.equal(groups[0].sources.length,3);assert.equal(groups[0].primary.card,national);
 const sameUrl=report(26,title,{language:'ro',publisher:one.card.publisher,sourceUrl:one.card.sourceUrl});
 groups=groupNewsStories([original(sameUrl),one]);assert.equal(groups.length,1);assert.equal(groups[0].sources.length,1);
 const noPlace={...one,card:{...one.card,title:title.replace('Bucuresti: ',''),news:{...one.card.news,title:title.replace('Bucuresti: ','')}}};
 assert.equal(groupNewsStories([original(report(27,noPlace.card.title,{language:'ro'})),noPlace]).length,2);
});

test('whole-edition grouping precedes the twentieth card boundary and category filtering projects the same complete order',async()=>{
 const cards=Array.from({length:43},(_,index)=>article(100+index,{category:NEWS_CATEGORIES[index%NEWS_CATEGORIES.length].id}));
 cards.splice(19,0,report(200,guardian),report(201,bbc));
 const reader=service(cards),pages=[],items=[];let cursor=null;
 do{const page=await reader.read(query({cursor}));pages.push(page);items.push(...page.items);cursor=page.nextCursor;}while(cursor!==null);
 assert.deepEqual(pages.map(page=>page.items.length),[20,20,4]);assert.ok(pages.every(page=>page.total===44&&page.articleTotal===45));
 assert.equal(items.filter(item=>item.story).length,1);assert.equal(new Set(items.map(item=>item.key)).size,44);
 const sourceUrls=items.flatMap(item=>[item.card.sourceUrl,...(item.story?.related??[]).map(source=>source.card.sourceUrl)]);
 assert.equal(sourceUrls.length,45);assert.equal(new Set(sourceUrls).size,45);
 const repeat=await reader.read(query());assert.deepEqual(repeat.items,pages[0].items);
 const categories=new Set(items.map(item=>item.category??'other'));
 assert.equal(new Set(items.slice(0,categories.size).map(item=>item.category??'other')).size,categories.size);
 for(let index=1;index<items.length;index++){
  if(items[index-1].category===items[index].category)assert.equal(new Set(items.slice(index-1).map(item=>item.category)).size,1);
 }
 const chosen=items[0].category??'other',filtered=await reader.read(query({filter:chosen}));
 assert.deepEqual(filtered.items.map(item=>item.key),items.filter(item=>(item.category??'other')===chosen).map(item=>item.key));
 const controller=new NewsContinuation(async url=>{
  const parsed=new URL(url,'https://www.dlkt.ee');return response(await reader.read(query({cursor:parsed.searchParams.get('cursor')})));
 },()=>NOW);
 await controller.start({language:'en',cityId:null,filter:'all'});const prefix=[...controller.view().items];
 while(controller.view().page.nextCursor!==null)await controller.next();
 assert.equal(controller.view().error,null);assert.equal(controller.view().items.length,44);assert.deepEqual(controller.view().items.slice(0,20),prefix);
});

test('a large event exposes every original through signed bounded source pages without splitting its feed card',async()=>{
 const cards=Array.from({length:65},(_,index)=>report(300+index,'COP31 draft deal negotiations continue: report '+index));
 const reader=service(cards),page=await reader.read(query()),item=page.items[0],seen=[item.card,...item.story.related.map(source=>source.card)];
 assert.equal(page.items.length,1);assert.equal(page.total,1);assert.equal(page.articleTotal,65);assert.equal(item.story.sourceTotal,65);assert.equal(item.story.related.length,3);
 let cursor=item.story.nextSourcesCursor,offset=4;const sizes=[];
 while(cursor!==null){
  const next=await reader.readSources(cursor);assert.equal(next.offset,offset);assert.equal(next.storyKey,item.story.key);assert.equal(next.sourceTotal,65);
  assert.equal(next.startedAt,page.startedAt);assert.equal(next.expiresAt,page.expiresAt);assert.equal(validNewsStorySourcesPage(next,NOW),true);
  assert.ok(Buffer.byteLength(JSON.stringify(next))<=NEWS_MAX_RESPONSE_BYTES);sizes.push(next.sources.length);
  seen.push(...next.sources.map(source=>source.card));offset+=next.sources.length;cursor=next.nextCursor;
 }
 assert.deepEqual(sizes,[20,20,20,1]);assert.equal(seen.length,65);assert.equal(new Set(seen.map(card=>card.sourceUrl)).size,65);
 assert.deepEqual(new Set(seen.map(card=>card.sourceUrl)),new Set(cards.map(card=>card.sourceUrl)));
 // Discovery originals have no excerpt: exceed the response budget through valid article volume.
 const oversized=Array.from({length:1800},(_,index)=>report(1000+index,'COP31 talks discuss the draft agreement: source '+index));
 assert.ok(Buffer.byteLength(JSON.stringify(oversized))>NEWS_MAX_RESPONSE_BYTES);
 const bounded=await service(oversized).read(query());assert.equal(bounded.articleTotal,1800);assert.equal(bounded.items[0].story.sourceTotal,1800);
 assert.ok(Buffer.byteLength(JSON.stringify(bounded))<=NEWS_MAX_RESPONSE_BYTES);assert.ok(bounded.items[0].story.nextSourcesCursor);
});

test('source cursors bind kind, epoch, event, offset, category, language and expiry with no arbitrary URL input',async()=>{
 let now=NOW;const cards=Array.from({length:6},(_,index)=>report(2000+index,'COP31 negotiations discuss the draft deal: report '+index));
 const reader=new NewsPageService(new CorpusMemoryStore([epoch(cards)]),KEY,()=>now),page=await reader.read(query()),token=page.items[0].story.nextSourcesCursor;
 assert.equal(parseNewsSourcesRequest('/api/news-page?sources='+token),token);assert.equal(parseNewsSourcesRequest('/api/news-page?lang=en'),null);
 for(const suffix of ['&lang=en','&sources='+token,'&url=https://example.org','&_vercel_share=test'])assert.throws(()=>parseNewsSourcesRequest('/api/news-page?sources='+token+suffix),/NEWS_PAGE_QUERY_INVALID/);
 await assert.rejects(reader.read(query({cursor:token})),/NEWS_CURSOR_INVALID/);
 await assert.rejects(reader.readSources(token.slice(0,-1)+(token.at(-1)==='A'?'B':'A')),/NEWS_CURSOR_INVALID/);
 const value=decoded(token);
 await assert.rejects(reader.readSources(sign({...value,version:'news-cursor-4'})),/NEWS_EDITION_EXPIRED/);
 await assert.rejects(reader.readSources(sign({...value,orderVersion:'iptc17-country-day-stories-20261123'})),/NEWS_EDITION_EXPIRED/);
 await assert.rejects(reader.readSources(sign({...value,storyKey:'story:'+'a'.repeat(64)})),/NEWS_CURSOR_INVALID/);
 await assert.rejects(reader.readSources(sign({...value,after:6})),/NEWS_CURSOR_INVALID/);
 await assert.rejects(reader.readSources(sign({...value,filter:'05000000'})),/NEWS_CURSOR_INVALID/);
 await assert.rejects(reader.readSources(sign({...value,language:'ro'})),/NEWS_CURSOR_INVALID|NEWS_EDITION_EXPIRED/);
 now=Date.parse(page.expiresAt);await assert.rejects(reader.readSources(token),/NEWS_EDITION_EXPIRED/);
});

test('source-page validation rejects duplicate, stale, foreign-language and incoherent continuation data',async()=>{
 const reader=service(Array.from({length:9},(_,index)=>report(2100+index,'COP31 new draft agreement negotiations: report '+index)));
 const main=await reader.read(query()),page=await reader.readSources(main.items[0].story.nextSourcesCursor);
 assert.equal(validNewsStorySourcesPage(page,NOW),true);
 for(const changed of [
  {...page,offset:0},{...page,sourceTotal:page.sourceTotal-1},{...page,sources:[page.sources[0],page.sources[0]]},
  {...page,extra:true},{...page,nextCursor:'invalid'},{...page,expiresAt:iso(NOW)},
  {...page,language:'ro'},{...page,cityId:'683506',countryCode:'RO'},
 ])assert.equal(validNewsStorySourcesPage(changed,NOW),false);
 const changed={...main,articleTotal:main.articleTotal-1};assert.equal(validNewsPage(changed,NOW),false);
 assert.equal(validNewsPage({...main,items:[{...main.items[0],story:{...main.items[0].story,related:[{kind:'global',card:main.items[0].card}]}}]},NOW),false);
});

test('source transport is anonymous, abortable, byte-bounded and reports expired cursors distinctly',async()=>{
 const reader=service(Array.from({length:6},(_,index)=>report(2200+index,'COP31 draft deal negotiations: report '+index)));
 const main=await reader.read(query()),cursor=main.items[0].story.nextSourcesCursor,page=await reader.readSources(cursor),controller=new AbortController();
 let observed;
 const result=await fetchNewsStorySources(cursor,controller.signal,undefined,async(url,init)=>{observed={url,init};return response(page);},()=>NOW);
 assert.deepEqual(result,page);assert.equal(observed.init.credentials,'omit');assert.equal(observed.init.cache,'no-store');
 assert.equal(new URL(observed.url,'https://www.dlkt.ee').searchParams.size,1);assert.equal(new URL(observed.url,'https://www.dlkt.ee').searchParams.get('sources'),cursor);
 await assert.rejects(fetchNewsStorySources(cursor,controller.signal,undefined,async()=>new Response('',{status:410}),()=>NOW),error=>error instanceof NewsStorySourcesError&&error.code==='expired');
 await assert.rejects(fetchNewsStorySources(cursor,controller.signal,undefined,async()=>response({...page,offset:0}),()=>NOW),error=>error.code==='unavailable');
 await assert.rejects(fetchNewsStorySources(cursor,controller.signal,undefined,async()=>new Response(' '.repeat(NEWS_MAX_RESPONSE_BYTES+1),{headers:{'content-type':'application/json'}}),()=>NOW),error=>error.code==='unavailable');
 const aborted=new AbortController();aborted.abort();let calls=0;
 await assert.rejects(fetchNewsStorySources(cursor,aborted.signal,undefined,async()=>{calls++;return response(page);},()=>NOW),error=>error.code==='unavailable');assert.equal(calls,0);
});

test('the observed Romanian draw is one feed card with both source originals before pagination',async()=>{
 const records=[
  report(2300,'Rezultatele LOTO duminică, 22 noiembrie 2026. Numerele câștigătoare la extragerea de azi',{language:'ro',publisher:'HotNews.ro',sourceUrl:'https://hotnews.ro/rezultatele-loto-6-din-49-din-22-noiembrie-2026-2410659'}),
  report(2301,'Rezultate LOTO - Duminică, 22 noiembrie 2026. Numerele extrase și premiile puse în joc de Loteria Română',{language:'ro',publisher:'Digi24',sourceUrl:'https://www.digi24.ro/stiri/actualitate/social/rezultate-loto-duminica-22-noiembrie-2026-premii-atractive-la-6-49-joker-si-noroc-4046517'}),
 ];
 const before=JSON.stringify(records),page=await service(records).read(query({language:'ro'}));
 assert.equal(page.total,1);assert.equal(page.articleTotal,2);assert.equal(page.items.length,1);
 assert.equal(page.items[0].story.basis,'shared-event');assert.equal(page.items[0].story.sourceTotal,2);
 assert.deepEqual(new Set([page.items[0].card,...page.items[0].story.related.map(source=>source.card)].map(card=>card.sourceUrl)),new Set(records.map(card=>card.sourceUrl)));
 assert.equal(validNewsPage(page,NOW),true);assert.equal(JSON.stringify(records),before);
});
