import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {ACCOUNT_VERSION, ACCOUNT_MAX_BYTES, parseAccountState, parseAccountValue, isObject} from '../.build/src/account/contracts.js';
import {safeLink} from '../.build/src/iceo/card-validation.js';
import {LOCALES} from '../.build/src/i18n/locale.js';
import {accountText as actualAccountText,topicName} from '../.build/src/account/presentation.js';
import {DAILY_TOPICS} from '../.build/src/daily/contracts.js';
import {LOCAL_NEEDS} from '../.build/src/personal/contracts.js';
import {WALLET_PROFILE_VERSION, WALLET_PROFILE_MAX_BYTES, parseWalletProfile, parseWalletSnapshot, walletSnapshot} from '../.build/src/wallet/contracts.js';

const read = file => readFileSync(file, 'utf8');
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const REV = '33333333-3333-4333-8333-333333333333';
const NEXT = '44444444-4444-4444-8444-444444444444';
const STAMP = '2026-11-18T10:00:00.000Z';
const CARD = {id: 'a'.repeat(24), identity: 'https://github.com/nodejs/node/releases/tag/v22.1.0', title: 'Private saved fixture', topic: 'technology', kind: 'software-release', sourceUrl: 'https://github.com/nodejs/node/releases/tag/v22.1.0', publisher: 'Node.js maintainers', sourceIds: ['nodejs'], date: STAMP, dateLabel: 'Published', observedAt: STAMP, contentHash: 'b'.repeat(64), boundary: 'Listing only', deadline: null, version: 'v22.1.0', attribution: 'Source: Node.js maintainers', sourceState: 'verified'};
const VALUE = parseAccountValue({focus: null, cards: [{version: 1, id: CARD.id, savedAt: STAMP, card: CARD}], checkpoint: null});
const LOCAL = parseAccountValue({...VALUE, cards: [{...VALUE.cards[0], card: {...CARD, title: 'Local saved fixture'}}]});
const STATE = {version: ACCOUNT_VERSION, revision: REV, updatedAt: STAMP, value: VALUE};
const PROFILE = parseWalletProfile({displayName: 'Private profile fixture', locale: 'ro-RO', timezone: 'Europe/Bucharest', briefingTime: '06:35', interests: [DAILY_TOPICS[0]], personalPriority: 'personal-first', cityId: '683506', localNeeds: ['utilities']});
const PROFILE_STATE = {version: WALLET_PROFILE_VERSION, revision: REV, updatedAt: STAMP, value: PROFILE};
const OUT = {version: 'dlkt-info-identity-1', configured: true, enabled: true, authenticated: false, blocker: null, user: null};
const OFF = {...OUT, configured: false, enabled: false, blocker: 'ACCOUNT_NOT_READY'};
const signedIn = (id = USER) => ({...OUT, authenticated: true, user: {id, email: 'reader@example.test'}});
const challenge = () => ({...OUT, challenge: 'code-sent'});
const copy = (state = STATE) => ({version: ACCOUNT_VERSION, enabled: true, state});
const tick = () => new Promise(resolve => setImmediate(resolve));

