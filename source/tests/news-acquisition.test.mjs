import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {NEWS_INDEX_URL,NEWS_DISCOVERY_INDEXES,sourceLanguage} from '../.build/src/iceo/news-sources.js';
import {mergeNewsCandidates,newsAcquisitionOrder,NEWS_ACQUISITION_ROTATION_MS,discoverNews,readPublisherNewsCandidates,readNewsArticleMetadata} from '../.build/src/iceo/news-discovery.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {reconcile,fitPublicSnapshot} from '../.build/src/iceo/engine.js';
import {validDailySnapshot} from '../.build/src/iceo/daily-cache.js';

const now=Date.parse('2026-11-22T17:00:00.000Z'),date=new Date(now-60_000).toISOString();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const candidate=index=>({sourceUrl:'https://www.reuters.com/technology/controlled-source-'+String(index).padStart(5,'0'),title:'New artificial intelligence software launches for laptops',publisher:'Reuters',indexedAt:new Date(now).toISOString(),category:'technology'});
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const gal=(rows,at)=>'<rss><channel><title>GDELT Article List RSS Feed</title><link>'+NEWS_INDEX_URL+'</link><lastBuildDate>'+new Date(at).toUTCString()+'</lastBuildDate>'+rows.map(row=>'<item><title>'+escape(row.title)+'</title><link>'+escape(row.sourceUrl)+'</link></item>').join('')+'</channel></rss>';
const html=row=>'<html><head><link rel="canonical" href="'+row.sourceUrl+'"><script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',url:row.sourceUrl,headline:row.title,datePublished:date})+'</script></head><body>Never republish the article body.</body></html>';
const options={publisherIndexes:false,frontpageHighlights:false};
function fetcher(rows,at,requests=[],failed=new Set()){
  const byUrl=new Map(rows.map(row=>[row.sourceUrl,row]));
  return async input=>{
    const url=String(input);
    if(url===NEWS_INDEX_URL)return new Response(gal(rows,at),{headers:{'content-type':'application/rss+xml'}});
    requests.push(url);const row=byUrl.get(url);assert.ok(row,'requests stay inside discovered approved publishers');
    return new Response(failed.has(url)?'<html><head></head></html>':html(row),{headers:{'content-type':'text/html'}});
  };
}
function card(index,changes={}){
  const row=candidate(index),base={identity:row.sourceUrl,title:row.title,sourceUrl:row.sourceUrl,date,dateLabel:'Published',publisher:row.publisher,deadline:null,version:null,...changes};
  return {...base,id:digest(base.identity).slice(0,24),contentHash:digest(cardContent(base)),topic:'technology',kind:'publication',sourceIds:['news-technology'],
    observedAt:new Date(now).toISOString(),boundary:'Source metadata only.',attribution:'Source: Reuters.',sourceState:'verified'};
}
const health={id:'news-technology',label:'Technology',publisher:'Reviewed news discovery',topic:'technology',state:'partial',checkedAt:new Date(now).toISOString(),
  verifiedAt:new Date(now).toISOString(),count:0,rejected:0,error:null,retryAt:null,scope:'Controlled discovery.',termsUrl:'https://www.gdeltproject.org/about.html',windowed:true};

test('candidate capacity follows the existing5000-row table and imposes no subject quota',()=>{
  const pool=mergeNewsCandidates(Array.from({length:6000},(_,i)=>candidate(i)),now);
  assert.equal(pool.length,5000);assert.equal(new Set(pool.map(row=>row.sourceUrl)).size,5000);
  assert.ok(pool.every(row=>row.category==='technology'));
});

