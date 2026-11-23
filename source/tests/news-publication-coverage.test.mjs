import test from 'node:test';
import assert from 'node:assert/strict';
import {NEWS_PUBLISHERS,NEWS_PUBLICATION_SCOPES,NEWS_DISCOVERY_INDEXES,sourcePublicationContext,sourceLanguage,sourceEditionCountryCode,publisherForNewsUrl} from '../.build/src/iceo/news-sources.js';
import {NewsPageService} from '../.build/src/iceo/news-page.js';
import {validNewsPage} from '../.build/src/iceo/news-page-contracts.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {searchCities} from '../.build/src/local/cities.js';
import {NOW,hash,article,epoch,CorpusMemoryStore} from './fixtures/news-corpus.mjs';
const KEY='test-only-news-cursor-writer-123456789012345678901234567890';
const profiles=[
 {id:'aljazeera',country:'QA',label:'Al Jazeera',city:'Doha',otherLanguage:'ar',
  // Primary original opened2026-11-23; fixture publication timestamps are controlled separately.
  url:'https://www.aljazeera.com/news/2026/11/22/aber-kawas-becomes-first-palestinian-in-new-york-state-senate-history',
  additional:'https://www.aljazeera.com/economy/2026/11/20/controlled-edition-fixture'},
 {id:'scmp',country:'HK',label:'South China Morning Post',city:'Hong Kong',otherLanguage:'zh-Hant',
  // Primary indexed article establishes the edition path; no copied article content is used.
  url:'https://www.scmp.com/news/hong-kong/hong-kong-economy/article/3367091/hong-kong-policy-address-continue-push-helping-local-media-go-global',
  additional:'https://www.scmp.com/business/companies/article/1890060/alibaba-buys-south-china-morning-post-groups-media-business'},
];
test('two existing English editorial profiles extend provenance without enabling origins or feeds',()=>{
 assert.equal(NEWS_PUBLISHERS.length,75);
 const codes=new Set(NEWS_PUBLICATION_SCOPES.map(profile=>profile.countryCode));
 assert.deepEqual([...codes].sort(),['AU','DE','FR','GB','HK','IE','IN','IT','JP','QA','RO','SG','US']);
 assert.equal(codes.size,13);assert.equal(NEWS_PUBLICATION_SCOPES.length,23);
 assert.equal(sourceEditionCountryCode('https://www.sanews.gov.za/south-africa/controlled-fixture'),'ZA');
 assert.equal(new Set([...codes,'ZA']).size,14,'14 configured country/territory provenance codes, not 14 live or native-language feeds');
 for(const profile of profiles){
  assert.equal(NEWS_DISCOVERY_INDEXES.some(index=>index.publisherId===profile.id),false,'no discovery index is added');
  for(const url of [profile.url,profile.additional]){
   assert.equal(publisherForNewsUrl(url)?.id,profile.id);assert.equal(sourceLanguage(url),'en');
   const context=sourcePublicationContext(url);
   assert.equal(context.publisherCountryCode,profile.country);assert.equal(context.basis,'reviewed-publisher');
   assert.equal(context.city,undefined);assert.equal(context.countries,undefined);assert.ok(Object.isFrozen(context));
  }
 }
 assert.equal(sourceLanguage('https://www.cbc.ca/news/canada/controlled-fixture'),null,'the unverified CBC edition path is not activated');
});
test('unknown paths and unadmitted language hosts remain unknown instead of becoming English',()=>{
 for(const url of [
  'https://www.aljazeera.com/ar/news/controlled-fixture','https://www.aljazeera.com/news-extra/controlled-fixture',
  'https://www.aljazeera.com/unreviewed/controlled-fixture','https://www.aljazeera.net/news/controlled-fixture',
  'https://www.scmp.com/zh/news/controlled-fixture','https://www.scmp.com/news-extra/controlled-fixture',
  'https://www.scmp.com/unreviewed/controlled-fixture','https://chinese.scmp.com/news/controlled-fixture',
  'https://www.aljazeera.com.attacker.invalid/news/controlled-fixture','http://www.scmp.com/news/controlled-fixture',
  'https://user@www.scmp.com/news/controlled-fixture','https://www.scmp.com:444/news/controlled-fixture',
 ])assert.equal(sourceLanguage(url),null,url);
});
test('verified originals gain the correct English edition priority without fabricated Arabic, Chinese or city coverage',async()=>{
 const originals=profiles.map((profile,index)=>{
  const original={...article(index+1),id:hash(profile.url).slice(0,24),identity:profile.url,sourceUrl:profile.url,
   publisher:profile.label,title:'Parliament debates a controlled publication fixture '+index,
   attribution:'Source: '+profile.label+'. Open the original publication.'};
  original.contentHash=hash(cardContent(original));return original;
 });
 const international=article(99,{category:'11000000'}),stored=epoch([...originals,international]),before=JSON.stringify(stored);
 const service=new NewsPageService(new CorpusMemoryStore([stored]),KEY,()=>NOW+1000);
 for(const [index,profile] of profiles.entries()){
  const city=searchCities(profile.city,profile.country,12).find(value=>value.countryCode===profile.country);assert.ok(city);
  const page=await service.read({language:'en',cityId:city.id,filter:'all',cursor:null});
  assert.equal(page.countryCode,profile.country);assert.equal(page.total,3);
  assert.deepEqual(page.coverage,{national:1,local:0,international:2});assert.ok(validNewsPage(page,NOW+1000,city));
  const original=page.items.find(item=>item.card.id===originals[index].id);assert.equal(original.card,originals[index]);
  assert.equal(original.kind,'global');assert.equal(original.card.context,undefined);
  const sameCategory=page.items.filter(item=>item.category===original.category);
  assert.equal(sameCategory[0].card.id,original.card.id,'reviewed country provenance leads its existing category queue');
  const native=await service.read({language:profile.otherLanguage,cityId:city.id,filter:'all',cursor:null});
  assert.equal(native.total,0);assert.deepEqual(native.coverage,{national:0,local:0,international:0});
 }
 assert.equal(JSON.stringify(stored),before);for(const original of originals)assert.equal(original.contentHash,hash(cardContent(original)));
});