class Target {
  listeners = new Map();
  addEventListener(type, callback) {const list = this.listeners.get(type) ?? []; list.push(callback); this.listeners.set(type, list);}
  dispatch(type, details = {}) {for (const callback of this.listeners.get(type) ?? []) callback({preventDefault() {}, ...details});}
}
class Element extends Target {
  children = []; attributes = new Map(); hidden = false; disabled = false; value = ''; content = ''; className = ''; dataset = {};
  constructor(tag, document) {super(); this.tagName = tag.toUpperCase(); this.document = document;}
  set textContent(value) {this.content = value; this.children = [];}
  get textContent() {return this.content + this.children.map(child => child.textContent).join('');}
  setAttribute(key, value) {this.attributes.set(key, value);}
  getAttribute(key) {return this.attributes.get(key);}
  append(...nodes) {this.children.push(...nodes);}
  replaceChildren(...nodes) {this.content = ''; this.children = nodes;}
  reportValidity() {return true;}
  focus() {if (!this.disabled) this.document.activeElement = this;}
}
function harness(search = '', options = {}) {
  const document = new Target(); document.hidden = false; document.focused = true; document.hasFocus = () => document.focused;
  const elements = new Map();
  for (const match of read('public/account.html').matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gu)) {
    const element = new Element(match[1], document); element.id = match[3];
    element.hidden = /\bhidden(?:\s|$)/u.test(match[2]); element.disabled = /\bdisabled(?:\s|$)/u.test(match[2]);
    const href = /\bhref="([^"]+)"/u.exec(match[2]); if (href) element.setAttribute('href', href[1]);
    elements.set(element.id, element);
  }
  document.getElementById = id => elements.get(id) ?? null;
  document.createElement = tag => new Element(tag, document);
  document.createTextNode = value => {const node = new Element('#text', document); node.content = value; return node;};
  document.querySelectorAll = selector => [...elements.values()].filter(element => selector.split(',').map(tag => tag.trim().toUpperCase()).includes(element.tagName));
  const window = new Target(); const redirects = []; const timers = new Map(); let timerId = 0;
  window.location = {search, hash: options.hash ?? '', replace: destination => redirects.push(destination)};
  window.setTimeout = (callback, milliseconds) => {const id = ++timerId; timers.set(id, {callback, milliseconds}); return id;};
  window.clearTimeout = id => timers.delete(id);
  const channels = []; const broadcasts = [];
  class Channel extends Target {
    constructor(name) {super(); this.name = name; channels.push(this);}
    postMessage(data) {if (options.broadcastFailure) throw new Error('channel unavailable'); broadcasts.push({name: this.name, data});}
    close() {}
  }
  const memory = {reads: 0, checkpoints: 0, restores: []};
  class Memory {
    async read() {memory.reads++; return options.readMemory ? options.readMemory() : {...LOCAL, rejected: 0};}
    async readCheckpoint() {memory.checkpoints++; return LOCAL.checkpoint;}
    async restorePersonal(value, signal) {memory.restores.push({value, signal}); if (options.restoreMemory) await options.restoreMemory(value, signal);}
  }
  const requests = [], profileRequests = [];
  let autoProfileOwnerCheck = false, latestIdentity = signedIn();
  // Existing account scenarios use an empty, valid profile. Dedicated manualProfile scenarios
  // inspect every profile request and its owner readback in the complete request queue.
  const fetch = (path, init) => new Promise((resolve, reject) => {
    const pending = {path, init, resolve, reject};
    if (path === '/api/account-session' && init.method === 'GET' && autoProfileOwnerCheck && !options.manualProfile) {
      autoProfileOwnerCheck = false; profileRequests.push(pending);
      resolve(new Response(JSON.stringify(latestIdentity), {headers: {'content-type': 'application/json'}})); return;
    }
    if (path === '/api/wallet' && !options.manualProfile) {
      profileRequests.push(pending);
      if (init.method !== 'GET') { reject(new Error('Unexpected profile write in account-only scenario')); return; }
      autoProfileOwnerCheck = true;
      resolve(new Response(JSON.stringify(walletSnapshot('signed-in')), {headers: {'content-type': 'application/json'}}));
    } else requests.push(pending);
  });
  const source = read('.build/src/personal/profile-fields.js').replace(/^import [^\n]+\n/gmu, '').replace(/^export /gmu, '')
    + '\n' + read('.build/src/account/browser.js').replace(/^import [^\n]+\n/gmu, '');
  runInNewContext(source, {document, window, fetch, AbortController, TextDecoder, DeviceMemory: Memory,
    BroadcastChannel: Channel, ACCOUNT_VERSION, ACCOUNT_MAX_BYTES, parseAccountState, parseAccountValue, isObject, safeLink,
    DAILY_TOPICS, LOCAL_NEEDS, WALLET_PROFILE_MAX_BYTES, parseWalletProfile, parseWalletSnapshot,
    Error, Intl, JSON, LOCALES, topicName,
    setupLanguage: optionsArg => {assert.equal(optionsArg.updateUrl,false);},
    getLocale: () => options.locale ?? 'en',
    initializeCountryLanguage: () => options.countryReady ?? Promise.resolve(),
    accountText: value => actualAccountText(value,options.locale ?? 'en'), applyAccountPresentation: () => {}}, {filename: 'account-browser.js'});
  return {
    document, window, requests, profileRequests, redirects, memory, broadcasts, timers, get: id => elements.get(id),
    interests: () => elements.get('account-profile-interests').children.map(label => label.children[0]),
    input(email) {elements.get('account-email').value = email; elements.get('account-email').dispatch('input');},
    changeSession(data) {channels.find(channel => channel.name === 'dlkt-info-account-session-v1').dispatch('message', {data});},
    async answer(index, value, status = 200, headers = {}) {
      assert.ok(requests[index], `Missing request ${index}`);
      if (value?.version === 'dlkt-info-identity-1') latestIdentity = value;
      requests[index].resolve(new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json', ...headers}}));
      await tick();
    },
    async reject(index) {requests[index].reject(new Error('network unavailable')); await tick();},
  };
}
async function accountReady(ui, state = STATE) {await ui.answer(0, signedIn()); await ui.answer(1, copy(state));}
async function requestChallenge(ui, email = 'reader@example.test') {
  ui.input(email); ui.get('account-login').dispatch('submit'); await tick();
  const index = ui.requests.length - 1; assert.equal(ui.requests[index].init.method, 'POST');
  await ui.answer(index, challenge(), 202);
}
function verify(ui, otp = '123456') {ui.get('account-otp').value = otp; ui.get('account-code').dispatch('submit');}
function privateCleared(ui) {
  assert.equal(ui.get('account-data').hidden, true); assert.equal(ui.get('account-signout').hidden, true);
  assert.equal(ui.get('account-summary').textContent, ''); assert.equal(ui.get('account-saved').textContent, '');
  assert.equal(ui.get('account-confirmation').hidden, true); assert.equal(ui.get('account-confirm-copy').textContent, '');
  assert.equal(ui.get('account-otp').value, '');
  assert.equal(ui.get('account-profile').hidden, true); assert.equal(ui.get('account-profile-form').hidden, true);
  assert.equal(ui.get('account-profile-summary').textContent, ''); assert.equal(ui.get('account-profile-message').textContent, '');
  for (const id of ['account-profile-name', 'account-profile-locale', 'account-profile-timezone']) assert.equal(ui.get(id).value, '');
  assert.equal(ui.interests().some(input => input.checked), false);
  assert.equal(ui.get('account-profile-city').checked, false);
  assert.equal(ui.get('account-profile-local-needs').children.some(label => label.children[0]?.checked), false);
}

test('Account exposes a fixed Wallet back link and retry control even when inactive', async () => {
  const ui = harness('?returnTo=wallet'); await ui.answer(0, OFF);
  assert.equal(ui.get('account-wallet-back').getAttribute('href'), '/wallet');
  assert.equal(ui.get('account-wallet-back').hidden, false);
  assert.equal(ui.get('account-check').disabled, false);
  assert.equal(ui.get('account-login').hidden, true); privateCleared(ui);
  assert.deepEqual(ui.redirects, []); assert.equal(ui.requests.length, 1);
  assert.equal(ui.memory.reads, 0); assert.equal(ui.memory.restores.length, 0);
  assert.match(read('public/wallet.html'), /id="wallet-signin"[^>]*href="\/account\?returnTo=wallet"/u);
  assert.doesNotMatch(read('src/account/browser.ts'), /localStorage|sessionStorage|document\.cookie|innerHTML|location\.(?:assign|href)\s*=/u);
});

