import test from 'node:test';
import assert from 'node:assert/strict';
import {DAILY_EDITION_POLICY,nextDailyEditionDelay,selectContextualToday} from '../.build/src/iceo/contextual-today.js';
import {contextFromPublisherCategories} from '../.build/src/iceo/context.js';
import {PUBLIC_TOPICS} from '../.build/src/iceo/topics.js';
import {PUBLIC_EDITORIAL_CATEGORIES,EDITORIAL_CATEGORY_TOPICS} from '../.build/src/iceo/editorial-categories.js';

// Controlled records exercise selection, not claims about real current events.
const now=Date.parse('2026-11-20T12:00:00Z');
const geo=country=>contextFromPublisherCategories('gv-world',[country]);
const card=(id,topic='world',extra={})=>({
 id:id.toString(16).padStart(24,'0'),identity:`controlled:${id}`,title:`Controlled publisher listing ${id}`,
 topic,kind:'publication',sourceUrl:`https://globalvoices.org/2026/11/20/controlled-${id}/`,publisher:`Publisher ${id}`,sourceIds:['gv-world'],
 date:'2026-11-20T10:00:00.000Z',dateLabel:'Published',observedAt:new Date(now).toISOString(),contentHash:id.toString(16).padStart(64,'0'),
 boundary:'Controlled source fixture, without a personal impact claim.',deadline:null,version:null,attribution:`Publisher ${id}`,sourceState:'verified',...extra,
});
const selectionContext=(countryCode=null,preferredTopics=[])=>({countryCode,preferredTopics});
const all=selection=>[...selection.first,...selection.more];
const ids=selection=>all(selection).map(view=>view.card.id);
const wideCorpus=()=>Array.from({length:80},(_,index)=>{const category=PUBLIC_EDITORIAL_CATEGORIES[index%20];return card(index+1,EDITORIAL_CATEGORY_TOPICS[category],{publisher:`Publisher ${index%16}`,sourceIds:[`news-${category}`]});});
const histogram=values=>values.reduce((map,value)=>map.set(value,(map.get(value)??0)+1),new Map());

test('daily top has thirty visible distinct cards, twenty categories represented and stable contextual ordering',()=>{
 const records=wideCorpus(),context=selectionContext(null,['culture','science']);
 const a=selectContextualToday(records,context,now),b=selectContextualToday([...records].reverse(),context,now);
 assert.equal(PUBLIC_EDITORIAL_CATEGORIES.length,20);assert.equal(a.first.length,30);assert.equal(a.more.length,50);
 assert.equal(new Set(ids(a)).size,80);assert.deepEqual(ids(a),ids(b));assert.equal(a.daily.eligibleCount,80);
 assert.ok(['culture','science'].includes(a.first[0].card.topic),'explicit interests affect order without removing other categories');
 assert.deepEqual(new Set(a.daily.selectedCategories),new Set(PUBLIC_EDITORIAL_CATEGORIES));assert.deepEqual(a.daily.missingCategories,[]);assert.equal(a.daily.completeCoverage,true);
 assert.equal(a.daily.belowMinimum,false);assert.equal(a.daily.belowTarget,false);
 assert.ok([...histogram(a.first.map(view=>view.category)).values()].every(count=>count<=2));
 assert.ok([...histogram(a.first.map(view=>view.card.publisher)).values()].every(count=>count<=4));
});

test('twenty and forty limits bound the compact top without capping the complete stream',()=>{
 for(const limit of [20,40]){
  const selection=selectContextualToday(wideCorpus(),{...selectionContext(),limit},now);
  assert.equal(selection.first.length,limit);assert.equal(selection.more.length,80-limit);assert.equal(selection.daily.limit,limit);
  assert.equal(new Set(ids(selection)).size,80);assert.deepEqual(new Set(ids(selection)),new Set(wideCorpus().map(card=>card.id)));
 }
 assert.throws(()=>selectContextualToday(wideCorpus(),{...selectionContext(),limit:41},now),/DAILY_EDITION_LIMIT_INVALID/);
});

