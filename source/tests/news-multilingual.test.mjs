import assert from 'node:assert/strict';
import test from 'node:test';
import {NEWS_PUBLISHERS,NEWS_PUBLICATION_SCOPES,NEWS_DISCOVERY_INDEXES,sourceLanguage,sourcePublicationContext} from '../.build/src/iceo/news-sources.js';
import {PUBLIC_EDITORIAL_CATEGORIES,classifyNewsHeadline,headlineDiscoveryPriority} from '../.build/src/iceo/editorial-categories.js';
import {readPublisherNewsCandidates,readNewsArticleMetadata,matchingNewsHeadline,mergeNewsCandidates,validateNewsCandidate,discoverNews} from '../.build/src/iceo/news-discovery.js';

const now=Date.parse('2026-11-21T21:00:00Z'),date='2026-11-21T20:00:00.000Z';
const frUrl='https://www.france24.com/fr/france/20261121-fixture';
const jaUrl='https://www.bbc.com/japanese/articles/fixture';
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const index=id=>{const value=NEWS_DISCOVERY_INDEXES.find(row=>row.id===id);assert.ok(value);return value;};
const feed=(source,rows,{language=source.language,home=source.feedHome,title=source.feedTitle}={})=>`<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>${escape(title)}</title><link>${escape(home)}</link><atom:link href="${source.url}" rel="self"/><language>${language}</language><dc:language>${language}</dc:language>${rows.map(row=>`<item><title>${escape(row.title)}</title><link>${escape(row.sourceUrl)}</link><pubDate>${row.date??'Sat, 21 Nov 2026 20:00:00 GMT'}</pubDate><description>FULL ARTICLE MUST NOT BE COPIED</description><enclosure url="https://images.invalid/asset"/></item>`).join('')}</channel></rss>`;
const metadata=(row,overrides={})=>`<html><head><link rel="canonical" href="${row.sourceUrl}"><script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',url:row.sourceUrl,headline:row.title,datePublished:date,...overrides})}</script></head><body>Excluded article body</body></html>`;

test('publication provenance separates source language, publisher country and story locality',()=>{
  assert.equal(NEWS_PUBLISHERS.length,70);
  assert.equal(sourceLanguage(frUrl),'fr');assert.equal(sourceLanguage({sourceUrl:jaUrl}),'ja');
  assert.equal(sourceLanguage('https://www.france24.com/en/africa/fixture'),'en');
  assert.equal(sourceLanguage('https://www.france24.com/ar/fixture'),'ar');
  assert.equal(sourceLanguage('https://www.france24.com/fixture'),null);
  assert.equal(sourceLanguage('https://www.bbc.com/arabic/articles/fixture'),null);
  assert.equal(sourceLanguage('https://www.bbc.com/japanese-extra/fixture'),null);
  assert.equal(sourceLanguage('https://www.nytimes.com/es/2026/11/21/fixture'),null);
  assert.equal(sourceLanguage('https://www.nytimes.com/2026/11/21/nyregion/fixture.html'),'en');
  assert.equal(sourceLanguage('https://www.sanews.gov.za/south-africa/fixture'),'en');
  for(const url of ['https://www.france24.com.attacker.invalid/fr/fixture','http://www.france24.com/fr/fixture','https://user@www.france24.com/fr/fixture','https://www.france24.com:444/fr/fixture'])assert.equal(sourcePublicationContext(url),null);
  const provenance=sourcePublicationContext('https://www.theguardian.com/world/africa/fixture');
  assert.equal(provenance.publisherCountryCode,'GB');assert.equal(provenance.basis,'reviewed-publisher');
  assert.equal(provenance.countries,undefined);assert.equal(provenance.city,undefined);
  assert.ok(Object.isFrozen(provenance));assert.ok(Object.isFrozen(NEWS_PUBLICATION_SCOPES));
  assert.ok(NEWS_PUBLICATION_SCOPES.every(scope=>Object.isFrozen(scope)&&Object.isFrozen(scope.editions)&&scope.editions.every(Object.isFrozen)));
});

