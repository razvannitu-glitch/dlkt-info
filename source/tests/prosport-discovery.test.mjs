import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NEWS_DISCOVERY_INDEXES,NEWS_PUBLISHERS,canonicalNewsUrl,publisherForNewsUrl,sourceLanguage,sourceEditionCountryCode,publisherComparisonHeadline} from '../.build/src/iceo/news-sources.js';
import {readPublisherNewsCandidates,readNewsArticleMetadata,discoverNewsWithDiagnostics,matchingNewsHeadline,newsAcquisitionOrder,NEWS_ACQUISITION_ROTATION_MS} from '../.build/src/iceo/news-discovery.js';
import {validNewsDiagnostics} from '../.build/src/iceo/news-diagnostics.js';
import {cardContent,validCard} from '../.build/src/iceo/card-validation.js';
import {PROSPORT_NOW as now,PROSPORT_ROWS as rows,PROSPORT_PUBLISHER as publisher,prosportFeed as feed,prosportDocument as document,prosportFetcher} from './fixtures/prosport-news.mjs';
const index=NEWS_DISCOVERY_INDEXES.find(value=>value.id==='prosport-ro-news');
const prefix='DECLARAȚII ';

test('ProSport requires its exact declared RSS channel and reviewed Romanian original origin',()=>{
 assert.ok(index);assert.equal(index.language,'ro');assert.equal(index.feedTitle,'Prosport');
 assert.equal(index.feedHome,'https://www.prosport.ro');assert.equal(index.articlePath,'/');
 assert.deepEqual(NEWS_PUBLISHERS.find(value=>value.id==='prosport').origins,['https://www.prosport.ro']);
 const found=readPublisherNewsCandidates(feed(),index,now);assert.equal(found.length,2);
 for(const candidate of found){
  assert.equal(candidate.publisher,publisher);assert.equal(sourceLanguage(candidate.sourceUrl),'ro');assert.equal(sourceEditionCountryCode(candidate.sourceUrl),'RO');
  assert.deepEqual(Object.keys(candidate).sort(),['category','indexedAt','publisher','sourceUrl','title']);
 }
 for(const changed of [
  feed().replace('<title>Prosport</title>','<title>ProSport</title>'),
  feed().replace('<link>https://www.prosport.ro</link>','<link>https://prosport.ro</link>'),
  feed().replace('<language>ro-RO</language>','<language>en</language>'),
  feed().replace('<language>ro-RO</language>',''),
 ])assert.throws(()=>readPublisherNewsCandidates(changed,index,now),/NEWS_INDEX_IDENTITY_INVALID/);
 for(const host of ['prosport.ro','rss.prosport.ro','www.prosport.ro.attacker.invalid']){
  const url=rows[0].url.replace('www.prosport.ro',host);
  assert.equal(publisherForNewsUrl(url),null);assert.equal(canonicalNewsUrl(url),null);
  assert.equal(readPublisherNewsCandidates(feed([{...rows[0],url}]),index,now).length,0);
 }
 assert.equal(readPublisherNewsCandidates(feed(rows.map(row=>({...row,rssDate:'Fri, 20 Nov 2026 21:00:00 +0000'}))),index,now).length,0);
});

test('only the exact leading ProSport editorial label is normalized for comparison',()=>{
 const title=rows[1].title;
 assert.equal(rows[1].rssTitle,prefix+title,'fixture preserves the observed eleven-character RSS prefix');
 assert.equal(publisherComparisonHeadline(prefix+title,'prosport'),title);
 assert.ok(matchingNewsHeadline(prefix+title,title,publisher,'ro'));
 for(const id of NEWS_PUBLISHERS.filter(value=>value.id!=='prosport').map(value=>value.id))assert.equal(publisherComparisonHeadline(prefix+title,id),prefix+title);
 for(const otherPublisher of ['Digi24','HotNews.ro','Știrile ProTV'])assert.equal(matchingNewsHeadline(prefix+title,title,otherPublisher,'ro'),false);
 for(const altered of [
  'DECLARATII '+title,'Declarații '+title,'DECLARAȚII: '+title,prefix+prefix+title,
  title.replace('Anunț','Anunț DECLARAȚII'),prefix+title.replace('venirea','nu venirea'),
  prefix+title.replace('Mirel Rădoi','Dan Petrescu'),prefix+title+' 2',
 ])assert.equal(matchingNewsHeadline(altered,title,publisher,'ro'),false,altered);
});

