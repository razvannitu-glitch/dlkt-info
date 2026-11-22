import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NEWS_DISCOVERY_INDEXES,NEWS_PUBLISHERS,publisherForNewsUrl,sourceLanguage,sourceEditionCountryCode} from '../.build/src/iceo/news-sources.js';
import {readPublisherNewsCandidates,readNewsArticleMetadata,matchingNewsHeadline,discoverNewsWithDiagnostics} from '../.build/src/iceo/news-discovery.js';
import {validNewsDiagnostics} from '../.build/src/iceo/news-diagnostics.js';
import {cardContent,validCard} from '../.build/src/iceo/card-validation.js';
import {newsCategory} from '../.build/src/iceo/news-taxonomy.js';

// Metadata-only receipt: Actions 45070034177, job137354713875, 2026-11-22.
// Official syndication guidance: https://www.repubblica.it/static/servizi/rss/
// The feed does not grant a licence to copy an article body or its image.
const checkedAt='2026-11-22T21:05:04.970Z',now=Date.parse(checkedAt);
const rows=[
 {url:'https://www.repubblica.it/esteri/2026/11/22/news/trump_kim_i_tentativi_del_presidente_usa_di_incontrare_il_leader_nordcoreano-425742784/',
  indexed:'Telefonate respinte e una lettera cestinata. Tutti i rifiuti di Kim-Jong a Trump',
  title:'Telefonate respinte e una lettera cestinata. Tutti i rifiuti di Kim-Jong a Trump',
  rssDate:'Sun, 22 Nov 2026 20:53:48 +0000',date:'2026-11-22T20:53:48Z',modified:'2026-11-22T20:53:48Z',section:'Esteri',
  image:'https://www.repstatic.it/content/nazionale/img/2026/11/22/215338120-6a5df074-0659-417b-acbe-fbbae984504b.jpg'},
 {url:'https://www.repubblica.it/politica/2026/11/22/news/beppe_grillo_fazio_m5s_conte_di_battista_di_maio-425742775/',
  indexed:'Grillo da Fazio: “Se mi ridanno il simbolo 5S, lo dò a minori di 25 anni. Pronto ad aiutare Dibba”',
  title:'Grillo da Fazio: “Se mi ridanno il simbolo 5S, lo darò a minori di 25 anni. Pronto ad aiutare Dibba”',
  rssDate:'Sun, 22 Nov 2026 20:47:54 +0000',date:'2026-11-22T20:47:54Z',modified:'2026-11-22T20:51:28Z',section:'Politica',
  image:'https://www.repstatic.it/content/nazionale/img/2026/11/22/214743530-850103cf-b9b7-42c2-beb0-1692d0bae645.jpg'},
];
const index=NEWS_DISCOVERY_INDEXES.find(value=>value.id==='repubblica-it-news');
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const feed=(entries=rows)=>'<rss version="2.0"><channel><title>Repubblica.it</title><link>https://repubblica.it</link><language>it-it</language><lastBuildDate>Sun, 22 Nov 2026 22:02:32 +0100</lastBuildDate>'+
 entries.map(row=>'<item><title>'+escape(row.indexed)+'</title><link>'+escape(row.url)+'</link><pubDate>'+row.rssDate+'</pubDate><category>'+row.section+'</category><description>Do not retain this article excerpt.</description></item>').join('')+'</channel></rss>';
const document=(row,patch={})=>'<!doctype html><html lang="it"><head><link rel="canonical" href="'+row.url+'"><script type="application/ld+json">'+JSON.stringify({
 '@context':'https://schema.org','@type':'NewsArticle',headline:row.title,datePublished:row.date,dateModified:row.modified,
 mainEntityOfPage:{'@type':'webpage','@id':row.url},articleSection:row.section,
 image:{'@type':'ImageObject','@context':'http://schema.org',url:row.image,width:1600,height:900},...patch,
})+'</script></head><body>Article body must never be retained.</body></html>';

test('the reviewed Italian RSS identity admits only the exact original article origin',()=>{
 assert.ok(index);assert.equal(index.language,'it');assert.equal(index.feedHome,'https://repubblica.it');
 assert.deepEqual(NEWS_PUBLISHERS.find(row=>row.id==='repubblica').origins,['https://www.repubblica.it']);
 const found=readPublisherNewsCandidates(feed(),index,now);assert.equal(found.length,2);
 assert.deepEqual(new Set(found.map(row=>row.sourceUrl)),new Set(rows.map(row=>row.url)));
 for(const row of found){
  assert.equal(row.publisher,'la Repubblica');assert.equal(sourceLanguage(row.sourceUrl),'it');assert.equal(sourceEditionCountryCode(row.sourceUrl),'IT');
  assert.deepEqual(Object.keys(row).sort(),['category','indexedAt','publisher','sourceUrl','title']);
 }
 for(const changed of [
  feed().replace('<title>Repubblica.it</title>','<title>Another publisher</title>'),
  feed().replace('<link>https://repubblica.it</link>','<link>https://www.repubblica.it/</link>'),
  feed().replace('<language>it-it</language>','<language>en</language>'),
  feed().replace('<language>it-it</language>',''),
 ])assert.throws(()=>readPublisherNewsCandidates(changed,index,now),/NEWS_INDEX_IDENTITY_INVALID/);
 for(const host of ['repubblica.it','video.repubblica.it','www.repubblica.it.attacker.invalid','www.ansa.it','www.rainews.it']){
  assert.equal(publisherForNewsUrl('https://'+host+'/politica/story'),null);
  assert.equal(readPublisherNewsCandidates(feed(rows.map(row=>({...row,url:row.url.replace('www.repubblica.it',host)}))),index,now).length,0);
 }
 assert.equal(readPublisherNewsCandidates(feed(rows.map(row=>({...row,rssDate:'Fri, 20 Nov 2026 20:00:00 +0000'}))),index,now).length,0);
});

