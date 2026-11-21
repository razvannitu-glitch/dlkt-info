import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

test('memory control room exposes visible reversible personalisation', () => {
  for (const file of [
    'public/memory.html','public/memory.css','public/memory.js','public/memory-data.js',
    'src/memory/contracts.ts','src/memory/control.ts','MEMORY-CONTROL-ROOM.md',
  ]) assert.equal(existsSync(file), true, `${file} must exist`);

  const html = read('public/memory.html');
  for (const fragment of [
    'Memory Control', 'Nothing learns in secret', 'You decide', 'Visible ledger',
    'Next briefing preview', 'See the ranking move.', 'No hidden profile', 'Session only',
  ]) assert.match(html, new RegExp(escape(fragment), 'u'));
  for (const attribute of [
    'data-signal-list','data-ranking-list','data-candidate-memory','data-applied-list',
    'data-toggle-signal','data-strength','data-undo','data-reset','data-query-state',
  ]) assert.match(html, new RegExp(escape(attribute), 'u'));
  assert.match(html, /<script src="\/memory-data\.js" defer><\/script>/u);
  assert.match(html, /<script src="\/memory\.js" defer><\/script>/u);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style\b|https?:\/\//iu);
});

test('memory assets use only the canonical DLKT palette and safe local rendering', () => {
  const assets = ['public/memory.html','public/memory.css','public/memory.js','public/memory-data.js'].map(read).join('\n').toLowerCase();
  const colors = [...new Set(assets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
  assert.deepEqual(colors, ['#000000','#f66061','#ffffff']);
  const browser = read('public/memory.js');
  for (const fragment of [
    'URLSearchParams', 'replaceChildren', 'textContent', 'selectedSignalId',
    'state.undo', 'MEMORY_QUERY_DUPLICATE', 'MEMORY_QUERY_INVALID',
  ]) assert.match(browser, new RegExp(escape(fragment), 'u'));
  assert.doesNotMatch(browser, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|fetch\s*\(|localStorage|sessionStorage|document\.cookie|indexedDB/iu);
});

test('memory route and cross-surface controls are discoverable without hidden persistence', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.ok(config.rewrites.some((entry) => entry.source === '/memory' && entry.destination === '/memory.html'));
  const home = read('public/index.html');
  const today = read('public/today.html');
  const todayBrowser = read('public/today.js');
  const history = read('public/history.html');
  assert.equal((home.match(/href="\/memory">Memory preview<\/a>/gu) ?? []).length, 2);
  assert.ok((today.match(/data-open-memory/gu) ?? []).length >= 3);
  assert.match(history, /Open Memory Control Room/u);
  for (const fragment of ['memoryControlHref', "parameters.set('relevant'", "parameters.set('less'", "parameters.set('follow'"]) {
    assert.match(todayBrowser, new RegExp(escape(fragment), 'u'));
  }
  assert.doesNotMatch(todayBrowser, /localStorage|sessionStorage|indexedDB/iu);
});
