import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {NEWS_INDEX_URL,NEWS_PUBLISHERS,NEWS_SOURCES,NEWS_CATEGORY_SOURCES,NEWS_UNCLASSIFIED_SOURCE,NEWS_FEATURED_SOURCE,NEWS_DISCOVERY_INDEXES,publisherForNewsUrl,canonicalNewsUrl} from '../.build/src/iceo/news-sources.js';
import {readNewsCandidates,readPublisherNewsCandidates,validateNewsCandidate,mergeNewsCandidates,matchingNewsHeadline,readNewsArticleMetadata,rotatedPublisherIndexes,discoverNewsWithDiagnostics,discoverNews as runDiscovery} from '../.build/src/iceo/news-discovery.js';
import {PUBLIC_EDITORIAL_CATEGORIES} from '../.build/src/iceo/editorial-categories.js';
import {cardContent,validCard} from '../.build/src/iceo/card-validation.js';
const discoverNews=(fetcher,now,seeds=[],callback,options={})=>runDiscovery(fetcher,now,seeds,callback,{publisherIndexes:false,frontpageHighlights:false,...options});
const now=Date.parse('2026-11-20T20:00:00Z'),date='2026-11-20T18:00:00Z';
const titles={world:'Leaders sign a ceasefire agreement after peace talks',business:'Banks announce new interest rates after inflation report',technology:'New artificial intelligence software launches for laptops',money:'New savings account rules change personal finance choices',health:'New vaccine approved after clinical trial results',sport:'Football team wins championship after final match',gaming:'New video game launches for PlayStation consoles',culture:'Film festival opens with new international movies',shopping:'Retailers announce Black Friday shopping discounts',travel:'Airline opens new flights between major airports',work:'New employment rules protect workers from sudden layoffs',education:'Schools adopt new curriculum for students',family:'New childcare rules expand parental leave access',science:'Astronomers discover new exoplanet with space telescope',environment:'Government adopts new carbon emissions policy','public-affairs':'Parliament passes new election law for voters','digital-life':'New digital privacy rules address social media data breach',food:'Restaurants introduce new food safety measures',housing:'City adopts housing rules for tenants and rental homes',weather:'Storm warnings issued as hurricane approaches coastline'};
const candidate=(category='technology',i=0)=>({sourceUrl:`https://www.reuters.com/${category}/fixture-${i}`,title:titles[category]+(i?` in region ${i}`:''),publisher:'Reuters',indexedAt:new Date(now).toISOString(),category});
const unclassified=(i=0)=>({sourceUrl:`https://www.bbc.com/news/articles/beekeeping-fixture-${i}`,title:`Beekeepers report first queen emergence after winter in district ${i}`,publisher:'BBC',indexedAt:new Date(now).toISOString(),category:null});
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const rss=(rows=[candidate()],built=new Date(now).toUTCString())=>`<rss><channel><title>GDELT Article List RSS Feed</title><link>${NEWS_INDEX_URL}</link><lastBuildDate>${built}</lastBuildDate>${rows.map(row=>`<item><title>${escape(row.title)}</title><link>${escape(row.sourceUrl)}</link><pubDate>Sun, 01 Jan 2000 00:00:00 GMT</pubDate><description>Never publish this full article excerpt</description></item>`).join('')}</channel></rss>`;
const html=(row=candidate(),data={})=>`<!doctype html><html><head><link rel="canonical" href="${row.sourceUrl}"><script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'NewsArticle',url:row.sourceUrl,headline:row.title,datePublished:date,...data})}</script></head><body>Private body must never appear in a card<img src="https://image.invalid/photo"></body></html>`;
const xmlResponse=body=>new Response(body,{headers:{'content-type':'application/rss+xml'}});
const htmlResponse=body=>new Response(body,{headers:{'content-type':'text/html'}});
const rowsByCategory=amount=>PUBLIC_EDITORIAL_CATEGORIES.flatMap(category=>Array.from({length:amount},(_,i)=>candidate(category,i)));

