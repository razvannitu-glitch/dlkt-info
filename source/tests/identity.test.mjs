import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

const REF = 'abcdefghijklmnopqrst';
const URL = `https://${REF}.supabase.co`;
const KEY = `sb_publishable_${'a'.repeat(32)}`;
const ACCESS_ONE = 'aaaaaaaa.bbbbbbbb.cccccccc';
const ACCESS_TWO = 'dddddddd.eeeeeeee.ffffffff';
const REFRESH_ONE = 'refresh_token_value_00000001';
const REFRESH_TWO = 'refresh_token_value_00000002';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const USER = Object.freeze({ id: USER_ID, email: 'person@example.com' });
const READY_ENV = Object.freeze({
  DLKT_INFO_SUPABASE_PROJECT_REF: REF,
  DLKT_INFO_SUPABASE_URL: URL,
  DLKT_INFO_SUPABASE_PUBLISHABLE_KEY: KEY,
  DLKT_INFO_DATA_FOUNDATION_READY: '1',
  DLKT_INFO_AUTH_ENABLED: '1',
  DLKT_INFO_REAL_DATA_ENABLED: '0',
  DLKT_INFO_SOURCE_ACQUISITION_ENABLED: '0',
  DLKT_INFO_DELIVERY_WORKERS_ENABLED: '0',
  DLKT_INFO_DATABASE_INSTANCE_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
});
const READY_PROVISIONING = Object.freeze({
  version: 'dlkt-info-provisioning-control-2',
  configuration: 'ready',
  configured: true,
  instanceBound: true,
  identityState: 'verified',
  identityVerified: true,
  readinessState: 'verified',
  schemaVerified: true,
  schemaFingerprint: 'fc6df8a25190ef8c4b4f906873a3015b7aa805e21ce1a44f9117b8eefeed3b91',
  activationReceipt: 'a'.repeat(64),
  capabilities: Object.freeze({
    identity: true,
    foundation: true,
    auth: true,
    persistence: true,
    realData: false,
    sourceAcquisition: false,
    deliveryWorkers: false,
  }),
  blocker: null,
  failClosed: true,
  environmentFlagsAreInsufficient: true,
  secretsExposed: false,
});


