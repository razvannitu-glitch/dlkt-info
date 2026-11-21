import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleAccountSession } from '../.build/api/account-session.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../.build/src/identity/contracts.js';
import { readIdentityCookies, writeIdentityCookies } from '../.build/src/identity/cookies.js';
import { readIdentitySessionTokens } from '../.build/src/identity/guards.js';

const REF = 'abcdefghijklmnopqrst';
const PROJECT_URL = `https://${REF}.supabase.co`;
const PUBLISHABLE_KEY = `sb_publishable_${'a'.repeat(32)}`;
const ACCESS_ONE = 'aaaaaaaa.bbbbbbbb.cccccccc';
const ACCESS_TWO = 'dddddddd.eeeeeeee.ffffffff';
const REFRESH_ONE = 's9u2er7kp4mq';
const REFRESH_TWO = 'n8c5t2w4r7xb';
const USER = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'person@example.test',
});

// These injected dependencies isolate the identity path. They neither perform
// provisioning nor change any deployed environment or activation flag.
const READY_ENV = Object.freeze({
  NODE_ENV: 'production',
  DLKT_INFO_SUPABASE_PROJECT_REF: REF,
  DLKT_INFO_SUPABASE_URL: PROJECT_URL,
  DLKT_INFO_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
  DLKT_INFO_DATA_FOUNDATION_READY: '1',
  DLKT_INFO_AUTH_ENABLED: '1',
  DLKT_INFO_ACCOUNT_BRIDGE_ENABLED: '1',
  DLKT_INFO_AUTH_EMAIL_READY: '1',
  DLKT_INFO_REAL_DATA_ENABLED: '0',
  DLKT_INFO_SOURCE_ACQUISITION_ENABLED: '0',
  DLKT_INFO_DELIVERY_WORKERS_ENABLED: '0',
});
const READY_PROVISIONING = Object.freeze({
  configured: true,
  schemaVerified: true,
  capabilities: Object.freeze({ auth: true, persistence: true }),
});

function providerSession(refresh = REFRESH_ONE, access = ACCESS_ONE) {
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: 3600,
    token_type: 'bearer',
    user: USER,
  };
}

function request({ method = 'GET', body, cookie } = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  stream.method = method;
  stream.url = '/api/account-session';
  stream.headers = {
    host: 'www.dlkt.ee',
    origin: 'https://www.dlkt.ee',
    'x-forwarded-proto': 'https',
    'x-dlkt-info-request': 'identity-v1',
    'content-type': 'application/json',
    ...(cookie === undefined ? {} : { cookie }),
  };
  return stream;
}

function response() {
  const headers = new Map();
  let body = '';
  return {
    value: {
      statusCode: 0,
      setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
      end(value = '') { body = String(value); },
    },
    headers,
    json: () => JSON.parse(body),
  };
}

function cookieHeader(access, refresh) {
  return [
    ...(access === null ? [] : [`${ACCESS_COOKIE}=${encodeURIComponent(access)}`]),
    `${REFRESH_COOKIE}=${encodeURIComponent(refresh)}`,
  ].join('; ');
}

function writtenCookies(res) {
  const cookies = res.headers.get('set-cookie');
  assert.ok(Array.isArray(cookies));
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) {
    assert.match(cookie, /; Path=\//u);
    assert.match(cookie, /; HttpOnly(?:;|$)/u);
    assert.match(cookie, /; Secure(?:;|$)/u);
    assert.match(cookie, /; SameSite=Lax(?:;|$)/u);
    assert.doesNotMatch(cookie, /; Domain=/iu);
  }
  return cookies;
}

function writtenCookieHeader(res) {
  return writtenCookies(res).map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

function assertPrivateResponse(res) {
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('vary'), 'Cookie, Origin');
  const body = JSON.stringify(res.json());
  for (const credential of [ACCESS_ONE, ACCESS_TWO, REFRESH_ONE, REFRESH_TWO, PUBLISHABLE_KEY]) {
    assert.equal(body.includes(credential), false);
  }
  assert.equal(Object.hasOwn(res.json(), 'access_token'), false);
  assert.equal(Object.hasOwn(res.json(), 'refresh_token'), false);
}

async function callController(req, fetchImplementation, environment = READY_ENV) {
  const res = response();
  await handleAccountSession(req, res.value, {
    environment,
    provisioning: READY_PROVISIONING,
    fetch: fetchImplementation,
  });
  return res;
}

