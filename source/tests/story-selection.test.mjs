import test from 'node:test';
import assert from 'node:assert/strict';
import {rankEditorialCards} from '../.build/src/iceo/editorial-ranking.js';
import {selectContextualToday} from '../.build/src/iceo/contextual-today.js';
import {rankContextualCards} from '../.build/src/iceo/contextual.js';
import {selectReadingCards,savedReadingCards} from '../.build/src/iceo/reader.js';
import {selectExploreCards} from '../.build/src/explore/selection.js';
import {LiveEdition,editionChanges,editionStoryKey} from '../.build/src/iceo/live-edition.js';
import {selectDaily,topicSignature,feedbackMatches} from '../.build/src/daily/selection.js';
import {validEdition,validTopicSnapshot,localDay,parseDaily,DAILY_VERSION} from '../.build/src/daily/contracts.js';
import {planDailyReading} from '../.build/src/daily/reading.js';
import {composeEdition,editionText} from '../.build/src/edition/compose.js';
import {prepareArtifact,assertArtifact} from '../.build/src/edition/artifact.js';
import {validArtifact} from '../.build/src/edition/artifact-contracts.js';
import {artifactText,artifactHtml} from '../.build/src/edition/render.js';
import {emptyInsight} from '../.build/src/iceo/insight.js';
import {validInsight} from '../.build/src/iceo/insight-contracts.js';
import {copyCard} from '../.build/src/iceo/card-validation.js';
import {parseDocument,DomUtils} from 'htmlparser2';

// Controlled source records exercise the observed headline pair and integration;
// fixture dates, URLs and coverage are not claims about a live publication check.
const now=Date.parse('2026-11-22T10:00:00.000Z');
const stamp=new Date(now).toISOString();
const card=(id,title,extra={})=>({
  id:id.toString(16).padStart(24,'0'),identity:`story-integration:${id}`,title,topic:'environment',kind:'publication',
  sourceUrl:`https://www.theguardian.com/environment/2026/nov/22/controlled-${id}`,publisher:'The Guardian',sourceIds:['news-environment'],
  date:new Date(now-600_000-id*1000).toISOString(),dateLabel:'Published',observedAt:stamp,contentHash:id.toString(16).padStart(64,'0'),
  boundary:'Controlled integration fixture only.',deadline:null,version:null,attribution:'Controlled publisher listing',sourceState:'verified',...extra,
});
const a=card(1,'Cop31 live: A new draft deal on the table as talks go into final hours');
const b=card(2,'COP31: New draft deal aims to avert collapse of talks at climate summit',{
  publisher:'BBC',sourceUrl:'https://www.bbc.com/news/articles/controlled-cop31',
});
const context={countryCode:null,preferredTopics:[]};
const select=(records,at=now)=>selectContextualToday(records,context,at);
const all=selection=>[...selection.first,...selection.more];
const originals=view=>[view.card,...view.related];
const ids=records=>records.map(record=>record.id).sort();
const settings={topics:['environment'],query:'',budget:20,mode:'briefing'};
const paris=Object.freeze({id:'2988507',name:'Paris',countryCode:'FR',country:'France',region:'Ile-de-France',lat:48.8534,lon:2.3488,timezone:'Europe/Paris'});

test('ranking and Today expose the observed COP31 pair once with both immutable originals',()=>{
  const records=[a,b],before=JSON.stringify(records),ranked=rankEditorialCards(records,now),today=select(records);
  assert.equal(ranked.length,1);assert.equal(all(today).length,1);
  assert.equal(ranked[0].grouping,'shared-event');assert.equal(ranked[0].editorial.relatedListingsAreIndependentConfirmations,false);
  assert.deepEqual(ids(originals(ranked[0])),ids(records));
  assert.equal(originals(ranked[0]).find(record=>record.id===a.id),a);
  assert.equal(originals(ranked[0]).find(record=>record.id===b.id),b);
  assert.equal(today.daily.eligibleCount,1);assert.equal(all(today)[0].storyKey,ranked[0].storyKey);
  assert.equal(JSON.stringify(records),before);
});

