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
