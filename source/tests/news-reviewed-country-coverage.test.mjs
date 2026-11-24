import test from 'node:test';
import assert from 'node:assert/strict';
import {DAILY_FEEDS} from '../.build/src/iceo/daily-feeds.js';
import {extract} from '../.build/src/iceo/extract.js';
import {sourcePublicationContext,sourceLanguage,sourceEditionCountryCode,selectNewsLanguage,newsLanguageCoverage,REVIEWED_FEED_PUBLICATION_SCOPES,NEWS_PUBLISHERS,NEWS_DISCOVERY_INDEXES,publisherForNewsUrl,canonicalNewsUrl} from '../.build/src/iceo/news-sources.js';
import {countryEditionProfile,countryEditionProfiles} from '../.build/src/iceo/country-editions.js';
import {NewsPageService} from '../.build/src/iceo/news-page.js';
import {validNewsPage,validNewsGlobalCard} from '../.build/src/iceo/news-page-contracts.js';
import {validArchiveCard} from '../.build/src/share/archive.js';
import {listCountries,searchCities} from '../.build/src/local/cities.js';
import {NOW,article,epoch,CorpusMemoryStore} from './fixtures/news-corpus.mjs';

const KEY='test-only-news-cursor-writer-123456789012345678901234567890';
const cases=[
 ['sanews','ZA','South African rail freight reform enters implementation stage'],
 ['cbs-news','NL','Dutch household purchasing power statistics record yearly change'],
 ['noaa-news','US','Ocean sensors chart Pacific deep current circulation'],
 ['nist-news','US','Quantum measurement standard improves optical clock calibration'],
 ['nsf-news','US','Mathematics research grants fund topology collaboration'],
 ['fed-news','US','Federal Reserve publishes bank capital supervision decision'],
 ['ftc-consumer','US','Consumer guidance explains how to report impersonation scams'],
 ['fda-food','US','Food recall lists packaged salad contamination warning'],
 ['beehive-news','NZ','New Zealand government announces regional school attendance programme'],
];
// Exact contexts already emitted by extraction; publisher country provenance must not rewrite them.
const originalPublisherContexts=new Map([
 ['sanews',[{code:'ZA',name:'South Africa'}],'South Africa · government publisher scope'],
 ['cbs-news',[{code:'NL',name:'Netherlands'}],'Netherlands · statistics publisher scope'],
 ['noaa-news',[],'Weather, ocean and climate · NOAA scope'],
 ['nist-news',[],'Science, technology and standards · NIST scope'],
 ['nsf-news',[],'Science and research · NSF scope'],
 ['fed-news',[{code:'US',name:'United States'}],'United States · Federal Reserve scope'],
 ['ftc-consumer',[{code:'US',name:'United States'}],'United States · consumer protection scope'],
 ['fda-food',[{code:'US',name:'United States'}],'United States · food safety scope'],
 ['beehive-news',[{code:'NZ',name:'New Zealand'}],'New Zealand · government publisher scope'],
].map(([id,countries,label])=>[id,{countries,basis:'publisher-scope',label,
 boundary:'This is the declared scope of the publisher source, not an article-specific affected location or a statement that it applies to you.'}]));
