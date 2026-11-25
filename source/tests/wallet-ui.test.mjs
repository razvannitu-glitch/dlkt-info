import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {parseWalletProfile, parseWalletSnapshot, walletSnapshot, WALLET_PROFILE_VERSION} from '../.build/src/wallet/contracts.js';
import {loadPersonalInbox, personalInboxProviderName, personalInboxStatus, PersonalInboxError} from '../.build/src/wallet/personal-inbox.js';
import {CONNECTIONS_VERSION} from '../.build/src/connections/types.js';
import {WALLET_PROVIDER_IDS} from '../.build/src/wallet/providers.js';
import {DAILY_TOPICS} from '../.build/src/daily/contracts.js';
import {LOCAL_NEEDS} from '../.build/src/personal/contracts.js';
import {parsePersonalSession} from '../.build/src/personal/session.js';
import {TOPIC_LABELS, TOPIC_DESCRIPTIONS} from '../.build/src/iceo/topics.js';

const read = file => readFileSync(file, 'utf8');
const revision = '11111111-1111-4111-8111-111111111111';
const nextRevision = '22222222-2222-4222-8222-222222222222';
const signedOutSession = {version: 'dlkt-info-identity-1', configured: true, enabled: true, authenticated: false, blocker: null, user: null};
const profile = parseWalletProfile({displayName: 'Private test name', locale: 'en', timezone: 'UTC',
  briefingTime: '08:30', interests: ['world', 'science'], personalPriority: 'balanced', cityId: null, localNeeds: []});
const state = (value = profile, rev = revision) => ({version: WALLET_PROFILE_VERSION,
  revision: rev, updatedAt: '2026-11-18T10:00:00.000Z', value});
const tick = () => new Promise(resolve => setImmediate(resolve));

class Target {
  listeners = new Map();
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }
  dispatch(type, details = {}) {
    for (const callback of this.listeners.get(type) ?? []) callback({preventDefault() {}, ...details});
  }
}

