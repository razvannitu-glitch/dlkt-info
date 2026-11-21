import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

test('briefing history is a finite inspectable product surface', () => {
  for (const file of ['public/history.html','public/history.css','public/history.js','public/history-data.js','src/history/contracts.ts']) {
    assert.equal(existsSync(file), true, `${file} must exist`);
  }
  const html = read('public/history.html');
  for (const fragment of [
    'Briefing History', 'Explainable Memory', 'A finite change ledger.', 'Explainable ranking',
    'No hidden priority score.', 'Nothing learns in secret.', 'Stable signals are omitted.', 'Synthetic preview', 'Open Memory Control Room',
  ]) assert.match(html, new RegExp(escape(fragment), 'u'));
  for (const attribute of ['data-run-list','data-run-summary','data-ranking-select','data-ranking-components','data-memory-list']) {
    assert.match(html, new RegExp(escape(attribute), 'u'));
  }
  assert.match(html, /<script src="\/history-data\.js" defer><\/script>/u);
  assert.match(html, /<script src="\/history\.js" defer><\/script>/u);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style\b|https?:\/\//iu);
});

test('history assets use only the canonical palette and safe DOM rendering', () => {
  const assets = ['public/history.html','public/history.css','public/history.js','public/history-data.js'].map(read).join('\n').toLowerCase();
  const colors = [...new Set(assets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
  assert.deepEqual(colors, ['#000000','#f66061','#ffffff']);
  assert.match(read('public/history.css'), /@media \(max-width: 720px\)[\s\S]*?\.history-header \{ display: flex; flex-wrap: wrap;[\s\S]*?overflow-x: auto;[\s\S]*?white-space: nowrap;/u);
  const browser = read('public/history.js');
  const data = read('public/history-data.js');
  for (const fragment of ['replaceChildren','textContent','createElement','selectedRunId','selectedCardId']) assert.match(browser, new RegExp(fragment, 'u'));
  assert.doesNotMatch([browser,data].join('\n'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|fetch\s*\(|localStorage|sessionStorage|document\.cookie|indexedDB/iu);
});

test('history data exposes bounded runs, visible memory and per-card ranking components', () => {
  const source = read('public/history-data.js');
  assert.equal((source.match(/id: 'briefing:2026-/gu) ?? []).length, 4);
  assert.equal((source.match(/source: '(?:Explicit rule|Followed entity|Relevant feedback|Less-like feedback)'/gu) ?? []).length, 5);
  for (const id of ['demo-tech-pricing','demo-market-entry','demo-eu-consultation','demo-grant-window','demo-route','demo-supply']) {
    assert.match(source, new RegExp(escape(`'${id}'`), 'u'));
  }
  for (const fragment of ['statusLabel','previousRank','currentRank','moveLabel','memorySummary','ranking: [']) assert.match(source, new RegExp(escape(fragment), 'u'));
});

test('today surface shows newness and explainable ranking without a second data source', () => {
  const html = read('public/today.html');
  const browser = read('public/today.js');
  assert.match(html, /<script src="\/history-data\.js" defer><\/script>/u);
  for (const fragment of ['data-card-history-status','data-history-rank','data-history-move','data-history-ranking','data-history-memory']) assert.match(html, new RegExp(escape(fragment),'u'));
  for (const fragment of ['DLKTBriefingHistory','renderHistory','history.ranking.slice(0, 4)','history.memorySummary']) assert.match(browser, new RegExp(escape(fragment),'u'));
  assert.doesNotMatch(browser, /fetch\s*\([^)]*history|localStorage|sessionStorage/iu);
});

test('history route is staging-safe and discoverable from product surfaces', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.ok(config.rewrites.some((entry) => entry.source === '/history' && entry.destination === '/history.html'));
  const home = read('public/index.html');
  assert.equal((home.match(/href="\/history">History preview<\/a>/gu) ?? []).length, 2);
  const today = read('public/today.html');
  const history = read('public/history.html');
  assert.ok((today.match(/href="\/history"/gu) ?? []).length >= 2);
  assert.ok((history.match(/href="\/memory"/gu) ?? []).length >= 2);
});