const source=id=>{const found=DAILY_FEEDS.find(value=>value.id===id);assert.ok(found?.feed,id);return found;};
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const country=code=>{const found=listCountries().find(value=>value.code===code);assert.ok(found,code);return found;};
const city=(name,code)=>{const found=searchCities(name,code,12).find(value=>value.countryCode===code);assert.ok(found,name);return found;};
/** Controlled extraction fixture, not copied publisher text or a claim about live article freshness. */
function rss(id,{title=cases.find(value=>value[0]===id)?.[2]??'Controlled primary source announcement',
 published=NOW-10000,link,home,channelTitle}={}){
 const reviewed=source(id),feed=reviewed.feed;
 return '<rss version="2.0"><channel><title>'+escape(channelTitle??feed.title)+'</title><link>'
  +escape(home??feed.homeUrl??feed.homeOrigin+(feed.homePath??'/'))+'</link><language>en</language><item><title>'
  +escape(title)+'</title><link>'+escape(link??feed.articleOrigins[0]+feed.articlePaths[0]+'controlled-country-coverage-'+id)
  +'</link><'+feed.dateField+'>'+new Date(published).toUTCString()+'</'+feed.dateField+'>'
  +'<description><![CDATA[<p>A complete controlled publisher statement with its stated limitation.</p>'
  +'<p>Another paragraph is not needed for this extraction fixture.</p>]]></description></item></channel></rss>';
}
function extracted(id,options){
 const result=extract(rss(id,options),source(id),NOW);assert.equal(result.rejected,0,id);assert.equal(result.cards.length,1,id);
 const card=result.cards[0];assert.ok(validArchiveCard(card),id);return card;
}

test('existing national primary feeds gain provenance without new publishers, indexes or permissions',()=>{
 assert.equal(REVIEWED_FEED_PUBLICATION_SCOPES.length,9);
 assert.deepEqual(REVIEWED_FEED_PUBLICATION_SCOPES.map(value=>value.sourceId),cases.map(value=>value[0]));
 assert.equal(DAILY_FEEDS.length,14);assert.equal(NEWS_PUBLISHERS.length,77);assert.equal(NEWS_DISCOVERY_INDEXES.length,31);
 for(const [id,code] of cases){
  const reviewed=source(id),profile=REVIEWED_FEED_PUBLICATION_SCOPES.find(value=>value.sourceId===id);
  assert.equal(reviewed.adapter,'reviewed-feed');assert.equal(reviewed.feed.dateLabel,'Published');
  assert.deepEqual([profile.origin],reviewed.feed.articleOrigins);assert.deepEqual(profile.articlePaths,reviewed.feed.articlePaths);
  assert.equal(profile.countryCode,code);assert.equal(profile.language,'en');assert.ok(Object.isFrozen(profile));assert.ok(Object.isFrozen(profile.articlePaths));
  for(const prefix of profile.articlePaths){
   const url=profile.origin+prefix+'controlled-provenance';
   assert.equal(sourceLanguage(url),'en');assert.equal(sourceEditionCountryCode(url),code);
   assert.equal(publisherForNewsUrl(url),null);assert.equal(canonicalNewsUrl(url),null,'reviewed feed provenance grants no discovery origin');
   assert.equal(NEWS_DISCOVERY_INDEXES.some(index=>index.publisherId===id),false);
  }
 }
 // Institutional and international services are not assigned a national edition from their headquarters.
 for(const id of ['ec-press','eu-council','scidev-news','360-news','govuk-travel']){
  assert.equal(REVIEWED_FEED_PUBLICATION_SCOPES.some(value=>value.sourceId===id),false,id);
 }
 assert.equal(source('govuk-travel').feed.dateLabel,'Updated','travel guidance updates are not relabelled as published news');
});