const french={
  world:'Un accord de cessez-le-feu est signé après des négociations de paix',
  business:"Les banques annoncent leurs résultats trimestriels et leur chiffre d'affaires",
  technology:"Une entreprise dévoile un nouveau logiciel d'intelligence artificielle",
  money:'Le coût de la vie pèse sur le budget des ménages',
  health:'Un nouveau vaccin est approuvé après un essai clinique',
  sport:'Le club de football remporte la finale du tournoi',
  gaming:'Un nouveau jeu vidéo arrive sur PlayStation',
  culture:'Un festival de cinéma ouvre ses portes à Paris',
  shopping:'Black Friday : les promotions commerciales commencent',
  travel:'Une nouvelle liaison relie les deux aéroports',
  work:'Les salariés protestent contre les licenciements',
  education:"Les universités annoncent de nouvelles bourses d'études",
  family:'Une réforme élargit le congé parental et les places en crèche',
  science:'Les chercheurs découvrent une nouvelle exoplanète',
  environment:'Les émissions de carbone reculent grâce aux énergies renouvelables',
  'public-affairs':'Présidentielle : le candidat retire sa candidature',
  'digital-life':'Une cyberattaque provoque une fuite de données',
  food:'Un rappel alimentaire concerne plusieurs produits',
  housing:'Les loyers augmentent alors que les logements manquent',
  weather:'Des inondations frappent plusieurs villes après une tempête',
};
const japanese={
  world:'首脳会談で停戦合意を発表',business:'銀行が新しい金利を発表',
  technology:'新しい人工知能ソフトウェアを発表',money:'家計の生活費が増える',
  health:'新しいワクチンの臨床試験が始まる',sport:'サッカー日本代表が優勝',
  gaming:'任天堂が新しいゲーム機を発表',culture:'東京で新しい映画を公開',
  shopping:'ブラックフライデーのセール開催を発表',travel:'新しい航空路線を開設',
  work:'従業員の雇用を守る新制度',education:'大学が新しい奨学金制度を発表',
  family:'育児休業の制度が変わる',science:'宇宙のブラックホールを研究者が発見',
  environment:'再生可能エネルギーで温室効果ガスを減らす',
  'public-affairs':'新しい法案が国会で可決','digital-life':'サイバー攻撃で個人情報が流出',
  food:'食品の安全に関する制度が変わる',housing:'東京で住宅の家賃が上がる',
  weather:'台風による豪雨に警戒',
};
test('reviewed French and Japanese subjects cover the existing20 categories without translating titles',()=>{
  assert.deepEqual(Object.keys(french).sort(),[...PUBLIC_EDITORIAL_CATEGORIES].sort());
  for(const [category,title]of Object.entries(french))assert.equal(classifyNewsHeadline(title,frUrl),category,title);
  for(const [category,title]of Object.entries(japanese))assert.equal(classifyNewsHeadline(title,jaUrl),category,title);
  assert.equal(classifyNewsHeadline('Researchers discover a new exoplanet','https://www.reuters.com/science/fixture'),'science');
});
test('localized classification keeps unknowns and disambiguates school mergers, astronomy and figurative games',()=>{
  for(const [title,expected]of [
    ['Un autre regard sur cette journée',null],['Le jeu des alliances change à Paris',null],
    ['La fusion des écoles publiques est annoncée','education'],
    ['La fusion de galaxies révèle un trou noir','science'],
    ['La fusion de deux banques est annoncée','business'],
    ['Un roman raconte une guerre oubliée','culture'],
    ['Des énergies fossiles au cœur des discussions de la COP31','environment'],
    ['La Biennale des arts contemporains ouvre ses portes','culture'],
    ['Manifestation à Paris : le cortège arrive sans débordement','public-affairs'],
    ['Un verdict au procès ouvre une nouvelle jurisprudence','public-affairs'],
  ])assert.equal(classifyNewsHeadline(title,frUrl),expected,title);
  assert.equal(classifyNewsHeadline('東京のゲーム理論を解説',jaUrl),null);
  assert.equal(classifyNewsHeadline('新しい出来事を伝える',jaUrl),null);
  assert.equal(classifyNewsHeadline('企業が大学発の会社を買収',jaUrl),'business');
  assert.equal(classifyNewsHeadline('核融合の研究が進む',jaUrl),'science');
});
test('French and Japanese developments retain equivalent discovery priority',()=>{
  assert.equal(headlineDiscoveryPriority('Un sommet diplomatique ouvre des négociations de paix','world'),2);
  assert.equal(headlineDiscoveryPriority('首脳会談で停戦合意を発表','world'),2);
  assert.equal(headlineDiscoveryPriority("Une entreprise dévoile un nouveau logiciel d'intelligence artificielle",'technology'),1);
  assert.equal(headlineDiscoveryPriority('新製品を発表する企業','technology'),1);
  assert.equal(headlineDiscoveryPriority('新しいサービスを開始','technology'),1);
  assert.equal(headlineDiscoveryPriority('当局が調査を開始','technology'),2);
});