test('catalog has20 organizational category sources, an unclassified source and77 exact publisher families',()=>{
 assert.equal(NEWS_SOURCES.length,22);assert.equal(NEWS_CATEGORY_SOURCES.length,20);assert.equal(NEWS_PUBLISHERS.length,77);assert.equal(new Set(NEWS_SOURCES.map(s=>s.id)).size,22);
 assert.equal(NEWS_UNCLASSIFIED_SOURCE.id,'news-unclassified');assert.equal(NEWS_UNCLASSIFIED_SOURCE.topic,'other');
 assert.ok(NEWS_CATEGORY_SOURCES.every(s=>s.adapter==='news-index'&&s.endpoint===NEWS_INDEX_URL));assert.equal(NEWS_FEATURED_SOURCE.id,'editorial-frontpage');
 for(const source of ['https://www.rte.ie/news/story','https://blogs.nvidia.com/blog/story','https://www.reuters.com/world/story'])assert.ok(publisherForNewsUrl(source));
 for(const url of ['http://www.reuters.com/a','https://www.reuters.com.attacker.invalid/a','https://user@www.reuters.com/a','https://127.0.0.1/a','https://www.reuters.com:444/a','https://www.reuters.com/a\\b','https://www.reuters.com/<script>'])assert.equal(publisherForNewsUrl(url),null,url);
 assert.equal(canonicalNewsUrl('https://www.reuters.com/world/story?article=2&utm_source=feed#top'),'https://www.reuters.com/world/story?article=2');
 assert.equal(canonicalNewsUrl('https://www.reuters.com/'),null);
});
test('GAL derives all20 categories, ignores mixed pubDate and retains no descriptions or pictures',()=>{
 const found=readNewsCandidates(rss(rowsByCategory(1)),now);assert.equal(found.length,20);assert.deepEqual(new Set(found.map(c=>c.category)),new Set(PUBLIC_EDITORIAL_CATEGORIES));
 for(const row of found){assert.equal(row.indexedAt,new Date(now).toISOString());assert.deepEqual(Object.keys(row).sort(),['category','indexedAt','publisher','sourceUrl','title']);}
 assert.throws(()=>readNewsCandidates('<!DOCTYPE rss>'+rss(),now),/XML_INVALID/);
 assert.throws(()=>readNewsCandidates(rss().replace('GDELT Article List RSS Feed','Another feed'),now),/IDENTITY_INVALID/);
 assert.throws(()=>readNewsCandidates(rss([],new Date(now-3600001).toUTCString()),now),/INDEX_STALE/);
});
test('candidate validation fails closed for spoofed publishers, extra/private fields, old seeds and wrong categories',()=>{
 const row=candidate();assert.ok(validateNewsCandidate(row,now));
 for(const change of [{publisher:'Associated Press'},{publishedAt:date},{email:'private@example.invalid'},{category:'world'},{title:'x'.repeat(201)},{indexedAt:new Date(now-86400001).toISOString()},{indexedAt:new Date(now+300001).toISOString()},{sourceUrl:'https://attacker.invalid/story'}])assert.equal(validateNewsCandidate({...row,...change},now),null);
 assert.equal(mergeNewsCandidates([row,row,{...row,sourceUrl:row.sourceUrl+'?utm_source=feed'}],now).length,1);
 assert.equal(mergeNewsCandidates(rowsByCategory(30),now).length,600);
});
test('unclassified subjects survive both public indexes without inventing a category',()=>{
 const row=unclassified(),found=readNewsCandidates(rss([row]),now);
 assert.deepEqual(found,[row]);assert.equal(found[0].category,null);assert.ok(Object.hasOwn(found[0],'category'));
 const index=NEWS_DISCOVERY_INDEXES.find(value=>value.id==='bbc-news');assert.ok(index);
 const xml=`<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>${row.sourceUrl}</loc><news:news><news:publication><news:name>BBC</news:name><news:language>en</news:language></news:publication><news:publication_date>${date}</news:publication_date><news:title>${row.title}</news:title></news:news></url></urlset>`;
 assert.deepEqual(readPublisherNewsCandidates(xml,index,now),[row]);
 for(const changed of [{...row,category:'beekeeping'},{...row,category:'world'},{...row,category:undefined},{...row,title:'<script>bad</script>'},{...row,publisher:'Reuters'},{...row,sourceUrl:'https://attacker.invalid/story'}])assert.equal(validateNewsCandidate(changed,now),null);
 assert.equal(validateNewsCandidate({...candidate(),category:null},now),null,'null cannot erase an explicit known classification');
 assert.equal(readPublisherNewsCandidates(xml.replace(date,'2026-11-18T18:00:00Z'),index,now).length,0);
});
test('global pool capacity preserves uncategorized subjects and is not a fixed category quota',()=>{
 const niche=Array.from({length:600},(_,i)=>unclassified(i));
 const onlyNiche=mergeNewsCandidates(niche,now);assert.equal(onlyNiche.length,600);assert.ok(onlyNiche.every(row=>row.category===null));
 const mixed=mergeNewsCandidates([...rowsByCategory(30),...niche],now);assert.equal(mixed.length,1200);
 assert.deepEqual(new Set(mixed.map(row=>row.category)),new Set([...PUBLIC_EDITORIAL_CATEGORIES,null]));
 assert.equal(new Set(mixed.map(row=>row.sourceUrl)).size,1200);
});
test('verified original headline may change the index category while retaining identity and metadata guards',async()=>{
 const neutral='Guild members present detailed findings about techniques used across the county';
 const medical='Guild members present detailed findings about medical techniques used across the county';
 for(const [indexed,original,initialCategory,finalCategory,topic,sourceId] of [[neutral,medical,null,'health','health','news-health'],[medical,neutral,'health',null,'other','news-unclassified']]){
   const row={...unclassified(),title:indexed,category:initialCategory};assert.ok(validateNewsCandidate(row,now));
   const metadata=readNewsArticleMetadata(html(row,{headline:original}),row,row.sourceUrl,now);
   assert.equal(metadata?.category,finalCategory);assert.equal(metadata?.sourceUrl,row.sourceUrl);
   const result=await discoverNews(async url=>String(url)===NEWS_INDEX_URL?xmlResponse(rss([row])):htmlResponse(html(row,{headline:original})),now);
   const card=result.flatMap(value=>value.cards)[0];assert.ok(validCard(card));assert.equal(card.topic,topic);assert.deepEqual(card.sourceIds,[sourceId]);assert.equal(card.title,original);
   assert.equal(result.find(value=>value.health.id===sourceId).health.count,1);
   assert.equal(card.id,createHash('sha256').update(JSON.stringify(row.sourceUrl)).digest('hex').slice(0,24));
   assert.equal(card.contentHash,createHash('sha256').update(JSON.stringify(cardContent(card))).digest('hex'));
   assert.equal(readNewsArticleMetadata(html(row,{headline:'A wholly different claim about an unrelated event'}),row,row.sourceUrl,now),null);
   assert.equal(readNewsArticleMetadata(html(row,{headline:original,datePublished:undefined}),row,row.sourceUrl,now),null);
 }
});
test('unclassified articles use the global request capacity and preserve exact homepage provenance',async()=>{
 const rows=Array.from({length:12},(_,i)=>unclassified(i)),featured=rows[11],looked=[];
 const fetcher=async url=>{const value=String(url);if(value===NEWS_INDEX_URL)return xmlResponse(rss(rows));
   if(value==='https://www.bbc.com/news')return htmlResponse(`<main><a href="${featured.sourceUrl}">${featured.title}</a></main>`);
   if(['https://apnews.com/','https://www.theguardian.com/international','https://www.pcgamer.com/'].includes(value))return htmlResponse('<main></main>');
   looked.push(value);return htmlResponse(html(rows.find(row=>row.sourceUrl===value)));};
 const result=await discoverNews(fetcher,now,[],undefined,{frontpageHighlights:true,maxArticleRequests:10});
 assert.equal(looked.length,10);assert.equal(looked[0],featured.sourceUrl);assert.equal(result.flatMap(value=>value.cards).length,10);
 const health=result.find(value=>value.health.id==='news-unclassified').health;assert.equal(health.count,10);assert.equal(health.error,null);
 for(const card of result.flatMap(value=>value.cards)){assert.ok(validCard(card));assert.equal(card.topic,'other');assert.equal(card.sourceIds[0],'news-unclassified');assert.equal(card.sourceIds.includes('news-world'),false);}
 const card=result.flatMap(value=>value.cards).find(value=>value.sourceUrl===featured.sourceUrl);assert.deepEqual(card.sourceIds,['news-unclassified','editorial-frontpage']);
 assert.equal(result.find(value=>value.health.id==='editorial-frontpage').health.count,1);
 const plain=(await discoverNews(fetcher,now,[featured],undefined,{maxArticleRequests:80})).flatMap(value=>value.cards).find(value=>value.sourceUrl===featured.sourceUrl);
 assert.equal(plain.id,card.id);assert.equal(plain.contentHash,card.contentHash);
});
test('original publication date is required: changed, absent, timezone-less, stale and future values cannot become today',()=>{
 const row=candidate();assert.equal(readNewsArticleMetadata(html(row),row,row.sourceUrl,now)?.date,new Date(date).toISOString());
 for(const data of [{datePublished:undefined,dateModified:date},{datePublished:'2026-11-20'},{datePublished:'2026-11-20T18:00:00'},{datePublished:'2026-11-18T18:00:00Z'},{datePublished:'2026-11-21T18:00:00Z'}])assert.equal(readNewsArticleMetadata(html(row,data),row,row.sourceUrl,now),null,JSON.stringify(data));
});
test('publisher title must meaningfully match, including negations and numeric conditions',()=>{
 const row=candidate();assert.equal(readNewsArticleMetadata(html(row,{headline:'Football championship ends after final victory'}),row,row.sourceUrl,now),null);
 assert.equal(matchingNewsHeadline('Medicine is not approved for children','Medicine is approved for children'),false);
 assert.equal(matchingNewsHeadline('New savings rate rises to 5 percent','New savings rate rises to 3 percent'),false);
 assert.equal(matchingNewsHeadline('New software launches for laptops','New software launches for laptops | Reuters'),true);
});
test('OG published metadata works and conflicting publication dates or canonical publishers fail closed',()=>{
 const row=candidate(),og=`<meta property="og:title" content="${row.title}"><meta property="article:published_time" content="${date}">`;
 assert.ok(readNewsArticleMetadata(og,row,row.sourceUrl,now));
 assert.equal(readNewsArticleMetadata(og+`<meta property="article:published_time" content="2026-11-20T17:00:00Z">`,row,row.sourceUrl,now),null);
 assert.equal(readNewsArticleMetadata(html(row).replace(row.sourceUrl,'https://apnews.com/article/other'),row,row.sourceUrl,now),null);
 assert.equal(readNewsArticleMetadata(html(row,{url:'https://www.reuters.com/technology/unrelated'}),row,row.sourceUrl,now),null);
});
test('successful discovery produces strict stable public card identity and no article body/image/summary',async()=>{
 const row=candidate(),requests=[];let stored;
 const fetcher=async(url,init)=>{requests.push({url:String(url),init});return String(url)===NEWS_INDEX_URL?xmlResponse(rss()):htmlResponse(html());};
 const a=await discoverNews(fetcher,now,[],async rows=>{stored=rows;});const card=a.flatMap(r=>r.cards)[0];assert.ok(card);assert.ok(validCard(card));
 assert.equal(a.length,22);assert.equal(stored.length,1);assert.equal(card.identity,row.sourceUrl);assert.equal(card.sourceUrl,row.sourceUrl);assert.equal(card.publisher,'Reuters');assert.deepEqual(card.sourceIds,['news-technology']);
 assert.equal(card.id,createHash('sha256').update(JSON.stringify(card.identity)).digest('hex').slice(0,24));assert.equal(card.contentHash,createHash('sha256').update(JSON.stringify(cardContent(card))).digest('hex'));
 assert.equal(card.summary,undefined);assert.doesNotMatch(JSON.stringify(card),/Private body|photo|full article excerpt/);assert.match(card.boundary,/not independent corroboration/);
 assert.ok(requests.every(r=>r.init.credentials==='omit'&&r.init.redirect==='manual'&&r.init.signal));
 const b=(await discoverNews(fetcher,now+1000)).flatMap(r=>r.cards)[0];assert.equal(card.contentHash,b.contentHash);assert.notEqual(card.observedAt,b.observedAt);
});
test('daily retained candidates survive an index outage and remain metadata-reverified',async()=>{
 const row={...candidate(),indexedAt:new Date(now-3600000).toISOString()};let checked=0;
 const results=await discoverNews(async url=>String(url)===NEWS_INDEX_URL?new Response('unavailable',{status:503}):(checked++,htmlResponse(html(row))),now,[row]);
 assert.equal(checked,1);assert.equal(results.flatMap(r=>r.cards).length,1);assert.equal(results.find(r=>r.health.id==='news-technology').health.state,'partial');assert.equal(results.find(r=>r.health.id==='news-technology').health.error,null);assert.match(results[0].health.error,/NEWS_HTTP_503/);
});
test('admission failures cannot be reported as no-news success, and rejected candidates remain discovery only',async()=>{
 let stored;const result=await discoverNews(async url=>String(url)===NEWS_INDEX_URL?xmlResponse(rss()):htmlResponse(html(candidate(),{datePublished:undefined,dateModified:date})),now,[],async value=>{stored=value;});
 assert.equal(stored.length,1);assert.equal(result.flatMap(r=>r.cards).length,0);assert.equal(result.find(r=>r.health.id==='news-technology').health.error,'NEWS_PUBLICATION_METADATA_UNVERIFIED');
});
test('redirects remain within the same registered publisher and at most two hops',async()=>{
 let calls=0;const row=candidate();const blocked=await discoverNews(async url=>{if(String(url)===NEWS_INDEX_URL)return xmlResponse(rss());calls++;return new Response('',{status:302,headers:{location:'https://apnews.com/article/other'}});},now);
 assert.equal(calls,1);assert.equal(blocked.flatMap(r=>r.cards).length,0);assert.equal(blocked.find(r=>r.health.id==='news-technology').health.error,'NEWS_REDIRECT_REJECTED');
 calls=0;const redirected=await discoverNews(async url=>{if(String(url)===NEWS_INDEX_URL)return xmlResponse(rss());calls++;if(calls<=2)return new Response('',{status:302,headers:{location:`/technology/hop-${calls}`}});return htmlResponse(html(row));},now);
 assert.equal(calls,3);assert.equal(redirected.flatMap(r=>r.cards).length,1);
});
test('rate-limit and auth errors stop later calls to the same origin and preserve retry-after',async()=>{
 let articles=0;const rows=rowsByCategory(1);const result=await discoverNews(async url=>{if(String(url)===NEWS_INDEX_URL)return xmlResponse(rss(rows));articles++;return new Response('limited',{status:429,headers:{'retry-after':'120'}});},now,[],undefined,{concurrency:1});
 assert.equal(articles,1);assert.equal(result[0].health.retryAt,new Date(now+120000).toISOString());assert.equal(result.flatMap(r=>r.cards).length,0);
});
test('HTTP count, concurrency and stream byte budgets are enforced',async()=>{
 const rows=rowsByCategory(4),byUrl=new Map(rows.map(row=>[row.sourceUrl,row]));let calls=0,active=0,peak=0;
 const result=await discoverNews(async url=>{if(String(url)===NEWS_INDEX_URL)return xmlResponse(rss(rows));calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return htmlResponse(html(byUrl.get(String(url))));},now);
 assert.equal(calls,80);assert.ok(peak<=10);assert.equal(result.flatMap(r=>r.cards).length,80);
 const oversized=await discoverNews(async url=>String(url)===NEWS_INDEX_URL?xmlResponse(rss()):new Response('x',{headers:{'content-type':'text/html','content-length':'1048577'}}),now);
 assert.equal(oversized.flatMap(r=>r.cards).length,0);assert.equal(oversized.find(r=>r.health.id==='news-technology').health.error,'NEWS_PUBLICATION_METADATA_UNVERIFIED');
});
test('global deadline bounds even a fetcher that ignores abort, without20 repeated index timeouts',async()=>{
 let calls=0;const began=Date.now();const result=await discoverNews(async()=>{calls++;return new Promise(()=>{});},now,[],undefined,{deadlineMs:25,requestTimeoutMs:10});
 assert.ok(Date.now()-began<1000);assert.equal(calls,1);assert.equal(result.length,22);assert.ok(result.every(row=>row.health.state==='unavailable'&&row.health.error));
});