test('the compact top and every continuation page partition story keys without losing originals',()=>{
  const filler=Array.from({length:53},(_,index)=>card(100+index,`Controlled scientific publication ${index}`,{topic:'science',sourceIds:['news-science'],publisher:`Controlled publisher ${index}`}));
  const records=[...filler,a,b],selection=select(records),pages=[selection.first,...Array.from({length:Math.ceil(selection.more.length/20)},(_,index)=>selection.more.slice(index*20,index*20+20))];
  assert.ok(selection.more.length>20);
  const views=pages.flat(),keys=views.map(editionStoryKey);
  assert.equal(keys.length,54);assert.equal(new Set(keys).size,keys.length);
  assert.deepEqual(ids(views.flatMap(originals)),ids(records));
  const reordered=select([...records].reverse());
  assert.deepEqual(all(reordered).map(editionStoryKey),all(selection).map(editionStoryKey));
});

test('reader and contextual regrouping retain secondary publications and apply explicit queries first',()=>{
  for(const mode of ['briefing','records']){
    const reader=selectReadingCards([a,b],{...settings,mode},now);
    assert.equal(reader.availableGroups,1);assert.equal(reader.matchingRecords,2);assert.equal(reader.groupedVersions,0);
    assert.deepEqual(ids(originals(reader.cards[0])),ids([a,b]));assert.equal(reader.cards[0].grouping,'shared-event');
    const queried=selectReadingCards([a,b],{...settings,mode,query:'collapse'},now);
    assert.equal(queried.cards.length,1);assert.equal(queried.cards[0].card,b);assert.equal(queried.cards[0].related.length,0);
  }
  const contextual=rankContextualCards([a,b],{countryCode:null,topics:['environment'],query:'',budget:20},now);
  assert.equal(contextual.length,1);assert.equal(contextual[0].grouping,'shared-event');
  assert.deepEqual(ids(originals(contextual[0])),ids([a,b]));
});

test('publication grouping leaves software counters, individual record mode and notice exclusion intact',()=>{
  const release=(id,version)=>card(id,`Node.js ${version}`,{kind:'software-release',topic:'technology',sourceIds:['nodejs'],publisher:'Node.js',version,
    sourceUrl:`https://nodejs.org/en/blog/release/v${version}`,identity:`nodejs:${version}`});
  const first=release(20,'26.1.0'),second=release(21,'24.2.0');
  const award=card(22,'Contract award notice: climate reporting',{kind:'procurement-notice',topic:'opportunities',deadline:'2026-12-01'});
  const result=selectReadingCards([a,b,first,second,award],{...settings,topics:['environment','technology','opportunities']},now);
  assert.equal(result.cards.length,2);assert.equal(result.groupedVersions,1);assert.equal(result.excludedNotices,1);
  assert.equal(result.cards.find(view=>view.card.kind==='software-release').related.length,1);
  const records=selectReadingCards([first,second],{...settings,topics:['technology'],mode:'records'},now);
  assert.equal(records.cards.length,2);assert.equal(records.groupedVersions,0);
});

test('Explore chooses one supported city scope for a story also matching national and global coverage',()=>{
  const local=card(30,'COP31 talks: a new draft deal is on the table in Paris');
  const national=card(31,'France examines a new draft deal at COP31 talks');
  const global=card(32,b.title,{date:new Date(now-100_000).toISOString()});
  const records=[national,global,local],before=JSON.stringify(records);
  const selected=selectExploreCards(records,{city:paris,category:'environment'},now);
  assert.equal(selected.eligibleCount,3);assert.equal(selected.matchedCount,1);
  assert.equal(selected.local.length,1);assert.equal(selected.national.length,0);assert.equal(selected.world.length,0);
  assert.equal(selected.local[0].card,local);assert.equal(selected.local[0].explore.basis,'title');
  assert.deepEqual(ids(originals(selected.local[0])),ids(records));
  const worldwide=selectExploreCards(records,{city:null,category:'environment'},now);
  assert.equal(worldwide.world.length,1);assert.equal(worldwide.cards[0].storyKey,selected.cards[0].storyKey);
  assert.equal(JSON.stringify(records),before);
});

test('Explore can promote a matching related category while retaining the global story identity',()=>{
  const title='Paris opens an entirely new library in a modern waterfront district today';
  const culture=card(40,title,{topic:'culture',sourceIds:['news-culture']});
  const technology=card(41,title,{topic:'technology',sourceIds:['news-technology']});
  const ranked=rankEditorialCards([culture,technology],now);
  assert.equal(ranked.length,1);
  const selected=selectExploreCards([culture,technology],{city:paris,category:'technology'},now);
  assert.equal(selected.cards.length,1);assert.equal(selected.cards[0].card,technology);assert.equal(selected.cards[0].category,'technology');
  assert.equal(selected.cards[0].storyKey,ranked[0].storyKey);assert.deepEqual(ids(originals(selected.cards[0])),ids([culture,technology]));
});

