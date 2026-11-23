import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NEWS_DISCOVERY_INDEXES,NEWS_PUBLISHERS,canonicalNewsUrl,publisherForNewsUrl,sourceLanguage,sourceEditionCountryCode,sourcePublicationContext} from '../.build/src/iceo/news-sources.js';
import {readPublisherNewsCandidates,readNewsArticleMetadata,discoverNewsWithDiagnostics,validateNewsCandidate} from '../.build/src/iceo/news-discovery.js';
import {validNewsDiagnostics} from '../.build/src/iceo/news-diagnostics.js';
import {cardContent,validCard} from '../.build/src/iceo/card-validation.js';
import {PROTV_NOW as now,PROTV_ROWS as rows,PROTV_PUBLISHER as publisher,protvFeed as feed,protvDocument as document,protvFetcher} from './fixtures/protv-news.mjs';
const index=NEWS_DISCOVERY_INDEXES.find(value=>value.id==='stirile-protv-ro-news');

test('ProTV requires the exact reviewed RSS channel and Romanian original article paths',()=>{
 assert.ok(index);assert.equal(index.language,'ro');assert.equal(index.feedTitle,publisher);
 assert.equal(index.feedHome,'https://stirileprotv.ro');assert.equal(index.articlePath,'/stiri/');
 assert.deepEqual(NEWS_PUBLISHERS.find(value=>value.id==='stirile-protv').origins,['https://stirileprotv.ro']);
 const found=readPublisherNewsCandidates(feed(),index,now);assert.equal(found.length,2);
 for(const row of found){
  assert.equal(row.publisher,publisher);assert.equal(sourceLanguage(row.sourceUrl),'ro');assert.equal(sourceEditionCountryCode(row.sourceUrl),'RO');
  assert.deepEqual(Object.keys(row).sort(),['category','indexedAt','publisher','sourceUrl','title']);
  assert.equal(sourcePublicationContext(row.sourceUrl).city,undefined,'edition provenance does not establish a city');
 }
 for(const changed of [
  feed().replace('<title>Știrile ProTV</title>','<title>ProTV</title>'),
  feed().replace('<link>https://stirileprotv.ro</link>','<link>https://www.stirileprotv.ro</link>'),
  feed().replace('<language>ro-ro</language>','<language>en</language>'),
  feed().replace('<language>ro-ro</language>',''),
 ])assert.throws(()=>readPublisherNewsCandidates(changed,index,now),/NEWS_INDEX_IDENTITY_INVALID/);
 for(const host of ['www.stirileprotv.ro','rss.stirileprotv.ro','ilikeit.stirileprotv.ro','stirileprotv.ro.attacker.invalid']){
  const url=rows[0].url.replace('stirileprotv.ro',host);
  assert.equal(publisherForNewsUrl(url),null);assert.equal(canonicalNewsUrl(url),null);
  assert.equal(readPublisherNewsCandidates(feed([{...rows[0],url}]),index,now).length,0);
 }
 for(const path of ['/virale/story.html','/cautare/story.html','/stiri','/Stiri/story.html','/stiri/../virale/story.html']){
  const url='https://stirileprotv.ro'+path;
  assert.equal(canonicalNewsUrl(url),null);
  assert.equal(readPublisherNewsCandidates(feed([{...rows[0],url}]),index,now).length,0);
  assert.equal(validateNewsCandidate({...found[0],sourceUrl:url},now),null);
 }
 assert.equal(readPublisherNewsCandidates(feed(rows.map(row=>({...row,rssDate:'Fri, 20 Nov 2026 21:00:00 +0000'}))),index,now).length,0);
});

test('native ProTV metadata binds headline, canonical original and equivalent explicit offsets',()=>{
 const found=readPublisherNewsCandidates(feed(),index,now);
 for(const row of rows){
  const candidate=found.find(value=>value.sourceUrl===row.url);
  const metadata=readNewsArticleMetadata(document(row),candidate,row.url,now);
  assert.ok(metadata);assert.equal(metadata.title,row.title);assert.equal(metadata.sourceUrl,row.url);
  assert.equal(metadata.date,new Date(row.date).toISOString());assert.equal(metadata.publisher,publisher);
  assert.deepEqual(metadata.articleSubject,{basis:'publisher-jsonld',articleUrl:row.url,sections:[row.section],keywords:[]});
  assert.equal(metadata.image,undefined);assert.equal(metadata.summary,undefined);assert.equal(metadata.licenseUrl,undefined);
  assert.equal(readNewsArticleMetadata(document(row,{mainEntityOfPage:{'@id':rows.find(other=>other!==row).url}},null),candidate,row.url,now),null);
  assert.equal(readNewsArticleMetadata(document(row,{datePublished:undefined},null),candidate,row.url,now),null,'dateModified is not publication time');
  assert.equal(readNewsArticleMetadata(document(row,{datePublished:'2026-11-20T20:00:00Z'},null),candidate,row.url,now),null);
  assert.equal(readNewsArticleMetadata(document(row,{headline:'Un subiect complet diferit, fara legatura cu articolul verificat'},null),candidate,row.url,now),null);
  assert.equal(readNewsArticleMetadata(document(row,{},'2026-11-23T23:10:00+02:00'),candidate,row.url,now),null,'conflicting accepted original dates fail closed');
 }
});

test('ProTV uses the existing bounded collector, hashes and private diagnostics without copying article bodies',async()=>{
 const requested=[];
 const result=await discoverNewsWithDiagnostics(async input=>{requested.push(String(input));return protvFetcher(input);},now,[],undefined,{frontpageHighlights:false,maxArticleRequests:2});
 const cards=result.sources.flatMap(source=>source.cards);assert.equal(cards.length,2);
 assert.equal(requested.filter(url=>rows.some(row=>row.url===url)).length,2);
 for(const row of rows){
  const card=cards.find(value=>value.sourceUrl===row.url);assert.ok(validCard(card));
  assert.equal(card.title,row.title);assert.equal(card.date,new Date(row.date).toISOString());assert.equal(card.identity,row.url);
  assert.equal(card.publisher,publisher);assert.equal(sourceLanguage(card),'ro');
  assert.equal(card.contentHash,createHash('sha256').update(JSON.stringify(cardContent(card))).digest('hex'));
  assert.equal(card.summary,undefined);assert.equal(card.image,undefined);assert.equal(card.licenseUrl,undefined);
 }
 assert.ok(validNewsDiagnostics(result.diagnostics,now));
 assert.ok(result.diagnostics.indexes.some(value=>value.indexId===index.id&&value.publisherId==='stirile-protv'&&value.language==='ro'&&value.state==='verified'));
 assert.equal(result.diagnostics.totals.verifiedNow,2);assert.equal(result.diagnostics.totals.requestAttempts,2);
 assert.equal(JSON.stringify(cards).includes('Article body must never be retained'),false);
 assert.equal(JSON.stringify(cards).includes('Do not retain this excerpt'),false);
});
