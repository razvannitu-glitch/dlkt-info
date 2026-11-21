import test from 'node:test';import assert from 'node:assert/strict';
import {DAILY_INTERESTS,RECOMMENDED_DAILY_TOPICS,interestState,toggleInterest} from '../.build/src/daily/interests.js';
import {profileKey,validProfile} from '../.build/src/daily/contracts.js';
import {PUBLIC_TOPICS} from '../.build/src/iceo/topics.js';
const planet=DAILY_INTERESTS.find(i=>i.id==='science-planet');
test('a legacy space-only profile stays partial without adding environment',()=>{
 const topics=['science','regulation'];const before=[...topics];assert.equal(interestState(planet,topics),'mixed');assert.deepEqual(topics,before);
 const profile={cityId:null,topics,query:'mission',budget:6,timezone:'Europe/Bucharest'};assert.ok(validProfile(profile));assert.equal(profileKey(profile),profileKey({...profile,topics:[...topics]}));
});
test('an explicit partial-group toggle fills the group, then removes only that group',()=>{
 const source=['science','health','opportunities'];const selected=toggleInterest('science-planet',source);assert.ok(selected.includes('science')&&selected.includes('environment'));assert.equal(interestState(planet,selected),'true');assert.ok(selected.includes('health')&&selected.includes('opportunities'));assert.deepEqual(source,['science','health','opportunities']);
 const removed=toggleInterest('science-planet',selected);assert.deepEqual(new Set(removed),new Set(['health','opportunities']));assert.equal(interestState(planet,removed),'false');
});
test('a single-topic category preserves professional interests and unrelated choices',()=>{
 const source=['regulation','opportunities','technology'];const next=toggleInterest('health',source);assert.deepEqual(new Set(next),new Set([...source,'health']));assert.deepEqual(new Set(toggleInterest('health',next)),new Set(source));
});
test('unknown category fails without modifying a saved selection',()=>{
 const source=['science'];assert.throws(()=>toggleInterest('not-a-category',source),/DAILY_INTEREST_UNKNOWN/);assert.deepEqual(source,['science']);
});
test('balanced suggestion is a valid optional preview, leaving prior configuration unchanged',()=>{
 const saved={cityId:null,topics:['technology'],query:'node',budget:6,timezone:'UTC'},key=profileKey(saved);
 const preview={...saved,topics:[...RECOMMENDED_DAILY_TOPICS],query:'',budget:8};assert.ok(validProfile(preview));assert.notEqual(profileKey(preview),key);assert.equal(profileKey(saved),key);assert.ok(!preview.topics.includes('regulation')&&!preview.topics.includes('opportunities'));
});

test('each topic belongs to exactly one interest group and professional selections count once',()=>{
 const allTopics=DAILY_INTERESTS.flatMap(interest=>interest.topics);
 assert.equal(new Set(DAILY_INTERESTS.map(interest=>interest.id)).size,DAILY_INTERESTS.length);
 assert.equal(allTopics.length,20);assert.deepEqual(new Set(allTopics),new Set(PUBLIC_TOPICS.filter(topic=>topic!=='other')));
 assert.equal(new Set(allTopics).size,allTopics.length,'overlapping groups would count one topic more than once');
 const selected=['regulation','opportunities'];
 const groups=DAILY_INTERESTS.filter(interest=>interestState(interest,selected)!=='false');
 assert.equal(groups.length,2);assert.deepEqual(new Set(groups.flatMap(interest=>interest.topics)),new Set(selected));
 assert.equal(DAILY_INTERESTS.filter(interest=>interestState(interest,[...selected,'health'])!=='false').length,3);
 assert.deepEqual(selected,['regulation','opportunities'],'counting is not a saved-profile mutation');
});
