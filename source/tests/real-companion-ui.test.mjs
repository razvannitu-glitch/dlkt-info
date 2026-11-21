import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
const read = (file) => readFileSync(file, 'utf8');

test('Real Companion route contains real official UI and zero synthetic card assets', () => {
  for (const file of ['public/companion.html','public/real-companion.css','public/real-companion.js','src/real-companion/contracts.ts','src/real-companion/projection.ts','api/companion.ts']) assert.equal(existsSync(file), true, file);
  const html = read('public/companion.html');
  for (const fragment of ['Real Companion','Only verified changes.','Or nothing.','Official data','YOUR CONTRACT','WHY THIS REACHED YOU','No verified changes.','No synthetic cards.']) assert.match(html, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),'u'));
  assert.match(html, /src="\/real-companion\.js"/u);
  assert.doesNotMatch(html, /companion-shell-data|trust-data|action-data|inbox-data|delivery-data|memory-data|history-data|demo-/iu);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style\b|https?:\/\//iu);
});

test('Real Companion browser uses same-origin API and safe DOM only', () => {
  const source = read('public/real-companion.js');
  assert.match(source, /fetch\('\/api\/companion'/u);
  assert.match(source, /X-DLKT-Info-Request': 'companion-v1'/u);
  assert.match(source, /credentials: 'same-origin'/u);
  assert.match(source, /AbortSignal\.timeout\(15_000\)/u);
  assert.match(source, /textContent/u);
  assert.match(source, /replaceChildren/u);
  assert.match(source, /params\.delete\('_vercel_share'\)/u);
  assert.match(source, /search: companionSearch\(\)/u);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function/iu);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie|Bearer\s+|sb_secret_/iu);
});

test('Real Companion uses only black, white and coral and remains responsive', () => {
  const assets = ['public/companion.html','public/real-companion.css','public/real-companion.js'].map(read).join('\n').toLowerCase();
  const colors = [...new Set(assets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
  assert.deepEqual(colors, ['#000000','#f66061','#ffffff']);
  const css = read('public/real-companion.css');
  for (const fragment of ['.companion-grid','.verified-card','.control-rail','.proof-rail','@media(max-width:760px)','@media(max-width:460px)']) assert.match(css, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),'u'));
});

test('Synthetic Unified Companion remains isolated at its preview route', () => {
  assert.equal(existsSync('public/companion-preview.html'), true);
  const preview = read('public/companion-preview.html');
  assert.match(preview, /Synthetic preview/u);
  const config = JSON.parse(read('vercel.json'));
  assert.deepEqual(config.rewrites.find((entry) => entry.source === '/companion'), { source: '/companion', destination: '/companion.html' });
  assert.deepEqual(config.rewrites.find((entry) => entry.source === '/companion-preview'), { source: '/companion-preview', destination: '/companion-preview.html' });
});
