import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {NewsPageService,parseNewsPageRequest} from '../.build/src/iceo/news-page.js';
import {validNewsPage} from '../.build/src/iceo/news-page-contracts.js';
import {sourceEditionCountryCode,sourceLanguage} from '../.build/src/iceo/news-sources.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {searchCities,findCity} from '../.build/src/local/cities.js';
import {NOW,iso,hash,article,local,epoch,CorpusMemoryStore,CATEGORIES} from './fixtures/news-corpus.mjs';

const KEY='test-only-news-cursor-writer-123456789012345678901234567890';
const request=(language,cityId=null,filter='all',cursor=null,sourceScope)=>({language,cityId,filter,cursor,...(sourceScope===undefined?{}:{sourceScope})});
const city=(name,country)=>{const found=searchCities(name,country,12).find(row=>row.countryCode===country);assert.ok(found);return found;};
function publication(index,publisher,sourceUrl,title){
 const record={...article(index),id:hash(sourceUrl).slice(0,24),identity:sourceUrl,sourceUrl,publisher,title,attribution:'Source: '+publisher+'. Open the original publication.'};
 record.contentHash=hash(cardContent(record));return record;
}
async function allPages(service,language,cityId,filter='all',sourceScope){
 const items=[],pages=[];let cursor=null;
 do{const page=await service.read(request(language,cityId,filter,cursor,sourceScope));items.push(...page.items);pages.push(page);cursor=page.nextCursor;assert.ok(pages.length<=250);}while(cursor);
 return {items,pages};
}
function assertCategoryCycles(items){
 const remaining=new Map();
 for(const item of items){const category=item.category??'other';remaining.set(category,(remaining.get(category)??0)+1);}
 let offset=0;
 while(offset<items.length){
  const active=[...remaining].filter(([,count])=>count>0).map(([category])=>category),cycle=items.slice(offset,offset+active.length);
  assert.deepEqual(new Set(cycle.map(item=>item.category??'other')),new Set(active));
  if(offset&&active.length>1)assert.notEqual(items[offset-1].category??'other',cycle[0].category??'other');
  for(const item of cycle){const category=item.category??'other';remaining.set(category,remaining.get(category)-1);}
  offset+=active.length;
 }
}

