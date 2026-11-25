import test from 'node:test';
import assert from 'node:assert/strict';
import {countryEditionProfile,countryEditionProfiles} from '../.build/src/iceo/country-editions.js';
import {LOCALES,localeFromCountry,resolveLocale} from '../.build/src/i18n/locale.js';
import {listCountries} from '../.build/src/local/cities.js';
import {DAILY_FEEDS} from '../.build/src/iceo/daily-feeds.js';
import {NEWS_PUBLISHERS,NEWS_PUBLICATION_SCOPES,NEWS_DISCOVERY_INDEXES,sourceLanguage,sourceEditionCountryCode,newsLanguageMatches} from '../.build/src/iceo/news-sources.js';

const countries=listCountries(),zero=Object.freeze({national:0,local:0,international:0});
function country(code){const value=countries.find(country=>country.code===code);assert.ok(value,'existing GeoNames country '+code);return value;}
const configuredCountries=['AU','DE','FR','GB','HK','IE','IN','IT','JP','NL','NZ','QA','RO','SG','US','ZA'];

test('every actual GeoNames country remains selectable regardless of configured publishers',t=>{
 const before=JSON.stringify(countries),profiles=countryEditionProfiles(countries);
 assert.ok(countries.length>200&&countries.length<=300);assert.equal(countries.length,244);
 assert.equal(profiles.length,countries.length);assert.ok(Object.isFrozen(profiles));
 assert.deepEqual(profiles.map(profile=>profile.countryCode),countries.map(country=>country.code));
 assert.deepEqual(profiles.map(profile=>profile.countryName),countries.map(country=>country.name.trim()));
 assert.equal(new Set(profiles.map(profile=>profile.countryCode)).size,countries.length);
 for(const profile of profiles){
  assert.equal(profile.language,localeFromCountry(profile.countryCode)??'en','without browser preferences a missing native default still produces a usable English country profile');assert.equal(profile.defaultLanguage,profile.language);
  assert.ok(LOCALES.some(locale=>locale.code===profile.language));
  assert.equal(profile.englishReadingOption,true);assert.equal(profile.englishRecommended,false);
  assert.equal(profile.coverage,null);assert.notEqual(profile.state,'available');
  assert.ok(Object.isFrozen(profile));assert.ok(Object.isFrozen(profile.configuredPublisherIds));
  assert.ok(Object.isFrozen(profile.configuredIndexIds));assert.ok(Object.isFrozen(profile.countryEditionLanguages));
  assert.equal(profile.state,profile.configuredPublisherIds.length?'unknown':'unconnected');
 }
 assert.deepEqual(profiles.filter(profile=>profile.countryEditionLanguages.length).map(profile=>profile.countryCode).sort(),configuredCountries);
 const english=countryEditionProfiles(countries,'en');
 assert.equal(english.length,countries.length);assert.ok(english.every(profile=>profile.language==='en'));
 assert.equal(JSON.stringify(countries),before);
 t.diagnostic('DLKT_COUNTRY_COVERAGE '+JSON.stringify({
  selectableCountries:profiles.length,configuredCountryProvenance:configuredCountries.length,
  configuredForDefaultLanguage:profiles.filter(profile=>profile.configuredPublisherIds.length>0).length,
  unsupportedLikelyDefaults:profiles.filter(profile=>!profile.defaultLanguageSupported).map(profile=>({country:profile.countryCode,language:profile.likelyLanguage})),
  limitation:'Configured provenance is not live availability; CLDR likely language is not an official or exclusive national language.',
 }));
});

test('GeoNames BQ labels are trimmed at the profile boundary without changing or omitting countries',()=>{
 const reference=country('BQ'),before=JSON.stringify(reference);
 assert.equal(reference.name,'Bonaire, Saint Eustatius and Saba ');
 const single=countryEditionProfile(reference,'en'),all=countryEditionProfiles(countries,'en');
 assert.equal(single.countryName,'Bonaire, Saint Eustatius and Saba');
 assert.equal(all.find(profile=>profile.countryCode==='BQ').countryName,single.countryName);
 assert.equal(all.length,244);assert.deepEqual(all.map(profile=>profile.countryCode),countries.map(country=>country.code));
 assert.equal(JSON.stringify(reference),before);
 const leading=Object.freeze({code:'RO',name:' Romania '});
 assert.equal(countryEditionProfile(leading,'ro').countryName,'Romania');assert.equal(leading.name,' Romania ');
});

