import test from 'node:test';
import assert from 'node:assert/strict';
import {EMPTY_EXPLORE_STATE,parseExploreState,exploreUrl,selectExploreCity,selectExploreCountry,selectExploreCategory} from '../.build/src/explore/state.js';
import {selectExploreCards} from '../.build/src/explore/selection.js';
import {contextFromPublisherCategories} from '../.build/src/iceo/context.js';
import {findCity,cityAliases} from '../.build/src/local/cities.js';

// Controlled records prove matching and isolation, not real provider coverage.
const now=Date.parse('2026-11-21T12:00:00Z');
const city=(id,name,countryCode,country,region,timezone)=>Object.freeze({id,name,countryCode,country,region,lat:1,lon:1,timezone});
const tokyo=city('1850147','Tokyo','JP','Japan','Tokyo','Asia/Tokyo');
const paris=city('2988507','Paris','FR','France','Île-de-France','Europe/Paris');
const johannesburg=city('993800','Johannesburg','ZA','South Africa','Gauteng','Africa/Johannesburg');
const newYork=city('5128581','New York City','US','United States','New York','America/New_York');
const nairobi=city('184745','Nairobi','KE','Kenya','Nairobi','Africa/Nairobi');
const card=(id,title,extra={})=>({
  id:id.toString(16).padStart(24,'0'),identity:'explore-fixture:'+id,title,topic:'world',kind:'publication',
  sourceUrl:'https://globalvoices.org/2026/11/21/explore-'+id+'/',publisher:'Controlled publisher',
  sourceIds:['gv-world'],date:'2026-11-21T10:00:00.000Z',dateLabel:'Published',observedAt:new Date(now).toISOString(),
  contentHash:id.toString(16).padStart(64,'0'),boundary:'Controlled publication fixture.',deadline:null,version:null,
  attribution:'Controlled publisher',sourceState:'verified',...extra,
});
const context=(selectedCity=null,category=null,extra={})=>({city:selectedCity,category,...extra});
const ids=views=>views.map(view=>view.card.id);
const geo=name=>contextFromPublisherCategories('gv-world',[name]);

test('five catalog cities preserve category and remembered state while URL reopens each selection',()=>{
  const home=Object.freeze({cityId:'683506',topics:Object.freeze(['science'])});
  let state=selectExploreCategory(EMPTY_EXPLORE_STATE,'culture');
  for(const destination of [tokyo,paris,johannesburg,newYork,nairobi]){
    const previous=state;state=selectExploreCity(state,destination);
    assert.equal(state.category,'culture');assert.equal(state.countryCode,destination.countryCode);
    assert.notEqual(previous,state);assert.equal(Object.isFrozen(state),true);
    const url=exploreUrl('https://www.dlkt.ee/?ref=shared&ref=second#card-123',state);
    assert.deepEqual(parseExploreState(url),state);
    assert.deepEqual(new URL(url).searchParams.getAll('ref'),['shared','second']);
    assert.equal(new URL(url).hash,'#card-123');
  }
  assert.deepEqual(home,{cityId:'683506',topics:['science']});
  assert.deepEqual(EMPTY_EXPLORE_STATE,{active:false,cityId:null,countryCode:null,category:null});
});

test('country and worldwide transitions clear city but retain category; exit retains unrelated URL state',()=>{
  const start=selectExploreCity(selectExploreCategory(EMPTY_EXPLORE_STATE,'science'),tokyo);
  const country=selectExploreCountry(start,'fr');
  assert.deepEqual(country,{active:true,cityId:null,countryCode:'FR',category:'science'});
  assert.deepEqual(selectExploreCountry(country,null),{active:true,cityId:null,countryCode:null,category:'science'});
  assert.equal(selectExploreCity(start,null).countryCode,'JP');
  const base=new URL('https://www.dlkt.ee/path?ref=one&ref=two#existing');
  const original=base.href,active=exploreUrl(base,start);
  assert.equal(base.href,original,'URL argument is not mutated');
  assert.equal(exploreUrl(active,EMPTY_EXPLORE_STATE),original);
  assert.equal(exploreUrl('/path?ref=one#existing',start).startsWith('/path?ref=one&explore=1'),true);
});

