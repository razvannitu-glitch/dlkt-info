import assert from 'node:assert/strict';
import test from 'node:test';
import {DeviceMemory} from '../.build/src/iceo/device-memory.js';

const emptyCopy = {focus: null, cards: [], checkpoint: null};
const tick = () => new Promise(resolve => setImmediate(resolve));

// Deterministic transaction fixture. Native IndexedDB rollback is checked separately in Chromium.
function databaseFixture(onTransaction = () => {}) {
  const original = {meta: new Map([['focus', 'prior focus'], ['comparison', 'prior comparison'], ['daily', 'keep daily']]), saved: new Map([['prior', 'prior card']])};
  const before = () => JSON.stringify({meta: [...original.meta], saved: [...original.saved]});
  const transactions = [];
  let opens = 0;
  const database = {
    close() {},
    transaction(stores, mode) {
      const staged = Object.fromEntries(Object.entries(original).map(([key, value]) => [key, new Map(value)]));
      const tx = {
        stores, mode, operations: 0, abortCalls: 0, state: 'active', error: null,
        objectStore(name) {
          const map = staged[name]; assert.ok(map);
          return {
            delete(key) { tx.operations += 1; map.delete(key); },
            clear() { tx.operations += 1; map.clear(); },
            put(value, key = value.id) { tx.operations += 1; map.set(key, value); },
          };
        },
        abort() {
          tx.abortCalls += 1;
          if (tx.state !== 'active') throw new DOMException('Transaction finished', 'InvalidStateError');
          tx.state = 'aborted'; queueMicrotask(() => tx.onabort?.());
        },
        complete() {
          assert.equal(tx.state, 'active'); tx.state = 'committed';
          for (const store of stores) original[store] = staged[store];
          tx.oncomplete?.();
        },
      };
      transactions.push(tx); onTransaction(tx); return tx;
    },
  };
  const request = {result: database, error: null};
  const memory = new DeviceMemory(() => ({open() { opens += 1; return request; }}));
  return {memory, before, original, transactions, releaseOpen() { request.onsuccess?.(); }, get opens() { return opens; }};
}

test('an already-cancelled restore does not open browser storage', async () => {
  const fixture = databaseFixture(), controller = new AbortController(), original = fixture.before();
  controller.abort();
  await assert.rejects(fixture.memory.restorePersonal(emptyCopy, controller.signal), /MEMORY_OPERATION_ABORTED/u);
  assert.equal(fixture.opens, 0); assert.equal(fixture.transactions.length, 0); assert.equal(fixture.before(), original);
});

test('a delayed database open cannot start restore writes after cancellation', async () => {
  const fixture = databaseFixture(), controller = new AbortController(), original = fixture.before();
  const operation = fixture.memory.restorePersonal(emptyCopy, controller.signal);
  const rejected = assert.rejects(operation, /MEMORY_OPERATION_ABORTED/u);
  assert.equal(fixture.opens, 1); controller.abort(); fixture.releaseOpen(); await rejected;
  assert.equal(fixture.transactions.length, 0); assert.equal(fixture.before(), original);
});

test('cancellation during transaction construction is caught before queueing writes', async () => {
  const controller = new AbortController(), fixture = databaseFixture(() => controller.abort()), original = fixture.before();
  const operation = fixture.memory.restorePersonal(emptyCopy, controller.signal);
  const rejected = assert.rejects(operation, /MEMORY_OPERATION_ABORTED/u);
  fixture.releaseOpen(); await rejected;
  assert.equal(fixture.transactions.length, 1); assert.equal(fixture.transactions[0].operations, 0);
  assert.equal(fixture.transactions[0].abortCalls, 1); assert.equal(fixture.before(), original);
});

test('cancelling an uncommitted restore aborts its transaction and keeps the prior copy', async () => {
  const fixture = databaseFixture(), controller = new AbortController(), original = fixture.before();
  const operation = fixture.memory.restorePersonal(emptyCopy, controller.signal);
  const rejected = assert.rejects(operation, /MEMORY_OPERATION_ABORTED/u);
  fixture.releaseOpen(); await tick();
  const tx = fixture.transactions[0]; assert.equal(tx.operations, 3); assert.equal(fixture.before(), original);
  controller.abort(); await rejected;
  assert.equal(tx.state, 'aborted'); assert.equal(tx.abortCalls, 1); assert.equal(fixture.before(), original);
});

test('successful restore cleans its cancellation listener and cannot undo an already committed copy', async () => {
  const fixture = databaseFixture(), controller = new AbortController(), listeners = new Set();
  const add = controller.signal.addEventListener.bind(controller.signal), remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (type, listener, options) => { if (type === 'abort') listeners.add(listener); return add(type, listener, options); };
  controller.signal.removeEventListener = (type, listener, options) => { if (type === 'abort') listeners.delete(listener); return remove(type, listener, options); };
  const operation = fixture.memory.restorePersonal(emptyCopy, controller.signal);
  fixture.releaseOpen(); await tick(); assert.equal(listeners.size, 1);
  const tx = fixture.transactions[0]; tx.complete(); await operation;
  assert.equal(listeners.size, 0); controller.abort();
  assert.equal(tx.abortCalls, 0); assert.equal(fixture.original.meta.has('focus'), false);
  assert.equal(fixture.original.meta.has('comparison'), false); assert.equal(fixture.original.saved.size, 0);
  assert.equal(fixture.original.meta.get('daily'), 'keep daily');
});

test('existing restore callers without a signal retain the explicit replacement boundary', async () => {
  const fixture = databaseFixture(); const operation = fixture.memory.restorePersonal(emptyCopy);
  fixture.releaseOpen(); await tick(); const tx = fixture.transactions[0];
  assert.deepEqual(tx.stores, ['meta', 'saved']); assert.equal(tx.mode, 'readwrite'); tx.complete(); await operation;
  assert.deepEqual([...fixture.original.meta], [['daily', 'keep daily']]); assert.equal(fixture.original.saved.size, 0);
});