test('explicit mainEntityOfPage binds the record and stale JSONLD cannot be replaced by fresh OpenGraph',()=>{
 const row=candidate();
 assert.equal(readNewsArticleMetadata(html(row,{url:undefined,mainEntityOfPage:{'@id':'https://www.reuters.com/technology/different-article'}}),row,row.sourceUrl,now),null);
 const conflicting=html(row,{datePublished:'2026-11-18T18:00:00Z'})+`<meta property="og:title" content="${row.title}"><meta property="article:published_time" content="${date}">`;
 assert.equal(readNewsArticleMetadata(conflicting,row,row.sourceUrl,now),null);
});
test('a failed alternative cannot make an individually verified card unavailable to Share',async()=>{
 const good=candidate(),bad={...candidate('technology',1),sourceUrl:'https://www.bbc.com/technology/fixture-1',publisher:'BBC'};
 const result=await discoverNews(async url=>String(url)===NEWS_INDEX_URL?xmlResponse(rss([good,bad])):String(url).includes('bbc.com')?new Response('denied',{status:403}):htmlResponse(html(good)),now);
 const row=result.find(r=>r.health.id==='news-technology');assert.equal(row.cards.length,1);assert.equal(row.health.state,'partial');assert.equal(row.health.error,null);assert.equal(row.health.rejected,1);
});

