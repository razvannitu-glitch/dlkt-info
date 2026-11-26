import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {walletSnapshot} from '../.build/src/wallet/contracts.js';
import {WALLET_PROVIDER_IDS} from '../.build/src/wallet/providers.js';
import {CONNECTIONS_VERSION} from '../.build/src/connections/types.js';
import {loadPersonalInbox, personalInboxProviderName, personalInboxStatus, PersonalInboxError} from '../.build/src/wallet/personal-inbox.js';

const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = '22222222-2222-4222-8222-222222222222';
const ids = Object.fromEntries(WALLET_PROVIDER_IDS.map((providerId, index) => [providerId, `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`]));
const now = () => new Date().toISOString();
const view = providerId => ({providerId, status: 'connected', connection: {id: ids[providerId], accountLabel: 'qa@example.com', connectedAt: now(), lastSyncAt: null, status: 'connected'}});
const snapshot = (active = ['gmail'], overrides = {}) => ({version: CONNECTIONS_VERSION, providers: WALLET_PROVIDER_IDS.map(providerId => ({providerId, status: 'unavailable', connection: null, ...(active.includes(providerId) ? view(providerId) : {}), ...overrides[providerId]}))});
const event = (providerId = 'gmail', index = 1, extra = {}) => ({ownerId: owner, connectionId: ids[providerId], providerId,
  providerEventId: index.toString(16), providerThreadId: index.toString(16),
  kind: ['gmail', 'outlook'].includes(providerId) ? 'email.received' : 'comment.received',
  occurredAt: new Date(Date.now() - index * 60_000).toISOString(), observedAt: now(), actor: null,
  title: `Private update ${index}`, excerpt: null,
  sourceUrl: providerId === 'gmail' ? `https://mail.google.com/mail/?authuser=qa%40example.com#all/${index.toString(16)}`
    : providerId === 'outlook' ? `https://outlook.office.com/mail/deeplink/read/message${index}`
    : providerId === 'instagram' ? `https://www.instagram.com/p/Post${index}/` : `https://www.facebook.com/Page/posts/${index}`,
  sourceUrlOrigin: 'provider-generated', unread: null, importance: 'normal', metrics: [], visibility: 'private', ...extra});
const sync = (events = [event()], state = 'available') => ({events, state, checkedAt: now()});
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (value, status = 200) => ({ok: status >= 200 && status < 300, status, json: async () => value});

function requestsQueue() {
  const requests = [];
  const fetcher = (path, init) => new Promise((resolve, reject) => requests.push({path, init, resolve, reject}));
  return {requests, fetcher, async answer(index, value, status = 200) {
    assert.ok(requests[index], `expected request ${index}`);
    requests[index].resolve(response(value, status)); await tick();
  }};
}
function acquisition() {
  const queue = requestsQueue(), abort = new AbortController();
  const pending = loadPersonalInbox(queue.fetcher, abort.signal);
  pending.catch(() => {});
  return {...queue, abort, pending};
}
async function begin(check, connected = ['gmail'], overrides = {}) {
  await check.answer(0, walletSnapshot('signed-in'));
  await check.answer(1, snapshot(connected, overrides));
}

test('No private connections or sync is queried until the authenticated Wallet says signed in', async () => {
  for (const account of ['signed-out', 'unavailable']) {
    const check = acquisition(); await check.answer(0, walletSnapshot(account));
    assert.equal((await check.pending).account, account);
    assert.equal(check.requests.length, 1);
  }
});

test('Live unavailable, ready-to-connect and reconnect-required states cannot become authorized syncs', async () => {
  const check = acquisition();
  await begin(check, [], {gmail: {status: 'available'}, outlook: {...view('outlook'), status: 'reconnect-required', connection: {...view('outlook').connection, status: 'reconnect-required'}}});
  const result = await check.pending;
  assert.equal(check.requests.length, 2);
  assert.equal(result.connected, 0); assert.equal(result.available, 1); assert.equal(result.reconnect, 1);
  assert.match(personalInboxStatus(result), /authorization again/u);
});