test('national publications precede international pages with category diversity inside each band',async()=>{
 const london=city('London','GB'),categories=Object.keys(CATEGORIES);
 const national=Array.from({length:36},(_,i)=>publication(i+1,'The Guardian','https://www.theguardian.com/news/2026/nov/22/country-fixture-'+i,CATEGORIES[categories[i%categories.length]]+' '+i));
 const international=Array.from({length:36},(_,i)=>article(i+101,{category:categories[i%categories.length]}));
 const before=JSON.stringify([...national,...international]),service=new NewsPageService(new CorpusMemoryStore([epoch([...international,...national])]),KEY,()=>NOW+1000);
 const {items,pages}=await allPages(service,'en',london.id);
 assert.equal(items.length,72);assert.equal(new Set(items.map(item=>item.key)).size,72);
 const nationalItems=items.slice(0,36),internationalItems=items.slice(36);
 assert.ok(nationalItems.every(item=>sourceEditionCountryCode(item.card)==='GB'),'all national originals precede the international band');
 assert.ok(internationalItems.every(item=>sourceEditionCountryCode(item.card)!=='GB'),'international originals remain reachable after the national band');
 assertCategoryCycles(nationalItems);assertCategoryCycles(internationalItems);
 assert.equal(pages.length,4);
 assert.ok(pages[0].items.every(item=>sourceEditionCountryCode(item.card)==='GB'));
 assert.ok(pages[1].items.slice(0,16).every(item=>sourceEditionCountryCode(item.card)==='GB'));
 assert.ok(pages[1].items.slice(16).every(item=>sourceEditionCountryCode(item.card)!=='GB'),'a band boundary can fall inside a page without resetting the order');
 for(const page of pages){assert.equal(page.countryCode,'GB');assert.deepEqual(page.coverage,{national:36,local:0,international:36});assert.ok(validNewsPage(page,NOW+1000,london));}
 for(const category of new Set(items.map(item=>item.category))){
  const inCategory=items.filter(item=>item.category===category);
  assert.deepEqual(new Set(inCategory.map(item=>item.card.publisher)),new Set(['The Guardian','DW']));
  const projected=await allPages(service,'en',london.id,category??'other');assert.deepEqual(projected.items,inCategory);
 }
 assert.deepEqual(new Map(items.map(item=>[item.card.id,item.card])),new Map([...national,...international].map(card=>[card.id,card])));
 assert.equal(JSON.stringify([...national,...international]),before);
});
test('Romanian national provenance and verified Bucharest articles are counted separately',async()=>{
 const national=publication(1,'HotNews.ro','https://hotnews.ro/national-fixture-20261122','Parlamentul adopta noua propunere');
 const international=article(2,{language:'ro'}),entry=local(2),service=new NewsPageService(new CorpusMemoryStore([epoch([international,national],[entry])]),KEY,()=>NOW+1000);
 const bucharest=await service.read(request('ro',entry.city.id));
 assert.equal(bucharest.countryCode,'RO');assert.deepEqual(bucharest.coverage,{national:1,local:2,international:1});
 assert.equal(bucharest.items.filter(item=>item.kind==='local').length,2);assert.deepEqual(bucharest.items.map(item=>item.kind),['local','local','global','global']);assert.equal(bucharest.items[2].card,national);assert.equal(bucharest.items[3].card,international);assert.ok(validNewsPage(bucharest,NOW+1000,entry.city));
 const cluj=city('Cluj','RO'),elsewhere=await service.read(request('ro',cluj.id));
 assert.equal(elsewhere.countryCode,'RO');assert.deepEqual(elsewhere.coverage,{national:1,local:0,international:1});
 assert.ok(elsewhere.items.every(item=>item.kind==='global'));
});
test('Torino and Rome receive the same verified Italian national edition without invented city coverage',async()=>{
 const turin=city('Torino','IT'),rome=city('Roma','IT'),london=city('London','GB');
 const italian=publication(1,'la Repubblica','https://www.repubblica.it/politica/2026/11/22/news/national-fixture-425742775/','Il governo presenta la proposta al Parlamento');
 const english=article(2),romanian=article(3,{language:'ro'}),records=[english,romanian,italian],before=JSON.stringify(records);
 const service=new NewsPageService(new CorpusMemoryStore([epoch(records)]),KEY,()=>NOW+1000);
 for(const selectedCity of [turin,rome]){
  const page=await service.read(request('it',selectedCity.id));
  assert.equal(page.countryCode,'IT');assert.deepEqual(page.coverage,{national:1,local:0,international:0});
  assert.equal(page.total,1);assert.equal(page.items[0].card,italian);assert.equal(page.items[0].kind,'global');assert.equal(italian.context,undefined);
  assert.equal(sourceLanguage(page.items[0].card),'it');assert.ok(validNewsPage(page,NOW+1000,selectedCity));
  const en=await service.read(request('en',selectedCity.id));assert.equal(en.total,1);assert.equal(en.items[0].card,english);
  assert.deepEqual(en.coverage,{national:0,local:0,international:1});
 }
 const italianAbroad=await service.read(request('it',london.id));
 assert.deepEqual(italianAbroad.coverage,{national:0,local:0,international:1});assert.equal(italianAbroad.items[0].card,italian);
 assert.equal(JSON.stringify(records),before);
});
test('an unavailable national edition is explicit and English remains the original international fallback',async()=>{
 const turin=city('Torino','IT'),bangkok=city('Bangkok','TH'),records=[article(1),article(2,{language:'ro'})];
 const service=new NewsPageService(new CorpusMemoryStore([epoch(records)]),KEY,()=>NOW+1000);
 const absent=await service.read(request('it',turin.id));
 assert.equal(absent.countryCode,'IT');assert.equal(absent.language,'it');assert.equal(absent.total,0);
 assert.deepEqual(absent.coverage,{national:0,local:0,international:0});assert.equal(absent.nextCursor,null);
 for(const selectedCity of [turin,bangkok]){
  const english=await service.read(request('en',selectedCity.id));assert.equal(english.countryCode,selectedCity.countryCode);
  assert.deepEqual(english.coverage,{national:0,local:0,international:1});assert.equal(english.language,'en');
  assert.equal(english.items[0].card,records[0]);assert.equal(sourceLanguage(english.items[0].card),'en');
  assert.equal(english.items[0].kind,'global');assert.ok(validNewsPage(english,NOW+1000,selectedCity));
 }
});
test('country metadata and coverage reject forged context and never label a source country as city evidence',async()=>{
 const london=city('London','GB'),turin=city('Torino','IT');
 const record=publication(1,'The Guardian','https://www.theguardian.com/world/2026/nov/22/italy-fixture','Italy parliament debates proposal');
 const service=new NewsPageService(new CorpusMemoryStore([epoch([record])]),KEY,()=>NOW+1000),page=await service.read(request('en',london.id));
 assert.deepEqual(page.coverage,{national:1,local:0,international:0});assert.equal(record.context,undefined);
 for(const mutate of [
  value=>{value.countryCode='IT';},value=>{value.countryCode=null;},value=>{value.coverage.local++;},
  value=>{value.coverage={national:0,local:1,international:0};},value=>{value.coverage.secret=1;},value=>{delete value.coverage;},
 ]){const bad=structuredClone(page);mutate(bad);assert.equal(validNewsPage(bad,NOW+1000,london),false);}
 assert.equal(validNewsPage(page,NOW+1000,turin),false);
 const unlocated=await service.read(request('en'));assert.equal(unlocated.countryCode,null);assert.deepEqual(unlocated.coverage,{national:0,local:0,international:1});
 assert.equal(validNewsPage({...unlocated,countryCode:'GB'},NOW+1000),false);
 await assert.rejects(service.read(request('en','999999999999')),/NEWS_PAGE_QUERY_INVALID/);
 assert.throws(()=>parseNewsPageRequest('/api/news-page?lang=en&country=IT'),/NEWS_PAGE_QUERY_INVALID/);
});
test('the signed cursor binds national context and old cursor versions expire without reshuffling',async()=>{
 const london=city('London','GB'),turin=city('Torino','IT'),edition=epoch(Array.from({length:45},(_,i)=>article(i+1)));
 const service=new NewsPageService(new CorpusMemoryStore([edition]),KEY,()=>NOW+1000),page=await service.read(request('en',london.id));
 const [encoded]=page.nextCursor.split('.'),payload=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));
 assert.equal(payload.orderVersion,'iptc17-local-national-world-publisher-rounds-20261125-r7');
 assert.equal(payload.version,'news-cursor-6');assert.equal(payload.sourceScope,'edition');assert.equal(payload.countryCode,'GB');assert.equal(payload.kind,'page');assert.equal(payload.storyKey,null);
 const sign=value=>{const body=Buffer.from(JSON.stringify(value)).toString('base64url'),key=createHmac('sha256',KEY).update('dlkt-info/news-page/cursor-key/v1').digest();
  return body+'.'+createHmac('sha256',key).update('dlkt-info/news-page/cursor/v1:'+body).digest('base64url');};
 const changed=sign({...payload,countryCode:'IT'});
 await assert.rejects(service.read(request('en',london.id,'all',sign({...payload,orderVersion:'iptc17-source-scope-publisher-rounds-20261124-r6'}))),/NEWS_EDITION_EXPIRED/,'old mixed-geography offsets expire under continuous bands');
 await assert.rejects(service.read(request('en',london.id,'all',sign({...payload,orderVersion:'iptc17-country-day-local-first-20261123'}))),/NEWS_EDITION_EXPIRED/);
 await assert.rejects(service.read(request('en',london.id,'all',changed)),/NEWS_CONTEXT_MISMATCH/);
 await assert.rejects(service.read(request('en',turin.id,'all',page.nextCursor)),/NEWS_CONTEXT_MISMATCH/);
 const {countryCode,...old}=payload;
 await assert.rejects(service.read(request('en',london.id,'all',sign({...old,version:'news-cursor-1',orderVersion:edition.corpus.orderVersion}))),/NEWS_EDITION_EXPIRED/);
 await assert.rejects(service.read(request('en',london.id,'all',sign({...payload,version:'news-cursor-2'}))),/NEWS_EDITION_EXPIRED/,'a pre-fix cursor cannot reuse its offset after language provenance changes');
 await assert.rejects(service.read(request('en',london.id,'all',sign({...payload,version:'news-cursor-3'}))),/NEWS_EDITION_EXPIRED/,'a pre-calendar cursor cannot reuse its offset under the new ordering policy');
 await assert.rejects(service.read(request('en',london.id,'all',sign({...payload,version:'news-cursor-4'}))),/NEWS_EDITION_EXPIRED/,'an article-offset cursor cannot be reused after whole-edition story grouping');
 await assert.rejects(service.read(request('en',london.id,'all',sign({...payload,version:'news-cursor-5'}))),/NEWS_EDITION_EXPIRED/,'a pre-diversity cursor cannot reuse its offset in publisher rounds');
 const next=await service.read(request('en',london.id,'all',page.nextCursor));
 assert.deepEqual(next.coverage,page.coverage);assert.equal(next.countryCode,page.countryCode);
 assert.equal(new Set([...page.items,...next.items].map(item=>item.key)).size,40);
});
test('a first page retries planning once if a marginal source expires before the response',async()=>{
 const cards=Array.from({length:45},(_,index)=>article(index+1,{observed:index===0?NOW-3599000:NOW})),edition=epoch(cards);
 let ticks=0;const clock=()=>++ticks<4?NOW:NOW+2000;
 const store=new CorpusMemoryStore([edition]),service=new NewsPageService(store,KEY,clock),page=await service.read(request('en'));
 assert.equal(page.startedAt,iso(NOW+2000));assert.equal(page.generatedAt,iso(NOW));assert.equal(page.total,44);
 assert.equal(page.items.some(item=>item.card.id===cards[0].id),false);assert.equal(page.expiresAt,iso(NOW+3600000));
 assert.ok(validNewsPage(page,NOW+2000));assert.equal(ticks,6,'one bounded replan plus the final payload freshness check');
 assert.deepEqual(store.reads,[null],'the replan reuses the committed corpus without polling persistence');
});