test('stable supply is traversed across rotation slots within unchanged80-request budget',()=>{
  assert.equal(NEWS_ACQUISITION_ROTATION_MS,120_000,'advance at every existing two-minute refresh slot');
  const rows=mergeNewsCandidates(Array.from({length:200},(_,i)=>candidate(i)),now),seen=new Set();
  for(let slot=0;slot<3;slot++){
    const selected=newsAcquisitionOrder(rows,80,now+slot*NEWS_ACQUISITION_ROTATION_MS);
    assert.equal(selected.length,80);assert.equal(new Set(selected.map(row=>row.sourceUrl)).size,80);
    for(const row of selected){assert.ok(rows.includes(row));seen.add(row.sourceUrl);}
    assert.deepEqual(newsAcquisitionOrder(rows,80,now+slot*NEWS_ACQUISITION_ROTATION_MS),selected,'the same slot produces the same bounded schedule');
  }
  assert.equal(seen.size,200,'later valid candidates must not remain permanently behind the same first80');
  assert.throws(()=>newsAcquisitionOrder(rows,81,now),/NEWS_SCHEDULE_INVALID/);
});

test('rotation accumulates eligible earlier observations without changing their exact hashes or timestamps',async()=>{
  const rows=Array.from({length:200},(_,i)=>candidate(i)),firstRequests=[];
  const first=(await discoverNews(fetcher(rows,now,firstRequests),now,[],undefined,options)).flatMap(result=>result.cards);
  const next=now+NEWS_ACQUISITION_ROTATION_MS,secondRequests=[];
  const result=await discoverNews(fetcher(rows,next,secondRequests),next,rows,undefined,{...options,retainedCards:first});
  const second=result.flatMap(value=>value.cards);
  assert.equal(firstRequests.length,80);assert.equal(secondRequests.length,80);assert.equal(second.length,160);
  assert.ok(secondRequests.every(url=>!firstRequests.includes(url)),'fresh unchanged originals never consume the next verification batch');
  for(const old of first)assert.deepEqual(second.find(value=>value.identity===old.identity),old);
  const source=result.find(value=>value.health.id==='news-technology');
  assert.equal(source.health.count,160);assert.match(source.health.scope,/retained without re-dating: 80/u);
  assert.equal(source.health.verifiedAt,new Date(next).toISOString());
});

test('a selected original that fails metadata verification is removed instead of revived from retention',async()=>{
  const rows=Array.from({length:200},(_,i)=>candidate(i));
  const first=(await discoverNews(fetcher(rows,now),now,[],undefined,options)).flatMap(result=>result.cards);
  const next=now+NEWS_ACQUISITION_ROTATION_MS,revisedUrl=first[0].sourceUrl,requests=[];
  const revisedRows=rows.map(row=>row.sourceUrl===revisedUrl?{...row,title:'Regulator investigates artificial intelligence software maker after new evidence'}:row);
  const selected=newsAcquisitionOrder(mergeNewsCandidates(revisedRows,next),80,next,new Set(),first);
  assert.ok(selected.some(row=>row.sourceUrl===revisedUrl),'a substantive revision of a retained original is selected for verification');
  const failed=new Set([revisedUrl]);
  const results=await discoverNews(fetcher(revisedRows,next,requests,failed),next,revisedRows,undefined,{...options,retainedCards:first});
  const cards=results.flatMap(result=>result.cards);
  assert.ok(first.some(value=>failed.has(value.sourceUrl)));assert.ok(requests.includes(revisedUrl),'the failed original was actually requested');
  assert.deepEqual(new Set(requests),new Set(selected.map(row=>row.sourceUrl)),'the fixture uses the same retained evidence as the real acquisition');
  assert.ok(cards.every(value=>!failed.has(value.sourceUrl)));
  assert.equal(results.find(value=>value.health.id==='news-technology').health.rejected,1);
});