class Element extends Target {
  children = [];
  attributes = new Map();
  dataset = {};
  hidden = false;
  disabled = false;
  checked = false;
  value = '';
  className = '';
  content = '';
  constructor(tag, document) { super(); this.tagName = tag.toUpperCase(); this.document = document; }
  set textContent(value) { this.content = value; this.children = []; }
  get textContent() { return this.content + this.children.map(child => child.textContent).join(''); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.content = ''; this.children = nodes; }
  querySelectorAll(selector) {
    const tags = selector.split(',').map(tag => tag.trim().toUpperCase());
    return this.children.flatMap(child => [...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  reset() { for (const input of this.querySelectorAll('input')) { if (!['checkbox', 'radio'].includes(input.type)) input.value = ''; input.checked = false; } }
  reportValidity() { return true; }
  focus() { this.document.activeElement = this; }
}

function harness(home = false) {
  const document = new Target();
  document.hidden = false;
  document.focused = true;
  document.hasFocus = () => document.focused;
  const elements = new Map();
  const html = read(home ? 'public/iceo.html' : 'public/wallet.html');
  document.getElementById = id => elements.get(id) ?? null;
  document.createElement = tag => new Element(tag, document);
  document.createTextNode = value => { const node = new Element('#text', document); node.content = value; return node; };
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gu)) {
    const element = new Element(match[1], document);
    element.id = match[3];
    element.type = /\btype="([^"]*)"/u.exec(match[2])?.[1] ?? '';
    element.hidden = /\bhidden(?:\s|$)/u.test(match[2]);
    element.value = /\bvalue="([^"]*)"/u.exec(match[2])?.[1] ?? '';
    elements.set(element.id, element);
  }
  if (!home) {
    const form = elements.get('wallet-profile-form');
    for (const id of ['wallet-display-name', 'wallet-locale', 'wallet-timezone', 'wallet-briefing-time',
      'wallet-priority-balanced', 'wallet-priority-personal', 'wallet-interests', 'wallet-city', 'wallet-local-needs', 'wallet-save', 'wallet-delete']) {
      form.append(elements.get(id));
    }
  }
  const window = new Target();
  let timer = 0;
  window.setTimeout = () => ++timer;
  window.clearTimeout = () => {};
  const channels = [], broadcasts = [];
  class Channel extends Target {
    constructor(name) {super(); this.name = name; channels.push(this);}
    postMessage(data) {broadcasts.push({name: this.name, data});}
  }
  const connections = {states: [], clears: 0, clear() {this.clears += 1;}, setAccount(state) {this.states.push(state);}};
  const requests = [], identityRequests = [];
  let identityOwner = revision;
  const readers = {clears: 0, loads: [], clear() {this.clears++;}, async load(value, ownerId) {this.loads.push({value, ownerId});}};
  const fetch = (path, init) => {
    if (!home && path === '/api/account-session' && init.method === 'GET') {
      identityRequests.push({path, init, ownerId: identityOwner});
      const value = identityOwner === null ? signedOutSession : {...signedOutSession, authenticated: true,
        user: {id: identityOwner, email: 'reader@example.test'}};
      return Promise.resolve({ok: true, status: 200, json: async () => value});
    }
    return new Promise((resolve, reject) => requests.push({path, init, resolve, reject}));
  };
  const fieldsSource = home ? '' : read('.build/src/personal/profile-fields.js').replace(/^import [^\n]+\n/gmu, '').replace(/^export /gmu, '');
  const source = fieldsSource + '\n' + read(home ? '.build/src/wallet/home-browser.js' : '.build/src/wallet/browser.js')
    .replace(/^import [^\n]+\n/gmu, '');
  runInNewContext(source, {document, window, navigator: {language: 'en'}, BroadcastChannel: Channel,
    fetch, AbortController, parseWalletProfile, parseWalletSnapshot, walletSnapshot, parsePersonalSession, LOCAL_NEEDS, DAILY_TOPICS, TOPIC_LABELS, TOPIC_DESCRIPTIONS,
    createPersonalReader: () => readers,
    loadPersonalInbox, personalInboxProviderName, personalInboxStatus, PersonalInboxError,
    createConnectionsWallet: onExpired => {connections.onExpired = onExpired; return connections;}, Intl, Date, JSON, Error}, {filename: home ? 'wallet-home-browser.js' : 'wallet-browser.js'});
  return {
    document, window, requests, broadcasts, connections, readers, identityRequests, setOwner: value => { identityOwner = value; }, get: id => elements.get(id),
    sessionChanged(data) {channels.filter(channel => channel.name === 'dlkt-info-account-session-v1').forEach(channel => channel.dispatch('message', {data}));},
    async answer(index, value, status = 200) {
      await tick();
      const request = requests[index];
      assert.ok(request, `Expected request ${index}`);
      request.resolve({ok: status >= 200 && status < 300, status, json: async () => value});
      await tick();
    },
  };
}

test('Wallet surface keeps the canonical branding and CSS, and starts with no active private form', () => {
  const html = read('public/wallet.html');
  assert.match(html, /<title>DLKT Info Wallet<\/title>/u);
  assert.equal((html.match(/<footer class="site-footer">/gu) ?? []).length, 1);
  assert.match(html, /id="wallet-profile-panel"[^>]* hidden/u);
  assert.match(html, /id="wallet-signin"[^>]*href="\/account\?returnTo=wallet"[^>]* hidden/u);
  assert.match(html, /id="wallet-delete-confirmation"[^>]* hidden/u);
  assert.match(html, /it does not disconnect an email or social account/u);
  assert.match(html, /Automatic delivery and background alerts are not active/u);
  assert.deepEqual([...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/gu)].map(match => match[1]), ['/iceo.css', '/header.css', '/wallet.css', '/reader-theme.css']);
  assert.match(html, /<html\b[^>]*\bdata-reader-theme="prism"/u);
  const themeBootstrap = '<script src="/reader-theme.js"></script>';
  assert.equal(html.split(themeBootstrap).length, 2, 'One synchronous reader theme bootstrap');
  assert.ok(html.indexOf(themeBootstrap) < html.indexOf('<link rel="stylesheet"'), 'Reader theme bootstrap precedes stylesheets');
  assert.doesNotMatch(html, /<style\b|\bstyle=|type="email"|name="password"|onclick=/iu);
});