test('existing corpus originals follow their article edition language without rewriting records or hashes',async()=>{
 const turin=city('Torino','IT');
 const english=publication(1,'la Repubblica','https://www.repubblica.it/en/europe/culture/2026/11/22/news/san_gennaro_s_treasures_cross_the_atlantic_for_the_first_time-425738300/',"San Gennaro's treasures cross the Atlantic for the first time");
 const italian=publication(2,'la Repubblica','https://www.repubblica.it/esteri/2026/11/22/news/trump_kim_i_tentativi_del_presidente_usa_di_incontrare_il_leader_nordcoreano-425742784/','Telefonate respinte e una lettera cestinata. Tutti i rifiuti di Kim-Jong a Trump');
 // Dates are controlled fixture times. These canonical URLs reproduce the production language boundary.
 const stored=epoch([english,italian]),before=JSON.stringify(stored);
 const service=new NewsPageService(new CorpusMemoryStore([stored]),KEY,()=>NOW+1000);
 const it=await service.read(request('it',turin.id)),en=await service.read(request('en',turin.id));
 assert.equal(it.epoch,stored.epoch);assert.equal(en.epoch,stored.epoch);
 assert.equal(it.total,1);assert.equal(it.items[0].card,italian);assert.equal(sourceLanguage(it.items[0].card),'it');
 assert.equal(en.total,1);assert.equal(en.items[0].card,english);assert.equal(sourceLanguage(en.items[0].card),'en');
 assert.deepEqual(it.coverage,{national:1,local:0,international:0});assert.deepEqual(en.coverage,{national:1,local:0,international:0});
 assert.ok(validNewsPage(it,NOW+1000,turin));assert.ok(validNewsPage(en,NOW+1000,turin));
 for(const card of [english,italian])assert.equal(card.contentHash,hash(cardContent(card)));
 assert.equal(JSON.stringify(stored),before,'reading reclassifies provenance without restamping or replacing the persisted corpus');
 assert.equal(validNewsPage({...it,items:en.items},NOW+1000,turin),false,'an English original cannot pass the Italian page contract');
});


