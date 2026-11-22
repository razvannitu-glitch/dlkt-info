import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialSourceContext,editorialCardPresentation} from '../.build/src/iceo/editorial-presentation.js';
import {contextFromPublisherCategories} from '../.build/src/iceo/context.js';
import {readingCard} from '../.build/src/iceo/reader.js';
import {MESSAGES,LOCALES,messageParameters} from '../.build/src/i18n/catalog.js';
import {READING_MESSAGE_KEYS} from '../.build/src/i18n/reading-messages.js';
const now=Date.parse('2026-11-22T12:00:00Z');
const card={id:'context-fixture',identity:'fixture:context',title:'Tokyo discusses new research',kind:'publication',topic:'world',publisher:'BBC',sourceUrl:'https://www.bbc.com/japanese/articles/example',sourceIds:['news-world'],date:'2026-11-22T10:00:00.000Z',dateLabel:'Published',observedAt:'2026-11-22T11:00:00.000Z',sourceState:'verified',contentHash:'a'.repeat(64),attribution:'Fixture',boundary:'Fixture'};
test('edition language and publisher country are independent and do not invent an event location',()=>{
 const value=editorialSourceContext(card);
 assert.equal(value.editionLanguage,'ja');assert.deepEqual(value.publisherCountry,{code:'GB',name:'United Kingdom'});assert.equal(value.coverage,null);
 assert.equal('eventCountry' in value,false);assert.ok(Object.isFrozen(value));
});
test('unknown edition language stays unknown and a headline cannot fill missing source context',()=>{
 const value=editorialSourceContext({...card,sourceUrl:'https://example.org/Paris-Tokyo'});
 assert.deepEqual(value,{editionLanguage:null,publisherCountry:null,coverage:null});
 const undated=editorialSourceContext({...card,sourceUrl:'https://www.nytimes.com/section/world'});
 assert.equal(undated.editionLanguage,null);assert.equal(undated.publisherCountry.code,'US');
});
test('only publisher-bound country tags and source scope can be surfaced, with their basis retained',()=>{
 const context=contextFromPublisherCategories('gv-world',['Japan','France']);
 const tagged=editorialSourceContext({...card,sourceIds:['gv-world'],sourceUrl:'https://globalvoices.org/2026/11/22/example',context});
 assert.equal(tagged.coverage.basis,'publisher-category');assert.deepEqual(tagged.coverage.countries.map(value=>value.code),['FR','JP']);
 const forged=editorialSourceContext({...card,context});assert.equal(forged.coverage,null);
 const scoped=editorialSourceContext({...card,sourceIds:['fda-news'],sourceUrl:'https://www.fda.gov/news-events/example'});
 assert.equal(scoped.coverage.basis,'publisher-scope');assert.deepEqual(scoped.coverage.countries.map(value=>value.code),['US']);
});
test('useful provenance leaves original titles, qualifications and publisher excerpts intact',()=>{
 const summary='The measure does not apply to every resident. Eligibility and the closing time remain subject to the original notice.';
 const original={...card,title:'A proposed measure, not yet approved',summary};const before=JSON.stringify(original);
 editorialSourceContext(original);const view=editorialCardPresentation(readingCard(original,now));
 assert.equal(view.headline,original.title);assert.equal(view.visibleContext,summary);assert.equal(JSON.stringify(original),before);
});
test('every new action, provenance label, error and return state has an explicit locale with identical parameters',()=>{
 assert.equal(READING_MESSAGE_KEYS.length,30);
 for(const {code} of LOCALES)for(const key of READING_MESSAGE_KEYS){
  assert.ok(MESSAGES[code][key].trim(),code+':'+key);
  assert.deepEqual(messageParameters(MESSAGES[code][key]),messageParameters(MESSAGES.en[key]),code+':'+key);
  if(code!=='en')assert.notEqual(MESSAGES[code][key],MESSAGES.en[key],code+':'+key);
 }
});
