import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPersonalDailyEdition} from '../.build/src/wallet/daily.js';

const OWNER = '3f3bc542-37a6-4dc6-804c-0b8cd946ef13';
const CONNECTION = '4f3bc542-37a6-4dc6-804c-0b8cd946ef13';
const OTHER = '5f3bc542-37a6-4dc6-804c-0b8cd946ef13';
const NOW = '2026-11-18T12:00:00.000Z';
function event(overrides = {}) {
  const value = {ownerId: OWNER, connectionId: CONNECTION, providerId: 'gmail', providerEventId: 'a1', providerThreadId: 'c1', kind: 'email.received', occurredAt: '2026-11-18T11:00:00.000Z', observedAt: NOW, actor: null, title: 'Message', excerpt: null, sourceUrl: 'https://mail.google.com/mail/?authuser=reader%40example.com#all/c1', sourceUrlOrigin: 'provider-generated', unread: true, importance: 'normal', metrics: [], visibility: 'private', ...overrides};
  value.sourceUrl = `https://mail.google.com/mail/?authuser=reader%40example.com#all/${value.providerThreadId}`;
  return value;
}
function source(overrides = {}) { return {ownerId: OWNER, connectionId: CONNECTION, providerId: 'gmail', state: 'success', checkedAt: NOW, events: [], reason: null, ...overrides}; }
function edition(sources, extra = {}) { return buildPersonalDailyEdition({ownerId: OWNER, now: NOW, sources, ...extra}); }

test('zero messages is confirmed only for a complete, fresh successful source', () => {
  const checked = edition([source()]);
  assert.equal(checked.state, 'ready');
  assert.equal(checked.confirmedEmpty, true);
  for (const candidate of [source({state: 'failed', reason: 'network'}), source({state: 'partial', reason: 'limit'}), source({state: 'unavailable', checkedAt: null, reason: 'not-configured'}), source({state: 'not-connected', checkedAt: null}), source({checkedAt: '2026-11-18T10:00:00.000Z'})]) {
    assert.equal(edition([candidate]).confirmedEmpty, false);
  }
  assert.equal(edition([]).state, 'not-connected');
  assert.equal(edition([]).confirmedEmpty, false);
});

test('one healthy connection never hides another failed connection', () => {
  const result = edition([source(), source({connectionId: OTHER, providerId: 'outlook', state: 'failed', reason: 'authorization'})]);
  assert.equal(result.state, 'partial');
  assert.equal(result.confirmedEmpty, false);
  assert.deepEqual(result.sources.map(entry => entry.state), ['success', 'failed']);
  const stale = edition([source({checkedAt: '2026-11-18T10:00:00.000Z', events: [event({observedAt: '2026-11-18T10:00:00.000Z', occurredAt: '2026-11-18T09:00:00.000Z'})]})]);
  assert.equal(stale.sources[0].state, 'stale');
  assert.equal(stale.items.length, 0);
  assert.equal(stale.state, 'unavailable');
});

test('finite deterministic ordering uses declared source importance and unread state', () => {
  const result = edition([source({events: [
    event({providerEventId: 'a1', providerThreadId: 'c1', unread: false, occurredAt: '2026-11-18T11:59:00.000Z'}),
    event({providerEventId: 'a2', providerThreadId: 'c2', unread: true, occurredAt: '2026-11-18T11:30:00.000Z'}),
    event({providerEventId: 'a3', providerThreadId: 'c3', importance: 'source-important', unread: false, occurredAt: '2026-11-18T09:00:00.000Z'}),
  ]})], {maxItems: 2});
  assert.deepEqual(result.items.map(item => item.event.providerEventId), ['a3', 'a2']);
  assert.deepEqual(result.items.map(item => item.priorityReason), ['source-important', 'unread-message']);
  assert.equal(result.hasMore, true);
  assert.equal(result.totalEventCount, 3);
  assert(Object.isFrozen(result.items));
});

test('dedup is scoped to the owner and connection; thread grouping keeps a correct count', () => {
  const original = event({observedAt: '2026-11-18T11:55:00.000Z'});
  const update = event({unread: false});
  const result = edition([
    source({events: [original, update, event({providerEventId: 'a2'})]}),
    source({connectionId: OTHER, events: [event({connectionId: OTHER})]}),
  ]);
  assert.equal(result.totalEventCount, 3);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(item => item.relatedEventCount).sort(), [1, 2]);
  assert.equal(result.sources[0].eventCount, 2);
  assert.equal(result.sources[1].eventCount, 1);
  assert.throws(() => edition([source({events: [event(), event({title: 'Conflicting payload'})]})]), /WALLET_DAILY_INVALID/u);
});

test('rejects cross-owner events, connection aliases and impossible success/error combinations', () => {
  assert.throws(() => edition([source({ownerId: OTHER})]), /WALLET_DAILY_INVALID/u);
  assert.throws(() => edition([source({events: [event({ownerId: OTHER})]})]), /OWNER_MISMATCH/u);
  assert.throws(() => edition([source({events: [event({connectionId: OTHER})]})]), /CONNECTION_MISMATCH/u);
  assert.throws(() => edition([source(), source({providerId: 'outlook'})]), /WALLET_DAILY_INVALID/u);
  assert.throws(() => edition([source({state: 'failed', reason: 'network', events: [event()]})]), /WALLET_DAILY_INVALID/u);
  assert.throws(() => edition([source({reason: 'network'})]), /WALLET_DAILY_INVALID/u);
  assert.throws(() => edition([source({state: 'partial'})]), /WALLET_DAILY_INVALID/u);
  assert.throws(() => edition([source({checkedAt: '2026-11-18T12:02:00.000Z'})]), /WALLET_DAILY_INVALID/u);
});

test('daily time window and resource caps are enforced', () => {
  const result = edition([source({events: [event({occurredAt: '2026-11-17T11:59:59.000Z'})]})]);
  assert.equal(result.items.length, 0);
  assert.equal(result.confirmedEmpty, true);
  assert.throws(() => edition([source()], {maxItems: 21}), /WALLET_DAILY_INVALID/u);
  assert.throws(() => edition([source()], {maxItems: 0}), /WALLET_DAILY_INVALID/u);
  assert.throws(() => edition(Array.from({length: 17}, () => source())), /WALLET_DAILY_INVALID/u);
  assert.throws(() => edition([source({events: Array.from({length: 101}, () => event())})]), /WALLET_DAILY_INVALID/u);
});
