import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

test('Personal Action Layer exposes explicit finite and reversible controls', () => {
  for (const file of [
    'public/actions.html','public/actions.css','public/actions.js','public/action-data.js',
    'src/actions/contracts.ts','src/actions/control.ts','src/actions/transport.ts','PERSONAL-ACTION-LAYER.md',
  ]) if (file !== 'PERSONAL-ACTION-LAYER.md') assert.equal(existsSync(file), true, `${file} must exist`);

  const html = read('public/actions.html');
  for (const fragment of [
    'Personal Action Layer', 'Nothing acts in secret', 'Know what matters.', 'Decide what happens next.',
    'Actions change attention, not truth.', 'Visible ledger', 'No hidden tasks.', 'Execution blocked',
  ]) assert.match(html, new RegExp(escape(fragment), 'u'));
  for (const attribute of [
    'data-candidate-list','data-action-choice-list','data-action-ledger','data-active-count',
    'data-watch-count','data-one-time-count','data-undo','data-reset','data-open-today',
  ]) assert.match(html, new RegExp(escape(attribute), 'u'));
  assert.match(html, /<script src="\/action-data\.js" defer><\/script>/u);
  assert.match(html, /<script src="\/actions\.js" defer><\/script>/u);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style\b|https?:\/\//iu);
});

test('Action assets stay inside the DLKT palette and safe browser boundary', () => {
  const assets = ['public/actions.html','public/actions.css','public/actions.js','public/action-data.js'].map(read).join('\n').toLowerCase();
  const colors = [...new Set(assets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
  assert.deepEqual(colors, ['#000000','#f66061','#ffffff']);
  const browser = `${read('public/actions.js')}\n${read('public/action-data.js')}`;
  for (const fragment of [
    'URLSearchParams', 'replaceChildren', 'textContent', 'state.undo', 'ACTION_IGNORE_EXCLUSIVE',
    'automaticExecution: false', 'factualStateChanged: false', 'buildUrl', 'parseSearch',
  ]) assert.match(browser, new RegExp(escape(fragment), 'u'));
  assert.doesNotMatch(browser, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu);
  const todayCss = read('public/today.css');
  assert.match(todayCss, /@media \(max-width: 680px\)[\s\S]*?\.today-header-actions a \{ display: none;[\s\S]*?\[data-open-actions\][\s\S]*?display: inline-flex/u);
  const css = read('public/actions.css');
  for (const fragment of ['.actions-console','.candidate-panel','.action-inspector','.control-panel','.action-ledger','@media(max-width:560px)']) assert.match(css, new RegExp(escape(fragment), 'u'));
});

test('Today exposes card-bound actions without rewriting current factual order', () => {
  const html = read('public/today.html');
  const browser = read('public/today.js');
  for (const fragment of [
    '<script src="/action-data.js" defer></script>', 'data-open-action-dialog', 'data-action-dialog',
    'data-card-action-type="watch-change"', 'data-card-action-type="mark-resolved"',
    'data-card-action-type="ignore-pattern"', 'data-complete-actions', 'data-open-actions',
  ]) assert.match(html, new RegExp(escape(fragment), 'u'));
  for (const fragment of [
    'actionApi.parseSearch(window.location.search)', 'actionControlHref', 'toggleAction',
    "type === 'ignore-pattern'", 'state.actions = actionApi.normalizeSelections',
    'elements.completeActions.textContent', "event.key.toLowerCase() === 'a'",
  ]) assert.match(browser, new RegExp(escape(fragment), 'u'));
  assert.match(browser, /const rankedCandidates = bridgeDefinition[\s\S]*:\s*\[\.\.\.trustedCandidates\]/u);
  assert.doesNotMatch(browser, /localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu);
});

test('Action route and navigation are explicit protected-staging contracts', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.equal(config.rewrites.some((entry) => entry.source === '/actions' && entry.destination === '/actions.html'), true);
  assert.equal((read('public/index.html').match(/href="\/actions">Actions preview<\/a>/gu) ?? []).length, 2);
  for (const file of ['public/today.html','public/history.html','public/memory.html','public/trust.html']) assert.match(read(file), /href="\/actions/u, file);
});