test('source scope is explicit, bounded and optional requests keep the native edition',()=>{
 assert.deepEqual(parseNewsPageRequest('/api/news-page?lang=ro'),request('ro'));
 assert.deepEqual(parseNewsPageRequest('/api/news-page?lang=ro&sourceScope=all'),request('ro',null,'all',null,'all'));
 assert.deepEqual(parseNewsPageRequest('/api/news-page?lang=ro&sourceScope=edition'),request('ro',null,'all',null,'edition'));
 for(const value of ['','ALL','unknown','null','all&sourceScope=edition']){
  assert.throws(()=>parseNewsPageRequest('/api/news-page?lang=ro&sourceScope='+value),/NEWS_PAGE_QUERY_INVALID/);
 }
});

test('all-source pages retain original languages and signed cursors cannot cross source scope',async()=>{
 const entry=local(1),records=[...Array.from({length:25},(_,i)=>article(i+1,{language:'ro'})),
  ...Array.from({length:25},(_,i)=>article(i+101,{language:'en'}))],stored=epoch(records,[entry]),before=JSON.stringify(stored);
 const service=new NewsPageService(new CorpusMemoryStore([stored]),KEY,()=>NOW+1000);
 const native=await service.read(request('ro',entry.city.id)),all=await allPages(service,'ro',entry.city.id,'all','all');
 assert.equal(native.sourceScope,'edition');assert.equal(native.total,26);
 assert.ok(native.items.filter(item=>item.kind==='global').every(item=>sourceLanguage(item.card)==='ro'));
 assert.equal(all.items.length,51);assertCategoryCycles(all.items);
 assert.equal(all.items[0].kind,'local');assert.equal(all.items.filter(item=>item.kind==='local').length,1);
 assert.deepEqual(new Set(all.items.filter(item=>item.kind==='global').map(item=>sourceLanguage(item.card))),new Set(['ro','en']));
 for(const page of all.pages){assert.equal(page.sourceScope,'all');assert.equal(page.language,'ro');assert.ok(validNewsPage(page,NOW+1000,entry.city));}
 assert.deepEqual(new Map(all.items.filter(item=>item.kind==='global').map(item=>[item.card.id,item.card])),new Map(records.map(card=>[card.id,card])));
 assert.equal(new Set(all.items.map(item=>item.key)).size,51);
 await assert.rejects(service.read(request('ro',entry.city.id,'all',all.pages[0].nextCursor,'edition')),/NEWS_CONTEXT_MISMATCH/);
 await assert.rejects(service.read(request('ro',entry.city.id,'all',native.nextCursor,'all')),/NEWS_CONTEXT_MISMATCH/);
 assert.equal(JSON.stringify(stored),before,'reading all sources changes no original text, dates, hashes or language provenance');
});

