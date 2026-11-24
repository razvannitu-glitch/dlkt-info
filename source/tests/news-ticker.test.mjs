import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDocument,DomUtils} from 'htmlparser2';
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
test('ordinary headlines stay out of the reserved ribbon and source links retain a visible static reading path',()=>{
 const html=readFileSync('public/iceo.html','utf8');assert.match(html,/id="glance-ticker-track"[^>]*aria-hidden="true"/u);assert.match(html,/id="glance-read"[^>]*aria-controls="glance-list"/u);assert.doesNotMatch(html,/glance-(?:motion-)?pause|glance-motion-note|Pause moving updates|Resume moving updates/u);
 const ribbon=html.match(/<div id="glance-ribbon" class="glance-ribbon" hidden aria-hidden="true">([\s\S]*?)<p id="glance-screen-summary"/u)?.[1];assert.ok(ribbon);assert.doesNotMatch(ribbon,/<button|<input/iu);
 const controller=readFileSync('src/glance/browser.ts','utf8');assert.match(controller,/new NewsTicker/u);assert.match(controller,/ticker\.update\(\[\]\)/u);assert.match(controller,/ribbon\.hidden=true/u);assert.match(controller,/ribbon\.setAttribute\('aria-hidden','true'\)/u);
 const custom=html.match(/<dialog id="glance-customize"[\s\S]*?<\/dialog>/u)?.[0];assert.ok(custom);assert.doesNotMatch(custom,/Moving updates|\b(?:Pause|Resume|Play)\b/u);
 for(const id of ['glance-show-weather','glance-show-forex'])assert.match(custom,new RegExp(`id="${id}" type="checkbox"`));
 assert.doesNotMatch(readFileSync('public/iceo.css','utf8'),/\.glance-pause/u);
 for(const id of ['glance-weather','glance-forex','glance-weather-quick','glance-forex-quick','glance-headsup','glance-list','glance-screen-summary'])assert.equal(html.split(`id="${id}"`).length-1,1);
 assert.doesNotMatch(html,/<marquee|>LIVE<|>BREAKING</iu);
 const document=parseDocument(html),findId=(id,children=document.children)=>DomUtils.findAll(element=>element.attribs?.id===id,children);
 const section=findId('today-glance')[0],drawer=findId('glance-list')[0];assert.ok(section);assert.ok(drawer);
 const heading=DomUtils.findAll(element=>element.attribs?.class?.split(/\s+/u).includes('glance-heading'),section.children)[0];assert.ok(heading);
 const utilities=DomUtils.findAll(element=>element.attribs?.class?.split(/\s+/u).includes('glance-utilities'),section.children)[0];assert.ok(utilities);
 assert.equal(findId('glance-read',heading.children).length,1,'the stable details action stays in the main toolbar');
 assert.equal(findId('glance-read',utilities.children).length,0,'an unavailable utility does not leave a lone second-row command');
 assert.deepEqual(utilities.children.filter(element=>element.name==='button').map(element=>element.attribs.id),['glance-weather-quick','glance-forex-quick']);
 for(const id of ['glance-weather-quick','glance-forex-quick'])assert.notEqual(findId(id,utilities.children)[0].attribs.hidden,undefined,'unverified values begin hidden');
 assert.equal(findId('glance-news-sources',drawer.children).length,1);assert.equal(findId('glance-status',section.children).length,0,'technical source status does not create a third toolbar row');
 assert.equal(findId('glance-status',drawer.children).length,1,'source availability remains visible in the detail drawer');
 assert.equal(findId('glance-read')[0].attribs['aria-describedby'],'glance-status');
 assert.ok(!findId('glance-read')[0].attribs.class.split(/\s+/u).includes('sr-only'),'the sources action itself is visible');
 assert.ok(findId('glance-read')[0].attribs['aria-label'],'the icon action has a readable name');
 assert.equal(findId('glance-read-label',heading.children).length,1,'localization does not replace the button icon');

 assert.equal(findId('glance-locate',heading.children).length,0,'redundant location toolbar action is absent');
 assert.equal(findId('glance-city',heading.children)[0].attribs['aria-controls'],'place-dialog');
 for(const id of ['glance-date','glance-city','reader-language','reader-theme-toggle'])assert.equal(findId(id,heading.children).length,1);
});
