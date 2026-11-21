import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

test('Delivery Control exposes explicit quiet-hours and anti-spam controls', () => {
  for (const file of ['public/delivery.html','public/delivery.css','public/delivery.js','public/delivery-data.js','src/delivery/contracts.ts','src/delivery/policy.ts','src/delivery/transport.ts']) {
    assert.equal(existsSync(file), true, `${file} must exist`);
  }
  const html = read('public/delivery.html');
  for (const fragment of [
    'Delivery Control', 'Every interruption must earn its place', 'Choose what reaches you.',
    'Quiet hours', 'Anti-spam limits', 'Evidence threshold', 'Delivery channel',
    'What would happen now.', 'Every interruption has a reason.', 'Projection is not delivery.',
    'data-decision-list', 'data-simulate-quiet', 'data-simulate-recent', 'data-ledger-grid', 'data-undo', 'data-reset',
  ]) assert.match(html, new RegExp(escape(fragment), 'u'));
  assert.equal((html.match(/data-action-mode=/gu) ?? []).length, 5);
  assert.match(html, /data-channel="web"/u);
  assert.match(html, /<button[^>]*disabled[^>]*>\s*<span>Email<\/span>/u);
  assert.match(html, /<button[^>]*disabled[^>]*>\s*<span>Push<\/span>/u);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style\b|https?:\/\//iu);
});

test('Delivery visual system uses only the canonical DLKT palette and responsive layout', () => {
  const assets = ['public/delivery.html','public/delivery.css','public/delivery.js','public/delivery-data.js'].map(read).join('\n').toLowerCase();
  const colors = [...new Set(assets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
  assert.deepEqual(colors, ['#000000','#f66061','#ffffff']);
  const css = read('public/delivery.css');
  for (const fragment of ['.delivery-console','.policy-panel','.projection-panel','.decision-inspector','.delivery-ledger','.delivery-boundary','@media(max-width:760px)','@media(max-width:460px)']) {
    assert.match(css, new RegExp(escape(fragment), 'u'));
  }
});

test('Delivery browser projection is deterministic, visible and storage-free', () => {
  const source = `${read('public/delivery-data.js')}\n${read('public/delivery.js')}`;
  for (const fragment of [
    'delivery-v1', 'quietHoursEnabled', 'dailyAlertCap', 'minimumGapMinutes', 'minimumAlertTrust',
    'minimumAlertMateriality', 'conflictMode', 'duplicateKey', 'projectedKeys', 'defer-quiet-hours',
    'rate-limited', 'next-briefing', 'automaticExecution:false', 'factualStateChanged:false',
    'replaceChildren', 'history.replaceState', 'state.undo', 'simulateQuiet', 'simulateRecent',
  ]) assert.match(source, new RegExp(escape(fragment), 'u'));
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu);
});

test('Delivery route and cross-surface links preserve explicit action context', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.ok(config.rewrites.some((entry) => entry.source === '/delivery' && entry.destination === '/delivery.html'));
  const home = read('public/index.html');
  assert.equal((home.match(/href="\/delivery">Delivery preview<\/a>/gu) ?? []).length, 2);
  const today = `${read('public/today.html')}\n${read('public/today.js')}`;
  const actions = `${read('public/actions.html')}\n${read('public/actions.js')}`;
  const inbox = `${read('public/inbox.html')}\n${read('public/inbox.js')}`;
  for (const source of [today, actions, inbox]) {
    assert.match(source, /data-open-delivery/u);
    assert.match(source, /\/delivery/u);
  }
  assert.match(read('public/action-data.js'), /'delivery', 'dw', 'dr', 'dc', 'dx', 'di'/u);
  assert.match(read('public/bridge.js'), /const DELIVERY_KEYS/u);
  assert.match(read('public/trust-data.js'), /'delivery', 'dw', 'dr', 'dc', 'dx', 'di'/u);
});
