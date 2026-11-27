import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {QualifiedSourceIntent,SOURCE_INTENT_VERSION,SOURCE_INTENT_PURPOSE,SOURCE_INTENT_NOTICE,SOURCE_INTENT_CATEGORIES,INTENT_DOCUMENT_LIMIT,readSourceIntentPermit,startEditorialSourceIntent} from '../.build/src/audience/editorial-source-intent.js';
import {NEWS_CATEGORIES} from '../.build/src/iceo/news-taxonomy.js';

const article=(n,category='13000000',visible=true)=>{const article=n.toString(16).padStart(24,'0');return {article,key:'article:'+article,category,visible};};
const frames=(ledger,a,b,cards)=>{for(let t=a;t<=b;t+=100)ledger.frame(t,cards);};
const totals=ledger=>ledger.snapshot().rows.reduce((s,r)=>[s[0]+r.qualifiedImpressions,s[1]+r.sourceIntents],[0,0]);
const now=Date.parse('2026-11-27T12:00:00Z');
const grant=()=>({state:'confirmed',purpose:SOURCE_INTENT_PURPOSE,noticeVersion:SOURCE_INTENT_NOTICE,pilotEligible:true,revision:1,issuedAt:now-1000,expiresAt:now+60000});
test('independent exact permit is required; general audience consent or invalid lifetime cannot mount',()=>{
 assert.deepEqual(readSourceIntentPermit(grant(),now),grant());
 for(const value of [true,'allow',null,{...grant(),purpose:'audience'},{...grant(),state:'pending'},{...grant(),noticeVersion:'old'},{...grant(),pilotEligible:false},{...grant(),revision:0},{...grant(),expiresAt:now},{...grant(),issuedAt:now+1},{...grant(),expiresAt:now+900001},{...grant(),accountId:'x'}])assert.equal(readSourceIntentPermit(value,now),null);
 assert.equal(startEditorialSourceIntent(()=>grant()).snapshot().status,'stopped','no server-side browser mount');
 assert.ok(SOURCE_INTENT_CATEGORIES.every(id=>NEWS_CATEGORIES.some(c=>c.id===id)));
});
test('intent requires one full second of qualified exposure and cannot exceed its own denominator',()=>{
 const l=new QualifiedSourceIntent(),a=article(1);frames(l,0,900,[a]);assert.equal(l.activate(a),false);assert.deepEqual(totals(l),[0,0]);
 l.frame(1000,[a]);assert.deepEqual(totals(l),[1,0]);assert.equal(l.activate(a),true);assert.equal(l.activate(a),false);assert.deepEqual(totals(l),[1,1]);
 assert.equal(l.activate(article(2)),false);assert.equal(l.snapshot().version,SOURCE_INTENT_VERSION);
});
test('a below-threshold frame, missing card or sampling interruption restarts dwell',()=>{
 for(const bad of [[article(1,'13000000',false)],[]]){
  const l=new QualifiedSourceIntent(),a=article(1);frames(l,0,900,[a]);l.frame(1000,bad);frames(l,1100,2000,[a]);assert.deepEqual(totals(l),[0,0]);l.frame(2100,[a]);assert.deepEqual(totals(l),[1,0]);
 }
 const l=new QualifiedSourceIntent(),a=article(1);frames(l,0,900,[a]);l.frame(1200,[a]);frames(l,1300,2100,[a]);assert.deepEqual(totals(l),[0,0]);l.frame(2200,[a]);assert.deepEqual(totals(l),[1,0]);
});
test('prior qualified identity persists through stable rerender but cannot act while absent',()=>{
 const l=new QualifiedSourceIntent(),a=article(1);frames(l,0,1000,[a]);l.invalidate();assert.equal(l.activate(a),false);
 l.frame(1100,[]);assert.equal(l.activate(a),false);l.frame(1200,[a]);assert.equal(l.activate(a),true);
 frames(l,1300,2500,[a]);assert.deepEqual(totals(l),[1,1]);
});
test('changed primary article, grouping or category holds and clears the document',()=>{
 const a=article(1),key='story:'+'a'.repeat(64),group={...a,key};
 for(const [old,changed] of [[a,{...a,category:'15000000'}],[a,group],[group,{...article(2),key}]]){
  const l=new QualifiedSourceIntent();frames(l,0,1000,[old]);l.frame(1100,[changed]);assert.equal(l.snapshot().status,'held');assert.deepEqual(l.snapshot().rows,[]);
 }
});
test('duplicates, bad keys, excluded categories and nonmonotonic clocks fail closed',()=>{
 const a=article(1);
 for(const cards of [[a,a],[{...a,key:'https://example.invalid'}],[article(2,'07000000')],[{...a,visible:'yes'}]]){
  const l=new QualifiedSourceIntent();l.frame(0,cards);assert.equal(l.snapshot().status,'held');
 }
 const l=new QualifiedSourceIntent();l.frame(100,[a]);l.frame(99,[a]);assert.equal(l.snapshot().status,'held');
});
test('capacity includes all observed eligible identities and stop discards all in-memory data',()=>{
 const l=new QualifiedSourceIntent(),many=Array.from({length:INTENT_DOCUMENT_LIMIT},(_,i)=>article(i+1));
 l.frame(0,many);l.frame(100,[article(INTENT_DOCUMENT_LIMIT+1)]);assert.equal(l.snapshot().status,'held');
 const other=new QualifiedSourceIntent(),a=article(1);frames(other,0,1000,[a]);other.activate(a);
 for(const row of other.snapshot().rows)assert.deepEqual(Object.keys(row).sort(),['category','qualifiedImpressions','sourceIntents']);
 other.stop();other.frame(1100,[a]);assert.equal(other.activate(a),false);assert.deepEqual(other.snapshot().rows,[]);
});
test('new metric is not an alias for article opens and has no public mount, persistence or transport',()=>{
 const files=['../public/iceo.js','../public/iceo.html','../scripts/prepare-public-release.mjs','../api/admin.ts','../api/audience.ts'];
 for(const path of files)assert.doesNotMatch(readFileSync(new URL(path,import.meta.url),'utf8'),/editorial-source-intent|startEditorialSourceIntent/u);
 const src=readFileSync(new URL('../src/audience/editorial-source-intent.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/\bfetch\s*\(|sendBeacon\s*\(|localStorage|sessionStorage|indexedDB|document\.cookie|attributableOpens/u);
});
