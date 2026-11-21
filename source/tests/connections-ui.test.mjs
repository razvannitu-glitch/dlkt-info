import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {isRecord, isUuid} from '../.build/src/data/guards.js';
import {getWalletProviders, isWalletProviderId, WALLET_PROVIDER_IDS} from '../.build/src/wallet/providers.js';
import {isWalletInstant, validatePersonalEvent} from '../.build/src/wallet/events.js';
import {CONNECTIONS_VERSION, connectionCallbackPath} from '../.build/src/connections/types.js';
import {parseConnectionsSnapshot, validateAuthorizationUrl, parseConnectionSync} from '../.build/src/connections/browser.js';

const origin = 'https://info.dlkt.ee';
const now = () => new Date().toISOString();
const id = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const connection = () => ({id, accountLabel: 'qa@example.com', connectedAt: now(), lastSyncAt: null, status: 'connected'});
const view = (status = 'connected') => ({providerId: 'gmail', status, connection: status === 'connected' ? connection() : null});
const snapshot = (overrides = {}) => ({version: CONNECTIONS_VERSION, providers: WALLET_PROVIDER_IDS.map(providerId => ({providerId, status: 'unavailable', connection: null, ...overrides[providerId]}))});
const event = () => ({ownerId: owner, connectionId: id, providerId: 'gmail', providerEventId: 'abcd', providerThreadId: 'abcd',
  kind: 'email.received', occurredAt: now(), observedAt: now(), actor: {providerId: 'gmail', providerActorId: 'email:sender@example.com', displayName: 'Sender', provenance: 'sender-header'},
  title: '<img src=x onerror=alert(1)>', excerpt: null, sourceUrl: 'https://mail.google.com/mail/?authuser=qa%40example.com#all/abcd',
  sourceUrlOrigin: 'provider-generated', unread: true, importance: 'normal', metrics: [], visibility: 'private'});
const sync = (events = [event()], state = 'available') => ({events, state, checkedAt: now()});
const authorization = (provider = 'gmail') => {
  const endpoints = {gmail: 'https://accounts.google.com/o/oauth2/v2/auth', outlook: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', instagram: 'https://www.instagram.com/oauth/authorize', 'facebook-pages': 'https://www.facebook.com/v25.0/dialog/oauth'};
  const url = new URL(endpoints[provider]);
  for (const [key, value] of Object.entries({client_id: 'public-client', response_type: 'code', state: 'test-state-only', redirect_uri: `${origin}${connectionCallbackPath(provider)}`})) url.searchParams.set(key, value);
  return url.href;
};
const tick = () => new Promise(resolve => setImmediate(resolve));

class Target {
  listeners = new Map();
  addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); }
  removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== callback)); }
  dispatch(name, details = {}) { for (const callback of this.listeners.get(name) ?? []) callback({preventDefault() {}, ...details}); }
}
class Element extends Target {
  children = []; attributes = new Map(); dataset = {}; content = ''; disabled = false; hidden = false;
  constructor(tag, document) { super(); this.tagName = tag.toUpperCase(); this.document = document; }
  focus() {this.document.activeElement = this; this.document.dispatch('focusin');}
  set textContent(value) { this.content = value; this.children = []; }
  get textContent() { return this.content + this.children.map(child => child.textContent).join(''); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.content = ''; this.children = children; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.tagName === selector.toUpperCase() ? [child] : []), ...child.querySelectorAll(selector)]); }
}