test('A bounded authorized sync returns the latest five metadata events only after connection readback', async () => {
  const check = acquisition(); await begin(check, WALLET_PROVIDER_IDS);
  assert.equal(check.requests.length, 6);
  for (let index = 0; index < 4; index += 1) {
    const request = check.requests[2 + index];
    assert.deepEqual(JSON.parse(request.init.body), {action: 'sync', providerId: WALLET_PROVIDER_IDS[index]});
    assert.equal(request.path, '/api/connections');
    assert.equal(request.init.credentials, 'same-origin'); assert.equal(request.init.cache, 'no-store'); assert.equal(request.init.redirect, 'error');
    assert.equal(request.init.headers['X-DLKT-Info-Request'], 'connections-v1');
    await check.answer(2 + index, sync([event(WALLET_PROVIDER_IDS[index], index * 3 + 3), event(WALLET_PROVIDER_IDS[index], index * 3 + 1)]));
  }
  assert.equal(check.requests[6].init.method, 'GET');
  await check.answer(6, snapshot(WALLET_PROVIDER_IDS));
  const result = await check.pending;
  assert.equal(result.connected, 4); assert.equal(result.events.length, 5); assert.equal(result.state, 'ready');
  assert.deepEqual(result.events.map(value => value.providerEventId), ['1', '3', '4', '6', '7']);
});

test('Owner mixing across otherwise valid provider responses fails closed', async () => {
  const check = acquisition(); await begin(check, ['gmail', 'outlook']);
  await check.answer(2, sync());
  await check.answer(3, sync([event('outlook', 2, {ownerId: otherOwner})]));
  await assert.rejects(check.pending, error => error instanceof PersonalInboxError && error.reason === 'invalid');
  assert.equal(check.requests.length, 4);
});

test('Disconnect or different connection UUID at readback discards the whole pending private batch', async () => {
  for (const changed of [{status: 'available', connection: null}, {...view('gmail'), connection: {...view('gmail').connection, id: otherOwner}}]) {
    const check = acquisition(); await begin(check); await check.answer(2, sync());
    await check.answer(3, snapshot([], {gmail: changed}));
    await assert.rejects(check.pending, error => error.reason === 'changed');
  }
});

test('401 at sync or final readback ends the session and never returns the preceding private data', async () => {
  for (const stage of ['sync', 'readback']) {
    const check = acquisition(); await begin(check);
    if (stage === 'readback') await check.answer(2, sync());
    await check.answer(stage === 'sync' ? 2 : 3, {error: 'untrusted internals'}, 401);
    await assert.rejects(check.pending, error => error.reason === 'signed-out');
  }
});

test('Current social scopes reject an invented direct-message result and unsafe source links', async () => {
  for (const bad of [event('instagram', 1, {kind: 'message.received'}), event('instagram', 1, {sourceUrl: 'https://attacker.invalid/'})]) {
    const check = acquisition(); await begin(check, ['instagram']); await check.answer(2, sync([bad]));
    await assert.rejects(check.pending, error => error.reason === 'invalid');
  }
});

test('A failed or partial provider remains partial without hiding successfully verified updates', async () => {
  const check = acquisition(); await begin(check, ['gmail', 'outlook']);
  await check.answer(2, {error: 'upstream'}, 502); await check.answer(3, sync([event('outlook')], 'partial'));
  await check.answer(4, snapshot(['gmail', 'outlook']));
  const result = await check.pending;
  assert.equal(result.state, 'partial'); assert.equal(result.events.length, 1);
  assert.equal(result.failedProviders, 1);
  assert.match(personalInboxStatus(result), /could not be checked/u);
});

test('Cancellation even when the transport ignores its signal prevents follow-up requests and results', async () => {
  const check = acquisition(); await begin(check);
  check.abort.abort(); await check.answer(2, sync());
  await assert.rejects(check.pending); assert.equal(check.requests.length, 3);
  assert.equal(check.requests[2].init.signal.aborted, true);
});

test('A total source failure is reported as incomplete checking, never an empty inbox', async () => {
  const check = acquisition(); await begin(check); await check.answer(2, {error: 'upstream unavailable'}, 502);
  await check.answer(3, snapshot());
  const result = await check.pending;
  assert.equal(result.state, 'partial'); assert.equal(result.events.length, 0);
  assert.match(personalInboxStatus(result), /could not be checked/u);
  assert.doesNotMatch(personalInboxStatus(result), /No recent|complete account history/u);
});