function assertPublicKeyRequest(init) {
  const headers = new Headers(init.headers);
  assert.equal(headers.get('apikey'), PUBLISHABLE_KEY);
  assert.equal(headers.has('authorization'), false);
  assert.equal(init.cache, 'no-store');
  assert.equal(init.redirect, 'error');
}

function assertSignedOut(res) {
  assert.equal(res.value.statusCode, 200);
  assert.equal(res.json().authenticated, false);
  assert.equal(res.json().user, null);
  assert.ok(writtenCookies(res).every((cookie) => cookie.includes('Max-Age=0')));
  assertPrivateResponse(res);
}

function recordedProvider(replies) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({url: String(url), method: init.method, headers: new Headers(init.headers),
        body: init.body === undefined ? null : JSON.parse(init.body)});
      const reply = replies[calls.length - 1];
      if (!reply) throw new Error('UNEXPECTED_PROVIDER_REQUEST');
      return reply();
    },
  };
}

const LOGOUT_URL = `${PROJECT_URL}/auth/v1/logout?scope=local`;
const REFRESH_URL = `${PROJECT_URL}/auth/v1/token?grant_type=refresh_token`;
const noContent = () => new Response(null, {status: 204});

test('sign-out revokes the current provider session without logging out other devices', async () => {
  const provider = recordedProvider([noContent]);
  const res = await callController(request({method: 'DELETE', cookie: cookieHeader(ACCESS_ONE, REFRESH_ONE)}), provider.fetch);
  assert.deepEqual(provider.calls.map(call => call.url), [LOGOUT_URL]);
  assert.equal(provider.calls[0].method, 'POST');
  assert.equal(provider.calls[0].headers.get('authorization'), `Bearer ${ACCESS_ONE}`);
  assert.equal(provider.calls[0].headers.get('apikey'), PUBLISHABLE_KEY);
  assertSignedOut(res);
});

test('sign-out revokes a refresh-only session before clearing both cookies', async () => {
  const provider = recordedProvider([() => Response.json(providerSession(REFRESH_TWO, ACCESS_TWO)), noContent]);
  const res = await callController(request({method: 'DELETE', cookie: cookieHeader(null, REFRESH_ONE)}), provider.fetch);
  assert.deepEqual(provider.calls.map(call => call.url), [REFRESH_URL, LOGOUT_URL]);
  assert.deepEqual(provider.calls[0].body, {refresh_token: REFRESH_ONE});
  assert.equal(provider.calls[0].headers.has('authorization'), false);
  assert.equal(provider.calls[1].headers.get('authorization'), `Bearer ${ACCESS_TWO}`);
  assertSignedOut(res);
});

test('sign-out refreshes an expired access token once and revokes only the renewed current session', async () => {
  const provider = recordedProvider([
    () => Response.json({message: 'expired'}, {status: 401}),
    () => Response.json(providerSession(REFRESH_TWO, ACCESS_TWO)),
    noContent,
  ]);
  const res = await callController(request({method: 'DELETE', cookie: cookieHeader(ACCESS_ONE, REFRESH_ONE)}), provider.fetch);
  assert.deepEqual(provider.calls.map(call => call.url), [LOGOUT_URL, REFRESH_URL, LOGOUT_URL]);
  assert.deepEqual(provider.calls[1].body, {refresh_token: REFRESH_ONE});
  assert.equal(provider.calls[2].headers.get('authorization'), `Bearer ${ACCESS_TWO}`);
  assertSignedOut(res);
});

test('sign-out stays local on provider outage and never retries an uncertain revocation', async () => {
  for (const reply of [
    () => Response.json({message: 'unavailable'}, {status: 503}),
    () => { throw new Error('NETWORK_UNAVAILABLE'); },
  ]) {
    const provider = recordedProvider([reply]);
    const res = await callController(request({method: 'DELETE', cookie: cookieHeader(ACCESS_ONE, REFRESH_ONE)}), provider.fetch);
    assert.deepEqual(provider.calls.map(call => call.url), [LOGOUT_URL]);
    assertSignedOut(res);
  }
});

test('sign-out clears a rejected or malformed refresh-only session without further provider calls', async () => {
  for (const reply of [
    () => Response.json({message: 'invalid refresh token'}, {status: 400}),
    () => Response.json({message: 'unavailable'}, {status: 503}),
    () => Response.json(providerSession('invalid', ACCESS_TWO)),
  ]) {
    const provider = recordedProvider([reply]);
    const res = await callController(request({method: 'DELETE', cookie: cookieHeader(null, REFRESH_ONE)}), provider.fetch);
    assert.deepEqual(provider.calls.map(call => call.url), [REFRESH_URL]);
    assertSignedOut(res);
  }
});