test('publisher rounds preserve one confirmed shared-event group and all mixed-language source continuations',async()=>{
 const records=Array.from({length:8},(_,index)=>{
  const record={...article(index+700,{language:index%2?'ro':'en'}),title:'Researchers disclose CVE-2026-43111 in a browser security report '+index};
  record.contentHash=hash(cardContent(record));return record;
 });
 const fillers=Array.from({length:45},(_,index)=>article(index+800,{category:Object.keys(CATEGORIES)[index%18]}));
 const stored=epoch([...records,...fillers]),before=JSON.stringify(stored),service=new NewsPageService(new CorpusMemoryStore([stored]),KEY,()=>NOW+1000);
 const all=await allPages(service,'ro',null,'all','all');
 assert.equal(all.items.length,46);assert.equal(new Set(all.items.map(item=>item.key)).size,46);
 assertCategoryCycles(all.items);
 const grouped=all.items.filter(item=>item.story?.sourceTotal===8);
 assert.equal(grouped.length,1,'a confirmed event is not expanded into duplicate feed cards for publisher balance');
 const group=grouped[0],sources=[{kind:group.kind,card:group.card},...group.story.related];
 let cursor=group.story.nextSourcesCursor,pages=0;
 assert.ok(cursor,'the fixture must exercise source continuation after the preview');
 while(cursor){
  const page=await service.readSources(cursor);pages++;assert.ok(pages<10);
  assert.equal(page.sourceScope,'all');assert.equal(page.storyKey,group.story.key);assert.equal(page.language,'ro');
  sources.push(...page.sources);cursor=page.nextCursor;
 }
 assert.equal(sources.length,8);assert.equal(new Set(sources.map(source=>source.card.sourceUrl)).size,8);
 assert.deepEqual(new Set(sources.map(source=>sourceLanguage(source.card))),new Set(['ro','en']));
 assert.equal(all.pages[0].articleTotal,53);
 assert.equal(JSON.stringify(stored),before);
});
