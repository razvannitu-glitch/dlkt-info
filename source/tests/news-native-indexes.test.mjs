import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {NEWS_DISCOVERY_INDEXES,NEWS_INDEX_URL,sourceLanguage,canonicalNewsUrl} from '../.build/src/iceo/news-sources.js';
import {classifyNewsHeadline,EDITORIAL_CATEGORY_TOPICS} from '../.build/src/iceo/editorial-categories.js';
import {readPublisherNewsCandidates,readNewsArticleMetadata,matchingNewsHeadline,discoverNews} from '../.build/src/iceo/news-discovery.js';
import {cardContent,validCard} from '../.build/src/iceo/card-validation.js';

const now=Date.parse('2026-11-22T12:00:00.000Z'),published='2026-11-22T10:55:55.327Z';
const roUrl='https://www.dw.com/ro/raport-al-na%C8%9Biunilor-unite-despre-popula%C8%9Bia-mondial%C4%83-genera%C8%9Bia-z-este-educat%C4%83-dar-nesigur%C4%83/a-80013154';
const shortTitle='Raport ONU: Generația Z, educată, dar nesigură';
const fullTitle='Raport ONU despre populația mondială: Generația Z este educată, dar nesigură';
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function index(id){const value=NEWS_DISCOVERY_INDEXES.find(row=>row.id===id);assert.ok(value,id);return value;}
function candidate(sourceUrl=roUrl,title=shortTitle,publisher='DW'){
  return {sourceUrl,title,publisher,indexedAt:new Date(now).toISOString(),category:classifyNewsHeadline(title,sourceUrl)};
}
const ro=candidate();
const article=(changes={})=>({'@context':'https://schema.org','@type':'NewsArticle',url:roUrl,headline:fullTitle,alternativeHeadline:shortTitle,datePublished:published,...changes});
function document(value=article(),{canonical=roUrl,extra='',body='Excluded original article body'}={}){
  return '<html><head><link rel="canonical" href="'+escape(canonical)+'"><script type="application/ld+json">'+JSON.stringify(value)+'</script>'+extra+'</head><body>'+body+'</body></html>';
}
const og=(title,date)=>'<meta property="og:title" content="'+escape(title)+'"><meta property="article:published_time" content="'+escape(date)+'">';
const response=(body,type)=>new Response(body,{headers:{'content-type':type}});
function sitemap(rows){
  return '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">'+rows.map(row=>'<url><loc>'+escape(row.sourceUrl)+'</loc><news:news><news:publication><news:name>DW</news:name><news:language>'+escape(row.language)+'</news:language></news:publication><news:publication_date>'+escape(row.date??published)+'</news:publication_date><news:title>'+escape(row.title)+'</news:title></news:news></url>').join('')+'</urlset>';
}
function rss(source,rows,{title=source.feedTitle,home=source.feedHome,language=source.language}={}){
  return '<rss xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>'+escape(title)+'</title><link>'+escape(home)+'</link><atom:link rel="self" href="'+escape(source.url)+'"/><language>'+escape(language)+'</language>'+rows.map(row=>'<item><title>'+escape(row.title)+'</title><link>'+escape(row.sourceUrl)+'</link><pubDate>'+escape(row.date??new Date(published).toUTCString())+'</pubDate><description>Excluded feed body</description></item>').join('')+'</channel></rss>';
}

test('registered DW native sitemaps admit only their reviewed publisher edition and current explicit dates',()=>{
  for(const language of ['ro','de','fr','es','ar']){
    const source=index('dw-'+language+'-news');
    assert.equal(source.url,'https://www.dw.com/'+language+'/news-sitemap.xml');
    assert.equal(source.language,language);assert.equal(source.articlePath,'/'+language+'/');
    const row={sourceUrl:'https://www.dw.com/'+language+'/fixture/a-12345678',title:'Software fixture',language};
    const accepted=readPublisherNewsCandidates(sitemap([row]),source,now);
    assert.equal(accepted.length,1);assert.equal(accepted[0].publisher,'DW');
    assert.equal(sourceLanguage(accepted[0]),language);
    assert.deepEqual(Object.keys(accepted[0]).sort(),['category','indexedAt','publisher','sourceUrl','title']);
    for(const change of [
      {language:'en'},{language:'zz'},
      {sourceUrl:'https://www.dw.com/en/fixture/a-12345678'},
      {sourceUrl:'https://www.dw.com/'+language+'-extra/fixture/a-12345678'},
      {sourceUrl:'https://www.reuters.com/'+language+'/fixture'},
      {sourceUrl:'https://www.dw.com.attacker.invalid/'+language+'/fixture'},
      {date:'2026-11-20T10:55:55.327Z'},{date:'2026-11-22T12:05:00.001Z'},
      {date:'2026-11-22T10:55:55.327'},{date:'2026-02-30T10:55:55.327Z'},
    ])assert.equal(readPublisherNewsCandidates(sitemap([{...row,...change}]),source,now).length,0,language+' '+JSON.stringify(change));
    assert.throws(()=>readPublisherNewsCandidates(sitemap([row]),{...source,articlePath:'/'},now),/NEWS_INDEX_NOT_REGISTERED/);
  }
});