test('Production home includes Wallet outside the finite edition and uses its own module', () => {
  const html = read('public/iceo.html');
  assert.match(html, /src="\/wallet-home-browser.js"/u);
  assert.match(html, /<a class="text-button" href="\/wallet">Info Wallet<\/a>/u);
  assert.match(html, /<section id="wallet-home" class="info-card"/u);
  assert.match(html, /id="discovery-cards"/u);
  assert.match(html, /id="glance-date"/u);
});

test('Private UI has no persistent client storage, public sharing or HTML-injection sink', () => {
  const source = read('src/wallet/browser.ts') + read('src/wallet/home-browser.ts');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie|DeviceMemory|innerHTML|outerHTML|insertAdjacentHTML|navigator\.share|\/api\/share|\/api\/edition/iu);
  assert.match(source, /credentials: 'same-origin'/u);
  assert.match(source, /cache: 'no-store'/u);
  assert.match(source, /'X-DLKT-Info-Request': marker/u);
});

test('Unavailable account never exposes or collects profile fields or email', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('unavailable'));
  assert.equal(ui.get('wallet-profile-panel').hidden, true);
  assert.equal(ui.get('wallet-signin').hidden, true);
  assert.equal(ui.get('wallet-display-name').value, '');
  assert.match(ui.get('wallet-status').textContent, /not activated yet.*No email address is collected/u);
  assert.equal(ui.connections.states.at(-1), 'unavailable');
  assert.equal(ui.get('wallet-providers').children.length, 0);
  ui.get('wallet-profile-form').dispatch('submit');
  assert.equal(ui.requests.length, 1);
});

test('Signed-out Wallet offers the existing sign-in route without opening its profile editor', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('signed-out'));
  assert.equal(ui.get('wallet-signin').hidden, false);
  assert.equal(ui.get('wallet-profile-panel').hidden, true);
  assert.match(ui.get('wallet-status').textContent, /does not authorize access/u);
  assert.equal(ui.get('wallet-signout').hidden, true);
});

test('Profile details appear only after a validated signed-in response and are not automatically saved', async () => {
  const ui = harness();
  assert.equal(ui.get('wallet-display-name').value, '');
  await ui.answer(0, walletSnapshot('signed-in', state()));
  assert.equal(ui.get('wallet-profile-panel').hidden, false);
  assert.equal(ui.get('wallet-display-name').value, profile.displayName);
  assert.equal(ui.get('wallet-briefing-time').value, '08:30');
  assert.equal(ui.get('wallet-delete').hidden, false);
  assert.equal(ui.connections.states.at(-1), 'signed-in');
  assert.equal(ui.requests.length, 1);
});

test('Profile save uses the exact loaded revision and reports success only for an exact confirmed value', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('signed-in', state()));
  ui.get('wallet-display-name').value = 'Changed private name';
  ui.get('wallet-profile-form').dispatch('submit');
  const write = ui.requests[1];
  assert.equal(write.path, '/api/wallet');
  assert.equal(write.init.method, 'PUT');
  assert.equal(write.init.credentials, 'same-origin');
  assert.equal(write.init.cache, 'no-store');
  assert.equal(write.init.headers['X-DLKT-Info-Request'], 'wallet-v1');
  const body = JSON.parse(write.init.body);
  assert.equal(body.expectedRevision, revision);
  assert.equal(body.value.displayName, 'Changed private name');
  assert.equal(ui.get('wallet-display-name').value, '');
  assert.equal(ui.get('wallet-profile-panel').hidden, true);
  await ui.answer(1, walletSnapshot('signed-in', state(body.value, nextRevision)));
  assert.match(ui.get('wallet-status').textContent, /private profile is saved/u);
  assert.equal(ui.get('wallet-display-name').value, 'Changed private name');
});