class Target {
  listeners = new Map();
  addEventListener(name, listener) {this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);}
  dispatch(name, value = {}) {for (const listener of this.listeners.get(name) ?? []) listener({preventDefault() {}, ...value});}
}
class Element extends Target {
  children = []; content = ''; attributes = new Map(); hidden = false; disabled = false;
  constructor(tag) {super(); this.tagName = tag.toUpperCase();}
  set textContent(value) {this.content = value; this.children = [];}
  get textContent() {return this.content + this.children.map(child => child.textContent).join('');}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.content = ''; this.children = children;}
  setAttribute(name, value) {this.attributes.set(name, value);}
  querySelectorAll(tag) {return this.children.flatMap(child => [...(child.tagName === tag.toUpperCase() ? [child] : []), ...child.querySelectorAll(tag)]);}
}
function home() {
  const queue = requestsQueue(), document = new Target(), window = new Target();
  const elements = new Map(['wallet-home', 'wallet-home-status', 'wallet-home-updates', 'wallet-home-refresh'].map(id => [id, new Element(id === 'wallet-home-updates' ? 'ul' : id === 'wallet-home-refresh' ? 'button' : 'div')]));
  Object.assign(document, {hidden: false, focused: true, hasFocus() {return this.focused;}, getElementById: id => elements.get(id) ?? null, createElement: tag => new Element(tag)});
  const timers = new Map(), channels = []; let sequence = 0;
  window.setTimeout = (callback, delay) => {timers.set(++sequence, {callback, delay}); return sequence;};
  window.clearTimeout = id => timers.delete(id);
  class Channel extends Target {constructor(name) {super(); this.name = name; channels.push(this);}}
  const source = readFileSync('.build/src/wallet/home-browser.js', 'utf8').replace(/^import [^\n]+\n/gmu, '');
  runInNewContext(source, {document, window, fetch: queue.fetcher, AbortController, BroadcastChannel: Channel, Date,
    loadPersonalInbox, personalInboxStatus, personalInboxProviderName, PersonalInboxError});
  return {...queue, document, window, timers, get: id => elements.get(id),
    session(data) {for (const channel of channels) channel.dispatch('message', {data});},
    async timer(delay) {const entry = [...timers].find(([, value]) => value.delay === delay); assert.ok(entry, `expected timer ${delay}`); timers.delete(entry[0]); entry[1].callback(); await tick();},
  };
}
async function ready(ui, events = [event()], state = 'available', offset = 0) {
  await ui.answer(offset, walletSnapshot('signed-in')); await ui.answer(offset + 1, snapshot());
  await ui.answer(offset + 2, sync(events, state));
  assert.equal(ui.get('wallet-home-updates').children.length, 0);
  await ui.answer(offset + 3, snapshot());
}

test('Homepage renders only five source links as text, with unread labels only when supplied', async () => {
  const ui = home(); await ready(ui, Array.from({length: 7}, (_, index) => event('gmail', index + 1, {title: '<img src=x onerror=alert(1)>', unread: index === 0 ? true : null})));
  assert.equal(ui.get('wallet-home-updates').children.length, 5);
  assert.equal(ui.get('wallet-home-updates').querySelectorAll('img').length, 0);
  assert.equal(ui.get('wallet-home-updates').querySelectorAll('a')[0].rel, 'noopener noreferrer');
  assert.equal(ui.get('wallet-home-updates').querySelectorAll('a')[0].referrerPolicy, 'no-referrer');
  assert.equal((ui.get('wallet-home-updates').textContent.match(/Unread/gu) ?? []).length, 1);
  assert.equal(ui.get('wallet-home-refresh').hidden, false);
  assert.ok([...ui.timers.values()].some(timer => timer.delay === 60_000));
  ui.window.dispatch('blur');
  assert.equal(ui.get('wallet-home-updates').children.length, 0); assert.equal(ui.timers.size, 0);
  assert.equal(ui.get('wallet-home-refresh').hidden, true);
});

test('Hidden page or logout immediately clears updates and aborts an in-flight sync; late data cannot return', async () => {
  for (const reason of ['hidden', 'logout']) {
    const ui = home(); await ui.answer(0, walletSnapshot('signed-in')); await ui.answer(1, snapshot());
    if (reason === 'hidden') {ui.document.hidden = true; ui.document.dispatch('visibilitychange');}
    else ui.session('signed-out');
    assert.equal(ui.requests[2].init.signal.aborted, true);
    await ui.answer(2, sync());
    assert.equal(ui.get('wallet-home-updates').children.length, 0); assert.equal(ui.requests.length, 3); assert.equal(ui.timers.size, 0);
  }
});

