import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/iceo.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/header.css',import.meta.url),'utf8');
const theme=readFileSync(new URL('../public/reader-theme.css',import.meta.url),'utf8');
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
 assert.doesNotMatch(reader,/home-local-more|remainingLocal|local\.supporting\.slice\(2\)/,'all selected local cards stay directly in the continuous grid');
});
test('backend groups and balances the complete edition before projecting category pages',()=>{
 const grouping=backend.indexOf('groups=groupNewsStories('),balancing=backend.indexOf('balanceNewsEdition(selection.items,');
 assert.ok(grouping>0&&balancing>grouping,'source groups are complete before their representatives are balanced');
 assert.match(backend,/iptc17-local-national-world-publisher-rounds-20261127-r8/);
 assert.doesNotMatch(backend,/sort\(\(a,b\)=>scopePriority\(a\)-scopePriority\(b\)\)/,'geography is composed with publisher diversity before pagination, not patched onto individual pages');
 assert.match(backend,/this\.orders\.set\(key,result\)/,'the complete order remains immutable between pages');
});
test('redundant Use my location button is absent in all supported languages',()=>{
 const heading=html.match(/<div class="glance-heading">([\s\S]*?)<div class="glance-utilities">/u)?.[1];
 assert.ok(heading,'main utility heading exists');
 assert.doesNotMatch(heading,/glance-locate|Use my location/);
 assert.doesNotMatch(html,/id="glance-locate"/);
 assert.match(html,/id="locate-place"/,'the functional location option remains in the city chooser');
 assert.doesNotMatch(css,/glance-locate/);
 assert.doesNotMatch(glance,/glance-locate|Foloseste locatia mea|Usa la mia posizione/);
 assert.doesNotMatch(source,/glance-locate|Foloseste locatia mea|Usa la mia posizione/);
 assert.match(html,/id="glance-city"/);
});
test('mobile utility controls use explicit rows and display one date with complete city and values',()=>{
 assert.match(theme,/@media\(max-width:760px\)[\s\S]*grid-template-areas:'date date' 'city actions' 'utilities utilities'/);
 assert.match(theme,/#today-glance \.glance-utilities \.text-button\{[^}]*max-width:none[^}]*min-height:44px[^}]*overflow:visible/);
 assert.match(theme,/#today-glance #glance-city-label\{[^}]*white-space:normal;overflow:visible;text-overflow:clip/);
 assert.doesNotMatch(css,/content:attr\(data-compact-date\)/,'the date must not be rendered a second time by generated content');
 assert.match(glance,/weatherQuick\.title\s*=\s*get\('glance-weather-note'\)/);
 assert.match(glance,/forexQuick\.title\s*=\s*get\('glance-forex-note'\)/);
});

