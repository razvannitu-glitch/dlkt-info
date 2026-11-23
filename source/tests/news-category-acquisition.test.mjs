import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NEWS_INDEX_URL,sourceLanguage} from '../.build/src/iceo/news-sources.js';
import {classifyNewsHeadline,EDITORIAL_CATEGORY_TOPICS} from '../.build/src/iceo/editorial-categories.js';
import {classifyNewsSubject} from '../.build/src/iceo/news-taxonomy.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {groupStories} from '../.build/src/iceo/story-grouping.js';
import {NEWS_CATEGORY_ACQUISITION_POLICY,NEWS_ACQUISITION_ROTATION_MS,newsAcquisitionOrder,validateNewsCandidate,discoverNews,readNewsArticleMetadata} from '../.build/src/iceo/news-discovery.js';

const now=Date.parse('2026-11-23T12:00:00.000Z'),stamp=new Date(now).toISOString(),date=new Date(now-60_000).toISOString();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function row(category,index,language='en'){
 const base=language==='ro'?'https://www.digi24.ro/stiri/':'https://www.theguardian.com/';
 const section=category==='health'?'health':'technology',sourceUrl=base+section+'/coverage-fixture-'+index;
 const title=(category==='health'?'Hospital care standards in district ':'Software support standards in district ')+index;
 return {sourceUrl,title,publisher:language==='ro'?'Digi24':'The Guardian',indexedAt:stamp,category:classifyNewsHeadline(title,sourceUrl)};
}
function evidence(candidate,overrides={}){
 const base={identity:candidate.sourceUrl,title:candidate.title,sourceUrl:candidate.sourceUrl,date,dateLabel:'Published',publisher:candidate.publisher,deadline:null,version:null,...overrides};
 return {...base,id:digest(base.identity).slice(0,24),contentHash:digest(cardContent(base)),topic:candidate.category===null?'other':EDITORIAL_CATEGORY_TOPICS[candidate.category],kind:'publication',
  sourceIds:[candidate.category===null?'news-unclassified':'news-'+candidate.category],observedAt:stamp,boundary:'Original source metadata checked.',attribution:'Source: '+candidate.publisher+'.',sourceState:'verified'};
}
const category=entry=>classifyNewsSubject(entry.title,entry.sourceUrl)?.category;
const health=id=>row('health',id),technology=id=>row('technology',id);
const metadata=(candidate,overrides={})=>'<html><head><link rel="canonical" href="'+candidate.sourceUrl+'"><script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',url:candidate.sourceUrl,headline:candidate.title,datePublished:date,...overrides})+'</script></head></html>';
const xmlEscape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const rss=rows=>'<rss><channel><title>GDELT Article List RSS Feed</title><link>'+NEWS_INDEX_URL+'</link><lastBuildDate>'+new Date(now).toUTCString()+'</lastBuildDate>'+rows.map(entry=>'<item><title>'+xmlEscape(entry.title)+'</title><link>'+xmlEscape(entry.sourceUrl)+'</link></item>').join('')+'</channel></rss>';
const options={publisherIndexes:false,frontpageHighlights:false};

test('undersupplied IPTC category receives enough attempts before an already covered category in the same language',()=>{
 assert.deepEqual(NEWS_CATEGORY_ACQUISITION_POLICY,{minimum:7,target:10});
 const retained=Array.from({length:10},(_,index)=>evidence(technology(index)));
 const candidates=[...Array.from({length:30},(_,index)=>technology(100+index)),...Array.from({length:12},(_,index)=>health(100+index))];
 const chosen=newsAcquisitionOrder(candidates,10,now,new Set(),retained);
 assert.equal(chosen.length,10);
 assert.ok(chosen.every(entry=>category(entry)==='07000000'),'the ten verification opportunities fill the health gap, not existing technology coverage');
});

test('seven covered subjects get three new attempts toward ten without rechecking unchanged originals first',()=>{
 const current=Array.from({length:7},(_,index)=>health(index)),retained=[...current.map(entry=>evidence(entry)),...Array.from({length:10},(_,index)=>evidence(technology(index)))];
 const candidates=[...current,...Array.from({length:10},(_,index)=>technology(100+index)),...Array.from({length:10},(_,index)=>health(100+index))];
 const chosen=newsAcquisitionOrder(candidates,3,now,new Set(),retained);
 assert.equal(chosen.length,3);assert.ok(chosen.every(entry=>category(entry)==='07000000'));
 assert.ok(chosen.every(entry=>!current.some(old=>old.sourceUrl===entry.sourceUrl)));
});

test('English coverage cannot satisfy the Romanian category deficit',()=>{
 const retained=Array.from({length:10},(_,index)=>evidence(health(index)));
 const candidates=[...Array.from({length:30},(_,index)=>health(100+index)),...Array.from({length:12},(_,index)=>row('health',100+index,'ro'))];
 const chosen=newsAcquisitionOrder(candidates,12,now,new Set(),retained);
 assert.ok(chosen.filter(entry=>sourceLanguage(entry.sourceUrl)==='ro').length>=7);
 assert.ok(chosen.some(entry=>sourceLanguage(entry.sourceUrl)==='en'),'larger deficit preserves other reviewed-language opportunities');
});

