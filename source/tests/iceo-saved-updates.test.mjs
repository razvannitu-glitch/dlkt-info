import test from 'node:test';
import assert from 'node:assert/strict';
import {selectSavedUpdates,nextSavedUpdateDelay,SnapshotProgress} from '../.build/src/iceo/saved-updates.js';

const now=Date.parse('2026-11-20T16:00:00.000Z'),stamp=new Date(now).toISOString(),oldStamp=new Date(now-86400000).toISOString();
const card={id:'a'.repeat(24),identity:'https://www.ecb.europa.eu/ecb/jobsproc/tenders/html/example.en.html',title:'Contract notice: example',topic:'opportunities',kind:'procurement-notice',sourceUrl:'https://www.ecb.europa.eu/ecb/jobsproc/tenders/html/example.en.html',publisher:'European Central Bank',sourceIds:['ecb-procurement'],date:'2026-11-20T08:00:00.000Z',dateLabel:'Published',observedAt:stamp,contentHash:'b'.repeat(64),boundary:'Publisher listing.',deadline:'2026-11-30',version:null,attribution:'European Central Bank',sourceState:'verified',summary:'Applications must include the documents specified in the original notice.'};
const source={id:'ecb-procurement',label:'ECB procurement',publisher:'European Central Bank',topic:'opportunities',state:'verified',checkedAt:stamp,verifiedAt:stamp,count:1,rejected:0,error:null,retryAt:null,scope:'Current source listings',termsUrl:'https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html',windowed:true};
const saved=(patch={})=>({version:1,id:card.id,savedAt:oldStamp,card:{...card,observedAt:oldStamp,...patch}});
const snapshot=(cards=[card],sources=[{...source,count:cards.length}])=>({version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.46',mode:'current-official-records',generatedAt:stamp,state:'ready',sources,cards,conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:['opportunities']});
const compare=(before=saved(),after=card,sources)=>selectSavedUpdates([before],snapshot([after],sources),now,true);

test('existing saved schema is the immutable comparison baseline, without a checkpoint',()=>{
 const baseline=saved(),before=JSON.stringify(baseline),result=compare(baseline,{...card,deadline:'2026-12-02'});
 assert.equal(result.state,'complete');assert.equal(result.materialCount,1);assert.equal(result.wordingCount,0);
 assert.deepEqual(result.items[0].changes,[{field:'deadline',label:'Listed closing date',before:'2026-11-30',after:'2026-12-02'}]);
 assert.equal(JSON.stringify(baseline),before);assert.equal(result.items[0].saved.version,1);
});
test('title, publication date, observedAt, hash and publisher-only changes are not material alerts',()=>{
 const result=compare(saved(),{...card,title:'Updated title',date:'2026-11-20T15:00:00.000Z',dateLabel:'Updated',publisher:'Updated display name',contentHash:'c'.repeat(64)});
 assert.equal(result.materialCount,0);assert.equal(result.wordingCount,0);assert.equal(result.items[0].state,'unchanged');
});
test('equivalent deadline timestamps are not reported as different dates',()=>{
 const result=compare(saved(),{...card,deadline:'2026-11-30T00:00:00.000Z'});assert.equal(result.materialCount,0);
});
test('the clock passing a saved deadline does not create a publisher update',()=>{
 const result=compare(saved({deadline:'2026-11-19'}),{...card,deadline:'2026-11-19'});assert.equal(result.items[0].state,'unchanged');assert.equal(result.materialCount,0);
});
test('explicit cancellation and award types are material even with an unchanged deadline and excerpt',()=>{
 for(const title of ['Cancellation notice: example','Contract notice: cancelled example','Contract award notice: example','Procurement contract award notice: example']){
  const result=compare(saved(),{...card,title});assert.equal(result.materialCount,1,title);assert.equal(result.wordingCount,0);
  assert.deepEqual(result.items[0].changes,[{field:'notice-type',label:'Procedure notice type',before:'Contract notice',after:/award/iu.test(title)?'Contract award notice':'Cancellation notice'}]);
 }
});
test('cosmetic notice titles and clock-derived expiry do not become notice-type changes',()=>{
 assert.equal(compare(saved(),{...card,title:'Contract notice: updated descriptive wording'}).materialCount,0);
 assert.equal(compare(saved({title:'Contract award notice: first wording'}),{...card,title:'Contract award notice: corrected wording'}).materialCount,0);
 assert.equal(compare(saved({deadline:'2026-11-01'}),{...card,deadline:'2026-11-01'}).materialCount,0);
});
test('missing or newly introduced deadline fields are not inferred amendments',()=>{
 for(const [before,after]of [[null,'2026-11-30'],['2026-11-30',null]]){
  const result=compare(saved({deadline:before}),{...card,deadline:after});assert.equal(result.materialCount,0);assert.equal(result.state,'partial');
 }
});
test('same-identity software version changes are explicit, but a different document is not compared',()=>{
 const software={...card,kind:'software-release',topic:'technology',deadline:null,version:'v1.0.0'};
 const before={...saved(),card:{...software,observedAt:oldStamp}};
 const result=compare(before,{...software,version:'v1.0.1'},[{...source,topic:'technology'}]);assert.equal(result.items[0].changes[0].field,'version');
 const conflict=compare(before,{...software,identity:'different-release',version:'v1.0.1'},[{...source,topic:'technology'}]);assert.equal(conflict.items[0].state,'unavailable');assert.equal(conflict.materialCount,0);
});
test('unstructured publication fields cannot masquerade as structured material changes',()=>{
 const before=saved({kind:'publication',deadline:null,version:'one'}),result=compare(before,{...card,kind:'publication',deadline:'2026-12-02',version:'two'});
 assert.equal(result.materialCount,0);
});
test('publisher excerpt differences retain exact before and after without inferring significance',()=>{
 const result=compare(saved(),{...card,summary:'The publisher has revised the application instructions.'});
 assert.equal(result.materialCount,0);assert.equal(result.wordingCount,1);assert.equal(result.items[0].state,'changed');
 assert.deepEqual(result.items[0].wording,{before:card.summary,after:'The publisher has revised the application instructions.'});
});
test('whitespace-only excerpt changes do not create wording alerts',()=>{
 const result=compare(saved(),{...card,summary:card.summary.replaceAll(' ','  ')});assert.equal(result.wordingCount,0);
});
test('a repeated title is not treated as an informative excerpt or a wording revision',()=>{
 const before=saved({kind:'publication',deadline:null,summary:card.title});
 const result=compare(before,{...card,kind:'publication',deadline:null,title:'New title',summary:'New title'});
 assert.equal(result.materialCount,0);assert.equal(result.wordingCount,0);assert.equal(result.items[0].state,'not-comparable');
});
test('a disappeared excerpt is not an inferred cancellation or content change',()=>{
 const after={...card};delete after.summary;const result=compare(saved(),after);assert.equal(result.wordingCount,0);assert.equal(result.materialCount,0);assert.equal(result.state,'partial');
});
test('missing card in a verified rolling feed retains its saved copy with unknown current status',()=>{
 const result=selectSavedUpdates([saved()],snapshot([]),now,true);assert.equal(result.missingCount,1);assert.equal(result.items[0].state,'not-in-current-feed');assert.equal(result.materialCount,0);assert.match(result.items[0].note,/does not establish cancellation/);
});
test('a partial feed never turns absence into a no-change or resolved result',()=>{
 const result=selectSavedUpdates([saved()],{...snapshot([],[{...source,count:0,state:'partial',rejected:1}]),state:'partial'},now,true);
 assert.equal(result.state,'partial');assert.equal(result.items[0].state,'not-in-current-feed');assert.match(result.items[0].note,/status is unknown/);
});
test('verified present evidence can be compared while its source coverage remains partial',()=>{
 const result=compare(saved(),{...card,deadline:'2026-12-02'},[{...source,state:'partial',rejected:1}]);assert.equal(result.materialCount,1);assert.equal(result.state,'partial');
});
test('failed refresh cannot reuse a retained snapshot as a newly verified no-change result',()=>{
 const result=selectSavedUpdates([saved()],snapshot(),now,false);assert.equal(result.state,'unavailable');assert.equal(result.checkedCount,0);assert.equal(result.items[0].current,null);
});
test('stale, failed, future and regressed source checks do not produce updates',()=>{
 for(const patch of [{verifiedAt:new Date(now-3600001).toISOString()},{verifiedAt:new Date(now+300001).toISOString(),checkedAt:new Date(now+300001).toISOString()},{state:'unavailable',verifiedAt:null,error:'OFFLINE'},{verifiedAt:oldStamp},{checkedAt:oldStamp}]){
  const result=compare(saved(),{...card,deadline:'2026-12-02'},[{...source,...patch}]);assert.equal(result.items[0].state,'unavailable',JSON.stringify(patch));assert.equal(result.materialCount,0);
 }
});
test('a record observation older than the saved copy is rejected',()=>{
 const result=compare(saved(),{...card,observedAt:new Date(Date.parse(oldStamp)-1).toISOString(),deadline:'2026-12-02'});assert.equal(result.items[0].state,'unavailable');
});
test('clock reversal, stale card and changed source identity fail closed',()=>{
 assert.equal(compare({...saved(),savedAt:new Date(now+300001).toISOString()}).state,'unavailable');
 assert.equal(compare(saved(),{...card,sourceState:'stale'}).state,'unavailable');
 assert.equal(compare(saved(),{...card,sourceUrl:'https://www.ecb.europa.eu/other.html'}).state,'unavailable');
 assert.equal(compare(saved(),{...card,sourceIds:['other']},[{...source,id:'other'}]).state,'unavailable');
});
test('structural conflicts and incoherent source counts suppress the comparison',()=>{
 for(const value of [{...snapshot(),conflictCount:1},snapshot([card,card],[{...source,count:2}]),snapshot([card],[{...source,count:2}])])assert.equal(selectSavedUpdates([saved()],value,now,true).state,'unavailable');
});
test('saved updates use the full source corpus regardless of public top selection or topic preferences',()=>{
 const older={...card,date:'2026-11-01T08:00:00.000Z',deadline:'2026-12-02'};
 const result=compare(saved(),older);assert.equal(result.materialCount,1);assert.equal(result.items[0].current.date,older.date);
});
test('only reviewed multi-topic sources may support a different card topic',()=>{
 const publication={...card,kind:'publication',topic:'housing',deadline:null,sourceIds:['govuk-news']},before={...saved(),card:{...publication,observedAt:oldStamp}};
 const source={...snapshot().sources[0],id:'govuk-news',topic:'world'};
 assert.equal(compare(before,{...publication,summary:'Updated publisher excerpt.'},[source]).wordingCount,1);
 const unreviewed={...publication,sourceIds:['unreviewed']};assert.equal(compare({...before,card:{...unreviewed,observedAt:oldStamp}},unreviewed,[{...source,id:'unreviewed'}]).state,'unavailable');
});
test('no supported details remains explicit even when the headline is unchanged',()=>{
 const minimal={...card,kind:'publication',deadline:null};delete minimal.summary;
 const result=compare({...saved(),card:{...minimal,observedAt:oldStamp}},minimal);assert.equal(result.notComparableCount,1);assert.equal(result.state,'partial');assert.equal(result.items[0].state,'not-comparable');
});
test('expired snapshot generation cannot be revived by a later source timestamp',()=>{
 assert.equal(selectSavedUpdates([saved()],{...snapshot(),generatedAt:new Date(now-3600001).toISOString()},now,true).state,'unavailable');
});
test('saved evidence expiration includes records outside the daily edition',()=>{
 const value=snapshot([card],[{...source,verifiedAt:new Date(now-3590000).toISOString()}]);assert.equal(nextSavedUpdateDelay([saved()],value,now),10001);assert.equal(nextSavedUpdateDelay([],value,now),null);assert.equal(nextSavedUpdateDelay([saved()],null,now),null);
});
test('empty and malformed saved copies do not produce fabricated results',()=>{
 assert.equal(selectSavedUpdates([],snapshot(),now,true).state,'empty');assert.equal(selectSavedUpdates([{...saved(),version:2}],snapshot(),now,true).items.length,0);
});
test('a later arriving older response cannot erase a material change already displayed',()=>{
 const progress=new SnapshotProgress(),changed=snapshot([{...card,deadline:'2026-12-02'}]);
 assert.equal(progress.accept(changed,now),'accepted');
 const olderStamp=new Date(now-900000).toISOString(),older=snapshot([{...card,observedAt:olderStamp}],[{...source,verifiedAt:olderStamp,checkedAt:olderStamp}]);older.generatedAt=olderStamp;
 assert.equal(progress.accept(older,now),'regressed');
 assert.equal(selectSavedUpdates([saved()],changed,now,true).materialCount,1);
});
test('new envelope time cannot conceal a regressed source or record observation',()=>{
 const progress=new SnapshotProgress();assert.equal(progress.accept(snapshot(),now),'accepted');
 const olderStamp=new Date(now-900000).toISOString(),newerStamp=new Date(now+1000).toISOString();
 const olderSource={...snapshot([{...card,observedAt:olderStamp}],[{...source,verifiedAt:olderStamp,checkedAt:newerStamp}]),generatedAt:newerStamp};
 assert.equal(progress.accept(olderSource,now+1000),'regressed');
 const olderRecord={...snapshot([{...card,observedAt:olderStamp}],[{...source,verifiedAt:newerStamp,checkedAt:newerStamp}]),generatedAt:newerStamp};
 assert.equal(progress.accept(olderRecord,now+1000),'regressed');
});
test('source watermarks survive an outage and reject stale recovery',()=>{
 const progress=new SnapshotProgress();assert.equal(progress.accept(snapshot(),now),'accepted');
 const later=new Date(now+1000).toISOString(),outage={...snapshot([],[{...source,state:'unavailable',error:'OFFLINE',verifiedAt:null,checkedAt:later,count:0}]),state:'unavailable',generatedAt:later};
 assert.equal(progress.accept(outage,now+1000),'accepted');
 const olderStamp=new Date(now-900000).toISOString(),recovery={...snapshot([{...card,observedAt:olderStamp}],[{...source,verifiedAt:olderStamp,checkedAt:later}]),generatedAt:later};
 assert.equal(progress.accept(recovery,now+1000),'regressed');
 const fresh={...snapshot([{...card,observedAt:later}],[{...source,verifiedAt:later,checkedAt:later}]),generatedAt:later};
 assert.equal(progress.accept(fresh,now+1000),'accepted');
});
test('invalid future progress does not poison the subsequent legitimate source check',()=>{
 const progress=new SnapshotProgress(),future=new Date(now+300001).toISOString();
 assert.equal(progress.accept(snapshot([card],[{...source,verifiedAt:future,checkedAt:future}]),now),'invalid');
 assert.equal(progress.accept(snapshot(),now),'accepted');assert.equal(progress.accept(snapshot(),now),'accepted');
});
test('reconciled duplicates use their freshest contributing source without requiring equal source timestamps',()=>{
 const other={...source,id:'fixture-second',verifiedAt:new Date(now-1000).toISOString()};
 const current={...card,sourceIds:[source.id,other.id],deadline:'2026-12-02'},before={...saved(),card:{...saved().card,sourceIds:[source.id,other.id]}};
 const value=snapshot([current],[source,other]),progress=new SnapshotProgress();
 assert.equal(progress.accept(value,now),'accepted');
 const result=selectSavedUpdates([before],value,now,true);assert.equal(result.materialCount,1);assert.equal(result.items[0].checkedAt,stamp);assert.equal(result.state,'complete');
 const partial=snapshot([current],[source,{...other,state:'unavailable',verifiedAt:null,error:'OFFLINE'}]);
 const partialResult=selectSavedUpdates([before],partial,now,true);assert.equal(partialResult.materialCount,1);assert.equal(partialResult.state,'partial');
 const unsupported=snapshot([{...current,observedAt:new Date(now+1).toISOString()}],[source,other]);assert.equal(new SnapshotProgress().accept(unsupported,now),'invalid');
});
