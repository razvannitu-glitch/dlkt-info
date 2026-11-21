import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

test('Unified Companion Shell exposes the complete finite operational journey', () => {
  for (const file of ['public/companion-preview.html','public/companion.css','public/companion-shell.js','public/companion-shell-data.js','src/shell/contracts.ts','src/shell/projection.ts','UNIFIED-COMPANION-SHELL.md']) {
    assert.equal(existsSync(file), true, `${file} must exist`);
  }
  const html = read('public/companion-preview.html');
  for (const fragment of [
    'Unified Companion', 'Know.', 'Decide.', 'Return.', 'One loop. No hidden logic.',
    'data-stage="briefing"', 'data-stage="trust"', 'data-stage="memory"', 'data-stage="actions"', 'data-stage="inbox"', 'data-stage="delivery"',
    'Current verified change', 'Why. What. When.', 'Control the finite brief.', 'data-stage-panel="delivery"',
    'Finite · Explainable · Reversible · Session only',
  ]) assert.match(html, new RegExp(escape(fragment), 'u'));
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style\b|https?:\/\//iu);
});

test('Unified Companion Shell uses only the DLKT palette and responsive product layout', () => {
  const assets = ['public/companion-preview.html','public/companion.css','public/companion-shell.js','public/companion-shell-data.js'].map(read).join('\n').toLowerCase();
  const colors = [...new Set(assets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
  assert.deepEqual(colors, ['#000000','#f66061','#ffffff']);
  const css = read('public/companion.css');
  for (const fragment of ['.journey-strip','.companion-shell','.briefing-rail','.card-workspace','.decision-rail','.stage-workspace','@media(max-width:760px)','@media(max-width:460px)']) {
    assert.match(css, new RegExp(escape(fragment), 'u'));
  }
});

test('Unified Companion Shell orchestrates validated contracts without hidden persistence or execution', () => {
  const source = `${read('public/companion-shell-data.js')}\n${read('public/companion-shell.js')}`;
  for (const fragment of [
    'DLKTCompanionBridge', 'DLKTTrustControl', 'DLKTActionControl', 'DLKTActionInbox', 'DLKTDeliveryControl',
    'DLKTMemoryControlData', 'DLKTBriefingHistory', 'combinedSearch', 'window.history.replaceState',
    'ALLOWED_QUERY_KEYS', 'UNIFIED_QUERY_UNKNOWN',
    'automaticExecution: false', 'factualStateChanged: false', 'browserStorage: false',
  ]) assert.match(source, new RegExp(escape(fragment), 'u'));
  assert.match(source, /fetch\(path/u);
  assert.match(source, /privateJson\('\/api\/auth', 'identity-v1'\)/u);
  assert.match(source, /privateJson\('\/api\/persistence', 'persistence-v1'\)/u);
  assert.match(source, /credentials:\s*'same-origin'/u);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|indexedDB|document\.cookie|Authorization/iu);
});

test('Unified Companion route is discoverable and staging-safe', () => {
  const home = read('public/index.html');
  assert.ok((home.match(/href="\/companion"/gu) ?? []).length >= 2);
  assert.match(home, /Build my companion/u);
  assert.match(home, /href="\/start"/u);
  const config = JSON.parse(read('vercel.json'));
  assert.equal(config.rewrites.some((entry) => entry.source === '/companion-preview' && entry.destination === '/companion-preview.html'), true);
  const global = config.headers.find((entry) => entry.source === '/(.*)');
  assert.ok(global);
  const headers = new Map(global.headers.map((entry) => [entry.key.toLowerCase(), entry.value]));
  assert.equal(headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(headers.get('content-security-policy'), /default-src 'none'/u);
});
