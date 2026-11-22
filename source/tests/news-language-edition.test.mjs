import {LiveEdition} from '../.build/src/iceo/live-edition.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {newsLanguageMatches,selectNewsLanguage,newsLanguageCoverage,sourceLanguage,NEWS_INDEX_URL} from '../.build/src/iceo/news-sources.js';
import {selectContextualToday} from '../.build/src/iceo/contextual-today.js';
import {selectExploreCards} from '../.build/src/explore/selection.js';
import {discoverNews} from '../.build/src/iceo/news-discovery.js';

const now=Date.parse('2026-11-21T22:00:00.000Z'),checkedAt=new Date(now).toISOString();
const publication=(id,path,patch={})=>Object.freeze({
  id:id.toString(16).padStart(24,'0'),identity:'language-edition:'+id,title:'Controlled science publication '+id,
  topic:'science',kind:'publication',sourceUrl:'https://www.dw.com/'+path+'/fixture-'+id+'/a-12345678',
  publisher:'DW',sourceIds:Object.freeze(['news-science']),date:'2026-11-21T21:30:00.000Z',dateLabel:'Published',
  observedAt:checkedAt,contentHash:id.toString(16).padStart(64,'0'),boundary:'Controlled fixture, not live reporting.',
  deadline:null,version:null,attribution:'DW',sourceState:'verified',...patch,
});
const context=Object.freeze({countryCode:null,preferredTopics:Object.freeze([])});
const exploreContext=Object.freeze({city:null,countryCode:null,category:null});
const members=views=>views.flatMap(view=>[view.card,...view.related]);
const dailyRecords=selection=>members([...selection.first,...selection.more]);

test('regional edition tags match their base language and Chinese scripts stay distinct',()=>{
  for(const [source,target] of [
    ['pt-BR','pt'],['pt-002','pt'],['pt-002','pt-BR'],['pt-BR','pt-PT'],
    ['fa-AF','fa'],['fa-IR','fa'],['en-GB','en'],['fr-CA','fr'],
    ['zh-Hans','zh-CN'],['zh-Hans','zh-SG'],['zh-Hant','zh-TW'],['zh-Hant','zh-HK'],
    ['zh-Hant','zh-Hant-CN'],['zh-Hans','zh-Hans-TW'],
  ])assert.equal(newsLanguageMatches(source,target),true,source+' / '+target);
  for(const [source,target] of [
    [null,'en'],['pt-BR','en'],['ro','en'],['zh-Hans','zh-Hant'],['zh-Hant','zh-CN'],
    ['zh-Hans','zh-TW'],['zh-Hant','zh-Hans-TW'],['en_US','en'],['en','<script>'],
    ['en','en-u'],['en',''],['x'.repeat(81),'en'],
  ])assert.equal(newsLanguageMatches(source,target),false,String(source)+' / '+target);
});

test('language selection excludes unknown provenance instead of treating it as English and retains non-news records',()=>{
  const ro=publication(1,'ro'),en=publication(2,'en');
  const unknown=publication(3,'en',{sourceUrl:'https://www.reuters.com/world/controlled-language-fixture/',publisher:'Reuters'});
  const nonNews=publication(4,'ro',{kind:'legal-document',topic:'regulation',dateLabel:'Document date'});
  const input=Object.freeze([ro,en,unknown,nonNews]),before=JSON.stringify(input);
  assert.equal(sourceLanguage(unknown),null);
  assert.deepEqual(selectNewsLanguage(input,'en'),[en,nonNews]);
  assert.deepEqual(selectNewsLanguage(input,'ro'),[ro,nonNews]);
  const english=selectNewsLanguage(input,'en');assert.strictEqual(english[0],en);assert.strictEqual(english[1],nonNews);
  assert.equal(Object.isFrozen(english),true);assert.equal(JSON.stringify(input),before);
});

test('Portuguese and Chinese reading projections retain the exact source record and evidence hashes',()=>{
  const brazil=publication(10,'pt-br',{title:'Cientistas descobrem novas galáxias'});
  const africa=publication(11,'pt-002',{title:'Universidades publicam resultados de uma nova pesquisa'});
  const simplified=publication(12,'zh',{title:'科学家公布新的研究结果'});
  const traditional=publication(13,'zh-hant',{title:'科學家公布新的研究結果'});
  const input=Object.freeze([brazil,africa,simplified,traditional]),before=JSON.stringify(input);
  const projections=[['pt',[brazil,africa]],['zh-Hans',[simplified]],['zh-Hant',[traditional]]];
  for(const [language,expected] of projections){
    const selected=selectNewsLanguage(input,language);assert.deepEqual(selected,expected);
    for(const [index,record] of selected.entries()){
      assert.strictEqual(record,expected[index]);
      assert.equal(record.contentHash,expected[index].contentHash);assert.equal(record.observedAt,checkedAt);
      assert.equal(record.title,expected[index].title);assert.equal(record.sourceUrl,expected[index].sourceUrl);
    }
  }
  assert.equal(JSON.stringify(input),before);
});