test('feed extraction retains government attribution, exact source identity, dates and rights',()=>{
 const cards=cases.map(([id])=>extracted(id)),before=JSON.stringify(cards);
 for(const [index,[id,code]] of cases.entries()){
  const card=cards[index],reviewed=source(id),context=sourcePublicationContext(card);
  assert.deepEqual(card.sourceIds,[id]);assert.equal(context.publisherCountryCode,code);assert.equal(context.language,'en');
  assert.equal(context.basis,'reviewed-publisher');assert.equal(context.city,undefined);
  assert.deepEqual(card.context,originalPublisherContexts.get(id),'retains the exact source scope without fabricated article or city evidence');
  assert.equal(card.cityId,undefined);
  assert.equal(card.date,new Date(NOW-10000).toISOString());assert.equal(card.dateLabel,'Published');
  assert.equal(card.attribution,reviewed.attribution);assert.equal(card.boundary,reviewed.feed.boundary);
  assert.equal(card.photo,undefined);assert.equal(card.image,undefined);assert.ok(validNewsGlobalCard(card,NOW));
 }
 const beehive=cards.find(card=>card.sourceIds[0]==='beehive-news');
 assert.equal(beehive.publisher,'New Zealand Government');assert.match(sourcePublicationContext(beehive).coverage,/Government releases and speeches/);
 assert.match(beehive.boundary,/Government publisher statement/);
 assert.equal(beehive.summary,'A complete controlled publisher statement with its stated limitation.');
 assert.doesNotMatch(beehive.summary,/Another paragraph/);assert.match(beehive.attribution,/No photographs, logos or third-party media/);
 const cbs=cards.find(card=>card.sourceIds[0]==='cbs-news');
 assert.equal(cbs.byline,'Statistics Netherlands (CBS)');assert.equal(cbs.licenseUrl,'https://creativecommons.org/licenses/by/4.0/');
 assert.deepEqual(newsLanguageCoverage(cards),{publications:9,publishers:9,languages:[{language:'en',count:9}],unknownLanguage:0});
 assert.deepEqual(selectNewsLanguage(cards,'en'),cards);assert.deepEqual(selectNewsLanguage(cards,'it'),[]);
 assert.equal(JSON.stringify(cards),before);
});

test('source IDs, origins, paths and language boundaries cannot borrow another feed provenance',()=>{
 for(const [id] of cases){
  const card=extracted(id),url=card.sourceUrl,foreign=cases.find(value=>value[0]!==id)[0];
  for(const sourceIds of [[],[foreign],['news-unclassified'],[id,foreign],[id,id],[id,'news-unclassified']]){
   assert.equal(sourcePublicationContext({...card,sourceIds}),null,id+' '+sourceIds.join(','));
   assert.equal(sourceLanguage({...card,sourceIds}),null);assert.equal(sourceEditionCountryCode({...card,sourceIds}),null);
  }
  for(const bad of [url.replace('https:','http:'),url.replace('https://','https://user@'),
   url.replace(new URL(url).host,new URL(url).host+'.attacker.invalid'),url.replace(new URL(url).host,new URL(url).host+':444'),
   new URL(url).origin+'/unreviewed/controlled',url+'?redirect=https://attacker.invalid/',url+'#foreign']){
   assert.equal(sourcePublicationContext(bad),null,bad);assert.equal(sourceLanguage({...card,sourceUrl:bad}),null);
  }
 }
 for(const url of ['https://www.cbs.nl/nl-nl/nieuws/controlled','https://www.beehive.govt.nz/mi/release/controlled',
  'https://www.beehive.govt.nz/release-extra/controlled','https://beehive.govt.nz/release/controlled',
  'https://www.beehive.govt.nz/about','https://www.cbc.ca/news/canada/controlled']){
  assert.equal(sourceLanguage(url),null,url);assert.equal(sourceEditionCountryCode(url),null,url);
 }
 const id='beehive-news';
 assert.throws(()=>extract(rss(id,{channelTitle:'Another feed'}),source(id),NOW),/SOURCE_IDENTITY_MISMATCH/);
 assert.throws(()=>extract(rss(id,{home:'https://attacker.invalid/'}),source(id),NOW),/SOURCE_LINK_REJECTED/);
 for(const link of ['https://attacker.invalid/release/controlled','https://www.beehive.govt.nz/unreviewed/controlled']){
  const result=extract(rss(id,{link}),source(id),NOW);assert.equal(result.cards.length,0);assert.equal(result.rejected,1);
 }
});