test('reviewed publisher news sitemaps provide current English candidates but never borrowed article dates',()=>{
 const index=NEWS_DISCOVERY_INDEXES.find(row=>row.id==='guardian-news');
 const row={...candidate('family'),sourceUrl:'https://www.theguardian.com/lifeandstyle/parenting-story',publisher:'The Guardian'};
 const xml=`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>${row.sourceUrl}</loc><news:news><news:publication><news:name>Guardian</news:name><news:language>en</news:language></news:publication><news:publication_date>${date}</news:publication_date><news:title>${row.title}</news:title></news:news><lastmod>2026-11-20</lastmod></url></urlset>`;
 const found=readPublisherNewsCandidates(xml,index,now);assert.equal(found.length,1);assert.equal(found[0].category,'family');assert.equal(found[0].publisher,'The Guardian');assert.equal(found[0].publishedAt,undefined);
 assert.equal(readPublisherNewsCandidates(xml.replace(date,'2026-11-18T18:00:00Z'),index,now).length,0);
 assert.equal(readPublisherNewsCandidates(xml.replace('<news:language>en','<news:language>fr'),index,now).length,0);
 assert.equal(readPublisherNewsCandidates(xml.replace('www.theguardian.com','www.reuters.com'),index,now).length,0);
 assert.throws(()=>readPublisherNewsCandidates(xml,{...index,url:'https://attacker.invalid/index'},now),/NOT_REGISTERED/);
});

