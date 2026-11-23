import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeUniversalFlow } from '../.build/src/universal-flow.js';

const now = '2026-11-23T09:00:00.000Z';
const base = {
  publisherId: 'publisher-a',
  kind: 'news',
  scope: 'global',
  countryCode: null,
  cityId: null,
  publishedAt: now,
  verified: true,
  rightsCleared: true,
  importance: 50,
};
const context = {
  countryCode: 'RO',
  cityId: 'bucharest',
  now,
  seenEventIds: new Set(),
  limit: 20,
};

test('local information precedes comparable global information', () => {
  const global = { ...base, id: 'global', eventId: 'global' };
  const local = { ...base, id: 'local', eventId: 'local', scope: 'city', countryCode: 'RO', cityId: 'bucharest' };
  assert.deepEqual(composeUniversalFlow([global, local], context).map((x) => x.id), ['local', 'global']);
});

test('one event appears once even when several publishers cover it', () => {
  const a = { ...base, id: 'a', eventId: 'same' };
  const b = { ...base, id: 'b', eventId: 'same', publisherId: 'publisher-b' };
  assert.equal(composeUniversalFlow([a, b], context).length, 1);
});

test('seen, unverified, unlicensed and future cards are excluded', () => {
  const cards = [
    { ...base, id: 'seen', eventId: 'seen' },
    { ...base, id: 'unverified', eventId: 'unverified', verified: false },
    { ...base, id: 'unlicensed', eventId: 'unlicensed', rightsCleared: false },
    { ...base, id: 'future', eventId: 'future', publishedAt: '2026-11-24T09:00:00Z' },
  ];
  assert.deepEqual(composeUniversalFlow(cards, { ...context, seenEventIds: new Set(['seen']) }), []);
});

test('permutation of input does not change selected IDs', () => {
  const cards = [
    { ...base, id: 'b', eventId: 'b' },
    { ...base, id: 'a', eventId: 'a' },
    { ...base, id: 'c', eventId: 'c', publisherId: 'publisher-c' },
  ];
  assert.deepEqual(
    composeUniversalFlow(cards, context).map((x) => x.id),
    composeUniversalFlow([...cards].reverse(), context).map((x) => x.id),
  );
});

test('invalid limits are rejected', () => {
  assert.throws(() => composeUniversalFlow([], { ...context, limit: 201 }), RangeError);
});