test('retention rejects expired evidence, private extras, altered hashes and non-discovery sources',async()=>{
  const fresh=card(9000),expired={...card(9001),observedAt:new Date(now-3_600_000).toISOString()};
  const oldPublication=card(9002,{date:new Date(now-86_400_001).toISOString()});
  const privateCard={...card(9003),accountId:'never public'},badHash={...card(9004),contentHash:'0'.repeat(64)};
  const foreign={...card(9005),sourceIds:['nasa-news']};
  const result=await discoverNews(fetcher([],now),now,[],undefined,{...options,retainedCards:[fresh,expired,oldPublication,privateCard,badHash,foreign]});
  assert.deepEqual(result.flatMap(value=>value.cards),[fresh]);
  const later=await discoverNews(fetcher([],now+3_600_000),now+3_600_000,[],undefined,{...options,retainedCards:[fresh]});
  assert.equal(later.flatMap(value=>value.cards).length,0);
});

function index(id){const value=NEWS_DISCOVERY_INDEXES.find(entry=>entry.id===id);assert.ok(value);return value;}
function rss(source,{language=source.language,title=source.feedTitle,home=source.feedHome,link=source.publisherId==='digi24'?'https://www.digi24.ro/stiri/actualitate/controlled-source-123':'https://hotnews.ro/controlled-source-123',published=date}={}){
  return '<rss><channel><title>'+escape(title)+'</title><link>'+escape(home)+'</link>'+(language===null?'':'<language>'+escape(language)+'</language>')+
    '<item><title>Guvernul anunta noi masuri pentru cetateni</title><link>'+escape(link)+'</link><pubDate>'+new Date(published).toUTCString()+'</pubDate><description>Not imported</description></item></channel></rss>';
}
test('two primary Romanian feeds retain exact channel identities and publisher bounds',()=>{
  const digi=index('digi24-ro-news'),hot=index('hotnews-ro-news');
  assert.equal(digi.url,'https://www.digi24.ro/rss');assert.equal(hot.url,'https://hotnews.ro/feed');
  for(const [source,language] of [[digi,null],[hot,'ro-RO']]){
    const rows=readPublisherNewsCandidates(rss(source,{language}),source,now);
    assert.equal(rows.length,1);assert.equal(sourceLanguage(rows[0]),'ro');
    assert.deepEqual(Object.keys(rows[0]).sort(),['category','indexedAt','publisher','sourceUrl','title']);
    for(const bad of [{title:'Imposter'},{home:'https://attacker.invalid'},{language:'en'}])assert.throws(()=>readPublisherNewsCandidates(rss(source,bad),source,now),/NEWS_INDEX_IDENTITY_INVALID/);
    assert.equal(readPublisherNewsCandidates(rss(source,{language,link:'https://www.digi24.ro.attacker.invalid/stiri/story'}),source,now).length,0);
    assert.equal(readPublisherNewsCandidates(rss(source,{language,published:new Date(now-86_400_001).toISOString()}),source,now).length,0);
  }
  assert.throws(()=>readPublisherNewsCandidates(rss(hot,{language:null}),hot,now),/NEWS_INDEX_IDENTITY_INVALID/);
  assert.throws(()=>readPublisherNewsCandidates(rss(hot,{language:null}),{...hot,allowMissingLanguage:true},now),/NEWS_INDEX_NOT_REGISTERED/);
  assert.equal(readPublisherNewsCandidates(rss(digi,{language:null,link:'https://www.digi24.ro/contact'}),digi,now).length,0);
});

test('Romanian feed candidates still require matching original title and original publication date',()=>{
  const source=index('hotnews-ro-news'),row=readPublisherNewsCandidates(rss(source,{language:'ro-RO'}),source,now)[0];
  assert.ok(readNewsArticleMetadata(html(row),row,row.sourceUrl,now));
  assert.equal(readNewsArticleMetadata(html({...row,title:'Guvernul NU anunta noi masuri pentru cetateni'}),row,row.sourceUrl,now),null);
  assert.equal(readNewsArticleMetadata(html(row).replace('datePublished','dateModified'),row,row.sourceUrl,now),null);
});

