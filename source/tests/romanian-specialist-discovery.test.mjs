import test from 'node:test';
import assert from 'node:assert/strict';
import {NEWS_DISCOVERY_INDEXES,NEWS_PUBLISHERS,canonicalNewsUrl,sourceLanguage,sourceEditionCountryCode} from '../.build/src/iceo/news-sources.js';
import {readPublisherNewsCandidates,readNewsArticleMetadata,discoverNewsWithDiagnostics} from '../.build/src/iceo/news-discovery.js';
import {validNewsDiagnostics} from '../.build/src/iceo/news-diagnostics.js';
import {photoPublisher} from '../.build/src/media/article-photo-source.js';
import {pressReviewCitation} from '../.build/src/iceo/source-links.js';
import {renderSharedCard} from '../.build/src/share/render.js';
import {parseDocument,DomUtils} from 'htmlparser2';
import {SPECIALIST_NOW as now,SPECIALIST_FEEDS as feeds,SPECIALIST_ROWS as rows,specialistFeed,specialistDocument,specialistFetcher} from './fixtures/romanian-specialists.mjs';
const index=id=>NEWS_DISCOVERY_INDEXES.find(value=>value.id===id+'-ro-news');
const candidate=row=>readPublisherNewsCandidates(specialistFeed(row.publisherId),index(row.publisherId),now).find(value=>value.sourceUrl===row.url);

