import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NewsPageService,parseNewsPageRequest} from '../.build/src/iceo/news-page.js';
import {validNewsPage,validNewsPageItem} from '../.build/src/iceo/news-page-contracts.js';
import {buildNewsCorpus,validNewsCorpus,NEWS_CORPUS_MAX_BYTES} from '../.build/src/iceo/news-corpus.js';
import {publicSnapshotDigest} from '../.build/src/iceo/refresh-ledger.js';
import {newsCategory} from '../.build/src/iceo/news-taxonomy.js';
import {ICEO_SOURCES} from '../.build/src/iceo/registry.js';
import {handleNewsPage} from '../.build/api/news-page.js';
import {parseLocalNews,LocalNewsService} from '../.build/src/local/news-service.js';
import {CITY_NEWS_FEEDS} from '../.build/src/local/news-policy.js';
import {findCity} from '../.build/src/local/cities.js';
import {NOW,iso,article,snapshot,local,epoch,CorpusMemoryStore,CATEGORIES} from './fixtures/news-corpus.mjs';
const KEY='test-only-news-cursor-writer-123456789012345678901234567890';
const request=(language='en',cityId=null,filter='all',cursor=null)=>({language,cityId,filter,cursor});
const response=()=>({statusCode:0,headers:{},body:'',setHeader(key,value){this.headers[key]=value;},end(value=''){this.body=value;}});
function cycles(items){
 const remaining=new Map();for(const item of items){const key=item.category??'other';remaining.set(key,(remaining.get(key)??0)+1);}
 let offset=0;while(offset<items.length){const active=[...remaining].filter(([,n])=>n>0).map(([id])=>id),cycle=items.slice(offset,offset+active.length);
  assert.deepEqual(new Set(cycle.map(item=>item.category??'other')),new Set(active));
  if(offset&&active.length>1)assert.notEqual(items[offset-1].category??'other',cycle[0].category??'other');
  for(const item of cycle){const key=item.category??'other';remaining.set(key,remaining.get(key)-1);}offset+=active.length;}
}
test('server pages retain a corpus larger than the compatibility snapshot and preserve complete category cycles',async()=>{
 const categories=Object.keys(CATEGORIES),cards=Array.from({length:270},(_,i)=>article(i+1,{category:categories[i%categories.length],boundary:'Controlled context. '+('x'.repeat(3800))}));
 const edition=epoch(cards),before=JSON.stringify(edition.corpus);assert.ok(Buffer.byteLength(before)>1048576);assert.ok(Buffer.byteLength(before)<NEWS_CORPUS_MAX_BYTES);
 assert.ok(validNewsCorpus(edition.corpus,NOW));
 const store=new CorpusMemoryStore([edition]),service=new NewsPageService(store,KEY,()=>NOW+1000),seen=[];let cursor=null,pages=0;
 do{const page=await service.read(request('en',null,'all',cursor));assert.ok(validNewsPage(page,NOW+1000));assert.equal(page.total,270);assert.equal(page.filteredTotal,270);
  assert.ok(page.items.length<=20);seen.push(...page.items);cursor=page.nextCursor;pages++;assert.ok(pages<20);}while(cursor);
 assert.equal(pages,14);assert.equal(seen.length,270);assert.equal(new Set(seen.map(item=>item.key)).size,270);cycles(seen);
 assert.deepEqual(new Map(seen.map(item=>[item.card.id,item.card])),new Map(cards.map(card=>[card.id,card])));
 assert.equal(JSON.stringify(edition.corpus),before);assert.ok(store.reads.slice(1).every(id=>id==='1'));
});
test('category pages are exact projections of the same native-language city-specific order',async()=>{
 const records=Array.from({length:54},(_,i)=>article(i+1,{language:'ro',category:Object.keys(CATEGORIES)[i%18]}));
 const localEntry=local(25),edition=epoch([...records,article(100,{language:'en'})],[localEntry]),service=new NewsPageService(new CorpusMemoryStore([edition]),KEY,()=>NOW+1000);
 const all=[],pages=[];let cursor=null;do{const page=await service.read(request('ro','683506','all',cursor));pages.push(page);all.push(...page.items);cursor=page.nextCursor;}while(cursor);
 assert.equal(all.length,79);assert.equal(all.filter(item=>item.kind==='local').length,25);cycles(all);
 const category=all.find(item=>item.kind==='local').category,filtered=[];cursor=null;
 do{const page=await service.read(request('ro','683506',category??'other',cursor));filtered.push(...page.items);cursor=page.nextCursor;}while(cursor);
 assert.deepEqual(filtered,all.filter(item=>item.category===category));
 const english=await service.read(request('en','683506'));assert.equal(english.total,1);assert.equal(english.items[0].kind,'global');
 assert.equal(validNewsPage(english,NOW+1000),true,'a global-only page does not require local city metadata');
 const otherCity=await service.read(request('ro','2643743'));assert.equal(otherCity.total,54);assert.ok(otherCity.items.every(item=>item.kind==='global'));
 const withLocal=pages.find(page=>page.items.some(item=>item.kind==='local'));assert.ok(withLocal,'the city-validation fixture must contain a local article');
 assert.equal(validNewsPage(withLocal,NOW+1000),false);
 assert.equal(validNewsPage(withLocal,NOW+1000,localEntry.city),true);assert.equal(validNewsPage(withLocal,NOW+1000,findCity('2643743')),false);
});
test('cursor pins the epoch when newer data arrives and cannot be tampered with or reused for a different context',async()=>{
 const first=epoch(Array.from({length:45},(_,i)=>article(i+1))),store=new CorpusMemoryStore([first]);let now=NOW+1000;
 const service=new NewsPageService(store,KEY,()=>now),page=await service.read(request());assert.ok(page.nextCursor);
 const second=epoch([article(99,{now:NOW+2000})],[],{now:NOW+2000,id:'2',revision:2});store.epochs.set('2',second);store.latest='2';now=NOW+3000;
 const next=await service.read(request('en',null,'all',page.nextCursor));assert.equal(next.epoch,'1');assert.equal(next.total,45);assert.equal(next.items.length,20);
 assert.equal((await service.read(request())).epoch,'2');assert.equal(new Set([...page.items,...next.items].map(item=>item.key)).size,40);
 for(const query of [request('ro',null,'all',page.nextCursor),request('en','683506','all',page.nextCursor),request('en',null,'other',page.nextCursor)])await assert.rejects(service.read(query),/NEWS_CONTEXT_MISMATCH/);
 const token=page.nextCursor.slice(0,-1)+(page.nextCursor.endsWith('A')?'B':'A');
 await assert.rejects(service.read(request('en',null,'all',token)),/NEWS_CURSOR_INVALID/);
});
test('the entire context expires at its earliest original validity without skipping a category or moving the prefix',async()=>{
 let now=NOW;const localEntry=local(1),cards=Array.from({length:45},(_,i)=>article(i+1,{language:'ro'}));
 const service=new NewsPageService(new CorpusMemoryStore([epoch(cards,[localEntry])]),KEY,()=>now);
 const page=await service.read(request('ro','683506'));assert.equal(page.expiresAt,iso(NOW+300000));
 now=NOW+300000;await assert.rejects(service.read(request('ro','683506','all',page.nextCursor)),/NEWS_EDITION_EXPIRED/);
 const english=new NewsPageService(new CorpusMemoryStore([epoch(Array.from({length:25},(_,i)=>article(i+1)),[localEntry])]),KEY,()=>now);
 const en=await english.read(request('en','683506'));assert.equal(en.expiresAt,iso(NOW+3600000));assert.equal(en.total,25);
});
test('local72hour edge and original source-check expiry remain strict',async()=>{
 const entry=local(1,{published:NOW-72*3600000});const edition=epoch([],[entry]);let now=NOW;
 const service=new NewsPageService(new CorpusMemoryStore([edition]),KEY,()=>now);const page=await service.read(request('ro','683506'));assert.equal(page.expiresAt,iso(NOW+1));
 now++;assert.equal((await service.read(request('ro','683506'))).total,0);
});
test('completed collection time accepts later RSS checks without redating original observations',()=>{
 const entry=local(1,{now:NOW+10000}),card=article(1),raw=snapshot([card],NOW+12000),corpus=buildNewsCorpus(raw,[entry],NOW+12000);
 assert.equal(corpus.generatedAt,iso(NOW+12000));assert.equal(corpus.cards[0].observedAt,iso(NOW));assert.equal(corpus.local[0].snapshot.articles[0].checkedAt,iso(NOW+10000));
});
test('public projections reject extra keys, forged revisions, duplicate records and changed counts',async()=>{
 const edition=epoch(Array.from({length:25},(_,i)=>article(i+1))),service=new NewsPageService(new CorpusMemoryStore([edition]),KEY,()=>NOW);
 const page=await service.read(request());assert.ok(validNewsPage(page,NOW));
 for(const mutate of [
  value=>{value.secret='private';},value=>{value.items[0].card.writerToken='private';},value=>{value.items.push(value.items[0]);},
  value=>{value.counts.other++;},value=>{value.filteredTotal--;},value=>{value.items[0].category='17000000';},
  value=>{value.items[0].card.sourceState='stale';},value=>{value.cityId='0';},
 ]){const bad=structuredClone(page);mutate(bad);assert.equal(validNewsPage(bad,NOW),false);}
 for(const mutate of [value=>{value.cards[0].title='Forged';},value=>{value.cards[0].contentHash='a'.repeat(64);},value=>{value.cards.push(value.cards[0]);},value=>{value.cards[0].privateEmail='private';},value=>{value.sources[0].count++;}]){
  const bad=structuredClone(edition.corpus);mutate(bad);assert.equal(validNewsCorpus(bad,NOW),false);}
 const tooMany={...edition.corpus,cards:Array.from({length:5001},()=>edition.corpus.cards[0])};assert.equal(validNewsCorpus(tooMany,NOW),false);
 assert.equal(JSON.stringify(page).includes(KEY),false);
});
test('strict public request parsing rejects duplicates, unknown fields and arbitrary source URLs',()=>{
 for(const query of ['?lang=en&lang=ro','?lang=en&city=0','?lang=EN','?lang=en&category=business','?lang=en&limit=200','?lang=en&url=https://example.org','?lang=en&cursor=','?lang=en&city=683506&city=2643743','?category=all']){
  assert.throws(()=>parseNewsPageRequest('/api/news-page'+query),/NEWS_PAGE_QUERY_INVALID/);}
 assert.deepEqual(parseNewsPageRequest('/api/news-page?lang=ro&category=all&city=683506'),request('ro','683506'));
});
test('GET and HEAD only read the committed page service; query errors do not touch persistence',async()=>{
 const real=new NewsPageService(new CorpusMemoryStore([epoch([article(1)])]),KEY,()=>NOW);let calls=0;
 const reader={async read(query){calls++;return real.read(query);}};
 const good=response();await handleNewsPage({method:'GET',url:'/api/news-page?lang=en',headers:{}},good,reader,()=>NOW);
 assert.equal(good.statusCode,200);assert.equal(JSON.parse(good.body).items.length,1);assert.equal(good.headers['Cache-Control'],'public, max-age=0, s-maxage=10, must-revalidate');
 const head=response();await handleNewsPage({method:'HEAD',url:'/api/news-page?lang=en',headers:{}},head,reader,()=>NOW);assert.equal(head.statusCode,200);assert.equal(head.body,'');
 const bad=response();await handleNewsPage({method:'GET',url:'/api/news-page?lang=en&limit=200',headers:{}},bad,reader);assert.equal(bad.statusCode,400);assert.equal(calls,2);
 const post=response();await handleNewsPage({method:'POST',url:'/api/news-page?lang=en',headers:{}},post,reader);assert.equal(post.statusCode,405);assert.equal(calls,2);
 const down=response();await handleNewsPage({method:'GET',url:'/api/news-page?lang=en',headers:{}},down,null);assert.equal(down.statusCode,503);
 assert.doesNotMatch(readFileSync('api/news-page.ts','utf8'),/collectCorpusLocalNews|localNewsService|publicEditorialSnapshot/);
});
test('full collector option retains every validated feed item while existing local callers keep20perfeed/40percity',async()=>{
 const city=findCity('683506'),make=feed=>'<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>'+feed.title+'</title><link>'+feed.home+'</link>'+
  Array.from({length:35},(_,i)=>'<item><title>Bucuresti: Metrorex program '+i+'</title><link>'+(feed.id==='bucharest-b365'?'https://b365.ro/program-'+(123450+i)+'/':'https://buletin.de/bucuresti/program-control-'+i+'/')+'</link><pubDate>'+new Date(NOW-10000).toUTCString()+'</pubDate><dc:creator>Autor Test</dc:creator></item>').join('')+'</channel></rss>';
 const body=make(CITY_NEWS_FEEDS[0]);assert.equal(parseLocalNews(body,CITY_NEWS_FEEDS[0].id,city,iso(NOW),NOW).articles.length,20);
 assert.equal(parseLocalNews(body,CITY_NEWS_FEEDS[0].id,city,iso(NOW),NOW,{full:true}).articles.length,35);
 let requests=0;const service=new LocalNewsService(async input=>{requests++;const url=String(input);
  if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /\n',{headers:{'content-type':'text/plain'}});
  const feed=CITY_NEWS_FEEDS.find(feed=>feed.endpoint===url);assert.ok(feed);return new Response(make(feed),{headers:{'content-type':'application/rss+xml'}});},()=>NOW);
 const small=await service.snapshot(city),full=await service.snapshot(city,{full:true});assert.equal(small.articles.length,40);assert.equal(full.articles.length,70);assert.equal(requests,4);
 assert.ok(full.sources.every(source=>source.count===35));assert.ok(full.articles.every(article=>article.checkedAt===iso(NOW)));
});

