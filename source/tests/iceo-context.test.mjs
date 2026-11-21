import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {contextForCard,contextFromPublisherCategories,validArticleContext,validContextForCard} from '../.build/src/iceo/context.js';
import {extract} from '../.build/src/iceo/extract.js';
import {GENERAL_FEEDS} from '../.build/src/iceo/general-feeds.js';
import {cardContent,copyCard,validCard} from '../.build/src/iceo/card-validation.js';

const now=Date.parse('2026-11-18T12:00:00Z');
const source=GENERAL_FEEDS.find(item=>item.id==='gv-world');
assert.ok(source);
const xml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const credits='<div class="gv-rss-footer"><div class="text-credits-section"><span class="credit-label">Written by</span><a class="user-link">Publisher Author</a></div><div class="text-credits-section"><span class="credit-label">Translated by</span><a class="user-link">Publisher Translator</a></div></div>';
function feed({categories=[],rawCategories='',title='A source report about Romania, Spain and the United Kingdom',summary='A complete publisher excerpt.',body=credits,url='https://globalvoices.org/2026/11/17/context-fixture/'}={}){
 return `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>${xml(source.feed.title)}</title><link>https://globalvoices.org/</link><item><title>${xml(title)}</title><link>${xml(url)}</link><pubDate>Tue, 17 Nov 2026 10:00:00 GMT</pubDate><dc:creator>Feed creator is not the author</dc:creator>${categories.map(value=>`<category>${xml(value)}</category>`).join('')}${rawCategories}<description><![CDATA[${summary}]]></description><content:encoded><![CDATA[${body}]]></content:encoded></item></channel></rss>`;
}
function extracted(options={}){
 const result=extract(feed(options),source,now);assert.equal(result.rejected,0);assert.equal(result.cards.length,1);return result.cards[0];
}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('publisher country tags use an exact allowlist and deterministic deduplicated order',()=>{
 const context=contextFromPublisherCategories('gv-world',['Spain','Romania','United Kingdom','Romania','  romania  ']);
 assert.deepEqual(context.countries,[{code:'ES',name:'Spain'},{code:'GB',name:'United Kingdom'},{code:'RO',name:'Romania'}]);
 assert.deepEqual(context,contextFromPublisherCategories('gv-culture',['United Kingdom','Romania','Spain']));
 assert.equal(context.basis,'publisher-category');assert.match(context.boundary,/not proof.*personal impact/u);assert.ok(validArticleContext(context));
 assert.deepEqual(contextFromPublisherCategories('gv-world',['U.S.A.','United States']).countries,[{code:'US',name:'United States'}]);
});
test('unknown, ambiguous, regional, compound and markup-like tags do not create country evidence',()=>{
 const tags=['Georgia','Congo','Korea','America','Europe','Eastern & Central Europe','Romania / Moldova','War in Ukraine','<b>Romania</b>','Romania\u0000','Atlantis'];
 assert.equal(contextFromPublisherCategories('gv-world',tags),undefined);
 assert.deepEqual(contextFromPublisherCategories('gv-world',[...tags,'Spain']).countries,[{code:'ES',name:'Spain'}]);
 assert.equal(contextFromPublisherCategories('fda-news',['Romania']),undefined);
 assert.equal(contextFromPublisherCategories('gv-world',Array(129).fill('Romania')),undefined);
 assert.equal(contextFromPublisherCategories('gv-world',['Romania','Spain','United Kingdom','France','Germany','Italy','Poland','Portugal','Canada']),undefined);
});
test('the actual RSS extractor preserves country evidence, original credits and excerpt through validation and copying',()=>{
 const card=extracted({categories:['Human Rights','Romania'],rawCategories:'<category domain="https://globalvoices.org/-/world/western-europe/spain/">Spain</category>'});
 assert.deepEqual(card.context.countries,[{code:'ES',name:'Spain'},{code:'RO',name:'Romania'}]);assert.equal(card.context.basis,'publisher-category');
 assert.equal(card.byline,'Written by Publisher Author · Translated by Publisher Translator');assert.equal(card.licenseUrl,'https://creativecommons.org/licenses/by/3.0/');assert.equal(card.summary,'A complete publisher excerpt.');
 assert.ok(validCard(card));const copy=copyCard(card);assert.deepEqual(copy,card);assert.notEqual(copy.context,card.context);assert.notEqual(copy.context.countries,card.context.countries);assert.notEqual(copy.context.countries[0],card.context.countries[0]);
 assert.equal(hash(cardContent(card)),card.contentHash);
});
test('titles, descriptions, credit names and category attributes are not geographic evidence',()=>{
 const card=extracted({rawCategories:'<category term="Romania" label="Spain"/>',summary:'Romania and the United Kingdom are mentioned here.'});
 assert.equal(card.context.basis,'unspecified');assert.deepEqual(card.context.countries,[]);
 const mixed=extracted({categories:['Georgia','Europe','Romania / Spain']});assert.equal(mixed.context.basis,'unspecified');
 assert.deepEqual(contextForCard({sourceIds:['gv-world'],title:'Romania',publisher:'A Bucharest publisher'}).countries,[]);
});
test('publisher scope is labelled separately and never becomes inferred article affectation',()=>{
 for(const id of ['govuk-news','govuk-products','ncsc-news']){
  const context=contextForCard({sourceIds:[id]});assert.equal(context.basis,'publisher-scope');assert.deepEqual(context.countries,[{code:'GB',name:'United Kingdom'}]);assert.match(context.boundary,/not an article-specific affected location/u);
 }
 assert.deepEqual(contextForCard({sourceIds:['fda-news'],title:'Romania'}).countries,[{code:'US',name:'United States'}]);
 for(const id of ['nasa-news','usgs-news','eu-law','ecb-news','ecb-statistics','eff-digital'])assert.deepEqual(contextForCard({sourceIds:[id]}).countries,[],id);
 assert.equal(contextForCard({sourceIds:['nasa-news']}).label,'Science and space · publisher scope');
 assert.equal(contextForCard({sourceIds:['ecb-news']}).label,'Euro area · publisher scope');
 assert.equal(contextForCard({sourceIds:['unknown-source']}).basis,'unspecified');
 assert.equal(contextForCard({sourceIds:['fda-news','govuk-news']}).basis,'unspecified');
});
test('context validation rejects unknown fields, unsupported countries, misleading labels and cross-publisher attachment',()=>{
 const card=extracted({categories:['Romania','Spain']}),good=card.context;
 const bad=[null,{}, {...good,affectsYou:true},{...good,countries:[{code:'RO',name:'Spain'}]},{...good,countries:[{code:'ZZ',name:'Unknown'}]},{...good,countries:[{code:'RO',name:'Romania',impact:true}]},{...good,countries:[...good.countries].reverse()},{...good,countries:[good.countries[0],good.countries[0]]},{...good,label:'This affects you in Romania'},{...good,boundary:'A confirmed personal impact'},{...good,basis:'inferred'}];
 for(const context of bad){assert.equal(validArticleContext(context),false);assert.equal(validCard({...card,context}),false);}
 assert.equal(validContextForCard(good,['fda-news']),false);assert.equal(validContextForCard(good,['gv-world','fda-news']),false);
 assert.equal(validCard({...card,context:contextForCard({sourceIds:['govuk-news']})}),false);
 assert.equal(validContextForCard(contextForCard({sourceIds:['fda-news']}),['govuk-news']),false);
 assert.equal(contextForCard({...card,context:{...good,label:'Unsafe replacement'}}).basis,'unspecified');
});
test('legacy cards keep their legacy content shape and copy semantics',()=>{
 const current=extracted({categories:['Romania']}),{context:removed,...legacy}=current;
 legacy.contentHash=hash(cardContent(legacy));assert.ok(removed);assert.ok(validCard(legacy));assert.deepEqual(copyCard(legacy),legacy);assert.equal('context'in copyCard(legacy),false);
 const expected={identity:legacy.identity,title:legacy.title,sourceUrl:legacy.sourceUrl,date:legacy.date,dateLabel:legacy.dateLabel,publisher:legacy.publisher,deadline:legacy.deadline,version:legacy.version,summary:legacy.summary,byline:legacy.byline,licenseUrl:legacy.licenseUrl};
 assert.deepEqual(cardContent(legacy),expected);assert.equal(hash(expected),legacy.contentHash);
});
test('a source category change alters the integrity hash without changing document identity',()=>{
 const before=extracted({categories:['Romania']}),after=extracted({categories:['Spain']});
 assert.equal(before.id,after.id);assert.equal(before.identity,after.identity);assert.notEqual(before.contentHash,after.contentHash);
 assert.equal(hash(cardContent(before)),before.contentHash);assert.equal(hash(cardContent(after)),after.contentHash);
});
test('geographic categories cannot bypass existing source, licence or XML protections',()=>{
 assert.equal(extract(feed({categories:['Romania'],body:''}),source,now).rejected,1);
 assert.equal(extract(feed({categories:['Romania'],url:'https://attacker.invalid/story'}),source,now).rejected,1);
 assert.throws(()=>extract('<!DOCTYPE x>'+feed({categories:['Romania']}),source,now),/XML_REJECTED/u);
});
