import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');

test('live official experience is discoverable, finite and explicit about its boundary', () => {
  for (const file of ['public/live.html', 'public/live.css', 'public/live.js', 'api/eu-official-live.ts', 'src/live-official/contracts.ts', 'src/live-official/snapshot.ts']) assert.equal(existsSync(file), true, file);
  const html = read('public/live.html');
  for (const fragment of ['Live Official Snapshot', 'Official signals.', 'Live now.', 'Finite card budget', 'Source proof', 'Legal boundary', 'Real data. Zero hidden execution.', 'DLKT 0.8.8']) assert.match(html, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  for (const attribute of ['data-live-shell', 'data-queue-list', 'data-card-title', 'data-source-link', 'data-diagnostics', 'data-boundaries', 'data-error']) assert.match(html, new RegExp(attribute, 'u'));
  assert.doesNotMatch(html, /<style\b/iu);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/iu);
  assert.doesNotMatch(html, /https?:\/\//iu);
  const index = read('public/index.html');
  const start = read('public/start.html');
  const companion = read('public/companion.html');
  assert.match(index, /href="\/live"/u);
  assert.match(start, /href="\/live"/u);
  assert.match(companion, /href="\/live"/u);
});

test('live official visual system uses only the canonical DLKT palette', () => {
  const assets = [read('public/live.html'), read('public/live.css'), read('public/live.js')].join('\n').toLowerCase();
  const colors = [...new Set(assets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
  assert.deepEqual(colors, ['#000000', '#f66061', '#ffffff']);
});

test('live official browser code uses safe DOM APIs and no hidden storage', () => {
  const script = read('public/live.js');
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(|new Function|document\.write/iu);
  assert.doesNotMatch(script, /localStorage|sessionStorage|indexedDB|document\.cookie/iu);
  assert.match(script, /X-DLKT-Info-Request/u);
  assert.match(script, /deltaAvailable === false/u);
  assert.match(script, /databaseUsed === false/u);
});

test('Vercel contract exposes the live route and serverless endpoint', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.deepEqual(config.functions['api/eu-official-live.ts'], { maxDuration: 15 });
  assert.ok(config.rewrites.some((entry) => entry.source === '/live' && entry.destination === '/live.html'));
});