test('New profile creation uses a null expected revision', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('signed-in'));
  ui.get('wallet-profile-form').dispatch('submit');
  const body = JSON.parse(ui.requests[1].init.body);
  assert.equal(body.expectedRevision, null);
  assert.equal(body.value.displayName, null);
  await ui.answer(1, walletSnapshot('signed-in', state(body.value, nextRevision)));
  assert.equal(ui.get('wallet-profile-panel').hidden, false);
});

test('A successful HTTP response with a different saved profile is never called a successful save', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('signed-in', state()));
  ui.get('wallet-display-name').value = 'Intended private name';
  ui.get('wallet-profile-form').dispatch('submit');
  await ui.answer(1, walletSnapshot('signed-in', state(profile, nextRevision)));
  assert.match(ui.get('wallet-status').textContent, /change could not be confirmed/u);
  assert.doesNotMatch(ui.get('wallet-status').textContent, /profile is saved/u);
  assert.equal(ui.get('wallet-profile-panel').hidden, true);
  assert.equal(ui.get('wallet-display-name').value, '');
});

test('Revision conflicts clear private drafts and require a reload before another write', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('signed-in', state()));
  ui.get('wallet-profile-form').dispatch('submit');
  await ui.answer(1, {error: 'WALLET_CONFLICT'}, 409);
  assert.match(ui.get('wallet-status').textContent, /changed in another tab or device.*Reload/u);
  assert.equal(ui.get('wallet-display-name').value, '');
  ui.get('wallet-profile-form').dispatch('submit');
  assert.equal(ui.requests.length, 2);
});

test('Expired authentication clears all profile fields before offering sign-in again', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('signed-in', state()));
  ui.get('wallet-profile-form').dispatch('submit');
  await ui.answer(1, {error: 'AUTHENTICATION_REQUIRED'}, 401);
  assert.equal(ui.get('wallet-signin').hidden, false);
  assert.equal(ui.get('wallet-profile-panel').hidden, true);
  assert.equal(ui.get('wallet-display-name').value, '');
  assert.equal(ui.get('wallet-profile-summary').textContent, '');
  assert.match(ui.get('wallet-status').textContent, /session ended/u);
});

test('Leaving and returning ignores late private responses and rechecks authentication', async () => {
  const ui = harness();
  await tick();
  ui.document.hidden = true;
  ui.document.dispatch('visibilitychange');
  assert.equal(ui.requests[0].init.signal.aborted, true);
  await ui.answer(0, walletSnapshot('signed-in', state()));
  assert.equal(ui.get('wallet-profile-panel').hidden, true);
  assert.equal(ui.get('wallet-display-name').value, '');
  ui.document.hidden = false;
  ui.document.dispatch('visibilitychange');
  await ui.answer(1, walletSnapshot('signed-out'));
  assert.equal(ui.get('wallet-signin').hidden, false);
  assert.equal(ui.get('wallet-display-name').value, '');
});

test('Leaving during a write prevents a late save from restoring private fields', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('signed-in', state()));
  ui.get('wallet-profile-form').dispatch('submit');
  const body = JSON.parse(ui.requests[1].init.body);
  ui.window.dispatch('blur');
  await ui.answer(1, walletSnapshot('signed-in', state(body.value, nextRevision)));
  assert.equal(ui.get('wallet-profile-panel').hidden, true);
  assert.equal(ui.get('wallet-display-name').value, '');
  assert.doesNotMatch(ui.get('wallet-status').textContent, /profile is saved/u);
  ui.window.dispatch('focus');
  await ui.answer(2, walletSnapshot('signed-out'));
  assert.equal(ui.get('wallet-signin').hidden, false);
});

test('A visible but unfocused window cannot refresh private profile details', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('signed-in', state()));
  ui.document.focused = false;
  ui.window.dispatch('blur');
  ui.document.dispatch('visibilitychange');
  ui.window.dispatch('pageshow', {persisted: true});
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.get('wallet-profile-panel').hidden, true);
  assert.equal(ui.get('wallet-display-name').value, '');
  ui.document.focused = true;
  ui.window.dispatch('focus');
  await tick();
  assert.equal(ui.requests.length, 2);
  await ui.answer(1, walletSnapshot('signed-out'));
});

