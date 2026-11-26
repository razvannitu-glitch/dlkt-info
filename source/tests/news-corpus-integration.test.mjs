import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {ContinuousSnapshotService,validDailySnapshot} from '../.build/src/iceo/daily-cache.js';
import {publicSnapshotDigest,CONTINUOUS_REFRESH_INTERVAL_MS,RefreshLedgerError,createRefreshLedger} from '../.build/src/iceo/refresh-ledger.js';
import {buildNewsCorpus,validNewsCorpus} from '../.build/src/iceo/news-corpus.js';
import {finalizeEditorialCollection} from '../.build/src/iceo/editorial-engine.js';
import {NewsDiagnosticsBuilder,validNewsDiagnostics} from '../.build/src/iceo/news-diagnostics.js';
import {ICEO_SOURCES} from '../.build/src/iceo/registry.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {newsCategory} from '../.build/src/iceo/news-taxonomy.js';
import {validArchiveCard,captureArchiveRecord} from '../.build/src/share/archive.js';
import {resolveCurrentCard} from '../.build/src/share/corpus-card.js';
import {handleShareArchive} from '../.build/api/share-archive.js';
import {resolvePhotoArticle,handleArticlePhoto} from '../.build/api/article-photo.js';
import {articlePhotoPath} from '../.build/src/media/article-photo-reference.js';
import {cardPath} from '../.build/src/share/link.js';
import {findCity} from '../.build/src/local/cities.js';
import {parseLocalNews} from '../.build/src/local/news-service.js';
import {newsFeedsFor} from '../.build/src/local/news-policy.js';
import {newsCard} from '../.build/src/local/service.js';