test('shared story grouping preserves conflicts and each original freshness boundary',()=>{
  const conflict={...a,contentHash:'f'.repeat(64)},stale=card(51,a.title,{sourceState:'stale'}),expired=card(52,a.title,{observedAt:new Date(now-3_600_000).toISOString()});
  const records=[a,conflict,b,stale,expired];
  for(const views of [rankEditorialCards(records,now),all(select(records)),selectExploreCards(records,{city:null,category:null},now).cards]){
    assert.equal(views.length,1);assert.equal(views[0].card,b);assert.deepEqual(views[0].related,[]);
  }
  const contextual=rankContextualCards(records,{countryCode:null,topics:['environment'],query:'',budget:20},now);
  assert.equal(contextual.length,1);assert.equal(contextual[0].card,b);assert.deepEqual(contextual[0].related,[]);
});

test('LiveEdition does not manufacture updates or another slot when the same originals change representative',()=>{
  const initial=select([a,b]),group=all(initial)[0],single=rankEditorialCards([b],now)[0];
  const rotated={...initial,first:[{...single,storyKey:group.storyKey,grouping:group.grouping,related:[a]}],more:[]};
  assert.deepEqual(editionChanges(initial,rotated),{added:0,updated:0,removed:0,total:0});
  const live=new LiveEdition();live.present(initial,'global',now);
  const shown=live.present(rotated,'global',now+1_000);
  assert.equal(all(shown.selection).length,1);assert.equal(all(shown.selection)[0].card,b);assert.equal(shown.changes.total,0);
  assert.deepEqual(ids(originals(all(shown.selection)[0])),ids([a,b]));
});

test('an additional publisher is an updated existing story and remains staged until application',()=>{
  const initial=select([a]),expanded=select([a,b]),live=new LiveEdition();live.present(initial,'global',now);
  assert.deepEqual(editionChanges(initial,expanded),{added:0,updated:1,removed:0,total:1});
  const staged=live.present(expanded,'global',now);
  assert.equal(all(staged.selection).length,1);assert.deepEqual(ids(originals(all(staged.selection)[0])),[a.id]);
  assert.deepEqual(staged.changes,{added:0,updated:1,removed:0,total:1});
  const applied=live.present(expanded,'global',now,true);
  assert.equal(applied.changes.total,0);assert.deepEqual(ids(originals(all(applied.selection)[0])),ids([a,b]));
});

test('editing an original exact headline remains a staged update even when its derived key changes',()=>{
  const original=card(60,'Researchers identify unusual atmospheric patterns near the northern pole of Jupiter',{topic:'science',sourceIds:['news-science']});
  const edited={...original,title:'Researchers identify unusual atmospheric patterns near the southern pole of Jupiter'};
  const initial=select([original]),next=select([edited]);
  assert.notEqual(all(initial)[0].storyKey,all(next)[0].storyKey);
  assert.deepEqual(editionChanges(initial,next),{added:0,updated:1,removed:0,total:1});
  const live=new LiveEdition();live.present(initial,'global',now);
  const staged=live.present(next,'global',now);
  assert.equal(all(staged.selection)[0].card.title,original.title);assert.equal(staged.changes.updated,1);
});

test('expiry promotes a current original of the same story without renewing the expired article',()=>{
  const expiring={...a,observedAt:new Date(now-3_599_000).toISOString()},live=new LiveEdition();
  const first=select([expiring,b]);assert.equal(all(first)[0].card.id,a.id);live.present(first,'global',now);
  const next=live.present(select([expiring,b],now+1_000),'global',now+1_000);
  assert.equal(all(next.selection).length,1);assert.equal(all(next.selection)[0].card,b);assert.deepEqual(all(next.selection)[0].related,[]);
  assert.equal(next.changes.added,0);assert.equal(expiring.observedAt,new Date(now-3_599_000).toISOString());
});

test('an expired related source is removed independently while the primary remains current',()=>{
  const expiring={...b,observedAt:new Date(now-3_599_000).toISOString()},live=new LiveEdition();
  live.present(select([a,expiring]),'global',now);
  const next=live.present(select([a,expiring],now+1_000),'global',now+1_000);
  assert.equal(all(next.selection)[0].card,a);assert.deepEqual(all(next.selection)[0].related,[]);assert.equal(next.changes.total,0);
});