test('a publisher with many topics cannot crowd out categories with only one usable publisher',()=>{
 const topics=PUBLIC_EDITORIAL_CATEGORIES.slice(0,5);
 const only=topics.slice(0,4).map((topic,index)=>card(index+1,EDITORIAL_CATEGORY_TOPICS[topic],{publisher:'Shared publisher',sourceIds:[`news-${topic}`]}));
 const flexible=[card(10,EDITORIAL_CATEGORY_TOPICS[topics[4]],{publisher:'Shared publisher',sourceIds:[`news-${topics[4]}`]}),card(11,EDITORIAL_CATEGORY_TOPICS[topics[4]],{publisher:'Alternative publisher',sourceIds:[`news-${topics[4]}`]})];
 const selection=selectContextualToday([...flexible,...only],selectionContext(),now);
 assert.equal(new Set(selection.first.map(view=>view.category)).size,5);
 assert.ok(selection.first.some(view=>view.card.id===card(11).id));
 assert.ok([...histogram(selection.first.map(view=>view.card.publisher)).values()].every(count=>count<=4));
});

test('public country context changes ordering while the deliberate local-only path remains available',()=>{
 const ro=card(1,'public-affairs',{context:geo('Romania')}),gb=card(2,'public-affairs',{context:geo('United Kingdom')}),
  science=card(3,'science',{sourceIds:['nasa-news']}),business=card(4,'business',{sourceIds:['ecb-news']}),
  world=card(5,'world',{context:geo('Japan')}),environment=card(6,'environment',{sourceIds:['usgs-news']});
 const records=[gb,world,business,environment,ro,science];
 const bucharest=selectContextualToday(records,selectionContext('RO',['science','business']),now);
 const london=selectContextualToday(records,selectionContext('GB',['science','business']),now);
 assert.equal(bucharest.first[0].card.id,ro.id);assert.equal(london.first[0].card.id,gb.id);
 assert.equal(bucharest.first[0].editorial.relevance.country,'publisher-category');
 assert.deepEqual(new Set(ids(bucharest)),new Set(ids(london)));
 for(const [country,expected]of [['RO',ro.id],['GB',gb.id]]){
  const local=selectContextualToday(records,{...selectionContext(country,['science','business']),localEdition:true},now);
  assert.equal(local.first[0].card.id,expected);assert.equal(local.first[0].localMatch,true);
  assert.deepEqual(new Set(local.first.filter(view=>view.reason.startsWith('From your saved interests.')).map(view=>view.card.topic)),new Set(['science','business']));
 }
});

test('changing interests preserves all eligible categories and original facts',()=>{
 const records=wideCorpus(),before=JSON.stringify(records),context=selectionContext('RO',['culture']);
 const first=selectContextualToday(records,context,now),second=selectContextualToday(records,selectionContext('RO',['science']),now);
 assert.equal(JSON.stringify(records),before);assert.deepEqual(context.preferredTopics,['culture']);
 assert.deepEqual(new Set(first.daily.selectedTopics),new Set(second.daily.selectedTopics));
 for(const view of all(first))assert.equal(view.card,records.find(original=>original.id===view.card.id));
 assert.doesNotMatch(all(first).map(view=>view.reason).join(' '),/affects you|applies to you|confirmed local|independently verified/iu);
});

test('sparse and empty editions explicitly remain below minimum without filler',()=>{
 const empty=selectContextualToday([],selectionContext(),now);assert.deepEqual(ids(empty),[]);assert.equal(empty.daily.belowMinimum,true);
 assert.equal(empty.daily.missingCategories.length,20);assert.equal(empty.daily.completeCoverage,false);
 const only=card(1,'science',{sourceIds:['nasa-news']});
 const sparse=selectContextualToday([only],selectionContext('RO',['culture']),now);
 assert.deepEqual(ids(sparse),[only.id]);assert.equal(sparse.first[0].localMatch,false);
 assert.equal(sparse.daily.belowMinimum,true);assert.equal(sparse.daily.belowTarget,true);assert.equal(sparse.daily.missingCategories.length,19);
});