function request({
  method = 'GET',
  body = null,
  origin = 'https://preview.example',
  host = 'preview.example',
  marker = 'identity-v1',
  contentType = 'application/json',
  cookie,
  fetchSite = 'same-origin',
  fetchMode = 'cors',
  fetchDest = 'empty',
} = {}) {
  const stream = Readable.from(body === null ? [] : [JSON.stringify(body)]);
  stream.method = method;
  stream.headers = {
    ...(origin === null ? {} : { origin }),
    host,
    'x-forwarded-host': host,
    'x-forwarded-proto': 'https',
    'x-dlkt-info-request': marker,
    'content-type': contentType,
    'sec-fetch-site': fetchSite,
    'sec-fetch-mode': fetchMode,
    'sec-fetch-dest': fetchDest,
    ...(cookie ? { cookie } : {}),
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

function session(access = ACCESS_ONE, refresh = REFRESH_ONE) {
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: 3600,
    token_type: 'bearer',
    user: USER,
  };
}

const json = (value, status = 200) => Response.json(value, { status });

test('identity status is explicit and harmless before the dedicated project exists', async () => {
  const { handleIdentityRequest } = await import('../.build/api/auth.js');
  let calls = 0;
  const res = response();
  await handleIdentityRequest(request(), res.value, {
    environment: {},
    fetch: async () => { calls++; throw new Error('must not call'); },
  });
  assert.equal(res.value.statusCode, 200);
  assert.deepEqual(res.json(), {
    version: 'dlkt-info-identity-1',
    configured: false,
    enabled: false,
    authenticated: false,
    blocker: 'DEDICATED_SUPABASE_PROJECT_REQUIRED',
    user: null,
  });
  assert.equal(calls, 0);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
});

test('request-code normalizes input and sends only bounded public metadata', async () => {
  const { handleIdentityRequest } = await import('../.build/api/auth.js');
  const calls = [];
  const res = response();
  await handleIdentityRequest(request({
    method: 'POST',
    body: { action: 'request-code', email: ' Person@Example.COM ', timezone: 'Europe/Bucharest', locale: 'en' },
  }), res.value, {
    environment: READY_ENV,
    provisioning: READY_PROVISIONING,
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(String(init.body)) });
      return json({});
    },
  });
  assert.equal(res.value.statusCode, 202);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${URL}/auth/v1/otp?redirect_to=${encodeURIComponent('https://www.dlkt.ee/account?lang=en')}`);
  assert.equal(calls[0].init.headers.apikey, KEY);
  assert.deepEqual(calls[0].body, {
    email: 'person@example.com',
    create_user: true,
    data: { locale: 'en', timezone: 'Europe/Bucharest' },
  });
  assert.equal(Object.hasOwn(res.json(), 'email'), false);
  assert.equal(JSON.stringify(res.json()).includes('person@example.com'), false);
});

test('verify-code creates secure HttpOnly session cookies without returning tokens', async () => {
  const { handleIdentityRequest } = await import('../.build/api/auth.js');
  const res = response();
  await handleIdentityRequest(request({
    method: 'PUT',
    body: { action: 'verify-code', email: 'person@example.com', code: '123 456' },
  }), res.value, {
    environment: READY_ENV,
    provisioning: READY_PROVISIONING,
    fetch: async (url, init) => {
      assert.equal(url, `${URL}/auth/v1/verify`);
      assert.deepEqual(JSON.parse(String(init.body)), { email: 'person@example.com', token: '123456', type: 'email' });
      return json(session());
    },
  });
  assert.equal(res.value.statusCode, 200);
  assert.deepEqual(res.json().user, USER);
  assert.equal(Object.hasOwn(res.json(), 'access_token'), false);
  const cookies = res.headers.get('set-cookie');
  assert.ok(Array.isArray(cookies));
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /^__Host-dlkt_info_at=/u);
  assert.match(cookies[1], /^__Host-dlkt_info_rt=/u);
  for (const cookie of cookies) {
    assert.match(cookie, /Path=\//u);
    assert.match(cookie, /HttpOnly/u);
    assert.match(cookie, /Secure/u);
    assert.match(cookie, /SameSite=Lax/u);
    assert.doesNotMatch(cookie, /Domain=/u);
  }
});

test('session status validates access cookies and never reflects raw credentials', async () => {
  const { handleIdentityRequest } = await import('../.build/api/auth.js');
  const res = response();
  await handleIdentityRequest(request({ cookie: `__Host-dlkt_info_at=${ACCESS_ONE}; __Host-dlkt_info_rt=${REFRESH_ONE}` }), res.value, {
    environment: READY_ENV,
    provisioning: READY_PROVISIONING,
    fetch: async (url, init) => {
      assert.equal(url, `${URL}/auth/v1/user`);
      assert.equal(init.headers.Authorization, `Bearer ${ACCESS_ONE}`);
      return json(USER);
    },
  });
  assert.equal(res.value.statusCode, 200);
  assert.equal(res.json().authenticated, true);
  assert.deepEqual(res.json().user, USER);
  assert.equal(JSON.stringify(res.json()).includes(ACCESS_ONE), false);
  assert.equal(res.headers.has('set-cookie'), false);
});

test('expired access session refreshes once and rotates both cookies', async () => {
  const { handleIdentityRequest } = await import('../.build/api/auth.js');
  const calls = [];
  const res = response();
  await handleIdentityRequest(request({ cookie: `__Host-dlkt_info_at=${ACCESS_ONE}; __Host-dlkt_info_rt=${REFRESH_ONE}` }), res.value, {
    environment: READY_ENV,
    provisioning: READY_PROVISIONING,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return json({ message: 'expired' }, 401);
      assert.equal(url, `${URL}/auth/v1/token?grant_type=refresh_token`);
      assert.deepEqual(JSON.parse(String(init.body)), { refresh_token: REFRESH_ONE });
      return json(session(ACCESS_TWO, REFRESH_TWO));
    },
  });
  assert.equal(res.value.statusCode, 200);
  assert.equal(res.json().authenticated, true);
  assert.equal(calls.length, 2);
  const cookies = res.headers.get('set-cookie');
  assert.ok(Array.isArray(cookies));
  assert.match(cookies[0], new RegExp(ACCESS_TWO.replaceAll('.', '\\.')));
  assert.match(cookies[1], new RegExp(REFRESH_TWO));
});

test('logout clears local session even when provider logout is unavailable', async () => {
  const { handleIdentityRequest } = await import('../.build/api/auth.js');
  const res = response();
  await handleIdentityRequest(request({
    method: 'DELETE',
    cookie: `__Host-dlkt_info_at=${ACCESS_ONE}; __Host-dlkt_info_rt=${REFRESH_ONE}`,
  }), res.value, {
    environment: READY_ENV,
    provisioning: READY_PROVISIONING,
    fetch: async () => { throw new Error('provider unavailable'); },
  });
  assert.equal(res.value.statusCode, 200);
  assert.equal(res.json().authenticated, false);
  const cookies = res.headers.get('set-cookie');
  assert.ok(Array.isArray(cookies));
  assert.ok(cookies.every((cookie) => cookie.includes('Max-Age=0')));
});

test('identity boundary rejects foreign origins, missing markers and malformed credentials', async () => {
  const { handleIdentityRequest } = await import('../.build/api/auth.js');
  const cases = [
    [request({ origin: 'https://attacker.example' }), 403],
    [request({ marker: '' }), 403],
    [request({ method: 'POST', body: { action: 'request-code', email: 'bad', timezone: 'UTC', locale: 'en' } }), 400],
    [request({ method: 'PUT', body: { action: 'verify-code', email: 'person@example.com', code: '12' } }), 400],
    [request({ method: 'POST', body: { action: 'request-code', email: 'person@example.com', timezone: 'UTC', locale: 'en' }, contentType: 'text/plain' }), 415],
  ];
  for (const [req, expected] of cases) {
    const res = response();
    await handleIdentityRequest(req, res.value, { environment: READY_ENV, provisioning: READY_PROVISIONING, fetch: async () => json({}) });
    assert.equal(res.value.statusCode, expected);
  }
});

test('malformed provider session and provider throttling fail closed', async () => {
  const { handleIdentityRequest } = await import('../.build/api/auth.js');
  const malformed = response();
  await handleIdentityRequest(request({
    method: 'PUT',
    body: { action: 'verify-code', email: 'person@example.com', code: '123456' },
  }), malformed.value, { environment: READY_ENV, provisioning: READY_PROVISIONING, fetch: async () => json({ access_token: ACCESS_ONE }) });
  assert.equal(malformed.value.statusCode, 502);
  assert.deepEqual(malformed.json(), { error: 'IDENTITY_PROVIDER_UNAVAILABLE' });

  const throttled = response();
  await handleIdentityRequest(request({
    method: 'POST',
    body: { action: 'request-code', email: 'person@example.com', timezone: 'UTC', locale: 'en' },
  }), throttled.value, { environment: READY_ENV, provisioning: READY_PROVISIONING, fetch: async () => json({ message: 'slow down' }, 429) });
  assert.equal(throttled.value.statusCode, 429);
  assert.deepEqual(throttled.json(), { error: 'IDENTITY_RATE_LIMITED' });
});

test('authentication email redirects cover the full locale catalog on one fixed destination',async()=>{
 const {LOCALES}=await import('../.build/src/i18n/locale.js');
 const {authenticationEmailRedirect}=await import('../.build/src/identity/email-locale.js');
 const codes=new Set(LOCALES.map(({code})=>code));assert.equal(codes.size,30);
 const regional=[['en-GB','en'],['ro-RO','ro'],['fr-CA','fr'],['es-MX','es'],['pt-BR','pt'],['de-AT','de'],['it-CH','it'],['nl-BE','nl'],['pl-PL','pl'],['tr-TR','tr'],['ru-RU','ru'],['uk-UA','uk'],['ar-MA','ar'],['he-IL','he'],['fa-IR','fa'],['ur-PK','ur'],['hi-IN','hi'],['bn-BD','bn'],['zh-Hans-CN','zh-Hans'],['zh-Hant-TW','zh-Hant'],['ja-JP','ja'],['ko-KR','ko'],['id-ID','id'],['ms-MY','ms'],['vi-VN','vi'],['th-TH','th'],['sw-KE','sw'],['ta-LK','ta'],['te-IN','te'],['fil-PH','fil']];
 assert.deepEqual(new Set(regional.map(([,expected])=>expected)),codes);
 const cases=[...LOCALES.map(({code})=>[code,code]),...regional,['zh','zh-Hans'],['zh-CN','zh-Hans'],['zh-SG','zh-Hans'],['zh-TW','zh-Hant'],['zh-HK','zh-Hant'],['zh-MO','zh-Hant'],['iw-IL','he'],['in-ID','id'],['tl-PH','fil'],['UR','ur'],['RO-ro','ro'],['EN-gb','en'],['de-DE-u-ca-gregory','de'],['sr-Latn-RS','en'],['','en'],[' ro ','en'],['not_a_locale','en']];
 for(const [input,expected]of cases)assert.equal(authenticationEmailRedirect(input),'https://www.dlkt.ee/account?lang='+expected,input);
 for(const input of ['https://attacker.example/account?lang=ro','//attacker.example','ro&redirect_to=https://attacker.example','ro%26lang%3Den','ro\r\nX-Test: injected','en#https://attacker.example']){
  const destination=new globalThis.URL(authenticationEmailRedirect(input));
  assert.equal(destination.origin,'https://www.dlkt.ee',input);assert.equal(destination.pathname,'/account',input);
  assert.equal(destination.username,'',input);assert.equal(destination.password,'',input);assert.equal(destination.hash,'',input);
  assert.deepEqual([...destination.searchParams.keys()],['lang'],input);assert.ok(codes.has(destination.searchParams.get('lang')),input);
 }
});
test('request-code transports the current canonical locale without changing the OTP payload',async()=>{
 const {handleIdentityRequest}=await import('../.build/api/auth.js');
 const {LOCALES}=await import('../.build/src/i18n/locale.js');
 for(const {code}of LOCALES){
  const calls=[],res=response();
  await handleIdentityRequest(request({method:'POST',body:{action:'request-code',email:'person@example.com',timezone:'Europe/Bucharest',locale:code}}),res.value,{
   environment:READY_ENV,provisioning:READY_PROVISIONING,
   fetch:async(url,init)=>{calls.push({url,init,body:JSON.parse(String(init.body))});return json({});}
  });
  assert.equal(res.value.statusCode,202,code);assert.equal(calls.length,1,code);
  const expectedDestination='https://www.dlkt.ee/account?lang='+code;
  assert.equal(calls[0].url,URL+'/auth/v1/otp?redirect_to='+encodeURIComponent(expectedDestination),code);
  const outgoing=new globalThis.URL(String(calls[0].url));assert.equal(outgoing.origin,URL,code);assert.equal(outgoing.pathname,'/auth/v1/otp',code);
  assert.deepEqual([...outgoing.searchParams.keys()],['redirect_to'],code);assert.equal(outgoing.searchParams.get('redirect_to'),expectedDestination,code);
  assert.equal(calls[0].init.method,'POST',code);assert.equal(calls[0].init.redirect,'error',code);assert.equal(calls[0].init.cache,'no-store',code);
  assert.deepEqual(calls[0].body,{email:'person@example.com',create_user:true,data:{locale:code,timezone:'Europe/Bucharest'}},code);
  assert.equal(JSON.stringify(res.json()).includes('person@example.com'),false,code);
 }
});
test('malformed locale metadata uses the existing safe English fallback and cannot change the provider destination',async()=>{
 const {handleIdentityRequest}=await import('../.build/api/auth.js');
 for(const locale of ['https://attacker.example/account?lang=ro','ro&redirect_to=https://attacker.example','ro%26lang%3Den','ro\r\nX-Test: injected','zh--Hant','en-'+'x'.repeat(90),null,{}]){
  const calls=[],res=response();
  await handleIdentityRequest(request({method:'POST',body:{action:'request-code',email:'person@example.com',timezone:'UTC',locale}}),res.value,{
   environment:READY_ENV,provisioning:READY_PROVISIONING,fetch:async(url,init)=>{calls.push({url,body:JSON.parse(String(init.body))});return json({});}
  });
  assert.equal(res.value.statusCode,202,JSON.stringify(locale));assert.equal(calls.length,1);
  assert.equal(calls[0].url,URL+'/auth/v1/otp?redirect_to='+encodeURIComponent('https://www.dlkt.ee/account?lang=en'));
  assert.deepEqual(calls[0].body,{email:'person@example.com',create_user:true,data:{locale:'en',timezone:'UTC'}});
 }
});
test('identity metadata retains script and regional BCP47 variants before the allowlisted email resolution',async()=>{
 const {readIdentityLocale}=await import('../.build/src/identity/guards.js');
 for(const value of ['zh-Hans','zh-Hant','zh-Hant-TW','ro-RO','sr-Latn-RS','en-GB','de-DE-u-ca-gregory'])assert.equal(readIdentityLocale(value),value);
 const overlong='en-x-'+Array(9).fill('abcdefgh').join('-');assert.ok(overlong.length>80);
 for(const value of ['ro%26lang%3Den','zh--Hant','en-123456789','en-a','en-K',overlong,undefined,[],false])assert.equal(readIdentityLocale(value),'en');
});
