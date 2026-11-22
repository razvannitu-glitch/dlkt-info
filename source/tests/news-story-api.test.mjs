import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleNewsPage} from '../.build/api/news-page.js';
import {NewsPageService,NewsPageError} from '../.build/src/iceo/news-page.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {NOW,iso,hash,article,epoch,CorpusMemoryStore} from './fixtures/news-corpus.mjs';

const KEY='story-api-test-writer-key-'.repeat(3);
const request=(url='/api/news-page?lang=en',headers={},method='GET')=>({method,url,headers});
const response=()=>({statusCode:0,headers:{},body:'',setHeader(name,value){this.headers[name]=value;},end(value=''){this.body=value;}});
const query={language:'en',cityId:null,filter:'all',cursor:null};
const etag=body=>'"'+createHash('sha256').update(body,'utf8').digest('hex')+'"';
function event(id){
 const card=article(id);card.title='COP31 negotiators discuss a new draft agreement: original '+id;card.contentHash=hash(cardContent(card));return card;
}
function reader(cards=[article(1)]){
 return new NewsPageService(new CorpusMemoryStore([epoch(cards)]),KEY,()=>NOW);
}
test('only an anonymous valid first page has a fresh bounded CDN lifetime and an exact-body ETag for GET and HEAD',async()=>{
 const real=reader(),page=await real.read(query);let calls=0;
 const source={async read(){calls++;return page;},async readSources(){throw Error('Unexpected sources');}};
 const get=response();await handleNewsPage(request(),get,source,()=>NOW);
 assert.equal(get.statusCode,200);assert.equal(get.headers['Cache-Control'],'public, max-age=0, s-maxage=10, must-revalidate');
 assert.equal(get.headers.ETag,etag(get.body));assert.equal(get.headers['Content-Type'],'application/json; charset=utf-8');
 assert.equal(get.headers['X-Content-Type-Options'],'nosniff');assert.equal(get.headers['Referrer-Policy'],'no-referrer');
 assert.equal(get.headers['X-DLKT-News-Epoch'],page.epoch);assert.equal(get.headers.Vary,undefined);
 assert.doesNotMatch(get.headers['Cache-Control'],/stale-while-revalidate|stale-if-error/);
 const head=response();await handleNewsPage(request(undefined,{},'HEAD'),head,source,()=>NOW);
 assert.equal(head.statusCode,200);assert.equal(head.body,'');assert.equal(head.headers.ETag,get.headers.ETag);assert.equal(head.headers['Cache-Control'],get.headers['Cache-Control']);
 const conditional=response();await handleNewsPage(request(undefined,{'if-none-match':'W/'+get.headers.ETag}),conditional,source,()=>NOW);
 assert.equal(conditional.statusCode,304);assert.equal(conditional.body,'');assert.equal(conditional.headers.ETag,get.headers.ETag);assert.equal(calls,3);
 const list=response();await handleNewsPage(request(undefined,{'if-none-match':'"different", '+get.headers.ETag}),list,source,()=>NOW);assert.equal(list.statusCode,304);assert.equal(calls,4);
});
test('the cache TTL is measured after serialization and never extends past the edition expiry',async()=>{
 const real=reader(),base=await real.read(query),page={...base,expiresAt:iso(NOW+9500)};
 let ticks=0;const get=response();
 await handleNewsPage(request(),get,{read:async()=>page},()=>NOW+(ticks++===0?0:2200));
 assert.equal(get.statusCode,200);assert.equal(get.headers['Cache-Control'],'public, max-age=0, s-maxage=7, must-revalidate');
 const short=response();await handleNewsPage(request(),short,{read:async()=>({...base,expiresAt:iso(NOW+999)})},()=>NOW);
 assert.equal(short.statusCode,200);assert.equal(short.headers['Cache-Control'],'no-store');assert.equal(short.headers.ETag,undefined);
 const expired=response();let reads=0;await handleNewsPage(request(undefined,{'if-none-match':'*'}),expired,{read:async()=>{reads++;return page;}},()=>Date.parse(page.expiresAt));
 assert.equal(expired.statusCode,503);assert.equal(expired.headers['Cache-Control'],'no-store');assert.equal(expired.headers.ETag,undefined);assert.equal(reads,1);
 const elapsed=response();let clockCalls=0;await handleNewsPage(request(),elapsed,{read:async()=>page},()=>clockCalls++===0?NOW:Date.parse(page.expiresAt));
 assert.equal(elapsed.statusCode,410);assert.equal(elapsed.headers['Cache-Control'],'no-store');assert.equal(elapsed.headers.ETag,undefined);
});
test('credential-bearing first pages, cursor pages and source-detail pages keep no-store and never emit304',async()=>{
 const real=reader(Array.from({length:25},(_,index)=>article(100+index))),first=await real.read(query);
 for(const headers of [{authorization:'Bearer controlled-fixture'},{cookie:'controlled=fixture'}]){
  const result=response();await handleNewsPage(request(undefined,{...headers,'if-none-match':'*'}),result,real,()=>NOW);
  assert.equal(result.statusCode,200);assert.equal(result.headers['Cache-Control'],'no-store');assert.equal(result.headers.ETag,undefined);
 }
 const next=response();await handleNewsPage(request('/api/news-page?lang=en&cursor='+first.nextCursor,{'if-none-match':'*'}),next,real,()=>NOW);
 assert.equal(next.statusCode,200);assert.equal(JSON.parse(next.body).items.length,5);assert.equal(next.headers['Cache-Control'],'no-store');assert.equal(next.headers.ETag,undefined);
 const grouped=reader(Array.from({length:7},(_,index)=>event(200+index))),main=await grouped.read(query),token=main.items[0].story.nextSourcesCursor;
 const sources=response();await handleNewsPage(request('/api/news-page?sources='+token,{'if-none-match':'*'}),sources,grouped,()=>NOW);
 assert.equal(sources.statusCode,200);assert.equal(sources.headers['Cache-Control'],'no-store');assert.equal(sources.headers.ETag,undefined);
 const value=JSON.parse(sources.body);assert.equal(value.offset,4);assert.equal(value.sources.length,3);assert.equal(value.sourceTotal,7);assert.equal(value.nextCursor,null);
 const head=response();await handleNewsPage(request('/api/news-page?sources='+token,{},'HEAD'),head,grouped,()=>NOW);
 assert.equal(head.statusCode,200);assert.equal(head.body,'');assert.equal(head.headers['Cache-Control'],'no-store');
});
test('strict query errors, unavailable or invalid pages, expired cursors and unsupported methods remain uncacheable',async()=>{
 const real=reader(Array.from({length:6},(_,index)=>event(300+index))),page=await real.read(query),token=page.items[0].story.nextSourcesCursor;
 let calls=0;const source={async read(){calls++;return page;},async readSources(){calls++;return real.readSources(token);}};
 for(const url of ['/api/news-page?sources='+token+'&lang=en','/api/news-page?sources='+token+'&sources='+token,
  '/api/news-page?sources='+token+'&url=https://example.org','/api/news-page?lang=en&_vercel_share=fixture']){
  const bad=response();await handleNewsPage(request(url,{'if-none-match':'*'}),bad,source,()=>NOW);assert.equal(bad.statusCode,400);assert.equal(bad.headers['Cache-Control'],'no-store');
 }
 assert.equal(calls,0);
 const post=response();await handleNewsPage(request(undefined,{},'POST'),post,source,()=>NOW);
 assert.equal(post.statusCode,405);assert.equal(post.headers.Allow,'GET, HEAD');assert.equal(calls,0);
 for(const failed of [null,{read:async()=>({...page,articleTotal:0})},{read:async()=>{throw Error('Unavailable');}}]){
  const bad=response();await handleNewsPage(request(undefined,{'if-none-match':'*'}),bad,failed,()=>NOW);
  assert.equal(bad.statusCode,503);assert.equal(bad.headers['Cache-Control'],'no-store');assert.equal(bad.headers['Retry-After'],'30');assert.equal(bad.headers.ETag,undefined);
 }
 const expired=response();await handleNewsPage(request('/api/news-page?sources='+token),expired,{readSources:async()=>{throw new NewsPageError('NEWS_EDITION_EXPIRED');}},()=>NOW);
 assert.equal(expired.statusCode,410);assert.equal(expired.headers['Cache-Control'],'no-store');assert.equal(expired.headers.ETag,undefined);
});