test('Daily comparison retains every grouped original and remains a valid bounded archive',()=>{
  const source={id:'news-environment',label:'Controlled news index',publisher:'Controlled publisher',topic:'environment',state:'verified',checkedAt:stamp,verifiedAt:stamp,
    count:2,rejected:0,error:null,retryAt:null,scope:'Controlled source check',termsUrl:'https://www.theguardian.com/',windowed:true};
  const snapshot={version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'test',mode:'current-source-records',generatedAt:stamp,state:'ready',sources:[source],
    cards:[a,b],conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:['environment']};
  const profile={cityId:null,topics:['environment'],query:'',budget:1,timezone:'UTC'},raw=JSON.stringify(snapshot);
  assert.equal(validTopicSnapshot(snapshot,now),true);
  const selected=selectDaily(profile,snapshot,null,null,[],now);
  assert.equal(selected.topicCount,1);assert.equal(selected.edition.records.length,1);assert.deepEqual(ids(selected.edition.comparison),ids([a,b]));
  assert.deepEqual(ids(originals(selected.items[0].topic)),ids([a,b]));assert.equal(validEdition(selected.edition,profile),true);
  const next=selectDaily(profile,snapshot,null,selected.edition,[],now);
  assert.equal(next.items[0].change,'same');assert.deepEqual(ids(next.edition.comparison),ids([a,b]));assert.equal(JSON.stringify(snapshot),raw);
});

const dailyProfile={cityId:null,topics:['environment'],query:'',budget:1,timezone:'UTC'};
function sourceSnapshot(records,at=now){
  const checkedAt=new Date(at).toISOString();
  const sources=[...new Set(records.flatMap(record=>record.sourceIds))].map(id=>{
    const sourceRecords=records.filter(record=>record.sourceIds.includes(id));
    return {id,label:'Controlled source',publisher:'Controlled publisher',topic:sourceRecords[0].topic,state:'verified',checkedAt,verifiedAt:checkedAt,
      count:sourceRecords.length,rejected:0,error:null,retryAt:null,scope:'Controlled source check',termsUrl:'https://www.theguardian.com/',windowed:true};
  });
  return {version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'test',mode:'current-source-records',generatedAt:checkedAt,state:'ready',sources,cards:records,
    conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:[...new Set(records.map(record=>record.topic))]};
}
const daily=(records,prior=null,feedback=[],at=now)=>selectDaily(dailyProfile,sourceSnapshot(records,at),null,prior,feedback,at);

test('Daily reports added coverage for a known story when a new publisher becomes primary',()=>{
  const first=daily([b]),next=daily([a,b],first.edition);
  assert.equal(next.items.length,1);assert.equal(next.items[0].topic.card,a);assert.equal(next.items[0].change,'coverage');
  assert.deepEqual(next.items[0].changes,[]);assert.equal(next.items.some(item=>item.change==='added'),false);
  assert.match(planDailyReading(next).summary,/additional publisher coverage/);
  assert.doesNotMatch(planDailyReading(next).summary,/not in the previous source check/);
});

test('Not today follows the thread across representative changes, saved round trips and new coverage until local midnight',()=>{
  const first=daily([b]),item=first.items[0];
  const feedback=[{id:item.id,signature:item.signature,action:'not-today',day:localDay(now,'UTC'),timezone:'UTC'}];
  const raw={version:DAILY_VERSION,revision:'11111111-1111-4111-8111-111111111111',profile:dailyProfile,edition:first.edition,feedback};
  const restored=parseDaily(JSON.parse(JSON.stringify(raw)));assert.ok(restored);assert.ok(item.signature.length<=24000);
  const current=daily([a,b],restored.edition,restored.feedback);
  assert.equal(current.topicCount,0);assert.equal(current.hidden,1);assert.deepEqual(ids(current.edition.comparison),ids([a,b]));
  const visible=daily([a,b],first.edition).items[0];assert.notEqual(visible.id,item.id);assert.equal(feedbackMatches(visible,feedback[0]),true);
  const tomorrow=now+86_400_000,checked=[a,b].map(card=>({...card,observedAt:new Date(tomorrow).toISOString()}));
  assert.equal(daily(checked,first.edition,restored.feedback,tomorrow).topicCount,1);
  const legacy=[{...feedback[0],signature:topicSignature(b)}];
  assert.equal(daily([a],first.edition,legacy).hidden,1,'legacy original feedback remains matchable through the saved comparison');
  assert.equal(JSON.stringify(raw.feedback),JSON.stringify(feedback),'selection performs no feedback migration or passive write');
});