test('Existing authenticated Wallet intent returns only after session readback without fetching reader data', async () => {
  const ui = harness('?returnTo=wallet');
  assert.deepEqual(ui.redirects, []); assert.equal(ui.requests[0].path, '/api/account-session');
  await ui.answer(0, signedIn()); assert.deepEqual(ui.redirects, ['/wallet']);
  assert.equal(ui.requests.length, 1); assert.equal(ui.memory.reads, 0); privateCleared(ui);
});

test('Only the exact single Wallet query is accepted; URL, duplicate and encoded destinations never redirect', async () => {
  for (const query of ['', '?returnTo=https://evil.example', '?returnTo=//evil.example', '?returnTo=/wallet', '?returnTo=wallet&returnTo=wallet', '?returnTo=wallet&next=/wallet', '?returnTo=%77allet', '?returnTo=Wallet', '?returnTo=wallet&', '?returnTo=wallet%00']) {
    const ui = harness(query); await accountReady(ui);
    assert.deepEqual(ui.redirects, [], query); assert.equal(ui.requests[1].path, '/api/account');
    assert.equal(ui.get('account-data').hidden, false);
  }
  const fragment = harness('?returnTo=wallet', {hash: '#return'}); await accountReady(fragment); assert.deepEqual(fragment.redirects, []);
});

test('Disabled, signed-out, inconsistent and malformed sessions never redirect or fetch a private copy', async () => {
  for (const payload of [OFF, OUT, {...signedIn(), enabled: false}, {...signedIn(), configured: false}, {...signedIn(), user: null}, {...signedIn(), user: {id: USER, email: 'reader\u0000@example.test'}}, {...signedIn(), version: 'other'}, {enabled: true, authenticated: true}, {...signedIn(), extra: '/wallet'}]) {
    const ui = harness('?returnTo=wallet'); await ui.answer(0, payload);
    assert.deepEqual(ui.redirects, []); assert.equal(ui.requests.length, 1); privateCleared(ui);
  }
  const ui = harness('?returnTo=wallet'); await ui.reject(0);
  assert.deepEqual(ui.redirects, []); privateCleared(ui); assert.equal(ui.get('account-check').disabled, false);
});

test('OTP Wallet return requires both a verified challenge response and an authenticated same-user session readback', async () => {
  const ui = harness('?returnTo=wallet'); await ui.answer(0, OUT); await requestChallenge(ui);
  assert.equal(ui.document.activeElement, ui.get('account-otp'));
  verify(ui); assert.equal(ui.get('account-otp').value, '');
  assert.deepEqual(JSON.parse(ui.requests[2].init.body), {action: 'verify-code', email: 'reader@example.test', code: '123456'});
  await ui.answer(2, signedIn()); assert.deepEqual(ui.redirects, []);
  assert.equal(ui.requests[3].path, '/api/account-session'); assert.equal(ui.requests[3].init.method, 'GET');
  await ui.answer(3, signedIn()); assert.deepEqual(ui.redirects, ['/wallet']);
  assert.equal(ui.requests.some(request => request.path === '/api/account'), false);
  assert.deepEqual(ui.broadcasts, [{name: 'dlkt-info-account-session-v1', data: 'signed-in'}]);
});

test('OTP acknowledgments cannot redirect when subsequent session readback is absent, disabled, malformed or another user', async () => {
  for (const payload of [OUT, OFF, signedIn(OTHER), {authenticated: true}]) {
    const ui = harness('?returnTo=wallet'); await ui.answer(0, OUT); await requestChallenge(ui); verify(ui);
    await ui.answer(2, signedIn()); await ui.answer(3, payload);
    assert.deepEqual(ui.redirects, []); privateCleared(ui); assert.equal(ui.broadcasts.length, 0);
  }
});

test('Leaving cancels a pending session result and cannot navigate on its late acknowledgment', async () => {
  const ui = harness('?returnTo=wallet'); ui.window.dispatch('blur');
  assert.equal(ui.requests[0].init.signal.aborted, true);
  await ui.answer(0, signedIn()); assert.deepEqual(ui.redirects, []); privateCleared(ui);
  ui.window.dispatch('focus'); await ui.answer(1, signedIn()); assert.deepEqual(ui.redirects, ['/wallet']);
});

test('Late OTP success after blur cannot issue a follow-up request or navigate', async () => {
  const ui = harness('?returnTo=wallet'); await ui.answer(0, OUT); await requestChallenge(ui); verify(ui);
  ui.window.dispatch('blur'); await ui.answer(2, signedIn());
  assert.equal(ui.requests.length, 3); assert.deepEqual(ui.redirects, []); privateCleared(ui);
  ui.window.dispatch('focus'); await ui.answer(3, OUT);
  assert.equal(ui.get('account-code').hidden, false); assert.equal(ui.get('account-otp').value, '');
});

test('Account private copy and pending restore disappear before rechecking and remain cleared after 401 or 503', async () => {
  for (const status of [401, 503]) {
    const ui = harness(); await accountReady(ui);
    assert.match(ui.get('account-saved').textContent, /Private saved fixture/u);
    ui.get('account-restore').dispatch('click'); assert.equal(ui.get('account-confirmation').hidden, false);
    ui.get('account-reload').dispatch('click'); privateCleared(ui);
    await ui.answer(2, signedIn()); await ui.answer(3, {error: 'unavailable'}, status); privateCleared(ui);
    ui.get('account-restore').dispatch('click'); ui.get('account-confirm').dispatch('click');
    assert.equal(ui.memory.restores.length, 0); assert.equal(ui.requests.length, 4);
  }
});