function harness(query = '') {
  const elements = new Map();
  const document = new Target();
  for (const id of ['wallet-connections', 'wallet-providers', 'wallet-connections-status', 'wallet-connections-reload', 'wallet-updates', 'wallet-activity-state', 'wallet-activity-copy']) elements.set(id, new Element(id === 'wallet-connections-reload' ? 'button' : 'div', document));
  Object.assign(document, {hidden: false, focused: true, activeElement: null, hasFocus() {return this.focused;}, getElementById: id => elements.get(id), createElement: tag => new Element(tag, document)});
  const requests = [], destinations = [], histories = [], expired = [], timers = new Map();
  let timer = 0;
  const window = {location: {href: `${origin}/wallet${query}`, origin, assign: value => destinations.push(value)},
    history: {replaceState: (...args) => histories.push(args)}, setTimeout: callback => {timers.set(++timer, callback); return timer;}, clearTimeout: id => timers.delete(id)};
  const fetch = (path, init) => new Promise((resolve, reject) => requests.push({path, init, resolve, reject}));
  const source = readFileSync('.build/src/connections/browser.js', 'utf8').replace(/^import [^\n]+\n/gmu, '').replace(/^export /gmu, '');
  const context = {document, window, fetch, AbortController, URL, Date, Error, Intl, JSON,
    isRecord, isUuid, getWalletProviders, isWalletProviderId, WALLET_PROVIDER_IDS, isWalletInstant, validatePersonalEvent, CONNECTIONS_VERSION, connectionCallbackPath, onSessionExpired: () => expired.push(true)};
  const controller = runInNewContext(`${source}\ncreateConnectionsWallet(onSessionExpired);`, context);
  return {controller, document, requests, destinations, histories, expired, timers, get: id => elements.get(id),
    button: name => elements.get('wallet-providers').querySelectorAll('button').find(button => button.attributes.get('aria-label') === name),
    async answer(index, value, status = 200) {assert.ok(requests[index], `request ${index}`); requests[index].resolve({ok: status >= 200 && status < 300, status, json: async () => value}); await tick();},
  };
}

test('Snapshot validation rejects fabricated connection claims, duplicate providers and extra secret fields', () => {
  assert.equal(parseConnectionsSnapshot(snapshot()).providers.length, 4);
  for (const value of [snapshot({gmail: {status: 'connected'}}), {...snapshot(), token: 'unexpected'}, snapshot({gmail: {providerId: 'outlook'}}), snapshot({gmail: {status: 'available', connection: connection()}})]) assert.throws(() => parseConnectionsSnapshot(value));
  assert.throws(() => parseConnectionsSnapshot(snapshot({gmail: {...view(), connection: {...connection(), refreshToken: 'unexpected'}}})));
});

test('OAuth navigation accepts only exact reviewed provider endpoints and same-origin callbacks', () => {
  for (const provider of WALLET_PROVIDER_IDS) assert.equal(validateAuthorizationUrl(provider, authorization(provider), origin), authorization(provider));
  for (const value of [authorization().replace('accounts.google.com', 'accounts.google.com.attacker.invalid'), authorization().replace('/o/oauth2/v2/auth', '/redirect'), authorization().replace('https:', 'http:'), `${authorization()}&state=duplicate`, `${authorization()}#fragment`, authorization().replace('accounts.google.com', 'userinfo@accounts.google.com')]) assert.throws(() => validateAuthorizationUrl('gmail', value, origin));
  const evil = new URL(authorization());
  for (const callback of ['https://attacker.invalid/callback', `${origin}/api/connections?provider=outlook`, `${origin}/api/connections?provider=gmail&provider=gmail`, `${origin}/account`]) {
    evil.searchParams.set('redirect_uri', callback);
    assert.throws(() => validateAuthorizationUrl('gmail', evil.href, origin));
  }
});

test('Personal update parser requires matching connection, allowed source URL, owner consistency and unique event IDs', () => {
  assert.equal(parseConnectionSync(sync(), view()).events.length, 1);
  for (const bad of [{...event(), sourceUrl: 'javascript:alert(1)'}, {...event(), connectionId: owner}, {...event(), providerId: 'outlook'}]) assert.throws(() => parseConnectionSync(sync([bad]), view()));
  assert.throws(() => parseConnectionSync(sync([event(), event()]), view()));
  assert.throws(() => parseConnectionSync(sync([event(), {...event(), ownerId: id, providerEventId: 'different'}]), view()));
  assert.throws(() => parseConnectionSync({...sync(), checkedAt: '2000-01-01T00:00:00.000Z'}, view()));
  assert.equal(parseConnectionSync(sync([], 'partial'), view()).state, 'partial');
});

