import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDiscoveryCards,nextDiscoveryDelay,DISCOVERY_TOPICS,DISCOVERY_BUDGET,DISCOVERY_SOURCE_MAX_AGE_MS} from '../.build/src/iceo/reader.js';
const now=Date.parse('2026-11-16T12:00:00Z');
const card=(topic,id,extra={})=>({id:id.toString(16).padStart(24,'0'),identity:`listing:${id}`,title:`Publication ${id}`,topic,kind:'publication',sourceUrl:`https://www.nasa.gov/controlled-${id}`,publisher:topic,sourceIds:['source'],date:'2026-11-15T10:00:00Z',dateLabel:'Published',observedAt:'2026-11-16T12:00:00Z',contentHash:'a'.repeat(64),boundary:'Source listing',deadline:null,version:null,attribution:'Publisher',sourceState:'verified',...extra});
test('welcome mix gives every available topic a turn before repeating, regardless of source volume',()=>{
 const records=[...Array.from({length:35},(_,i)=>card('science',i)),...DISCOVERY_TOPICS.filter(t=>t!=='science').map((t,i)=>card(t,100+i))];const before=JSON.stringify(records);
 const selected=selectDiscoveryCards(records,now);assert.equal(selected.length,DISCOVERY_BUDGET);assert.deepEqual(selected.slice(0,DISCOVERY_TOPICS.length).map(v=>v.card.topic),DISCOVERY_TOPICS);assert.equal(new Set(selected.map(v=>v.card.id)).size,selected.length);assert.equal(JSON.stringify(records),before);
});
test('default discovery excludes software, stale checks, old or future dates, and closed or unconfirmed notices',()=>{
 const records=[card('business',1),card('technology',2),card('health',3,{sourceState:'stale'}),card('science',4,{date:'2026-10-01'}),card('science',5,{date:'2026-11-17'}),card('opportunities',6,{kind:'procurement-notice',title:'Contract Award Notice: Example',deadline:'2026-12-01'}),card('opportunities',7,{kind:'procurement-notice',title:'Contract Notice: Example',deadline:null})];
 assert.deepEqual(selectDiscoveryCards(records,now).map(v=>v.card.id),[records[0].id]);
});
test('discovery stays finite, deduplicated and empty when no eligible sources exist',()=>{
 assert.equal(selectDiscoveryCards([],now).length,0);const a=card('business',1);assert.equal(selectDiscoveryCards([a,a],now).length,1);assert.throws(()=>selectDiscoveryCards([a],NaN),/CLOCK_INVALID/);
});
test('verified labels cannot keep an expired source check in the welcome mix',()=>{
 const a=card('business',1);assert.equal(DISCOVERY_SOURCE_MAX_AGE_MS,3600000);assert.equal(selectDiscoveryCards([a],now+DISCOVERY_SOURCE_MAX_AGE_MS-1).length,1);assert.equal(selectDiscoveryCards([a],now+DISCOVERY_SOURCE_MAX_AGE_MS).length,0);assert.equal(selectDiscoveryCards([card('business',2,{observedAt:new Date(now+300001).toISOString()})],now).length,0);
});
test('welcome projection schedules its source and publication expiry without a background request',()=>{
 const a=card('business',1);assert.equal(nextDiscoveryDelay(selectDiscoveryCards([a],now),now),DISCOVERY_SOURCE_MAX_AGE_MS+1);const old=card('health',2,{date:new Date(now-14*86400000+60000).toISOString()});assert.equal(nextDiscoveryDelay(selectDiscoveryCards([old],now),now),60001);assert.equal(nextDiscoveryDelay([],now),null);
});
