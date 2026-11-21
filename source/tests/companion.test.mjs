import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPANION_TOPICS,
  COMPANION_VERSION,
  DEFAULT_COMPANION_PREFERENCES,
  parseCompanionPreferences,
} from '../.build/src/companion/index.js';

const valid = () => ({
  topics: ['technology', 'opportunities'],
  entities: ['OpenAI', 'EU AI Act'],
  timezone: 'Europe/Bucharest',
  deliveryLocalTime: '07:45',
  maxCards: 8,
  minMateriality: 'medium',
  onlyActionable: true,
});

test('personal companion has an explicit version and safe defaults', () => {
  assert.equal(COMPANION_VERSION, 'dlkt-info-companion-1');
  assert.deepEqual(DEFAULT_COMPANION_PREFERENCES.topics, COMPANION_TOPICS);
  assert.equal(DEFAULT_COMPANION_PREFERENCES.maxCards, 5);
  assert.deepEqual(DEFAULT_COMPANION_PREFERENCES.entities, []);
  assert.equal(Object.isFrozen(DEFAULT_COMPANION_PREFERENCES), true);
});

test('personal companion accepts a user-defined finite worldwide briefing definition', () => {
  const parsed = parseCompanionPreferences(valid());
  assert.deepEqual(parsed, valid());
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.topics), true);
  assert.equal(Object.isFrozen(parsed.entities), true);
});

test('personal companion rejects unknown fields, duplicates and invalid numeric budgets', () => {
  assert.throws(() => parseCompanionPreferences({ ...valid(), secret: 'x' }), /UNKNOWN_FIELD/u);
  assert.throws(() => parseCompanionPreferences({ ...valid(), topics: ['technology', 'technology'] }), /INPUT_INVALID/u);
  assert.equal(parseCompanionPreferences({ ...valid(), maxCards: 250 }).maxCards, 250);
  assert.equal(parseCompanionPreferences({ ...valid(), entities: Array.from({ length: 20 }, (_, index) => `Entity ${index + 1}`) }).entities.length, 20);
  assert.throws(() => parseCompanionPreferences({ ...valid(), maxCards: 0 }), /INPUT_INVALID/u);
  assert.throws(() => parseCompanionPreferences({ ...valid(), maxCards: 2_147_483_648 }), /INPUT_INVALID/u);
  assert.throws(() => parseCompanionPreferences({ ...valid(), timezone: 'Not/A_Real_Zone' }), /INPUT_INVALID/u);
  assert.throws(() => parseCompanionPreferences({ ...valid(), deliveryLocalTime: '24:00' }), /INPUT_INVALID/u);
  assert.throws(() => parseCompanionPreferences({ ...valid(), entities: ['OpenAI', 'openai'] }), /INPUT_INVALID/u);
  assert.throws(() => parseCompanionPreferences({ ...valid(), entities: ['unsafe|separator'] }), /INPUT_INVALID/u);
  assert.deepEqual(parseCompanionPreferences({ ...valid(), entities: ['  OpenAI   API  '] }).entities, ['OpenAI API']);
});