test('a failed revocation after refresh never restores cookies or loops', async () => {
  const provider = recordedProvider([
    () => Response.json(providerSession(REFRESH_TWO, ACCESS_TWO)),
    () => Response.json({message: 'unavailable'}, {status: 503}),
  ]);
  const res = await callController(request({method: 'DELETE', cookie: cookieHeader(null, REFRESH_ONE)}), provider.fetch);
  assert.deepEqual(provider.calls.map(call => call.url), [REFRESH_URL, LOGOUT_URL]);
  assertSignedOut(res);
});

test('missing and invalid cookies cannot trigger provider logout or refresh', async () => {
  for (const cookie of [undefined, cookieHeader(null, 'invalid')]) {
    const provider = recordedProvider([]);
    const res = await callController(request({method: 'DELETE', cookie}), provider.fetch);
    assert.deepEqual(provider.calls, []);
    assertSignedOut(res);
  }
});

test('disabled email activation clears local cookies without contacting the provider', async () => {
  const provider = recordedProvider([]);
  const res = await callController(request({method: 'DELETE', cookie: cookieHeader(null, REFRESH_ONE)}), provider.fetch,
    {...READY_ENV, DLKT_INFO_AUTH_EMAIL_READY: '0'});
  assert.equal(res.json().enabled, false);
  assert.deepEqual(provider.calls, []);
  assertSignedOut(res);
});

test('sign-out shares one eight-second deadline across revocation and refresh', async (context) => {
  context.mock.timers.enable({apis: ['setTimeout']});
  let firstStarted;
  let refreshStarted;
  const first = new Promise(resolve => { firstStarted = resolve; });
  const second = new Promise(resolve => { refreshStarted = resolve; });
  const calls = [];
  const pending = callController(request({method: 'DELETE', cookie: cookieHeader(ACCESS_ONE, REFRESH_ONE)}),
    (url, init) => {
      calls.push(String(url));
      if (calls.length === 1) {
        firstStarted();
        return new Promise(resolve => {
          setTimeout(() => resolve(Response.json({message: 'expired'}, {status: 401})), 4_000);
        });
      }
      refreshStarted();
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('ABORTED')), {once: true});
        // Each request would fit its own eight-second timeout, but their
        // combined duration must not prolong the browser's sign-out request.
        setTimeout(() => resolve(Response.json(providerSession(REFRESH_TWO, ACCESS_TWO))), 6_000);
      });
    });
  await first;
  context.mock.timers.tick(4_000);
  await second;
  context.mock.timers.tick(4_000);
  const res = await pending;
  assert.deepEqual(calls, [LOGOUT_URL, REFRESH_URL]);
  assertSignedOut(res);
});

test('12-character provider token is parsed and survives secure cookie write/read', () => {
  const tokens = readIdentitySessionTokens(providerSession());
  assert.equal(tokens.refreshToken, REFRESH_ONE);
  assert.deepEqual(tokens.user, USER);
  const res = response();
  writeIdentityCookies(res.value, tokens);
  assert.deepEqual(readIdentityCookies(writtenCookieHeader(res)), {
    accessToken: ACCESS_ONE,
    refreshToken: REFRESH_ONE,
  });
});

test('previous longer formats and the safe alphabet still survive provider and cookie boundaries', () => {
  for (const refresh of ['refresh_token_value_00000001', 'Ab12._~-Cd34', 'x'.repeat(4096)]) {
    const tokens = readIdentitySessionTokens(providerSession(refresh));
    const res = response();
    writeIdentityCookies(res.value, tokens);
    assert.equal(readIdentityCookies(writtenCookieHeader(res)).refreshToken, refresh);
  }
});

const INVALID_TOKEN_CASES = Object.freeze([
  ['empty', ''],
  ['eleven characters', 'a'.repeat(11)],
  ['leading space', ` ${REFRESH_ONE}`],
  ['trailing space', `${REFRESH_ONE} `],
  ['embedded space', `S9u2e R7kP4mQ`],
  ['tab', `${REFRESH_ONE}\t`],
  ['NUL', `${REFRESH_ONE}\u0000`],
  ['CRLF', `${REFRESH_ONE}\r\n`],
  ['DEL', `${REFRESH_ONE}\u007f`],
  ['semicolon', `${REFRESH_ONE};session=other`],
  ['equals sign', `${REFRESH_ONE}=other`],
  ['comma', `${REFRESH_ONE},other`],
  ['double quote', `${REFRESH_ONE}"`],
  ['backslash', `${REFRESH_ONE}\\`],
  ['non-ASCII', `${REFRESH_ONE}é`],
  ['percent escape', `${REFRESH_ONE}%3B`],
  ['over maximum', 'a'.repeat(4097)],
]);

