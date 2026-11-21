import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');

test('Action Inbox exposes a finite follow-up product surface', () => {
  for (const file of ['public/inbox.html','public/inbox.css','public/inbox.js','public/inbox-data.js','ACTION-INBOX-FOLLOW-UP.md']) assert.equal(existsSync(file), true, `${file} must exist`);
  const html = read('public/inbox.html');
  for (const fragment of ['Action Inbox','Only what needs your decision','Follow-up without noise','data-inbox-list','data-handle-action','data-activity-list','Fact boundary','No action executes automatically']) assert.match(html, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(html, /data-filter="all"[\s\S]*data-filter="due"[\s\S]*data-filter="waiting"[\s\S]*data-filter="quiet"/u);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/iu);
  assert.doesNotMatch(html, /<style\b/iu);
});

test('Action Inbox visual system uses only the DLKT palette and responsive layout', () => {
  const assets = [read('public/inbox.html'),read('public/inbox.css'),read('public/inbox.js'),read('public/inbox-data.js')].join('\n').toLowerCase();
  const colors = [...new Set(assets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
  assert.deepEqual(colors, ['#000000','#f66061','#ffffff']);
  const css = read('public/inbox.css');
  for (const fragment of ['.inbox-console','.filter-panel','.inbox-list-panel','.inbox-inspector','.activity-ledger','@media(max-width:760px)','@media(max-width:460px)']) assert.match(css, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
});

test('Action Inbox behavior is explicit, reversible and storage-free', () => {
  const source = `${read('public/inbox-data.js')}\n${read('public/inbox.js')}`;
  for (const fragment of ['DEFAULT_SELECTIONS','waiting-for-delta','attention-resolved','suppressedMaterialDeltaCount','function handleSelected','Watch rearmed','Pattern unmuted','state.undo','buildSearch','baselineItems.map(cloneItem)','deliveryLinks: Array.from','elements.deliveryLinks.forEach']) assert.match(source, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function/iu);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu);
  assert.match(source, /automaticExecution:\s*false/u);
  assert.match(source, /factualStateChanged:\s*false/u);
});

test('Action Inbox route and product bridges are explicit', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.equal(config.rewrites.some((entry) => entry.source === '/inbox' && entry.destination === '/inbox.html'), true);
  assert.equal((read('public/index.html').match(/href="\/inbox">Inbox preview<\/a>/gu) ?? []).length, 2);
  assert.equal((read('public/today.html').match(/data-open-inbox/gu) ?? []).length >= 2, true);
  assert.equal((read('public/actions.html').match(/data-open-inbox/gu) ?? []).length >= 2, true);
  assert.match(read('public/today.js'), /actionControlHref\('\/inbox'\)/u);
  assert.match(read('public/actions.js'), /buildUrl\(state\.selections, window\.location\.search, '\/inbox'\)/u);
});
