import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {QualifiedExposureLab,EDITORIAL_EXPOSURE_MS,EDITORIAL_DOCUMENT_LIMIT} from '../.build/src/audience/editorial-exposure.js';
import {EDITORIAL_PILOT_CATEGORIES} from '../.build/src/audience/editorial-aggregate.js';

const article=(n,category='05000000',qualified=true)=>({key:'article:'+n.toString(16).padStart(24,'0'),category,qualified});
const story=(n,category='13000000',qualified=true)=>({key:'story:'+n.toString(16).padStart(64,'0'),category,qualified});
const counts=lab=>lab.snapshot().rows.map(row=>row.qualifiedImpressions);
const total=lab=>counts(lab).reduce((a,b)=>a+b,0);
function frames(lab,from,to,cards){for(let time=from;time<=to;time+=100)lab.frame(time,cards);}

test('editorial exposure requires a continuous sequence of qualifying frames for one full second',()=>{
 const lab=new QualifiedExposureLab();
 frames(lab,0,EDITORIAL_EXPOSURE_MS-100,[article(1)]);
 assert.equal(total(lab),0);lab.frame(1000,[article(1)]);assert.equal(total(lab),1);
 assert.equal(lab.snapshot().rows[0].qualifiedImpressions,1);
});
test('a below-threshold frame or absent card resets the dwell without inflating impressions',()=>{
 for(const interrupted of [[article(1,'05000000',false)],[]]){
  const lab=new QualifiedExposureLab();frames(lab,0,900,[article(1)]);
  lab.frame(1000,interrupted);frames(lab,1100,2000,[article(1)]);assert.equal(total(lab),0);
  lab.frame(2100,[article(1)]);assert.equal(total(lab),1);
 }
});
test('background, scroll, resize or uncertain geometry invalidation requires fresh dwell',()=>{
 const lab=new QualifiedExposureLab();frames(lab,0,900,[article(1)]);lab.invalidate();
 frames(lab,1000,1900,[article(1)]);assert.equal(total(lab),0);lab.frame(2000,[article(1)]);assert.equal(total(lab),1);
});
test('a timer gap cannot bridge a suspended or busy tab',()=>{
 const lab=new QualifiedExposureLab();frames(lab,0,800,[article(1)]);
 lab.frame(2000,[article(1)]);assert.equal(total(lab),0);frames(lab,2100,3000,[article(1)]);assert.equal(total(lab),1);
});
test('rerenders and repeated appearances of the same article or stable story count once',()=>{
 const lab=new QualifiedExposureLab();frames(lab,0,1000,[article(1),story(2)]);
 assert.equal(total(lab),2);lab.invalidate();frames(lab,1100,2500,[story(2),article(1)]);
 assert.equal(total(lab),2);assert.deepEqual(counts(lab),[1,0,1,0,0]);
});
test('a category change before qualification resets dwell; after qualification it holds the document',()=>{
 const lab=new QualifiedExposureLab();frames(lab,0,900,[article(1)]);
 frames(lab,1000,1900,[article(1,'13000000')]);assert.equal(total(lab),0);
 lab.frame(2000,[article(1,'13000000')]);assert.equal(total(lab),1);
 lab.frame(2100,[article(1)]);assert.equal(lab.snapshot().status,'held');assert.deepEqual(lab.snapshot().rows,[]);
});
test('duplicate keys, excluded categories, malformed keys and invalid time fail closed',()=>{
 for(const candidates of [[article(1),article(1)],[article(1,'07000000')],[{...article(1),key:'url:https://example.invalid'}],[{...article(1),qualified:1}]]){
  const lab=new QualifiedExposureLab();frames(lab,0,1000,[article(2)]);lab.frame(1100,candidates);assert.equal(lab.snapshot().status,'held');assert.deepEqual(lab.snapshot().rows,[]);
 }
 for(const time of [-1,NaN,Infinity,999]){
  const lab=new QualifiedExposureLab();frames(lab,0,1000,[article(1)]);lab.frame(time,[article(2)]);assert.equal(lab.snapshot().status,'held');
 }
});
test('document bounds prevent unbounded deduplication and suppress a saturated result',()=>{
 const lab=new QualifiedExposureLab(),cards=Array.from({length:EDITORIAL_DOCUMENT_LIMIT},(_,i)=>article(i+1));
 frames(lab,0,1000,cards);assert.equal(total(lab),EDITORIAL_DOCUMENT_LIMIT);
 frames(lab,1100,2100,[article(EDITORIAL_DOCUMENT_LIMIT+1)]);
 assert.equal(lab.snapshot().status,'held');assert.deepEqual(lab.snapshot().rows,[]);
 const overflow=new QualifiedExposureLab();overflow.frame(0,[...cards,article(EDITORIAL_DOCUMENT_LIMIT+1)]);assert.equal(overflow.snapshot().status,'held');
});
test('withdrawal discards all local counts, cannot restart and exposes no card identifiers or opens',()=>{
 const lab=new QualifiedExposureLab();frames(lab,0,1000,[article(1)]);
 const report=lab.snapshot();assert.deepEqual(report.rows.map(row=>row.category),EDITORIAL_PILOT_CATEGORIES);
 for(const row of report.rows)assert.deepEqual(Object.keys(row).sort(),['category','qualifiedImpressions']);
 assert.equal(report.productionActivationAllowed,false);assert.equal(report.automationAllowed,false);
 lab.stop();frames(lab,1100,2200,[article(2)]);assert.equal(lab.snapshot().status,'stopped');assert.deepEqual(lab.snapshot().rows,[]);
});
test('reader has source links, not an instrumented on-site reading action; lab remains unmounted',()=>{
 const html=readFileSync(new URL('../public/iceo.html',import.meta.url),'utf8'),js=readFileSync(new URL('../public/iceo.js',import.meta.url),'utf8');
 assert.match(js,/node\.dataset\.newsStreamKey = item\.key/u);assert.match(js,/node\.dataset\.newsCategory = item\.category/u);
 assert.match(js,/titleLink\.href = sourceUrl/u);assert.match(js,/titleLink\.target = '_blank'/u);
 assert.doesNotMatch(html+js,/editorial-exposure|observeEditorialExposureLab|editorial-pilot/u);
});