test('401 during a subsequent refresh clears rendered data, stops polling and asks for sign-in', async () => {
  const ui = home(); await ready(ui); await ui.timer(60_000);
  assert.equal(ui.get('wallet-home-updates').children.length, 0);
  await ui.answer(4, {error: 'private-server-internals'}, 401);
  assert.match(ui.get('wallet-home-status').textContent, /session ended/u);
  assert.doesNotMatch(ui.get('wallet-home-status').textContent, /private-server-internals/u);
  assert.equal(ui.get('wallet-home-refresh').hidden, true); assert.equal(ui.timers.size, 0);
});

test('A successful social check keeps its partial scope visible without slowing the normal 60-second cadence', async () => {
  const ui = home();
  await ui.answer(0, walletSnapshot('signed-in')); await ui.answer(1, snapshot(['instagram']));
  await ui.answer(2, sync([event('instagram')], 'partial')); await ui.answer(3, snapshot(['instagram']));
  assert.equal(ui.get('wallet-home-updates').children.length, 1);
  assert.match(ui.get('wallet-home-status').textContent, /Some updates could not be checked/u);
  assert.ok([...ui.timers.values()].some(timer => timer.delay === 60_000));
  assert.ok([...ui.timers.values()].every(timer => timer.delay !== 120_000));
  ui.window.dispatch('blur');
});

test('Foreground checks coalesce and failures back off while unconnected accounts never poll', async () => {
  const ui = home(); await ready(ui);
  ui.get('wallet-home-refresh').dispatch('click'); ui.get('wallet-home-refresh').dispatch('click'); ui.window.dispatch('focus');
  assert.equal(ui.requests.length, 5);
  await ui.answer(4, {error: 'temporary'}, 503);
  assert.ok([...ui.timers.values()].some(timer => timer.delay === 120_000));
  await ui.timer(120_000); await ui.answer(5, walletSnapshot('signed-in')); await ui.answer(6, snapshot([]));
  assert.equal(ui.get('wallet-home-refresh').hidden, true); assert.equal(ui.timers.size, 0);
});

test('Returning from hidden state rechecks Wallet before any personal activity; signed-in signal replaces old generation', async () => {
  const ui = home(); await ready(ui); ui.document.hidden = true; ui.document.dispatch('visibilitychange');
  ui.document.hidden = false; ui.document.dispatch('visibilitychange');
  assert.equal(ui.requests[4].path, '/api/wallet');
  ui.session('signed-in'); assert.equal(ui.requests[4].init.signal.aborted, true);
  await ui.answer(4, walletSnapshot('signed-in'));
  assert.equal(ui.requests.length, 6); await ui.answer(5, walletSnapshot('signed-out'));
  assert.equal(ui.timers.size, 0); assert.equal(ui.get('wallet-home-updates').children.length, 0);
});

test('Private homepage code has no persistence, body rendering, provider writes or public-feed destinations', () => {
  const source = readFileSync('src/wallet/home-browser.ts', 'utf8') + readFileSync('src/wallet/personal-inbox.ts', 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML|outerHTML|insertAdjacentHTML|navigator\.share|\/api\/share|\/api\/edition|setInterval|event\.excerpt/u);
  assert.doesNotMatch(source, /action:\s*['"](?:connect|disconnect|send|publish)['"]/u);
});


test('A saved profile without connected providers points to personal selection without promising matching cards', () => {
  const value = {account: 'signed-in', profileSaved: true, connected: 0, available: 0, reconnect: 0,
    events: [], state: 'idle', failedProviders: 0, checkedAt: null};
  const saved = personalInboxStatus(value);
  assert.match(saved, /review your preferences and personal selection/u);
  assert.match(saved, /Email and social connections are currently unavailable/u);
  assert.doesNotMatch(saved, /ready|matched cards|new updates|complete coverage/iu);
  const empty = personalInboxStatus({...value, profileSaved: false});
  assert.match(empty, /Create your private profile/u);
  assert.doesNotMatch(empty, /profile is saved|ready|matched cards/iu);
});