test('URL input is bounded to canonical IDs/categories and repeated values do not select an arbitrary first value',()=>{
  const invalid=parseExploreState('https://www.dlkt.ee/?explore=1&city=1850147&city=2988507&country=jp&category=javascript:alert(1)');
  assert.deepEqual(invalid,{active:true,cityId:null,countryCode:'JP',category:null});
  for(const cityId of ['0','-1','1e4','1234567890123','https://example.org','<script>']){
    assert.equal(parseExploreState('https://www.dlkt.ee/?explore=1&city='+encodeURIComponent(cityId)).cityId,null);
  }
  assert.equal(parseExploreState('https://www.dlkt.ee/?city=1850147').active,false);
  assert.equal(parseExploreState('https://www.dlkt.ee/?explore=1&explore=0').active,false);
  assert.equal(parseExploreState('https://www.dlkt.ee/?explore=1&country=%C3%9F').countryCode,null);
  assert.throws(()=>selectExploreCountry(EMPTY_EXPLORE_STATE,'JAPAN'),/EXPLORE_STATE_INVALID/);
  assert.throws(()=>selectExploreCategory(EMPTY_EXPLORE_STATE,'unknown'),/EXPLORE_STATE_INVALID/);
  assert.throws(()=>exploreUrl('https://www.dlkt.ee/',{...EMPTY_EXPLORE_STATE,cityId:'bad'}),/EXPLORE_STATE_INVALID/);
});

test('exploration evaluates the full eligible publication corpus without a thirty-card cap',()=>{
  const records=Array.from({length:70},(_,index)=>card(index+1,'Tokyo museum publication '+(index+1)));
  const selection=selectExploreCards(records,context(tokyo),now);
  assert.equal(selection.eligibleCount,70);assert.equal(selection.local.length,70);assert.equal(selection.matchedCount,70);
  assert.equal(selection.national.length,0);assert.equal(selection.world.length,0);
  assert.deepEqual(ids(selection.cards),ids(selectExploreCards([...records].reverse(),context(tokyo),now).cards));
  assert.equal(new Set(ids(selection.cards)).size,70);
});

test('each requested geography and an arbitrary fifth catalog city can match independently',()=>{
  const records=[card(1,'Tokyo museums open today'),card(2,'Paris council opens a library'),
    card(3,'Johannesburg residents celebrate a new park'),card(4,'New York subway timetable changes'),
    card(5,'Nairobi launches new public transport')];
  for(const [index,destination] of [tokyo,paris,johannesburg,newYork,nairobi].entries()){
    const selection=selectExploreCards(records,context(destination),now);
    assert.deepEqual(ids(selection.local),[records[index].id]);
    assert.equal(selection.world.length,0);
  }
});

test('headline, publisher excerpt and publisher country category have explicit distinct bases',()=>{
  const title=card(1,'Paris opens a new museum');
  const summary=card(2,'New collection welcomes visitors',{summary:'The exhibition opens in Paris this weekend.'});
  const national=card(3,'France adopts a national education programme');
  const categorized=card(4,'Civil society publishes its review',{context:geo('France')});
  const foreign=card(5,'Japan announces a national programme');
  const selection=selectExploreCards([foreign,categorized,national,summary,title],context(paris),now);
  assert.deepEqual(new Set(ids(selection.local)),new Set([title.id,summary.id]));
  assert.deepEqual(new Set(ids(selection.national)),new Set([national.id,categorized.id]));
  assert.equal(selection.local.find(view=>view.card.id===title.id).explore.basis,'title');
  assert.equal(selection.local.find(view=>view.card.id===summary.id).explore.basis,'summary');
  assert.equal(selection.national.find(view=>view.card.id===categorized.id).explore.basis,'publisher-category');
  assert.equal(selection.world.length,0);
  assert.ok(selection.cards.every(view=>!view.explore.label.includes('verified local event')));
});

