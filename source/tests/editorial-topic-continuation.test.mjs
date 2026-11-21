import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {selectDaily} from '../.build/src/daily/selection.js';
import {nextReadingBoundary} from '../.build/src/daily/reading.js';
import {composeEdition} from '../.build/src/edition/compose.js';
import {captureCheckpoint,compareFocusedCheckpoint,focusedSnapshot,parseCheckpoint} from '../.build/src/iceo/comparison.js';
import {nextReturnDelay,selectReturnBrief} from '../.build/src/iceo/return-brief.js';
import {sourceMatchesCardTopic,sourceRelevantToTopics} from '../.build/src/iceo/source-relevance.js';

// Controlled metadata tests; these are not evidence of current Council publications.
const now=Date.parse('2026-11-20T14:00:00.000Z'),stamp=new Date(now).toISOString();
const revision='11111111-1111-4111-8111-111111111111';
const hash=value=>createHash('sha256').update(value).digest('hex');
const card=(id,topic='sport',extra={})=>({
 id:hash(id).slice(0,24),identity:`https://www.consilium.europa.eu/en/press/controlled-${id}`,
 title:`Controlled ${topic} publication ${id}`,topic,kind:'publication',sourceUrl:`https://www.consilium.europa.eu/en/press/controlled-${id}`,
 publisher:'Council of the European Union',sourceIds:['eu-council'],date:'2026-11-20T12:00:00.000Z',dateLabel:'Updated',observedAt:stamp,
 contentHash:hash('body-'+id),boundary:'Controlled publisher metadata.',deadline:null,version:null,attribution:'Council of the European Union',sourceState:'verified',...extra,
});
const health={id:'eu-council',label:'Council feed',publisher:'Council of the European Union',topic:'regulation',state:'verified',checkedAt:stamp,verifiedAt:stamp,count:0,rejected:0,error:null,retryAt:null,scope:'Controlled multi-subject feed.',termsUrl:'https://www.consilium.europa.eu/en/about-site/copyright/',windowed:true};
const catalog=(cards=[card('sport'),card('health','health')],patch={})=>({
 version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.46',mode:'current-official-records',generatedAt:stamp,state:'ready',
 sources:[{...health,count:cards.length}],cards,conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,
 coverage:[...new Set(cards.map(value=>value.topic))],...patch,
});
const profile={cityId:null,topics:['sport'],query:'',budget:30,timezone:'UTC'};
const settings={topics:['sport'],query:'',budget:30,mode:'briefing'};

test('a sport-only personal edition includes an actual sport card from a reviewed regulation feed',()=>{
 const snapshot=catalog(),before=JSON.stringify(snapshot);
 const result=selectDaily(profile,snapshot,null,null,[],now);
 assert.equal(result.edition.topicState,'ready');assert.equal(result.edition.complete,true);
 assert.deepEqual(result.edition.records.map(value=>value.topic),['sport']);
 assert.deepEqual(result.edition.comparison.map(value=>value.topic),['sport']);
 assert.equal(JSON.stringify(snapshot),before);
});

test('prepared sport-only artifacts retain the referenced source and omit its unrelated health record',()=>{
 const result=composeEdition(catalog(),settings,now);
 assert.equal(result.state,'ready');assert.equal(result.cards.length,1);assert.equal(result.cards[0].topic,'sport');
 assert.deepEqual(result.sourceChecks.map(value=>value.id),['eu-council']);
 assert.equal(result.excludedStale,0);
});

test('a selected editorial source outage never becomes an empty successful personal or prepared edition',()=>{
 const snapshot=catalog(undefined,{state:'partial',sources:[{...health,count:2,state:'unavailable',error:'SOURCE_OFFLINE',verifiedAt:null}]});
 const personal=selectDaily(profile,snapshot,null,null,[],now),prepared=composeEdition(snapshot,settings,now);
 assert.equal(personal.edition.topicState,'unavailable');assert.equal(personal.edition.complete,false);assert.equal(personal.topicCount,0);
 assert.equal(prepared.state,'unavailable');assert.equal(prepared.cards.length,0);
});

test('cross-topic permission stays restricted to reviewed sources and real source-ID linkage',()=>{
 const c=card('sport');
 assert.equal(sourceMatchesCardTopic(health,c),true);
 assert.equal(sourceMatchesCardTopic({...health,id:'unreviewed'},c),false);
 assert.equal(sourceRelevantToTopics(health,['sport'],[card('health','health')]),false);
 const forged=card('sport','sport',{sourceIds:['unreviewed']}),snapshot=catalog([forged],{sources:[{...health,id:'unreviewed',count:1}]});
 assert.equal(selectDaily(profile,snapshot,null,null,[],now).topicCount,0);
 assert.equal(composeEdition(snapshot,settings,now).state,'unavailable');
 assert.throws(()=>focusedSnapshot(snapshot,['sport']),/SOURCE_CHECK_REQUIRED/);
});