test('reviewed existing English editions stop falling into unknown-language coverage',()=>{
  for(const url of ['https://www.theverge.com/tech/controlled','https://www.pcgamer.com/games/controlled','https://www.livescience.com/space/controlled','https://www.parents.com/controlled','https://www.edweek.org/policy-politics/controlled'])assert.equal(sourceLanguage(url),'en');
  assert.equal(sourceLanguage('https://www.reuters.com/world/controlled'),null,'unreviewed language is not guessed');
});

function jsonbText(value){
  if(Array.isArray(value))return '['+value.map(jsonbText).join(', ')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).map(key=>JSON.stringify(key)+': '+jsonbText(value[key])).join(', ')+'}';
  return JSON.stringify(value);
}
test('oversized retained catalogs fit the unchanged transport contract with truthful capacity diagnostics',()=>{
  const cards=Array.from({length:1600},(_,i)=>({...card(i),boundary:'Evidence boundary '.repeat(100)}));
  const large=reconcile([{health,cards}]);assert.equal(validDailySnapshot(large,now),false);
  const fitted=fitPublicSnapshot(large);
  assert.equal(validDailySnapshot(fitted,now),true);assert.ok(fitted.cards.length>0&&fitted.cards.length<cards.length);
  assert.ok(Buffer.byteLength(JSON.stringify(fitted))<=900_000);
  assert.ok(Buffer.byteLength(jsonbText(fitted))<1_048_576,'JSONB spacing retains a conservative margin');
  assert.equal(fitted.state,'partial');assert.equal(fitted.sources[0].count,fitted.cards.length);
  assert.match(fitted.sources[0].scope,/Transport capacity: [1-9][0-9]* checked records deferred/u);
  assert.deepEqual(new Set(fitted.coverage),new Set(fitted.cards.map(value=>value.topic)));
  for(const saved of fitted.cards)assert.deepEqual(saved,cards.find(value=>value.identity===saved.identity));
});

test('retained homepage provenance remains dated partial evidence when the new homepage check is unavailable',async()=>{
  const prior={...card(9500),sourceIds:['news-technology','editorial-frontpage'],observedAt:new Date(now-120_000).toISOString()};
  const results=await discoverNews(fetcher([],now),now,[],undefined,{...options,retainedCards:[prior]});
  assert.deepEqual(results.flatMap(result=>result.cards),[prior]);
  const featured=results.find(result=>result.health.id==='editorial-frontpage').health;
  assert.equal(featured.state,'partial');assert.equal(featured.count,1);
  assert.equal(featured.verifiedAt,prior.observedAt);assert.equal(featured.checkedAt,new Date(now).toISOString());
  assert.equal(featured.error,'NEWS_FRONTPAGES_UNAVAILABLE');
  assert.match(featured.scope,/placement is not asserted again at this check/u);
  assert.ok(results.flatMap(result=>result.cards).every(value=>value.sourceIds.every(id=>results.find(result=>result.health.id===id).health.state!=='unavailable')));
});

test('allowed clock skew does not orphan retained homepage provenance',async()=>{
  const prior={...card(9501),sourceIds:['news-technology','editorial-frontpage'],observedAt:new Date(now+60_000).toISOString()};
  const results=await discoverNews(fetcher([],now),now,[],undefined,{...options,retainedCards:[prior]});
  const featured=results.find(result=>result.health.id==='editorial-frontpage').health;
  assert.equal(results.flatMap(result=>result.cards).length,1);assert.equal(featured.state,'partial');assert.equal(featured.verifiedAt,prior.observedAt);
});

