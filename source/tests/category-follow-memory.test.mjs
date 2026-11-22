import test from 'node:test';
import assert from 'node:assert/strict';
import {DeviceMemory,memoryError} from '../.build/src/iceo/device-memory.js';
import {CATEGORY_FOLLOW_KEY,selectCategoryFollowReturn,nextCategoryFollowDelay} from '../.build/src/iceo/category-follow.js';
import {captureCheckpoint} from '../.build/src/iceo/comparison.js';
import {EDITORIAL_CATEGORY_TOPICS} from '../.build/src/iceo/editorial-categories.js';

const now=Date.parse('2026-11-22T10:00:00.000Z'),stamp=new Date(now).toISOString();
const revision='11111111-1111-4111-8111-111111111111';
function card(category,number=1,patch={}){return{id:number.toString(16).padStart(24,'0'),identity:`article-${number}`,title:`Original verified ${category} listing`,topic:EDITORIAL_CATEGORY_TOPICS[category],kind:'publication',sourceUrl:`https://www.theguardian.com/world/2026/nov/22/article-${number}`,publisher:'The Guardian',sourceIds:[`news-${category}`],date:stamp,dateLabel:'Published',observedAt:stamp,contentHash:'a'.repeat(64),boundary:'Publisher metadata.',deadline:null,version:null,attribution:'The Guardian',sourceState:'verified',...patch};}
function snapshot(cards=[card('gaming')]){return{version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.46',mode:'current-source-records',generatedAt:stamp,state:'ready',cards,
  sources:[...new Set(cards.flatMap(item=>item.sourceIds))].map(id=>({id,label:id,publisher:'The Guardian',topic:EDITORIAL_CATEGORY_TOPICS[id.slice(5)],state:'verified',checkedAt:stamp,verifiedAt:stamp,count:cards.filter(item=>item.sourceIds.includes(id)).length,rejected:0,error:null,retryAt:null,scope:'Checked publisher listings',termsUrl:'https://www.theguardian.com/help/terms-of-service',windowed:true})),
  conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:[...new Set(cards.map(item=>item.topic))]};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let attempts=0;attempts<30&&!predicate();attempts++)await tick();assert.ok(predicate(),'Expected asynchronous transaction checkpoint');}

