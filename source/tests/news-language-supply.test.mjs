import assert from 'node:assert/strict';
import test from 'node:test';
import {NEWS_INDEX_URL,NEWS_SOURCES,sourceLanguage} from '../.build/src/iceo/news-sources.js';
import {classifyNewsHeadline,headlineDiscoveryPriority} from '../.build/src/iceo/editorial-categories.js';
import {mergeNewsCandidates,discoverNews} from '../.build/src/iceo/news-discovery.js';

const now=Date.parse('2026-11-22T12:00:00.000Z'),published='2026-11-22T11:30:00.000Z';
const titles={
  en:'Regulator investigates artificial intelligence software maker over export controls',
  ar:'شركة تطلق برنامجا جديدا للذكاء الاصطناعي',
  ro:'Software nou pentru utilizatorii de laptopuri',
};
function candidate(language,index,title=titles[language]){
  const sourceUrl='https://www.dw.com/'+language+'/fixture-'+String(index).padStart(4,'0')+'/a-'+(10000000+index);
  return {sourceUrl,title,publisher:'DW',indexedAt:new Date(now).toISOString(),category:classifyNewsHeadline(title,sourceUrl)};
}
const english=()=>Array.from({length:800},(_,index)=>candidate('en',index));
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const gal=(rows,at=now)=>'<rss><channel><title>GDELT Article List RSS Feed</title><link>'+NEWS_INDEX_URL+'</link><lastBuildDate>'+new Date(at).toUTCString()+'</lastBuildDate>'+rows.map(row=>'<item><title>'+escape(row.title)+'</title><link>'+escape(row.sourceUrl)+'</link></item>').join('')+'</channel></rss>';
const html=row=>'<html><head><link rel="canonical" href="'+row.sourceUrl+'"><script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',url:row.sourceUrl,headline:row.title,datePublished:published})+'</script></head><body>Excluded publisher body</body></html>';
const response=(body,type)=>new Response(body,{headers:{'content-type':type}});
const options={publisherIndexes:false,frontpageHighlights:false};

test('rare Arabic and Romanian editions survive an800-item English supply at the500-candidate cut',()=>{
  const arabic=candidate('ar',800),romanian=candidate('ro',801),rows=[...english(),arabic,romanian];
  assert.ok(rows.every(row=>row.category==='technology'),'one shared category prevents a category queue from rescuing either edition');
  assert.ok(headlineDiscoveryPriority(rows[0].title,'technology')>headlineDiscoveryPriority(romanian.title,'technology'));
  const pool=mergeNewsCandidates(rows,now);
  assert.equal(pool.length,500);
  assert.ok(pool.some(row=>row.sourceUrl===arabic.sourceUrl));
  assert.ok(pool.some(row=>row.sourceUrl===romanian.sourceUrl));
  assert.deepEqual(new Set(pool.slice(0,3).map(row=>sourceLanguage(row))),new Set(['en','ar','ro']));
  assert.equal(new Set(pool.map(row=>row.sourceUrl)).size,500);
  assert.ok(pool.every(row=>Object.keys(row).sort().join('|')==='category|indexedAt|publisher|sourceUrl|title'));
});

test('same-origin editions retain a first original-page check inside the unchanged80-request budget',async()=>{
  const arabic=candidate('ar',800),romanian=candidate('ro',801),rows=[...english(),arabic,romanian];
  const byUrl=new Map(rows.map(row=>[row.sourceUrl,row])),requests=[];
  let active=0,peak=0;
  const results=await discoverNews(async input=>{
    const url=String(input);
    if(url===NEWS_INDEX_URL)return response(gal(rows),'application/rss+xml');
    const row=byUrl.get(url);assert.ok(row,'no unregistered fixture request');
    requests.push(url);active++;peak=Math.max(peak,active);
    await Promise.resolve();active--;
    return response(html(row),'text/html');
  },now,[],undefined,{...options,maxArticleRequests:1000,concurrency:1000});
  const cards=results.flatMap(result=>result.cards);
  assert.equal(requests.length,80);assert.ok(peak<=10);
  assert.equal(new Set(requests).size,80,'promoted candidates must not consume a second request');
  assert.deepEqual(new Set(requests.slice(0,3).map(sourceLanguage)),new Set(['en','ar','ro']));
  assert.ok(cards.some(card=>card.sourceUrl===arabic.sourceUrl));
  assert.ok(cards.some(card=>card.sourceUrl===romanian.sourceUrl));
  assert.equal(cards.length,80);
  assert.ok(cards.every(card=>card.topic==='technology'),'unused capacity is not restricted to50 cards per category');
});

test('a retained multilingual pool is reverified after an index outage without losing rare editions',async()=>{
  const arabic=candidate('ar',800),romanian=candidate('ro',801);
  const pool=mergeNewsCandidates([...english(),arabic,romanian],now),byUrl=new Map(pool.map(row=>[row.sourceUrl,row])),requests=[];
  const results=await discoverNews(async input=>{
    const url=String(input);if(url===NEWS_INDEX_URL)return new Response('Unavailable',{status:503});
    const row=byUrl.get(url);assert.ok(row);requests.push(url);return response(html(row),'text/html');
  },now,pool,undefined,options);
  assert.equal(requests.length,80);
  for(const row of [arabic,romanian])assert.ok(results.flatMap(result=>result.cards).some(card=>card.sourceUrl===row.sourceUrl));
});