test('publisher country, scope, URL, label and attribution never substitute for article geography',()=>{
  const records=[
    card(1,'A global economic review',{sourceIds:['fed-news'],publisher:'New York headquarters',attribution:'New York, United States',sourceUrl:'https://example.org/new-york/'}),
    card(2,'A neutral international report',{sourceIds:['sanews'],publisher:'South Africa News'}),
    card(3,'A neutral scientific report',{context:{countries:[{code:'JP',name:'Japan'}],basis:'publisher-scope',label:'Tokyo, Japan',boundary:'A forged scope'}}),
  ];
  assert.equal(selectExploreCards(records,context(newYork),now).matchedCount,0);
  assert.equal(selectExploreCards(records,context(johannesburg),now).matchedCount,0);
  assert.equal(selectExploreCards(records,context(tokyo),now).matchedCount,0);
  assert.equal(selectExploreCards(records,context(null,null,{countryCode:'US'}),now).matchedCount,0);
});

test('Paris people, foreign homonyms and New York publishers do not become city matches',()=>{
  const records=[
    card(1,'Paris Hilton launches a new album'),
    card(2,'A museum opens in Paris, Texas'),
    card(3,'New York Times publishes an investigation'),
    card(4,'New York Post expands its newsroom'),
    card(5,'New York state adopts a budget'),
    card(6,'Paris agreement reviewed by delegates'),
    card(7,'Paris Hilton visits a museum in Paris'),
    card(8,'New York Times reports on a new subway line in New York'),
    card(9,'巴黎希尔顿发表新专辑'),
    card(10,'纽约时报发表新调查'),
  ];
  assert.deepEqual(ids(selectExploreCards(records,context(paris),now).local),[records[6].id]);
  assert.deepEqual(ids(selectExploreCards(records,context(newYork),now).local),[records[7].id]);
});

test('multilingual city aliases and scripts work without geographic inference from publisher language',()=>{
  const records=[card(1,'東京都で新しい博物館が開館'),card(2,'巴黎博物馆今天开放'),
    card(3,'Une bibliothèque ouvre à Paris'),card(4,'東京新聞が調査を公表'),
    card(5,'ニューヨークで地下鉄が再開'),card(6,'パリス・ヒルトンが新曲を発表'),
    card(7,'A new museum opens in Nyeri')];
  assert.deepEqual(ids(selectExploreCards(records,context(tokyo),now).local),[records[0].id]);
  assert.deepEqual(new Set(ids(selectExploreCards(records,context(paris),now).local)),new Set([records[1].id,records[2].id]));
  assert.deepEqual(ids(selectExploreCards(records,context(newYork),now).local),[records[4].id]);
  const nyeri=city('182701','Nyeri','KE','Kenya','Nyeri','Africa/Nairobi');
  assert.deepEqual(ids(selectExploreCards(records,context(nyeri),now).local),[records[6].id]);
  const munich=city('2867714','Munich','DE','Germany','Bavaria','Europe/Berlin');
  assert.equal(selectExploreCards([card(8,'München eröffnet ein neues Museum')],context(munich,null,{cityAliases:['München']}),now).local.length,1);
});

test('common city words need actual place wording and word boundaries',()=>{
  const reading=city('2639577','Reading','GB','United Kingdom','England','Europe/London');
  const records=[card(1,'Reading books improves vocabulary in UK schools'),card(2,'A new library opens in Reading'),
    card(3,'Reading council opens a new library'),card(4,'Readings in London are free')];
  assert.deepEqual(new Set(ids(selectExploreCards(records,context(reading),now).local)),new Set([records[1].id,records[2].id]));
  assert.equal(selectExploreCards([card(5,'Comparison of new novels')],context(paris),now).matchedCount,0);
  const nice=city('2990440','Nice','FR','France','Provence-Alpes-Côte d’Azur','Europe/Paris');
  assert.equal(selectExploreCards([card(6,'Families relax in nice parks')],context(nice,null,{cityAliases:['nice']}),now).local.length,0);
  assert.equal(selectExploreCards([card(7,'A new park opens in Nice')],context(nice,null,{cityAliases:['nice']}),now).local.length,1);
});