test('Delete requires an accessible confirmation and only calls the Wallet preferences endpoint', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('signed-in', state()));
  ui.get('wallet-delete').dispatch('click');
  assert.equal(ui.get('wallet-delete-confirmation').hidden, false);
  assert.equal(ui.get('wallet-delete').getAttribute('aria-expanded'), 'true');
  assert.equal(ui.document.activeElement, ui.get('wallet-delete-cancel'));
  assert.equal(ui.requests.length, 1);
  ui.get('wallet-delete-cancel').dispatch('click');
  assert.equal(ui.get('wallet-delete-confirmation').hidden, true);
  assert.equal(ui.requests.length, 1);
  ui.get('wallet-delete').dispatch('click');
  ui.get('wallet-delete-confirm').dispatch('click');
  assert.equal(ui.requests[1].path, '/api/wallet');
  assert.equal(ui.requests[1].init.method, 'DELETE');
  assert.deepEqual(JSON.parse(ui.requests[1].init.body), {expectedRevision: revision});
  await ui.answer(1, walletSnapshot('signed-in'));
  assert.match(ui.get('wallet-status').textContent, /Wallet preferences were deleted.*sign-in account.*unchanged/u);
  assert.equal(ui.get('wallet-delete').hidden, true);
});

test('Delete response retaining a profile is not reported as deleted', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('signed-in', state()));
  ui.get('wallet-delete').dispatch('click');
  ui.get('wallet-delete-confirm').dispatch('click');
  await ui.answer(1, walletSnapshot('signed-in', state()));
  assert.match(ui.get('wallet-status').textContent, /change could not be confirmed/u);
  assert.doesNotMatch(ui.get('wallet-status').textContent, /were deleted/u);
});

test('Sign-out clears private DOM immediately and confirms the resulting Wallet session', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('signed-in', state()));
  ui.get('wallet-signout').dispatch('click');
  assert.equal(ui.get('wallet-display-name').value, '');
  assert.equal(ui.get('wallet-profile-panel').hidden, true);
  assert.equal(ui.requests[1].path, '/api/account-session');
  assert.equal(ui.requests[1].init.headers['X-DLKT-Info-Request'], 'identity-v1');
  await ui.answer(1, signedOutSession);
  assert.equal(ui.requests[2].path, '/api/wallet');
  assert.equal(ui.broadcasts.length, 0);
  await ui.answer(2, walletSnapshot('signed-out'));
  assert.match(ui.get('wallet-status').textContent, /You are signed out/u);
  assert.equal(ui.get('wallet-signin').hidden, false);
  assert.deepEqual(ui.broadcasts, [{name: 'dlkt-info-account-session-v1', data: 'signed-out'}]);
});

test('Malformed private response and network failure leave the editor closed', async () => {
  const ui = harness();
  await ui.answer(0, {...walletSnapshot('signed-out'), profile: state()});
  assert.equal(ui.get('wallet-profile-panel').hidden, true);
  assert.match(ui.get('wallet-status').textContent, /could not be checked/u);
  ui.get('wallet-reload').dispatch('click');
  await tick();
  ui.requests[1].reject(new Error('offline'));
  await tick();
  assert.equal(ui.get('wallet-reload').disabled, false);
  assert.equal(ui.get('wallet-display-name').value, '');
});

test('Homepage uses actual disabled connection state and clears it on leaving', async () => {
  const ui = harness(true);
  await ui.answer(0, walletSnapshot('signed-in', state()));
  await ui.answer(1, {version: CONNECTIONS_VERSION, providers: WALLET_PROVIDER_IDS.map(providerId => ({providerId, status: 'unavailable', connection: null}))});
  assert.match(ui.get('wallet-home-status').textContent, /private profile is saved/u);
  assert.doesNotMatch(ui.get('wallet-home-status').textContent, /Private test name|08:30|science/u);
  ui.window.dispatch('blur');
  assert.match(ui.get('wallet-home-status').textContent, /hidden/u);
  ui.window.dispatch('focus');
  await ui.answer(2, walletSnapshot('unavailable'));
  assert.match(ui.get('wallet-home-status').textContent, /not activated yet/u);
});

