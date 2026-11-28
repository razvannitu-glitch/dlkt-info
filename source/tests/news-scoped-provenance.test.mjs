import test from 'node:test';
import assert from 'node:assert/strict';
import {NEWS_PUBLISHERS,NEWS_DISCOVERY_INDEXES,NEWS_PUBLICATION_SCOPES,sourcePublicationContext,sourceEditionCountryCode,sourceLanguage,publisherForNewsUrl} from '../.build/src/iceo/news-sources.js';
import {countryEditionProfile} from '../.build/src/iceo/country-editions.js';
import {NewsPageService} from '../.build/src/iceo/news-page.js';
import {validNewsPage} from '../.build/src/iceo/news-page-contracts.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {listCountries,searchCities} from '../.build/src/local/cities.js';
import {NOW,hash,article,epoch,CorpusMemoryStore} from './fixtures/news-corpus.mjs';

const examples=[
 ['politico','BE','POLITICO','https://www.politico.eu/article/controlled-european-politics-fixture/'],
 ['politico','BE','POLITICO','https://www.politico.eu/podcast/controlled-european-policy-fixture/'],
 ['good-housekeeping','US','Good Housekeeping','https://www.goodhousekeeping.com/what-to-buy/clothing/a123456/controlled-fixture/'],
 ['good-housekeeping','US','Good Housekeeping','https://www.goodhousekeeping.com/entertainment/a123456/controlled-fixture/'],
 ['good-housekeeping','US','Good Housekeeping','https://www.goodhousekeeping.com/holidays/a123456/controlled-fixture/'],
 ['good-housekeeping','GB','Good Housekeeping','https://www.goodhousekeeping.com/uk/lifestyle/a123456/controlled-fixture/'],
];
test('exact origin and section determine reviewed publisher edition without new acquisition registrations',()=>{
 assert.equal(NEWS_PUBLISHERS.length,77);assert.equal(NEWS_DISCOVERY_INDEXES.length,31);
 const scoped=NEWS_PUBLICATION_SCOPES.filter(x=>x.origins!==undefined);
 assert.equal(scoped.length,3);
 for(const rule of scoped){
  assert.ok(Object.isFrozen(rule));assert.ok(Object.isFrozen(rule.origins));
  assert.ok(rule.origins.every(origin=>NEWS_PUBLISHERS.find(p=>p.id===rule.publisherId).origins.includes(origin)));
 }
 for(const [id,country,,url] of examples){
  assert.equal(publisherForNewsUrl(url)?.id,id);
  const c=sourcePublicationContext(url);
  assert.equal(c.publisherCountryCode,country);assert.equal(c.language,'en');assert.equal(c.basis,'reviewed-publisher');
  assert.equal(c.city,undefined);assert.equal(c.countries,undefined);assert.ok(Object.isFrozen(c));
 }
});
test('unknown national editions, normalized paths, queries, hosts and unrelated sections remain unresolved',()=>{
 for(const url of [
  'https://www.politico.com/news/controlled-fixture','https://politico.eu/article/controlled-fixture',
  'https://www.politico.eu/article-extra/controlled','https://www.politico.eu/article/','https://www.politico.eu/about/',
  'https://www.politico.eu/de/article/controlled','https://www.politico.eu/article/../podcast/controlled',
  'https://www.goodhousekeeping.com/uk-extra/controlled','https://goodhousekeeping.com/what-to-buy/controlled',
  'https://www.goodhousekeeping.com/what-to-buy-extra/controlled','https://www.goodhousekeeping.com/unknown/controlled',
  'https://www.goodhousekeeping.com/uk/../what-to-buy/controlled','https://www.goodhousekeeping.com/what-to-buy/%2e%2e/uk/controlled',
  'https://www.goodhousekeeping.com/what-to-buy/%2fuk/controlled','https://www.goodhousekeeping.com/uk//controlled',
  'https://www.goodhousekeeping.com/what-to-buy/controlled?redirect=uk','https://www.goodhousekeeping.com/uk/controlled#fragment',
  'https://www.goodhousekeeping.com.attacker.invalid/uk/controlled','https://user@www.goodhousekeeping.com/uk/controlled',
  'http://www.goodhousekeeping.com/uk/controlled','https://www.goodhousekeeping.com:444/uk/controlled',
 ]){assert.equal(sourceEditionCountryCode(url),null,url);assert.equal(sourceLanguage(url),null,url);}
});
test('profiles distinguish publisher-edition provenance from a reviewed edition-specific index',()=>{
 for(const code of ['BE','GB','US']){
  const country=listCountries().find(c=>c.code===code),profile=countryEditionProfile(country,'en');
  assert.ok(profile.configuredPublisherIds.includes(code==='BE'?'politico':'good-housekeeping'));
  assert.ok(!profile.configuredIndexIds.includes('good-housekeeping-news'));
  assert.equal(profile.coverage,null);assert.equal(profile.state,'unknown');
 }
});
test('national publisher grouping changes for the exact edition while all-source access and original hashes remain intact',async()=>{
 const selected=[examples[0],examples[2],examples[5]];
 const originals=selected.map(([id,country,publisher,url],i)=>{
  const card={...article(i+1,{category:'11000000'}),id:hash(url).slice(0,24),identity:url,sourceUrl:url,publisher,
   title:'Parliament debates a controlled publication fixture '+i,attribution:'Source: '+publisher+'. Open the original publication.'};
  card.contentHash=hash(cardContent(card));return card;
 });
 const other=article(99,{category:'11000000'}),stored=epoch([...originals,other]),before=JSON.stringify(stored);
 const service=new NewsPageService(new CorpusMemoryStore([stored]),'test-only-news-cursor-writer-123456789012345678901234567890',()=>NOW+1000);
 for(const [i,[name,code]] of [['Brussels','BE'],['Washington','US'],['London','GB']].entries()){
  const city=searchCities(name,code,12).find(c=>c.countryCode===code);assert.ok(city,name);
  const result=await service.read({language:'en',cityId:city.id,filter:'all',cursor:null,sourceScope:'all'});
  assert.equal(result.total,4);assert.deepEqual(result.coverage,{national:1,local:0,international:3});assert.ok(validNewsPage(result,NOW+1000,city));
  assert.equal(result.items[0].card.id,originals[i].id);
  assert.ok(originals.every(card=>result.items.some(item=>item.card===card)));
  const filtered=await service.read({language:'it',cityId:city.id,filter:'all',cursor:null,sourceScope:'edition'});
  assert.equal(filtered.total,0);
 }
 assert.equal(JSON.stringify(stored),before);for(const original of originals)assert.equal(original.contentHash,hash(cardContent(original)));
});