test('generic catalog aliases retain two-character native city names outside reviewed spelling exceptions',()=>{
  const cases=[
    [city('1853909','Osaka','JP','Japan','Osaka','Asia/Tokyo'),'大阪','大阪の学校が新校舎を公開'],
    [city('1857910','Kyoto','JP','Japan','Kyoto','Asia/Tokyo'),'京都','京都で映画祭が開催'],
    [city('1816670','Beijing','CN','China','Beijing','Asia/Shanghai'),'北京','北京市将建设公园'],
  ];
  for(const [index,[destination,alias,title]] of cases.entries()){
    const record=card(index+1,title);
    assert.deepEqual(ids(selectExploreCards([record],context(destination,null,{cityAliases:[alias]}),now).local),[record.id]);
    assert.equal(selectExploreCards([record],context(destination),now).matchedCount,0,'source text needs its actual catalog alias');
  }
  const beijing=cases[2][0];
  assert.equal(selectExploreCards([card(10,'北京日报发表一篇调查')],context(beijing,null,{cityAliases:['北京']}),now).local.length,0);
});

test('native names keep Japanese voicing and Korean syllables while Latin accents still match',()=>{
  const records=[card(1,'パリで博物館が開館'),card(2,'肌のハリを保つ方法')];
  assert.deepEqual(ids(selectExploreCards(records,context(paris),now).local),[records[0].id]);
  const seoul=city('1835848','Seoul','KR','South Korea','Seoul','Asia/Seoul');
  assert.equal(selectExploreCards([card(3,'서울에서 새로운 박물관 개관')],context(seoul,null,{cityAliases:['서울']}),now).local.length,1);
  assert.equal(selectExploreCards([card(4,'서울신문 기자 인터뷰')],context(seoul,null,{cityAliases:['서울']}),now).local.length,0);
});

test('real catalog identities and bounded native aliases support exploration beyond the example destinations',()=>{
  const cases=[
    ['1850147','東京で博物館が開館'],['2988507','À Paris, un nouveau musée ouvre'],
    ['993800','Johannesburg opens a new public park'],['5128581','New York subway timetable changes'],
    ['1853909','大阪の学校が新校舎を公開'],['1857910','京都で映画祭が開催'],['1816670','北京市将建设公园'],
  ];
  for(const [index,[id,title]] of cases.entries()){
    const selectedCity=findCity(id),aliases=cityAliases(id);assert.ok(selectedCity);
    assert.ok(aliases.length<=32);
    const record=card(index+1,title);
    assert.deepEqual(ids(selectExploreCards([record],context(selectedCity,null,{cityAliases:aliases}),now).local),[record.id]);
  }
  const aliases=cityAliases(paris.id);
  assert.ok(aliases.includes('パリ'),'API aliases retain actual Japanese spelling');
  assert.ok(!aliases.includes('ハリ'),'search-normalized spelling must not turn into geographic evidence');
  assert.equal(selectExploreCards([card(30,'肌のハリを保つ方法')],context(findCity(paris.id),null,{cityAliases:aliases}),now).local.length,0);
});

test('country matching supports original languages and ignores English pronouns and ambiguous personal names',()=>{
  const records=[card(1,'France annonce une nouvelle politique'),card(2,'Les États-Unis adoptent une nouvelle loi'),
    card(3,'日本政府が新しい制度を発表'),card(4,'Please help us read the report'),card(5,'Jordan wins a competition')];
  assert.deepEqual(ids(selectExploreCards(records,context(null,null,{countryCode:'FR'}),now).national),[records[0].id]);
  assert.deepEqual(ids(selectExploreCards(records,context(null,null,{countryCode:'US'}),now).national),[records[1].id]);
  assert.deepEqual(ids(selectExploreCards(records,context(null,null,{countryCode:'JP'}),now).national),[records[2].id]);
  assert.equal(selectExploreCards(records,context(null,null,{countryCode:'JO'}),now).matchedCount,0);
});