test('Pagehide, hidden document and unfocused window clear all private copy and cannot restore it from a late response', async () => {
  for (const departure of ['pagehide', 'visibilitychange', 'blur']) {
    const ui = harness(); await ui.answer(0, signedIn());
    if (departure === 'visibilitychange') {ui.document.hidden = true; ui.document.dispatch(departure);}
    else ui.window.dispatch(departure);
    await ui.answer(1, copy()); privateCleared(ui);
    assert.equal(ui.requests[1].init.signal.aborted, true);
  }
  const ui = harness(); await accountReady(ui); ui.get('account-delete').dispatch('click');
  ui.window.dispatch('pagehide'); privateCleared(ui); ui.window.dispatch('pageshow', {persisted: true});
  assert.equal(ui.requests[2].path, '/api/account-session'); await ui.answer(2, OUT);
  ui.get('account-confirm').dispatch('click'); assert.equal(ui.requests.length, 3);
});

test('Foreground return rechecks a session without restoring stale actions or making requests from an unfocused window', async () => {
  const ui = harness(); await accountReady(ui); ui.document.focused = false; ui.window.dispatch('blur');
  ui.document.dispatch('visibilitychange'); ui.window.dispatch('pageshow', {persisted: true});
  assert.equal(ui.requests.length, 2); privateCleared(ui);
  ui.document.focused = true; ui.window.dispatch('focus'); await ui.answer(2, OUT);
  assert.equal(ui.get('account-login').hidden, false); privateCleared(ui);
});

test('Session broadcasts invalidate reader data and pending confirmation before fresh authentication', async () => {
  for (const signal of ['signed-out', 'signed-in']) {
    const ui = harness(); await accountReady(ui); ui.get('account-delete').dispatch('click');
    ui.changeSession(signal); privateCleared(ui); assert.equal(ui.requests[2].path, '/api/account-session');
    await ui.answer(2, OUT); ui.get('account-confirm').dispatch('click');
    assert.equal(ui.requests.length, 3); assert.equal(ui.memory.restores.length, 0);
  }
});

test('Sign-out clears private copy immediately and reports success only after signed-out session readback', async () => {
  const ui = harness(); await accountReady(ui); ui.get('account-restore').dispatch('click'); ui.get('account-signout').dispatch('click');
  privateCleared(ui); assert.equal(ui.requests[2].init.method, 'DELETE');
  await ui.answer(2, OUT); assert.equal(ui.requests[3].init.method, 'GET');
  assert.doesNotMatch(ui.get('account-message').textContent, /You are signed out/u); assert.equal(ui.broadcasts.length, 0);
  await ui.answer(3, OUT); assert.match(ui.get('account-message').textContent, /You are signed out/u);
  assert.deepEqual(ui.broadcasts, [{name: 'dlkt-info-account-session-v1', data: 'signed-out'}]); privateCleared(ui);
});

test('Malformed sign-out response and signed-in/unavailable readback cannot become successful logout', async () => {
  for (const payload of [{authenticated: false}, OFF, signedIn()]) {
    const ui = harness(); await accountReady(ui); ui.get('account-signout').dispatch('click'); await ui.answer(2, payload);
    assert.doesNotMatch(ui.get('account-message').textContent, /You are signed out/u); privateCleared(ui);
  }
  for (const payload of [signedIn(), OFF]) {
    const ui = harness(); await accountReady(ui); ui.get('account-signout').dispatch('click'); await ui.answer(2, OUT); await ui.answer(3, payload);
    assert.match(ui.get('account-message').textContent, /could not be confirmed/u); assert.equal(ui.broadcasts.length, 0); privateCleared(ui);
  }
});

test('Acknowledged OTP challenge survives email-app blur while private copy, visible email and old OTP clear', async () => {
  const ui = harness('?returnTo=wallet'); await ui.answer(0, OUT); await requestChallenge(ui, 'original@example.test');
  ui.get('account-otp').value = '123456'; ui.window.dispatch('blur'); privateCleared(ui);
  assert.equal(ui.get('account-email').value, '');
  ui.window.dispatch('focus'); await ui.answer(2, OUT);
  assert.equal(ui.get('account-email').value, 'original@example.test'); assert.equal(ui.get('account-code').hidden, false);
  assert.equal(ui.get('account-otp').value, ''); assert.equal(ui.requests.filter(request => request.init.method === 'POST').length, 1);
  verify(ui); assert.equal(JSON.parse(ui.requests[3].init.body).email, 'original@example.test');
});

test('Actual email edits invalidate the acknowledged challenge; verification never follows a mutable email field', async () => {
  const ui = harness(); await ui.answer(0, OUT); await requestChallenge(ui);
  ui.input('other@example.test'); assert.equal(ui.get('account-code').hidden, true); assert.equal(ui.get('account-otp').value, '');
  verify(ui); assert.equal(ui.requests.length, 2);
  await requestChallenge(ui, 'other@example.test'); verify(ui);
  assert.equal(JSON.parse(ui.requests[3].init.body).email, 'other@example.test');
  const silent = harness(); await silent.answer(0, OUT); await requestChallenge(silent);
  silent.get('account-email').value = 'changed-without-input@example.test'; verify(silent);
  assert.equal(silent.requests.length, 2); assert.equal(silent.get('account-code').hidden, true);
});

