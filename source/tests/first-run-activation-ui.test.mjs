import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

test('first-run activation exposes the complete four-step product flow', () => {
  for (const file of ['public/start.html', 'public/start.css', 'public/start.js']) assert.equal(existsSync(file), true, `${file} must exist`);
  const html = read('public/start.html');
  for (const fragment of [
    'First-run activation', 'Build your brief.', 'Tell it what matters.', 'Evidence standard',
    'Daily delivery time', 'Tracked entities', 'Evidence standard',
    'Open my Companion', 'Preview boundary', 'Save this exact contract.', 'Save & open Companion',
  ]) assert.match(html, new RegExp(escape(fragment), 'u'));
  for (const step of ['interests', 'trust', 'delivery', 'preview']) {
    assert.match(html, new RegExp(`data-step-button="${step}"`, 'u'));
    assert.match(html, new RegExp(`data-step-panel="${step}"`, 'u'));
  }
  assert.match(html, /<script src="\/bridge\.js" defer><\/script>/u);
  assert.match(html, /<script src="\/trust-data\.js" defer><\/script>/u);
  assert.match(html, /<script src="\/action-data\.js" defer><\/script>/u);
  assert.match(html, /<script src="\/start\.js" defer><\/script>/u);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style\b|https?:\/\//iu);
});

test('activation design is locked to DLKT colors and responsive editorial structure', () => {
  const assets = [read('public/start.html'), read('public/start.css'), read('public/start.js')].join('\n').toLowerCase();
  assert.deepEqual([...new Set(assets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort(), ['#000000', '#f66061', '#ffffff']);
  const css = read('public/start.css');
  for (const fragment of ['.activation-hero', '.activation-shell', '.activation-progress', '.topic-grid', '.trust-grid', '.activation-result', '@media(max-width:520px)']) assert.match(css, new RegExp(escape(fragment), 'u'));
});

test('activation controller is deterministic, storage-free and creates one strict Companion URL', () => {
  const source = read('public/start.js');
  for (const fragment of ['DLKTCompanionBridge', 'DLKTTrustControl', 'DLKTActionControl', 'bridge.normalize', 'bridge.buildSearch', 'trust.buildTrustUrl', '`/companion${']) assert.match(source, new RegExp(escape(fragment), 'u'));
  assert.match(source, /Object\.defineProperty\(window, 'DLKTFirstRunActivation'/u);
  assert.match(source, /replaceChildren/u);
  assert.match(read('public/delivery-data.js'), /'bridge','topics','entities','tz'/u);
  assert.match(source, /fetch\('\/api\/auth'/u);
  assert.match(source, /fetch\('\/api\/persistence'/u);
  assert.match(source, /credentials:\s*'same-origin'/u);
  assert.match(source, /X-DLKT-Info-Request':\s*'identity-v1'/u);
  assert.match(source, /X-DLKT-Info-Request':\s*'persistence-v1'/u);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|indexedDB|XMLHttpRequest|innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(|new Function|Authorization/iu);
  assert.deepEqual([...source.matchAll(/fetch\('([^']+)'/gu)].map((match) => match[1]).sort(), ['/api/auth', '/api/persistence']);
});

test('staging routing and homepage expose activation without changing production domains', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.ok(config.rewrites.some((entry) => entry.source === '/start' && entry.destination === '/start.html'));
  const home = read('public/index.html');
  assert.match(home, /href="\/start">Build briefing<\/a>/u);
  assert.match(home, /href="\/start"><span>Build my companion<\/span>/u);
});
