import assert from 'node:assert/strict';
import test from 'node:test';
import {readNewsArticleMetadata} from '../.build/src/iceo/news-discovery.js';
import {completeDigi24TruncatedHeadline} from '../.build/src/iceo/digi24-metadata.js';

// Exact metadata values observed on publisher originals by CI run 45272649682.
// These fixtures contain metadata only. Article prose is not reproduced.
const originals=[
  {
    "url": "https://www.digi24.ro/stiri/actualitate/sanatate/ce-scade-cu-adevarat-tensiunea-arteriala-cercetatorii-au-analizat-efectele-cafelei-sarii-alimentatiei-si-exercitiilor-fizice-4050049",
    "title": "Ce scade cu adevărat tensiunea arterială. Cercetătorii au analizat efectele cafelei, sării, alimentației și exercițiilor fizice",
    "headline": "Ce scade cu adevărat tensiunea arterială. Cercetătorii au analizat efectele cafelei, sării, alimentației...",
    "localDate": "2026-11-23 23:37:48",
    "explicit": "2026-11-23T23:37:48+02:00"
  },
  {
    "url": "https://www.digi24.ro/stiri/sci-tech/lumea-digitala/seful-onu-cere-un-mecanism-international-pentru-controlul-riscurilor-inteligentei-artificiale-trebuie-sa-actionam-pana-anul-viitor-4050023",
    "title": "Șeful ONU cere un mecanism internațional pentru controlul riscurilor inteligenței artificiale: „Trebuie să acționăm până anul viitor”",
    "headline": "Șeful ONU cere un mecanism internațional pentru controlul riscurilor inteligenței artificiale: „Trebuie să...",
    "localDate": "2026-11-23 23:29:47",
    "explicit": "2026-11-23T23:29:47+02:00"
  }
];
const now=Date.parse('2026-11-23T21:44:30Z');
const attr=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const meta=(name,value)=>value===null?'':'<meta property="'+name+'" content="'+attr(value)+'">';
function fixture(row,changes={}){
  const value=(key,fallback)=>Object.hasOwn(changes,key)?changes[key]:fallback;
  const publish=value('publishDate',row.explicit);
  const headPublish=publish===null?'':'<meta name="publish-date" content="'+attr(publish)+'">';
  const canonical=value('canonical',row.url);
  const canonicalLink=canonical===null?'':'<link rel="canonical" href="'+attr(canonical)+'">';
  const article={'@context':'https://schema.org','@type':'NewsArticle',headline:row.headline,
    datePublished:row.localDate,mainEntityOfPage:row.url,...(changes.article??{})};
  const og=meta('og:title',value('ogTitle',row.title))+meta('og:url',value('ogUrl',row.url));
  return '<!doctype html><html><head>'+canonicalLink+(changes.extraCanonical??'')
    +(changes.movePublishToBody?'':headPublish)+(changes.moveOgToBody?'':og)+(changes.extraHead??'')
    +'</head><body><script type="application/ld+json">'+JSON.stringify(article)+'</script>'
    +(changes.movePublishToBody?headPublish:'')+(changes.moveOgToBody?og:'')+(changes.extraBody??'')
    +'</body></html>';
}
function candidate(row,changes={}){return {sourceUrl:row.url,title:row.title,publisher:'Digi24',indexedAt:new Date(now).toISOString(),category:null,...changes};}
function read(row,changes={},candidateChanges={},at=now){return readNewsArticleMetadata(fixture(row,changes),candidate(row,candidateChanges),row.url,at);}