test('Email editing while code request is pending cancels it and ignores its late acknowledgment', async () => {
  const ui = harness(); await ui.answer(0, OUT); ui.input('first@example.test'); ui.get('account-login').dispatch('submit'); await tick();
  ui.input('second@example.test'); assert.equal(ui.requests[1].init.signal.aborted, true);
  await ui.answer(1, challenge(), 202); assert.equal(ui.get('account-code').hidden, true);
  assert.equal(ui.get('account-email').value, 'second@example.test');
  await requestChallenge(ui, 'second@example.test'); assert.equal(ui.get('account-code').hidden, false);
});

test('Wrong OTP and rate limits retain the acknowledged challenge for retry while clearing entered code', async () => {
  const ui = harness(); await ui.answer(0, OUT); await requestChallenge(ui); verify(ui);
  await ui.answer(2, {error: 'IDENTITY_VERIFICATION_FAILED'}, 400);
  assert.equal(ui.get('account-code').hidden, false); assert.equal(ui.get('account-otp').value, '');
  verify(ui, '654321'); assert.equal(JSON.parse(ui.requests[3].init.body).email, 'reader@example.test');
  await ui.answer(3, {error: 'IDENTITY_RATE_LIMITED'}, 429);
  assert.equal(ui.get('account-code').hidden, false); assert.equal(ui.get('account-otp').value, '');
  assert.match(ui.get('account-message').textContent, /Too many sign-in attempts/u);
});

test('Unacknowledged code and observed session changes cannot reuse an OTP challenge', async () => {
  const ui = harness(); await ui.answer(0, OUT); verify(ui); assert.equal(ui.requests.length, 1);
  await requestChallenge(ui); ui.changeSession('signed-out'); await ui.answer(2, OUT);
  assert.equal(ui.get('account-code').hidden, true); assert.equal(ui.get('account-email').value, '');
  verify(ui); assert.equal(ui.requests.length, 3);
});

test('Import reads browser memory only after explicit action and retains a separate replacement confirmation', async () => {
  const ui = harness(); await accountReady(ui); assert.equal(ui.memory.reads, 0);
  ui.get('account-upload').dispatch('click'); assert.equal(ui.memory.reads, 0); await ui.answer(2, signedIn());
  assert.equal(ui.memory.reads, 1); assert.equal(ui.memory.checkpoints, 1);
  assert.equal(ui.get('account-confirmation').hidden, false); assert.equal(ui.requests.length, 3);
  ui.get('account-cancel').dispatch('click'); ui.get('account-confirm').dispatch('click'); assert.equal(ui.requests.length, 3);
});

test('Confirmed import rechecks the owner, sends exact revision and confirms the acknowledged canonical value', async () => {
  const ui = harness(); await accountReady(ui); ui.get('account-upload').dispatch('click'); await ui.answer(2, signedIn());
  ui.get('account-confirm').dispatch('click'); privateCleared(ui); await ui.answer(3, signedIn());
  assert.equal(ui.requests[4].init.method, 'PUT'); assert.deepEqual(JSON.parse(ui.requests[4].init.body), {expectedRevision: REV, value: LOCAL});
  await ui.answer(4, copy({...STATE, revision: NEXT, value: LOCAL}));
  assert.match(ui.get('account-message').textContent, /Reader copy saved/u); assert.equal(ui.memory.restores.length, 0);
});

test('Conflicting import or changed acknowledgment cannot report saved or leave a pending restore', async () => {
  for (const [payload, status] of [[{error: 'ACCOUNT_CONFLICT'}, 409], [copy({...STATE, revision: NEXT}), 200]]) {
    const ui = harness(); await accountReady(ui); ui.get('account-upload').dispatch('click'); await ui.answer(2, signedIn());
    ui.get('account-confirm').dispatch('click'); await ui.answer(3, signedIn()); await ui.answer(4, payload, status);
    privateCleared(ui); assert.doesNotMatch(ui.get('account-message').textContent, /Reader copy saved/u);
    ui.get('account-restore').dispatch('click'); ui.get('account-confirm').dispatch('click'); assert.equal(ui.memory.restores.length, 0);
  }
});

test('Deletion is explicit, owner-rechecked and revision-bound; retained state is not reported deleted', async () => {
  for (const retained of [false, true]) {
    const ui = harness(); await accountReady(ui); ui.get('account-delete').dispatch('click'); assert.equal(ui.requests.length, 2);
    ui.get('account-confirm').dispatch('click'); await ui.answer(2, signedIn());
    assert.equal(ui.requests[3].init.method, 'DELETE'); assert.deepEqual(JSON.parse(ui.requests[3].init.body), {expectedRevision: REV});
    await ui.answer(3, copy(retained ? STATE : null));
    if (retained) {privateCleared(ui); assert.doesNotMatch(ui.get('account-message').textContent, /reader copy deleted/u);}
    else assert.match(ui.get('account-message').textContent, /reader copy deleted/u);
  }
});

test('Restore requires current same-user authentication and forwards cancellation to browser storage', async () => {
  const ui = harness(); await accountReady(ui); ui.get('account-restore').dispatch('click'); ui.get('account-confirm').dispatch('click');
  assert.equal(ui.memory.restores.length, 0); await ui.answer(2, signedIn());
  assert.equal(ui.memory.restores.length, 1); assert.deepEqual(ui.memory.restores[0].value, VALUE);
  assert.equal(ui.memory.restores[0].signal.aborted, false); assert.match(ui.get('account-message').textContent, /restored in this browser/u);
  for (const response of [OUT, signedIn(OTHER)]) {
    const changed = harness(); await accountReady(changed); changed.get('account-restore').dispatch('click'); changed.get('account-confirm').dispatch('click');
    await changed.answer(2, response); assert.equal(changed.memory.restores.length, 0); privateCleared(changed);
  }
});