test('Romanian additions require observed feed identity, explicit language and exact reviewed origins',()=>{
 for(const [id,feed] of Object.entries(feeds)){
  const config=index(id);assert.ok(config);assert.equal(config.url,feed.url);assert.equal(config.feedTitle,feed.title);assert.equal(config.feedHome,feed.home);
  assert.equal(config.language,'ro');assert.equal(config.requireCurrentFeed,true);assert.deepEqual(NEWS_PUBLISHERS.find(value=>value.id===id).origins,[feed.origin]);
  const found=readPublisherNewsCandidates(specialistFeed(id),config,now);assert.equal(found.length,2);
  for(const item of found){assert.equal(item.publisher,feed.publisher);assert.equal(sourceLanguage(item.sourceUrl),'ro');assert.equal(sourceEditionCountryCode(item.sourceUrl),'RO');}
  for(const invalid of [
   specialistFeed(id).replace('<title>'+feed.title+'</title>','<title>Another publisher</title>'),
   specialistFeed(id).replace('<language>ro-RO</language>','<language>en</language>'),
   specialistFeed(id).replace('<language>ro-RO</language>',''),
  ])assert.throws(()=>readPublisherNewsCandidates(invalid,config,now),/IDENTITY_INVALID/);
  const changed=rows.filter(row=>row.publisherId===id).map(row=>({...row,rssDate:'Mon, 23 Nov 2026 18:00:00 +0000'}));
  assert.equal(readPublisherNewsCandidates(specialistFeed(id,changed),config,now).length,0);
 }
 assert.equal(canonicalNewsUrl('https://spotmedia.ro/terms'),null);
 assert.equal(canonicalNewsUrl('https://www.spotmedia.ro/stiri/example'),null);
 assert.equal(canonicalNewsUrl('https://descopera.ro/stiinta/example'),null);
});
test('four observed originals retain exact headlines, dates and canonical subject evidence without body or image rights',()=>{
 for(const row of rows){
  const item=candidate(row);assert.ok(item);
  const metadata=readNewsArticleMetadata(specialistDocument(row),item,row.url,now);assert.ok(metadata);
  assert.equal(metadata.sourceUrl,row.url);assert.equal(metadata.title,row.title);assert.equal(metadata.date,new Date(row.date).toISOString());
  assert.equal(metadata.summary,undefined);assert.equal(metadata.image,undefined);assert.equal(metadata.licenseUrl,undefined);
  assert.equal(photoPublisher(row.url),null);
  assert.equal(readNewsArticleMetadata(specialistDocument(row,{}, {date:'2026-11-24T15:00:00Z'}),item,row.url,now),null);
  assert.equal(readNewsArticleMetadata(specialistDocument(row,{datePublished:undefined},{date:null}),item,row.url,now),null);
  assert.equal(readNewsArticleMetadata(specialistDocument(row,{}, {canonical:'https://attacker.invalid/story'}),item,row.url,now),null);
 }
});
test('explicit sponsored RSS sections are excluded without rejecting journalism about advertising',()=>{
 const row=rows[0],config=index(row.publisherId);
 for(const marker of ['Advertorial','PUBLICITATE','Conținut sponsorizat','Sponsored Content','(P)']){
  assert.equal(readPublisherNewsCandidates(specialistFeed(row.publisherId,[{...row,categories:[...row.categories,marker]}]),config,now).length,0,marker);
 }
 assert.equal(readPublisherNewsCandidates(specialistFeed(row.publisherId,[{...row,title:'Cercetatorii analizeaza efectele publicitatii asupra consumatorilor',categories:['Știință']}]),config,now).length,1);
});
test('bound promotional metadata vetoes fallback while unrelated recommendations do not contaminate the original',()=>{
 const row=rows[0],item=candidate(row);
 for(const changes of [{articleSection:['Advertorial']},{sponsor:{'@type':'Organization',name:'Example sponsor'}},{sponsor:'Example sponsor'}])
  assert.equal(readNewsArticleMetadata(specialistDocument(row,changes),item,row.url,now),null);
 assert.equal(readNewsArticleMetadata(specialistDocument(row,{}, {section:'Material sponsorizat'}),item,row.url,now),null);
 const unrelated='<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',url:rows[1].url,headline:rows[1].title,datePublished:row.date,articleSection:'Advertorial',sponsor:{name:'Advertiser'}})+'</script>';
 assert.ok(readNewsArticleMetadata(specialistDocument(row,{keywords:'publicitate, sponsorizare'},{extra:unrelated}),item,row.url,now));
 assert.ok(readNewsArticleMetadata(specialistDocument(row,{sponsor:null}),item,row.url,now));
});
test('bounded acquisition admits originals and each share page keeps linked source attribution',async()=>{
 const result=await discoverNewsWithDiagnostics(specialistFetcher,now,[],undefined,{frontpageHighlights:false,maxArticleRequests:4});
 const cards=result.sources.flatMap(source=>source.cards);assert.equal(cards.length,4);assert.ok(validNewsDiagnostics(result.diagnostics,now));
 assert.equal(result.diagnostics.totals.requestAttempts,4);
 for(const card of cards){
  const citation=pressReviewCitation(card.sourceUrl);assert.ok(citation);
  const html=renderSharedCard({card,insight:null,now,validUntil:now+60000,changed:false,partial:false});
  const doc=parseDocument(html),links=DomUtils.getElementsByTagName('a',doc,true);
  assert.ok(links.some(link=>link.attribs.href===citation.homeUrl&&DomUtils.textContent(link)===citation.label));
  assert.ok(links.some(link=>link.attribs.href===card.sourceUrl&&DomUtils.textContent(link)===citation.originalLabel));
  assert.ok(html.indexOf(citation.label)<html.indexOf('<h1>'),'source citation precedes reused headline');
  assert.equal(DomUtils.getElementsByTagName('img',doc,true).filter(node=>node.attribs['data-article-photo']).length,0,'title/date/link-only sources request no original photograph');
  assert.equal(card.summary,undefined);assert.equal(card.byline,undefined);assert.equal(card.licenseUrl,undefined);
 }
 for(const url of ['https://www.descopera.ro.attacker.invalid/stiinta/story','https://user@www.descopera.ro/stiinta/story','http://spotmedia.ro/stiri/story','https://spotmedia.ro/api/story','https://www.descopera.ro/'])
  assert.equal(pressReviewCitation(url),null,url);
});