test('Digi24 joins only its bound Article local date with the same explicit head publication offset',()=>{
  const row=readPublisherNewsCandidates(rss(index('digi24-ro-news'),{language:null}),index('digi24-ro-news'),now)[0];
  const metadataNow=Date.parse('2026-11-22T18:00:00.000Z'),local='2026-11-22 19:35:37',explicit='2026-11-22T19:35:37+02:00';
  const document=({bound=true,canonical=row.sourceUrl,headline=row.title,localDate=local,published=explicit,extra='',bodyMeta=false,modifiedOnly=false}={})=>{
    const meta='<meta name="'+(modifiedOnly?'article:modified_time':'publish-date')+'" content="'+published+'">';
    return '<html><head><link rel="canonical" href="'+canonical+'">'+(!bodyMeta?meta:'')+extra+
      '<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',...(bound?{url:row.sourceUrl}:{}),headline,datePublished:localDate})+
      '</script></head><body>'+(bodyMeta?meta:'')+'</body></html>';
  };
  const accepted=readNewsArticleMetadata(document(),row,row.sourceUrl,metadataNow);
  assert.equal(accepted.date,'2026-11-22T17:35:37.000Z');assert.equal(accepted.title,row.title);assert.equal(accepted.sourceUrl,row.sourceUrl);
  for(const changes of [
    {bound:false},{canonical:'https://www.digi24.ro/stiri/another-article-456'},
    {headline:'Guvernul NU anunta noi masuri pentru cetateni'},
    {published:'2026-11-22T19:35:37'},{published:'not-a-date'},{published:'2026-11-22T19:35:38+02:00'},
    {localDate:'2026-11-22 19:35:38'},{bodyMeta:true},{modifiedOnly:true},
    {extra:'<meta name="publish-date" content="2026-11-22T19:36:37+02:00">'},
  ])assert.equal(readNewsArticleMetadata(document(changes),row,row.sourceUrl,metadataNow),null,JSON.stringify(changes));
  const canonicalTag='<link rel="canonical" href="'+row.sourceUrl+'">';
  assert.equal(readNewsArticleMetadata(document().replace(canonicalTag,''),row,row.sourceUrl,metadataNow),null,'an inferred final URL does not replace explicit canonical evidence for this fallback');
  assert.equal(readNewsArticleMetadata(document().replace(canonicalTag,'').replace('<body>','<body>'+canonicalTag),row,row.sourceUrl,metadataNow),null,'body markup cannot bind the publication date');
  const splitCanonical=document().replace(canonicalTag,'<link rel="canonical">').replace('<body>','<body>'+canonicalTag);
  assert.equal(readNewsArticleMetadata(splitCanonical,row,row.sourceUrl,metadataNow),null,'a head placeholder and a separate body href cannot jointly satisfy the canonical binding');
  const emptyHeadHref=document().replace(canonicalTag,'<link rel="canonical" href="">').replace('<body>','<body>'+canonicalTag);
  assert.equal(readNewsArticleMetadata(emptyHeadHref,row,row.sourceUrl,metadataNow),null,'an empty head href is not canonical evidence');
  const nestedHead=document().replace('<html><head>','<html><body><head>').replace('</head><body>','</head>');
  assert.equal(readNewsArticleMetadata(nestedHead,row,row.sourceUrl,metadataNow),null,'a head element nested under body is not the document head');
  const dateTag='<meta name="publish-date" content="'+explicit+'">';
  const nestedDate=document().replace(dateTag,'').replace('<body>','<body><head>'+dateTag+'</head>');
  assert.equal(readNewsArticleMetadata(nestedDate,row,row.sourceUrl,metadataNow),null,'nested body head metadata cannot supply the publication timestamp');
  const conflict='<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',url:row.sourceUrl,headline:row.title,datePublished:'2026-11-22 19:36:37'})+'</script>';
  assert.equal(readNewsArticleMetadata(document({extra:conflict}),row,row.sourceUrl,metadataNow),null,'contradictory local publication declarations remain rejected');
  const other={...row,publisher:'HotNews.ro',sourceUrl:'https://hotnews.ro/controlled-source-123'};
  const borrowed=document().replaceAll(row.sourceUrl,other.sourceUrl);
  assert.equal(readNewsArticleMetadata(borrowed,other,other.sourceUrl,metadataNow),null,'publisher-specific metadata must not relax other origins');
});