test('Invalidation cancels an in-flight local restore and suppresses its late completion', async () => {
  let resolveRestore;
  const ui = harness('', {restoreMemory: () => new Promise(resolve => {resolveRestore = resolve;})});
  await accountReady(ui); ui.get('account-restore').dispatch('click'); ui.get('account-confirm').dispatch('click'); await ui.answer(2, signedIn());
  ui.window.dispatch('blur'); assert.equal(ui.memory.restores[0].signal.aborted, true); privateCleared(ui);
  resolveRestore(); await tick(); privateCleared(ui); assert.doesNotMatch(ui.get('account-message').textContent, /restored in this browser/u);
});

test('Late local import reads cannot reopen confirmation or advance storage reads after page departure', async () => {
  let resolveMemory;
  const ui = harness('', {readMemory: () => new Promise(resolve => {resolveMemory = resolve;})});
  await accountReady(ui); ui.get('account-upload').dispatch('click'); await ui.answer(2, signedIn());
  ui.window.dispatch('blur'); resolveMemory({...LOCAL, rejected: 0}); await tick();
  privateCleared(ui); assert.equal(ui.memory.checkpoints, 0); assert.equal(ui.requests.length, 3);
});

test('Authentication requests have an enforced timeout, JSON type and streamed size limit', async () => {
  const timeout = harness('?returnTo=wallet'); assert.equal([...timeout.timers.values()][0].milliseconds, 25_000);
  [...timeout.timers.values()][0].callback(); await tick();
  assert.equal(timeout.requests[0].init.signal.aborted, true); assert.equal(timeout.get('account-check').disabled, false);
  privateCleared(timeout); assert.deepEqual(timeout.redirects, []);
  for (const headers of [{'content-length': '100000'}, {'content-type': 'text/html'}]) {
    const ui = harness('?returnTo=wallet'); await ui.answer(0, signedIn(), 200, headers);
    assert.deepEqual(ui.redirects, []); privateCleared(ui);
  }
  const large = harness('?returnTo=wallet'); await large.answer(0, {...signedIn(), padding: 'x'.repeat(16_384)});
  assert.deepEqual(large.redirects, []); privateCleared(large);
});

test('Missing broadcast support cannot turn a confirmed session readback into a failed Wallet return', async () => {
  const ui = harness('?returnTo=wallet', {broadcastFailure: true}); await ui.answer(0, OUT); await requestChallenge(ui); verify(ui);
  await ui.answer(2, signedIn()); await ui.answer(3, signedIn()); assert.deepEqual(ui.redirects, ['/wallet']);
});


async function profileReady(ui, profile = PROFILE_STATE) {
  await ui.answer(0, signedIn()); await ui.answer(1, copy());
  assert.equal(ui.requests[2].path, '/api/wallet');
  await ui.answer(2, walletSnapshot('signed-in', profile));
    assert.equal(ui.requests[3].path, '/api/account-session');
    assert.equal(ui.get('account-data').hidden, true);
  await ui.answer(3, signedIn());
}
function editProfile(ui) {
  ui.get('account-profile-name').value = 'Updated reader';
  ui.get('account-profile-locale').value = 'en-GB';
  ui.get('account-profile-timezone').value = 'Europe/London';
  for (const input of ui.interests()) input.checked = input.value === DAILY_TOPICS.at(-1);
}
function savedProfile(value, revision = NEXT) {
  return {version: WALLET_PROFILE_VERSION, revision, updatedAt: STAMP, value: parseWalletProfile(value)};
}

test('Account renders the real Wallet profile only after same-owner readback, alongside the saved reader copy', async () => {
  const ui = harness('', {manualProfile: true}); await profileReady(ui);
  assert.equal(ui.get('account-profile-name').value, PROFILE.displayName);
  assert.equal(ui.get('account-profile-locale').value, PROFILE.locale);
  assert.equal(ui.get('account-profile-timezone').value, PROFILE.timezone);
  assert.deepEqual(ui.interests().filter(input => input.checked).map(input => input.value), [...PROFILE.interests]);
  assert.match(ui.get('account-profile-summary').textContent, new RegExp(STAMP, 'u'));
  assert.match(ui.get('account-saved').textContent, /Private saved fixture/u);
  assert.equal(ui.requests[2].init.headers['X-DLKT-Info-Request'], 'wallet-v1');
  assert.equal(ui.requests[2].init.headers['X-DLKT-Info-Owner'], USER);
  assert.equal(ui.get('account-profile-city').value, '683506');
  assert.equal(ui.get('account-profile-city').checked, true);
  assert.equal(ui.get('account-profile-local-needs').children.find(label => label.children[0]?.value === 'utilities').children[0].checked, true);
  assert.equal(ui.requests[2].init.credentials, 'same-origin');
  assert.equal(ui.requests[2].init.cache, 'no-store'); assert.equal(ui.requests[2].init.redirect, 'error');
  assert.equal(ui.memory.reads, 0); assert.equal(ui.memory.restores.length, 0);
  assert.equal(ui.requests.some(request => request.init.method !== 'GET'), false);
});

test('Signed-out and unprovisioned accounts never request or expose a profile', async () => {
  for (const payload of [OUT, OFF]) {
    const ui = harness('', {manualProfile: true}); await ui.answer(0, payload);
    assert.equal(ui.requests.length, 1); privateCleared(ui);
    ui.get('account-profile-form').dispatch('submit'); assert.equal(ui.requests.length, 1);
  }
});

