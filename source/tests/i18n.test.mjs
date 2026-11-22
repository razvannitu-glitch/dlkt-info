import test from 'node:test';
import assert from 'node:assert/strict';
import {LOCALES,MESSAGE_KEYS,MESSAGES,CATEGORY_LABELS,messageParameters} from '../.build/src/i18n/catalog.js';
import {resolveLocale,localeFromUrl,localeUrl,t,categoryLabel} from '../.build/src/i18n/locale.js';
import {PUBLIC_EDITORIAL_CATEGORIES} from '../.build/src/iceo/editorial-categories.js';
import {parseExploreState,exploreUrl} from '../.build/src/explore/state.js';

const expected=['en','ro','fr','es','pt','de','it','nl','pl','tr','ru','uk','ar','he','fa','ur','hi','bn','zh-Hans','zh-Hant','ja','ko','id','ms','vi','th','sw','ta','te','fil'];

test('the shipped catalog identifies all30 locales and four RTL interfaces without country restrictions',()=>{
  assert.deepEqual(LOCALES.map(value=>value.code),expected);
  assert.equal(new Set(LOCALES.map(value=>value.nativeName)).size,30);
  assert.deepEqual(LOCALES.filter(value=>value.direction==='rtl').map(value=>value.code),['ar','he','fa','ur']);
  assert.ok(Object.isFrozen(LOCALES));
  for(const value of LOCALES){assert.ok(Object.isFrozen(value));assert.ok(value.nativeName.trim());assert.equal(Intl.getCanonicalLocales(value.code)[0],value.code);}
});

test('all30 dictionaries contain exactly113 messages and20 categories with identical placeholder contracts',()=>{
  assert.equal(MESSAGE_KEYS.length,113);assert.equal(new Set(MESSAGE_KEYS).size,113);
  assert.equal(PUBLIC_EDITORIAL_CATEGORIES.length,20);
  assert.deepEqual(Object.keys(MESSAGES),expected);assert.deepEqual(Object.keys(CATEGORY_LABELS),expected);
  for(const locale of expected){
    const dictionary=MESSAGES[locale];
    assert.ok(Object.isFrozen(dictionary));assert.ok(Object.isFrozen(CATEGORY_LABELS[locale]));
    assert.deepEqual(Object.keys(dictionary),[...MESSAGE_KEYS]);
    assert.deepEqual(Object.keys(CATEGORY_LABELS[locale]),[...PUBLIC_EDITORIAL_CATEGORIES]);
    for(const key of MESSAGE_KEYS){
      assert.equal(typeof dictionary[key],'string');assert.ok(dictionary[key].trim(),locale+':'+key);
      assert.deepEqual(messageParameters(dictionary[key]),messageParameters(MESSAGES.en[key]),locale+':'+key);
      assert.doesNotMatch(dictionary[key],/TODO|TRANSLATE_ME|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Surrogate}]/u);
    }
    for(const category of PUBLIC_EDITORIAL_CATEGORIES)assert.ok(categoryLabel(locale,category).trim(),locale+':'+category);
  }
});

test('non-English locales supply their own reading, lookup and coverage copy instead of silent English inheritance',()=>{
  for(const locale of expected.filter(value=>value!=='en')){
    for(const key of ['navToday','lookupError','coverage','openSource','originalContentNote','followExcludedConflicts']){
      assert.notEqual(MESSAGES[locale][key],MESSAGES.en[key],locale+':'+key);
    }
  }
  assert.notEqual(categoryLabel('zh-Hans','world'),categoryLabel('zh-Hant','world'));
  assert.notEqual(MESSAGES.ja.language,MESSAGES['zh-Hans'].language);
});

test('every message interpolates its declared values and preserves original-script names',()=>{
  for(const locale of expected){
    for(const key of MESSAGE_KEYS){
      const params=Object.fromEntries([...new Set(messageParameters(MESSAGES[locale][key]))].map(name=>[name,['count','remaining','total','local','national'].includes(name)?12:name==='time'?'14:32':'東京']));
      const result=t(locale,key,params);
      assert.doesNotMatch(result,/\{[a-zA-Z]+\}/u,locale+':'+key);
      if(Object.values(params).includes('東京'))assert.ok(result.includes('東京'),locale+':'+key);
    }
  }
  assert.equal(t('fr','checkedAt',{time:'14:32'}),'Vérifié à 14:32');
  assert.match(t('ar','matchingStories',{count:1234}),new RegExp(new Intl.NumberFormat('ar').format(1234)));
});

test('canonical regional and script tags negotiate to the explicitly shipped locale',()=>{
  for(const [tag,locale] of [
    ['en-GB','en'],['FR-fr','fr'],['pt-BR','pt'],['es-419','es'],['ro-RO','ro'],
    ['zh','zh-Hans'],['zh-CN','zh-Hans'],['zh-SG','zh-Hans'],['zh-TW','zh-Hant'],
    ['zh-HK','zh-Hant'],['zh-MO','zh-Hant'],['zh-Hant-CN','zh-Hant'],['zh-Hans-TW','zh-Hans'],
    ['tl-PH','fil'],['fil-PH','fil'],['iw-IL','he'],['in-ID','id'],['ja-JP','ja'],['ko-KR','ko'],
    ['de-DE-u-co-phonebk','de'],['ar-EG-u-nu-latn','ar'],['zh-TW-u-ca-chinese','zh-Hant'],
  ])assert.equal(resolveLocale(tag,['de']),locale,tag);
});