test('Homepage ignores a late authenticated response after a tab change', async () => {
  const ui = harness(true);
  ui.document.hidden = true;
  ui.document.dispatch('visibilitychange');
  await ui.answer(0, walletSnapshot('signed-in', state()));
  assert.match(ui.get('wallet-home-status').textContent, /hidden/u);
  assert.doesNotMatch(ui.get('wallet-home-status').textContent, /profile is saved/u);
});

test('Wallet revalidates both verified sign-in and sign-out signals without retaining the prior private profile', async () => {
  for (const change of ['signed-in', 'signed-out']) {
    const ui = harness(); await ui.answer(0, walletSnapshot('signed-in', state()));
    ui.sessionChanged(change);
    await tick();
    assert.equal(ui.get('wallet-display-name').value, '');
    assert.equal(ui.get('wallet-profile-panel').hidden, true);
    assert.equal(ui.requests[1].path, '/api/wallet');
    await ui.answer(1, walletSnapshot('signed-out'));
    assert.equal(ui.get('wallet-signin').hidden, false);
  }
});

test('Wallet cannot confirm sign-out from a malformed acknowledgment or unavailable session readback', async () => {
  const malformed = harness(); await malformed.answer(0, walletSnapshot('signed-in', state()));
  malformed.get('wallet-signout').dispatch('click'); await malformed.answer(1, {authenticated: false});
  assert.equal(malformed.requests.length, 2);
  assert.match(malformed.get('wallet-status').textContent, /could not be confirmed/u);
  assert.equal(malformed.broadcasts.length, 0);
  const unavailable = harness(); await unavailable.answer(0, walletSnapshot('signed-in', state()));
  unavailable.get('wallet-signout').dispatch('click'); await unavailable.answer(1, signedOutSession);
  await unavailable.answer(2, walletSnapshot('unavailable'));
  assert.match(unavailable.get('wallet-status').textContent, /could not be confirmed/u);
  assert.equal(unavailable.get('wallet-display-name').value, '');
  assert.equal(unavailable.broadcasts.length, 0);
});

test('Late Wallet sign-out acknowledgment after invalidation cannot start another request or emit a success signal', async () => {
  const ui = harness(); await ui.answer(0, walletSnapshot('signed-in', state()));
  ui.get('wallet-signout').dispatch('click'); ui.window.dispatch('blur');
  await ui.answer(1, signedOutSession);
  assert.equal(ui.requests.length, 2); assert.equal(ui.broadcasts.length, 0);
  assert.equal(ui.get('wallet-display-name').value, '');
  assert.doesNotMatch(ui.get('wallet-status').textContent, /You are signed out/u);
});

test('Homepage refreshes generic account status on verified sign-in signals', async () => {
  const ui = harness(true); await ui.answer(0, walletSnapshot('signed-out'));
  ui.sessionChanged('signed-in');
  assert.equal(ui.requests[1].path, '/api/wallet');
  await ui.answer(1, walletSnapshot('signed-in', state()));
  await ui.answer(2, {version: CONNECTIONS_VERSION, providers: WALLET_PROVIDER_IDS.map(providerId => ({providerId, status: 'unavailable', connection: null}))});
  assert.match(ui.get('wallet-home-status').textContent, /private profile is saved/u);
  assert.doesNotMatch(ui.get('wallet-home-status').textContent, /Private test name/u);
});

test('Unrecognized session messages cannot trigger Wallet or homepage activity', async () => {
  for (const home of [false, true]) {
    const ui = harness(home); await ui.answer(0, walletSnapshot('signed-out'));
    ui.sessionChanged({authenticated: true}); ui.sessionChanged('/wallet');
    assert.equal(ui.requests.length, 1);
  }
});