test('injected origin backoff respects Retry-After across acquisitions',async()=>{
 const originBackoff=new Map();let articles=0;
 const fetcher=async url=>{if(String(url)===NEWS_INDEX_URL)return xmlResponse(rss());articles++;return new Response('limited',{status:429,headers:{'retry-after':'3600'}});};
 await discoverNews(fetcher,now,[],undefined,{originBackoff});
 await discoverNews(fetcher,now+900000,[],undefined,{originBackoff});
 assert.equal(articles,1);assert.equal(originBackoff.get('https://www.reuters.com'),new Date(now+3600000).toISOString());
});

test('homepage provenance is added only to admitted exact canonical URLs without changing hashes',async()=>{
 const row={...candidate(),sourceUrl:'https://www.theguardian.com/technology/fixture',publisher:'The Guardian'};
 const fetcher=async url=>{
  const value=String(url);if(value===NEWS_INDEX_URL)return xmlResponse(rss([row]));
  if(['https://apnews.com/','https://www.theguardian.com/international','https://www.pcgamer.com/','https://www.bbc.com/news'].includes(value))return htmlResponse(`<main><a href="${row.sourceUrl}">${row.title}</a></main>`);
  return htmlResponse(html(row));
 };
 const baseline=await discoverNews(fetcher,now),featured=await discoverNews(fetcher,now,[],undefined,{frontpageHighlights:true});
 const a=baseline.flatMap(r=>r.cards)[0],b=featured.flatMap(r=>r.cards)[0];assert.ok(a&&b);assert.equal(a.contentHash,b.contentHash);assert.equal(a.id,b.id);
 assert.deepEqual(b.sourceIds,['news-technology','editorial-frontpage']);
 const health=featured.find(r=>r.health.id==='editorial-frontpage').health;assert.equal(health.count,1);assert.equal(health.error,null);assert.equal(featured.flatMap(r=>r.cards).length,1);
});

