import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyNewsHeadline,classifyEditorialCard,editorialCategory,editorialInterestTopic,editorialHeadlineSignals,headlineDiscoveryPriority} from '../.build/src/iceo/editorial-categories.js';
import {editorialTopic} from '../.build/src/iceo/editorial-topics.js';
import {rankEditorialCards} from '../.build/src/iceo/editorial-ranking.js';
import {readNewsCandidates,readNewsArticleMetadata,validateNewsCandidate} from '../.build/src/iceo/news-discovery.js';
import {NEWS_INDEX_URL} from '../.build/src/iceo/news-sources.js';

const now=Date.parse('2026-11-22T12:00:00Z'),date='2026-11-22T10:00:00.000Z';
const url='https://publisher.example/news/item';
const stamp=new Date(now).toISOString();
// Exact public headlines observed in the captured source edition; no network requests in these tests.
const observed=[
  {title:'Fair-weather Silicon Valley pivots away from the right after blue wave: ‘I’m not Maga’',old:'weather',expected:'public-affairs',publisher:'The Guardian',sourceUrl:'https://www.theguardian.com/us-news/2026/nov/21/silicon-valley-pivot-us-midterms'},
  {title:'Young Indians hold child safety summit in Maduravoyal',old:'world',expected:'family',publisher:'The Hindu',sourceUrl:'https://www.thehindu.com/news/cities/chennai/young-indians-hold-child-safety-summit-in-maduravoyal/article71728860.ece'},
];
const card=(id,topic,title,extra={})=>({
  id:id.toString(16).padStart(24,'0'),identity:`https://publisher.example/stories/${id}`,sourceUrl:url,
  title,topic,kind:'publication',publisher:'Controlled publisher',sourceIds:[`news-${topic}`],date,dateLabel:'Published',observedAt:stamp,
  contentHash:id.toString(16).padStart(64,'0'),boundary:'Controlled public fixture.',deadline:null,version:null,
  attribution:'Source: Controlled publisher.',sourceState:'verified',...extra,
});
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

test('observed semantic failures are corrected at discovery, cached reading and interest matching without rewriting evidence',()=>{
  for(const [index,row]of observed.entries()){
    assert.equal(classifyNewsHeadline(row.title,row.sourceUrl),row.expected);
    const cached=card(index+1,row.old,row.title,{publisher:row.publisher,sourceUrl:row.sourceUrl,sourceIds:[`news-${row.old}`,'editorial-frontpage']});
    const before=JSON.stringify(cached);
    assert.deepEqual(classifyEditorialCard(cached),{category:row.expected,basis:'category-discovery'});
    assert.equal(editorialInterestTopic(cached),'public-affairs');
    const ranked=rankEditorialCards([cached],now)[0];
    assert.ok(ranked);assert.equal(ranked.category,row.expected);
    assert.ok(!ranked.editorial.signals.includes('diplomatic-development'));
    assert.ok(ranked.editorial.signals.includes('publisher-frontpage'));
    assert.equal(JSON.stringify(cached),before);
  }
});

test('the verified acquisition path uses the same corrections and rejects obsolete candidate categories',()=>{
  const xml=`<rss><channel><title>GDELT Article List RSS Feed</title><link>${NEWS_INDEX_URL}</link><lastBuildDate>${new Date(now).toUTCString()}</lastBuildDate>${observed.map(row=>`<item><title>${escape(row.title)}</title><link>${row.sourceUrl}</link></item>`).join('')}</channel></rss>`;
  const candidates=readNewsCandidates(xml,now);
  assert.equal(candidates.length,observed.length);
  for(const row of observed){
    const candidate=candidates.find(value=>value.sourceUrl===row.sourceUrl);assert.ok(candidate);
    assert.equal(candidate.category,row.expected);
    assert.equal(validateNewsCandidate({...candidate,category:row.old},now),null);
    assert.equal(validateNewsCandidate({...candidate},now)?.category,row.expected);
    const metadata=`<html><head><link rel="canonical" href="${row.sourceUrl}"><script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',url:row.sourceUrl,headline:row.title,datePublished:date})}</script></head></html>`;
    assert.equal(readNewsArticleMetadata(metadata,candidate,row.sourceUrl,now)?.category,row.expected);
    assert.equal(readNewsArticleMetadata(metadata,candidate,'https://attacker.invalid/story',now),null);
  }
});

test('fair-weather descriptors do not invent a meteorological subject, including Unicode separators',()=>{
  for(const separator of ['-','–','—','‑',' ']){
    const title=`Fair${separator}weather supporters abandon their political party`;
    assert.equal(classifyNewsHeadline(title,url),'public-affairs',title);
    assert.equal(editorialCategory(card(10,'weather',title)),'public-affairs',title);
    assert.notEqual(editorialTopic('govuk-news','public-affairs',title,[]),'weather',title);
  }
  const vague='A fair-weather friend leaves the alliance';
  assert.equal(classifyNewsHeadline(vague,url),null);
  assert.equal(classifyNewsHeadline(vague,'https://publisher.example/weather/item'),null);
  assert.equal(editorialCategory(card(11,'weather',vague)),null);
  assert.equal(editorialInterestTopic(card(11,'weather',vague)),'other');
  assert.equal(editorialTopic('govuk-news','public-affairs','A routine notice',['Fair-weather friends']),'public-affairs');
});

