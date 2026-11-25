import test from 'node:test';
import assert from 'node:assert/strict';
import {worldSourceAtlas,stageSourceCandidate} from '../.build/src/iceo/world-source-atlas.js';
import {ICEO_SOURCES} from '../.build/src/iceo/registry.js';
import {NEWS_PUBLISHERS} from '../.build/src/iceo/news-sources.js';

test('world atlas indexes configured feeds, reviewed origins and non-activated candidates separately',()=>{
 const entries=worldSourceAtlas();
 const configured=entries.filter(entry=>entry.status==='configured');
 const originReviewed=entries.filter(entry=>entry.status==='origin-reviewed');
 const candidate=entries.filter(entry=>entry.status==='candidate');
 assert.equal(configured.length,ICEO_SOURCES.length);
 assert.equal(originReviewed.length,NEWS_PUBLISHERS.length);
 assert.ok(candidate.length>=40);
 assert.equal(new Set(entries.map(entry=>entry.id)).size,entries.length);
 assert.ok(new Set(entries.map(entry=>entry.vertical)).size>=12);
 for(const entry of entries){
  assert.equal(new URL(entry.origin).origin,entry.origin);
  assert.equal(new URL(entry.origin).protocol,'https:');
  assert.match(entry.id,/^(configured|publisher|candidate):[a-z0-9-]+$/u);
  if(entry.status==='candidate'){
   assert.equal(entry.acquisition,'discovery-only');
   assert.equal(entry.rights,'source-specific-review-required');
  }
  if(entry.status==='origin-reviewed'){
   assert.equal(entry.acquisition,'origin-index');
   assert.equal(entry.scope,'unknown','publisher home does not establish the story location');
  }
 }
});
test('untrusted discovered hosts are staged, never automatically connected or geolocated',()=>{
 const discovered=stageSourceCandidate('https://new-town-paper.example.org/article?utm_source=testing#details','New town paper');
 assert.ok(discovered);
 assert.equal(discovered.origin,'https://new-town-paper.example.org');
 assert.equal(discovered.id,'discovered:new-town-paper.example.org');
 assert.equal(discovered.status,'candidate');
 assert.equal(discovered.acquisition,'discovery-only');
 assert.equal(discovered.countryCode,null);
 assert.equal(discovered.scope,'unknown');
 assert.equal(stageSourceCandidate('https://www.who.int/news','WHO news'),null);
 for(const url of [
  'http://news.example.org',
  'https://user:password@news.example.org',
  'https://127.0.0.1/article',
  'https://[::1]/article',
  'https://localhost/story',
  'https://news.local/story',
  'https://news.internal/story',
  'https://news.test/story',
  'https://news.onion/story',
  'javascript:alert(1)',
 ])assert.equal(stageSourceCandidate(url,'Unverified'),null,url);
 assert.equal(stageSourceCandidate('https://valid-public-news.example.org/article','<script>'),null);
});
test('atlas has no network activity or authority to register feeds',()=>{
 const atlas=worldSourceAtlas();
 assert.ok(atlas.some(entry=>entry.name==='ReliefWeb / OCHA'));
 assert.ok(atlas.some(entry=>entry.name==='Fundatia Renasterea - Harta Preventiei'));
 assert.ok(atlas.some(entry=>entry.name==='HOSPICE Casa Sperantei'));
 assert.ok(atlas.some(entry=>entry.name==='GDELT Project'));
 assert.ok(atlas.some(entry=>entry.scope==='country'&&entry.countryCode==='RO'));
 assert.ok(atlas.some(entry=>entry.scope==='international'&&entry.countryCode===null));
});