test('homepage-selected candidates enter the bounded verification queue before its global cut',async()=>{
 const rows=Array.from({length:8},(_,i)=>({...candidate('technology',i),sourceUrl:`https://www.theguardian.com/technology/fixture-${i}`,publisher:'The Guardian'})),chosen=rows[7],looked=[];
 const fetcher=async url=>{const value=String(url);if(value===NEWS_INDEX_URL)return xmlResponse(rss(rows));
  if(value==='https://www.theguardian.com/international')return htmlResponse(`<main><a href="${chosen.sourceUrl}">${chosen.title}</a></main>`);
  if(value==='https://apnews.com/'||value==='https://www.pcgamer.com/'||value==='https://www.bbc.com/news')return htmlResponse('<main></main>');
  looked.push(value);return htmlResponse(html(rows.find(row=>row.sourceUrl===value)));};
 const result=await discoverNews(fetcher,now,[],undefined,{frontpageHighlights:true,maxArticleRequests:4});assert.equal(looked.length,4);assert.equal(looked[0],chosen.sourceUrl);
 assert.ok(result.flatMap(r=>r.cards).find(card=>card.sourceUrl===chosen.sourceUrl)?.sourceIds.includes('editorial-frontpage'));
});
test('strong investigations keep the leading opportunity and admission while the bounded first pass varies publishers',async()=>{
 const strong=[0,1].map(i=>({...candidate('technology',i),sourceUrl:`https://www.theguardian.com/technology/inquiry-${i}`,publisher:'The Guardian',title:`Regulator investigates artificial intelligence software maker in region ${i}`}));
 const weak=[['Reuters','https://www.reuters.com'],['BBC','https://www.bbc.com'],['The Verge','https://www.theverge.com'],['TechCrunch','https://techcrunch.com']].map(([publisher,origin],i)=>({...candidate('technology',i+2),publisher,sourceUrl:`${origin}/technology/launch-${i}`}));
 const rows=[...weak,...strong],looked=[];
 const fetcher=async url=>{const value=String(url);if(value===NEWS_INDEX_URL)return xmlResponse(rss(rows));looked.push(value);return htmlResponse(html(rows.find(row=>row.sourceUrl===value)));};
  const result=await discoverNews(fetcher,now,[],undefined,{maxArticleRequests:4});
  assert.equal(looked.length,4);assert.equal(new Set(looked).size,4);
  assert.equal(looked[0],strong[0].sourceUrl,'the strongest investigation keeps the leading opportunity');
  assert.equal(new Set(looked.slice(0,3).map(url=>publisherForNewsUrl(url).id)).size,3,'the first three opportunities represent distinct publishers');
  assert.ok(strong.every(row=>looked.includes(row.sourceUrl)),'both strong originals are verified inside the same four-request budget');
 assert.ok(strong.every(row=>result.flatMap(r=>r.cards).some(card=>card.sourceUrl===row.sourceUrl)));
});
test('highest-priority development is verified before four weaker homepage candidates can fill its category',async()=>{
 const weak=Array.from({length:4},(_,i)=>({...candidate('technology',i),sourceUrl:`https://www.theguardian.com/technology/weak-${i}`,publisher:'The Guardian'}));
 const strong={...candidate(),sourceUrl:'https://www.reuters.com/technology/actual-inquiry',title:'Regulator investigates artificial intelligence software maker over export controls'};
 const rows=[...weak,strong],looked=[];
 const fetcher=async url=>{const value=String(url);if(value===NEWS_INDEX_URL)return xmlResponse(rss(rows));
  if(value==='https://www.theguardian.com/international')return htmlResponse(`<main>${weak.map(row=>`<a href="${row.sourceUrl}">${row.title}</a>`).join('')}</main>`);
  if(['https://apnews.com/','https://www.pcgamer.com/','https://www.bbc.com/news'].includes(value))return htmlResponse('<main></main>');
  looked.push(value);return htmlResponse(html(rows.find(row=>row.sourceUrl===value)));};
 const result=await discoverNews(fetcher,now,[],undefined,{frontpageHighlights:true,maxArticleRequests:4});assert.equal(looked.length,4);assert.equal(looked[0],strong.sourceUrl);
 const admitted=result.flatMap(row=>row.cards).find(row=>row.sourceUrl===strong.sourceUrl);assert.ok(admitted);assert.deepEqual(admitted.sourceIds,['news-technology']);
});
test('large article bodies retain only a bounded prefix and complete original metadata',async()=>{
 let cancelled=false;const row=candidate();const initial=new TextEncoder().encode(html(row)+'x'.repeat(1048576));
 const fetcher=async url=>String(url)===NEWS_INDEX_URL?xmlResponse(rss()):new Response(new ReadableStream({start(controller){controller.enqueue(initial);},cancel(){cancelled=true;}}),{headers:{'content-type':'text/html','content-length':'8000000'}});
 const result=await discoverNews(fetcher,now);assert.equal(result.flatMap(r=>r.cards).length,1);assert.equal(cancelled,true);
 const incomplete=`<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',headline:row.title,datePublished:date,url:row.sourceUrl})}`;
 assert.equal(readNewsArticleMetadata(incomplete,row,row.sourceUrl,now),null);
 const incompleteMeta=`<meta property="og:title" content="${row.title}"><meta property="article:published_time" content="${date}"`;
 assert.equal(readNewsArticleMetadata(incompleteMeta,row,row.sourceUrl,now),null);
});