test('only source-supported publication dates in the rolling twenty-four-hour window qualify',()=>{
 const atStart=card(1,'world',{date:new Date(now-86_400_000).toISOString()}),within=card(2,'world',{date:new Date(now-86_400_000+1).toISOString()}),
  future=card(3,'world',{date:new Date(now+1).toISOString()}),old=card(4,'world',{date:new Date(now-14*86_400_000).toISOString()}),
  stale=card(5,'world',{sourceState:'stale'}),expiredCheck=card(6,'world',{observedAt:new Date(now-3_600_000).toISOString()}),
  updated=card(7,'health',{dateLabel:'Updated'}),legal=card(8,'regulation',{kind:'legal-document',dateLabel:'Document date'}),
  relabelledDocument=card(9,'regulation',{dateLabel:'Document date'});
 const selection=selectContextualToday([atStart,within,future,old,stale,expiredCheck,updated,legal,relabelledDocument],selectionContext(),now);
 assert.deepEqual(new Set(ids(selection)),new Set([within.id]));
 assert.ok(!selection.first.some(view=>view.card.id===updated.id),'Updated alone does not establish new publication');
 assert.equal(selection.daily.windowStart,new Date(now-86_400_000).toISOString());
 assert.deepEqual(ids(selectContextualToday([within],selectionContext(),now+1)),[]);
});

test('midnight does not rewrite yesterday publication dates or fabricate a new article',()=>{
 const midnight=Date.parse('2026-11-21T00:00:00Z');
 const previousDay=card(1,'world',{date:'2026-11-20T23:58:00.000Z',observedAt:'2026-11-20T23:59:00.000Z'});
 const result=selectContextualToday([previousDay],selectionContext(),midnight);
 assert.equal(result.first[0].card.date,'2026-11-20T23:58:00.000Z');assert.equal(result.first[0].card.observedAt,'2026-11-20T23:59:00.000Z');
 assert.equal(result.daily.windowEnd,'2026-11-21T00:00:00.000Z');
});

test('first-category coverage can exceed the publisher preference while category totals remain bounded',()=>{
 const dominantPublisher=PUBLIC_EDITORIAL_CATEGORIES.map((category,index)=>card(index+1,EDITORIAL_CATEGORY_TOPICS[category],{publisher:'One publisher',sourceIds:[`news-${category}`]}));
 const publisherSelection=selectContextualToday(dominantPublisher,selectionContext(),now);
 assert.equal(publisherSelection.first.length,20);assert.equal(publisherSelection.daily.completeCoverage,true);
 const dominantTopic=Array.from({length:20},(_,index)=>card(index+1,'world'));
 const dominantSelection=selectContextualToday(dominantTopic,selectionContext(),now);
 assert.equal(dominantSelection.first.length,2);assert.equal(dominantSelection.more.length,18);
 assert.deepEqual(new Set(ids(dominantSelection)),new Set(dominantTopic.map(card=>card.id)));
});

test('matching listings preserve related evidence without appearing twice',()=>{
 const title='Scientists identify unusual atmospheric patterns near the northern pole of Jupiter';
 const summary='Researchers report preliminary observations of atmospheric patterns using independent measurements from multiple instruments during the November observation campaign.';
 const primary=card(1,'science',{title,summary}),related=card(2,'science',{title,summary,date:'2026-11-20T09:00:00.000Z',observedAt:new Date(now-3_599_000).toISOString()});
 const selection=selectContextualToday([related,primary],selectionContext(null,['science']),now);
 assert.deepEqual(ids(selection),[primary.id]);assert.equal(selection.first[0].grouping,'matching-headlines');assert.equal(selection.first[0].related[0],related);
 const expired=selectContextualToday([related,primary],selectionContext(null,['science']),now+1000);
 assert.deepEqual(ids(expired),[primary.id]);assert.equal(expired.first[0].related.length,0);
});

