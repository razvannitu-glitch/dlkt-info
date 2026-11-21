import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizationUrl, exchangeCode, refreshGrant, revokeGrant, syncProvider, ProviderError} from '../.build/src/connections/providers.js';

const NOW = '2026-11-20T12:00:00.000Z';
const TOKEN = 'fixture-only-access-token-never-a-real-credential';
const REFRESH = 'fixture-only-refresh-token-never-real';
const CONTEXT = {ownerId: '3f3bc542-37a6-4dc6-804c-0b8cd946ef13', connectionId: '4f3bc542-37a6-4dc6-804c-0b8cd946ef13'};
const SCOPES = {
  gmail: ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.metadata'],
  outlook: ['User.Read', 'Mail.ReadBasic'],
  instagram: ['instagram_business_basic', 'instagram_business_manage_comments'],
  'facebook-pages': ['pages_show_list', 'pages_read_engagement', 'pages_read_user_content']
};
const config = providerId => ({providerId, clientId: 'fixture-client-id', clientSecret: 'fixture-client-secret', redirectUri: providerId === 'outlook' ? 'https://info.example.com/api/connections' : `https://info.example.com/api/connections?provider=${providerId}`, graphVersion: ['instagram', 'facebook-pages'].includes(providerId) ? 'v27.0' : null});
const grant = (providerId, overrides = {}) => ({accountId: ['instagram', 'facebook-pages'].includes(providerId) ? '1234' : 'account-123', accountLabel: providerId === 'gmail' || providerId === 'outlook' ? 'reader@example.com' : 'Example account', accessToken: TOKEN, refreshToken: ['gmail', 'outlook'].includes(providerId) ? REFRESH : null, expiresAt: '2026-11-20T13:00:00.000Z', scopes: SCOPES[providerId], resources: [], ...overrides});
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}});
function fixture(responses) {
  const requests = [];
  const deps = {now: () => new Date(NOW), fetchImpl: async (input, init) => {
    const url = new URL(input); requests.push({url, init});
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit');
    let next = responses[requests.length - 1];
    assert.notEqual(next, undefined, 'unexpected provider request');
    if (typeof next === 'function') next = await next(url, init);
    if (next instanceof Error) throw next;
    return next instanceof Response ? next : response(next);
  }};
  return {requests, deps};
}
const errorCode = code => error => error instanceof ProviderError && error.code === code && !error.message.includes(TOKEN);
const tokenResponse = providerId => ({access_token: TOKEN, token_type: 'Bearer', expires_in: 3600, refresh_token: REFRESH, scope: SCOPES[providerId].join(' ')});
const email = (id = 'message-1', overrides = {}) => ({id, conversationId: 'thread-1', subject: 'A real subject', from: {emailAddress: {address: 'sender@example.com', name: 'Sender'}}, receivedDateTime: '2026-11-20T11:30:00Z', isRead: false, importance: 'high', webLink: `https://outlook.office.com/mail/deeplink/read/${id}`, ...overrides});

test('authorization uses exact provider hosts, only needed scopes, state and S256 for Google/Microsoft', () => {
  const state = 's'.repeat(43), challenge = 'c'.repeat(43);
  const expected = {gmail: 'https://accounts.google.com/o/oauth2/v2/auth', outlook: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', instagram: 'https://www.instagram.com/oauth/authorize', 'facebook-pages': 'https://www.facebook.com/v27.0/dialog/oauth'};
  for (const provider of Object.keys(expected)) {
    const url = new URL(authorizationUrl(config(provider), state, challenge));
    assert.equal(url.origin + url.pathname, expected[provider]);
    assert.equal(url.searchParams.get('state'), state);
    assert.equal(url.searchParams.get('client_secret'), null);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('code_challenge_method'), ['gmail', 'outlook'].includes(provider) ? 'S256' : null);
    assert.doesNotMatch(url.searchParams.get('scope'), /Mail\.ReadWrite|Mail\.Send|manage_messages|content_publish|pages_manage_posts/u);
  }
  assert.throws(() => authorizationUrl({...config('instagram'), graphVersion: null}, state, challenge), errorCode('configuration'));
  assert.throws(() => authorizationUrl({...config('gmail'), redirectUri: 'http://info.example.com/callback'}, state, challenge), errorCode('configuration'));
  for (const suffix of ['?provider=outlook', '?provider=gmail&provider=gmail', '?provider=gmail&next=evil', '?provider=gmail#fragment']) {
    assert.throws(() => authorizationUrl({...config('gmail'), redirectUri: `https://info.example.com/api/connections${suffix}`}, state, challenge), errorCode('configuration'));
  }
  assert.throws(() => authorizationUrl(config('gmail'), 'short', challenge), errorCode('configuration'));
});