test('country defaults are generic while the selected reading language and multilingual choices remain explicit',()=>{
 for(const [code,expected]of [['IT','it'],['RO','ro'],['GB','en'],['BR','pt'],['PT','pt'],['CN','zh-Hans'],['HK','zh-Hant'],['IN','hi']]){
  const profile=countryEditionProfile(country(code),'en');
  assert.equal(profile.defaultLanguage,expected,code);assert.equal(profile.language,'en',code+' preserves the chosen English option');
  assert.equal(profile.defaultLanguageSupported,true,code);assert.equal(profile.coverage,null);
 }
 assert.equal(countryEditionProfile(country('CA'),'en',undefined,['fr-CA','en-CA']).defaultLanguage,'fr');
 assert.equal(countryEditionProfile(country('CA'),'fr',undefined,['en-CA','fr-CA']).defaultLanguage,'en');
 assert.equal(countryEditionProfile(country('CH'),'en',undefined,['it-CH']).defaultLanguage,'it');
 const estonia=countryEditionProfile(country('EE'),'en');
 assert.equal(estonia.likelyLanguage,'et');assert.equal(estonia.defaultLanguage,'en');assert.equal(estonia.defaultLanguageSupported,false);
 assert.equal(estonia.state,'unconnected');assert.deepEqual(estonia.countryEditionLanguages,[]);
 const romanianReader=countryEditionProfile(country('EE'),'ro');
 assert.equal(romanianReader.language,'ro','the current reader choice stays independent of the country-profile fallback');
 assert.equal(romanianReader.defaultLanguage,'en');assert.equal(romanianReader.defaultLanguageSupported,false);
 const tuvalu=countryEditionProfile(country('TV'),'en');
 assert.equal(tuvalu.countryCode,'TV');assert.equal(tuvalu.defaultLanguage,localeFromCountry('TV')??'en');
 assert.equal(tuvalu.defaultLanguageSupported,newsLanguageMatches(tuvalu.likelyLanguage,resolveLocale(tuvalu.likelyLanguage)));
});

test('configuration, current empty coverage and actual local or national articles are different states',()=>{
 const awaiting=countryEditionProfile(country('IT'),'it');
 assert.equal(awaiting.state,'unknown');assert.equal(awaiting.coverage,null);
 assert.deepEqual(awaiting.configuredPublisherIds,['repubblica']);assert.deepEqual(awaiting.configuredIndexIds,['repubblica-it-news']);
 assert.deepEqual(awaiting.countryEditionLanguages,['en','it']);
 const empty=countryEditionProfile(country('IT'),'it',zero);
 assert.equal(empty.state,'currentNoArticles');assert.equal(empty.englishRecommended,true);
 const international=countryEditionProfile(country('IT'),'it',{national:0,local:0,international:3});
 assert.equal(international.state,'currentNoArticles');assert.equal(international.englishRecommended,false);
 const national=countryEditionProfile(country('IT'),'it',{national:2,local:0,international:3});
 assert.equal(national.state,'available');assert.equal(national.coverage.national,2);assert.equal(national.englishRecommended,false);
 const local=countryEditionProfile(country('RO'),'ro',{national:0,local:8,international:0});
 assert.equal(local.state,'available');assert.equal(local.coverage.local,8);
 const readingEnglish=countryEditionProfile(country('IT'),'en',zero);
 assert.deepEqual(readingEnglish.configuredPublisherIds,['repubblica']);
 assert.deepEqual(readingEnglish.configuredIndexIds,[],'the Italian RSS is not asserted to be an English index');
 assert.equal(readingEnglish.englishRecommended,false,'an English reading option is not proof of English articles');
});

test('a foreign edition in the same language never creates national or city coverage',()=>{
 const brazil=countryEditionProfile(country('BR'),'pt',zero);
 assert.equal(brazil.defaultLanguage,'pt');assert.equal(brazil.state,'unconnected');assert.deepEqual(brazil.configuredPublisherIds,[]);
 assert.deepEqual(brazil.countryEditionLanguages,[]);assert.equal(brazil.englishRecommended,true);
 assert.equal(sourceLanguage('https://www.dw.com/pt-br/'),'pt-BR');
 assert.equal(sourceEditionCountryCode('https://www.dw.com/pt-br/'),'DE');
 const foreignOnly=countryEditionProfile(country('BR'),'pt',{national:0,local:0,international:2});
 assert.equal(foreignOnly.state,'unconnected');assert.equal(foreignOnly.coverage.international,2);assert.equal(foreignOnly.englishRecommended,false);
 for(const [code,native]of [['JP','ja'],['QA','ar'],['HK','zh-Hant']]){
  const profile=countryEditionProfile(country(code),native,zero);
  assert.equal(profile.state,'unconnected');assert.deepEqual(profile.configuredPublisherIds,[]);
  assert.ok(profile.countryEditionLanguages.includes('en'));assert.equal(profile.englishRecommended,true);
  const english=countryEditionProfile(country(code),'en',{national:1,local:0,international:0});
  assert.equal(english.state,'available');assert.ok(english.configuredPublisherIds.length);
  assert.equal(english.coverage.local,0);
 }
});

