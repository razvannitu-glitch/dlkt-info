import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

test('daily companion exposes a finite end-user briefing instead of another dashboard', () => {
  for (const file of ['public/today.html', 'public/today.css', 'public/today.js', 'public/bridge.js', 'src/today/contracts.ts', 'src/bridge/contracts.ts']) {
    assert.equal(existsSync(file), true, `${file} must exist`);
  }
  const html = read('public/today.html');
  for (const fragment of [
    'Daily Companion', 'Finite by design', 'What changed', 'Delta lens',
    'Why it matters to you', 'What to do', 'Why this reached you',
    'No infinite feed.', 'You’re caught up.', 'Synthetic preview',
  ]) assert.match(html, new RegExp(escape(fragment), 'u'));
  for (const attribute of [
    'data-briefing-map', 'data-daily-card', 'data-card-before', 'data-card-now',
    'data-feedback="relevant"', 'data-follow-entity', 'data-sources-dialog',
    'data-complete', 'data-review-briefing', 'data-bridge-banner', 'data-empty', 'data-open-memory',
  ]) assert.match(html, new RegExp(escape(attribute), 'u'));
  assert.match(html, /<link rel="stylesheet" href="\/today\.css">/u);
  assert.match(html, /<script src="\/bridge\.js" defer><\/script>/u);
  assert.match(html, /<script src="\/today\.js" defer><\/script>/u);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/iu);
  assert.doesNotMatch(html, /<style\b/iu);
  assert.doesNotMatch(html, /https?:\/\//iu);
});

test('daily companion uses only black, white and DLKT coral', () => {
  const assets = [read('public/today.html'), read('public/today.css'), read('public/today.js')].join('\n').toLowerCase();
  const colors = [...new Set(assets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
  assert.deepEqual(colors, ['#000000', '#f66061', '#ffffff']);
  const css = read('public/today.css');
  assert.match(css, /@media \(max-width: 1180px\) and \(min-width: 961px\)[\s\S]*?\.today-header-actions \{[\s\S]*?overflow-x: auto;[\s\S]*?scrollbar-width: none/u);
  for (const fragment of [
    '--black: #000000', '--white: #ffffff', '--coral: #f66061',
    '.today-shell', '.briefing-rail', '.daily-card', '.delta-lens',
    '.companion-context', '.briefing-complete', '@media (max-width: 680px)',
  ]) assert.match(css, new RegExp(escape(fragment), 'u'));
});

test('daily companion behavior is deterministic, local and storage-free', () => {
  const source = read('public/today.js');
  const bridge = read('public/bridge.js');
  assert.equal((source.match(/id: 'demo-/gu) ?? []).length, 6);
  for (const fragment of [
    "topic: 'Technology'", "topic: 'Business'", "topic: 'Regulation'",
    "topic: 'Opportunity'", "topic: 'Travel'", "topic: 'Supply'",
    'replaceChildren', 'showComplete', 'toggleFollow', 'setFeedback',
    "event.key === 'ArrowRight'", "event.key.toLowerCase() === 'r'",
    "addEventListener('wheel'", "addEventListener('pointerup'",
  ]) assert.match(source, new RegExp(escape(fragment), 'u'));
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function/iu);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/iu);
  assert.match(source, /function memoryControlHref\(\)/u);
  assert.match(source, /parameters\.set\('relevant'/u);
  assert.match(source, /parameters\.set\('less'/u);
  assert.match(source, /parameters\.set\('follow'/u);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|indexedDB/iu);
});

test('daily companion contract and route stay explicitly synthetic and finite', () => {
  const contract = read('src/today/contracts.ts');
  for (const fragment of [
    "DAILY_COMPANION_VERSION = 'dlkt-info-daily-companion-1'",
    "DAILY_COMPANION_ROUTE = '/today'",
    "DAILY_COMPANION_MODE = 'synthetic-finite-preview'",
    'finite: true', "cardBudget: 'user-defined-positive-integer'", 'infiniteScroll: false',
    'sessionPersistence: false', 'realDataEnabled: false',
  ]) assert.match(contract, new RegExp(escape(fragment), 'u'));

  const config = JSON.parse(read('vercel.json'));
  assert.ok(config.rewrites.some((entry) => entry.source === '/today' && entry.destination === '/today.html'));
  const home = read('public/index.html');
  assert.equal((home.match(/href="\/today">Today preview<\/a>/gu) ?? []).length, 2);
});