test('coverage counts distinct eligible publications and actual publishers, including unknown language separately',()=>{
  const ro=publication(20,'ro'),secondRo=publication(21,'ro');
  const bbc=publication(22,'en',{sourceUrl:'https://www.bbc.com/news/articles/controlled-language-bbc',publisher:'BBC'});
  const guardian=publication(23,'en',{sourceUrl:'https://www.theguardian.com/science/2026/nov/21/controlled-language-guardian',publisher:'The Guardian'});
  const unknown=publication(24,'en',{sourceUrl:'https://www.reuters.com/world/controlled-language-unknown/',publisher:'Reuters'});
  const old=publication(25,'fr',{sourceState:'stale'}),nonNews=publication(26,'de',{kind:'legal-document',dateLabel:'Document date'});
  const input=Object.freeze([ro,secondRo,bbc,guardian,unknown,ro,Object.freeze({...bbc}),old,nonNews]);
  const eligible=dailyRecords(selectContextualToday(input,context,now));
  assert.equal(eligible.length,5);
  const coverage=newsLanguageCoverage([...eligible,ro,bbc,nonNews]);
  assert.deepEqual(coverage,{publications:5,publishers:4,unknownLanguage:1,languages:[{language:'en',count:2},{language:'ro',count:2}]});
  assert.equal(Object.isFrozen(coverage),true);assert.equal(Object.isFrozen(coverage.languages),true);
  assert.ok(coverage.languages.every(Object.isFrozen));
});

test('Top and Explore use the chosen native language while preserving exact source records and unique IDs',()=>{
  const ro=publication(30,'ro',{title:'Cercetatorii publica rezultatele noului studiu'});
  const en=publication(31,'en',{title:'Researchers publish results from a new study'});
  const fr=publication(32,'fr',{title:'Les chercheurs publient les résultats d’une nouvelle étude'});
  const unknown=publication(33,'en',{sourceUrl:'https://www.reuters.com/science/controlled-language/',publisher:'Reuters'});
  const input=Object.freeze([ro,en,fr,unknown,en]),before=JSON.stringify(input);
  for(const [language,original] of [['ro',ro],['en',en],['fr',fr]]){
    const selected=selectNewsLanguage(input,language),today=selectContextualToday(selected,context,now);
    assert.deepEqual(today.first.map(view=>view.card.id),[original.id]);assert.equal(today.more.length,0);
    assert.strictEqual(today.first[0].card,original);
    const explored=selectExploreCards(selected,exploreContext,now);
    assert.equal(explored.eligibleCount,1);assert.equal(explored.matchedCount,1);
    assert.strictEqual(explored.cards[0].card,original);assert.equal(explored.cards[0].card.contentHash,original.contentHash);
    assert.equal(new Set(explored.cards.map(view=>view.card.id)).size,explored.cards.length);
  }
  assert.equal(JSON.stringify(input),before);
});

test('conflicting evidence cannot become eligible when its other language is filtered out',()=>{
  const english=publication(40,'en');
  for(const conflict of [
    publication(41,'fr',{identity:english.identity}),
    publication(42,'fr',{id:english.id}),
  ]){
    const input=Object.freeze([english,conflict]),before=JSON.stringify(input);
    assert.deepEqual(dailyRecords(selectContextualToday(input,context,now)),[]);
    for(const language of ['en','fr']){
      const selected=selectNewsLanguage(input,language);
      assert.deepEqual(selected,[],'conflicts are isolated across the complete evidence corpus');
      assert.deepEqual(dailyRecords(selectContextualToday(selected,context,now)),[]);
      assert.equal(selectExploreCards(selected,exploreContext,now).matchedCount,0);
    }
    assert.equal(JSON.stringify(input),before);
  }
});

