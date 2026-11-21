import assert from 'node:assert/strict';
import test from 'node:test';

test('private snapshot cache returns miss, hit and refreshes after TTL', async () => {
  const { createPrivateSnapshotCache } = await import('../.build/src/http/private-snapshot-cache.js');
  const cache = createPrivateSnapshotCache(100);
  let builds = 0;
  const loader = async () => ({ version: ++builds });
  const first = await cache.get(loader, 1_000);
  const second = await cache.get(loader, 1_050);
  const third = await cache.get(loader, 1_101);
  assert.deepEqual(first, { value: { version: 1 }, state: 'miss' });
  assert.deepEqual(second, { value: { version: 1 }, state: 'hit' });
  assert.deepEqual(third, { value: { version: 2 }, state: 'miss' });
  assert.equal(builds, 2);
});

test('private snapshot cache coalesces concurrent loaders without exposing shared state', async () => {
  const { createPrivateSnapshotCache } = await import('../.build/src/http/private-snapshot-cache.js');
  const cache = createPrivateSnapshotCache(1_000);
  let release;
  let builds = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const loader = async () => { builds += 1; await gate; return Object.freeze({ value: 'verified' }); };
  const firstPromise = cache.get(loader, 2_000);
  const secondPromise = cache.get(loader, 2_000);
  release();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(builds, 1);
  assert.equal(first.state, 'miss');
  assert.equal(second.state, 'shared');
  assert.deepEqual(first.value, { value: 'verified' });
  assert.deepEqual(second.value, { value: 'verified' });
});

test('private snapshot cache never caches a failed loader', async () => {
  const { createPrivateSnapshotCache } = await import('../.build/src/http/private-snapshot-cache.js');
  const cache = createPrivateSnapshotCache(1_000);
  let attempts = 0;
  await assert.rejects(cache.get(async () => { attempts += 1; throw new Error('offline'); }, 3_000), /offline/u);
  const recovered = await cache.get(async () => { attempts += 1; return 'ok'; }, 3_001);
  assert.equal(attempts, 2);
  assert.deepEqual(recovered, { value: 'ok', state: 'miss' });
});