test('reviewed Digi24 originals admit the full original OG headline and explicit publication instant',()=>{
  for(const row of originals){
    const value=read(row);
    assert.ok(value,row.url);
    assert.equal(value.title,row.title);
    assert.equal(value.sourceUrl,row.url);
    assert.equal(value.date,new Date(row.explicit).toISOString());
    assert.notEqual(value.date,new Date(now).toISOString(),'index observation time is never a publication time');
  }
});
test('Digi24 truncated metadata retains an exact canonical Article binding',()=>{
  const row=originals[0],different=row.url.replace('4050049','4050048');
  for(const changes of [
    {canonical:null},{canonical:different},
    {extraCanonical:'<link rel="canonical" href="'+attr(row.url)+'">'},
    {article:{mainEntityOfPage:different}},
    {article:{mainEntityOfPage:undefined}},
    {article:{mainEntityOfPage:row.url,url:different}},
  ])assert.equal(read(row,changes),null,JSON.stringify(changes));
  assert.equal(read(row,{}, {sourceUrl:different}),null);
});
test('Digi24 full headline must come from unique original head OG declarations',()=>{
  const row=originals[0],different=row.url.replace('4050049','4050048');
  for(const changes of [
    {ogTitle:null},{ogUrl:null},{ogUrl:different},{moveOgToBody:true},
    {ogTitle:row.title+'!'},
    {extraHead:meta('og:title',row.title)},
    {extraHead:meta('og:title',row.title+'!')},
    {extraHead:meta('og:url',different)},
  ])assert.equal(read(row,changes),null,JSON.stringify(changes));
});
test('Digi24 original title identity is exact, including the suffix after the shortened headline',()=>{
  const row=originals[0];
  assert.equal(read(row,{}, {title:row.title.replace('exercițiilor fizice','lipsei exercițiilor fizice')}),null);
  assert.equal(read(row,{article:{headline:row.headline.replace('scade','crește')}}),null);
  assert.equal(read(row,{article:{headline:row.headline.slice(0,-3)}}),null);
  assert.equal(read(row,{article:{headline:row.headline.slice(0,-3)+'…'}}),null);
  assert.equal(read(row,{article:{headline:row.title.slice(0,35)+'...'}}),null);
});
test('Digi24 publication requires original head publish-date with explicit offset and identical wall-clock seconds',()=>{
  const row=originals[0];
  for(const changes of [
    {publishDate:null},{movePublishToBody:true},
    {publishDate:row.localDate.replace(' ','T')},
    {publishDate:row.explicit.replace('23:37:48','23:37:49')},
    {publishDate:null,extraHead:meta('article:modified_time',row.explicit)},
    {publishDate:null,extraBody:'Publicat '+row.localDate},
    {article:{datePublished:undefined,dateModified:row.localDate}},
    {extraHead:'<meta name="publish-date" content="'+row.explicit.replace('+02:00','+03:00')+'">'},
  ])assert.equal(read(row,changes),null,JSON.stringify(changes));
});
test('Digi24 publication checks retain freshness and future limits',()=>{
  const row=originals[0],instant=Date.parse(row.explicit);
  assert.equal(read(row,{}, {},instant+86_400_001),null);
  assert.equal(read(row,{}, {},instant-300_001),null);
});
test('Digi24 completed headline retains only its canonical bound publisher subject',()=>{
  const row=originals[0];
  const value=read(row,{article:{articleSection:'Sanatate',keywords:['Romania']}});
  assert.ok(value);
  assert.deepEqual(value.articleSubject,{basis:'publisher-jsonld',articleUrl:row.url,sections:['Sanatate'],keywords:['Romania']});
});
test('truncated headline completion is restricted to Digi24 and never creates a title or timestamp',()=>{
  const row=originals[0];
  const evidence={articleHeadline:row.headline,candidateTitle:row.title,headTitles:[row.title],headUrls:[row.url],canonicalUrl:row.url};
  assert.equal(completeDigi24TruncatedHeadline(evidence),row.title);
  for(const patch of [
    {canonicalUrl:row.url.replace('www.digi24.ro','www.hotnews.ro')},
    {headTitles:[null]},{headTitles:[]},{headUrls:[]},
    {headUrls:[' '+row.url]},{headUrls:['https://attacker.invalid/example']},
    {articleHeadline:'Un titlu prea scurt...'},
    {candidateTitle:row.title+'!'},
  ])assert.equal(completeDigi24TruncatedHeadline({...evidence,...patch}),null,JSON.stringify(patch));
});