test('acquisition priority preserves voiced Japanese guide and quiz characters',()=>{
  const row=(suffix,title)=>({sourceUrl:`https://www.bbc.com/japanese/articles/${suffix}`,title,publisher:'BBC',indexedAt:new Date(now).toISOString(),category:null});
  const news=row('z-news','出来事');
  for(const title of ['購入ガイド','クイズ','ライブ更新'])assert.equal(mergeNewsCandidates([row('a-guide',title),news],now)[0].sourceUrl,news.sourceUrl);
});

test('registered French RSS preserves its original title and five-field candidate contract',()=>{
  const source=index('france24-fr-news'),title=french['public-affairs'];
  const found=readPublisherNewsCandidates(feed(source,[{sourceUrl:frUrl,title}]),source,now);
  assert.equal(found.length,1);assert.equal(found[0].title,title);assert.equal(found[0].category,'public-affairs');
  assert.deepEqual(Object.keys(found[0]).sort(),['category','indexedAt','publisher','sourceUrl','title']);
  assert.equal(found[0].publisher,'France 24');assert.deepEqual(validateNewsCandidate(found[0],now),found[0]);
  const verified=readNewsArticleMetadata(metadata(found[0],{datePublished:'2026-11-21T21:00:00+01:00'}),found[0],frUrl,now);
  assert.equal(verified.title,title);assert.equal(verified.date,date);
  assert.equal(readNewsArticleMetadata(metadata(found[0],{datePublished:undefined,dateModified:date}),found[0],frUrl,now),null);
});
test('RSS identity, edition language, original publisher, current dates and registration fail closed',()=>{
  const source=index('france24-fr-news'),row={sourceUrl:frUrl,title:french.technology};
  for(const change of [{language:'en'},{home:'https://attacker.invalid/'},{title:'An unrelated feed'}])assert.throws(()=>readPublisherNewsCandidates(feed(source,[row],change),source,now),/IDENTITY_INVALID/);
  for(const change of [{sourceUrl:'https://www.france24.com/en/fixture'},{sourceUrl:'https://www.reuters.com/world/fixture'},{date:'Sat, 21 Nov 2026 20:00:00'},{date:'Fri, 20 Nov 2026 19:00:00 GMT'},{date:'Sat, 21 Nov 2026 22:00:00 GMT'},{date:'Sat, 31 Nov 2026 20:00:00 GMT'}])assert.equal(readPublisherNewsCandidates(feed(source,[{...row,...change}]),source,now).length,0);
  for(const change of [{language:'en'},{format:undefined},{articlePath:'/'},{feedHome:'https://attacker.invalid/'}])assert.throws(()=>readPublisherNewsCandidates(feed(source,[row]),{...source,...change},now),/NOT_REGISTERED/);
  assert.throws(()=>readPublisherNewsCandidates('<!DOCTYPE rss>'+feed(source,[row]),source,now),/XML_INVALID/);
  assert.equal(NEWS_DISCOVERY_INDEXES.some(row=>row.id.includes('bbc-ja')||row.id.includes('nyregion')),false);
});
test('regional English feeds accept explicit RFC822 offsets while excluding descriptions and images',()=>{
  for(const [id,url,language]of [
    ['japan-times-news','https://www.japantimes.co.jp/news/2026/11/21/japan/tokyo-fixture/','en-US'],
    ['guardian-africa-news','https://www.theguardian.com/world/2026/nov/21/johannesburg-fixture','en-gb'],
  ]){
    const source=index(id),found=readPublisherNewsCandidates(feed(source,[{sourceUrl:url,title:'New housing rules announced',date:'Sun, 22 Nov 2026 05:00:00 +0900'}],{language}),source,now);
    assert.equal(found.length,1);assert.equal(found[0].category,'housing');
    assert.equal(found[0].summary,undefined);assert.equal(found[0].image,undefined);
  }
});
test('headline identity retains French negations and numbers and requires exact normalized Japanese text',()=>{
  const title='Le gouvernement approuve une nouvelle loi sur les retraites';
  assert.equal(matchingNewsHeadline(title,title+' - France 24','France 24'),true);
  assert.equal(matchingNewsHeadline(title,title+' - France 24','BBC'),false);
  assert.equal(matchingNewsHeadline(title,"Le gouvernement n'approuve pas une nouvelle loi sur les retraites"),false);
  assert.equal(matchingNewsHeadline('La mesure concerne 20 écoles à Paris','La mesure concerne 200 écoles à Paris'),false);
  assert.equal(matchingNewsHeadline('東京で新しい映画を公開','東京で新しい映画を公開'),true);
  assert.equal(matchingNewsHeadline('政府は、法案を承認した。新制度を導入する','政府は、法案を承認しない。新制度を導入する'),false);
});
test('candidate order rotates reviewed publication countries inside equal evidence tiers without inventing locality',()=>{
  const specs=[
    ['Associated Press','https://apnews.com/article/us-a'],['Associated Press','https://apnews.com/article/us-b'],
    ['The New York Times','https://www.nytimes.com/2026/11/21/us/a.html'],['The New York Times','https://www.nytimes.com/2026/11/21/us/b.html'],
    ['The Guardian','https://www.theguardian.com/technology/fixture'],['The Japan Times','https://www.japantimes.co.jp/news/fixture'],
  ];
  const rows=specs.map(([publisher,sourceUrl])=>({publisher,sourceUrl,title:'New artificial intelligence software launches',indexedAt:new Date(now).toISOString(),category:'technology'}));
  const ordered=mergeNewsCandidates(rows,now);
  assert.deepEqual(new Set(ordered.slice(0,3).map(row=>sourcePublicationContext(row.sourceUrl).publisherCountryCode)),new Set(['US','GB','JP']));
  assert.ok(ordered.every(row=>!Object.hasOwn(row,'context')&&!Object.hasOwn(row,'language')));
  const strong={...rows[3],sourceUrl:'https://www.nytimes.com/2026/11/21/us/inquiry.html',title:'Regulator investigates artificial intelligence software company'};
  assert.equal(mergeNewsCandidates([...rows,strong],now)[0].sourceUrl,strong.sourceUrl);
});
test('new feeds reuse the global article budget and produce only originally verified card fields',async()=>{
  const source=index('france24-fr-news'),row={sourceUrl:frUrl,title:french.technology},requests=[];
  const fetcher=async url=>{
    const value=String(url);requests.push(value);
    if(value===source.url)return new Response(feed(source,[row]),{headers:{'content-type':'application/rss+xml'}});
    if(value===frUrl)return new Response(metadata(row),{headers:{'content-type':'text/html'}});
    return new Response('Unavailable',{status:503});
  };
  const results=await discoverNews(fetcher,now,[],undefined,{frontpageHighlights:false,maxArticleRequests:1});
  const cards=results.flatMap(result=>result.cards);
  assert.equal(requests.filter(url=>url===frUrl).length,1);assert.equal(cards.length,1);
  assert.equal(cards[0].title,row.title);assert.equal(cards[0].summary,undefined);assert.equal(cards[0].language,undefined);
  assert.equal(cards[0].date,date);assert.ok(cards[0].sourceIds.includes('news-technology'));
});