test('literal fair weather and independent meteorological evidence retain the weather category',()=>{
  for(const title of [
    'Fair weather expected across the country',
    'Fair-weather forecast predicts sunshine and clear skies',
    'Fair weather returns on Sunday',
    'Fair weather will continue across the country',
    'Fair weather to continue until Monday',
    'Fair weather is likely to persist until Friday',
    'Weather warning issued ahead of heavy rainfall',
    'A hurricane forces evacuation of coastal towns',
    'Flooding follows a tropical cyclone',
    'Fair-weather allies discuss a hurricane warning',
  ]){
    assert.equal(classifyNewsHeadline(title,url),'weather',title);
    assert.equal(editorialCategory(card(12,'weather',title)),'weather',title);
    assert.equal(editorialInterestTopic(card(12,'weather',title)),'weather',title);
    assert.equal(editorialTopic('govuk-news','public-affairs',title,[]),'weather',title);
  }
});

test('child safety and protection are civic family subjects across meeting formats',()=>{
  for(const title of [
    'Young residents hold a child safety summit in their neighbourhood',
    'A charity opens a child-protection conference',
    'Parents organise a children’s safety workshop',
    'Safeguarding children is the focus of a community meeting',
    'Protecting minors is the subject of a local summit',
    'University president opens a child safety summit',
    'The president of the company opens a child protection summit',
  ]){
    assert.equal(classifyNewsHeadline(title,url),'family',title);
    assert.equal(editorialHeadlineSignals(title,'world').includes('diplomatic-development'),false,title);
    assert.equal(editorialTopic('govuk-news','world',title,[]),'public-affairs',title);
    if(title.includes('summit')){
      assert.equal(editorialCategory(card(13,'world',title)),'family',title);
      assert.equal(editorialInterestTopic(card(13,'world',title)),'public-affairs',title);
    }
  }
});

test('consumer recalls, digital controls and vague child mentions do not become parenting',()=>{
  const recall='Product recall: a child safety warning for consumers';
  assert.equal(editorialCategory(card(14,'food',recall,{sourceIds:['govuk-products']})),'food');
  assert.equal(editorialTopic('govuk-products','public-affairs',recall,[]),'food');
  assert.notEqual(classifyNewsHeadline(recall,url),'family');
  for(const title of ['Online child safety summit discusses parental controls','Child protection online and social media safeguards','A cybersecurity summit discusses child safety']){
    assert.equal(classifyNewsHeadline(title,url),'digital-life',title);
    assert.equal(editorialTopic('govuk-news','public-affairs',title,[]),'digital-life',title);
    assert.equal(headlineDiscoveryPriority(title,'world'),0,title);
  }
  assert.equal(classifyNewsHeadline('Young people attend a local summit',url),null);
  assert.equal(classifyNewsHeadline('An annual summit opens',url),null);
  assert.notEqual(editorialCategory(card(15,'food','A publication about a child')),'family');
});

test('sectoral summits keep their explicit subject and never receive a diplomatic priority',()=>{
  for(const [title,category]of [
    ['The annual software summit opens','technology'],
    ['A business summit considers the economic outlook','business'],
    ['A university summit examines classroom learning','education'],
    ['A science summit presents discoveries in biology','science'],
    ['Football clubs attend a sport summit','sport'],
    ['A health summit discusses vaccination programmes','health'],
  ]){
    assert.equal(classifyNewsHeadline(title,url),category,title);
    assert.equal(editorialCategory(card(16,'world',title)),category,title);
    assert.equal(editorialHeadlineSignals(title,'world').includes('diplomatic-development'),false,title);
  }
});

test('diplomatic meetings and ceasefire developments preserve their shared discovery and reading priority',()=>{
  for(const title of [
    'World leaders meet at a diplomatic summit for bilateral talks',
    'Presidents meet for a summit on bilateral relations',
    'Foreign ministers announce a multilateral summit',
    'Heads of state attend an annual summit',
    'G20 summit brings world leaders together',
    'Negotiators resume nuclear-arms talks',
    'A ceasefire comes into effect',
  ]){
    assert.equal(classifyNewsHeadline(title,url),'world',title);
    assert.equal(editorialCategory(card(17,'world',title)),'world',title);
    assert.equal(editorialInterestTopic(card(17,'world',title)),'world',title);
    assert.equal(headlineDiscoveryPriority(title,'world'),2,title);
  }
  // A previously checked World category remains usable without a list of current political leaders.
  const terse='India takes note of Trump-Xi-Putin summit, awaits more details';
  assert.equal(editorialCategory(card(18,'world',terse)),'world');
  assert.equal(headlineDiscoveryPriority(terse,'world'),2);
  assert.equal(headlineDiscoveryPriority('A profile of Trump, Xi and Putin','world'),0);
});

test('semantic corrections are bounded to contradicted hints and never override explicit unclassified provenance',()=>{
  for(const row of observed){
    const mixed=card(19,row.old,row.title,{sourceIds:[`news-${row.old}`,`news-${row.expected}`]});
    assert.equal(editorialCategory(mixed),row.expected);
    assert.equal(editorialCategory({...mixed,sourceIds:[...mixed.sourceIds].reverse()}),row.expected);
    assert.equal(editorialCategory({...mixed,sourceIds:['news-unclassified',`news-${row.old}`]}),null);
    assert.equal(editorialInterestTopic({...mixed,sourceIds:['news-unclassified',`news-${row.old}`]}),row.old);
  }
  assert.equal(editorialCategory(card(20,'gaming','A routine publisher update')),'gaming');
  assert.equal(editorialTopic('unreviewed','world','A child safety summit',[]),'world');
  assert.equal(editorialTopic('govuk-news','public-affairs','A routine notice',['Weather']),'weather');
});
