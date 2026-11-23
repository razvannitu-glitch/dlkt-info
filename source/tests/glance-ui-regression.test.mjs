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

test('source dialog stays accessible without a redundant visible utility button', () => {
  assert.match(browser, /read\.addEventListener\('click', \(\) => list\.showModal\(\)\)/);
  assert.match(browser, /read\.textContent = locale === 'ro' \? 'Surse si preferinte'/);
  assert.match(browser, /read\.setAttribute\('aria-label'/);
  assert.doesNotMatch(browser, /read\.textContent = locale === 'ro' \? 'Vreme si curs'/);
  const html=readFileSync(new URL('../public/iceo.html', import.meta.url), 'utf8');
  assert.match(html, /id="glance-read" type="button" class="text-button sr-only"/);
  assert.match(browser, /list\.showModal\(\)/);
});

test('mobile header preserves 44px utility touch targets', () => {
  assert.match(header, /#today-glance #glance-read\s*\{[^}]*min-height:\s*44px/s);
  assert.match(header, /#today-glance #glance-locate\s*\{[^}]*min-height:\s*44px/s);
});
