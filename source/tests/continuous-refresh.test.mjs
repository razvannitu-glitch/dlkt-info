import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {ContinuousSnapshotService,validDailySnapshot,CONTINUOUS_PUBLIC_CACHE_MS} from '../.build/src/iceo/daily-cache.js';
import {createRefreshLedger,publicSnapshotDigest,CONTINUOUS_REFRESH_INTERVAL_MS,validRefreshTrigger} from '../.build/src/iceo/refresh-ledger.js';
import {handleIceoRefresh,refreshRequestTrigger} from '../.build/api/iceo-refresh.js';
import {handleIceo} from '../.build/api/iceo.js';
import {IceoEngine} from '../.build/src/iceo/engine.js';
import {ICEO_SOURCES} from '../.build/src/iceo/registry.js';

const START=Date.parse('2026-11-21T12:00:00.000Z');
const iso=value=>new Date(value).toISOString();
const clone=value=>structuredClone(value);
function snapshot(now=START){
  const card={id:'b'.repeat(24),identity:'https://www.nasa.gov/continuous-test/',title:'Controlled science publication',topic:'science',kind:'publication',
    sourceUrl:'https://www.nasa.gov/continuous-test/',publisher:'NASA',sourceIds:['nasa'],date:iso(now-3_600_000),dateLabel:'Published',observedAt:iso(now),
    contentHash:createHash('sha256').update('controlled').digest('hex'),boundary:'Controlled fixture only.',deadline:null,version:null,attribution:'NASA',sourceState:'verified'};
  return {version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.46',mode:'current-source-records',generatedAt:iso(now),state:'ready',
    sources:[{id:'nasa',label:'NASA',publisher:'NASA',topic:'science',state:'verified',checkedAt:iso(now),verifiedAt:iso(now),count:1,rejected:0,error:null,retryAt:null,
      scope:'Controlled source.',termsUrl:'https://www.nasa.gov/nasa-brand-center/',windowed:true}],cards:[card],conflictCount:0,duplicateCount:0,
    deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:['science']};
}
const empty=()=>({version:'iceo-shared-snapshot-1',snapshot:null,digest:null,revision:0,refreshedAt:null,lastAttemptAt:null,lastScheduledAttemptAt:null,lastScheduledSuccessAt:null,status:'empty',retryAt:null});
const manual={kind:'manual'};
const scheduled=(now=START)=>({kind:'scheduled',executionId:'exec_controlled',scheduleName:'iceo-daily-top',scheduledAt:iso(now),namespace:'default',expression:'*/2 * * * *'});

/** Test double models the server contract; SQL fencing is independently tested against PostgreSQL. */
class Ledger{
  writable=true; now=START; envelope=empty(); lease=null; fence=0; completeSlot=null; reads=0; claims=0; publishes=0; failures=[];
  async read(){this.reads++;return clone(this.envelope);}
  async claim(_worker,trigger){
    this.claims++;const slot=Math.floor(this.now/CONTINUOUS_REFRESH_INTERVAL_MS);
    const shape=state=>({version:'iceo-refresh-claim-1',state,slot,fence:this.fence,leaseToken:null,leaseExpiresAt:null,retryAt:this.envelope.retryAt});
    if(this.lease&&Date.parse(this.lease.claim.leaseExpiresAt)>this.now)return shape('busy');
    if(this.completeSlot===slot)return shape('complete');
    if(this.envelope.retryAt&&Date.parse(this.envelope.retryAt)>this.now)return shape('backoff');
    this.fence++;
    const claim={...shape('claimed'),fence:this.fence,leaseToken:`00000000-0000-4000-8000-${String(this.fence).padStart(12,'0')}`,leaseExpiresAt:iso(this.now+90_000)};
    this.lease={claim,trigger};this.envelope.lastAttemptAt=iso(this.now);this.envelope.status='refreshing';
    if(trigger.kind==='scheduled')this.envelope.lastScheduledAttemptAt=iso(this.now);
    return clone(claim);
  }
  async publish(claim,value,digest){
    if(!this.lease||claim.fence!==this.lease.claim.fence||claim.leaseToken!==this.lease.claim.leaseToken||Date.parse(claim.leaseExpiresAt)<=this.now)throw Error('FENCED');
    this.publishes++;this.completeSlot=claim.slot;
    this.envelope={...this.envelope,snapshot:clone(value),digest,revision:this.envelope.revision+1,refreshedAt:iso(this.now),status:'ready',retryAt:null,
      lastScheduledSuccessAt:this.lease.trigger.kind==='scheduled'?iso(this.now):this.envelope.lastScheduledSuccessAt};
    this.lease=null;return clone(this.envelope);
  }
  async fail(claim,error){
    this.failures.push(error);
    if(!this.lease||claim.fence!==this.lease.claim.fence)return {recorded:false,retryAt:this.envelope.retryAt};
    this.lease=null;this.envelope.status='backoff';this.envelope.retryAt=iso(this.now+30_000);return {recorded:true,retryAt:this.envelope.retryAt};
  }
  seed(value=snapshot()){this.envelope={...empty(),snapshot:clone(value),digest:publicSnapshotDigest(value),revision:1,refreshedAt:value.generatedAt,status:'ready'};}
}
class Cache{entries=new Map();async read(key){return clone(this.entries.get(key));}async write(key,value){this.entries.set(key,clone(value));}}
const response=()=>({statusCode:0,headers:{},body:'',setHeader(k,v){this.headers[k]=v;},end(body=''){this.body=body;}});

