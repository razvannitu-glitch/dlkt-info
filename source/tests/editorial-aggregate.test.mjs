import test from 'node:test';
import assert from 'node:assert/strict';
import {describeEditorialAggregate,EDITORIAL_AGGREGATE_VERSION,EDITORIAL_AGGREGATE_SCOPE,EDITORIAL_PILOT_CATEGORIES,MIN_QUALIFIED_IMPRESSIONS} from '../.build/src/audience/editorial-aggregate.js';
import {NEWS_TAXONOMY_VERSION,NEWS_CATEGORIES} from '../.build/src/iceo/news-taxonomy.js';

const now=new Date('2026-11-27T12:00:00.000Z');
const fixture=()=>({
 version:EDITORIAL_AGGREGATE_VERSION,scope:EDITORIAL_AGGREGATE_SCOPE,taxonomyVersion:NEWS_TAXONOMY_VERSION,
 day:'2026-11-26',activatedAt:'2026-11-25T00:00:00.000Z',coverage:'complete',
 rows:EDITORIAL_PILOT_CATEGORIES.map((category,i)=>({category,qualifiedImpressions:[1000,400,0,99,100][i],attributableOpens:[120,100,0,40,0][i]}))
});
const report=value=>describeEditorialAggregate(value,now);
const denied=(value,reason='invalid-input')=>assert.deepEqual(report(value),{status:'unavailable',reason,automationAllowed:false});

test('editorial aggregate is descriptive exposure-normalized and retains canonical order, not popularity rank',()=>{
 const input=fixture();input.rows.reverse();const result=report(input);
 assert.equal(result.status,'ready');assert.equal(result.automationAllowed,false);
 assert.equal(result.scope,EDITORIAL_AGGREGATE_SCOPE);assert.equal(result.taxonomyVersion,NEWS_TAXONOMY_VERSION);
 assert.equal(result.day,'2026-11-26');assert.equal(result.activatedAt,'2026-11-25T00:00:00.000Z');
 assert.deepEqual(result.rows.map(r=>r.category),EDITORIAL_PILOT_CATEGORIES);
 assert.equal(result.rows[0].openRate,.12);assert.equal(result.rows[1].openRate,.25);
 assert.equal(result.rows[0].attributableOpens,120);assert.equal(result.rows[1].attributableOpens,100);
 assert.equal(result.rows[1].qualifiedImpressions,400);
});
test('zero exposure, low sample and valid zero open rate are not conflated',()=>{
 const result=report(fixture());
 assert.equal(result.rows[2].status,'no-impressions');assert.equal(result.rows[3].status,'small-sample');
 assert.equal(Object.hasOwn(result.rows[2],'openRate'),false);
 assert.equal(Object.hasOwn(result.rows[3],'qualifiedImpressions'),false);
 assert.equal(Object.hasOwn(result.rows[3],'attributableOpens'),false);
 assert.equal(result.rows[4].qualifiedImpressions,MIN_QUALIFIED_IMPRESSIONS);
 assert.equal(result.rows[4].openRate,0);assert.equal(result.rows[4].status,'descriptive');
});
test('partial coverage, mid-window activation and open day never become valid observations',()=>{
 denied({...fixture(),coverage:'partial'},'incomplete-coverage');
 denied({...fixture(),activatedAt:'2026-11-26T00:00:00.001Z'},'incomplete-coverage');
 denied({...fixture(),day:'2026-11-27'},'window-not-complete');
 assert.equal(report({...fixture(),activatedAt:'2026-11-26T00:00:00.000Z'}).status,'ready');
});
test('invalid dates, invalid clock and noncanonical time precision fail closed',()=>{
 for(const day of ['2026-02-30','2026-11-1','2026-13-01','2026-11-26T00:00:00Z'])denied({...fixture(),day});
 for(const activatedAt of ['2026-11-25T00:00:00Z','2026-11-25T01:00:00.000+01:00','2026-02-30T00:00:00.000Z'])denied({...fixture(),activatedAt});
 assert.equal(describeEditorialAggregate(fixture(),new Date(NaN)).reason,'invalid-input');
});
test('taxonomy and pilot categories are pinned; excluded, duplicate or omitted categories fail closed',()=>{
 assert.ok(EDITORIAL_PILOT_CATEGORIES.every(id=>NEWS_CATEGORIES.some(c=>c.id===id)));
 for(const excluded of ['07000000','11000000','12000000','09000000','14000000','02000000','16000000','08000000','unknown']){
  const input=fixture();input.rows[0].category=excluded;denied(input);
 }
 const duplicate=fixture();duplicate.rows[0].category=duplicate.rows[1].category;denied(duplicate);
 const missing=fixture();missing.rows.pop();denied(missing);
 denied({...fixture(),taxonomyVersion:'other'});denied({...fixture(),version:'other'});denied({...fixture(),scope:'account'});
});
test('contradictory, negative, fractional, unsafe or out-of-bound counts never produce a rate',()=>{
 for(const [qualifiedImpressions,attributableOpens] of [[0,1],[10,11],[-1,0],[100,-1],[1.5,1],[100,1.5],[NaN,0],[Infinity,0],[1000001,0],[100,'1']]){
  const input=fixture();Object.assign(input.rows[0],{qualifiedImpressions,attributableOpens});denied(input);
 }
});
test('strict aggregate allowlist rejects identifier-bearing or additional payload fields',()=>{
 for(const key of ['browserId','accountId','ip','url','query','articleId','city','paymentId','deviceFingerprint']){
  denied({...fixture(),[key]:'example'});
  const input=fixture();input.rows[0][key]='example';denied(input);
 }
 denied(null);denied([]);denied({});denied({...fixture(),rows:null});denied({...fixture(),coverage:'unknown'});
});
test('bounded input includes full-rate observations without claiming significance or automation',()=>{
 const input=fixture();Object.assign(input.rows[0],{qualifiedImpressions:1000000,attributableOpens:1000000});
 const result=report(input);assert.equal(result.rows[0].openRate,1);assert.equal(result.automationAllowed,false);
 assert.equal(Object.hasOwn(result,'ranking'),false);assert.equal(Object.hasOwn(result,'recommendations'),false);
});