test('all cities in New Zealand and the Netherlands receive their eligible national feed while other sources remain international',async()=>{
 const originals=cases.map(([id])=>extracted(id)),international=article(999,{category:'11000000'});
 const records=[international,...originals],stored=epoch(records),before=JSON.stringify(stored);
 const service=new NewsPageService(new CorpusMemoryStore([stored]),KEY,()=>NOW+1000);
 for(const selectedCity of [city('Wellington','NZ'),city('Auckland','NZ'),city('Amsterdam','NL'),city('Washington','US')]){
  const page=await service.read({language:'en',cityId:selectedCity.id,filter:'all',cursor:null});
  const expected=cases.filter(value=>value[1]===selectedCity.countryCode).length;
  assert.equal(page.total,10);assert.equal(page.articleTotal,10);assert.equal(page.countryCode,selectedCity.countryCode);
  assert.deepEqual(page.coverage,{national:expected,local:0,international:10-expected});assert.ok(validNewsPage(page,NOW+1000,selectedCity));
  assert.equal(new Set(page.items.map(item=>item.card.id)).size,10);
  for(const original of originals){
   const item=page.items.find(value=>value.card.id===original.id);assert.equal(item.card,original);
   assert.equal(item.kind,'global');
   assert.deepEqual(item.card.context,originalPublisherContexts.get(original.sourceIds[0]),'national classification preserves the original source scope');
   assert.equal(item.card.cityId,undefined,'publisher country never fabricates city evidence');
  }
  const wrongLanguage=await service.read({language:'it',cityId:selectedCity.id,filter:'all',cursor:null});
  assert.equal(wrongLanguage.total,0);assert.deepEqual(wrongLanguage.coverage,{national:0,local:0,international:0});
 }
 const abroad=await service.read({language:'en',cityId:city('Torino','IT').id,filter:'all',cursor:null});
 assert.equal(abroad.total,10);assert.deepEqual(abroad.coverage,{national:0,local:0,international:10});
 assert.equal(JSON.stringify(stored),before,'publication data and hashes remain unmodified');
});

test('configured primary sources do not invent live availability, Dutch translations or worldwide coverage',async()=>{
 const zero={national:0,local:0,international:0};
 for(const [code,id] of [['NZ','beehive-news'],['NL','cbs-news']]){
  const awaiting=countryEditionProfile(country(code),'en'),empty=countryEditionProfile(country(code),'en',zero);
  assert.deepEqual(awaiting.configuredPublisherIds,[id]);assert.deepEqual(awaiting.configuredIndexIds,[]);
  assert.deepEqual(awaiting.countryEditionLanguages,['en']);assert.equal(awaiting.state,'unknown');assert.equal(awaiting.coverage,null);
  assert.equal(empty.state,'currentNoArticles');assert.equal(empty.coverage.national,0);
  const unrelatedLanguage=countryEditionProfile(country(code),'it',zero);
  assert.deepEqual(unrelatedLanguage.configuredPublisherIds,[]);assert.equal(unrelatedLanguage.state,'unconnected');
 }
 const profiles=countryEditionProfiles(listCountries(),'en');assert.equal(profiles.length,244);
 assert.equal(profiles.filter(profile=>profile.countryEditionLanguages.length).length,16);
 assert.equal(countryEditionProfile(country('CA'),'en',zero).state,'unconnected');
 assert.equal(countryEditionProfile(country('BR'),'pt',zero).state,'unconnected');
 const older=extracted('beehive-news',{published:NOW-25*3600000}),stored=epoch([older]);
 assert.equal(stored.corpus.cards.length,0,'seven-day acquisition does not extend the current-news 24-hour window');
 const page=await new NewsPageService(new CorpusMemoryStore([stored]),KEY,()=>NOW+1000)
  .read({language:'en',cityId:city('Wellington','NZ').id,filter:'all',cursor:null});
 assert.equal(page.total,0);assert.deepEqual(page.coverage,zero);
 assert.equal(older.date,new Date(NOW-25*3600000).toISOString(),'old releases are never redated');
 const future=extract(rss('beehive-news',{published:NOW+86400000}),source('beehive-news'),NOW);
 assert.equal(future.cards.length,0);assert.equal(future.rejected,1);
});