test('a current explicit RSS promotion veto survives GAL, stored seeds and retained observations',async()=>{
 const row=rows[0],seed=candidate(row);
 const previous=await discoverNewsWithDiagnostics(specialistFetcher,now,[],undefined,{frontpageHighlights:false,maxArticleRequests:4});
 const retained=previous.sources.flatMap(source=>source.cards),before=JSON.stringify(retained);
 let requests=0,persisted;
 const fetcher=async input=>{
  const url=String(input);
  if(url===feeds[row.publisherId].url)return new Response(specialistFeed(row.publisherId,rows.filter(value=>value.publisherId===row.publisherId).map(value=>value.url===row.url?{...value,categories:['Advertorial']}:value)),{headers:{'content-type':'application/rss+xml'}});
  if(url==='https://data.gdeltproject.org/gdeltv3/gal/feed.rss')return new Response('<rss><channel><title>GDELT Article List RSS Feed</title><link>'+url+'</link><lastBuildDate>'+new Date(now).toUTCString()+'</lastBuildDate><item><title>'+row.title+'</title><link>'+row.url+'</link></item></channel></rss>',{headers:{'content-type':'application/rss+xml'}});
  if(url===row.url)requests++;
  return specialistFetcher(input);
 };
 const result=await discoverNewsWithDiagnostics(fetcher,now,[seed],async values=>{persisted=values;},{frontpageHighlights:false,maxArticleRequests:1,retainedCards:retained});
 assert.equal(requests,0,'the known promotional original is never revalidated or reintroduced');
 assert.ok(persisted);assert.equal(persisted.some(value=>value.sourceUrl===row.url),false);
 const cards=result.sources.flatMap(source=>source.cards);
 assert.equal(cards.some(value=>value.sourceUrl===row.url),false);
 assert.ok(cards.some(value=>value.sourceUrl!==row.url),'distinct legitimate originals remain available');
 assert.equal(JSON.stringify(retained),before,'retained source timestamps and records are not mutated');
 assert.ok(validNewsDiagnostics(result.diagnostics,now));
});
test('only a valid current exact-origin RSS entry can declare a promotional original',()=>{
 const row=rows[0],config=index(row.publisherId),rejected=[];
 const callback=url=>rejected.push(url);
 const invalidRows=[{...row,url:row.url.replace('www.descopera.ro','attacker.invalid'),categories:['Advertorial']},{...row,rssDate:'Mon, 23 Nov 2026 18:00:00 +0000',categories:['Advertorial']}];
 assert.equal(readPublisherNewsCandidates(specialistFeed(row.publisherId,invalidRows),config,now,callback).length,0);
 assert.deepEqual(rejected,[]);
 assert.throws(()=>readPublisherNewsCandidates(specialistFeed(row.publisherId,[{...row,categories:['Advertorial']}]).replace('<title>Descopera</title>','<title>Forged</title>'),config,now,callback),/IDENTITY_INVALID/);
 assert.deepEqual(rejected,[]);
});

test('reviewed feed admission prevents a promotion returning from unchanged cache and GAL on the next rotation',async()=>{
 const previous=await discoverNewsWithDiagnostics(specialistFetcher,now,[],undefined,{frontpageHighlights:false,maxArticleRequests:4});
 const previousCards=previous.sources.flatMap(source=>source.cards);
 const cache=rows.map(candidate);
 for(const id of Object.keys(feeds)){
  const row=rows.find(value=>value.publisherId===id);
  const vetoFetcher=async input=>String(input)===feeds[id].url
   ?new Response(specialistFeed(id,rows.filter(value=>value.publisherId===id).map(value=>value.url===row.url?{...value,categories:['Advertorial']}:value)),{headers:{'content-type':'application/rss+xml'}})
   :specialistFetcher(input);
  const first=await discoverNewsWithDiagnostics(vetoFetcher,now,cache,undefined,{frontpageHighlights:false,maxArticleRequests:4,retainedCards:previousCards});
  const firstCards=first.sources.flatMap(source=>source.cards);
  assert.equal(firstCards.some(card=>card.sourceUrl===row.url),false);
  const later=now+120000,attempted=[];
  const laterFetcher=async input=>{
   const url=String(input);attempted.push(url);
   if(url==='https://data.gdeltproject.org/gdeltv3/gal/feed.rss')return new Response('<rss><channel><title>GDELT Article List RSS Feed</title><link>'+url+'</link><lastBuildDate>'+new Date(later).toUTCString()+'</lastBuildDate><item><title>'+row.title+'</title><link>'+row.url+'</link></item></channel></rss>',{headers:{'content-type':'application/rss+xml'}});
   return specialistFetcher(input);
  };
  const second=await discoverNewsWithDiagnostics(laterFetcher,later,cache,undefined,{publisherIndexes:false,frontpageHighlights:false,maxArticleRequests:4,retainedCards:firstCards});
  const secondCards=second.sources.flatMap(source=>source.cards);
  assert.equal(secondCards.some(card=>card.sourceUrl===row.url),false,id);
  assert.equal(attempted.some(url=>rows.some(value=>value.url===url)),false,'unconfirmed cached originals consume no article requests');
  assert.equal(second.diagnostics.totals.requestAttempts,0);
  assert.equal(second.diagnostics.totals.deferredCapacity,cache.length);
  assert.ok(second.diagnostics.groups.every(group=>group.counts.pool===0||group.reasons.some(reason=>reason.code==='index-unavailable')));
  for(const retained of firstCards){
   const kept=secondCards.find(card=>card.sourceUrl===retained.sourceUrl);
   assert.ok(kept,'legitimate cards survive feed rotation');assert.equal(kept.observedAt,retained.observedAt);assert.equal(kept.contentHash,retained.contentHash);
  }
  assert.ok(validNewsDiagnostics(second.diagnostics,later));
 }
});