test('turkey recipes do not establish Turkey country coverage without explicit country wording',()=>{
  const records=[card(1,'Turkey recipe with gravy and stuffing'),card(2,'How to cook a roast turkey'),
    card(3,'Turkey government reviews food imports before Thanksgiving'),
    card(4,'A traditional recipe from Turkey welcomes visitors')];
  const selected=selectExploreCards(records,context(null,null,{countryCode:'TR'}),now);
  assert.deepEqual(new Set(ids(selected.national)),new Set([records[2].id,records[3].id]));
});

test('category filtering preserves original cards; no location means worldwide eligible publications',()=>{
  const culture=card(1,'Tokyo opens a new museum',{sourceIds:['news-culture']});
  const technology=card(2,'Tokyo launches a new AI research laboratory',{sourceIds:['news-technology'],topic:'technology'});
  const foreign=card(3,'Paris opens a new museum',{sourceIds:['news-culture']});
  const records=[culture,technology,foreign],before=structuredClone(records);
  const local=selectExploreCards(records,context(tokyo,'culture'),now);
  assert.deepEqual(ids(local.cards),[culture.id]);assert.equal(local.cards[0].card,culture);
  assert.equal(local.cards[0].category,'culture');assert.deepEqual(records,before);
  const world=selectExploreCards(records,context(null,'culture'),now);
  assert.deepEqual(new Set(ids(world.world)),new Set([culture.id,foreign.id]));
  assert.equal(world.local.length,0);assert.equal(world.national.length,0);
});

test('a matching category in a grouped related listing remains accessible in Explore',()=>{
  const title='Tokyo opens an entirely new library in a modern waterfront district today';
  const culture=card(1,title,{sourceIds:['news-culture']});
  const technology=card(2,title,{sourceIds:['news-technology'],topic:'technology'});
  const selected=selectExploreCards([culture,technology],context(tokyo,'technology'),now);
  assert.equal(selected.eligibleCount,2);assert.deepEqual(ids(selected.cards),[technology.id]);
});

test('short catalog abbreviations retain their uppercase spelling',()=>{
  const records=[card(1,'En ny butik åbner snart'),card(2,'NY opens a new public garden')];
  assert.deepEqual(ids(selectExploreCards(records,context(newYork,null,{cityAliases:['NY']}),now).local),[records[1].id]);
});

test('existing publication freshness, record kind and conflicting-identity gates still apply',()=>{
  const good=card(1,'Tokyo opens a library');
  const bad=[
    card(2,'Tokyo old library report',{date:new Date(now-86_400_000).toISOString()}),
    card(3,'Tokyo future report',{date:new Date(now+1).toISOString()}),
    card(4,'Tokyo updated page',{dateLabel:'Updated'}),
    card(5,'Tokyo stale source',{sourceState:'stale'}),
    card(6,'Tokyo law',{kind:'legal-document'}),
    card(7,'Tokyo source from the future',{observedAt:new Date(now+300_001).toISOString()}),
  ];
  const conflict=card(8,'Tokyo conflicting publication');
  const selection=selectExploreCards([good,...bad,conflict,{...conflict,contentHash:'f'.repeat(64)}],context(tokyo),now);
  assert.deepEqual(ids(selection.cards),[good.id]);assert.equal(selection.eligibleCount,1);
  assert.equal(selectExploreCards([good,good],context(tokyo),now).matchedCount,1);
});

test('invalid city/country combinations and unbounded aliases are rejected',()=>{
  assert.throws(()=>selectExploreCards([],context(tokyo,null,{countryCode:'FR'}),now),/EXPLORE_CITY_COUNTRY_MISMATCH/);
  assert.throws(()=>selectExploreCards([],context(tokyo,null,{cityAliases:Array.from({length:33},()=> 'Tokyo')}),now),/EXPLORE_CONTEXT_INVALID/);
  assert.throws(()=>selectExploreCards([],context(tokyo,null,{cityAliases:['<script>']}),now),/EXPLORE_CONTEXT_INVALID/);
  assert.throws(()=>selectExploreCards([],context(),NaN),/EDITORIAL_INPUT_INVALID/);
});