test('Google code exchange binds verified account to minimum grant and keeps secrets in POST body/header', async () => {
  const {deps, requests} = fixture([tokenResponse('gmail'), {sub: 'google-sub', email: 'reader@example.com', email_verified: true}]);
  const result = await exchangeCode(config('gmail'), 'fixture-code', 'v'.repeat(43), deps);
  assert.equal(result.accountId, 'google-sub'); assert.equal(result.accountLabel, 'reader@example.com'); assert.equal(result.refreshToken, REFRESH);
  assert.equal(requests[0].url.href, 'https://oauth2.googleapis.com/token');
  const form = new URLSearchParams(requests[0].init.body);
  assert.equal(form.get('code_verifier'), 'v'.repeat(43)); assert.equal(form.get('redirect_uri'), config('gmail').redirectUri);
  assert.equal(requests[1].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(requests.every(item => !item.url.href.includes(TOKEN) && !item.url.href.includes(REFRESH)));
});

test('denied scope, OAuth denial and unverified identity fail before successful connection', async () => {
  const missing = fixture([{...tokenResponse('gmail'), scope: 'openid email'}]);
  await assert.rejects(exchangeCode(config('gmail'), 'code', 'v'.repeat(43), missing.deps), errorCode('scope-denied'));
  assert.equal(missing.requests.length, 1);
  const denied = fixture([response({error: 'invalid_grant', error_description: TOKEN}, 400)]);
  await assert.rejects(exchangeCode(config('gmail'), 'code', 'v'.repeat(43), denied.deps), errorCode('authorization'));
  const unverified = fixture([tokenResponse('gmail'), {sub: '123', email: 'reader@example.com', email_verified: false}]);
  await assert.rejects(exchangeCode(config('gmail'), 'code', 'v'.repeat(43), unverified.deps), errorCode('authorization'));
});

test('Microsoft refresh rotates credentials, checks granted scope and rejects changed identity', async () => {
  const {deps, requests} = fixture([{...tokenResponse('outlook'), refresh_token: 'fixture-rotated-refresh'}, {id: 'account-123', mail: 'reader@example.com'}]);
  const result = await refreshGrant(config('outlook'), grant('outlook'), deps);
  assert.equal(result.refreshToken, 'fixture-rotated-refresh');
  assert.equal(new URLSearchParams(requests[0].init.body).get('grant_type'), 'refresh_token');
  assert.equal(requests[1].url.searchParams.get('$select'), 'id,displayName,mail,userPrincipalName');
  const changed = fixture([tokenResponse('outlook'), {id: 'someone-else', mail: 'other@example.com'}]);
  await assert.rejects(refreshGrant(config('outlook'), grant('outlook'), changed.deps), errorCode('authorization'));
  const reduced = fixture([{...tokenResponse('outlook'), scope: 'User.Read'}]);
  await assert.rejects(refreshGrant(config('outlook'), grant('outlook'), reduced.deps), errorCode('scope-denied'));
});

test('Google refresh preserves an omitted refresh token and rechecks account identity', async () => {
  const body = tokenResponse('gmail'); delete body.refresh_token;
  const {deps} = fixture([body, {sub: 'account-123', email: 'reader@example.com', email_verified: true}]);
  const result = await refreshGrant(config('gmail'), grant('gmail'), deps);
  assert.equal(result.refreshToken, REFRESH);
});

test('Instagram exchanges current data wrapper, required permissions and long-lived token', async () => {
  const {deps, requests} = fixture([{data: [{access_token: 'fixture-short-token', user_id: '1234', permissions: SCOPES.instagram.join(',')}]}, {access_token: TOKEN, token_type: 'bearer', expires_in: 5_184_000}, {data: [{id: '1234', user_id: '9876', username: 'example_creator', account_type: 'Business'}]}]);
  const result = await exchangeCode(config('instagram'), 'code', 'v'.repeat(43), deps);
  assert.equal(result.accountLabel, 'example_creator'); assert.equal(result.accountId, '9876'); assert.equal(result.refreshToken, null);
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[1].url.origin + requests[1].url.pathname, 'https://graph.instagram.com/access_token');
  assert.equal(requests[1].url.searchParams.get('grant_type'), 'ig_exchange_token');
  assert.equal(requests[2].url.pathname, '/v27.0/me');
});