test('a fresh reading can exclude an expired marginal article in the same epoch while its earlier cursor expires',async()=>{
 let now=NOW;const cards=Array.from({length:45},(_,index)=>article(index+1,{observed:index===0?NOW-3599000:NOW}));
 const service=new NewsPageService(new CorpusMemoryStore([epoch(cards)]),KEY,()=>now);
 const first=await service.read(request());assert.equal(first.expiresAt,iso(NOW+1000));assert.equal(first.startedAt,iso(NOW));
 now=NOW+2000;await assert.rejects(service.read(request('en',null,'all',first.nextCursor)),/NEWS_EDITION_EXPIRED/);
 const fresh=await service.read(request());assert.equal(fresh.epoch,first.epoch);assert.equal(fresh.generatedAt,first.generatedAt);
 assert.equal(fresh.startedAt,iso(now));assert.equal(fresh.total,44);assert.equal(fresh.expiresAt,iso(NOW+3600000));
 assert.equal(fresh.items.some(item=>item.card.id===cards[0].id),false);
 const next=await service.read(request('en',null,'all',fresh.nextCursor));assert.equal(next.startedAt,fresh.startedAt);
});

test('a new reading after the registry rights-review cutoff excludes expired sources instead of repeating410',async()=>{
 const source=ICEO_SOURCES.find(source=>source.id==='news-unclassified'),cutoff=Date.parse(source.rightsReviewBy+'T00:00:00.000Z')+86400000;
 const collected=cutoff-1000;let now=collected;
 const cards=Array.from({length:25},(_,id)=>article(id+1,{now:collected}));
 const service=new NewsPageService(new CorpusMemoryStore([epoch(cards,[],{now:collected})]),KEY,()=>now);
 const first=await service.read(request());assert.equal(first.expiresAt,iso(cutoff));assert.equal(first.total,25);
 now=cutoff+1000;await assert.rejects(service.read(request('en',null,'all',first.nextCursor)),/NEWS_EDITION_EXPIRED/);
 const fresh=await service.read(request());assert.equal(fresh.epoch,first.epoch);assert.equal(fresh.total,0);assert.equal(fresh.nextCursor,null);
 assert.equal(fresh.generatedAt,first.generatedAt);assert.equal(fresh.startedAt,iso(now));assert.ok(validNewsPage(fresh,now));
});