test('the first opportunity keeps the strongest candidate within each language',()=>{
  const enWeak=candidate('en',1,'New artificial intelligence software launches for laptops');
  const enStrong=candidate('en',2);
  const arWeak=candidate('ar',3),arStrong=candidate('ar',4,'تحقيق بشأن شركة للذكاء الاصطناعي');
  const romanian=candidate('ro',5);
  assert.equal(arStrong.category,'technology');
  assert.ok(headlineDiscoveryPriority(enStrong.title,'technology')>headlineDiscoveryPriority(enWeak.title,'technology'));
  assert.ok(headlineDiscoveryPriority(arStrong.title,'technology')>headlineDiscoveryPriority(arWeak.title,'technology'));
  const ordered=mergeNewsCandidates([enWeak,arWeak,romanian,arStrong,enStrong],now);
  assert.equal(ordered.find(row=>sourceLanguage(row)==='en').sourceUrl,enStrong.sourceUrl);
  assert.equal(ordered.find(row=>sourceLanguage(row)==='ar').sourceUrl,arStrong.sourceUrl);
  assert.deepEqual(new Set(ordered.slice(0,3).map(row=>sourceLanguage(row))),new Set(['en','ar','ro']));
  assert.equal(ordered.length,5);assert.equal(new Set(ordered.map(row=>row.sourceUrl)).size,5);
});

test('one known language preserves priority and unknown publishers are not relabelled English',()=>{
  const weak=candidate('en',1,'New artificial intelligence software launches for laptops'),strong=candidate('en',2);
  assert.equal(mergeNewsCandidates([weak,strong],now)[0].sourceUrl,strong.sourceUrl);
  const unknown={...strong,sourceUrl:'https://www.reuters.com/technology/fixture-inquiry',publisher:'Reuters'};
  assert.equal(sourceLanguage(unknown),null);
  assert.equal(mergeNewsCandidates([weak,unknown],now)[0].sourceUrl,unknown.sourceUrl);
  const mixed=mergeNewsCandidates([unknown,candidate('ar',3),candidate('ro',4)],now);
  assert.deepEqual(mixed.slice(0,2).map(row=>sourceLanguage(row)).sort(),['ar','ro']);
  assert.equal(sourceLanguage(mixed.find(row=>row.sourceUrl===unknown.sourceUrl)),null);
});

test('a promoted candidate still requires an original publication date and cannot expand a smaller budget',async()=>{
  const rows=[candidate('en',1),candidate('ar',2)],requests=[];
  const fetcher=async input=>{
    const url=String(input);if(url===NEWS_INDEX_URL)return response(gal(rows),'application/rss+xml');
    requests.push(url);const row=rows.find(value=>value.sourceUrl===url);assert.ok(row);
    return response(sourceLanguage(row)==='ar'?'<html><head><meta property="og:title" content="'+row.title+'"></head></html>':html(row),'text/html');
  };
  const results=await discoverNews(fetcher,now,[],undefined,{...options,maxArticleRequests:2});
  assert.equal(requests.length,2);assert.equal(results.flatMap(result=>result.cards).length,1);
  assert.ok(results.flatMap(result=>result.cards).every(card=>sourceLanguage(card)==='en'));
  requests.length=0;
  await discoverNews(fetcher,now,[],undefined,{...options,maxArticleRequests:1});
  assert.equal(requests.length,1);
});

const firstReviewBy=NEWS_SOURCES.map(source=>source.rightsReviewBy).sort()[0];
const lastReviewedInstant=Date.parse(firstReviewBy+'T23:59:59.999Z');
test('an expired discovery review makes zero outbound requests and cannot revive retained evidence',async()=>{
  const expired=lastReviewedInstant+1,seed={...candidate('ar',1),indexedAt:new Date(expired).toISOString()};
  let requests=0,callbacks=0;
  const results=await discoverNews(async()=>{requests++;throw new Error('Must not request an expired source');},expired,[seed],async()=>{callbacks++;});
  assert.equal(requests,0);assert.equal(callbacks,0);
  assert.deepEqual(results.map(result=>result.health.id),NEWS_SOURCES.map(source=>source.id));
  assert.ok(Object.isFrozen(results));
  for(const result of results){
    assert.equal(result.health.state,'unavailable');
    assert.equal(result.health.error,'RIGHTS_REVIEW_EXPIRED');
    assert.equal(result.health.verifiedAt,null);
    assert.equal(result.health.checkedAt,new Date(expired).toISOString());
    assert.equal(result.health.retryAt,null);
    assert.equal(result.health.count,0);assert.equal(result.health.rejected,0);assert.equal(result.cards.length,0);
  }
});

test('review expiry uses the same UTC calendar-day boundary as direct sources',async()=>{
  let requests=0;
  const fetcher=async()=>{requests++;return response(gal([],lastReviewedInstant),'application/rss+xml');};
  const before=await discoverNews(fetcher,lastReviewedInstant,[],undefined,options);
  assert.equal(requests,1);
  assert.ok(before.every(result=>result.health.error!=='RIGHTS_REVIEW_EXPIRED'));
  requests=0;
  const after=await discoverNews(fetcher,lastReviewedInstant+1,[],undefined,options);
  assert.equal(requests,0);
  assert.ok(after.every(result=>result.health.error==='RIGHTS_REVIEW_EXPIRED'&&result.health.verifiedAt===null));
});