test('real canonical metadata keeps the publisher revised Italian headline and original publication time',()=>{
 const found=readPublisherNewsCandidates(feed(),index,now);
 for(const row of rows){
  const candidate=found.find(value=>value.sourceUrl===row.url),metadata=readNewsArticleMetadata(document(row),candidate,row.url,now);
  assert.ok(metadata);assert.equal(metadata.title,row.title);assert.equal(metadata.sourceUrl,row.url);
  assert.equal(metadata.date,new Date(row.date).toISOString());assert.equal(metadata.publisher,'la Repubblica');
  assert.deepEqual(metadata.articleSubject,{basis:'publisher-jsonld',articleUrl:row.url,sections:[row.section],keywords:[]});
  assert.equal(metadata.image,undefined);assert.equal(metadata.licenseUrl,undefined);assert.equal(metadata.summary,undefined);
  assert.equal(readNewsArticleMetadata(document(row,{mainEntityOfPage:{'@id':rows.find(value=>value!==row).url}}),candidate,row.url,now),null);
  assert.equal(readNewsArticleMetadata(document(row,{datePublished:undefined}),candidate,row.url,now),null,'dateModified cannot replace publication time');
  assert.equal(readNewsArticleMetadata(document(row,{datePublished:'2026-11-20T20:00:00Z'}),candidate,row.url,now),null);
 }
 const revised=rows[1];assert.notEqual(revised.indexed,revised.title);assert.notEqual(revised.date,revised.modified);
 assert.equal(matchingNewsHeadline(revised.indexed,revised.title,'la Repubblica','it'),true);
});

test('Italian title matching protects explicit negations and numeric conditions',()=>{
 const base='Il governo approva la nuova proposta per il settore turistico';
 for(const negative of ['non','mai','senza','nessuno','nessuna','nessun','neppure','nemmeno','neanche','mica','né']){
  const changed=base.replace('approva',negative+' approva');
  assert.equal(matchingNewsHeadline(base,changed,'la Repubblica','it'),false,negative);
  assert.equal(matchingNewsHeadline(changed,base,'la Repubblica','it'),false,negative);
 }
 assert.equal(matchingNewsHeadline(rows[1].indexed,rows[1].title.replace('25','26'),'la Repubblica','it'),false);
 const candidate=readPublisherNewsCandidates(feed(),index,now).find(row=>row.sourceUrl===rows[1].url);
 for(const title of [rows[1].title.replace('25','26'),rows[1].title.replace('lo darò','non lo darò'),'Il festival del cinema presenta una storia completamente diversa']){
  assert.equal(readNewsArticleMetadata(document(rows[1],{headline:title}),candidate,rows[1].url,now),null);
 }
});

test('the existing bounded collector verifies Italian originals and emits valid private diagnostics',async()=>{
 const requested=[];
 const result=await discoverNewsWithDiagnostics(async input=>{
  const url=String(input);requested.push(url);
  if(url===index.url)return new Response(feed(),{headers:{'content-type':'application/xml'}});
  const row=rows.find(value=>value.url===url);return row?new Response(document(row),{headers:{'content-type':'text/html; charset=utf-8'}}):new Response('Unavailable fixture index',{status:404});
 },now,[],undefined,{frontpageHighlights:false,maxArticleRequests:2});
 const cards=result.sources.flatMap(source=>source.cards);assert.equal(cards.length,2);
 assert.equal(requested.filter(url=>rows.some(row=>row.url===url)).length,2);
 for(const row of rows){
  const card=cards.find(value=>value.sourceUrl===row.url);assert.ok(validCard(card));assert.equal(card.title,row.title);
  assert.equal(card.date,new Date(row.date).toISOString());assert.equal(card.identity,row.url);assert.equal(card.publisher,'la Repubblica');
  assert.equal(card.contentHash,createHash('sha256').update(JSON.stringify(cardContent(card))).digest('hex'));
  assert.equal(card.summary,undefined);assert.equal(card.licenseUrl,undefined);assert.equal(sourceLanguage(card),'it');
 }
 assert.equal(newsCategory(cards.find(card=>card.sourceUrl===rows[1].url)),'11000000');
 assert.ok(validNewsDiagnostics(result.diagnostics,now));assert.ok(result.diagnostics.indexes.some(row=>row.indexId==='repubblica-it-news'&&row.state==='verified'&&row.language==='it'));
 assert.equal(result.diagnostics.totals.verifiedNow,2);assert.ok(result.diagnostics.totals.requestAttempts<=2);
});