test('SAnews retains its existing reviewed-feed provenance without enabling a new discovery origin',()=>{
 const feed=DAILY_FEEDS.find(source=>source.id==='sanews');assert.ok(feed?.feed);
 const prefix=feed.feed.articleOrigins[0]+feed.feed.articlePaths[0];
 assert.equal(prefix,'https://www.sanews.gov.za/south-africa/');
 assert.equal(sourceEditionCountryCode(prefix),'ZA');assert.equal(sourceLanguage(prefix),'en');
 const profile=countryEditionProfile(country('ZA'),'en',zero);
 assert.deepEqual(profile.configuredPublisherIds,['sanews']);assert.deepEqual(profile.countryEditionLanguages,['en']);
 assert.deepEqual(profile.configuredIndexIds,[]);assert.equal(profile.state,'currentNoArticles');
 assert.equal(NEWS_PUBLISHERS.some(source=>source.id==='sanews'),false);
 assert.equal(NEWS_PUBLISHERS.length,77);assert.equal(NEWS_PUBLICATION_SCOPES.length,26);assert.equal(NEWS_DISCOVERY_INDEXES.length,31);
});

test('country and coverage inputs are bounded, immutable and fail closed on malformed data',()=>{
 const reference=country('RO'),counts={national:1,local:2,international:3},before=JSON.stringify([reference,counts]);
 const profile=countryEditionProfile(reference,'ro',counts);
 assert.equal(JSON.stringify([reference,counts]),before);assert.notEqual(profile.coverage,counts);assert.ok(Object.isFrozen(profile.coverage));
 assert.throws(()=>profile.configuredPublisherIds.push('invented'));
 for(const invalid of [null,[],{}, {code:'ro',name:'Romania'},{code:'RO',name:''},{code:'ZZ',name:'Unknown'},
  {code:'../RO',name:'Romania'},{code:'RO',name:'<script>'},{code:'RO',name:'   '},
  {code:'RO',name:'Romania\n'},{code:'RO',name:'Romania\u202e'},{code:'RO',name:'R'.repeat(121)},
  {code:'RO',name:'Romania',extra:true}]){
  assert.throws(()=>countryEditionProfile(invalid,'en'),/COUNTRY_EDITION_CONTEXT_INVALID/);
 }
 for(const invalid of [null,{},[],{national:0,local:0},{...zero,extra:1},{...zero,national:-1},
  {...zero,local:0.5},{...zero,national:NaN},{...zero,international:Infinity},
  {...zero,national:5001},{national:3000,local:2001,international:0}]){
  assert.throws(()=>countryEditionProfile(reference,'ro',invalid),/COUNTRY_EDITION_COVERAGE_INVALID/);
 }
 for(const language of ['it-IT','xx','constructor','',null,false,0,{},[]]){
  assert.throws(()=>countryEditionProfile(reference,language),/COUNTRY_EDITION_CONTEXT_INVALID/);
  assert.throws(()=>countryEditionProfiles(countries,language),/COUNTRY_EDITION_CONTEXT_INVALID/);
 }
 assert.throws(()=>countryEditionProfiles([reference,reference]),/COUNTRY_EDITION_COUNTRIES_INVALID/);
 assert.throws(()=>countryEditionProfiles(Array.from({length:301},()=>reference)),/COUNTRY_EDITION_COUNTRIES_INVALID/);
 assert.throws(()=>countryEditionProfiles(countries,undefined,{}),/COUNTRY_EDITION_CONTEXT_INVALID/);
 assert.throws(()=>countryEditionProfile(reference,'ro',undefined,Array(33).fill('en')),/COUNTRY_EDITION_CONTEXT_INVALID/);
});