test('malformed refresh tokens are rejected by provider parsing and decoded cookie parsing', () => {
  for (const [name, refresh] of INVALID_TOKEN_CASES) {
    assert.throws(
      () => readIdentitySessionTokens(providerSession(refresh)),
      /DLKT_INFO_IDENTITY_SESSION_INVALID/u,
      name,
    );
    assert.equal(readIdentityCookies(cookieHeader(ACCESS_ONE, refresh)).refreshToken, null, name);
  }
  for (const refresh of [null, undefined, 123456789012, {}, []]) {
    assert.throws(
      () => readIdentitySessionTokens({ ...providerSession(), refresh_token: refresh }),
      /DLKT_INFO_IDENTITY_SESSION_INVALID/u,
    );
  }
});

test('published account-session verify route accepts 12-character token and the next request reads its session', async () => {
  const calls = [];
  const verified = await callController(request({
    method: 'PUT',
    body: { action: 'verify-code', email: USER.email, code: '123456' },
  }), async (url, init) => {
    calls.push(String(url));
    assert.equal(url, `${PROJECT_URL}/auth/v1/verify`);
    assert.equal(init.method, 'POST');
    assertPublicKeyRequest(init);
    assert.deepEqual(JSON.parse(init.body), { email: USER.email, token: '123456', type: 'email' });
    return Response.json(providerSession());
  });
  assert.equal(verified.value.statusCode, 200);
  assert.equal(verified.json().authenticated, true);
  assert.deepEqual(verified.json().user, USER);
  assertPrivateResponse(verified);
  const cookie = writtenCookieHeader(verified);
  assert.equal(readIdentityCookies(cookie).refreshToken, REFRESH_ONE);

  const readback = await callController(request({ cookie }), async (url, init) => {
    calls.push(String(url));
    assert.equal(url, `${PROJECT_URL}/auth/v1/user`);
    assert.equal(init.method, 'GET');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('apikey'), PUBLISHABLE_KEY);
    assert.equal(headers.get('authorization'), `Bearer ${ACCESS_ONE}`);
    return Response.json(USER);
  });
  assert.equal(readback.value.statusCode, 200);
  assert.equal(readback.json().authenticated, true);
  assert.deepEqual(readback.json().user, USER);
  assert.equal(readback.headers.has('set-cookie'), false);
  assertPrivateResponse(readback);
  assert.deepEqual(calls, [`${PROJECT_URL}/auth/v1/verify`, `${PROJECT_URL}/auth/v1/user`]);
});

