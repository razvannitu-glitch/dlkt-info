import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsCorpusStore,validNewsCorpusEpoch} from '../.build/src/iceo/news-corpus-store.js';
import {publicSnapshotDigest} from '../.build/src/iceo/refresh-ledger.js';
import {NOW,iso,article,local,epoch} from './fixtures/news-corpus.mjs';
const writer='test-only-corpus-write-key-123456789012345678901234567890';
const environment={DLKT_INFO_SUPABASE_PROJECT_REF:'a'.repeat(20),DLKT_INFO_SUPABASE_URL:'https://'+'a'.repeat(20)+'.supabase.co',DLKT_INFO_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'b'.repeat(30),DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY:writer};
const claim={version:'iceo-refresh-claim-1',state:'claimed',slot:1,fence:1,leaseToken:'00000000-0000-4000-8000-000000000001',leaseExpiresAt:iso(NOW+90000),retryAt:null};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('store stages an exact digest under the existing lease and exposes no writable capability without its configured authority',async()=>{
 const value=epoch([article(1)]),calls=[];const store=createNewsCorpusStore(environment,async(url,init)=>{
  calls.push([String(url),init]);const args=JSON.parse(init.body);return json({epoch:String(args.p_fence),digest:args.p_digest});},()=>NOW);
 assert.ok(store);assert.equal(createNewsCorpusStore({...environment,DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY:undefined}),null);
 assert.deepEqual(await store.stage(claim,value.corpus),{epoch:'1',digest:publicSnapshotDigest(value.corpus)});
 const [url,init]=calls[0];assert.ok(url.endsWith('/dlkt_info_stage_news_corpus'));assert.equal(init.headers['x-dlkt-share-write'],writer);
 assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(JSON.parse(init.body).p_diagnostics,null);
 assert.equal(JSON.stringify(await store.stage(claim,value.corpus)).includes(writer),false);
 await assert.rejects(store.stage({...claim,leaseExpiresAt:iso(NOW)},value.corpus),/NEWS_CORPUS_INVALID/);
 await assert.rejects(store.stage(claim,{...value.corpus,privateToken:'hidden'}),/NEWS_CORPUS_INVALID/);
});
test('read coalesces exact committed epochs, checks digest and fails closed on unknown public fields',async()=>{
 const value=epoch([article(1)]);let calls=0,now=NOW;
 const store=createNewsCorpusStore(environment,async()=>{calls++;return json(value);},()=>now);
 const pages=await Promise.all(Array.from({length:10},()=>store.read()));assert.equal(calls,1);assert.ok(pages.every(page=>page.epoch==='1'));
 assert.deepEqual(await store.read('1'),value);assert.equal(calls,1);now+=10001;await store.read();assert.equal(calls,2);
 for(const mutate of [bad=>{bad.digest='a'.repeat(64);},bad=>{bad.corpus.cards[0].title='Changed without a revision';},bad=>{bad.diagnostics={};},bad=>{bad.leaseToken=claim.leaseToken;},bad=>{bad.expiresAt=iso(NOW+7200000);} ]){
  const bad=structuredClone(value);mutate(bad);assert.equal(validNewsCorpusEpoch(bad,NOW),false);
  const invalid=createNewsCorpusStore(environment,async()=>json(bad),()=>NOW);await assert.rejects(invalid.read(),/NEWS_CORPUS_UNAVAILABLE/);}
});
test('lookup requests an exact older still-valid local revision without silently switching to the latest feed hash',async()=>{
 const old=local(1),newer=local(2),article=old.snapshot.articles[0];assert.notEqual(article.documentHash,newer.snapshot.articles[0].documentHash);
 const calls=[],store=createNewsCorpusStore(environment,async(url,init)=>{calls.push([String(url),JSON.parse(init.body)]);return json({kind:'local',article,city:old.city});},()=>NOW);
 const found=await store.lookup({id:article.id,revision:article.documentHash,cityId:old.city.id});
 assert.equal(found.kind,'local');assert.equal(found.card.news.documentHash,article.documentHash);assert.equal(found.card.title,article.title);
 assert.ok(calls[0][0].endsWith('/dlkt_info_find_news_corpus_article'));assert.equal(calls[0][1].p_epoch,null);
 assert.equal(calls[0][1].p_revision,article.documentHash);
 const bad=createNewsCorpusStore(environment,async()=>json({kind:'local',article:newer.snapshot.articles[0],city:old.city}),()=>NOW);
 await assert.rejects(bad.lookup({id:article.id,revision:article.documentHash,cityId:old.city.id}),/NEWS_CORPUS_UNAVAILABLE/);
});
test('RPC response limits reject unbounded or non-JSON payloads without exposing upstream error bodies',async()=>{
 for(const response of [
  ()=>new Response('private backend detail',{status:403,headers:{'content-type':'application/json'}}),
  ()=>new Response('{}',{headers:{'content-type':'text/html'}}),
  ()=>new Response('{}',{headers:{'content-type':'application/json','content-length':String(9*1024*1024)}}),
  ()=>new Response('not json',{headers:{'content-type':'application/json'}}),
 ]){
  const store=createNewsCorpusStore(environment,async()=>response(),()=>NOW);await assert.rejects(store.read(),error=>error.message==='NEWS_CORPUS_UNAVAILABLE');
 }
});