test('changing language never renews source checks or admits stale and future publications',()=>{
  const ro=publication(50,'ro');
  const expired=publication(51,'ro',{observedAt:new Date(now-3_600_000).toISOString()});
  const stale=publication(52,'ro',{sourceState:'stale'});
  const future=publication(53,'ro',{date:new Date(now+1000).toISOString()});
  const old=publication(54,'ro',{date:new Date(now-86_400_000).toISOString()});
  const input=Object.freeze([ro,expired,stale,future,old]),before=JSON.stringify(input);
  const selected=selectNewsLanguage(input,'ro');
  assert.deepEqual(dailyRecords(selectContextualToday(selected,context,now)),[ro]);
  assert.deepEqual(members(selectExploreCards(selected,exploreContext,now).cards),[ro]);
  assert.equal(selectNewsLanguage(input,'en').length,0);
  assert.strictEqual(selectNewsLanguage(input,'ro')[0],ro);
  assert.equal(selectContextualToday(selectNewsLanguage(input,'ro'),context,now+3_600_000).first.length,0);
  assert.equal(selectExploreCards(selectNewsLanguage(input,'ro'),exploreContext,now+3_600_000).matchedCount,0);
  assert.equal(JSON.stringify(input),before);assert.equal(ro.observedAt,checkedAt);
});

test('real discovery metadata and computed hashes survive repeated locale projections unchanged',async()=>{
  const rows=[
    {sourceUrl:'https://www.dw.com/pt-br/fixture/a-12345678',title:'Cientistas descobrem novas galáxias',publisher:'DW',indexedAt:checkedAt,category:'science'},
    {sourceUrl:'https://www.dw.com/de/fixture/a-12345679',title:'Forscher entdecken neue Galaxien',publisher:'DW',indexedAt:checkedAt,category:'science'},
  ];
  const byUrl=new Map(rows.map(row=>[row.sourceUrl,row])),requests=[];
  const fetcher=async input=>{
    const url=String(input);requests.push(url);
    if(url===NEWS_INDEX_URL)return new Response('<rss><channel></channel></rss>',{headers:{'content-type':'application/rss+xml'}});
    const row=byUrl.get(url);assert.ok(row,'all original-page requests stay within the controlled fixture');
    const metadata={'@type':'NewsArticle',headline:row.title,url:row.sourceUrl,datePublished:'2026-11-21T21:30:00.000Z'};
    return new Response('<html><head><link rel="canonical" href="'+row.sourceUrl+'"><script type="application/ld+json">'+JSON.stringify(metadata)+'</script></head></html>',{headers:{'content-type':'text/html'}});
  };
  const results=await discoverNews(fetcher,now,rows,undefined,{publisherIndexes:false,frontpageHighlights:false,maxArticleRequests:2});
  const records=Object.freeze(results.flatMap(result=>result.cards));
  assert.equal(records.length,2);assert.equal(requests.length,3);
  const before=JSON.stringify(records);
  for(const [language,title] of [['pt',rows[0].title],['de',rows[1].title]]){
    const selected=selectNewsLanguage(records,language);assert.equal(selected.length,1);
    assert.strictEqual(selected[0],records.find(record=>record.title===title));
    assert.equal(selected[0].title,title);assert.match(selected[0].contentHash,/^[a-f0-9]{64}$/u);
    assert.equal(selected[0].observedAt,checkedAt);assert.equal(selected[0].sourceState,'verified');
  }
  assert.equal(selectNewsLanguage(records,'en').length,0);assert.equal(JSON.stringify(records),before);
});

test('a manual language change immediately replaces the live edition instead of staging it as a news update',()=>{
  const en=publication(60,'en',{title:'Researchers publish English findings'});
  const ro=publication(61,'ro',{title:'Cercetatorii publica rezultatele in romana'});
  const input=Object.freeze([en,ro]),live=new LiveEdition();
  const edition=language=>selectContextualToday(selectNewsLanguage(input,language),context,now);
  const key=language=>JSON.stringify([language,null,null,[]]);
  const english=live.present(edition('en'),key('en'),now);
  assert.deepEqual(dailyRecords(english.selection),[en]);
  const romanian=live.present(edition('ro'),key('ro'),now+1);
  assert.deepEqual(dailyRecords(romanian.selection),[ro]);
  assert.equal(romanian.changes.total,0);assert.strictEqual(romanian.selection.first[0].card,ro);
  const again=live.present(edition('en'),key('en'),now+2);
  assert.deepEqual(dailyRecords(again.selection),[en]);assert.equal(again.changes.total,0);
  assert.equal(en.observedAt,checkedAt);assert.equal(ro.observedAt,checkedAt);
});