test('public concurrent cold reads use one durable read and never acquire upstream sources',async()=>{
  const ledger=new Ledger();let sourceCalls=0;
  const service=new ContinuousSnapshotService(ledger,async()=>{sourceCalls++;return snapshot();},new Cache(),()=>ledger.now);
  const outcomes=await Promise.allSettled(Array.from({length:30},()=>service.snapshot()));
  assert.ok(outcomes.every(row=>row.status==='rejected'));assert.equal(ledger.reads,1);assert.equal(sourceCalls,0);assert.equal(ledger.claims,0);
  ledger.seed();const rows=await Promise.all(Array.from({length:30},()=>service.snapshot()));
  assert.equal(ledger.reads,2);assert.equal(sourceCalls,0);assert.ok(rows.every(row=>row.generatedAt===iso(START)));
});

test('runtime cache eviction and outage fall back only to durable public read',async()=>{
  const ledger=new Ledger();ledger.seed();let sources=0;
  const cache={async read(){throw Error('offline');},async write(){throw Error('offline');}};
  const service=new ContinuousSnapshotService(ledger,async()=>{sources++;return snapshot();},cache,()=>ledger.now);
  assert.equal((await service.read()).collection.revision,1);ledger.now+=CONTINUOUS_PUBLIC_CACHE_MS+1;
  assert.equal((await service.snapshot()).generatedAt,iso(START));assert.equal(ledger.reads,2);assert.equal(sources,0);
});

test('two workers compete for one durable lease and duplicate slot never recollects',async()=>{
  const ledger=new Ledger();let calls=0,release,start;
  const begun=new Promise(resolve=>{start=resolve;});
  const collector=async()=>{calls++;start();return new Promise(resolve=>{release=resolve;});};
  const first=new ContinuousSnapshotService(ledger,collector,null,()=>ledger.now),second=new ContinuousSnapshotService(ledger,collector,null,()=>ledger.now);
  const pending=first.refresh(scheduled());await begun;
  const busy=await second.refresh(scheduled());assert.equal(busy.state,'busy');assert.equal(busy.persistedReadback,false);assert.equal(calls,1);
  release(snapshot());const receipt=await pending;assert.equal(receipt.state,'published');assert.equal(receipt.persistedReadback,true);
  assert.equal(receipt.lastScheduledSuccessAt,iso(START));assert.equal(receipt.selectedCount,1);assert.equal(receipt.minimumMet,false);
  assert.equal((await second.refresh(scheduled())).state,'complete');assert.equal(calls,1);assert.equal(ledger.publishes,1);
});

test('rollover collects again and preserves source publication dates',async()=>{
  const ledger=new Ledger();let calls=0;
  const service=new ContinuousSnapshotService(ledger,async()=>{calls++;const value=snapshot(ledger.now);value.cards[0].date=iso(START-3_600_000);return value;},null,()=>ledger.now);
  await service.refresh(scheduled());ledger.now+=120_000;await service.refresh(scheduled(ledger.now));
  assert.equal(calls,2);assert.equal(ledger.envelope.revision,2);assert.equal(ledger.envelope.snapshot.cards[0].date,iso(START-3_600_000));
  assert.equal(ledger.envelope.snapshot.cards[0].observedAt,iso(ledger.now));
});

