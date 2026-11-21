import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');

test('Delta First UI is finite, explicit and connected to the real comparator', () => {
  for (const file of ['public/delta.html', 'public/delta.css', 'public/delta.js', 'api/eu-official-delta.ts', 'src/delta-official/baseline.generated.ts']) {
    assert.equal(existsSync(file), true, `${file} must exist`);
  }
  const html = read('public/delta.html');
  for (const fragment of ['Delta First', 'What changed.', 'Nothing else.', 'No verified changes since this baseline.', 'A listing is not a legal conclusion.', 'Any positive finite number']) {
    assert.match(html, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  for (const marker of ['data-change-total', 'data-baseline-at', 'data-feed-grid', 'data-map-list', 'data-card', 'data-empty', 'data-filter', 'data-budget']) {
    assert.match(html, new RegExp(marker, 'u'));
  }
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/iu);
  assert.doesNotMatch(html, /<style\b/iu);
});

test('Delta First uses only the canonical DLKT palette and safe browser APIs', () => {
  const assets = [read('public/delta.html'), read('public/delta.css'), read('public/delta.js')].join('\n').toLowerCase();
  const colors = [...new Set(assets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
  assert.deepEqual(colors, ['#000000', '#f66061', '#ffffff']);
  const browser = read('public/delta.js');
  assert.match(browser, /textContent/u);
  assert.match(browser, /replaceChildren/u);
  assert.match(browser, /AbortSignal\.timeout\(12_000\)/u);
  assert.match(browser, /credentials:\s*'same-origin'/u);
  assert.doesNotMatch(browser, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function/iu);
  assert.doesNotMatch(browser, /localStorage|sessionStorage|document\.cookie|access_token|refresh_token|Authorization/iu);
});

test('Vercel and primary navigation expose Delta First', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.equal(config.functions['api/eu-official-delta.ts'].maxDuration, 15);
  assert.deepEqual(config.rewrites.find((entry) => entry.source === '/delta'), { source: '/delta', destination: '/delta.html' });
  for (const file of ['public/index.html', 'public/start.html', 'public/companion.html', 'public/live.html']) {
    assert.match(read(file), /href="\/delta"/u, `${file} must link to Delta First`);
  }
});