test('canonical duplicates and unchanged fresh originals cannot consume the gap allocation',()=>{
 const current=Array.from({length:3},(_,index)=>health(index)),fresh=Array.from({length:10},(_,index)=>health(100+index));
 const chosen=newsAcquisitionOrder([...current,...fresh,...fresh],7,now,new Set(),current.map(entry=>evidence(entry)));
 assert.equal(chosen.length,7);assert.equal(new Set(chosen.map(entry=>entry.sourceUrl)).size,7);
 assert.ok(chosen.every(entry=>fresh.includes(entry)));
});

test('expired, tampered, conflicting or private retained evidence does not satisfy a category target',()=>{
 const validTechnology=Array.from({length:10},(_,index)=>evidence(technology(index)));
 const invalid=Array.from({length:10},(_,index)=>({...evidence(health(index)),observedAt:new Date(now-3_600_000).toISOString()}));
 invalid.push({...evidence(health(20)),accountId:'private'});
 invalid.push({...evidence(health(21)),contentHash:'0'.repeat(64)});
 const conflict=evidence(health(22));invalid.push(conflict,evidence(health(22),{title:'Conflicting hospital report'}));
 const chosen=newsAcquisitionOrder([...Array.from({length:12},(_,index)=>health(100+index)),...Array.from({length:12},(_,index)=>technology(100+index))],10,now,new Set(),[...validTechnology,...invalid]);
 assert.equal(chosen.length,10);assert.ok(chosen.every(entry=>category(entry)==='07000000'));
});

test('reviewed languages keep finite opportunities and candidate rotation inside the unchanged eighty-request ceiling',()=>{
 const candidates=[...Array.from({length:120},(_,index)=>health(index)),...Array.from({length:120},(_,index)=>row('health',index,'ro'))];
 const seen=new Set();
 for(let slot=0;slot<3;slot++){
  const chosen=newsAcquisitionOrder(candidates,80,now+slot*NEWS_ACQUISITION_ROTATION_MS);
  assert.equal(chosen.length,80);assert.equal(new Set(chosen.map(entry=>entry.sourceUrl)).size,80);
  assert.ok(chosen.some(entry=>sourceLanguage(entry.sourceUrl)==='ro'));assert.ok(chosen.some(entry=>sourceLanguage(entry.sourceUrl)==='en'));
  chosen.forEach(entry=>seen.add(entry.sourceUrl));
 }
 assert.ok(seen.size>80,'finite capacity progresses to later candidates');
 assert.throws(()=>newsAcquisitionOrder(candidates,81,now),/NEWS_SCHEDULE_INVALID/u);
});

test('a selected original that fails revalidation is never restored from retained evidence',async()=>{
 const candidate=health(1),old={...evidence(candidate),observedAt:new Date(now-3_480_000).toISOString()},calls=[];
 const results=await discoverNews(async input=>{
  const url=String(input);if(url===NEWS_INDEX_URL)return new Response(rss([candidate]),{headers:{'content-type':'application/rss+xml'}});
  calls.push(url);return new Response('<html><head></head></html>',{headers:{'content-type':'text/html'}});
 },now,[],undefined,{...options,retainedCards:[old],maxArticleRequests:1});
 assert.deepEqual(calls,[candidate.sourceUrl]);assert.equal(results.flatMap(result=>result.cards).length,0);
});

test('explicit advertising markers are excluded before acquisition and from retained evidence',async()=>{
 const clean=health(1),marked=['[P] ','(P) ','Advertorial: ','Publicitate: '].map((prefix,index)=>({...health(index+10),title:prefix+health(index+10).title}));
 for(const candidate of marked){
  assert.equal(validateNewsCandidate(candidate,now),null);
  assert.equal(readNewsArticleMetadata(metadata(candidate),candidate,candidate.sourceUrl,now),null);
 }
 const retained=marked.map(candidate=>evidence(candidate)),calls=[];
 const results=await discoverNews(async input=>{
  const url=String(input);if(url===NEWS_INDEX_URL)return new Response(rss([...marked,clean]),{headers:{'content-type':'application/rss+xml'}});
  calls.push(url);return new Response(metadata(clean),{headers:{'content-type':'text/html'}});
 },now,[],undefined,{...options,retainedCards:retained,maxArticleRequests:80});
 assert.deepEqual(calls,[clean.sourceUrl]);assert.deepEqual(results.flatMap(result=>result.cards).map(card=>card.sourceUrl),[clean.sourceUrl]);
 assert.equal(readNewsArticleMetadata(metadata(clean,{headline:'[P] '+clean.title}),clean,clean.sourceUrl,now),null,'original publisher label cannot disappear behind an unmarked index title');
});