const reference=card=>({id:card.id,revision:card.contentHash});
test('concurrent exact photo references share one RPC and return isolated validated public records',async()=>{
 const card=article(11),value={kind:'global',card};let calls=0,release;
 const barrier=new Promise(resolve=>{release=resolve;});
 const store=createNewsCorpusStore(environment,async()=>{calls++;await barrier;return json(value);},()=>NOW);
 const requests=Array.from({length:32},()=>store.lookup(reference(card)));
 assert.equal(calls,1);release();
 const found=await Promise.all(requests);assert.ok(found.every(item=>item.kind==='global'&&item.card.contentHash===card.contentHash));
 assert.equal(calls,1);assert.notEqual(found[0].card,found[1].card);
 found[0].card.title='A caller changed its own copy';found[0].card.privateToken='must-not-propagate';
 const fresh=await store.lookup(reference(card));
 assert.equal(calls,2);assert.equal(fresh.card.title,card.title);assert.equal(fresh.card.privateToken,undefined);
 assert.equal(JSON.stringify(fresh).includes(writer),false);
});
test('in-flight lookups separate identities, revisions, epochs and local references',async()=>{
 const first=article(12),revised=article(12,{published:NOW-20000}),other=article(13),cityEntry=local(1),localArticle=cityEntry.snapshot.articles[0];
 assert.notEqual(first.contentHash,revised.contentHash);
 let release;const barrier=new Promise(resolve=>{release=resolve;}),calls=[],values=new Map([first,revised,other].map(card=>[card.contentHash,card]));
 const store=createNewsCorpusStore(environment,async(_url,init)=>{
  const args=JSON.parse(init.body);calls.push(args);await barrier;
  return json(args.p_city_id?{kind:'local',article:localArticle,city:cityEntry.city}:{kind:'global',card:values.get(args.p_revision)});
 },()=>NOW);
 const localRef={id:localArticle.id,revision:localArticle.documentHash,cityId:cityEntry.city.id};
 const requests=[store.lookup(reference(first)),store.lookup(reference(first)),store.lookup(reference(revised)),store.lookup(reference(other)),
  store.lookup(reference(first),'1'),store.lookup(reference(first),'2'),store.lookup(localRef),store.lookup(localRef)];
 assert.equal(calls.length,6);release();
 const found=await Promise.all(requests);
 assert.equal(found[2].card.contentHash,revised.contentHash);assert.equal(found[3].card.id,other.id);assert.equal(found[6].kind,'local');
 assert.deepEqual(calls.slice(3,5).map(call=>call.p_epoch),[1,2]);
 await assert.rejects(store.lookup({...localRef,cityId:'3165524'}),/NEWS_CORPUS_INVALID/);assert.equal(calls.length,6);
 await store.lookup(reference(first));assert.equal(calls.length,7);
});
test('every completed lookup consults current committed-epoch authority even while the article remains fresh',async()=>{
 const card=article(17);let calls=0,now=NOW;
 const store=createNewsCorpusStore(environment,async()=>{calls++;return json(calls===2?null:{kind:'global',card});},()=>now);
 assert.equal((await store.lookup(reference(card),'1')).card.id,card.id);
 now++;assert.equal(await store.lookup(reference(card),'1'),null);assert.equal(calls,2);
 now++;assert.equal((await store.lookup(reference(card),'1')).card.id,card.id);assert.equal(calls,3);
});
test('repeated references remain subject to article freshness, local expiry and rights review',async()=>{
 let now=NOW,calls=0;
 const card=article(21,{observed:NOW-3599995});
 const store=createNewsCorpusStore(environment,async()=>{calls++;return json({kind:'global',card});},()=>now);
 await store.lookup(reference(card));now+=5;
 await assert.rejects(store.lookup(reference(card)),/NEWS_CORPUS_UNAVAILABLE/);assert.equal(calls,2);
 const entry=local(1),localArticle=entry.snapshot.articles[0];
 now=Date.parse(localArticle.validUntil)-1;let localCalls=0;
 const localStore=createNewsCorpusStore(environment,async()=>{localCalls++;return json({kind:'local',article:localArticle,city:entry.city});},()=>now);
 const localRef={id:localArticle.id,revision:localArticle.documentHash,cityId:entry.city.id};
 await localStore.lookup(localRef);now++;
 await assert.rejects(localStore.lookup(localRef),/NEWS_CORPUS_UNAVAILABLE/);assert.equal(localCalls,2);
 const {ICEO_SOURCES}=await import('../.build/src/iceo/registry.js'),source=ICEO_SOURCES.find(item=>item.id==='news-unclassified');
 assert.ok(source);now=Date.parse(source.rightsReviewBy+'T23:59:59.000Z');
 const reviewed=article(22,{now});let rightsCalls=0;
 const rightsStore=createNewsCorpusStore(environment,async()=>{rightsCalls++;return json({kind:'global',card:reviewed});},()=>now);
 await rightsStore.lookup(reference(reviewed));now+=2000;
 await assert.rejects(rightsStore.lookup(reference(reviewed)),/NEWS_CORPUS_UNAVAILABLE/);assert.equal(rightsCalls,2);
});
test('time advancing during a shared lookup cannot return an expired record',async()=>{
 let now=NOW,calls=0,release;
 const card=article(31,{observed:NOW-3599995}),barrier=new Promise(resolve=>{release=resolve;});
 const store=createNewsCorpusStore(environment,async()=>{calls++;await barrier;return json({kind:'global',card});},()=>now);
 const first=store.lookup(reference(card)),second=store.lookup(reference(card));
 const results=Promise.allSettled([first,second]);now+=6;release();
 const settled=await results;assert.equal(calls,1);
 assert.ok(settled.every(result=>result.status==='rejected'&&result.reason.message==='NEWS_CORPUS_UNAVAILABLE'));
 now=NOW;assert.equal((await store.lookup(reference(card))).card.id,card.id);assert.equal(calls,2);
});
test('lookup failures and absent records remain retryable and private fields are never exposed',async()=>{
 const card=article(41);let calls=0;
 const store=createNewsCorpusStore(environment,async()=>{
  calls++;if(calls===1)throw new Error('private upstream details');if(calls<=3)return json(null);
  if(calls===4)return json({kind:'global',card:{...card,privateToken:'hidden'}});
  return json({kind:'global',card});
 },()=>NOW);
 await assert.rejects(store.lookup(reference(card)),error=>error.message==='NEWS_CORPUS_UNAVAILABLE');
 assert.equal(await store.lookup(reference(card)),null);assert.equal(await store.lookup(reference(card)),null);
 await assert.rejects(store.lookup(reference(card)),/NEWS_CORPUS_UNAVAILABLE/);
 assert.equal((await store.lookup(reference(card))).card.id,card.id);assert.equal(calls,5);
 await store.lookup(reference(card));assert.equal(calls,6);
});