test('the two observed ProSport originals keep primary titles, canonical identities and original dates',()=>{
 const found=readPublisherNewsCandidates(feed(),index,now);
 for(const row of rows){
  const candidate=found.find(value=>value.sourceUrl===row.url);
  const metadata=readNewsArticleMetadata(document(row),candidate,row.url,now);
  assert.ok(metadata);assert.equal(metadata.title,row.title);assert.equal(metadata.sourceUrl,row.url);
  assert.equal(metadata.date,new Date(row.date).toISOString());assert.equal(metadata.publisher,publisher);
  assert.deepEqual(metadata.articleSubject,{basis:'publisher-jsonld',articleUrl:row.url,sections:[...row.sections].sort(),keywords:[]});
  assert.equal(metadata.summary,undefined);assert.equal(metadata.image,undefined);assert.equal(metadata.licenseUrl,undefined);
  assert.equal(readNewsArticleMetadata(document(row,{mainEntityOfPage:rows.find(other=>other!==row).url},{ogDate:null}),candidate,row.url,now),null);
  assert.equal(readNewsArticleMetadata(document(row,{datePublished:undefined},{ogDate:null}),candidate,row.url,now),null,'dateModified cannot replace publication time');
  assert.equal(readNewsArticleMetadata(document(row,{datePublished:'2026-11-20T20:00:00Z'},{ogDate:null}),candidate,row.url,now),null);
  assert.equal(readNewsArticleMetadata(document(row,{datePublished:'2026-11-24T02:00:00Z'},{ogDate:null}),candidate,row.url,now),null);
  assert.equal(readNewsArticleMetadata(document(row,{}, {ogTitle:row.title,ogDate:'2026-11-23T22:30:00Z'}),candidate,row.url,now),null,'conflicting bound publication dates still fail closed');
  assert.equal(readNewsArticleMetadata(document(row,{}, {canonical:row.url.replace('www.prosport.ro','attacker.invalid')}),candidate,row.url,now),null);
 }
 assert.equal(found.find(candidate=>candidate.sourceUrl===rows[1].url).title.startsWith(prefix),true,'discovery retains the publisher RSS wording');
});

test('ProSport label normalization never accepts changed numbers, negation or a different subject',()=>{
 const cases=[
  [rows[0],rows[0].title.replace('3-0','4-0')],
  [rows[1],prefix+rows[1].title.replace('venirea','nu venirea')],
  [rows[1],prefix+rows[1].title.replace('Mirel Rădoi','Dan Petrescu')],
  [rows[1],rows[1].title.replace('Anunț','Anunț DECLARAȚII')],
 ];
 for(const [row,rssTitle] of cases){
  const candidate=readPublisherNewsCandidates(feed([{...row,rssTitle}]),index,now)[0];assert.ok(candidate);
  assert.equal(readNewsArticleMetadata(document(row),candidate,row.url,now),null,rssTitle);
 }
});

test('ProSport uses existing finite acquisition, exact hashes and private diagnostics without article bodies',async()=>{
 const requested=[];
 const result=await discoverNewsWithDiagnostics(async input=>{requested.push(String(input));return prosportFetcher(input);},now,[],undefined,{frontpageHighlights:false,maxArticleRequests:2});
 const cards=result.sources.flatMap(source=>source.cards);assert.equal(cards.length,2);
 assert.equal(requested.filter(url=>rows.some(row=>row.url===url)).length,2);
 for(const row of rows){
  const card=cards.find(value=>value.sourceUrl===row.url);assert.ok(validCard(card));
  assert.equal(card.title,row.title);assert.equal(card.date,new Date(row.date).toISOString());assert.equal(card.identity,row.url);
  assert.equal(card.publisher,publisher);assert.equal(sourceLanguage(card),'ro');
  assert.equal(card.contentHash,createHash('sha256').update(JSON.stringify(cardContent(card))).digest('hex'));
  assert.equal(card.summary,undefined);assert.equal(card.image,undefined);
 }
 assert.ok(validNewsDiagnostics(result.diagnostics,now));
 assert.ok(result.diagnostics.indexes.some(value=>value.indexId===index.id&&value.publisherId==='prosport'&&value.language==='ro'&&value.state==='verified'));
 assert.equal(result.diagnostics.totals.verifiedNow,2);assert.equal(result.diagnostics.totals.requestAttempts,2);
 assert.equal(JSON.stringify(cards).includes('Article body must never be retained'),false);
 assert.equal(JSON.stringify(cards).includes('Do not retain this excerpt'),false);
});

test('the same shared comparison keeps ProSport editorial labels from triggering unchanged reverification',async()=>{
 const result=await discoverNewsWithDiagnostics(prosportFetcher,now,[],undefined,{frontpageHighlights:false,maxArticleRequests:2});
 const cards=result.sources.flatMap(source=>source.cards);assert.equal(cards.length,2);
 const candidates=readPublisherNewsCandidates(feed(),index,now);
 for(let slot=1;slot<=4;slot++)assert.deepEqual(newsAcquisitionOrder(candidates,2,now+slot*NEWS_ACQUISITION_ROTATION_MS,new Set(),cards),[]);
 const changed=readPublisherNewsCandidates(feed([{...rows[1],rssTitle:prefix+rows[1].title+' dupa un anunt nou'}]),index,now);
 assert.equal(newsAcquisitionOrder(changed,2,now+NEWS_ACQUISITION_ROTATION_MS,new Set(),cards)[0]?.sourceUrl,rows[1].url,'a substantive headline revision stays eligible');
});
