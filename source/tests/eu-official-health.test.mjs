import assert from 'node:assert/strict';
import test from 'node:test';

test('EU Official Change Radar health contract is explicit and disabled before provisioning', async () => {
  const { default: health } = await import('../.build/api/eu-official-health.js');
  const headers = new Map();
  let body = '';
  const response = { statusCode: 0, setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); }, end(value = '') { body = String(value); } };
  health({ method: 'GET' }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300');
  const payload = JSON.parse(body);
  assert.equal(payload.pack, 'eu-official-change-radar');
  assert.equal(payload.packVersion, '0.1.1');
  assert.equal(payload.status, 'installed-not-activated');
  assert.equal(payload.liveAcquisitionEnabled, false);
  assert.equal(payload.privateWorkerReady, true);
  assert.equal(payload.privateClaimLedgerReady, true);
  assert.equal(payload.scheduledAcquisitionConfigured, true);
  assert.equal(payload.publicCardsEnabled, false);
  assert.equal(payload.blocker, 'DEDICATED_SUPABASE_PROJECT_REQUIRED');
  assert.equal(payload.sourceRegistry.length, 2);
  assert.equal(payload.feeds.length, 2);
  assert.ok(payload.sourceRegistry.every((source) => source.authority === 'official' && source.attributionRequired === true));
  assert.ok(payload.safeguards.includes('no-rolloff-resolution'));
  assert.ok(payload.safeguards.includes('service-only-acquisition'));
  assert.ok(payload.safeguards.includes('atomic-checkpoint-claim-commit'));
  assert.ok(payload.safeguards.includes('cron-secret-authentication'));
});