test('Instagram refresh is near expiry only and cannot refresh expired authorization', async () => {
  const early = fixture([]);
  await refreshGrant(config('instagram'), grant('instagram', {expiresAt: '2027-01-18T12:00:00.000Z'}), early.deps);
  assert.equal(early.requests.length, 0);
  const near = fixture([{access_token: TOKEN, token_type: 'bearer', expires_in: 5_184_000}, {id: '9999', user_id: '1234', username: 'example_creator', account_type: 'Media_Creator'}]);
  await refreshGrant(config('instagram'), grant('instagram', {expiresAt: '2026-11-22T12:00:00.000Z'}), near.deps);
  assert.equal(near.requests[0].url.searchParams.get('grant_type'), 'ig_refresh_token');
  await assert.rejects(refreshGrant(config('instagram'), grant('instagram', {expiresAt: '2026-11-19T12:00:00.000Z'}), early.deps), errorCode('reauthorization-required'));
});

test('Facebook user authorization yields separately scoped managed Page tokens and fails truncated discovery', async () => {
  const responses = [{access_token: 'fixture-short-token'}, {access_token: TOKEN, token_type: 'bearer', expires_in: 5_184_000}, {id: '1234', name: 'Page owner'}, {data: SCOPES['facebook-pages'].map(permission => ({permission, status: 'granted'}))}, {data: [{id: '5678', name: 'Owned page', access_token: 'fixture-page-token'}]}];
  const {deps, requests} = fixture(responses);
  const result = await exchangeCode(config('facebook-pages'), 'code', 'v'.repeat(43), deps);
  assert.equal(result.resources.length, 1); assert.equal(result.resources[0].accessToken, 'fixture-page-token');
  assert.equal(requests[4].url.pathname, '/v27.0/1234/accounts');
  const truncated = fixture([...responses.slice(0, 4), {...responses[4], paging: {next: 'https://graph.facebook.com/v27.0/1234/accounts?after=next'}}]);
  await assert.rejects(exchangeCode(config('facebook-pages'), 'code', 'v'.repeat(43), truncated.deps), errorCode('configuration'));
});

test('revocation reports only acknowledged success and never uses tenant-wide Microsoft revoke', async () => {
  const google = fixture([new Response('', {status: 200})]);
  assert.equal(await revokeGrant(config('gmail'), grant('gmail'), google.deps), 'revoked');
  assert.equal(new URLSearchParams(google.requests[0].init.body).get('token'), REFRESH);
  const meta = fixture([{success: true}]);
  assert.equal(await revokeGrant(config('facebook-pages'), grant('facebook-pages'), meta.deps), 'revoked');
  assert.equal(meta.requests[0].url.pathname, '/v27.0/1234/permissions'); assert.equal(meta.requests[0].init.method, 'DELETE');
  for (const provider of ['instagram', 'outlook']) {
    const manual = fixture([]);
    assert.equal(await revokeGrant(config(provider), grant(provider), manual.deps), 'manual-required'); assert.equal(manual.requests.length, 0);
  }
  const failed = fixture([new Error(`upstream leaked ${TOKEN}`)]);
  assert.equal(await revokeGrant(config('gmail'), grant('gmail'), failed.deps), 'manual-required');
});