test('focused checkpoints preserve the selected editorial topic and project validated source counts',()=>{
 const snapshot=catalog(),before=JSON.stringify(snapshot),focused=focusedSnapshot(snapshot,['sport']);
 assert.equal(focused.sources[0].topic,'regulation');assert.equal(focused.sources[0].count,1);
 assert.deepEqual(focused.cards.map(value=>value.topic),['sport']);
 const saved=captureCheckpoint(focused,now,revision);
 assert.deepEqual(saved.topics,['sport']);assert.deepEqual(parseCheckpoint(saved),saved);
 assert.equal(JSON.stringify(snapshot),before);
 const bad=catalog(undefined,{sources:[{...health,count:99}]});
 assert.throws(()=>focusedSnapshot(bad,['sport']),/SOURCE_CHECK_REQUIRED/);
 const forged={...saved,sources:saved.sources.map(value=>({...value,id:'unreviewed'})),records:saved.records.map(value=>({...value,sourceIds:['unreviewed']}))};
 assert.equal(parseCheckpoint(forged),null);
});

test('return comparison detects sport changes without opting into regulation or health',()=>{
 const saved=captureCheckpoint(focusedSnapshot(catalog(),['sport']),now,revision);
 const current=catalog([card('sport','sport',{title:'Corrected sport heading'}),card('health','health',{title:'Changed health heading'})]);
 const compared=compareFocusedCheckpoint(saved,current,['sport'],now),brief=selectReturnBrief(saved,current,now,true);
 assert.equal(compared.state,'complete');assert.equal(compared.cards.length,1);assert.equal(compared.cards[0].card.topic,'sport');
 assert.equal(brief.state,'complete');assert.deepEqual(brief.topics,['sport']);assert.equal(brief.updatedCount,1);assert.equal(brief.omittedLegacy,false);
 assert.equal(compareFocusedCheckpoint(saved,current,['health'],now).state,'unavailable');
});

test('feed rolloff keeps source continuity and never creates a removal or fresh publication claim',()=>{
 const saved=captureCheckpoint(focusedSnapshot(catalog(),['sport']),now,revision),current=catalog([card('health','health')]);
 const compared=compareFocusedCheckpoint(saved,current,['sport'],now);
 assert.equal(compared.state,'complete');assert.equal(compared.cards.length,0);assert.equal(compared.comparableSources,1);
 const brief=selectReturnBrief(saved,current,now,true);assert.deepEqual(brief.topics,['sport']);assert.equal(brief.newCount+brief.updatedCount,0);
 const prior=selectDaily(profile,catalog(),null,null,[],now).edition;
 const personal=selectDaily(profile,current,null,prior,[],now);assert.equal(personal.edition.topicState,'ready');assert.equal(personal.topicCount,0);
});

test('an explicitly refreshed empty sport checkpoint retains sport when the next listing arrives',()=>{
 const first=captureCheckpoint(focusedSnapshot(catalog(),['sport']),now,revision),empty=catalog([card('health','health')]);
 const saved=captureCheckpoint(focusedSnapshot(empty,['sport'],first.records),now,revision);
 assert.deepEqual(saved.topics,['sport']);assert.equal(saved.records.length,0);assert.equal(saved.sources[0].recordCount,0);
 const next=compareFocusedCheckpoint(saved,catalog(),['sport'],now);
 assert.equal(next.state,'complete');assert.equal(next.cards.length,1);assert.equal(next.cards[0].kind,'not-in-saved-check');
 assert.deepEqual(selectReturnBrief(saved,catalog(),now,true).topics,['sport']);
});

test('editorial source expiry participates in personal and return render timers',()=>{
 const snapshot=catalog(undefined,{sources:[{...health,count:2,verifiedAt:new Date(now-3_599_000).toISOString()}]});
 assert.equal(nextReadingBoundary(profile,snapshot,null,now),now+1001);
 assert.equal(nextReturnDelay(snapshot,['sport'],now),1001);
 const fresh=selectDaily(profile,snapshot,null,null,[],now);assert.equal(fresh.topicCount,1);
 assert.equal(selectDaily(profile,snapshot,null,null,[],now+1001).edition.topicState,'unavailable');
});