test('Account state must be verified before querying connections and details start collapsed', async () => {
  const ui = harness();
  ui.controller.setAccount('signed-out');
  assert.equal(ui.requests.length, 0);
  assert.ok(ui.get('wallet-providers').querySelectorAll('button').every(button => button.disabled));
  assert.ok(ui.get('wallet-providers').querySelectorAll('details').every(details => !details.open));
  ui.controller.setAccount('signed-in');
  assert.equal(ui.requests[0].path, '/api/connections');
  assert.equal(ui.requests[0].init.headers['X-DLKT-Info-Request'], 'connections-v1');
  assert.equal(ui.requests[0].init.credentials, 'same-origin');
  assert.equal(ui.requests[0].init.cache, 'no-store');
  assert.equal(ui.requests[0].init.redirect, 'error');
  await ui.answer(0, snapshot({gmail: {status: 'available'}}));
  assert.equal(ui.button('Connect: Gmail').disabled, false);
  assert.equal(ui.button('Unavailable: Outlook').disabled, true);
  assert.doesNotMatch(ui.get('wallet-providers').textContent, /Connected/u);
});

test('Connect posts only the fixed action/provider and navigates only after validated authorization response', async () => {
  const ui = harness(); ui.controller.setAccount('signed-in');
  await ui.answer(0, snapshot({gmail: {status: 'available'}}));
  ui.button('Connect: Gmail').dispatch('click');
  assert.deepEqual(JSON.parse(ui.requests[1].init.body), {action: 'connect', providerId: 'gmail'});
  assert.equal(ui.destinations.length, 0);
  await ui.answer(1, {authorizationUrl: authorization()});
  assert.deepEqual(ui.destinations, [authorization()]);
  assert.equal(ui.get('wallet-updates').children.length, 0);
});

test('Rejected authorization URLs expose retry without changing a connection to connected', async () => {
  const ui = harness(); ui.controller.setAccount('signed-in');
  await ui.answer(0, snapshot({gmail: {status: 'available'}}));
  ui.button('Connect: Gmail').dispatch('click');
  await ui.answer(1, {authorizationUrl: 'https://attacker.invalid/'});
  assert.equal(ui.destinations.length, 0);
  assert.match(ui.get('wallet-connections-status').textContent, /could not be confirmed/u);
  assert.equal(ui.get('wallet-connections-reload').disabled, false);
  assert.doesNotMatch(ui.get('wallet-providers').textContent, /Connected/u);
});

test('Sync renders real returned text only after a matching saved connection readback', async () => {
  const ui = harness(); ui.controller.setAccount('signed-in');
  await ui.answer(0, snapshot({gmail: view()}));
  ui.button('Check updates: Gmail').dispatch('click');
  await ui.answer(1, sync());
  assert.equal(ui.get('wallet-updates').children.length, 0);
  assert.equal(ui.requests[2].init.method, 'GET');
  await ui.answer(2, snapshot({gmail: view()}));
  assert.equal(ui.get('wallet-updates').children.length, 1);
  assert.equal(ui.get('wallet-updates').querySelectorAll('img').length, 0);
  assert.match(ui.get('wallet-updates').textContent, /<img src=x onerror=alert\(1\)>/u);
  assert.equal(ui.get('wallet-updates').querySelectorAll('a')[0].rel, 'noopener noreferrer');
  assert.match(ui.get('wallet-updates').textContent, /Sender as reported/u);
});