const now=Date.parse('2026-11-22T17:00:00.000Z'),iso=value=>new Date(value).toISOString(),clone=value=>structuredClone(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const source=ICEO_SOURCES.find(item=>item.id==='news-science');assert.ok(source);
function card(index=0,changes={}){
 const url='https://www.theguardian.com/science/2026/nov/22/controlled-corpus-'+index;
 const base={identity:url,title:'Researchers discover a new material in controlled study '+index,topic:source.topic,kind:'publication',
  sourceUrl:url,publisher:'The Guardian',sourceIds:[source.id],date:iso(now-60_000),dateLabel:'Published',observedAt:iso(now),
  boundary:'Controlled integration fixture; no article body.',deadline:null,version:null,attribution:'Source: The Guardian.',sourceState:'verified',...changes};
 return {...base,id:hash(base.identity).slice(0,24),contentHash:hash(cardContent(base))};
}
function snapshot(cards=[card()],generated=now){
 const stamp=iso(generated),health={id:source.id,label:source.label,publisher:source.publisher,topic:source.topic,state:'verified',
  checkedAt:stamp,verifiedAt:stamp,count:cards.length,rejected:0,error:null,retryAt:null,scope:source.scope,termsUrl:source.termsUrl,windowed:true};
 return {version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.46',mode:'current-source-records',
  generatedAt:stamp,state:'ready',sources:[health],cards,conflictCount:0,duplicateCount:0,deltaAvailable:false,
  scheduledDelivery:false,accountPersistence:false,coverage:cards.length?[source.topic]:[]};
}
function collection(){
 const cards=[card(0),card(1)],full=snapshot(cards),limited=snapshot(cards.slice(0,1));
 const builder=new NewsDiagnosticsBuilder(now);
 builder.discovered(cards);builder.pool(cards);builder.scheduled(cards);
 for(const item of cards){builder.request(item.sourceUrl);builder.verified(item.sourceUrl);}
 const value={snapshot:limited,corpus:buildNewsCorpus(full,[],now),diagnostics:builder.finish()};
 assert.equal(validDailySnapshot(value.snapshot,now),true);assert.equal(validNewsCorpus(value.corpus,now),true);
 assert.equal(validNewsDiagnostics(value.diagnostics,now),true);assert.ok(cards.every(validArchiveCard));
 return value;
}
const emptyEnvelope=()=>({version:'iceo-shared-snapshot-1',snapshot:null,digest:null,revision:0,refreshedAt:null,lastAttemptAt:null,
 lastScheduledAttemptAt:null,lastScheduledSuccessAt:null,status:'empty',retryAt:null});
/** This double checks service ordering only. PostgreSQL transactions/fencing have separate database tests. */
function persistence({stageError=false,publishError=false,readback=value=>value}={}){
 const calls=[],failures=[],stageCalls=[];let envelope=emptyEnvelope(),staged=null,committed=null,scheduled=false;
 const claim={version:'iceo-refresh-claim-1',state:'claimed',slot:Math.floor(now/CONTINUOUS_REFRESH_INTERVAL_MS),fence:7,
  leaseToken:'00000000-0000-4000-8000-000000000007',leaseExpiresAt:iso(now+90_000),retryAt:null};
 const corpus={
  async stage(received,value,diagnostics){
   calls.push('corpus-stage');stageCalls.push({claim:clone(received),corpus:clone(value),diagnostics:clone(diagnostics)});
   assert.deepEqual(received,claim);
   if(stageError)throw Error('CONTROLLED_STAGE_FAILURE');
   assert.equal(validNewsCorpus(value,now),true);if(diagnostics!==undefined)assert.equal(validNewsDiagnostics(diagnostics,now),true);
   staged={epoch:String(received.fence),digest:publicSnapshotDigest(value),value:clone(value)};return {epoch:staged.epoch,digest:staged.digest};
  },
  async read(epoch){
   calls.push('corpus-read:'+epoch);return readback(clone(committed));
  },
  async lookup(){assert.fail('refresh must never look up individual reader references');},
 };
 const ledger={
  writable:true,
  async claim(_worker,trigger){calls.push('claim');scheduled=trigger.kind==='scheduled';
   envelope={...envelope,lastAttemptAt:iso(now),lastScheduledAttemptAt:scheduled?iso(now):envelope.lastScheduledAttemptAt,status:'refreshing'};return clone(claim);},
  async read(){calls.push('snapshot-read');return clone(envelope);},
  async publish(received,value,digest){
   calls.push('snapshot-publish');assert.deepEqual(received,claim);assert.equal(digest,publicSnapshotDigest(value));
   if(publishError)throw Error('CONTROLLED_PUBLISH_FAILURE');
   envelope={...envelope,snapshot:clone(value),digest,revision:envelope.revision+1,refreshedAt:iso(now),status:'ready',retryAt:null,
    lastScheduledSuccessAt:scheduled?iso(now):envelope.lastScheduledSuccessAt};
   if(staged)committed={version:'dlkt-news-epoch-1',epoch:staged.epoch,revision:envelope.revision,generatedAt:staged.value.generatedAt,
    publishedAt:iso(now),expiresAt:iso(now+3_600_000),digest:staged.digest,corpus:clone(staged.value)};
   return clone(envelope);
  },
  async fail(_claim,reason){calls.push('failed');failures.push(reason);return {recorded:envelope.status!=='ready',retryAt:null};},
 };
 return {ledger,corpus,calls,failures,stageCalls,get envelope(){return clone(envelope);},get committed(){return clone(committed);}};
}
function response(){
 const headers={};let body;
 return {res:{statusCode:0,setHeader(name,value){headers[name.toLowerCase()]=value;},end(value){body=value;}},
  headers,get body(){return body;},get json(){return JSON.parse(String(body));}};
}
const reference=subject=>({id:subject.id,revision:subject.contentHash});
const corpusItem=subject=>({kind:'global',key:'article:'+subject.id,category:newsCategory(subject),card:subject});
function archive(){
 const captures=[];return {writable:true,captures,async read(){return null;},
  async capture(current,at){captures.push({current:clone(current),at});return captureArchiveRecord(current,at);}};
}
function shareRequest(value){
 const req=Readable.from([Buffer.from(JSON.stringify(value))]);req.method='POST';req.url='/api/share-archive';
 req.headers={host:'www.dlkt.ee',origin:'https://www.dlkt.ee','content-type':'application/json','x-dlkt-info-request':'share-archive'};return req;
}

test('continuous publication stages full corpus and private diagnostics before snapshot publish, then confirms the same epoch',async()=>{
 const collected=collection(),storage=persistence();
 const service=new ContinuousSnapshotService(storage.ledger,async(signal,previous)=>{
  storage.calls.push('collect');assert.equal(signal.aborted,false);assert.equal(previous,undefined);return collected;
 },null,()=>now,45000,storage.corpus);
 const receipt=await service.refresh();
 assert.equal(receipt.state,'published');assert.equal(receipt.persistedReadback,true);assert.equal(receipt.revision,1);
 assert.deepEqual(storage.calls,['claim','snapshot-read','collect','corpus-stage','snapshot-publish','snapshot-read','corpus-read:7']);
 assert.deepEqual(storage.stageCalls[0].corpus,collected.corpus);assert.deepEqual(storage.stageCalls[0].diagnostics,collected.diagnostics);
 assert.equal(storage.committed.corpus.cards.length,2);assert.equal(storage.envelope.snapshot.cards.length,1);
 assert.equal(storage.committed.digest,publicSnapshotDigest(collected.corpus));assert.equal(storage.committed.revision,receipt.revision);
 assert.equal(storage.committed.generatedAt,collected.snapshot.generatedAt);assert.deepEqual(await service.snapshot(),collected.snapshot);
 assert.equal(Object.hasOwn(receipt,'diagnostics'),false);assert.equal(Object.hasOwn(storage.envelope.snapshot,'diagnostics'),false);
});

test('a staging failure cannot publish the compatibility snapshot or claim persisted success',async()=>{
 const storage=persistence({stageError:true}),value=collection();
 await assert.rejects(new ContinuousSnapshotService(storage.ledger,async()=>value,null,()=>now,45000,storage.corpus).refresh(),/CONTROLLED_STAGE_FAILURE/u);
 assert.equal(storage.calls.includes('snapshot-publish'),false);assert.equal(storage.calls.some(call=>call.startsWith('corpus-read:')),false);
 assert.equal(storage.envelope.snapshot,null);assert.equal(storage.committed,null);assert.deepEqual(storage.failures,['publish-unavailable']);
});

test('a failed snapshot publication leaves staged corpus unconfirmed and cannot emit a success receipt',async()=>{
 const storage=persistence({publishError:true});
 await assert.rejects(new ContinuousSnapshotService(storage.ledger,async()=>collection(),null,()=>now,45000,storage.corpus).refresh(),/CONTROLLED_PUBLISH_FAILURE/u);
 assert.ok(storage.calls.indexOf('corpus-stage')<storage.calls.indexOf('snapshot-publish'));
 assert.equal(storage.calls.some(call=>call.startsWith('corpus-read:')),false);assert.equal(storage.committed,null);
 assert.deepEqual(storage.failures,['publish-unavailable']);
});

test('missing or mismatched corpus readback rejects the receipt even after a snapshot acknowledgement',async()=>{
 for(const mutate of [
  ()=>null,value=>({...value,epoch:'8'}),value=>({...value,digest:'f'.repeat(64)}),
  value=>({...value,revision:value.revision+1}),value=>({...value,generatedAt:iso(now-1)}),
 ]){
  const storage=persistence({readback:mutate});
  await assert.rejects(new ContinuousSnapshotService(storage.ledger,async()=>collection(),null,()=>now,45000,storage.corpus).refresh(),/CONTINUOUS_CORPUS_READBACK_FAILED/u);
  assert.ok(storage.calls.includes('snapshot-publish'));assert.ok(storage.calls.includes('corpus-read:7'));
  assert.deepEqual(storage.failures,['publish-unavailable']);
 }
});

test('the collector union keeps legacy snapshot-only callers compatible and requires a store for a full collection',async()=>{
 const legacy=persistence(),limited=collection().snapshot;
 const receipt=await new ContinuousSnapshotService(legacy.ledger,async()=>limited,null,()=>now,45000,legacy.corpus).refresh();
 assert.equal(receipt.persistedReadback,true);assert.equal(legacy.stageCalls.length,0);
 assert.equal(legacy.calls.some(call=>call.startsWith('corpus-read:')),false);
 const missing=persistence();
 await assert.rejects(new ContinuousSnapshotService(missing.ledger,async()=>collection(),null,()=>now).refresh(),/CONTINUOUS_CORPUS_NOT_CONFIGURED/u);
 assert.equal(missing.calls.includes('snapshot-publish'),false);
});

test('public snapshot reads never acquire sources or stage a corpus',async()=>{
 const storage=persistence();let collected=0;
 const service=new ContinuousSnapshotService(storage.ledger,async()=>{collected++;return collection();},null,()=>now,45000,storage.corpus);
 await assert.rejects(service.snapshot(),/CONTINUOUS_SNAPSHOT_UNAVAILABLE/u);
 assert.equal(collected,0);assert.deepEqual(storage.calls,['snapshot-read']);assert.equal(storage.stageCalls.length,0);
});

test('an exact verified corpus article outside the snapshot resolves photos and sharing without re-acquisition',async()=>{
 const item=corpusItem(card(1)),ref=reference(item.card),lookups=[];let snapshotLoads=0,localLoads=0;
 const corpus={async lookup(value){lookups.push(clone(value));return item;}};
 const deps={corpus,global:async()=>{snapshotLoads++;return snapshot([card(0)]);},local:async()=>{localLoads++;return {articles:[],sources:[]};},
  photos:{async read(){assert.fail('metadata resolution cannot acquire an image');}},clock:()=>now};
 const photo=await resolvePhotoArticle(ref,deps);
 assert.equal(photo.sourceUrl,item.card.sourceUrl);assert.equal(photo.revision,item.card.contentHash);
 assert.equal(photo.validUntil,now+300000);assert.equal(photo.publishedAt,item.card.date);
 const shared=await resolveCurrentCard(async()=>{snapshotLoads++;return snapshot([card(0)]);},ref,()=>now,true,corpus);
 assert.deepEqual(shared.card,item.card);assert.equal(shared.validUntil,now+3_600_000);
 assert.equal(snapshotLoads,0);assert.equal(localLoads,0);assert.deepEqual(lookups,[ref,ref]);
});

test('photo HTTP response remains bound to the exact corpus article and reference',async()=>{
 const item=corpusItem(card(2)),ref=reference(item.card),out=response(),imageBytes=Buffer.from('controlled raster service result');
 const requests=[];
 const deps={corpus:{async lookup(value){assert.deepEqual(value,ref);return item;}},
  global:async()=>{assert.fail('a valid corpus hit does not load the compatibility snapshot');},local:async()=>{assert.fail('global photo cannot load local sources');},
  photos:{async read(value){requests.push(value);return {bytes:imageBytes,mime:'image/png',width:640,height:360,sha256:'d'.repeat(64),
   metadata:{articleUrl:value.sourceUrl,imageUrl:'https://i.guim.co.uk/img/media/controlled/master/1200.jpg',basis:'article-opengraph',alt:'',credit:null,caption:null},
   checkedAt:now,until:now+60000};}},clock:()=>now};
 await handleArticlePhoto({method:'GET',url:articlePhotoPath(ref),headers:{}},out.res,deps);
 assert.equal(out.res.statusCode,200);assert.deepEqual(out.body,imageBytes);
 assert.equal(requests.length,1);assert.equal(requests[0].sourceUrl,item.card.sourceUrl);assert.equal(requests[0].revision,ref.revision);
 assert.equal(out.headers.link,'<'+item.card.sourceUrl+'>; rel="canonical"');assert.equal(out.headers['x-dlkt-photo-basis'],'article-opengraph');
});

test('expired, tampered and wrong-reference corpus records never resolve a photo or become a current share',async()=>{
 const original=card(3),ref=reference(original);
 const publishedExpired=card(3,{date:iso(now-86_400_000)});
 for(const [returned,requested] of [
  [card(4),ref],[card(3,{observedAt:iso(now-3_600_000)}),ref],[publishedExpired,reference(publishedExpired)],
  [{...original,title:'Tampered original title'},ref],[{...original,contentHash:'f'.repeat(64)},ref],
 ]){
  const item=corpusItem(returned),corpus={async lookup(){return item;}},deps={corpus,global:async()=>snapshot([]),
   local:async()=>({articles:[],sources:[]}),photos:{async read(){assert.fail('invalid references cannot reach photo acquisition');}},clock:()=>now};
  assert.equal(await resolvePhotoArticle(requested,deps),null);
  await assert.rejects(resolveCurrentCard(async()=>snapshot([]),requested,()=>now,true,corpus),error=>error.status===404);
 }
});

test('a corpus outage preserves independently verified snapshot resolution for the same exact revision',async()=>{
 const original=card(5),ref=reference(original),limited=snapshot([original]);
 const corpus={async lookup(){throw Error('CONTROLLED_CORPUS_OUTAGE');}};
 const deps={corpus,global:async()=>limited,local:async()=>({articles:[],sources:[]}),photos:{async read(){return null;}},clock:()=>now};
 assert.equal((await resolvePhotoArticle(ref,deps)).sourceUrl,original.sourceUrl);
 assert.deepEqual((await resolveCurrentCard(async()=>limited,ref,()=>now,true,corpus)).card,original);
 const wrong={...ref,revision:'e'.repeat(64)};
 assert.equal(await resolvePhotoArticle(wrong,deps),null);
 await assert.rejects(resolveCurrentCard(async()=>limited,wrong,()=>now,true,corpus),error=>error.status===410);
});

test('share preservation captures the exact corpus version absent from the snapshot and keeps provenance',async()=>{
 const original=card(6,{articleSubject:{basis:'publisher-jsonld',articleUrl:'https://www.theguardian.com/science/2026/nov/22/controlled-corpus-6',sections:['Science'],keywords:['materials']}}),
  ref=reference(original),out=response(),saved=archive();let loads=0;
 await handleShareArchive(shareRequest(ref),out.res,async()=>{loads++;return snapshot([]);},saved,()=>now,{async lookup(value){assert.deepEqual(value,ref);return corpusItem(original);}});
 assert.equal(out.res.statusCode,200);assert.deepEqual(out.json,{state:'preserved',path:cardPath(original)});
 assert.equal(loads,0);assert.equal(saved.captures.length,1);assert.deepEqual(saved.captures[0].current.card,original);
 assert.equal(saved.captures[0].current.card.contentHash,hash(cardContent(original)));
 assert.equal(out.headers['cache-control'],'private, no-store');assert.equal(out.headers['set-cookie'],undefined);
});

test('share preservation rejects expired and wrong corpus revisions without capturing client content',async()=>{
 const original=card(7),ref=reference(original);
 for(const returned of [card(7,{observedAt:iso(now-3_600_000)}),card(8),{...original,contentHash:'a'.repeat(64)}]){
  const out=response(),saved=archive();
  await handleShareArchive(shareRequest(ref),out.res,async()=>snapshot([]),saved,()=>now,{async lookup(){return corpusItem(returned);}});
  assert.equal(out.res.statusCode,404);assert.equal(saved.captures.length,0);
 }
});

test('local corpus photos keep city binding and the existing five-minute verification boundary',async()=>{
 const city=findCity('683506');assert.ok(city);
 const feed='<rss version="2.0"><channel><title>B365</title><link>https://b365.ro/</link><item><title>Bucuresti: lucrari la reteaua de apa</title><link>https://b365.ro/lucrari-apa-bucuresti-629580/</link><pubDate>Sun, 22 Nov 2026 16:00:00 +0000</pubDate><description>Lucrarile sunt anuntate de operator.</description></item></channel></rss>';
 const articles=parseLocalNews(feed,'bucharest-b365',city,iso(now),now).articles;assert.equal(articles.length,1);
 const local=newsCard(articles[0],city),ref={id:local.id,revision:articles[0].documentHash,cityId:city.id};
 const deps={corpus:{async lookup(){return {kind:'local',key:'local:'+local.id,category:newsCategory(local),card:local};}},
  global:async()=>{assert.fail('local photos do not load global collection');},local:async()=>({articles:[],sources:[]}),
  photos:{async read(){assert.fail('metadata test cannot acquire pixels');}},clock:()=>now};
 const photo=await resolvePhotoArticle(ref,deps);assert.equal(photo.sourceUrl,articles[0].url);assert.equal(photo.validUntil,Date.parse(articles[0].validUntil));
 assert.equal(await resolvePhotoArticle({...ref,cityId:'0000000'},deps),null);
 assert.equal(await resolvePhotoArticle(ref,{...deps,clock:()=>now+300001}),null);
});

test('common collection completion aligns snapshot and corpus generation without redating global or local observations',()=>{
 const global=card(9),full=snapshot([global]),city=findCity('683506');assert.ok(city);
 const localChecked=now+10_000,completed=now+12_000;
 const feed='<rss version="2.0"><channel><title>B365</title><link>https://b365.ro/</link><item><title>Bucuresti: lucrari la reteaua de apa</title><link>https://b365.ro/lucrari-apa-bucuresti-629580/</link><pubDate>Sun, 22 Nov 2026 16:00:00 +0000</pubDate><description>Lucrarile sunt anuntate de operator.</description></item></channel></rss>';
 const parsed=parseLocalNews(feed,'bucharest-b365',city,iso(localChecked),localChecked,{full:true});assert.equal(parsed.articles.length,1);
 const sources=newsFeedsFor(city).map(definition=>({
  sourceId:definition.id,publisher:definition.publisher,feedUrl:definition.endpoint,termsUrl:definition.termsUrl,
  ...(definition.id==='bucharest-b365'?{state:parsed.rejected?'partial':'ready',checkedAt:iso(localChecked),count:parsed.articles.length,rejected:parsed.rejected,error:null}
   :{state:'unavailable',checkedAt:null,count:0,rejected:0,error:'NEWS_FIXTURE_UNAVAILABLE'}),
 }));
 const local=[{city,snapshot:{articles:parsed.articles,sources}}],before=clone({global,local});
 const diagnostics=new NewsDiagnosticsBuilder(now).finish();
 const result=finalizeEditorialCollection(full,local,diagnostics,completed);
 assert.equal(result.snapshot.generatedAt,iso(completed));assert.equal(result.corpus.generatedAt,iso(completed));
 assert.equal(validDailySnapshot(result.snapshot,completed),true);assert.equal(validNewsCorpus(result.corpus,completed),true);
 assert.deepEqual(result.snapshot.cards,[before.global]);assert.deepEqual(result.corpus.cards,[before.global]);
 assert.deepEqual(result.corpus.local,before.local);assert.equal(result.corpus.local[0].snapshot.articles[0].checkedAt,iso(localChecked));
 assert.equal(result.corpus.local[0].snapshot.articles[0].validUntil,iso(localChecked+300000));
 assert.equal(result.snapshot.cards[0].observedAt,iso(now));assert.equal(result.snapshot.cards[0].date,before.global.date);
 assert.equal(result.snapshot.cards[0].contentHash,before.global.contentHash);assert.deepEqual(result.diagnostics,diagnostics);
});

/** The transport error occurs after the atomic write in the successful-commit case. */
function losePublishAcknowledgement(storage,{committed=true,error=new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE')}={}){
 const publish=storage.ledger.publish.bind(storage.ledger);
 storage.ledger.publish=async(...args)=>{
  if(committed)await publish(...args);else storage.calls.push('snapshot-publish');
  throw error;
 };
}
const scheduledRefresh=()=>({kind:'scheduled',executionId:'controlled-reconciliation',scheduleName:'iceo-daily-top',
 scheduledAt:iso(now),namespace:'default',expression:'*/2 * * * *'});

test('lost publication acknowledgement reconciles the exact committed fenced corpus once',async()=>{
 for(const trigger of [{kind:'manual'},scheduledRefresh()]){
  const storage=persistence(),value=collection();losePublishAcknowledgement(storage);
  const service=new ContinuousSnapshotService(storage.ledger,async()=>{storage.calls.push('collect');return value;},null,()=>now,45000,storage.corpus);
  const receipt=await service.refresh(trigger);
  assert.equal(receipt.state,'published');assert.equal(receipt.persistedReadback,true);
  assert.equal(receipt.snapshotDigest,storage.envelope.digest);assert.equal(receipt.revision,storage.committed.revision);
  assert.equal(receipt.refreshedAt,storage.envelope.refreshedAt);
  assert.equal(receipt.lastScheduledSuccessAt,trigger.kind==='scheduled'?storage.envelope.refreshedAt:null);
  assert.deepEqual(storage.calls,['claim','snapshot-read','collect','corpus-stage','snapshot-publish','snapshot-read','corpus-read:7']);
  assert.deepEqual(storage.failures,[]);assert.deepEqual(await service.snapshot(),value.snapshot);
 }
});

test('a typed unavailable publish without a committed write cannot recover staged data',async()=>{
 const storage=persistence();losePublishAcknowledgement(storage,{committed:false});
 await assert.rejects(new ContinuousSnapshotService(storage.ledger,async()=>collection(),null,()=>now,45000,storage.corpus).refresh(),/CONTINUOUS_SNAPSHOT_UNAVAILABLE/u);
 assert.equal(storage.envelope.snapshot,null);assert.equal(storage.committed,null);
 assert.deepEqual(storage.calls,['claim','snapshot-read','corpus-stage','snapshot-publish','snapshot-read','failed']);
 assert.deepEqual(storage.failures,['publish-unavailable']);
});

test('reconciliation rejects invalid, old, different, newer and non-ready public readback',async()=>{
 const candidates=[
  envelope=>({...envelope,writerKey:'private-fixture'}),
  envelope=>({...envelope,digest:'f'.repeat(64)}),
  envelope=>{const value=clone(envelope.snapshot);value.generatedAt=iso(now-1);
   return {...envelope,snapshot:value,digest:publicSnapshotDigest(value)};},
  envelope=>{const value=clone(envelope.snapshot);value.generatedAt=iso(now+1);
   return {...envelope,snapshot:value,digest:publicSnapshotDigest(value),revision:envelope.revision+1};},
  envelope=>({...envelope,status:'refreshing'}),
  envelope=>({...envelope,status:'backoff',retryAt:iso(now+30000)}),
  envelope=>({...envelope,retryAt:iso(now+30000)}),
  envelope=>({...envelope,refreshedAt:iso(now-1)}),
 ];
 for(const mutate of candidates){
  const storage=persistence(),read=storage.ledger.read.bind(storage.ledger);losePublishAcknowledgement(storage);
  storage.ledger.read=async()=>{const value=await read();return storage.calls.includes('snapshot-publish')?mutate(value):value;};
  await assert.rejects(new ContinuousSnapshotService(storage.ledger,async()=>collection(),null,()=>now,45000,storage.corpus).refresh(),/CONTINUOUS_(?:SNAPSHOT_UNAVAILABLE|READBACK_FAILED)/u);
  assert.equal(storage.calls.filter(value=>value==='snapshot-publish').length,1);
  assert.equal(storage.calls.filter(value=>value==='snapshot-read').length,2);
  assert.equal(storage.calls.some(value=>value.startsWith('corpus-read:')),false);
  assert.deepEqual(storage.failures,['publish-unavailable']);
 }
});

test('recovered scheduled publication requires the database scheduled-success timestamp',async()=>{
 for(const stamp of [null,iso(now-1)]){
  const storage=persistence(),read=storage.ledger.read.bind(storage.ledger);losePublishAcknowledgement(storage);
  storage.ledger.read=async()=>{const value=await read();return storage.calls.includes('snapshot-publish')?{...value,lastScheduledSuccessAt:stamp}:value;};
  await assert.rejects(new ContinuousSnapshotService(storage.ledger,async()=>collection(),null,()=>now,45000,storage.corpus).refresh(scheduledRefresh()),/CONTINUOUS_READBACK_FAILED/u);
  assert.equal(storage.calls.filter(value=>value==='snapshot-publish').length,1);
  assert.equal(storage.calls.some(value=>value.startsWith('corpus-read:')),false);
  assert.deepEqual(storage.failures,['publish-unavailable']);
 }
});

test('a recovered snapshot still requires exact committed corpus epoch, digest, time and revision',async()=>{
 for(const mutate of [
  ()=>null,value=>({...value,epoch:'8'}),value=>({...value,digest:'f'.repeat(64)}),
  value=>({...value,revision:value.revision+1}),value=>({...value,generatedAt:iso(now-1)}),
 ]){
  const storage=persistence({readback:mutate});losePublishAcknowledgement(storage);
  await assert.rejects(new ContinuousSnapshotService(storage.ledger,async()=>collection(),null,()=>now,45000,storage.corpus).refresh(),/CONTINUOUS_CORPUS_READBACK_FAILED/u);
  assert.equal(storage.calls.filter(value=>value==='snapshot-publish').length,1);
  assert.equal(storage.calls.filter(value=>value==='snapshot-read').length,2);
  assert.equal(storage.calls.filter(value=>value==='corpus-read:7').length,1);
  assert.deepEqual(storage.failures,['publish-unavailable']);
 }
});

test('reconciliation read failures stay failures and never replay any write',async()=>{
 for(const boundary of ['snapshot','corpus']){
  const storage=persistence(),read=storage.ledger.read.bind(storage.ledger);losePublishAcknowledgement(storage);
  if(boundary==='snapshot')storage.ledger.read=async()=>{
   if(storage.calls.includes('snapshot-publish')){storage.calls.push('snapshot-read');throw new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE');}
   return read();
  };
  else storage.corpus.read=async()=>{storage.calls.push('corpus-read:7');throw Error('CONTROLLED_CORPUS_READ_UNAVAILABLE');};
  await assert.rejects(new ContinuousSnapshotService(storage.ledger,async()=>collection(),null,()=>now,45000,storage.corpus).refresh());
  assert.equal(storage.calls.filter(value=>value==='snapshot-publish').length,1);
  assert.equal(storage.calls.filter(value=>value==='snapshot-read').length,2);
  assert.equal(storage.stageCalls.length,1);assert.deepEqual(storage.failures,['publish-unavailable']);
 }
});

test('recovery never substitutes an epoch from another fence',async()=>{
 const storage=persistence(),stage=storage.corpus.stage.bind(storage.corpus);losePublishAcknowledgement(storage);
 storage.corpus.stage=async(...args)=>({...await stage(...args),epoch:'8'});
 await assert.rejects(new ContinuousSnapshotService(storage.ledger,async()=>collection(),null,()=>now,45000,storage.corpus).refresh(),/REFRESH_LEDGER_UNAVAILABLE/u);
 assert.equal(storage.calls.filter(value=>value==='snapshot-publish').length,1);
 assert.equal(storage.calls.filter(value=>value==='snapshot-read').length,1);
 assert.equal(storage.calls.some(value=>value.startsWith('corpus-read:')),false);
 assert.deepEqual(storage.failures,['publish-unavailable']);
});

test('validation and untyped errors do not enter publication reconciliation',async()=>{
 for(const error of [new RefreshLedgerError('REFRESH_LEDGER_INVALID'),Error('REFRESH_LEDGER_UNAVAILABLE'),Object.assign(Error('upstream'),{code:'REFRESH_LEDGER_UNAVAILABLE'})]){
  const storage=persistence();losePublishAcknowledgement(storage,{error});
  await assert.rejects(new ContinuousSnapshotService(storage.ledger,async()=>collection(),null,()=>now,45000,storage.corpus).refresh(),error);
  assert.equal(storage.calls.filter(value=>value==='snapshot-publish').length,1);
  assert.equal(storage.calls.filter(value=>value==='snapshot-read').length,1);
  assert.equal(storage.calls.some(value=>value.startsWith('corpus-read:')),false);
  assert.deepEqual(storage.failures,['publish-unavailable']);
 }
});

test('legacy snapshot-only publication errors cannot recover without the corpus fence binding',async()=>{
 const storage=persistence();losePublishAcknowledgement(storage);
 await assert.rejects(new ContinuousSnapshotService(storage.ledger,async()=>collection().snapshot,null,()=>now,45000,storage.corpus).refresh(),/REFRESH_LEDGER_UNAVAILABLE/u);
 assert.equal(storage.stageCalls.length,0);assert.equal(storage.calls.filter(value=>value==='snapshot-read').length,1);
 assert.equal(storage.calls.filter(value=>value==='snapshot-publish').length,1);assert.deepEqual(storage.failures,['publish-unavailable']);
});

test('a malformed object returned directly by the ledger fails validation without recovering',async()=>{
 const storage=persistence(),publish=storage.ledger.publish.bind(storage.ledger);
 storage.ledger.publish=async(...args)=>({...await publish(...args),privateField:'fixture'});
 await assert.rejects(new ContinuousSnapshotService(storage.ledger,async()=>collection(),null,()=>now,45000,storage.corpus).refresh(),/CONTINUOUS_SNAPSHOT_UNAVAILABLE/u);
 assert.equal(storage.calls.filter(value=>value==='snapshot-publish').length,1);
 assert.equal(storage.calls.filter(value=>value==='snapshot-read').length,2);
 assert.equal(storage.calls.some(value=>value.startsWith('corpus-read:')),false);
 assert.deepEqual(storage.failures,['publish-unavailable']);
});

test('recovery diagnostics contain only a constant marker after complete persisted readback',async()=>{
 const storage=persistence(),info=[],warnings=[],originalInfo=console.info,originalWarn=console.warn;
 losePublishAcknowledgement(storage);
 console.info=(...args)=>info.push(args);console.warn=(...args)=>warnings.push(args);
 try{
  await new ContinuousSnapshotService(storage.ledger,async()=>collection(),null,()=>now,45000,storage.corpus).refresh();
 }finally{console.info=originalInfo;console.warn=originalWarn;}
 assert.deepEqual(info,[['DLKT_ICEO_REFRESH_PUBLICATION_RECONCILED']]);assert.deepEqual(warnings,[]);
});

test('actual ledger adapter reconciles unusable write responses only through independent committed readback',async()=>{
 for(const responseMode of ['transport-loss','malformed-envelope','undecodable-body']){
  const storage=persistence(),routes=[],value=collection();
  const environment={DLKT_INFO_SUPABASE_PROJECT_REF:'abcdefghijklmnopqrst',DLKT_INFO_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',
   DLKT_INFO_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'x'.repeat(30),DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY:'s'.repeat(43)};
  const fetcher=async(url,init)=>{
   const path=new URL(url).pathname.split('/').at(-1),args=JSON.parse(init.body);routes.push(path);
   const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
   if(path==='dlkt_info_claim_public_refresh')return json(await storage.ledger.claim(args.p_worker_id,args.p_trigger));
   if(path==='dlkt_info_read_public_snapshot')return json(await storage.ledger.read());
   if(path==='dlkt_info_publish_public_snapshot'){
    const claim=storage.stageCalls[0].claim;assert.equal(args.p_fence,claim.fence);assert.equal(args.p_lease_token,claim.leaseToken);
    const committed=await storage.ledger.publish(claim,args.p_snapshot,args.p_digest);
    if(responseMode==='malformed-envelope')return json({...committed,privateField:'CONTROLLED_UNTRUSTED_FIELD'});
    if(responseMode==='undecodable-body')return new Response('{',{headers:{'content-type':'application/json'}});
    throw Error('CONTROLLED_TRANSPORT_LOSS');
   }
   assert.fail('unexpected write or RPC '+path);
  };
  const ledger=createRefreshLedger(environment,fetcher);assert.ok(ledger);
  const receipt=await new ContinuousSnapshotService(ledger,async()=>value,null,()=>now,45000,storage.corpus).refresh();
  assert.equal(receipt.persistedReadback,true);assert.equal(receipt.snapshotDigest,publicSnapshotDigest(value.snapshot));
  assert.equal(receipt.revision,storage.committed.revision);
  assert.equal(JSON.stringify(receipt).includes('CONTROLLED_UNTRUSTED_FIELD'),false);
  assert.equal(routes.filter(path=>path==='dlkt_info_publish_public_snapshot').length,1);
  assert.equal(routes.filter(path=>path==='dlkt_info_read_public_snapshot').length,2);
  assert.deepEqual(storage.failures,[]);assert.equal(storage.stageCalls.length,1);
 }
});