test('a full pending registry still shares known references and bypasses sharing for new overflow keys',async()=>{
 const cards=Array.from({length:129},(_,index)=>article(3000+index)),byId=new Map(cards.map(card=>[card.id,card]));
 let calls=0,release;const barrier=new Promise(resolve=>{release=resolve;});
 const store=createNewsCorpusStore(environment,async(_url,init)=>{
  calls++;const card=byId.get(JSON.parse(init.body).p_id);await barrier;return json({kind:'global',card});
 },()=>NOW);
 const requests=cards.slice(0,128).map(card=>store.lookup(reference(card)));
 assert.equal(calls,128);
 requests.push(store.lookup(reference(cards[0])));assert.equal(calls,128);
 requests.push(store.lookup(reference(cards[128])),store.lookup(reference(cards[128])));
 assert.equal(calls,130);release();
 const results=await Promise.all(requests);assert.equal(results.length,131);
 assert.ok(results.every(result=>result.kind==='global'));
 await Promise.all([store.lookup(reference(cards[128])),store.lookup(reference(cards[128]))]);
 assert.equal(calls,131);
});
test('each waiter revalidates freshness when time advances after the shared RPC was validated',async()=>{
 const card=article(4001,{observed:NOW-3599995});let calls=0,checks=0,release;
 const barrier=new Promise(resolve=>{release=resolve;});
 const store=createNewsCorpusStore(environment,async()=>{calls++;await barrier;return json({kind:'global',card});},
  ()=>++checks<=2?NOW:NOW+6);
 const first=store.lookup(reference(card)),second=store.lookup(reference(card)),settled=Promise.allSettled([first,second]);
 release();const results=await settled;
 assert.equal(calls,1);assert.equal(checks,3);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[0].value.card.id,card.id);
 assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.message,'NEWS_CORPUS_UNAVAILABLE');
});
