import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/iceo.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/header.css',import.meta.url),'utf8');
const reader=readFileSync(new URL('../public/iceo.js',import.meta.url),'utf8');
const glance=readFileSync(new URL('../public/glance-browser.js',import.meta.url),'utf8');
const source=readFileSync(new URL('../src/glance/browser.ts',import.meta.url),'utf8');
const backend=readFileSync(new URL('../src/iceo/news-page.ts',import.meta.url),'utf8');

test('verified local cards precede city and global news in one scroll',()=>{
 const local=html.indexOf('<div id="home-local-cards"></div>'),stream=html.indexOf('<div id="discovery-cards"'),pagination=html.indexOf('<div id="home-more-controls"'),extras=html.indexOf('<div id="home-local-extras">');
 assert.ok(local>0&&local<stream&&stream<pagination&&pagination<extras);
 assert.match(reader,/reconcileDiscovery\(support, supportHost\);/);
 assert.match(reader,/reconcileDiscovery\(extras, extrasHost\);/);
 assert.match(reader,/extrasHost\.append\(commercialCardNode\(/);
 assert.match(reader,/extrasHost\.append\(details\)/);
 assert.match(reader,/local\.supporting\.length > 0 \|\| localNewsCount > 0/);
});
test('backend completes the full city-country-world order before pagination',()=>{
 assert.match(backend,/scopePriority=\(group:NewsStoryGroup\)/);
 assert.match(backend,/sort\(\(a,b\)=>scopePriority\(a\)-scopePriority\(b\)\)/);
 assert.match(backend,/iptc17-local-city-country-world-20261123/);
 assert.doesNotMatch(backend,/iptc17-country-day-local-first-20261123/);
});
test('redundant Use my location button is absent in all supported languages',()=>{
 assert.doesNotMatch(html,/glance-locate|Use my location/);
 assert.doesNotMatch(css,/glance-locate/);
 assert.doesNotMatch(glance,/glance-locate|Foloseste locatia mea|Usa la mia posizione/);
 assert.doesNotMatch(source,/glance-locate|Foloseste locatia mea|Usa la mia posizione/);
 assert.match(html,/id="glance-city"/);
});
test('forecast and EUR controls stay on one bounded row with full values in titles',()=>{
 assert.match(css,/#today-glance \.glance-utilities\{[^}]*flex-wrap:nowrap[^}]*overflow:hidden/);
 assert.match(css,/#today-glance \.glance-utilities \.text-button\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
 assert.match(css,/@media\(max-width:600px\)[\s\S]*grid-template-columns:minmax\(0,1fr\) auto/);
 assert.match(glance,/weatherQuick\.title\s*=\s*get\('glance-weather-note'\)/);
 assert.match(glance,/forexQuick\.title\s*=\s*get\('glance-forex-note'\)/);
});