test('A missing profile is an unsaved draft; an explicit save creates it with null CAS and verified owner', async () => {
  const ui = harness('', {manualProfile: true}); await profileReady(ui, null);
  assert.match(ui.get('account-profile-summary').textContent, /No profile has been saved/u);
  editProfile(ui); ui.get('account-profile-form').dispatch('submit'); privateCleared(ui);
  assert.equal(ui.requests[4].path, '/api/account-session'); await ui.answer(4, signedIn());
  assert.equal(ui.requests[5].path, '/api/wallet'); assert.equal(ui.requests[5].init.method, 'PUT');
  const body = JSON.parse(ui.requests[5].init.body);
  assert.equal(body.expectedRevision, null); assert.equal(body.value.displayName, 'Updated reader');
  assert.equal(ui.requests[5].init.headers['X-DLKT-Info-Owner'], USER);
  assert.equal(body.value.cityId, null); assert.deepEqual(body.value.localNeeds, []);
  assert.equal(body.value.locale, 'en-GB'); assert.equal(body.value.timezone, 'Europe/London');
  assert.equal(body.value.briefingTime, '08:00'); assert.equal(body.value.personalPriority, 'balanced');
  assert.deepEqual(body.value.interests, [DAILY_TOPICS.at(-1)]);
  await ui.answer(5, walletSnapshot('signed-in', savedProfile(body.value))); privateCleared(ui);
  await ui.answer(6, signedIn());
  assert.equal(ui.get('account-profile-name').value, 'Updated reader');
  assert.match(ui.get('account-message').textContent, /Profile saved/u);
  assert.equal(ui.requests.filter(request => request.init.method === 'PUT').length, 1);
  assert.equal(ui.memory.restores.length, 0);
});

test('Updating a profile preserves existing briefing preferences and uses its exact revision; conflicts clear private data', async () => {
  const ui = harness('', {manualProfile: true}); await profileReady(ui);
  editProfile(ui); ui.get('account-profile-form').dispatch('submit'); await ui.answer(4, signedIn());
  const body = JSON.parse(ui.requests[5].init.body);
  assert.equal(body.expectedRevision, REV); assert.equal(body.value.briefingTime, PROFILE.briefingTime);
  assert.equal(body.value.personalPriority, PROFILE.personalPriority);
  assert.equal(ui.requests[5].init.headers['X-DLKT-Info-Owner'], USER);
  assert.equal(body.value.cityId, PROFILE.cityId); assert.deepEqual(body.value.localNeeds, [...PROFILE.localNeeds]);
  await ui.answer(5, {error: 'WALLET_CONFLICT'}, 409); privateCleared(ui);
  assert.match(ui.get('account-message').textContent, /This profile changed on another device/u);
  assert.equal(ui.requests.length, 6);
  ui.get('account-profile-form').dispatch('submit'); assert.equal(ui.requests.length, 6);
});

test('Profile save requires an exact returned value and another same-owner session before showing success', async () => {
  for (const failure of ['different-value', 'different-owner']) {
    const ui = harness('', {manualProfile: true}); await profileReady(ui);
    editProfile(ui); ui.get('account-profile-form').dispatch('submit'); await ui.answer(4, signedIn());
    const body = JSON.parse(ui.requests[5].init.body);
    const returned = failure === 'different-value' ? {...body.value, displayName: 'Unexpected writer'} : body.value;
    await ui.answer(5, walletSnapshot('signed-in', savedProfile(returned)));
    if (failure === 'different-owner') await ui.answer(6, signedIn(OTHER));
    privateCleared(ui); assert.doesNotMatch(ui.get('account-message').textContent, /Profile saved/u);
    assert.equal(ui.requests.filter(request => request.init.method === 'PUT').length, 1);
  }
});

test('Owner changes during profile load or before saving never expose another profile or write through the old session', async () => {
  const loading = harness('', {manualProfile: true});
  await loading.answer(0, signedIn()); await loading.answer(1, copy());
  await loading.answer(2, walletSnapshot('signed-in', PROFILE_STATE));
  await loading.answer(3, signedIn(OTHER)); privateCleared(loading);
  const saving = harness('', {manualProfile: true}); await profileReady(saving);
  editProfile(saving); saving.get('account-profile-form').dispatch('submit');
  await saving.answer(4, signedIn(OTHER)); privateCleared(saving);
  assert.equal(saving.requests.some(request => request.init.method === 'PUT'), false);
});

test('Blur, pagehide, hidden page, sign-out and session broadcast clear profile fields and checked interests', async () => {
  for (const departure of ['blur', 'pagehide', 'visibilitychange', 'signed-out', 'sign-out']) {
    const ui = harness('', {manualProfile: true}); await profileReady(ui);
    if (departure === 'visibilitychange') {ui.document.hidden = true; ui.document.dispatch(departure);}
    else if (departure === 'signed-out') ui.changeSession('signed-out');
    else if (departure === 'sign-out') ui.get('account-signout').dispatch('click');
    else ui.window.dispatch(departure);
    privateCleared(ui);
    if (departure === 'sign-out') {
      assert.equal(ui.requests[4].init.method, 'DELETE'); await ui.answer(4, OUT); await ui.answer(5, OUT); privateCleared(ui);
    }
  }
  const late = harness('', {manualProfile: true});
  await late.answer(0, signedIn()); await late.answer(1, copy()); late.window.dispatch('blur');
  assert.equal(late.requests[2].init.signal.aborted, true);
  await late.answer(2, walletSnapshot('signed-in', PROFILE_STATE)); privateCleared(late);
  assert.equal(late.requests.length, 3);
});

test('Unavailable, malformed and oversized profile responses preserve the valid reader copy and disable profile edits', async () => {
  for (const payload of [walletSnapshot('unavailable'), {...walletSnapshot('signed-in'), extra: true}, {padding: 'x'.repeat(WALLET_PROFILE_MAX_BYTES + 16_384)}]) {
    const ui = harness('', {manualProfile: true});
    await ui.answer(0, signedIn()); await ui.answer(1, copy()); await ui.answer(2, payload); privateCleared(ui);
    await ui.answer(3, signedIn());
    assert.equal(ui.get('account-data').hidden, false);
    assert.match(ui.get('account-saved').textContent, /Private saved fixture/u);
    assert.equal(ui.get('account-profile-form').hidden, true); assert.equal(ui.get('account-profile-name').value, '');
    assert.match(ui.get('account-profile-message').textContent, /could not be loaded/u);
    ui.get('account-profile-form').dispatch('submit'); assert.equal(ui.requests.length, 4);
  }
});