test('ordinary reporting about advertising remains eligible without an explicit paid-content marker',()=>{
 const candidate={...technology(1),title:'Software tools used to identify misleading advertorials and publicitate'};
 candidate.category=classifyNewsHeadline(candidate.title,candidate.sourceUrl);
 assert.ok(validateNewsCandidate(candidate,now));
 assert.ok(readNewsArticleMetadata(metadata(candidate),candidate,candidate.sourceUrl,now));
});

test('yesterday in Bucharest never satisfies the new Today acquisition target after local midnight',()=>{
 const afterMidnight=Date.parse('2026-11-23T22:00:30.000Z'),observedAt=new Date(afterMidnight-1000).toISOString();
 const yesterday=new Date(afterMidnight-60_000).toISOString(),today=new Date(afterMidnight-10_000).toISOString();
 const retained=[...Array.from({length:10},(_,index)=>({...evidence(row('health',index,'ro'),{date:yesterday}),observedAt})),
  ...Array.from({length:10},(_,index)=>({...evidence(row('technology',index,'ro'),{date:today}),observedAt}))];
 const candidates=[...Array.from({length:20},(_,index)=>row('technology',100+index,'ro')),...Array.from({length:10},(_,index)=>row('health',100+index,'ro'))];
 const chosen=newsAcquisitionOrder(candidates,10,afterMidnight,new Set(),retained);
 assert.equal(chosen.length,10);assert.ok(chosen.every(entry=>category(entry)==='07000000'));
 assert.ok(retained.slice(0,10).every(card=>card.date.startsWith('2026-11-23')),'same UTC date is not the Romanian reader day');
});

test('ten differently worded reports about one explicit event cannot satisfy ten category subjects',()=>{
 const sameEvent=Array.from({length:10},(_,index)=>{
  const entry={...technology(index),title:'Software update addresses CVE-2026-1234 for service group '+index};
  entry.category=classifyNewsHeadline(entry.title,entry.sourceUrl);return evidence(entry);
 });
 assert.equal(groupStories(sameEvent).length,1,'fixture is the actual shared-event grouping used by the feed');
 const retained=[...sameEvent,...Array.from({length:10},(_,index)=>evidence(health(index)))];
 const candidates=[...Array.from({length:15},(_,index)=>health(100+index)),...Array.from({length:10},(_,index)=>technology(100+index))];
 const chosen=newsAcquisitionOrder(candidates,9,now,new Set(),retained);
 assert.equal(chosen.length,9);assert.ok(chosen.every(entry=>category(entry)==='13000000'));
});

test('an exact bound publisher suffix is unchanged while a substantive title revision is reverified',()=>{
 const current=Array.from({length:3},(_,index)=>{
  const sourceUrl='https://hotnews.ro/suffix-fixture-'+index,title='Hospital care standards in district '+index;
  return {sourceUrl,title,publisher:'HotNews.ro',indexedAt:stamp,category:classifyNewsHeadline(title,sourceUrl)};
 });
 const retained=current.map(entry=>evidence(entry,{title:entry.title+' - HotNews.ro'}));
 const revised={...current[0],title:current[0].title+' after new patient safety rules'};
 revised.category=classifyNewsHeadline(revised.title,revised.sourceUrl);
 const newcomers=Array.from({length:10},(_,index)=>{
  const sourceUrl='https://hotnews.ro/suffix-new-fixture-'+index,title='Hospital care standards in district '+(100+index);
  return {sourceUrl,title,publisher:'HotNews.ro',indexedAt:stamp,category:classifyNewsHeadline(title,sourceUrl)};
 });
 const selected=newsAcquisitionOrder([...current,...newcomers],7,now,new Set(),retained);
 assert.equal(selected.length,7);assert.ok(selected.every(entry=>newcomers.includes(entry)),'publisher decoration cannot consume a fresh verification slot');
 const changed=newsAcquisitionOrder([revised,...current.slice(1)],1,now,new Set(),retained);
 assert.equal(changed[0]?.sourceUrl,revised.sourceUrl);assert.equal(changed[0]?.title,revised.title);
});

test('unknown subjects keep an original-metadata opportunity while classified deficits fill the bounded batch',()=>{
 const unclassified={sourceUrl:'https://hotnews.ro/undetermined-subject-fixture',title:'O noua etapa incepe maine la ora noua',publisher:'HotNews.ro',indexedAt:stamp,category:null};
 unclassified.category=classifyNewsHeadline(unclassified.title,unclassified.sourceUrl);
 assert.equal(classifyNewsSubject(unclassified.title,unclassified.sourceUrl),null);
 const candidates=[...Array.from({length:120},(_,index)=>health(index)),...Array.from({length:120},(_,index)=>row('health',index,'ro')),unclassified];
 const chosen=newsAcquisitionOrder(candidates,60,now);
 assert.equal(chosen.length,60);assert.equal(new Set(chosen.map(entry=>entry.sourceUrl)).size,60);
 assert.ok(chosen.includes(unclassified),'title classification cannot permanently prevent fetching publisher subject metadata');
 assert.ok(chosen.some(entry=>sourceLanguage(entry.sourceUrl)==='en'));
 assert.ok(chosen.some(entry=>sourceLanguage(entry.sourceUrl)==='ro'));
});
