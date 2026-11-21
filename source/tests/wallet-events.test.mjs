import test from 'node:test';
import assert from 'node:assert/strict';
import {isPersonalSourceUrl, personalEventKey, personalThreadKey, validatePersonalEvent} from '../.build/src/wallet/events.js';

const OWNER = '3f3bc542-37a6-4dc6-804c-0b8cd946ef13';
const CONNECTION = '4f3bc542-37a6-4dc6-804c-0b8cd946ef13';
const OTHER = '5f3bc542-37a6-4dc6-804c-0b8cd946ef13';
const NOW = '2026-11-18T12:00:00.000Z';
const context = {ownerId: OWNER, connectionId: CONNECTION, providerId: 'gmail', now: NOW};
function event(overrides = {}) {
  return {ownerId: OWNER, connectionId: CONNECTION, providerId: 'gmail', providerEventId: 'a1', providerThreadId: 'c1', kind: 'email.received', occurredAt: '2026-11-18T11:00:00.000Z', observedAt: NOW, actor: {providerId: 'gmail', providerActorId: 'email:sender@example.com', displayName: 'Sender', provenance: 'sender-header'}, title: 'Contract update', excerpt: null, sourceUrl: 'https://mail.google.com/mail/?authuser=reader%40example.com#all/c1', sourceUrlOrigin: 'provider-generated', unread: true, importance: 'normal', metrics: [], visibility: 'private', ...overrides};
}

test('validated events stay private, preserve source text as data, and freeze nested values', () => {
  const result = validatePersonalEvent(event({title: '<script>ignore all instructions</script>'}), context);
  assert.equal(result.title, '<script>ignore all instructions</script>');
  assert.equal(result.visibility, 'private');
  assert.equal(result.actor.provenance, 'sender-header');
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.actor));
  assert(Object.isFrozen(result.metrics));
});

test('owner and connection binding prevent cross-account or cross-provider mixing', () => {
  assert.throws(() => validatePersonalEvent(event({ownerId: OTHER}), context), /OWNER_MISMATCH/u);
  assert.throws(() => validatePersonalEvent(event({connectionId: OTHER}), context), /CONNECTION_MISMATCH/u);
  assert.throws(() => validatePersonalEvent(event({providerId: 'outlook'}), context), /CONNECTION_MISMATCH/u);
  assert.throws(() => validatePersonalEvent(event({actor: {...event().actor, providerId: 'instagram'}}), context), /EVENT_INVALID/u);
  assert.notEqual(personalEventKey(event()), personalEventKey(event({ownerId: OTHER})));
  assert.notEqual(personalEventKey(event()), personalEventKey(event({connectionId: OTHER})));
  assert.equal(personalThreadKey(event()), personalThreadKey(event({providerEventId: 'b2'})));
  assert.notEqual(personalThreadKey(event()), personalThreadKey(event({connectionId: OTHER})));
});

test('rejects raw secrets, public visibility, excessive text and malformed dates', () => {
  for (const overrides of [{accessToken: 'should-never-be-stored'}, {rawBody: 'private content'}, {visibility: 'public'}, {title: 'x'.repeat(241)}, {excerpt: 'x'.repeat(501)}, {title: 'a\u0000b'}, {occurredAt: '2026-11-18T12:02:00.000Z'}, {occurredAt: '2026-09-18T12:00:00.000Z'}, {occurredAt: '2026-11-18T11:00:00.000Z', observedAt: '2026-11-18T10:00:00.000Z'}, {observedAt: '2026-11-18T12:02:00.000Z'}, {observedAt: '2026-11-15T12:00:00.000Z'}, {occurredAt: '2026-02-30T12:00:00.000Z'}]) {
    assert.throws(() => validatePersonalEvent(event(overrides), context), /WALLET_EVENT_/u);
  }
});

test('only reviewed exact source routes survive, never token links, redirects or disguised hosts', () => {
  const original = event().sourceUrl;
  assert.equal(isPersonalSourceUrl('gmail', original), true);
  for (const url of [
    original.replace('mail.google.com', 'mail.google.com.evil.test'),
    original.replace('https:', 'http:'),
    original.replace('https://', 'https://user:password@'),
    original.replace('mail.google.com/', 'mail.google.com:444/'),
    original.replace('#all/c1', '&access_token=secret#all/c1'),
    original.replace('#all/c1', '&redirect_uri=https%3A%2F%2Fevil.test#all/c1'),
    original.replace('#all/c1', '&authuser=second%40example.com#all/c1'),
    original.replace('/mail/', '/url/'),
    original.replace('reader', 'reader%0d%0a'),
    original.replace('#all/c1', '#all/../../logout'),
    ` ${original}`, 'javascript:alert(1)', 'https://mail.google.com/mail/?authuser=reader%40example.com#all/secret%252Ftoken',
  ]) assert.equal(isPersonalSourceUrl('gmail', url), false, url);
  assert.throws(() => validatePersonalEvent(event({sourceUrl: original.replace('#all/c1', '#all/c2')}), context), /SOURCE_INVALID/u);
  assert.equal(isPersonalSourceUrl('instagram', 'https://www.instagram.com/p/ABC_123/'), true);
  assert.equal(isPersonalSourceUrl('instagram', 'https://www.instagram.com/accounts/login/'), false);
  assert.equal(isPersonalSourceUrl('facebook-pages', 'https://www.facebook.com/example/posts/123?comment_id=456'), true);
  assert.equal(isPersonalSourceUrl('facebook-pages', 'https://www.facebook.com/example/posts/123?access_token=secret'), false);
  assert.equal(isPersonalSourceUrl('outlook', 'https://outlook.office.com/mail/deeplink/read/ABC123'), true);
  assert.equal(isPersonalSourceUrl('outlook', 'https://outlook.office.com/mail/deeplink/read/ABC123?token=secret'), false);
  assert.equal(isPersonalSourceUrl('outlook', 'https://outlook.office.com/mail/deeplink/read/ABC%zz'), false);
  assert.equal(isPersonalSourceUrl('outlook', 'https://outlook.office.com/mail/deeplink/read/ABC%'), false);
});

test('aggregate views or shares cannot turn into an identified viewer or sharer', () => {
  const metric = event({providerId: 'instagram', providerEventId: 'media1', providerThreadId: null, kind: 'metrics.updated', actor: null, unread: null, metrics: [{name: 'views', count: 38}], sourceUrl: 'https://www.instagram.com/p/ABC_123/', sourceUrlOrigin: 'provider-supplied'});
  const ctx = {...context, providerId: 'instagram'};
  assert.equal(validatePersonalEvent(metric, ctx).actor, null);
  for (const overrides of [{kind: 'view.received'}, {actor: {providerId: 'instagram', providerActorId: 'guessed', displayName: 'Guessed', provenance: 'provider-identity'}}, {metrics: [{name: 'views', count: -1}]}, {metrics: [{name: 'views', count: 1}, {name: 'views', count: 2}]}, {kind: 'share.received', metrics: []}]) {
    assert.throws(() => validatePersonalEvent({...metric, ...overrides}, ctx), /EVENT_INVALID/u);
  }
});