test('France24 English RSS requires the exact registered channel identity and English article path',()=>{
  const source=index('france24-en-news');
  assert.equal(source.url,'https://www.france24.com/en/rss');
  assert.equal(source.feedTitle,'France 24 - International breaking news, top stories and headlines');
  const row={sourceUrl:'https://www.france24.com/en/20261122-fixture',title:'New software announced'};
  assert.equal(readPublisherNewsCandidates(rss(source,[row]),source,now).length,1);
  assert.equal(readPublisherNewsCandidates(rss(source,[row],{language:'en-US'}),source,now).length,1);
  for(const changed of [{title:'France24'},{home:'https://www.france24.com/fr/'},{language:'fr'}]){
    assert.throws(()=>readPublisherNewsCandidates(rss(source,[row],changed),source,now),/NEWS_INDEX_IDENTITY_INVALID/);
  }
  for(const changed of [
    {sourceUrl:'https://www.france24.com/fr/20261122-fixture'},
    {sourceUrl:'https://www.france24.com/en-extra/20261122-fixture'},
    {sourceUrl:'https://www.dw.com/en/fixture/a-12345678'},
    {date:'Fri, 20 Nov 2026 10:55:55 GMT'},
    {date:'Sun, 22 Nov 2026 12:05:01 GMT'},
    {date:'Sun, 22 Nov 2026 10:55:55'},
  ])assert.equal(readPublisherNewsCandidates(rss(source,[{...row,...changed}]),source,now).length,0,JSON.stringify(changed));
  assert.throws(()=>readPublisherNewsCandidates(rss(source,[row]),{...source,language:'fr'},now),/NEWS_INDEX_NOT_REGISTERED/);
});

test('a bound Article exact alternativeHeadline admits the observed Romanian short title and publishes the primary headline',()=>{
  assert.equal(matchingNewsHeadline(shortTitle,fullTitle,'DW','ro'),false,'the original strict matcher remains strict');
  const verified=readNewsArticleMetadata(document(),ro,roUrl,now);
  assert.ok(verified);
  assert.equal(verified.title,fullTitle);assert.equal(verified.sourceUrl,canonicalNewsUrl(roUrl));
  assert.equal(verified.date,published);assert.equal(verified.publisher,'DW');
  assert.equal(verified.category,classifyNewsHeadline(fullTitle,roUrl));
  assert.deepEqual(Object.keys(verified).sort(),['category','date','publisher','sourceUrl','title']);
  for(const alternativeHeadline of [shortTitle.normalize('NFD'),shortTitle.toLowerCase()]){
    assert.equal(readNewsArticleMetadata(document(article({alternativeHeadline})),ro,roUrl,now)?.title,fullTitle);
  }
});

test('German alternate titles use exact equality rather than the looser language token matcher',()=>{
  const url='https://www.dw.com/de/fixture/a-12345678',short='Neue Regeln für Cybersicherheit';
  const full='Bundesregierung beschließt umfassende Anforderungen zum Schutz digitaler Systeme',row=candidate(url,short);
  assert.equal(matchingNewsHeadline(short,full,'DW','de'),false);
  const data=article({url,headline:full,alternativeHeadline:short});
  assert.equal(readNewsArticleMetadata(document(data,{canonical:url}),row,url,now)?.title,full);
  assert.equal(readNewsArticleMetadata(document({...data,alternativeHeadline:short+' heute'},{canonical:url}),row,url,now),null);
});

test('alternative headlines require an explicit binding on the same Article and cannot be borrowed from other objects or body text',()=>{
  const unbound=article({url:undefined});
  const fixtures=[
    unbound,
    article({url:'',alternativeHeadline:shortTitle}),
    article({url:' ',alternativeHeadline:shortTitle}),
    article({url:42}),
    article({headline:undefined,name:fullTitle}),
    article({'@type':'WebPage'}),
    {'@type':'WebPage',url:roUrl,alternativeHeadline:shortTitle,mainEntity:article({url:undefined,alternativeHeadline:undefined})},
    {'@graph':[{'@type':'WebPage',url:roUrl,alternativeHeadline:shortTitle},article({alternativeHeadline:undefined})]},
    [article({alternativeHeadline:undefined}),article({url:'https://www.dw.com/ro/other/a-99999999'})],
  ];
  for(const fixture of fixtures)assert.equal(readNewsArticleMetadata(document(fixture),ro,roUrl,now),null,JSON.stringify(fixture));
  assert.equal(readNewsArticleMetadata(document(article({alternativeHeadline:undefined}),{
    body:'<h1>'+shortTitle+'</h1>',extra:'<meta name="alternativeHeadline" content="'+escape(shortTitle)+'">',
  }),ro,roUrl,now),null);
  for(const bindings of [
    {url:undefined,'@id':roUrl+'#article'},
    {url:undefined,mainEntityOfPage:roUrl},
    {url:undefined,mainEntityOfPage:{'@id':roUrl}},
    {url:undefined,mainEntityOfPage:{url:roUrl}},
  ])assert.equal(readNewsArticleMetadata(document(article(bindings)),ro,roUrl,now)?.title,fullTitle);
});