test('Gmail delegates metadata-only sync and surfaces revoked grants instead of empty success', async () => {
  const empty = fixture([{messages: [], resultSizeEstimate: 0}]);
  const result = await syncProvider(config('gmail'), grant('gmail'), CONTEXT, empty.deps);
  assert.equal(result.state, 'available'); assert.equal(result.events.length, 0);
  assert.equal(empty.requests[0].url.searchParams.get('labelIds'), 'INBOX'); assert.equal(empty.requests[0].url.searchParams.get('q'), null);
  const revoked = fixture([response({error: TOKEN}, 401)]);
  await assert.rejects(syncProvider(config('gmail'), grant('gmail'), CONTEXT, revoked.deps), errorCode('authorization'));
});

test('Outlook sync requests only basic metadata and preserves source time and sender provenance', async () => {
  const {deps, requests} = fixture([{value: [email(), email('old', {receivedDateTime: '2026-11-18T12:00:00Z'})]}]);
  const result = await syncProvider(config('outlook'), grant('outlook'), CONTEXT, deps);
  assert.equal(result.state, 'available'); assert.equal(result.events.length, 1);
  assert.equal(result.events[0].actor.provenance, 'sender-header'); assert.equal(result.events[0].occurredAt, '2026-11-20T11:30:00.000Z');
  assert.equal(result.events[0].visibility, 'private'); assert.equal(result.events[0].excerpt, null);
  assert.equal(result.events[0].sourceUrlOrigin, 'provider-supplied');
  assert.doesNotMatch(requests[0].url.searchParams.get('$select'), /body|preview|attachments/u);
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test('Outlook refuses attacker pagination and never sends its token to another host', async () => {
  const {deps, requests} = fixture([{value: [], '@odata.nextLink': 'https://evil.example/v1.0/me/mailFolders/inbox/messages'}]);
  await assert.rejects(syncProvider(config('outlook'), grant('outlook'), CONTEXT, deps), errorCode('invalid-response'));
  assert.equal(requests.length, 1);
});

test('Outlook pagination errors after real events are partial; authorization errors still require reconnect', async () => {
  const first = url => { const next = new URL(url); next.searchParams.set('$skip', '25'); return response({value: [email()], '@odata.nextLink': next.href}); };
  const partial = fixture([first, response({error: {code: 'ErrorTimeout', message: TOKEN}}, 503)]);
  const result = await syncProvider(config('outlook'), grant('outlook'), CONTEXT, partial.deps);
  assert.equal(result.state, 'partial'); assert.equal(result.events.length, 1);
  const revoked = fixture([first, response({error: TOKEN}, 401)]);
  await assert.rejects(syncProvider(config('outlook'), grant('outlook'), CONTEXT, revoked.deps), errorCode('authorization'));
});

test('Instagram comments stay explicitly partial and never invent named views or shares', async () => {
  const {deps, requests} = fixture([{data: [{id: '99', permalink: 'https://www.instagram.com/p/Abc123/'}]}, {data: [{id: '100', timestamp: '2026-11-20T11:00:00+0000', text: 'A comment\nwith a second line', from: {id: '200', username: 'actual_author'}}]}]);
  const result = await syncProvider(config('instagram'), grant('instagram'), CONTEXT, deps);
  assert.equal(result.state, 'partial'); assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, 'comment.received'); assert.equal(result.events[0].actor.providerActorId, '200');
  assert.equal(result.events[0].title, 'A comment with a second line'); assert.deepEqual(result.events[0].metrics, []);
  assert.equal(requests[0].url.pathname, '/v27.0/1234/media'); assert.equal(requests[1].url.pathname, '/v27.0/99/comments');
  assert.ok(requests.every(item => item.init.method === 'GET' && item.init.headers.Authorization === `Bearer ${TOKEN}`));
});

test('Facebook comment reads use the Page token and reject posts outside that managed Page', async () => {
  const configured = grant('facebook-pages', {resources: [{id: '5678', label: 'Owned page', accessToken: 'fixture-page-token'}]});
  const {deps, requests} = fixture([{data: [{id: '5678_99', permalink_url: 'https://www.facebook.com/5678/posts/99/'}]}, {data: [{id: '99_100', created_time: '2026-11-20T11:00:00+0000', message: 'Real comment'}]}]);
  const result = await syncProvider(config('facebook-pages'), configured, CONTEXT, deps);
  assert.equal(result.state, 'partial'); assert.equal(result.events[0].actor, null);
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer fixture-page-token'));
  const mismatch = fixture([{data: [{id: '7777_99', permalink_url: 'https://www.facebook.com/7777/posts/99/'}]}]);
  await assert.rejects(syncProvider(config('facebook-pages'), configured, CONTEXT, mismatch.deps), errorCode('invalid-response'));
});

test('transport rejects oversized and redirected responses and sanitizes network exceptions', async () => {
  const oversized = fixture([response(tokenResponse('gmail'), 200, {'Content-Length': '999999'})]);
  await assert.rejects(exchangeCode(config('gmail'), 'code', 'v'.repeat(43), oversized.deps), errorCode('invalid-response'));
  const redirected = fixture([new Response(null, {status: 302, headers: {Location: `https://evil.example/${TOKEN}`}})]);
  await assert.rejects(exchangeCode(config('gmail'), 'code', 'v'.repeat(43), redirected.deps), errorCode('invalid-response'));
  const network = fixture([new Error(`Provider failure ${TOKEN}`)]);
  await assert.rejects(exchangeCode(config('gmail'), 'code', 'v'.repeat(43), network.deps), errorCode('network'));
});

test('invalid owner and expired grants cause no provider request', async () => {
  const {deps, requests} = fixture([]);
  await assert.rejects(syncProvider(config('outlook'), grant('outlook'), {...CONTEXT, ownerId: 'wrong'}, deps), errorCode('configuration'));
  await assert.rejects(syncProvider(config('outlook'), grant('outlook', {expiresAt: '2026-11-19T12:00:00.000Z'}), CONTEXT, deps), errorCode('reauthorization-required'));
  await assert.rejects(refreshGrant(config('facebook-pages'), grant('facebook-pages', {expiresAt: '2026-11-19T12:00:00.000Z'}), deps), errorCode('reauthorization-required'));
  assert.equal(requests.length, 0);
});


test('Microsoft authorization and code exchange use the same queryless redirect URI', async () => {
  const cfg = config('outlook');
  const url = new URL(authorizationUrl(cfg, 's'.repeat(43), 'c'.repeat(43)));
  assert.equal(url.searchParams.get('redirect_uri'), 'https://info.example.com/api/connections');
  for (const suffix of ['?provider=outlook', '?', '?provider=gmail', '#fragment']) {
    assert.throws(() => authorizationUrl({...cfg, redirectUri: cfg.redirectUri + suffix}, 's'.repeat(43), 'c'.repeat(43)), errorCode('configuration'));
  }
  const f = fixture([tokenResponse('outlook'), {id: 'account-123', mail: 'reader@example.com'}]);
  await exchangeCode(cfg, 'fixture-code', 'v'.repeat(43), f.deps);
  assert.equal(new URLSearchParams(f.requests[0].init.body).get('redirect_uri'), cfg.redirectUri);
});
