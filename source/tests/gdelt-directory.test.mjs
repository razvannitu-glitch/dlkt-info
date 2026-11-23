import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inspectGdeltDirectoryFeed,collectGdeltDirectoryOnce} from '../.build/src/iceo/gdelt-directory.js';
import {NEWS_INDEX_URL} from '../.build/src/iceo/news-sources.js';

const now=Date.parse('2026-11-23T15:00:00.000Z');
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const rss=(links,options={})=>
 '<rss><channel><title>'+(options.title??'GDELT Article List RSS Feed')+'</title><link>'+
 (options.link??NEWS_INDEX_URL)+'</link><lastBuildDate>'+(options.date??new Date(now).toUTCString())+
 '</lastBuildDate>'+links.map((url,i)=>
 '<item><title>Untrusted headline '+i+'</title><link>'+escape(url)+'</link><description>Do not copy this text</description></item>'
 ).join('')+'</channel></rss>';
const response=(xml,headers={'content-type':'application/rss+xml'})=>new Response(xml,{headers});

test('GDELT stages source origins without licensing, geolocation or copying articles',()=>{
 const xml=rss([
  'https://www.tuvalu-news.example.org/story?id=private',
  'https://tuvalu-news.example.org/second',
  'https://www.who.int/news',
  'https://subdomain.island.example.org/report',
  'https://127.0.0.1/internal',
  'https://user:secret@creds.example.org/story',
 ]);
 const result=inspectGdeltDirectoryFeed(xml,now);
 assert.equal(result.feedItems,6);
 assert.equal(result.proposals.length,2);
 assert.equal(result.previouslyIndexedOrigins,1);
 assert.equal(result.duplicateOrigins,1);
 assert.equal(result.invalidItems,2);
 assert.equal(result.deferredCapacity,0);
 assert.equal(result.activationAllowed,false);
 assert.deepEqual(result.proposals.map(x=>x.candidate.origin),['https://www.tuvalu-news.example.org','https://subdomain.island.example.org']);
 for(const item of result.proposals){
  assert.equal(item.candidate.scope,'unknown');
  assert.equal(item.candidate.countryCode,null);
  assert.equal(item.candidate.status,'candidate');
  assert.equal(item.admission,'manual-review-only');
  assert.equal(item.provenance,'unverified-index-metadata');
  assert.equal(item.recordReference,NEWS_INDEX_URL);
 }
 const published=JSON.stringify(result);
 for(const secret of ['private','second','Untrusted headline','Do not copy this text','user:secret'])assert.equal(published.includes(secret),false);
});
test('GDELT audit caps proposed origin records at 200',()=>{
 const urls=Array.from({length:215},(_,i)=>'https://site-'+i+'.example.org/article');
 const result=inspectGdeltDirectoryFeed(rss(urls),now);
 assert.equal(result.proposals.length,200);
 assert.equal(result.deferredCapacity,15);
 assert.equal(result.uniqueOrigins,215);
 assert.equal(result.activationAllowed,false);
});
test('GDELT spoofed, stale, oversized and entity-bearing documents fail closed',()=>{
 assert.throws(()=>inspectGdeltDirectoryFeed(rss(['https://example.org/a'],{title:'Fake feed'}),now),/NEWS_INDEX_IDENTITY_INVALID/);
 assert.throws(()=>inspectGdeltDirectoryFeed(rss([],{link:'https://attacker.example.org/feed'}),now),/NEWS_INDEX_IDENTITY_INVALID/);
 assert.throws(()=>inspectGdeltDirectoryFeed(rss([],{date:'Sun, 01 Jan 2023 00:00:00 GMT'}),now),/NEWS_INDEX_STALE/);
 assert.throws(()=>inspectGdeltDirectoryFeed('<!DOCTYPE rss [<!ENTITY leak SYSTEM "file:///etc/passwd">]><rss/>',now),/NEWS_INDEX_XML_INVALID/);
 assert.throws(()=>inspectGdeltDirectoryFeed('x'.repeat(3_145_729),now),/NEWS_INDEX_XML_INVALID/);
});
test('collector makes exactly one request to pre-approved GDELT endpoint',async()=>{
 let calls=0;
 const fetcher=async(url,init)=>{
  calls++;
  assert.equal(url,NEWS_INDEX_URL);
  assert.equal(init.method,'GET');
  assert.equal(init.redirect,'manual');
  assert.equal(init.credentials,'omit');
  assert.ok(init.signal);
  return response(rss(['https://news-from-remote.example.org/article']));
 };
 const report=await collectGdeltDirectoryOnce(fetcher,now);
 assert.equal(calls,1);
 assert.equal(report.proposals.length,1);
 assert.equal(report.activationAllowed,false);
});
test('collector rejects redirects, MIME mismatch and overlarge responses',async()=>{
 const sample=rss(['https://example.org/story']);
 await assert.rejects(collectGdeltDirectoryOnce(async()=>new Response('',{status:302,headers:{location:'https://evil.example.org/steal'}}),now),/ICEO_GDELT_REDIRECT_REJECTED/);
 await assert.rejects(collectGdeltDirectoryOnce(async()=>response(sample,{'content-type':'text/html'}),now),/ICEO_GDELT_CONTENT_TYPE_INVALID/);
 await assert.rejects(collectGdeltDirectoryOnce(async()=>response(sample,{'content-type':'application/rss+xml','content-length':'999999999'}),now),/ICEO_GDELT_RESPONSE_TOO_LARGE/);
 await assert.rejects(collectGdeltDirectoryOnce(async()=>response('x'.repeat(3_145_729)),now),/ICEO_GDELT_RESPONSE_TOO_LARGE/);
});