test('incorrect alternate strings, malformed values and contradictory canonical bindings remain rejected',()=>{
  for(const alternativeHeadline of [
    shortTitle+' azi',shortTitle.replace('nesigură','sigură'),[shortTitle],{'@value':shortTitle},null,undefined,
  ])assert.equal(readNewsArticleMetadata(document(article({alternativeHeadline})),ro,roUrl,now),null);
  const other='https://www.dw.com/ro/other/a-99999999';
  for(const fields of [
    {url:other},
    {mainEntityOfPage:{'@id':other}},
    {mainEntityOfPage:{'@id':roUrl,url:other}},
    {'@id':other},
    {url:roUrl,mainEntityOfPage:42},
  ])assert.equal(readNewsArticleMetadata(document(article(fields)),ro,roUrl,now),null,JSON.stringify(fields));
  assert.equal(readNewsArticleMetadata(document(article({url:other}),{canonical:other}),ro,roUrl,now),null);
  assert.equal(readNewsArticleMetadata(document(),{...ro,sourceUrl:other},roUrl,now),null);
  assert.equal(readNewsArticleMetadata(document(article(),{canonical:'https://apnews.com/article/other'}),ro,roUrl,now),null);
});

test('alternate-title admission never borrows dateModified and retains original-date conflict checks',()=>{
  for(const datePublished of [
    undefined,'2026-11-20T10:55:55.327Z','2026-11-22T12:05:00.001Z',
    '2026-11-22T10:55:55.327','2026-02-30T10:55:55.327Z',
  ])assert.equal(readNewsArticleMetadata(document(article({datePublished,dateModified:published})),ro,roUrl,now),null,String(datePublished));
  assert.equal(readNewsArticleMetadata(document(article(),{extra:og(fullTitle,published)}),ro,roUrl,now)?.title,fullTitle);
  for(const title of [fullTitle,shortTitle]){
    assert.equal(readNewsArticleMetadata(document(article(),{extra:og(title,'2026-11-22T10:00:00.000Z')}),ro,roUrl,now),null,title);
  }
  assert.equal(readNewsArticleMetadata(document([article(),article({datePublished:'2026-11-22T10:00:00.000Z'})]),ro,roUrl,now),null);
  assert.equal(readNewsArticleMetadata(document([article(),article({headline:fullTitle+' astazi'})]),ro,roUrl,now),null);
});

test('native-index discovery preserves canonical identity, primary-title hash and exact provenance without importing alternate fields',async()=>{
  const source=index('dw-ro-news'),xml=sitemap([{sourceUrl:roUrl,title:shortTitle,language:'ro'}]);
  const requests=[];let stored;
  const fetcher=async input=>{
    const url=String(input);requests.push(url);
    if(url===source.url)return response(xml,'application/xml');
    if(url===roUrl)return response(document(),'text/html');
    if(url===NEWS_INDEX_URL||NEWS_DISCOVERY_INDEXES.some(value=>value.url===url))return new Response('Unavailable',{status:503});
    throw new Error('Unexpected outbound request: '+url);
  };
  const results=await discoverNews(fetcher,now,[],async rows=>{stored=rows;},{frontpageHighlights:false,maxArticleRequests:1});
  const cards=results.flatMap(result=>result.cards);assert.equal(cards.length,1);
  const card=cards[0],category=classifyNewsHeadline(fullTitle,roUrl);
  assert.ok(validCard(card));assert.equal(card.title,fullTitle);
  assert.equal(card.identity,canonicalNewsUrl(roUrl));assert.equal(card.sourceUrl,canonicalNewsUrl(roUrl));
  assert.equal(card.publisher,'DW');assert.equal(card.date,published);assert.equal(card.dateLabel,'Published');
  assert.deepEqual(card.sourceIds,[category===null?'news-unclassified':'news-'+category]);
  assert.equal(card.topic,category===null?'other':EDITORIAL_CATEGORY_TOPICS[category]);
  assert.equal(card.id,createHash('sha256').update(JSON.stringify(card.identity)).digest('hex').slice(0,24));
  assert.equal(card.contentHash,createHash('sha256').update(JSON.stringify(cardContent(card))).digest('hex'));
  assert.equal(card.observedAt,new Date(now).toISOString());assert.equal(card.sourceState,'verified');
  assert.equal(card.alternativeHeadline,undefined);assert.equal(card.summary,undefined);assert.equal(card.image,undefined);
  assert.equal(stored.length,1);assert.equal(stored[0].title,shortTitle,'discovery metadata is not rewritten as publication evidence');
  assert.equal(requests.filter(url=>url===roUrl).length,1);
  assert.doesNotMatch(JSON.stringify(card),/Excluded original article body|alternativeHeadline/);
  const repeated=(await discoverNews(fetcher,now+1000,[],undefined,{frontpageHighlights:false,maxArticleRequests:1})).flatMap(result=>result.cards)[0];
  assert.equal(repeated.contentHash,card.contentHash);assert.equal(repeated.id,card.id);
  assert.notEqual(repeated.observedAt,card.observedAt);
});