test('expired fenced worker cannot replace the later published snapshot',async()=>{
  const ledger=new Ledger();const old=await ledger.claim('controlled',manual);ledger.now+=120_000;
  const current=await ledger.claim('controlled2',manual),value=snapshot(ledger.now);
  await ledger.publish(current,value,publicSnapshotDigest(value));
  await assert.rejects(ledger.publish(old,snapshot(),publicSnapshotDigest(snapshot())),/FENCED/u);
  assert.equal(ledger.envelope.snapshot.generatedAt,iso(ledger.now));
});

test('failed source check retains dated catalog, records backoff and cannot claim a scheduled success',async()=>{
  const ledger=new Ledger();ledger.seed();ledger.now+=120_000;
  const service=new ContinuousSnapshotService(ledger,async()=>{throw Error('source outage');},null,()=>ledger.now);
  await assert.rejects(service.refresh(scheduled(ledger.now)),/source outage/u);
  assert.equal(ledger.envelope.snapshot.generatedAt,iso(START));assert.equal(ledger.envelope.refreshedAt,iso(START));
  assert.equal(ledger.envelope.lastScheduledSuccessAt,null);assert.equal(ledger.envelope.status,'backoff');
  assert.equal((await service.refresh(scheduled(ledger.now))).state,'backoff');assert.equal(ledger.publishes,0);
  assert.equal((await service.read()).collection.status,'backoff');
});

test('no verified current source and private extra fields are rejected before publication',async()=>{
  for(const mutate of [value=>{value.account={id:'private'};},value=>{value.sources[0].token='private';},value=>{value.sources[0].verifiedAt=iso(START-600_000);},value=>{value.state='unavailable';}]){
    const ledger=new Ledger(),value=snapshot();mutate(value);
    await assert.rejects(new ContinuousSnapshotService(ledger,async()=>value,null,()=>START).refresh(),/CONTINUOUS_SNAPSHOT_INVALID/u);
    assert.equal(ledger.publishes,0);assert.deepEqual(ledger.failures,['invalid-snapshot']);
  }
});

test('durable invalid or expired snapshots never trigger visitor-side repair',async()=>{
  for(const mutate of [ledger=>{ledger.envelope.snapshot.account={private:true};},ledger=>{ledger.envelope.digest='f'.repeat(64);},ledger=>{ledger.now+=3_600_001;},ledger=>{ledger.envelope.writerKey='private';}]){
    const ledger=new Ledger();ledger.seed();mutate(ledger);let calls=0;
    const service=new ContinuousSnapshotService(ledger,async()=>{calls++;return snapshot();},null,()=>ledger.now);
    await assert.rejects(service.snapshot(),/CONTINUOUS_SNAPSHOT_UNAVAILABLE/u);assert.equal(calls,0);
  }
});

test('canonical digest survives JSONB object key order and detects changed values',()=>{
  const value=snapshot(),reordered=Object.fromEntries(Object.entries(value).reverse());
  assert.equal(publicSnapshotDigest(reordered),publicSnapshotDigest(value));reordered.state='partial';assert.notEqual(publicSnapshotDigest(reordered),publicSnapshotDigest(value));
});

test('bounded collection abort reaches fetch work and does not publish a late result',async()=>{
  const ledger=new Ledger();let aborted=false;
  const collector=signal=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true}));
  const service=new ContinuousSnapshotService(ledger,collector,null,()=>ledger.now,20);
  await assert.rejects(service.refresh(),/CONTINUOUS_REFRESH_TIMEOUT/u);assert.equal(aborted,true);assert.equal(ledger.publishes,0);assert.deepEqual(ledger.failures,['timeout']);
});

test('manual source checks never invent autonomous scheduled timestamps',async()=>{
  const ledger=new Ledger(),service=new ContinuousSnapshotService(ledger,async()=>snapshot(ledger.now),null,()=>ledger.now);
  const receipt=await service.refresh();assert.equal(receipt.trigger,'manual');assert.equal(receipt.lastScheduledAttemptAt,null);assert.equal(receipt.lastScheduledSuccessAt,null);
});

test('publish acknowledgement without matching durable readback cannot create a success receipt',async()=>{
  const ledger=new Ledger(),originalRead=ledger.read.bind(ledger);
  ledger.read=async()=>ledger.publishes?empty():originalRead();
  await assert.rejects(new ContinuousSnapshotService(ledger,async()=>snapshot(),null,()=>START).refresh(),/CONTINUOUS_SNAPSHOT_UNAVAILABLE/u);
  assert.deepEqual(ledger.failures,['publish-unavailable']);
});