test('expired access cookie refreshes with a 12-character token and rotates both secure cookies', async () => {
  const calls = [];
  const res = await callController(request({ cookie: cookieHeader(ACCESS_ONE, REFRESH_ONE) }), async (url, init) => {
    calls.push(String(url));
    if (url === `${PROJECT_URL}/auth/v1/user`) {
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${ACCESS_ONE}`);
      return Response.json({ message: 'expired' }, { status: 401 });
    }
    assert.equal(url, `${PROJECT_URL}/auth/v1/token?grant_type=refresh_token`);
    assert.equal(init.method, 'POST');
    assertPublicKeyRequest(init);
    assert.deepEqual(JSON.parse(init.body), { refresh_token: REFRESH_ONE });
    return Response.json(providerSession(REFRESH_TWO, ACCESS_TWO));
  });
  assert.equal(res.value.statusCode, 200);
  assert.equal(res.json().authenticated, true);
  assert.deepEqual(readIdentityCookies(writtenCookieHeader(res)), {
    accessToken: ACCESS_TWO,
    refreshToken: REFRESH_TWO,
  });
  assert.deepEqual(calls, [`${PROJECT_URL}/auth/v1/user`, `${PROJECT_URL}/auth/v1/token?grant_type=refresh_token`]);
  assertPrivateResponse(res);
});

test('12-character refresh cookie renews a session when the access cookie has expired from the browser', async () => {
  let calls = 0;
  const res = await callController(request({ cookie: cookieHeader(null, REFRESH_ONE) }), async (url, init) => {
    calls++;
    assert.equal(url, `${PROJECT_URL}/auth/v1/token?grant_type=refresh_token`);
    assertPublicKeyRequest(init);
    assert.deepEqual(JSON.parse(init.body), { refresh_token: REFRESH_ONE });
    return Response.json(providerSession(REFRESH_TWO, ACCESS_TWO));
  });
  assert.equal(calls, 1);
  assert.equal(res.value.statusCode, 200);
  assert.equal(res.json().authenticated, true);
  assert.equal(readIdentityCookies(writtenCookieHeader(res)).refreshToken, REFRESH_TWO);
  assertPrivateResponse(res);
});

test('malformed provider verify responses never set session cookies or authenticate', async () => {
  for (const [, refresh] of INVALID_TOKEN_CASES) {
    const calls = [];
    const res = await callController(request({
      method: 'PUT',
      body: { action: 'verify-code', email: USER.email, code: '123456' },
    }), async (url) => {
      calls.push(String(url));
      return Response.json(providerSession(refresh));
    });
    assert.deepEqual(calls, [`${PROJECT_URL}/auth/v1/verify`]);
    assert.equal(res.value.statusCode, 502);
    assert.deepEqual(res.json(), { error: 'IDENTITY_PROVIDER_UNAVAILABLE' });
    assert.equal(res.headers.has('set-cookie'), false);
    assertPrivateResponse(res);
  }
});

test('malformed provider refresh response never replaces an existing cookie with invalid credentials', async () => {
  const calls = [];
  const res = await callController(request({ cookie: cookieHeader(null, REFRESH_ONE) }), async (url) => {
    calls.push(String(url));
    return Response.json(providerSession('a'.repeat(11), ACCESS_TWO));
  });
  assert.deepEqual(calls, [`${PROJECT_URL}/auth/v1/token?grant_type=refresh_token`]);
  assert.equal(res.value.statusCode, 502);
  assert.deepEqual(res.json(), { error: 'IDENTITY_PROVIDER_UNAVAILABLE' });
  assert.equal(res.headers.has('set-cookie'), false);
  assertPrivateResponse(res);
});

test('invalid inbound refresh cookies cannot reach the provider after access expiry', async () => {
  for (const [, refresh] of INVALID_TOKEN_CASES) {
    const calls = [];
    const res = await callController(request({ cookie: cookieHeader(ACCESS_ONE, refresh) }), async (url) => {
      calls.push(String(url));
      assert.equal(url, `${PROJECT_URL}/auth/v1/user`);
      return Response.json({ message: 'expired' }, { status: 401 });
    });
    assert.deepEqual(calls, [`${PROJECT_URL}/auth/v1/user`]);
    assert.equal(res.value.statusCode, 200);
    assert.equal(res.json().authenticated, false);
    assert.equal(res.json().user, null);
    assert.ok(writtenCookies(res).every((cookie) => cookie.includes('Max-Age=0')));
    assertPrivateResponse(res);
  }
});

test('a revoked 12-character refresh token clears the local session without retrying', async () => {
  let calls = 0;
  const res = await callController(request({ cookie: cookieHeader(null, REFRESH_ONE) }), async (url, init) => {
    calls++;
    assert.equal(url, `${PROJECT_URL}/auth/v1/token?grant_type=refresh_token`);
    assert.deepEqual(JSON.parse(init.body), { refresh_token: REFRESH_ONE });
    return Response.json({ message: 'invalid refresh token' }, { status: 400 });
  });
  assert.equal(calls, 1);
  assert.equal(res.value.statusCode, 200);
  assert.equal(res.json().authenticated, false);
  assert.equal(res.json().user, null);
  assert.ok(writtenCookies(res).every((cookie) => cookie.includes('Max-Age=0')));
  assertPrivateResponse(res);
});

test('inactive account or email gate prevents verify and refresh even with valid short-token cookies', async () => {
  for (const flag of ['DLKT_INFO_ACCOUNT_BRIDGE_ENABLED', 'DLKT_INFO_AUTH_EMAIL_READY']) {
    const environment = { ...READY_ENV, [flag]: '0' };
    for (const method of ['GET', 'PUT']) {
      let calls = 0;
      const res = await callController(request({
        method,
        cookie: cookieHeader(null, REFRESH_ONE),
        ...(method === 'PUT' ? { body: { action: 'verify-code', email: USER.email, code: '123456' } } : {}),
      }), async () => {
        calls++;
        throw new Error('inactive identity must not call a provider');
      }, environment);
      assert.equal(calls, 0);
      assert.equal(res.value.statusCode, method === 'GET' ? 200 : 503);
      assert.equal(res.json().enabled, false);
      assert.equal(res.json().authenticated, false);
      assert.equal(res.headers.has('set-cookie'), false);
      assertPrivateResponse(res);
    }
  }
});
