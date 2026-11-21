import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tickerGeometry,TICKER_SPEED} from '../.build/src/glance/ticker.js';
test('ticker groups cover narrow and wide viewports at the same slow reading speed',()=>{
 for(const [viewport,sequence] of [[320,987.25],[1280,987.25],[1920,255.5],[320,31.75]]){
  const plan=tickerGeometry(viewport,sequence);assert.ok(plan);assert.ok(plan.distance>=viewport);assert.ok(plan.distance-viewport<sequence);assert.equal(plan.distance,sequence*plan.copies);assert.ok(Math.abs(plan.distance/(plan.duration/1000)-28)<1e-8);
 }
 assert.equal(TICKER_SPEED,28);
});
test('motion plans reject unmeasurable layouts and pathological copies',()=>{
 for(const [viewport,sequence] of [[0,100],[320,0],[-1,100],[Infinity,100],[320,NaN],[320,-1],[100000,1]])assert.equal(tickerGeometry(viewport,sequence),null);
});
test('ticker keeps a canonical static reading path and hides passive visual repetitions',()=>{
 const html=readFileSync('public/iceo.html','utf8');assert.match(html,/id="glance-ticker-track"[^>]*aria-hidden="true"/u);assert.match(html,/id="glance-read"[^>]*aria-controls="glance-list"/u);assert.doesNotMatch(html,/glance-(?:motion-)?pause|glance-motion-note|Pause moving updates|Resume moving updates/u);
 const ribbon=html.match(/<div class="glance-ribbon">([\s\S]*?)<p id="glance-screen-summary"/u)?.[1];assert.ok(ribbon);assert.doesNotMatch(ribbon,/<button|<input/iu);
 const custom=html.match(/<dialog id="glance-customize"[\s\S]*?<\/dialog>/u)?.[0];assert.ok(custom);assert.doesNotMatch(custom,/Moving updates|\b(?:Pause|Resume|Play)\b/u);
 for(const id of ['glance-show-weather','glance-show-forex','glance-show-key'])assert.match(custom,new RegExp(`id="${id}" type="checkbox"`));
 assert.doesNotMatch(readFileSync('public/iceo.css','utf8'),/\.glance-pause/u);
 for(const id of ['glance-weather','glance-forex','glance-key','glance-headsup','glance-list','glance-screen-summary'])assert.equal(html.split(`id="${id}"`).length-1,1);
 assert.doesNotMatch(html,/<marquee|>LIVE<|>BREAKING</iu);
});
