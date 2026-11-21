import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');

test('visual review console exposes the complete human-gated product flow', () => {
  for (const file of ['public/review.html', 'public/review.css', 'public/review.js']) {
    assert.equal(existsSync(file), true, `${file} must exist`);
  }
  const html = read('public/review.html');
  for (const fragment of [
    'Internal Review Console',
    'Synthetic preview',
    'Human gate · zero automatic publication',
    'See the change.',
    'Private queue',
    'Verified delta',
    'Provenance & claim map',
    'Publication blocked',
    'Review decision',
    'Audit trail',
    'functional visual prototype',
  ]) assert.match(html, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  for (const attribute of [
    'data-queue-list', 'data-card-title', 'data-card-before', 'data-card-after',
    'data-source-list', 'data-review-note', 'data-approve', 'data-reject', 'data-audit-list',
  ]) assert.match(html, new RegExp(attribute, 'u'));

  assert.match(html, /<link rel="stylesheet" href="\/review\.css">/u);
  assert.match(html, /<script src="\/review\.js" defer><\/script>/u);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/iu);
  assert.doesNotMatch(html, /<style\b/iu);
  assert.doesNotMatch(html, /https?:\/\//iu);
});

test('review console uses only the DLKT palette and responsive editorial layout', () => {
  const assets = [read('public/review.html'), read('public/review.css'), read('public/review.js')].join('\n').toLowerCase();
  const colors = [...new Set(assets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
  assert.deepEqual(colors, ['#000000', '#f66061', '#ffffff']);

  const css = read('public/review.css');
  for (const fragment of [
    '--black: #000000', '--white: #ffffff', '--coral: #f66061',
    '.console-shell', '.review-queue', '.review-workspace', '.decision-panel',
    '.change-comparison', '.publication-lock', '.decision-toast',
    '@media (max-width: 1260px)', '@media (max-width: 900px)', '@media (max-width: 640px)',
    '@media (prefers-reduced-motion: reduce)',
  ]) assert.match(css, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  const cssColors = [...new Set((css.toLowerCase().match(/#[0-9a-f]{3,8}/gu) ?? []))].sort();
  assert.deepEqual(cssColors, ['#000000', '#f66061', '#ffffff']);
});

test('review console behavior is local, deterministic and safe by construction', () => {
  const source = read('public/review.js');
  for (const fragment of [
    "state: 'pending'", "kind: 'Changed'", "kind: 'New'", "kind: 'Conflicted'",
    'replaceChildren', 'textContent', 'noopener noreferrer', 'Publication remains blocked',
    "event.key.toLowerCase() === 'j'", "event.key.toLowerCase() === 'k'",
    "event.key.toLowerCase() === 'a'", "event.key.toLowerCase() === 'r'",
  ]) assert.match(source, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function/iu);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu);
  assert.doesNotMatch(source, /CELEX:\d|Bearer\s+|sb_secret_|access_token|refresh_token/iu);
});

test('homepage and Vercel routing expose the protected visual preview without changing production identity', () => {
  const home = read('public/index.html');
  assert.equal((home.match(/href="\/review">Review preview<\/a>/gu) ?? []).length, 2);
  const config = JSON.parse(read('vercel.json'));
  assert.deepEqual(config.rewrites, [
    { source: '/', destination: '/index.html' },
    { source: '/briefing', destination: '/index.html' },
    { source: '/start', destination: '/start.html' },
    { source: '/companion', destination: '/companion.html' },
    { source: '/companion-preview', destination: '/companion-preview.html' },
    { source: '/live', destination: '/live.html' },
    { source: '/delta', destination: '/delta.html' },
    { source: '/review', destination: '/review.html' },
    { source: '/today', destination: '/today.html' },
    { source: '/history', destination: '/history.html' },
    { source: '/memory', destination: '/memory.html' },
    { source: '/trust', destination: '/trust.html' },
    { source: '/actions', destination: '/actions.html' },
    { source: '/inbox', destination: '/inbox.html' },
    { source: '/delivery', destination: '/delivery.html' },
  ]);
  const global = config.headers.find((entry) => entry.source === '/(.*)');
  assert.ok(global);
  const headers = new Map(global.headers.map((entry) => [entry.key.toLowerCase(), entry.value]));
  assert.equal(headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(headers.get('content-security-policy'), /default-src 'none'/u);
});
