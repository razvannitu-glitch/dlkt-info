import test from 'node:test';
import assert from 'node:assert/strict';
import {NEWS_PUBLISHERS,NEWS_DISCOVERY_INDEXES,NEWS_PUBLICATION_SCOPES,publisherForNewsUrl,sourcePublicationContext,sourceEditionCountryCode,sourceLanguage,selectNewsLanguage,newsLanguageCoverage} from '../.build/src/iceo/news-sources.js';
import {countryEditionProfile} from '../.build/src/iceo/country-editions.js';
import {NewsPageService} from '../.build/src/iceo/news-page.js';
import {validNewsPage} from '../.build/src/iceo/news-page-contracts.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {listCountries,searchCities} from '../.build/src/local/cities.js';
import {NOW,hash,article,epoch,CorpusMemoryStore} from './fixtures/news-corpus.mjs';

const origin='https://globalvoices.org';
const fixture=origin+'/2026/11/27/controlled-global-language-fixture/';
test('the reviewed global English editorial edition is not a national edition',()=>{
 assert.equal(NEWS_PUBLISHERS.length,77);assert.equal(NEWS_DISCOVERY_INDEXES.length,31);
 assert.ok(!NEWS_PUBLICATION_SCOPES.some(scope=>scope.publisherId==='global-voices'));
 for(const url of [
  fixture,
  origin+'/2026/11/27/who-speaks-for-the-voiceless-in-tanzania/',
  origin+'/2026/11/25/jailed-for-being-poor-forgotten-by-slow-courts-in-nigeria-saved-by-strangers-online/',
 ]){
  assert.equal(publisherForNewsUrl(url)?.id,'global-voices');
  assert.equal(sourceLanguage(url),'en');
  assert.equal(sourceLanguage({sourceUrl:url,sourceIds:['news-unclassified']}),'en');
  assert.equal(sourcePublicationContext(url),null);assert.equal(sourceEditionCountryCode(url),null);
 }
 for(const code of ['TZ','NG','US','GB','RO']){
  const profile=countryEditionProfile(listCountries().find(c=>c.code===code),'en');
  assert.ok(!profile.configuredPublisherIds.includes('global-voices'));
 }
});
test('unreviewed origins, index paths, malformed and ambiguous URLs never receive inferred language',()=>{
 for(const url of [
  'https://www.globalvoices.org/2026/11/27/controlled-global-language-fixture/',
  'https://ro.globalvoices.org/2026/11/27/controlled-global-language-fixture/',
  'https://globalvoices.org.attacker.invalid/2026/11/27/controlled-global-language-fixture/',
  'https://user@globalvoices.org/2026/11/27/controlled-global-language-fixture/',
  'https://globalvoices.org:443/2026/11/27/controlled-global-language-fixture/',
  'https://globalvoices.org:444/2026/11/27/controlled-global-language-fixture/',
  'http://globalvoices.org/2026/11/27/controlled-global-language-fixture/',
  origin+'/',origin+'/2026/11/27/',origin+'/about/',origin+'/2026/13/27/controlled/',
  origin+'/2026/11/00/controlled/',origin+'/2026/11/27//controlled/',
  origin+'/2026/11/27/other/../controlled/',origin+'/2026/11/27/%2e%2e/27/controlled/',
  origin+'/2026/11/27/controlled%2fother/',fixture+'?edition=ro',fixture+'#fragment',
 ]){assert.equal(sourceLanguage(url),null,url);assert.equal(sourceEditionCountryCode(url),null,url);}
 assert.equal(sourceLanguage('https://www.reuters.com/world/controlled-fixture'),null);
 assert.equal(sourceLanguage('https://www.digi24.ro/stiri/controlled-fixture'),'ro');
 assert.equal(sourceEditionCountryCode('https://www.digi24.ro/stiri/controlled-fixture'),'RO');
});
test('language-only originals remain international in every selected country, preserve hashes, and remain reachable in all-source scope',async()=>{
 const original={...article(1,{category:'11000000'}),id:hash(fixture).slice(0,24),identity:fixture,sourceUrl:fixture,publisher:'Global Voices',
  title:'A controlled global editorial language fixture',attribution:'Source: Global Voices. Open the original publication.'};
 original.contentHash=hash(cardContent(original));
 const stored=epoch([original]),before=JSON.stringify(stored);
 assert.equal(selectNewsLanguage([original],'en')[0],original);
 assert.equal(selectNewsLanguage([original],'ro').length,0);
 assert.deepEqual(newsLanguageCoverage([original]),{publications:1,publishers:1,languages:[{language:'en',count:1}],unknownLanguage:0});
 const service=new NewsPageService(new CorpusMemoryStore([stored]),'test-only-news-cursor-writer-123456789012345678901234567890',()=>NOW+1000);
 for(const [name,code] of [['Bucharest','RO'],['London','GB']]){
  const city=searchCities(name,code,12).find(c=>c.countryCode===code);assert.ok(city,name);
  const query={language:'en',cityId:city.id,filter:'all',cursor:null,sourceScope:'edition'};
  const page=await service.read(query);
  assert.equal(page.total,1);assert.deepEqual(page.coverage,{national:0,local:0,international:1});
  assert.equal(page.items[0].card,original);assert.ok(validNewsPage(page,NOW+1000,city));
  assert.equal((await service.read({...query,language:'ro'})).total,0);
  const all=await service.read({...query,language:'ro',sourceScope:'all'});
  assert.equal(all.total,1);assert.equal(all.items[0].card,original);
  assert.deepEqual(all.coverage,{national:0,local:0,international:1});assert.ok(validNewsPage(all,NOW+1000,city));
 }
 assert.equal(JSON.stringify(stored),before);assert.equal(original.contentHash,hash(cardContent(original)));
});