test('only an absent explicit choice negotiates browser preferences; unknown or invalid explicit choices use English',()=>{
  assert.equal(resolveLocale(null,['zz-ZZ','uk-UA','fr']),'uk');
  assert.equal(resolveLocale(undefined,['zz-ZZ','zh-HK']),'zh-Hant');
  assert.equal(resolveLocale('https://www.dlkt.ee/?city=1850147',['ja-JP','fr']),'ja');
  assert.equal(resolveLocale('/?explore=1',['ar']),'ar');
  assert.equal(resolveLocale('https://www.dlkt.ee/?lang=unknown',['fr']),'en');
  assert.equal(resolveLocale('xx',['fr']),'en');
  assert.equal(resolveLocale('',['fr']),'en');
  assert.equal(resolveLocale('https://www.dlkt.ee/?lang=fr',['ja']),'fr');
  assert.equal(resolveLocale(null,[]),'en');
  assert.equal(resolveLocale(null,['zz-ZZ']),'en');
});

test('duplicate and malicious language parameters fail closed without using an arbitrary first value',()=>{
  for(const query of ['lang=fr&lang=ar','lang=fr&lang=fr','lang=fr&l%61ng=ar','lang=',
    'lang=..%2F..%2Far','lang=%3Cscript%3E','lang=%D0%B0r','lang=__proto__',
    'lang=constructor','lang=fr%00','lang=en_US','lang=en-u','lang=en-x','lang=de-DE-u-u-co-phonebk','lang='+('en-'.repeat(50)+'US')]){
    const url='https://www.dlkt.ee/?'+query;
    assert.equal(localeFromUrl(url),null,query);
    assert.equal(resolveLocale(url,['fr','ar']),'en',query);
  }
  assert.equal(localeFromUrl('https://www.dlkt.ee/?lang=%66%72'),'fr');
  assert.equal(localeFromUrl('https://www.dlkt.ee/#lang=ar'),null);
  assert.equal(localeFromUrl('javascript:alert(1)?lang=fr'),null);
  assert.equal(resolveLocale('javascript:alert(1)?lang=fr',['fr']),'en');
});

test('language URLs preserve city, country, category, repeated unrelated parameters and the exact hash',()=>{
  const input=new URL('https://www.dlkt.ee/?explore=1&city=1850147&country=JP&category=culture&ref=one&ref=two&lang=en#card=original-123');
  const before=input.href,explore=parseExploreState(input),next=localeUrl(input,'ar'),url=new URL(next);
  assert.equal(input.href,before);
  assert.deepEqual(url.searchParams.getAll('ref'),['one','two']);
  assert.equal(url.hash,'#card=original-123');assert.equal(localeFromUrl(next),'ar');
  assert.deepEqual(parseExploreState(next),explore);
  assert.equal(localeFromUrl(exploreUrl(next,{...explore,cityId:'2988507',countryCode:'FR'})),'ar');
  assert.equal(localeFromUrl(localeUrl(next,'fr')),'fr');
  assert.equal(new URL(localeUrl('https://www.dlkt.ee/?lang=en&lang=de','ro')).searchParams.getAll('lang').length,1);
  assert.equal(localeUrl('/?city=1850147#cards','ja'),'/?city=1850147&lang=ja#cards');
});

test('language is independent of geography and does not force an interface from a country code',()=>{
  for(const country of ['JP','FR','ZA','US','RO','SA','IL']){
    assert.equal(resolveLocale('https://www.dlkt.ee/?country='+country,['pl-PL']),'pl');
    assert.equal(resolveLocale('https://www.dlkt.ee/?country='+country+'&lang=hi',['en']),'hi');
  }
});

test('RTL sentences isolate substituted names and discard injected directional overrides only within UI parameters',()=>{
  for(const locale of ['ar','he','fa','ur']){
    const result=t(locale,'mentioning',{city:'Paris'});
    assert.ok(result.includes('\u2068Paris\u2069'));
    assert.equal((result.match(/\u2068/gu)??[]).length,1);
    assert.equal((result.match(/\u2069/gu)??[]).length,1);
    const parameter='Paris\u202eXYZ\u202c';
    assert.ok(t(locale,'mentioning',{city:parameter}).includes('\u2068ParisXYZ\u2069'));
    assert.equal(parameter,'Paris\u202eXYZ\u202c');
  }
  assert.equal(t('en','mentioning',{city:'東京'}),'Mentioning 東京');
  const markup='<img src=x onerror=alert(1)>';
  assert.equal(t('en','mentioning',{city:markup}),'Mentioning '+markup,'t returns text; DOM integration must use textContent');
});

test('missing messages, categories or placeholders fail loudly rather than falling back to English',()=>{
  assert.throws(()=>t('xx','navToday'),/I18N_LOCALE_INVALID/);
  assert.throws(()=>t('fr','missingKey'),/I18N_MESSAGE_INVALID/);
  assert.throws(()=>t('fr','__proto__'),/I18N_MESSAGE_INVALID/);
  assert.throws(()=>t('fr','mentioning'),/I18N_PARAMETERS_INVALID/);
  assert.throws(()=>t('fr','navToday',{extra:'value'}),/I18N_PARAMETERS_INVALID/);
  assert.throws(()=>t('fr','matchingStories',{count:NaN}),/I18N_PARAMETER_VALUE_INVALID/);
  assert.throws(()=>categoryLabel('fr','unsupported'),/I18N_CATEGORY_INVALID/);
  assert.throws(()=>categoryLabel('xx','world'),/I18N_LOCALE_INVALID/);
  assert.throws(()=>localeUrl('https://www.dlkt.ee/','xx'),/I18N_LOCALE_INVALID/);
  assert.throws(()=>localeUrl('javascript:alert(1)','fr'),/I18N_URL_INVALID/);
});