test('Changed connection after synchronization discards the activity response', async () => {
  const ui = harness(); ui.controller.setAccount('signed-in');
  await ui.answer(0, snapshot({gmail: view()}));
  ui.button('Check updates: Gmail').dispatch('click');
  await ui.answer(1, sync()); await ui.answer(2, snapshot({gmail: {status: 'available'}}));
  assert.equal(ui.get('wallet-updates').children.length, 0);
  assert.match(ui.get('wallet-connections-status').textContent, /could not be confirmed/u);
});

test('Partial or empty sync states never claim a complete activity history', async () => {
  const ui = harness(); ui.controller.setAccount('signed-in');
  await ui.answer(0, snapshot({gmail: view()}));
  ui.button('Check updates: Gmail').dispatch('click');
  await ui.answer(1, sync([], 'partial')); await ui.answer(2, snapshot({gmail: view()}));
  assert.match(ui.get('wallet-activity-state').textContent, /could not be retrieved/u);
  assert.match(ui.get('wallet-activity-copy').textContent, /not a complete activity history/u);
});

test('Disconnect success needs readback and explains provider-side manual revocation', async () => {
  const ui = harness(); ui.controller.setAccount('signed-in');
  await ui.answer(0, snapshot({gmail: view()}));
  ui.button('Disconnect: Gmail').dispatch('click');
  await ui.answer(1, {disconnected: true, revocation: 'manual-required'});
  assert.doesNotMatch(ui.get('wallet-connections-status').textContent, /Disconnected from DLKT/u);
  await ui.answer(2, snapshot({gmail: {status: 'available'}}));
  assert.match(ui.get('wallet-connections-status').textContent, /Also remove DLKT access/u);
  assert.equal(ui.button('Connect: Gmail').disabled, false);
});

test('Unconfirmed disconnect is never reported as successful', async () => {
  const ui = harness(); ui.controller.setAccount('signed-in');
  await ui.answer(0, snapshot({gmail: view()}));
  ui.button('Disconnect: Gmail').dispatch('click');
  await ui.answer(1, {disconnected: true, revocation: 'revoked'}); await ui.answer(2, snapshot({gmail: view()}));
  assert.match(ui.get('wallet-connections-status').textContent, /could not be confirmed/u);
  assert.equal(ui.get('wallet-updates').children.length, 0);
});

test('Account invalidation aborts outstanding work and late responses cannot restore personal DOM', async () => {
  const ui = harness(); ui.controller.setAccount('signed-in');
  await ui.answer(0, snapshot({gmail: view()}));
  ui.button('Check updates: Gmail').dispatch('click');
  ui.controller.clear();
  assert.equal(ui.requests[1].init.signal.aborted, true);
  await ui.answer(1, sync());
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.get('wallet-updates').children.length, 0);
  assert.doesNotMatch(ui.get('wallet-providers').textContent, /qa@example.com/u);
});

test('Callback query is removed and cannot fabricate a connected account', async () => {
  const ui = harness('?connection=connected');
  assert.equal(ui.histories[0][2], '/wallet');
  ui.controller.setAccount('signed-in'); await ui.answer(0, snapshot());
  assert.doesNotMatch(ui.get('wallet-providers').textContent, /Connected/u);
  assert.equal(ui.button('Unavailable: Gmail').disabled, true);
  assert.equal(ui.get('wallet-updates').children.length, 0);
});

test('API errors do not display provider internals and retry is usable', async () => {
  const ui = harness(); ui.controller.setAccount('signed-in');
  await ui.answer(0, {error: 'internal-client-secret-detail'}, 503);
  assert.doesNotMatch(ui.get('wallet-connections-status').textContent, /internal-client-secret-detail/u);
  assert.equal(ui.get('wallet-connections-reload').disabled, false);
  ui.get('wallet-connections-reload').dispatch('click'); await ui.answer(1, snapshot());
  assert.match(ui.get('wallet-connections-status').textContent, /not enabled for DLKT yet/u);
});