// Browser primitives only: shared serialized transactions, cloned values, commit and rollback.
// The production DeviceMemory methods implement validation, revision checks and follow changes.
function databaseFixture(initial={}){
  const data={meta:new Map(initial.meta??[]),saved:new Map(initial.saved??[])};
  const transactions=[],requests=[],committedWrites=[];let active=null,opens=0,failPut=null,holdNext=false,held=null;
  const queue=[];
  const clone=value=>value===undefined?undefined:structuredClone(value);
  const startNext=()=>{
    if(active)return;
    const next=queue.shift();if(!next)return;
    active=next;next.state='active';next.staged=Object.fromEntries(Object.entries(data).map(([name,values])=>[name,new Map([...values].map(([key,value])=>[key,clone(value)]))]));
    next.schedule();
  };
  const finish=tx=>{if(active===tx)active=null;queueMicrotask(startNext);};
  const database={
    close(){},
    transaction(stores,mode){
      const tx={stores,mode,state:'queued',error:null,staged:null,pending:[],writes:[],scheduled:false,hold:mode==='readwrite'&&holdNext,
        objectStore(name){
          assert.ok(stores.includes(name));
          const enqueue=(operation,key,value)=>{
            if(tx.state==='aborted'||tx.state==='committed')throw new DOMException('Inactive transaction','TransactionInactiveError');
            if(['put','delete','clear'].includes(operation)&&mode!=='readwrite')throw new DOMException('Readonly','ReadOnlyError');
            const request={result:undefined,error:null};tx.pending.push({operation,key,value:clone(value),name,request});tx.schedule();return request;
          };
          return{get:key=>enqueue('get',key),getAll:()=>enqueue('getAll'),put:(value,key=value.id)=>enqueue('put',key,value),delete:key=>enqueue('delete',key),clear:()=>enqueue('clear')};
        },
        abort(){
          if(tx.state==='aborted'||tx.state==='committed')throw new DOMException('Finished','InvalidStateError');
          tx.state='aborted';if(held===tx)held=null;
          queueMicrotask(()=>{tx.onabort?.();finish(tx);});
        },
        commit(){
          assert.equal(tx.state,'active');
          if(mode==='readwrite'){for(const name of stores)data[name]=tx.staged[name];committedWrites.push(...tx.writes);}
          tx.state='committed';if(held===tx)held=null;tx.oncomplete?.();finish(tx);
        },
        schedule(){
          if(tx.state!=='active'||tx.scheduled)return;tx.scheduled=true;
          setImmediate(()=>{
            tx.scheduled=false;if(tx.state!=='active')return;
            const request=tx.pending.shift();
            if(!request){if(tx.hold){held=tx;return;}tx.commit();return;}
            const {operation,key,value,name}=request;requests.push({operation,key,name,mode});
            try{
              const store=tx.staged[name];
              if(operation==='get')request.request.result=clone(store.get(key));
              else if(operation==='getAll')request.request.result=[...store.values()].map(clone);
              else{
                if(operation==='put'&&failPut){const failure=failPut;failPut=null;throw failure;}
                if(operation==='put')store.set(key,clone(value));else if(operation==='delete')store.delete(key);else store.clear();
                tx.writes.push({operation,key,name});
              }
              request.request.onsuccess?.();
            }catch(error){request.request.error=error;tx.error=error;request.request.onerror?.();tx.onerror?.();if(tx.state==='active')tx.abort();}
            tx.schedule();
          });
        },
      };
      if(mode==='readwrite')holdNext=false;
      transactions.push(tx);queue.push(tx);queueMicrotask(startNext);return tx;
    },
  };
  const factory={open(_name,version){assert.equal(version,1);opens++;const request={result:database,error:null};queueMicrotask(()=>request.onsuccess?.());return request;}};
  return{data,transactions,requests,committedWrites,factory,
    memory:()=>new DeviceMemory(()=>factory,()=>now),
    failNextPut(error=new DOMException('Full','QuotaExceededError')){failPut=error;},
    holdNextCommit(){holdNext=true;},
    get held(){return held;},
    release(){assert.ok(held);held.hold=false;held.commit();},
    get opens(){return opens;},
  };
}

test('invalid category/revision arguments fail before opening browser storage',async()=>{
  let opens=0;const memory=new DeviceMemory(()=>{opens++;throw Error('Must not open');});
  await assert.rejects(memory.setCategoryFollow('work-education',true,snapshot(),null),/CATEGORY_FOLLOW_DATA_INVALID/u);
  await assert.rejects(memory.setCategoryFollow('gaming','yes',snapshot(),null),/CATEGORY_FOLLOW_DATA_INVALID/u);
  await assert.rejects(memory.setCategoryFollow('gaming',true,snapshot(),'bad'),/CATEGORY_FOLLOW_DATA_INVALID/u);
  await assert.rejects(memory.acknowledgeCategoryFollow('gaming',snapshot(),'bad'),/CATEGORY_FOLLOW_DATA_INVALID/u);assert.equal(opens,0);
});

test('shared serialized CAS prevents lost follows across two tabs, and a refreshed explicit retry preserves both',async()=>{
  const fixture=databaseFixture(),first=fixture.memory(),second=fixture.memory(),current=snapshot([card('gaming'),card('family',2)]);
  const outcomes=await Promise.allSettled([first.setCategoryFollow('gaming',true,current,null),second.setCategoryFollow('family',true,current,null)]);
  assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,1);const failed=outcomes.find(item=>item.status==='rejected');assert.match(failed.reason.message,/CATEGORY_FOLLOW_CONCURRENT_UPDATE/u);
  const saved=await second.readCategoryFollows();assert.deepEqual(saved.entries.map(item=>item.category),['gaming']);
  const retried=await second.setCategoryFollow('family',true,current,saved.revision);assert.deepEqual(retried.entries.map(item=>item.category),['gaming','family']);
  assert.deepEqual(retried.entries[0],saved.entries[0]);assert.equal(fixture.committedWrites.length,2);assert.ok(fixture.committedWrites.every(item=>item.name==='meta'&&item.key===CATEGORY_FOLLOW_KEY));
});