test('duplicate identities and source URLs do not create additional positions',()=>{
 const original=card(1,'world'),duplicate=card(2,'world',{identity:original.identity,sourceUrl:original.sourceUrl,contentHash:original.contentHash});
 const selection=selectContextualToday([original,duplicate],selectionContext(),now);
 assert.equal(selection.first.length,1);assert.equal(new Set(selection.first.map(view=>view.card.sourceUrl)).size,1);
});

test('new visitors have no fictional saved-interest reason and global topics include technology',()=>{
 const records=[card(1,'world'),card(2,'technology',{sourceIds:['nodejs']}),card(3,'sport')];
 const selection=selectContextualToday(records,selectionContext(),now);
 assert.equal(selection.first.length,3);assert.ok(selection.first.every(view=>!view.reason.includes('saved interests')&&!view.localMatch));
});

test('local-only legacy selection remains opt-in; homepage global data keeps foreign publisher scope',()=>{
 const uk=card(21,'public-affairs',{sourceIds:['govuk-news']}),us=card(22,'health',{sourceIds:['fda-news']}),
  eu=card(23,'regulation',{sourceIds:['eu-law'],kind:'legal-document',dateLabel:'Document date'}),world=card(24,'world'),science=card(25,'science',{sourceIds:['nasa-news']});
 const records=[uk,us,eu,world,science];
 const local=selectContextualToday(records,{countryCode:'RO',preferredTopics:[],localEdition:true},now);
 assert.deepEqual(new Set(ids(local)),new Set([world.id,science.id]));
 const global=selectContextualToday(records,selectionContext('RO'),now);
 assert.ok(ids(global).includes(us.id));assert.ok(ids(global).includes(uk.id));assert.ok(!ids(global).includes(eu.id));
});

test('daily reprojection uses the first actual expiry boundary and never renews checks',()=>{
 const expiring=card(1,'world',{date:new Date(now-DAILY_EDITION_POLICY.windowMs+1000).toISOString()});
 const selection=selectContextualToday([expiring],selectionContext(),now);
 assert.equal(nextDailyEditionDelay(selection,now),1001);
 assert.equal(selectContextualToday([expiring],selectionContext(),now+1000).first.length,0);
 assert.equal(nextDailyEditionDelay({first:[],more:[]},now),null);
 const sourceExpiry=selectContextualToday([card(2,'science',{observedAt:new Date(now-3_599_000).toISOString()})],selectionContext(),now);
 assert.equal(nextDailyEditionDelay(sourceExpiry,now),1001);
});

test('a single category and publisher cannot truncate the available continuation',()=>{
 const records=Array.from({length:75},(_,index)=>card(index+1,'sport',{publisher:'One reviewed publisher',title:`Equestrian bulletin ${index+1}`}));
 const result=selectContextualToday(records,selectionContext(null,['sport']),now);
 assert.equal(result.first.length,2);assert.equal(result.more.length,73);assert.equal(result.daily.eligibleCount,75);
 assert.deepEqual(new Set(ids(result)),new Set(records.map(card=>card.id)));
 assert.equal(result.daily.selectedCategories.length,1);assert.equal(result.daily.completeCoverage,false);
 assert.equal(result.daily.belowMinimum,true,'the compact top is not filled by relaxing its balance');
});