test('Profile validation rejects invalid locale/timezone and never starts a write or changes the reader copy', async () => {
  for (const [field, value] of [['account-profile-locale', 'not_a_locale'], ['account-profile-timezone', 'Not/AZone'], ['account-profile-name', 'x'.repeat(81)]]) {
    const ui = harness('', {manualProfile: true}); await profileReady(ui);
    ui.get(field).value = value; ui.get('account-profile-form').dispatch('submit');
    assert.equal(ui.requests.length, 4); assert.match(ui.get('account-profile-message').textContent, /Check the name/u);
    assert.match(ui.get('account-saved').textContent, /Private saved fixture/u);
  }
});

test('An explicit reader restore keeps the separately loaded Wallet profile and does not write to it', async () => {
  const ui = harness('', {manualProfile: true}); await profileReady(ui);
  ui.get('account-restore').dispatch('click'); ui.get('account-confirm').dispatch('click'); privateCleared(ui);
  await ui.answer(4, signedIn());
  assert.equal(ui.memory.restores.length, 1);
  assert.equal(ui.get('account-profile-name').value, PROFILE.displayName);
  assert.equal(ui.requests.filter(request => request.path === '/api/wallet').length, 1);
  assert.equal(ui.requests.some(request => request.path === '/api/wallet' && request.init.method !== 'GET'), false);
});


test('Owner mismatch during profile read cannot repaint the previously loaded private reader copy', async () => {
  const ui = harness('', {manualProfile: true});
  await ui.answer(0, signedIn()); await ui.answer(1, copy());
  await ui.answer(2, {error: 'WALLET_OWNER_CHANGED'}, 409);
  privateCleared(ui);
  assert.match(ui.get('account-message').textContent, /session changed/u);
  assert.equal(ui.requests.length, 3);
});

test('Null and unavailable profiles still require same-owner readback before any private reader copy appears', async () => {
  for (const payload of [walletSnapshot('signed-in'), walletSnapshot('unavailable'), {malformed: true}]) {
    const ui = harness('', {manualProfile: true});
    await ui.answer(0, signedIn()); await ui.answer(1, copy()); await ui.answer(2, payload);
    privateCleared(ui); assert.equal(ui.requests[3].path, '/api/account-session');
    await ui.answer(3, signedIn(OTHER));
    privateCleared(ui); assert.match(ui.get('account-message').textContent, /session changed/u);
  }
});

test('The profile language selector retains a saved locale variant and removes it when private state is cleared',async()=>{
  for(const locale of ['ro-RO','en-GB','sr-Latn-RS']){
    const ui=harness('',{manualProfile:true});
    await profileReady(ui,{...PROFILE_STATE,value:parseWalletProfile({...PROFILE,locale})});
    assert.equal(ui.get('account-profile-locale').tagName,'SELECT');
    assert.equal(ui.get('account-profile-locale').value,locale);
    assert.equal(ui.get('account-profile-locale').children.filter(option=>option.value===locale).length,1);
    assert.deepEqual(ui.interests().map(input=>input.value),[...DAILY_TOPICS]);
    ui.window.dispatch('blur');privateCleared(ui);
    assert.equal(ui.get('account-profile-locale').children.some(option=>option.value===locale),false);
  }
});
test('All language controls are disabled during a private save and restored after its acknowledgment',async()=>{
  const ui=harness('',{manualProfile:true});await profileReady(ui);
  ui.get('account-profile-form').dispatch('submit');
  assert.equal(ui.get('account-profile-locale').disabled,true);
  assert.equal(ui.get('reader-language').disabled,true);
  await ui.answer(4,signedIn());
  const sent=JSON.parse(ui.requests[5].init.body);
  await ui.answer(5,walletSnapshot('signed-in',savedProfile(sent.value)));
  await ui.answer(6,signedIn());
  assert.equal(ui.get('account-profile-locale').disabled,false);
  assert.equal(ui.get('reader-language').disabled,false);
});
test('OTP snapshots the resolved current language after country initialization, without private profile reads',async()=>{
  let ready;const countryReady=new Promise(resolve=>{ready=resolve;});
  const options={locale:'en',countryReady};const ui=harness('?returnTo=wallet',options);
  await ui.answer(0,OUT);ui.input('reader@example.test');ui.get('account-login').dispatch('submit');
  await tick();assert.equal(ui.requests.length,1,'no early English email request');
  options.locale='ro';ready();await tick();
  assert.equal(JSON.parse(ui.requests[1].init.body).locale,'ro');
  assert.equal(ui.requests[1].path,'/api/account-session');
  assert.equal(ui.requests.some(request=>request.path==='/api/wallet'),false);
  await ui.answer(1,challenge(),202);verify(ui);await ui.answer(2,signedIn());await ui.answer(3,signedIn());
  assert.deepEqual(ui.redirects,['/wallet']);
});
test('Losing focus while country initialization is pending never sends a delayed sign-in request',async()=>{
  let ready;const ui=harness('',{countryReady:new Promise(resolve=>{ready=resolve;})});
  await ui.answer(0,OUT);ui.input('reader@example.test');ui.get('account-login').dispatch('submit');
  ui.window.dispatch('blur');ready();await tick();privateCleared(ui);assert.equal(ui.requests.length,1);
});