test('Wallet delegates connection privacy clearing and cannot invent provider state from profile saves', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('signed-in', state()));
  const before = ui.connections.clears;
  ui.window.dispatch('blur');
  assert.ok(ui.connections.clears > before);
  assert.equal(ui.get('wallet-providers').children.length, 0);
  assert.doesNotMatch(read('src/wallet/browser.ts'), /renderProviders|wallet-activity-state|accounts remain unconnected/u);
});

test('An expired connection request clears the private profile and offers the account sign-in route', async () => {
  const ui = harness();
  await ui.answer(0, walletSnapshot('signed-in', state()));
  ui.connections.onExpired();
  assert.equal(ui.get('wallet-profile-panel').hidden, true);
  assert.equal(ui.get('wallet-display-name').value, '');
  assert.equal(ui.get('wallet-signin').hidden, false);
  assert.match(ui.get('wallet-status').textContent, /session ended/u);
});


test('Wallet binds private profile reads and writes to the confirmed owner and clears an old-owner response', async () => {
  const ui = harness(); await tick();
  assert.equal(ui.requests[0].init.headers['X-DLKT-Info-Owner'], revision);
  ui.setOwner(nextRevision);
  await ui.answer(0, walletSnapshot('signed-in', state()));
  assert.equal(ui.get('wallet-profile-panel').hidden, true);
  assert.equal(ui.get('wallet-display-name').value, '');
  assert.match(ui.get('wallet-status').textContent, /session changed/u);
  assert.equal(ui.readers.loads.length, 0);
});

test('Explicit city and local needs are restored, submitted with the owner and passed only after confirmed saving', async () => {
  const ui = harness(); await ui.answer(0, walletSnapshot('signed-in', state()));
  ui.get('wallet-city').checked = true;
  const need = ui.get('wallet-local-needs').children.find(label => label.children[0]?.value === 'utilities').children[0];
  need.checked = true;
  const priorLoads = ui.readers.loads.length;
  ui.get('wallet-profile-form').dispatch('submit');
  const write = ui.requests[1], body = JSON.parse(write.init.body);
  assert.equal(write.init.headers['X-DLKT-Info-Owner'], revision);
  assert.equal(body.value.cityId, '683506'); assert.deepEqual(body.value.localNeeds, ['utilities']);
  assert.equal(ui.get('wallet-city').checked, false);
  assert.equal(ui.get('wallet-city').value, '683506', 'Clearing a checkbox preserves its nonprivate public pilot value');
  assert.equal(need.checked, false);
  assert.equal(ui.readers.loads.length, priorLoads, 'Unsaved fields never drive private cards');
  await ui.answer(1, walletSnapshot('signed-in', state(body.value, nextRevision)));
  assert.equal(ui.get('wallet-city').value, '683506'); assert.equal(need.checked, true);
  assert.equal(ui.readers.loads.at(-1).ownerId, revision);
  assert.equal(ui.readers.loads.at(-1).value.revision, nextRevision);
  ui.window.dispatch('pagehide');
  assert.equal(ui.get('wallet-city').checked, false); assert.equal(need.checked, false);
});

test('Null-revision creation stays bound to its displayed owner after a silent session switch', async () => {
  const ui = harness(); await ui.answer(0, walletSnapshot('signed-in'));
  ui.get('wallet-city').checked = true; ui.setOwner(nextRevision);
  ui.get('wallet-profile-form').dispatch('submit');
  const write = ui.requests[1]; assert.equal(write.init.headers['X-DLKT-Info-Owner'], revision);
  assert.equal(JSON.parse(write.init.body).expectedRevision, null);
  await ui.answer(1, {error: 'WALLET_OWNER_CHANGED'}, 409);
  assert.equal(ui.get('wallet-profile-panel').hidden, true);
  assert.equal(ui.readers.loads.length, 0);
  assert.doesNotMatch(ui.get('wallet-status').textContent, /profile is saved/u);
});