test('niche and unclassified publications remain accessible with their original facts',()=>{
 const niches=[
  card(1001,'work-education',{title:'Equestrian federation confirms dressage dates in Bucharest, Romania'}),
  card(1002,'opportunities',{title:'DJ Ada starts a livestream from Bucharest, Romania'}),
  card(1003,'opportunities',{title:'Premier League reports annual revenue after its latest season'}),
  card(1004,'opportunities',{title:'Roadworks close a central street in Bucharest, Romania'}),
  card(1005,'opportunities',{title:'A collision closes a bridge in Bucharest, Romania'}),
  card(1006,'opportunities',{title:'A botanical gathering begins in Bucharest, Romania'}),
 ];
 const result=selectContextualToday([...wideCorpus(),...niches],{...selectionContext('RO'),city:{id:'683506',name:'Bucharest',countryCode:'RO',confirmed:true}},now);
 for(const source of niches){
  const view=all(result).find(view=>view.card.id===source.id);assert.ok(view,source.title);assert.equal(view.card,source);
 }
 assert.equal(all(result).find(view=>view.card.id===niches[0].id).category,'sport');
 const unclassified=all(result).find(view=>view.card.id===niches[5].id);
 assert.equal(unclassified.category,undefined);assert.equal(unclassified.editorial.classification,'unclassified');
 assert.match(unclassified.reason,/Other topics/);assert.equal(unclassified.editorial.relevance.cityMention,true);
 assert.equal(all(result).find(view=>view.card.id===niches[2].id).category,'business');
 assert.equal(result.daily.eligibleCount,86);assert.equal(new Set(ids(result)).size,86);
});

test('the continuation keeps duplicate, conflicting identity, and expiry guards',()=>{
 const routine=Array.from({length:45},(_,index)=>card(index+1,'world'));
 const title='Equestrian organisers publish the complete programme for the Bucharest autumn dressage competition';
 const primary=card(101,'sport',{title}),related=card(102,'sport',{title});
 const conflict=card(201,'world'),contradiction=card(202,'world',{identity:conflict.identity});
 const expired=card(301,'world',{date:new Date(now-86_400_000).toISOString()});
 const future=card(302,'world',{date:new Date(now+1).toISOString()});
 const stale=card(303,'world',{observedAt:new Date(now-3_600_000).toISOString()});
 const records=[...routine,primary,related,conflict,contradiction,expired,future,stale,routine[0]];
 const result=selectContextualToday(records,selectionContext(),now);
 assert.equal(ids(result).length,46);assert.equal(new Set(ids(result)).size,46);assert.equal(result.daily.eligibleCount,46);
 const match=all(result).find(view=>view.card.id===primary.id);assert.equal(match.related[0],related);
 for(const source of [related,conflict,contradiction,expired,future,stale])assert.ok(!ids(result).includes(source.id));
 const continuationExpiry=card(401,'world',{date:new Date(now-86_400_000+1000).toISOString()});
 const withExpiry=selectContextualToday([...routine,continuationExpiry],selectionContext(),now);
 assert.ok(withExpiry.more.some(view=>view.card.id===continuationExpiry.id));assert.equal(nextDailyEditionDelay(withExpiry,now),1001);
 assert.ok(!ids(selectContextualToday([...routine,continuationExpiry],selectionContext(),now+1000)).includes(continuationExpiry.id));
});

test('how-to and minor-product content stays available without padding the compact top',()=>{
 const material=card(1,'technology',{sourceIds:['news-technology'],title:'Regulator investigates a newly disclosed export scheme'});
 const feature=card(2,'travel',{sourceIds:['news-travel'],title:'How to plan a holiday in Romania'});
 const minor=card(3,'technology',{sourceIds:['news-technology'],title:'A device gains a new colour option'});
 const result=selectContextualToday([feature,minor,material],selectionContext('RO',['travel']),now);
 assert.deepEqual(result.first.map(view=>view.card.id),[material.id]);
 assert.deepEqual(new Set(result.more.map(view=>view.card.id)),new Set([feature.id,minor.id]));
 assert.equal(result.daily.belowMinimum,true);assert.equal(result.daily.eligibleCount,3);
});