test('tracking normalization agrees with archive SQL while preserving encoded parameter values',()=>{
 const base='https://www.reuters.com/world/story';
 assert.equal(canonicalNewsUrl(base+'?FBCLID=x&GCLID&MC_CID=x&MC_EID&utm_SOURCE=feed'),base);
 for(const name of ['%66bclid','arti%63le','%75tm_source'])assert.equal(canonicalNewsUrl(base+'?'+name+'=x'),null);
 assert.equal(canonicalNewsUrl(base+'?article=a%2Fb'),base+'?article=a%2Fb');
});


test('rotating publisher discovery batches cover the whole reviewed registry without duplicates or new hosts',()=>{
 const batchSize=7,windows=Math.ceil(NEWS_DISCOVERY_INDEXES.length/batchSize);
 const seen=new Set(),base=Math.floor(now/120_000)*120_000;
 const trusted=new Set(NEWS_DISCOVERY_INDEXES.map(x=>x.url));
 for(let cycle=0;cycle<windows;cycle++){
  const group=rotatedPublisherIndexes(base+cycle*120_000,batchSize);
  assert.ok(group.length>=1&&group.length<=batchSize);
  for(const item of group){assert.ok(trusted.has(item.url));assert.equal(seen.has(item.id),false);seen.add(item.id);}
 }
 assert.equal(seen.size,NEWS_DISCOVERY_INDEXES.length);
 assert.deepEqual(rotatedPublisherIndexes(base,7).map(x=>x.id),rotatedPublisherIndexes(base+windows*120_000,7).map(x=>x.id));
 assert.equal(rotatedPublisherIndexes(base).length,NEWS_DISCOVERY_INDEXES.length);
 for(const invalid of [0,-1,1.2,NaN,Infinity,NEWS_DISCOVERY_INDEXES.length+1]){
  assert.throws(()=>rotatedPublisherIndexes(base,invalid),/NEWS_INDEX_ROTATION_INVALID/u);
 }
 assert.throws(()=>rotatedPublisherIndexes(NaN,7),/NEWS_INDEX_ROTATION_INVALID/u);
});
test('one bounded discovery cycle fetches GDELT plus only its reviewed index rotation batch',async()=>{
 const calls=[],fetcher=async input=>{
  const url=String(input);calls.push(url);
  return url===NEWS_INDEX_URL?xmlResponse(rss([])):new Response('',{status:503});
 };
 const result=await discoverNewsWithDiagnostics(fetcher,now,[],undefined,{
  publisherIndexBatch:7,frontpageHighlights:false,maxArticleRequests:1,
 });
 assert.equal(calls.filter(x=>x===NEWS_INDEX_URL).length,1);
 assert.equal(calls.length,1+rotatedPublisherIndexes(now,7).length);
 assert.equal(result.diagnostics.indexes.length,calls.length);
 assert.ok(calls.filter(x=>x!==NEWS_INDEX_URL).every(x=>NEWS_DISCOVERY_INDEXES.some(row=>row.url===x)));
 assert.equal(result.diagnostics.totals.verifiedNow,0);
});