test('runtime cache failure cannot turn a successful durable publication into a failed scheduled run',async()=>{
  const ledger=new Ledger(),badCache={async read(){throw Error('offline');},async write(){throw Error('offline');}};
  const receipt=await new ContinuousSnapshotService(ledger,async()=>snapshot(),badCache,()=>START).refresh(scheduled());
  assert.equal(receipt.state,'published');assert.equal(receipt.persistedReadback,true);assert.equal(ledger.publishes,1);
});

test('only authenticated complete bounded CloudEvents tuple marks a scheduled run',async()=>{
  const headers={authorization:'Bearer '+'s'.repeat(40),'ce-type':'com.vercel.schedule.v1beta','ce-id':'exec_controlled','ce-vssschedulename':'iceo-daily-top','ce-vssscheduledat':iso(START),
    'ce-vssnamespace':'default','ce-vssexpression':'*/2 * * * *','user-agent':'vercel-cron/1.0'};
  assert.deepEqual(refreshRequestTrigger(headers,START),scheduled());
  assert.equal(refreshRequestTrigger({...headers,'ce-id':'urn:vercel:schedule/exec-1.0'},START).kind,'scheduled');
  for(const patch of [{'ce-id':['a','b']},{'ce-vssnamespace':'private'},{'ce-vssschedulename':'other'},{'ce-vssscheduledat':iso(START-900_000)},{'ce-vssexpression':'* * * * *'},{'user-agent':'browser'}])
    assert.deepEqual(refreshRequestTrigger({...headers,...patch},START),manual);
  assert.equal(validRefreshTrigger({...scheduled(),accountId:'private'},START),false);
  let received;
  const ok=response();await handleIceoRefresh({method:'GET',url:'/api/iceo-refresh',headers},ok,{environment:{CRON_SECRET:'s'.repeat(40)},now:()=>START,refresh:async value=>{received=value;return {};}});
  assert.deepEqual(received,scheduled());assert.equal(ok.statusCode,200);
  let calls=0;const bad=response();await handleIceoRefresh({method:'GET',url:'/api/iceo-refresh',headers:{...headers,authorization:'wrong'}},bad,{environment:{CRON_SECRET:'s'.repeat(40)},refresh:async()=>{calls++;return {};}});
  assert.equal(bad.statusCode,401);assert.equal(calls,0);
});

test('public API cache is at most ten seconds and retains conditional GET',async()=>{
  const first=response();await handleIceo({method:'GET',url:'/api/iceo',headers:{}},first,async()=>snapshot());
  assert.equal(first.headers['Cache-Control'],'public, max-age=0, s-maxage=10, must-revalidate');assert.equal(first.headers['X-ICEO-Source-Checked-At'],iso(START));
  const next=response();await handleIceo({method:'GET',url:'/api/iceo',headers:{'if-none-match':first.headers.ETag}},next,async()=>snapshot());assert.equal(next.statusCode,304);assert.equal(next.body,'');
});

test('ledger read carries no writer secret and validates exact public envelope',async()=>{
  const environment={DLKT_INFO_SUPABASE_PROJECT_REF:'abcdefghijklmnopqrst',DLKT_INFO_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',DLKT_INFO_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'x'.repeat(30),DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY:'s'.repeat(43)};
  const calls=[],ledger=createRefreshLedger(environment,async(url,init)=>{calls.push({url:new URL(url),init});return new Response(JSON.stringify(empty()),{headers:{'content-type':'application/json'}});});
  assert.equal(ledger.writable,true);await ledger.read();
  assert.equal(calls[0].url.pathname,'/rest/v1/rpc/dlkt_info_read_public_snapshot');assert.equal(calls[0].init.headers['x-dlkt-share-write'],undefined);
  assert.equal(calls[0].init.headers.Authorization,undefined);assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.credentials,'omit');
  const bad=createRefreshLedger(environment,async()=>new Response(JSON.stringify({...empty(),privateToken:'bad'}),{headers:{'content-type':'application/json'}}));
  await assert.rejects(bad.read(),/REFRESH_LEDGER_UNAVAILABLE/u);
  const oversized=createRefreshLedger(environment,async()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'9999999'}}));
  await assert.rejects(oversized.read(),/REFRESH_LEDGER_UNAVAILABLE/u);
});