test('a changed secondary publisher becomes the attributed Daily primary of the same story',()=>{
  const first=daily([a,b]),edited={...b,title:'COP31: BBC corrects earlier wording on the new draft deal',contentHash:'e'.repeat(64)};
  const next=daily([a,edited],first.edition);
  assert.equal(next.items.length,1);assert.equal(next.items[0].change,'different');assert.equal(next.items[0].topic.card,edited);
  assert.deepEqual(next.items[0].changes,[{field:'title',before:b.title,after:edited.title}]);
  assert.deepEqual(next.items[0].topic.related,[a]);assert.equal(next.items[0].topic.storyKey,first.items[0].topic.storyKey);
  const feedback=[{id:first.items[0].id,signature:first.items[0].signature,action:'not-today',day:localDay(now,'UTC'),timezone:'UTC'}];
  assert.equal(daily([a,edited],first.edition,feedback).hidden,1);
});

test('edition archives keep all originals under one bounded primary without enriching secondary sources',async()=>{
  const records=[a,b],before=JSON.stringify(records),edition=composeEdition(sourceSnapshot(records),{...settings,budget:1},now);
  assert.equal(edition.cards.length,1);assert.equal(edition.storyGroups.length,1);assert.equal(edition.storyGroups[0].primaryId,edition.cards[0].id);
  assert.deepEqual([edition.cards[0],...edition.storyGroups[0].related].sort((a,b)=>a.id.localeCompare(b.id)),records.map(copyCard).sort((a,b)=>a.id.localeCompare(b.id)));
  const read=[];const artifact=await prepareArtifact(edition,{read:async card=>{read.push(card.id);return emptyInsight(card,now,'unavailable','SOURCE_UNAVAILABLE');}});
  assert.equal(validArtifact(artifact),true);assert.doesNotThrow(()=>assertArtifact(artifact));
  assert.equal(artifact.insights.length,1);assert.ok(read.every(id=>id===edition.cards[0].id));assert.ok(read.length<=1);
  const html=artifactHtml(artifact),plain=artifactText(artifact),text=editionText(edition),document=parseDocument(html);
  assert.equal(DomUtils.findAll(node=>node.name==='article',document.children).length,1);
  assert.equal(DomUtils.findAll(node=>node.name==='h2',document.children).length,1);
  for(const original of records){assert.ok(html.includes(original.sourceUrl));assert.ok(plain.includes(original.title));assert.ok(plain.includes(original.sourceUrl));assert.ok(text.includes(original.title));}
  assert.match(plain,/not independent confirmations/);assert.equal(JSON.stringify(records),before);
});

test('artifact group validation rejects tampered membership, duplicate identities and unsafe related links',async()=>{
  const edition=composeEdition(sourceSnapshot([a,b]),{...settings,budget:1},now);
  const artifact=await prepareArtifact(edition,{read:async card=>emptyInsight(card,now,'unavailable','SOURCE_UNAVAILABLE')});
  for(const mutate of [
    value=>{value.edition.storyGroups[0].key='wrong-thread';},
    value=>{value.edition.storyGroups[0].primaryId='f'.repeat(24);},
    value=>{value.edition.storyGroups[0].related.push(value.edition.cards[0]);},
    value=>{value.edition.storyGroups[0].related[0].sourceUrl='javascript:alert(1)';},
    value=>{value.edition.storyGroups[0].related[0].title='A completely unrelated publication';},
    value=>{value.edition.storyGroups[0].basis='software-versions';},
  ]){
    const altered=structuredClone(artifact);mutate(altered);assert.equal(validArtifact(altered),false);assert.throws(()=>assertArtifact(altered),/EDITION_ARTIFACT_INVALID/);
  }
  const changed=structuredClone(artifact);changed.edition.storyGroups[0].related[0].title+=' as negotiations continue';
  assert.throws(()=>assertArtifact(changed),/EDITION_ARTIFACT_INVALID/,'related metadata is included in the existing digest');
  const legacy=composeEdition(sourceSnapshot([a]),{...settings,budget:1},now);assert.equal('storyGroups' in legacy,false);
  assert.equal(validArtifact(await prepareArtifact(legacy,{read:async card=>emptyInsight(card,now,'unavailable','SOURCE_UNAVAILABLE')})),true);
});

