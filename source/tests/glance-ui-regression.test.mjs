import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const browser = readFileSync(new URL('../public/glance-browser.js', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/header.css', import.meta.url), 'utf8');

test('weather and currency details retain distinct click handlers', () => {
  assert.match(browser, /\['glance-weather', 'weather'\]/);
  assert.match(browser, /\['glance-forex', 'forex'\]/);
  assert.match(browser, /\['glance-weather-quick', 'weather'\]/);
  assert.match(browser, /\['glance-forex-quick', 'forex'\]/);
});

test('source dialog retains a visible, labelled icon control after the moving ribbon is retired', () => {
  assert.match(browser, /read\.addEventListener\('click', \(\) => list\.showModal\(\)\)/);
  assert.match(browser, /get\('glance-read-label'\)\.textContent = locale === 'ro' \? 'Surse si preferinte'/);
  assert.match(browser, /read\.setAttribute\('aria-label'/);
  assert.doesNotMatch(browser, /read\.textContent = locale === 'ro' \? 'Vreme si curs'/);
  const html=readFileSync(new URL('../public/iceo.html', import.meta.url), 'utf8');
  assert.match(html, /id="glance-read" type="button" class="text-button glance-info-button"/);
  assert.match(html, /id="glance-read-label" class="sr-only"/);
  assert.match(html, /aria-label="Information, sources and settings"/);
  assert.match(browser, /ribbon\.hidden = true/);
  assert.match(browser, /ticker\.update\(\[\]\)/);
  assert.match(browser, /list\.showModal\(\)/);
});

test('mobile header preserves 44px utility touch targets', () => {
  assert.match(header, /#today-glance #glance-read\s*\{[^}]*min-height:\s*44px/s);
  assert.match(header, /#today-glance #glance-city\s*\{[^}]*min-height:\s*44px/s);
  assert.match(header, /#today-glance \.glance-utilities \.text-button\s*\{[^}]*min-height:\s*44px/s);
});

test('date, city, checked weather and ECB reference share the same toolbar',()=>{
 const html=readFileSync(new URL('../public/iceo.html',import.meta.url),'utf8');
 const heading=html.slice(html.indexOf('<div class="glance-heading">'),html.indexOf('<!-- Reserved for a future source-explicit urgency contract'));
 for(const id of ['glance-date','glance-city','glance-weather-quick','glance-forex-quick','reader-language'])assert.ok(heading.includes('id="'+id+'"'),id);
 assert.match(header,/grid-template-areas:'date city utilities actions'/);
 assert.match(header,/grid-template-areas:'date utilities utilities' 'city city actions'/);
 assert.doesNotMatch(header,/\.glance-utilities\{[^}]*border-top:1px/s);
 assert.match(browser,/calendar\.dataset\.compactDate/);
 assert.match(browser,/forexQuick\.setAttribute\('aria-label'/);
});
