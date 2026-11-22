import test from 'node:test';import assert from 'node:assert/strict';
import{captureCheckpoint,compareCheckpoint,parseCheckpoint,metadataChanges,COMPARISON_MAX_AGE_MS}from'../.build/src/iceo/comparison.js';
import{contextForCard}from'../.build/src/iceo/context.js';
const now=Date.parse('2026-11-14T14:00:00.000Z');const stamp=new Date(now).toISOString();
const rev='11111111-1111-4111-8111-111111111111';
const card={id:'a'.repeat(24),identity:'https://github.com/nodejs/node/releases/tag/v22.1.0',title:'Node.js v22.1.0',topic:'technology',kind:'software-release',sourceUrl:'https://github.com/nodejs/node/releases/tag/v22.1.0',publisher:'Node.js maintainers',sourceIds:['nodejs'],date:'2026-11-13T09:00:00.000Z',dateLabel:'Published',observedAt:stamp,contentHash:'b'.repeat(64),boundary:'Publisher listing.',deadline:null,version:'v22.1.0',attribution:'Node.js',sourceState:'verified'};
const source={id:'nodejs',label:'Node.js',publisher:'Node.js maintainers',topic:'technology',state:'verified',checkedAt:stamp,verifiedAt:stamp,count:1,rejected:0,error:null,retryAt:null,scope:'Last 30 releases',termsUrl:'https://github.com/nodejs/node/blob/main/LICENSE',windowed:true};
const snap=(cards=[card],sources=[{...source,count:cards.length}])=>({version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.4',mode:'current-official-records',generatedAt:stamp,state:'ready',sources,cards,conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:['technology']});
const base=()=>captureCheckpoint(snap(),now,rev);
const second={...card,id:'c'.repeat(24),identity:'second',title:'Second listing',sourceUrl:'https://github.com/nodejs/node/releases/tag/v22.2.0',version:'v22.2.0'};
test('explicit baseline roundtrips only documented public data',()=>{const b=base();assert.deepEqual(parseCheckpoint({...b,secret:'omit'}),b);assert.equal('secret' in parseCheckpoint({...b,secret:'omit'}),false);});
test('same metadata has zero changes despite a later observation and new hash',()=>{const b=base();const result=compareCheckpoint(b,snap([{...card,observedAt:new Date(now+60000).toISOString(),contentHash:'e'.repeat(64)}]),now+60000);assert.equal(result.state,'complete');assert.equal(result.cards.length,0);assert.equal(result.unchanged,1);});
test('context object property order is transport-only through capture and comparison, including country property order',()=>{
  const context=contextForCard({sourceIds:['govuk-news']});
  const reordered={basis:context.basis,label:context.label,boundary:context.boundary,countries:context.countries.map(country=>({name:country.name,code:country.code}))};
  const original={...card,kind:'publication',topic:'world',sourceIds:['govuk-news'],sourceUrl:'https://www.gov.uk/government/news/example',context:reordered};
  const current={...snap([original],[{...source,id:'govuk-news',topic:'world'}]),coverage:['world']},before=JSON.stringify(current);
  const checkpoint=captureCheckpoint(current,now,rev);
  assert.notEqual(JSON.stringify(checkpoint.records[0].context),JSON.stringify(original.context));
  assert.deepEqual(checkpoint.records[0].context,original.context);
  assert.deepEqual(metadataChanges(checkpoint.records[0],original),[]);
  const result=compareCheckpoint(checkpoint,current,now);assert.equal(result.state,'complete');assert.equal(result.cards.length,0);assert.equal(result.unchanged,1);
  assert.equal(JSON.stringify(current),before);
});
test('semantic context changes remain visible for basis, label, boundary and country values or order',()=>{
  const context={countries:[{code:'FR',name:'France'},{code:'GB',name:'United Kingdom'}],basis:'publisher-category',label:'Publisher country categories',boundary:'Publisher categories, not an inferred event location.'};
  for(const [field,changed]of [
    ['basis',{...context,basis:'publisher-scope'}],['label',{...context,label:'Revised publisher country coverage'}],['boundary',{...context,boundary:'Revised source scope boundary.'}],
    ['countries',{...context,countries:[{code:'DE',name:'Germany'}]}],['country name',{...context,countries:[{code:'FR',name:'Revised country name'},context.countries[1]]}],
    ['country order',{...context,countries:[...context.countries].reverse()}],
  ]){
    const changes=metadataChanges({...card,context},{...card,context:changed});assert.equal(changes.length,1,field);assert.equal(changes[0].field,'context',field);
    assert.deepEqual(JSON.parse(changes[0].before),context,field);assert.deepEqual(JSON.parse(changes[0].after),changed,field);
  }
  const added=metadataChanges(card,{...card,context}),removed=metadataChanges({...card,context},card);
  assert.equal(added[0].before,null);assert.deepEqual(JSON.parse(added[0].after),context);assert.equal(removed[0].after,null);assert.deepEqual(JSON.parse(removed[0].before),context);
});
test('new-to-check listing is not claimed to be newly published',()=>{const result=compareCheckpoint(base(),snap([card,{...second,date:'2024-01-01T00:00:00.000Z'}]),now);assert.equal(result.cards.length,1);assert.equal(result.cards[0].kind,'not-in-saved-check');});
test('changed title preserves exact before and after even if hash unchanged',()=>{const r=compareCheckpoint(base(),snap([{...card,title:'Corrected title'}]),now);assert.deepEqual(r.cards[0].changes,[{field:'title',before:card.title,after:'Corrected title'}]);});
for(const field of ['date','dateLabel','deadline','version','sourceUrl','publisher'])test('exact change tracked: '+field,()=>{const after={...card,[field]:field==='date'||field==='deadline'?'2026-11-14':field==='sourceUrl'?'https://github.com/nodejs/node/releases/tag/v22.1.1':'Changed'};assert.equal(metadataChanges(card,after)[0].field,field);});
test('rolloff is not withdrawal and produces no deletion cards',()=>{const r=compareCheckpoint(base(),snap([]),now);assert.equal(r.cards.length,0);assert.equal(r.state,'complete');});
test('healthy empty source baseline can later detect a new listing',()=>{const b=captureCheckpoint(snap([]),now,rev);assert.equal(compareCheckpoint(b,snap(),now).cards.length,1);});
test('partial checks never produce a complete all-clear result',()=>{const s=snap([card],[{...source,state:'partial',rejected:2}]);s.state='partial';const b=captureCheckpoint(s,now,rev);assert.equal(compareCheckpoint(b,snap(),now).state,'partial');assert.equal(compareCheckpoint(base(),s,now).state,'partial');});
for(const state of ['unavailable','stale'])test(state+' source is not no-change',()=>{const s=snap([],[{...source,state,verifiedAt:null,count:0,error:'OFFLINE'}]);assert.equal(compareCheckpoint(base(),s,now).state,'unavailable');assert.throws(()=>captureCheckpoint(s,now,rev),/SOURCE_CHECK/);});
test('expired and future source observations are not eligible',()=>{for(const offset of [-COMPARISON_MAX_AGE_MS-1,300001]){const s=snap([card],[{...source,verifiedAt:new Date(now+offset).toISOString()}]);assert.throws(()=>captureCheckpoint(s,now,rev),/SOURCE_CHECK/);assert.equal(compareCheckpoint(base(),s,now).state,'unavailable');}});
test('changed source coverage cannot create artificial changes',()=>{const s=snap([second],[{...source,scope:'New window'}]);assert.equal(compareCheckpoint(base(),s,now).state,'unavailable');});
test('new source with no baseline is excluded, old source still works',()=>{const other={...source,id:'nextjs',label:'Next.js'};const extra={...second,sourceIds:['nextjs']};const r=compareCheckpoint(base(),snap([card,extra],[source,other]),now);assert.equal(r.state,'partial');assert.equal(r.cards.length,0);assert.equal(r.comparableSources,1);});
test('partial outage keeps working sources without marking full success',()=>{const b=captureCheckpoint(snap([card,{...second,sourceIds:['nextjs']}],[source,{...source,id:'nextjs'}]),now,rev);const s=snap([{...card,title:'Correction'}],[source,{...source,id:'nextjs',state:'unavailable',error:'OFFLINE',count:0,verifiedAt:null}]);const r=compareCheckpoint(b,s,now);assert.equal(r.state,'partial');assert.equal(r.cards.length,1);});
test('identity or duplicated records fail closed',()=>{assert.equal(parseCheckpoint({...base(),records:[card,card]}),null);assert.equal(compareCheckpoint(base(),snap([card,card]),now).state,'unavailable');assert.equal(compareCheckpoint(base(),snap([{...card,identity:'different'}]),now).state,'partial');});
test('catalog reconciliation conflict prevents baseline replacement',()=>{const s={...snap(),conflictCount:1};assert.throws(()=>captureCheckpoint(s,now,rev));assert.equal(compareCheckpoint(base(),s,now).state,'unavailable');});
test('stale source snapshot cannot move a baseline backwards',()=>{const b=base();const s=snap([card],[{...source,verifiedAt:new Date(now-1000).toISOString()}]);assert.equal(compareCheckpoint(b,s,now).state,'unavailable');});
test('counts must agree with accepted records',()=>{const s=snap([card],[{...source,count:10}]);assert.throws(()=>captureCheckpoint(s,now,rev));assert.equal(compareCheckpoint(base(),s,now).state,'unavailable');});
test('malformed stored checkpoint is rejected',()=>{for(const patch of [{version:2},{revision:'bad'},{savedAt:'2026-02-30T00:00:00.000Z'},{sources:[]},{records:[{...card,sourceUrl:'javascript:alert(1)'}]},{records:[{...card,sourceIds:['unknown']}]},{records:[{...card,sourceState:'stale'}]}])assert.equal(parseCheckpoint({...base(),...patch}),null);});
test('browser clock moved backwards does not claim caught up',()=>{assert.equal(compareCheckpoint(base(),snap(),now-300001).state,'unavailable');});
test('independent duplicate source listings do not duplicate change cards',()=>{const c={...card,sourceIds:['nodejs','mirror']};const s=snap([c],[source,{...source,id:'mirror'}]);const b=captureCheckpoint(s,now,rev);const r=compareCheckpoint(b,{...s,cards:[{...c,title:'Changed'}]},now);assert.equal(r.cards.length,1);});