test('ledger writer calls use only fixed RPCs and reject bad triggers or missing key before any mutation request',async()=>{
  const environment={DLKT_INFO_SUPABASE_PROJECT_REF:'abcdefghijklmnopqrst',DLKT_INFO_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',DLKT_INFO_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'x'.repeat(30),DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY:'s'.repeat(43)};
  const calls=[],claim={version:'iceo-refresh-claim-1',state:'claimed',slot:Math.floor(Date.now()/120_000),fence:1,leaseToken:'00000000-0000-4000-8000-000000000001',leaseExpiresAt:iso(Date.now()+90_000),retryAt:null};
  const ledger=createRefreshLedger(environment,async(url,init)=>{calls.push({url:new URL(url),init});return new Response(JSON.stringify(claim),{headers:{'content-type':'application/json'}});});
  await ledger.claim('00000000-0000-4000-8000-000000000002',manual);
  assert.equal(calls[0].url.pathname,'/rest/v1/rpc/dlkt_info_claim_public_refresh');assert.equal(calls[0].init.headers['x-dlkt-share-write'],environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY);
  assert.deepEqual(JSON.parse(calls[0].init.body),{p_worker_id:'00000000-0000-4000-8000-000000000002',p_trigger:manual});
  await assert.rejects(ledger.claim('00000000-0000-4000-8000-000000000002',{...manual,privateAccount:'secret'}),/REFRESH_LEDGER_INVALID/u);assert.equal(calls.length,1);
  let mutations=0;const readOnly=createRefreshLedger({...environment,DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY:undefined},async()=>{mutations++;throw Error('must not fetch');});
  assert.equal(readOnly.writable,false);await assert.rejects(readOnly.claim('00000000-0000-4000-8000-000000000002',manual),/REFRESH_LEDGER_UNAVAILABLE/u);assert.equal(mutations,0);
});

test('official source abort stops network work without caching cancellation or canceling another waiter owner',async()=>{
  const source=ICEO_SOURCES.find(row=>row.id==='ecb-news');let fetched=0,finish,networkSignal;
  const xml='<?xml version="1.0"?><rss><channel><title>ECB - European Central Bank</title><item><title>Official statement</title><link>https://www.ecb.europa.eu/press/test.html</link><pubDate>Fri, 20 Nov 2026 08:00:00 +0100</pubDate></item></channel></rss>';
  const engine=new IceoEngine(async(_url,init)=>{fetched++;networkSignal=init.signal;return new Promise(resolve=>{finish=()=>resolve(new Response(xml,{headers:{'content-type':'application/rss+xml'}}));});},()=>START);
  const owner=engine.read(source),waiterAbort=new AbortController(),waiter=engine.read(source,waiterAbort.signal);
  waiterAbort.abort();await assert.rejects(waiter);assert.equal(networkSignal.aborted,false);finish();assert.equal((await owner).health.state,'verified');assert.equal(fetched,1);
  let aborted=false,started=0;const controller=new AbortController();
  const stopped=new IceoEngine(async(_url,init)=>{started++;return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true}));},()=>START);
  const pending=stopped.snapshot(controller.signal);controller.abort();await assert.rejects(pending);assert.equal(aborted,true);assert.ok(started<=8);
});

test('controlled snapshot conforms to the complete public boundary',()=>assert.equal(validDailySnapshot(snapshot(),START),true));

test('a claimed refresh passes only a digest-valid unexpired prior catalog to bounded collection',async()=>{
  const ledger=new Ledger();ledger.seed();ledger.now=START+CONTINUOUS_REFRESH_INTERVAL_MS;
  let previous;
  const service=new ContinuousSnapshotService(ledger,async(_signal,prior)=>{previous=prior;return snapshot(ledger.now);},null,()=>ledger.now);
  await service.refresh(manual);assert.deepEqual(previous,snapshot(START));
  assert.equal(previous.cards[0].observedAt,iso(START));assert.equal(previous.cards[0].contentHash,snapshot(START).cards[0].contentHash);
  const invalid=new Ledger();invalid.seed();invalid.envelope.digest='0'.repeat(64);invalid.now=START+CONTINUOUS_REFRESH_INTERVAL_MS;
  let invalidPrevious='unset';
  await new ContinuousSnapshotService(invalid,async(_signal,prior)=>{invalidPrevious=prior;return snapshot(invalid.now);},null,()=>invalid.now).refresh(manual);
  assert.equal(invalidPrevious,undefined);
});
