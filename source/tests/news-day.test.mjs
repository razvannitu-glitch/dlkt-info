import test from 'node:test';
import assert from 'node:assert/strict';
import {newsDayWindow,validNewsDayWindow,newsPublishedInDay} from '../.build/src/iceo/news-day.js';
import {NewsPageService,parseNewsPageRequest} from '../.build/src/iceo/news-page.js';
import {validNewsPage} from '../.build/src/iceo/news-page-contracts.js';
import {NewsContinuation} from '../.build/src/iceo/news-continuation.js';
import {searchCities} from '../.build/src/local/cities.js';
import {NOW,iso,article,local,epoch,CorpusMemoryStore,CATEGORIES} from './fixtures/news-corpus.mjs';
const KEY='test-only-news-cursor-writer-123456789012345678901234567890';
const request=(period='today',cityId=null,language='en',filter='all',cursor=null)=>({language,cityId,filter,cursor,period});
const city=(name,country)=>{const found=searchCities(name,country,12).find(row=>row.countryCode===country);assert.ok(found,name+' is in the reviewed city catalog');return found;};
function cycles(items){
 const remaining=new Map();for(const item of items){const key=item.category??'other';remaining.set(key,(remaining.get(key)??0)+1);}
 let offset=0;while(offset<items.length){
  const active=[...remaining].filter(([,count])=>count>0).map(([key])=>key),cycle=items.slice(offset,offset+active.length);
  assert.deepEqual(new Set(cycle.map(item=>item.category??'other')),new Set(active));
  if(offset&&active.length>1)assert.notEqual(items[offset-1].category??'other',cycle[0].category??'other');
  for(const item of cycle){const key=item.category??'other';remaining.set(key,remaining.get(key)-1);}offset+=active.length;
 }
}
test('calendar boundaries use actual 23/25-hour days and non-hour offsets',()=>{
 const cases=[
  ['2026-03-29T12:00:00.000Z','Europe/Rome','2026-03-29','2026-03-28T23:00:00.000Z','2026-03-29T22:00:00.000Z',23],
  ['2026-10-25T12:00:00.000Z','Europe/Rome','2026-10-25','2026-10-24T22:00:00.000Z','2026-10-25T23:00:00.000Z',25],
  ['2026-11-01T12:00:00.000Z','America/New_York','2026-11-01','2026-11-01T04:00:00.000Z','2026-11-02T05:00:00.000Z',25],
  ['2026-11-22T00:15:00.000Z','Asia/Kolkata','2026-11-22','2026-11-21T18:30:00.000Z','2026-11-22T18:30:00.000Z',24],
  ['2026-11-22T23:45:00.000Z','Asia/Shanghai','2026-11-23','2026-11-22T16:00:00.000Z','2026-11-23T16:00:00.000Z',24],
  ['2026-11-22T20:00:00.000Z','Pacific/Funafuti','2026-11-23','2026-11-22T12:00:00.000Z','2026-11-23T12:00:00.000Z',24],
  ['2026-11-23T01:15:00.000Z','America/Sao_Paulo','2026-11-22','2026-11-22T03:00:00.000Z','2026-11-23T03:00:00.000Z',24],
 ];
 for(const [at,timeZone,date,start,end,hours] of cases){
  const day=newsDayWindow(Date.parse(at),timeZone);assert.deepEqual(day,{date,timeZone,start,end});
  assert.equal((Date.parse(end)-Date.parse(start))/3600000,hours);assert.ok(validNewsDayWindow(day,Date.parse(at),timeZone));
  assert.ok(newsPublishedInDay(start,day));assert.equal(newsPublishedInDay(iso(Date.parse(start)-1),day),false);
  assert.equal(newsPublishedInDay(end,day),false);assert.ok(newsPublishedInDay(iso(Date.parse(end)-1),day));
  assert.equal(newsDayWindow(Date.parse(start),timeZone).date,date);assert.notEqual(newsDayWindow(Date.parse(end),timeZone).date,date);
 }
 const utc=newsDayWindow(NOW);assert.equal(utc.timeZone,'UTC');assert.equal(utc.start,'2026-11-22T00:00:00.000Z');
 assert.throws(()=>newsDayWindow(NaN),/NEWS_DAY_INVALID/);assert.throws(()=>newsDayWindow(NOW,'Invalid/City'),/NEWS_DAY_INVALID/);
 assert.equal(validNewsDayWindow({...utc,extra:true},NOW,'UTC'),false);
 assert.equal(validNewsDayWindow({...utc,start:iso(Date.parse(utc.start)+1)},NOW,'UTC'),false);
 assert.equal(newsPublishedInDay('not-a-date',utc),false);
});
test('Today is the selected city calendar date, not the server date or the publisher country',async()=>{
 const now=Date.parse('2026-11-22T23:30:00.000Z');
 const records=[-10*60000,-5*3600000,-12*3600000,-20*3600000,-23*3600000].map((offset,i)=>article(i+1,{now,published:now+offset}));
 const service=new NewsPageService(new CorpusMemoryStore([epoch(records,[],{now})]),KEY,()=>now);
 const contexts=[
  [city('Shanghai','CN'),'2026-11-23',2],[city('Delhi','IN'),'2026-11-23',2],
  [city('Funafuti','TV'),'2026-11-23',2],[city('London','GB'),'2026-11-22',5],[city('Sao Paulo','BR'),'2026-11-22',4],
  [null,'2026-11-22',5],
 ];
 for(const [selected,date,total] of contexts){
  const page=await service.read(request('today',selected?.id??null));
  assert.equal(page.day.date,date);assert.equal(page.day.timeZone,selected?.timezone??'UTC');assert.equal(page.total,total);
  assert.equal(page.language,'en');assert.equal(page.countryCode,selected?.countryCode??null);
  assert.deepEqual(page.coverage,{national:0,local:0,international:total});assert.ok(validNewsPage(page,now,selected??undefined));
  for(const item of page.items)assert.ok(newsPublishedInDay(item.card.date,page.day));
  const recent=await service.read(request('recent',selected?.id??null));assert.equal(recent.total,5);assert.equal(recent.day,null);
 }
});
test('all 270 eligible Today originals remain reachable across pages and category projections with one stable cycle order',async()=>{
 const categories=Object.keys(CATEGORIES),records=Array.from({length:270},(_,i)=>article(i+1,{category:categories[i%categories.length]}));
 const yesterday=Array.from({length:10},(_,i)=>article(i+1000,{published:NOW-14*3600000}));
 const otherLanguage=Array.from({length:8},(_,i)=>article(i+2000,{language:'ro'}));
 const stored=epoch([...records,...yesterday,...otherLanguage]),before=JSON.stringify(stored);
 const service=new NewsPageService(new CorpusMemoryStore([stored]),KEY,()=>NOW+1000),items=[],pages=[];
 let cursor=null;do{
  const page=await service.read(request('today',null,'en','all',cursor));
  assert.ok(validNewsPage(page,NOW+1000));assert.equal(page.period,'today');assert.equal(page.total,270);assert.equal(page.filteredTotal,270);
  if(pages.length){assert.deepEqual(page.day,pages[0].day);assert.equal(page.startedAt,pages[0].startedAt);assert.deepEqual(page.counts,pages[0].counts);}
  items.push(...page.items);pages.push(page);cursor=page.nextCursor;assert.ok(pages.length<=14);
 }while(cursor);
 assert.equal(pages.length,14);assert.deepEqual(pages.map(page=>page.items.length),[...Array(13).fill(20),10]);
 assert.equal(items.length,270);assert.equal(new Set(items.map(item=>item.key)).size,270);cycles(items);
 assert.deepEqual(new Map(items.map(item=>[item.card.id,item.card])),new Map(records.map(card=>[card.id,card])));
 for(const category of new Set(items.map(item=>item.category??'other'))){
  const projected=[];let next=null;do{const page=await service.read(request('today',null,'en',category,next));projected.push(...page.items);next=page.nextCursor;}while(next);
  assert.deepEqual(projected,items.filter(item=>(item.category??'other')===category));
 }
 const recent=await service.read(request('recent'));assert.equal(recent.total,280);
 assert.equal(JSON.stringify(stored),before,'selection never rewrites original metadata, dates or hashes');
 const requests=[];const reader=new NewsContinuation(async url=>{
  const query=parseNewsPageRequest(url);requests.push(query);return new Response(JSON.stringify(await service.read(query)),{headers:{'content-type':'application/json'}});
 },()=>NOW+1000);
 await reader.start({language:'en',cityId:null,filter:'all',period:'today'});const prefix=[...reader.view().items];
 while(reader.view().page?.nextCursor){assert.equal(reader.view().error,null);await reader.next();assert.ok(requests.length<=14);}
 assert.equal(reader.view().error,null);assert.equal(requests.length,14);assert.equal(reader.view().items.length,270);
 assert.deepEqual(reader.view().items.slice(0,20),prefix);assert.deepEqual(reader.view().items,items);
});
test('Today keeps the existing source freshness rules, including the unavailable first hour of a 25-hour day',async()=>{
 const now=Date.parse('2026-11-02T04:30:00.000Z'),newYork=city('New York','US'),day=newsDayWindow(now,newYork.timezone);
 assert.equal((Date.parse(day.end)-Date.parse(day.start))/3600000,25);
 const older=article(1,{now,published:Date.parse('2026-11-01T04:15:00.000Z')});
 const stale=article(2,{now,published:now-60000,observed:now-3600001});
 const current=article(3,{now,published:now-60000});
 assert.ok(newsPublishedInDay(older.date,day));
 const stored=epoch([older,stale,current],[],{now});assert.deepEqual(stored.corpus.cards,[current]);
 const service=new NewsPageService(new CorpusMemoryStore([stored]),KEY,()=>now),page=await service.read(request('today',newYork.id));
 assert.equal(page.total,1);assert.equal(page.items[0].card,current);assert.deepEqual(page.day,day);assert.ok(validNewsPage(page,now,newYork));
});
test('Recent preserves 48-hour local reports while Today includes only the current city date',async()=>{
 const entry=local(4,{published:NOW-48*3600000}),records=[article(1,{language:'ro'}),article(2,{language:'ro'})];
 const service=new NewsPageService(new CorpusMemoryStore([epoch(records,[entry])]),KEY,()=>NOW+1000);
 const today=await service.read(request('today',entry.city.id,'ro')),recent=await service.read(request('recent',entry.city.id,'ro'));
 assert.equal(today.total,2);assert.equal(today.coverage.local,0);assert.equal(recent.total,6);assert.equal(recent.coverage.local,4);
 assert.ok(validNewsPage(today,NOW+1000,entry.city));assert.ok(validNewsPage(recent,NOW+1000,entry.city));
});
test('a midnight boundary expires the cursor without changing its prefix, and an explicit restart selects the new date',async()=>{
 const at=Date.parse('2026-11-22T23:59:50.000Z'),records=Array.from({length:45},(_,i)=>article(i+1,{now:at,published:at-1000}));
 let now=at;const service=new NewsPageService(new CorpusMemoryStore([epoch(records,[],{now:at})]),KEY,()=>now);
 const first=await service.read(request()),prefix=JSON.stringify(first.items);assert.equal(first.expiresAt,'2026-11-23T00:00:00.000Z');
 now+=5000;const next=await service.read(request('today',null,'en','all',first.nextCursor));
 assert.deepEqual(next.day,first.day);assert.equal(new Set([...first.items,...next.items].map(item=>item.key)).size,40);
 now=Date.parse(first.day.end);await assert.rejects(service.read(request('today',null,'en','all',next.nextCursor)),/NEWS_EDITION_EXPIRED/);
 assert.equal(JSON.stringify(first.items),prefix);
 const refreshed=await service.read(request());assert.equal(refreshed.day.date,'2026-11-23');assert.equal(refreshed.total,0);
 const recent=await service.read(request('recent'));assert.equal(recent.total,45);assert.equal(recent.day,null);
});
test('period and calendar context are strict, signed and validated against the selected city',async()=>{
 const london=city('London','GB'),service=new NewsPageService(new CorpusMemoryStore([epoch(Array.from({length:45},(_,i)=>article(i+1)))]),KEY,()=>NOW+1000);
 const page=await service.read(request('today',london.id));
 assert.deepEqual(parseNewsPageRequest('/api/news-page?lang=en&period=today&city='+london.id),request('today',london.id));
 for(const query of ['?lang=en&period=week','?lang=en&period=today&period=recent','?lang=en&period=','?lang=en&period=today&timezone=Asia/Shanghai','?lang=en&period=today&day=2026-11-21'])
  assert.throws(()=>parseNewsPageRequest('/api/news-page'+query),/NEWS_PAGE_QUERY_INVALID/);
 await assert.rejects(service.read(request('recent',london.id,'en','all',page.nextCursor)),/NEWS_CONTEXT_MISMATCH/);
 const payload=JSON.parse(Buffer.from(page.nextCursor.split('.')[0],'base64url').toString('utf8'));
 assert.equal(payload.period,'today');assert.deepEqual(payload.day,page.day);assert.equal(payload.version,'news-cursor-5');
 assert.equal(validNewsPage(page,NOW+1000),false,'a city-specific day needs its trusted city metadata');
 for(const mutate of [
  value=>{value.period='recent';},value=>{value.day.timeZone='Asia/Shanghai';},value=>{value.day.date='2026-11-21';},
  value=>{value.day.start=iso(Date.parse(value.day.start)+1);},value=>{value.day.end=iso(Date.parse(value.day.end)+3600000);},
  value=>{value.day.extra=true;},value=>{value.day=null;},
 ]){const forged=structuredClone(page);mutate(forged);assert.equal(validNewsPage(forged,NOW+1000,london),false);}
 const recent=await service.read(request('recent',london.id));
 assert.equal(validNewsPage({...recent,day:page.day},NOW+1000,london),false);
 const omitted=await service.read({language:'en',cityId:london.id,filter:'all',cursor:null});assert.equal(omitted.period,'recent');
});