test('a repeated desired state does not write or replace a baseline, and still enforces the revision lease',async()=>{
  const fixture=databaseFixture(),memory=fixture.memory(),saved=await memory.setCategoryFollow('gaming',true,snapshot(),null),writes=fixture.committedWrites.length;
  const repeated=await memory.setCategoryFollow('gaming',true,snapshot([card('gaming',1,{title:'Revised publisher metadata'})]),saved.revision);
  assert.deepEqual(repeated,saved);assert.equal(fixture.committedWrites.length,writes);
  await assert.rejects(memory.setCategoryFollow('gaming',true,snapshot(),null),/CATEGORY_FOLLOW_CONCURRENT_UPDATE/u);assert.equal(fixture.committedWrites.length,writes);
  const empty=await memory.setCategoryFollow('gaming',false,null,saved.revision);assert.equal(empty.entries.length,0);assert.notEqual(empty.revision,saved.revision);
  await assert.rejects(memory.setCategoryFollow('family',true,null,null),/CATEGORY_FOLLOW_CONCURRENT_UPDATE/u);
  const repeatRemoval=await memory.setCategoryFollow('gaming',false,null,empty.revision);assert.deepEqual(repeatRemoval,empty);assert.equal(fixture.committedWrites.length,writes+1);
});

test('read, return derivation, freshness expiry and absent follows perform no storage writes',async()=>{
  const fixture=databaseFixture(),memory=fixture.memory();assert.equal(await memory.readCategoryFollows(),null);assert.equal(fixture.committedWrites.length,0);
  const saved=await memory.setCategoryFollow('gaming',true,snapshot(),null),before=JSON.stringify(fixture.data.meta.get(CATEGORY_FOLLOW_KEY)),writes=fixture.committedWrites.length;
  for(const time of [now,now+60_000,now+3_600_001]){
    const current=await memory.readCategoryFollows();selectCategoryFollowReturn(current,snapshot(),time,true);nextCategoryFollowDelay(current,snapshot(),time);
    assert.equal(current.revision,saved.revision);assert.equal(JSON.stringify(fixture.data.meta.get(CATEGORY_FOLLOW_KEY)),before);
  }
  assert.equal(fixture.committedWrites.length,writes);assert.ok(fixture.transactions.slice(-3).every(tx=>tx.mode==='readonly'));
});

test('a successful follow is reported only after the transaction commits',async()=>{
  const fixture=databaseFixture(),memory=fixture.memory();fixture.holdNextCommit();let resolved=false;
  const operation=memory.setCategoryFollow('gaming',true,snapshot(),null).then(value=>{resolved=true;return value;});
  await until(()=>fixture.held!==null);assert.equal(resolved,false);assert.equal(fixture.data.meta.has(CATEGORY_FOLLOW_KEY),false);
  fixture.release();const saved=await operation;assert.equal(resolved,true);assert.equal(fixture.data.meta.get(CATEGORY_FOLLOW_KEY).revision,saved.revision);
});

test('quota failure rolls back follow and acknowledgement without altering previous categories',async()=>{
  const fixture=databaseFixture(),memory=fixture.memory(),saved=await memory.setCategoryFollow('gaming',true,snapshot(),null),before=structuredClone(fixture.data.meta.get(CATEGORY_FOLLOW_KEY));
  fixture.failNextPut();await assert.rejects(memory.setCategoryFollow('family',true,snapshot([card('gaming'),card('family',2)]),saved.revision),{name:'QuotaExceededError'});
  assert.deepEqual(fixture.data.meta.get(CATEGORY_FOLLOW_KEY),before);
  fixture.failNextPut();await assert.rejects(memory.acknowledgeCategoryFollow('gaming',snapshot([card('gaming',1,{title:'Revised gaming listing'})]),saved.revision),{name:'QuotaExceededError'});
  assert.deepEqual(fixture.data.meta.get(CATEGORY_FOLLOW_KEY),before);assert.match(memoryError(new DOMException('Full','QuotaExceededError')),/Nothing was saved/u);
});

