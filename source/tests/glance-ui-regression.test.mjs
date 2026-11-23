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

test('generic dialog remains reachable without a redundant weather-and-rates label', () => {
  assert.match(browser, /read\.addEventListener\('click', \(\) => list\.showModal\(\)\)/);
  assert.match(browser, /read\.textContent = locale === 'ro' \? 'Detalii'/);
  assert.match(browser, /read\.hidden = false/);
  assert.doesNotMatch(browser, /read\.textContent = locale === 'ro' \? 'Vreme si curs'/);
});

test('mobile header preserves 44px utility touch targets', () => {
  assert.match(header, /#today-glance #glance-read\s*\{[^}]*min-height:\s*44px/s);
  assert.match(header, /#today-glance #glance-locate\s*\{[^}]*min-height:\s*44px/s);
});
