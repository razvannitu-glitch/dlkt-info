import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');

test('Trust Control Room exposes a complete transparent evidence policy', () => {
  for (const file of ['public/trust.html', 'public/trust.css', 'public/trust.js', 'public/trust-data.js']) {
    assert.equal(existsSync(file), true, `${file} must exist`);
  }
  const html = read('public/trust.html');
  for (const fragment of [
    'Trust is a setting.', 'Evidence before confidence', 'Trust policy', 'What survives the filter',
    'Source ladder', 'Why this decision', 'Policy filters visibility.', 'data-policy-control',
    'data-projection-list', 'data-selected-sources', 'data-selected-reasons', 'data-apply-policy',
  ]) assert.match(html, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(html, /<script src="\/bridge\.js" defer><\/script>[\s\S]*<script src="\/trust-data\.js" defer><\/script>[\s\S]*<script src="\/trust\.js" defer><\/script>/u);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/iu);
  assert.doesNotMatch(html, /<style\b/iu);
  assert.doesNotMatch(html, /https?:\/\//iu);
});

test('Trust Control Room is locked to the DLKT palette and responsive product layout', () => {
  const assets = [read('public/trust.html'), read('public/trust.css'), read('public/trust.js'), read('public/trust-data.js')].join('\n').toLowerCase();
  const colors = [...new Set(assets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
  assert.deepEqual(colors, ['#000000', '#f66061', '#ffffff']);
  const css = read('public/trust.css');
  for (const fragment of ['.trust-shell', '.policy-panel', '.projection-panel', '.evidence-panel', '.source-ladder', '.truth-boundary', '@media (max-width: 520px)']) {
    assert.match(css, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
});

test('browser trust controller is deterministic, storage-free and never selects truth automatically', () => {
  const data = read('public/trust-data.js');
  const controller = read('public/trust.js');
  for (const fragment of [
    "minimumTrust: 'corroborated'", "conflictPolicy: 'exclude'", "authorityRequirement: 'primary'",
    'minimumSources: 2', 'maximumEvidenceAgeHours: 72', 'requireOfficialForHighImpact: true',
    "trust: 'conflicting'", 'blockingReasons', 'warnings', 'buildTodayUrl', 'buildTrustUrl',
  ]) assert.match(data, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(controller, /replaceChildren/u);
  assert.match(controller, /api\.project\(state\.policy\)/u);
  assert.doesNotMatch(`${data}\n${controller}`, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu);
});

test('Trust Policy is applied before Today ranking and finite-card slicing', () => {
  const html = read('public/today.html');
  const today = read('public/today.js');
  const bridge = read('public/bridge.js');
  assert.match(html, /<script src="\/trust-data\.js" defer><\/script>/u);
  assert.match(html, /data-trust-banner/u);
  assert.match(html, /data-open-trust/u);
  assert.match(today, /const trustProjection =/u);
  assert.match(today, /const trustedCandidates = trustedIds \? companionCandidates\.filter/u);
  assert.match(today, /const rankedCandidates = bridgeDefinition[\s\S]*\.sort[\s\S]*:\s*\[\.\.\.trustedCandidates\]/u);
  assert.match(today, /const cards = Object\.freeze\(rankedCandidates\.slice/u);
  assert.match(today, /renderTrustProjection\(\);/u);
  assert.match(bridge, /\.\.\.TRUST_KEYS/u);
});

test('Trust route and navigation are explicit staging contracts', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.ok(config.rewrites.some((entry) => entry.source === '/trust' && entry.destination === '/trust.html'));
  assert.match(read('public/index.html'), /href="\/trust">Trust preview/u);
  assert.match(read('public/history.html'), /href="\/trust">Trust/u);
  assert.match(read('public/memory.html'), /href="\/trust">Trust/u);
});