test('corrupt follows and denied storage fail explicitly without silently replacing saved state',async()=>{
  const fixture=databaseFixture({meta:[[CATEGORY_FOLLOW_KEY,{version:'unknown',secret:'retain unchanged'}]]}),memory=fixture.memory();
  await assert.rejects(memory.readCategoryFollows(),/CATEGORY_FOLLOW_STORAGE_INVALID/u);await assert.rejects(memory.setCategoryFollow('gaming',true,snapshot(),null),/CATEGORY_FOLLOW_STORAGE_INVALID/u);
  assert.deepEqual(fixture.data.meta.get(CATEGORY_FOLLOW_KEY),{version:'unknown',secret:'retain unchanged'});assert.equal(fixture.committedWrites.length,0);
  const denied=new DeviceMemory(()=>{throw new DOMException('Blocked','SecurityError');});await assert.rejects(denied.readCategoryFollows(),{name:'SecurityError'});await assert.rejects(denied.setCategoryFollow('gaming',true,snapshot(),null),{name:'SecurityError'});
});

test('following preserves saved cards, focus, daily and legacy comparison; personal restore preserves follows; clear removes all reader memory',async()=>{
  const current=snapshot(),focus={version:1,savedAt:stamp,settings:{topics:['culture'],query:'Existing focus',budget:25,mode:'briefing'}},checkpoint=captureCheckpoint(current,now,revision);
  const fixture=databaseFixture({meta:[['focus',focus],['comparison',checkpoint],['daily','existing daily state']],saved:[[current.cards[0].id,{version:1,id:current.cards[0].id,savedAt:stamp,card:current.cards[0]}]]}),memory=fixture.memory();
  const saved=await memory.setCategoryFollow('gaming',true,current,null);
  assert.deepEqual(fixture.data.meta.get('focus'),focus);assert.deepEqual(fixture.data.meta.get('comparison'),checkpoint);assert.equal(fixture.data.meta.get('daily'),'existing daily state');assert.equal(fixture.data.saved.size,1);
  const publicRead=await memory.read();assert.deepEqual(Object.keys(publicRead).sort(),['cards','focus','rejected']);assert.equal(publicRead.cards.length,1);
  await memory.restorePersonal({focus:null,cards:[],checkpoint:null});assert.deepEqual(await memory.readCategoryFollows(),saved);assert.equal(fixture.data.meta.get('daily'),'existing daily state');
  assert.equal(fixture.data.meta.has('focus'),false);assert.equal(fixture.data.meta.has('comparison'),false);assert.equal(fixture.data.saved.size,0);
  await memory.clear();assert.equal(await memory.readCategoryFollows(),null);assert.equal(fixture.data.meta.size,0);assert.equal(fixture.data.saved.size,0);
});

test('acknowledgement changes only the chosen baseline and rejects stale concurrent or future observations',async()=>{
  const fixture=databaseFixture(),memory=fixture.memory(),current=snapshot([card('gaming'),card('education',2)]);
  const first=await memory.setCategoryFollow('gaming',true,current,null),both=await memory.setCategoryFollow('education',true,current,first.revision);
  const changed=snapshot([card('gaming',1,{title:'Revised gaming original'}),card('education',2,{title:'Revised education original'})]);
  const next=await memory.acknowledgeCategoryFollow('gaming',changed,both.revision);
  assert.deepEqual(next.entries.find(item=>item.category==='education'),both.entries.find(item=>item.category==='education'));
  assert.equal(selectCategoryFollowReturn(next,changed,now,true).updatedCount,1);
  await assert.rejects(memory.acknowledgeCategoryFollow('education',changed,both.revision),/CATEGORY_FOLLOW_CONCURRENT_UPDATE/u);
  const future={...changed,sources:changed.sources.map(item=>({...item,verifiedAt:new Date(now+300001).toISOString()}))};
  await assert.rejects(memory.acknowledgeCategoryFollow('gaming',future,next.revision),/SOURCE_CHECK_REQUIRED/u);assert.deepEqual(await memory.readCategoryFollows(),next);
});