test('Connection UI has no credential persistence, raw-HTML rendering, background polling or fake success', () => {
  const source = readFileSync('src/connections/browser.ts', 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML|outerHTML|insertAdjacentHTML|setInterval|access_token|refresh_token/u);
  const html = readFileSync('public/wallet.html', 'utf8');
  assert.match(html, /class="legal-page wallet-page"/u);
  assert.match(html, /href="\/wallet.css"/u);
  assert.doesNotMatch(html, /type="password"|name="password"|<style\b|\bstyle=/u);
  const css = readFileSync('public/wallet.css', 'utf8');
  assert.doesNotMatch(css, /position:\s*fixed|min-width:\s*\d{3,}px|height:\s*100vh/u);
});

test('Expired connection session notifies the profile owner, clears private labels and offers sign-in', async () => {
  const ui = harness(); ui.controller.setAccount('signed-in');
  await ui.answer(0, snapshot({gmail: view()}));
  ui.button('Check updates: Gmail').dispatch('click');
  await ui.answer(1, {error: 'unauthorized'}, 401);
  assert.equal(ui.expired.length, 1);
  assert.doesNotMatch(ui.get('wallet-providers').textContent, /qa@example.com/u);
  assert.equal(ui.get('wallet-connections-status').querySelectorAll('a')[0].href, '/account?returnTo=wallet');
  assert.equal(ui.get('wallet-connections-reload').disabled, true);
});

test('Keyboard focus returns to the corresponding action after a manual sync or disconnect', async () => {
  const ui = harness(); ui.controller.setAccount('signed-in');
  await ui.answer(0, snapshot({gmail: view()}));
  ui.button('Check updates: Gmail').focus(); ui.button('Check updates: Gmail').dispatch('click');
  await ui.answer(1, sync()); await ui.answer(2, snapshot({gmail: view()}));
  assert.equal(ui.document.activeElement, ui.button('Check updates: Gmail'));
  ui.button('Disconnect: Gmail').focus(); ui.button('Disconnect: Gmail').dispatch('click');
  await ui.answer(3, {disconnected: true, revocation: 'revoked'}); await ui.answer(4, snapshot({gmail: {status: 'available'}}));
  assert.equal(ui.document.activeElement, ui.button('Connect: Gmail'));
});

test('Async readback does not steal focus after the user moves it elsewhere', async () => {
  const ui = harness(); ui.controller.setAccount('signed-in');
  await ui.answer(0, snapshot({gmail: view()}));
  ui.button('Check updates: Gmail').focus(); ui.button('Check updates: Gmail').dispatch('click');
  const elsewhere = ui.document.createElement('input'); elsewhere.focus();
  await ui.answer(1, sync()); await ui.answer(2, snapshot({gmail: view()}));
  assert.equal(ui.document.activeElement, elsewhere);
});

test('Failed keyboard action moves focus to Retry without focusing controls during automatic loads', async () => {
  const ui = harness(); ui.controller.setAccount('signed-in');
  await ui.answer(0, snapshot({gmail: view()}));
  assert.equal(ui.document.activeElement, null);
  ui.button('Check updates: Gmail').focus(); ui.button('Check updates: Gmail').dispatch('click');
  await ui.answer(1, {error: 'failed'}, 502);
  assert.equal(ui.document.activeElement, ui.get('wallet-connections-reload'));
});


test('Microsoft navigation permits only the canonical queryless callback', () => {
  const valid = new URL(authorization('outlook'));
  assert.equal(new URL(valid.searchParams.get('redirect_uri')).search, '');
  for (const callback of [`${origin}/api/connections?provider=outlook`, `${origin}/api/connections?`, `${origin}/api/connections?provider=gmail`, `${origin}/account`, 'https://attacker.invalid/api/connections']) {
    valid.searchParams.set('redirect_uri', callback);
    assert.throws(() => validateAuthorizationUrl('outlook', valid.href, origin));
  }
  const gmail = new URL(authorization('gmail')); gmail.searchParams.set('redirect_uri', `${origin}/api/connections`);
  assert.throws(() => validateAuthorizationUrl('gmail', gmail.href, origin));
});