test('edition archive retains software versions without changing the primary budget or treating them as publications',async()=>{
  const releases=[card(70,'Node.js 26.1.0',{topic:'technology',kind:'software-release',sourceIds:['nodejs'],publisher:'Node.js',identity:'nodejs:v26.1.0',sourceUrl:'https://github.com/nodejs/node/releases/tag/v26.1.0',version:'v26.1.0'}),
    card(71,'Node.js 24.2.0',{topic:'technology',kind:'software-release',sourceIds:['nodejs'],publisher:'Node.js',identity:'nodejs:v24.2.0',sourceUrl:'https://github.com/nodejs/node/releases/tag/v24.2.0',version:'v24.2.0'})];
  const edition=composeEdition(sourceSnapshot(releases),{...settings,topics:['technology'],budget:1},now);
  assert.equal(edition.cards.length,1);assert.equal(edition.storyGroups[0].basis,'software-versions');assert.equal(edition.storyGroups[0].related.length,1);
  const artifact=await prepareArtifact(edition,{read:async card=>emptyInsight(card,now,'unavailable','SOURCE_UNAVAILABLE')});
  assert.equal(validArtifact(artifact),true);assert.match(artifactText(artifact),/Other listed software versions/);
  assert.ok(artifactHtml(artifact).includes(releases[1].sourceUrl));
});

test('discovery terms permit only an empty unsupported listing on the configured reviewed news scope',()=>{
  const listing=emptyInsight(a,now,'unsupported','FORMAT_NOT_REVIEWED');
  assert.equal(listing.termsUrl,'https://www.gdeltproject.org/about.html');assert.equal(validInsight(listing,a),true);
  const point={text:'A fabricated publisher passage.',section:'news',index:0,hash:'1'.repeat(64)};
  for(const patch of [
    {state:'ready',documentHash:'2'.repeat(64),points:[point],availablePoints:1},
    {state:'unavailable'},
    {points:[point],availablePoints:1},
    {availablePoints:1},
    {documentHash:'2'.repeat(64)},
    {introduction:'A generated summary'},
    {reason:'OTHER_SCOPE'},
    {termsUrl:'https://www.gdeltproject.org/about.html#publisher-license'},
    {termsUrl:'https://unreviewed.example/terms'},
    {cardId:b.id},
    {cardHash:'f'.repeat(64)},
    {checkedAt:'invalid-date'},
  ])assert.equal(validInsight({...listing,...patch},a),false,JSON.stringify(patch));
  for(const patch of [
    {sourceIds:['news-unreviewed-category']},
    {sourceIds:['editorial-frontpage']},
    {kind:'software-release'},
    {summary:'A publisher excerpt cannot use discovery terms as its licence.'},
    {sourceUrl:'https://unreviewed.example/story'},
  ]){
    const changed={...a,...patch};
    assert.equal(validInsight({...listing,sourceUrl:changed.sourceUrl},changed),false,JSON.stringify(patch));
  }
});

test('saved story display follows archive order and retains every original as a stale display copy without mutation',()=>{
  const records=[b,a],before=JSON.stringify(records),views=savedReadingCards(records,now);
  assert.equal(views.length,1);assert.equal(views[0].card.id,b.id);assert.equal(views[0].grouping,'shared-event');
  assert.deepEqual(originals(views[0]),records.map(card=>({...card,sourceState:'stale'})));
  assert.ok(originals(views[0]).every(card=>card.sourceState==='stale'));
  assert.equal(JSON.stringify(records),before);assert.equal(records[0].sourceState,'verified');
  assert.notEqual(views[0].card,b);assert.notEqual(views[0].related[0],a);
});

test('conflicting and repeated saved originals remain individually available instead of disappearing from the archive',()=>{
  const conflict={...a,contentHash:'f'.repeat(64),title:'A separately saved contradictory version'};
  const records=[a,conflict,b],before=JSON.stringify(records),views=savedReadingCards(records,now);
  assert.equal(views.length,3);assert.deepEqual(views.flatMap(originals),records.map(card=>({...card,sourceState:'stale'})));
  assert.equal(views[0].label,'Separate saved copy');assert.equal(views[1].label,'Separate saved copy');assert.equal(JSON.stringify(records),before);
  const repeated=savedReadingCards([a,a],now);
  assert.equal(repeated.flatMap(originals).length,2);assert.equal(repeated[1].label,'Separate saved copy');
});
