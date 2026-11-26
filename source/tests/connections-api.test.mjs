import assert from 'node:assert/strict';
import test from 'node:test';
import {Readable} from 'node:stream';
import {handleConnections} from '../.build/api/connections.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://info.dlkt.ee';
const NOW = '2026-11-20T12:00:00.000Z';
const premiumReceipt=(ownerId,sessionHash)=>({state:'premium',source:'stripe_reconciled',liveMode:true,ownerId,sessionHash,
 accountId:'acct_fixture',subscriptionId:'sub_fixture',generation:'1',fence:'1',epoch:'0',
 verifiedAt:Math.floor(Date.parse(NOW)/1000)-10,validUntil:Math.floor(Date.parse(NOW)/1000)+120});
const token = (claims = {}) => [Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url'), Buffer.from(JSON.stringify({sub: OWNER, role: 'authenticated', session_id: SESSION, ...claims})).toString('base64url'), 'fixtureSignatureNotReal0000'].join('.');
const TOKEN = token();
const environment = {NODE_ENV: 'production', DLKT_INFO_ACCOUNT_BRIDGE_ENABLED: '1', DLKT_INFO_AUTH_EMAIL_READY: '1', DLKT_INFO_AUTH_ENABLED: '1', DLKT_INFO_DATA_FOUNDATION_READY: '1',
  DLKT_INFO_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', DLKT_INFO_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', DLKT_INFO_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'x'.repeat(30),
  DLKT_INFO_CONNECTIONS_TOKEN_KEY: Buffer.alloc(32, 21).toString('base64url'), DLKT_INFO_CONNECTIONS_ORIGIN: ORIGIN,
  DLKT_INFO_GMAIL_CLIENT_ID: 'fixture-client', DLKT_INFO_GMAIL_CLIENT_SECRET: 'fixture-secret', DLKT_INFO_GMAIL_ENABLED: '1', DLKT_INFO_GMAIL_PUBLIC_READY: '1'};
const provisioning = {configured: true, schemaVerified: true, capabilities: {auth: true, persistence: true}};
const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});

function request(method = 'GET', body, {headers = {}, url = '/api/connections', raw} = {}) {
  const req = Readable.from(raw !== undefined ? [Buffer.from(raw)] : body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method; req.url = url;
  req.headers = {host: 'info.dlkt.ee', origin: ORIGIN, 'x-forwarded-proto': 'https', 'x-dlkt-info-request': 'connections-v1', 'content-type': 'application/json', cookie: `__Host-dlkt_info_at=${TOKEN}`, ...headers};
  return req;
}
function response() { return {statusCode: 0, headers: {}, body: null,
  setHeader(key, value) {this.headers[key] = value;}, getHeader(key) {return this.headers[key];},
  end(value) {this.body = value === undefined ? null : JSON.parse(value);}}; }
async function run(req, deps) {
  const res = response(); await handleConnections(req, res, deps);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers.Vary, 'Cookie, Origin');
  return res;
}
function fixture(changes = {}) {
  const rows = new Map(), pending = new Map(), calls = [], driverCalls = [];
  const store = {
    async list() {return [...rows.values()];}, async read(id) {return rows.get(id) ?? null;},
    async save(row, expected) {if ((rows.get(row.providerId)?.revision ?? null) !== expected) throw new Error('CONNECTION_CONFLICT'); rows.set(row.providerId, row);},
    async remove(id, expected) {if (rows.get(id)?.revision !== expected) throw new Error('CONNECTION_CONFLICT'); rows.delete(id);},
    async createAuthorization(value) {pending.set(value.providerId, value);},
    async consumeAuthorization(hash) {const value = [...pending.values()].find(row => row.stateHash === hash); if (value) pending.delete(value.providerId); return value ?? null;},
  };
  const drivers = {
    authorizationUrl(config, state) { const url = new URL('https://accounts.google.com/o/oauth2/v2/auth'); url.searchParams.set('state', state); url.searchParams.set('redirect_uri', config.redirectUri); return url.href; },
    async exchangeCode() {driverCalls.push('exchange'); return {accountId: 'fixture-account', accountLabel: 'connected@example.test', accessToken: 'provider-access-fixture', refreshToken: 'provider-refresh-fixture', expiresAt: '2026-11-20T13:00:00.000Z', scopes: ['openid', 'email'], resources: []};},
    async refreshGrant(config, grant) {return grant;}, async syncProvider() {return {events: [], state: 'available', checkedAt: NOW};}, async revokeGrant() {return 'revoked';},
  };
  const deps = {environment, provisioning, now: () => new Date(NOW), drivers, accessReader:{read:async(o,s)=>premiumReceipt(o,s)},
    storeFactory(configuration, owner, access) {assert.equal(owner, OWNER); assert.equal(JSON.parse(Buffer.from(access.split('.')[1], 'base64url')).role, 'authenticated'); return store;},
    fetch: async url => {calls.push(String(url)); assert.ok(String(url).endsWith('/auth/v1/user')); return json({id: OWNER, email: 'owner@example.test'});}, ...changes};
  return {rows, pending, calls, driverCalls, store, drivers, deps};
}
async function start(f) {
  const res = await run(request('POST', {action: 'connect', providerId: 'gmail'}), f.deps);
  assert.equal(res.statusCode, 200);
  return {res, state: new URL(res.body.authorizationUrl).searchParams.get('state')};
}
function callback(state, {cookie = `__Host-dlkt_info_at=${TOKEN}; __Host-dlkt_connection_gmail=${state}`, suffix = '&code=fixture-code', headers = {}} = {}) {
  return request('GET', undefined, {url: `/api/connections?provider=gmail&state=${state}${suffix}`, headers: {cookie, origin: '', 'x-dlkt-info-request': '', 'sec-fetch-site': 'cross-site', ...headers}});
}

test('Unconfigured endpoint exposes only unavailable providers with no I/O or user data', async () => {
  let calls = 0;
  const res = await run(request(), {environment: {}, fetch: async () => {calls++; throw new Error('unexpected I/O');}});
  assert.equal(res.statusCode, 200); assert.equal(calls, 0);
  assert.ok(res.body.providers.every(provider => provider.status === 'unavailable' && provider.connection === null));
  assert.doesNotMatch(JSON.stringify(res.body), /owner@example|fixture-secret|accessToken|refreshToken/u);
});

test('Account and schema gates prevent authorization without consuming body or performing I/O', async () => {
  for (const deps of [{environment: {...environment, DLKT_INFO_ACCOUNT_BRIDGE_ENABLED: '0'}, provisioning}, {environment: {...environment, DLKT_INFO_AUTH_EMAIL_READY: '0'}, provisioning}, {environment, provisioning: {...provisioning, schemaVerified: false}}]) {
    let reads = 0, calls = 0;
    const req = Readable.from((async function* () {reads++; yield Buffer.from('{}');})());
    Object.assign(req, {method: 'POST', url: '/api/connections', headers: request().headers});
    const res = await run(req, {...deps, fetch: async () => {calls++; throw new Error('unexpected I/O');}});
    assert.equal(res.statusCode, 503); assert.equal(reads, 0); assert.equal(calls, 0);
  }
});

test('Ordinary requests require the exact same-origin marker, trusted served host and same-site metadata before I/O', async () => {
  const f = fixture();
  for (const headers of [{'x-dlkt-info-request': ''}, {'x-dlkt-info-request': 'wallet-v1'}, {origin: 'https://attacker.invalid'}, {host: 'attacker.invalid'}, {'x-forwarded-proto': 'http'}, {'sec-fetch-site': 'cross-site'}, {origin: ''}]) {
    const res = await run(request('POST', {action: 'connect', providerId: 'gmail'}, {headers}), f.deps);
    assert.equal(res.statusCode, 403);
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await run(request('POST', {}, {url: '/api/connections?evil=1'}), f.deps)).statusCode, 400);
  assert.equal((await run(request('DELETE'), f.deps)).statusCode, 405);
});

test('Unauthenticated and privileged-claim requests cannot construct the connection store', async () => {
  let constructed = 0; const f = fixture({storeFactory: () => {constructed++; throw new Error('forbidden');}});
  assert.equal((await run(request('GET', undefined, {headers: {cookie: ''}}), f.deps)).statusCode, 401);
  for (const claims of [{role: 'service_role'}, {session_id: null}, {sub: SESSION}]) {
    assert.equal((await run(request('GET', undefined, {headers: {cookie: `__Host-dlkt_info_at=${token(claims)}`}}), f.deps)).statusCode, 401);
  }
  // The handler must validate the verified-token claims before giving the token to storage.
  assert.equal(constructed, 0);
});

test('Connect creates a bounded HttpOnly state cookie and returns no provider token or internal config', async () => {
  const f = fixture(); const begun = await start(f);
  const cookies = begun.res.headers['Set-Cookie'];
  assert.equal(cookies.length, 1);
  assert.match(cookies[0], /^__Host-dlkt_connection_gmail=/u);
  for (const part of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=600']) assert.ok(cookies[0].includes(part));
  assert.deepEqual(Object.keys(begun.res.body), ['authorizationUrl']);
  assert.doesNotMatch(JSON.stringify(begun.res.body), /fixture-secret|provider-access-fixture|provider-refresh-fixture/u);
  assert.equal(new URL(begun.res.body.authorizationUrl).searchParams.get('redirect_uri'), `${ORIGIN}/api/connections?provider=gmail`);
});

test('Callback uses state/cookie/session binding, redirects to a fixed local path and cannot be replayed', async () => {
  const f = fixture(); const {state} = await start(f);
  const res = await run(callback(state), f.deps);
  assert.equal(res.statusCode, 303); assert.equal(res.headers.Location, '/wallet?connection=connected');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  assert.ok(res.headers['Set-Cookie'].some(value => value.startsWith('__Host-dlkt_connection_gmail=;') && value.includes('Max-Age=0')));
  assert.equal(res.body, null); assert.equal(f.rows.size, 1);
  const replay = await run(callback(state), f.deps);
  assert.equal(replay.headers.Location, '/wallet?connection=failed');
  assert.equal(f.driverCalls.filter(value => value === 'exchange').length, 1);
  const snapshot = await run(request(), f.deps);
  assert.doesNotMatch(JSON.stringify(snapshot.body), /provider-access-fixture|provider-refresh-fixture|sealedGrant|fixture-secret/u);
});

test('Missing, mismatched or duplicate OAuth state cookies prevent exchange', async () => {
  for (const getCookie of [state => `__Host-dlkt_info_at=${TOKEN}`, state => `__Host-dlkt_info_at=${TOKEN}; __Host-dlkt_connection_gmail=${'A'.repeat(43)}`, state => `__Host-dlkt_info_at=${TOKEN}; __Host-dlkt_connection_gmail=${state}; __Host-dlkt_connection_gmail=${state}`]) {
    const f = fixture(); const {state} = await start(f);
    const res = await run(callback(state, {cookie: getCookie(state)}), f.deps);
    assert.equal(res.headers.Location, '/wallet?connection=failed'); assert.equal(f.rows.size, 0); assert.equal(f.driverCalls.length, 0);
  }
});

test('Callback cancellation preserves existing connections and does not expose provider error text', async () => {
  const f = fixture(); const first = await start(f); await run(callback(first.state), f.deps);
  const before = structuredClone(f.rows.get('gmail')); const second = await start(f);
  const res = await run(callback(second.state, {suffix: '&error=access_denied&error_description=private-upstream-detail'}), f.deps);
  assert.equal(res.headers.Location, '/wallet?connection=cancelled'); assert.deepEqual(f.rows.get('gmail'), before);
  assert.doesNotMatch(JSON.stringify(res.headers), /private-upstream-detail/u);
});

test('Callback rejects duplicate/foreign parameters and noncanonical hosts without I/O', async () => {
  const f = fixture(); const state = 'A'.repeat(43);
  for (const req of [callback(state, {suffix: '&code=x&code=y'}), callback(state, {suffix: '&code=x&redirect=https://attacker.invalid'}), callback(state, {headers: {host: 'www.dlkt.ee'}})]) {
    const res = await run(req, f.deps); assert.equal(res.headers.Location, '/wallet?connection=failed');
  }
  assert.equal(f.calls.length, 0); assert.equal(f.driverCalls.length, 0);
});

test('Successful OAuth callback appends state-cookie clearing after rotated identity cookies', async () => {
  const f = fixture(); const {state} = await start(f); const renewed = token({exp: 9999999999});
  f.deps.fetch = async (url, init) => {
    if (String(url).endsWith('/auth/v1/user')) return json({}, 401);
    assert.ok(String(url).endsWith('/auth/v1/token?grant_type=refresh_token'));
    assert.equal(JSON.parse(init.body).refresh_token, 'fixture-refresh-cookie');
    return json({access_token: renewed, refresh_token: 'fixture-rotated-refresh-cookie', expires_in: 3600, user: {id: OWNER, email: 'owner@example.test'}});
  };
  const res = await run(callback(state, {cookie: `__Host-dlkt_info_at=${TOKEN}; __Host-dlkt_info_rt=fixture-refresh-cookie; __Host-dlkt_connection_gmail=${state}`}), f.deps);
  assert.equal(res.headers.Location, '/wallet?connection=connected');
  const cookies = res.headers['Set-Cookie']; assert.equal(cookies.length, 3);
  assert.ok(cookies.some(value => value.startsWith(`__Host-dlkt_info_at=${renewed};`)));
  assert.ok(cookies.some(value => value.startsWith('__Host-dlkt_info_rt=fixture-rotated-refresh-cookie;')));
  assert.ok(cookies.some(value => value.startsWith('__Host-dlkt_connection_gmail=;') && value.includes('Max-Age=0')));
});

test('Malformed/oversized action input never reaches provider operations', async () => {
  const f = fixture();
  for (const [req, expected] of [[request('POST', {action: 'connect', providerId: 'gmail', ownerId: OWNER}), 400], [request('POST', {action: 'send-email', providerId: 'gmail'}), 400], [request('POST', {action: 'connect', providerId: 'unknown'}), 400], [request('POST', undefined, {raw: '{'}), 400], [request('POST', undefined, {raw: 'a'.repeat(2049)}), 413], [request('POST', {}, {headers: {'content-type': 'text/plain'}}), 415]]) {
    assert.equal((await run(req, f.deps)).statusCode, expected);
  }
  for (const action of [['connect'], ['disconnect'], {value: 'connect'}, 1, null]) {
    const res = await run(request('POST', {action, providerId: 'gmail'}), f.deps);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(f.pending.size, 0); assert.equal(f.driverCalls.length, 0);
});

test('Unexpected store/provider errors are reduced to generic failures without their message', async () => {
  const f = fixture(); f.store.list = async () => {throw new Error('private-database-connection-secret');};
  const res = await run(request(), f.deps);
  assert.equal(res.statusCode, 502); assert.deepEqual(res.body, {error: 'CONNECTION_UPSTREAM_UNAVAILABLE'});
  assert.doesNotMatch(JSON.stringify(res), /private-database-connection-secret/u);
});

test('A provider failure is not misreported as a user cancellation', async () => {
  const f = fixture(); const {state} = await start(f);
  const res = await run(callback(state, {suffix: '&error=server_error&error_description=provider-private-detail'}), f.deps);
  assert.equal(res.headers.Location, '/wallet?connection=failed');
  assert.equal(f.driverCalls.length, 0);
  assert.doesNotMatch(JSON.stringify(res.headers), /provider-private-detail/u);
});


const outlookEnvironment = {...environment, DLKT_INFO_OUTLOOK_CLIENT_ID: 'fixture-outlook-client', DLKT_INFO_OUTLOOK_CLIENT_SECRET: 'fixture-outlook-secret', DLKT_INFO_OUTLOOK_ENABLED: '1', DLKT_INFO_OUTLOOK_PUBLIC_READY: '1'};
async function startOutlook(f) {
  const res = await run(request('POST', {action: 'connect', providerId: 'outlook'}), f.deps);
  assert.equal(res.statusCode, 200);
  assert.equal(new URL(res.body.authorizationUrl).searchParams.get('redirect_uri'), `${ORIGIN}/api/connections`);
  assert.match(res.headers['Set-Cookie'][0], /^__Host-dlkt_connection_outlook=/u);
  return new URL(res.body.authorizationUrl).searchParams.get('state');
}
function outlookCallback(state, suffix = '&code=fixture-code', cookieName = 'outlook') {
  return request('GET', undefined, {url: `/api/connections?state=${state}${suffix}`, headers: {cookie: `__Host-dlkt_info_at=${TOKEN}; __Host-dlkt_connection_${cookieName}=${state}`, origin: '', 'x-dlkt-info-request': '', 'sec-fetch-site': 'cross-site'}});
}
test('Queryless Microsoft callback remains owner/session/cookie bound and one-use', async () => {
  const f = fixture({environment: outlookEnvironment}); const state = await startOutlook(f);
  const result = await run(outlookCallback(state), f.deps);
  assert.equal(result.headers.Location, '/wallet?connection=connected');
  assert.ok(f.rows.has('outlook')); assert.equal(f.rows.has('gmail'), false);
  assert.ok(result.headers['Set-Cookie'].some(value => value.startsWith('__Host-dlkt_connection_outlook=;') && value.includes('Max-Age=0')));
  assert.equal((await run(outlookCallback(state), f.deps)).headers.Location, '/wallet?connection=failed');
  assert.equal(f.driverCalls.filter(x => x === 'exchange').length, 1);
});
test('Queryless Microsoft callback rejects provider confusion, missing cookie and ambiguous query', async () => {
  for (const kind of ['gmail-state', 'gmail-cookie', 'missing-cookie', 'explicit-outlook', 'duplicate', 'foreign', 'wrong-path']) {
    const f = fixture({environment: outlookEnvironment});
    const state = kind === 'gmail-state' ? (await start(f)).state : await startOutlook(f);
    const req = outlookCallback(state, '&code=fixture-code', ['gmail-cookie', 'gmail-state'].includes(kind) ? 'gmail' : 'outlook');
    if (kind === 'missing-cookie') req.headers.cookie = `__Host-dlkt_info_at=${TOKEN}`;
    if (kind === 'explicit-outlook') req.url += '&provider=outlook';
    if (kind === 'duplicate') req.url += '&state=duplicate';
    if (kind === 'foreign') req.url += '&next=https://attacker.invalid';
    if (kind === 'wrong-path') req.url = req.url.replace('/api/connections', '/other');
    assert.equal((await run(req, f.deps)).headers.Location, '/wallet?connection=failed', kind);
    assert.equal(f.driverCalls.length, 0, kind); assert.equal(f.rows.size, 0, kind);
  }
});
test('Queryless Microsoft consent denial and signed-out callback fail without provider exchange', async () => {
  const f = fixture({environment: outlookEnvironment}); const state = await startOutlook(f);
  assert.equal((await run(outlookCallback(state, '&error=access_denied'), f.deps)).headers.Location, '/wallet?connection=cancelled');
  assert.equal(f.driverCalls.length, 0);
  const second = await startOutlook(f); const req = outlookCallback(second); req.headers.cookie = '';
  assert.equal((await run(req, f.deps)).headers.Location, '/wallet?connection=expired');
  assert.equal(f.driverCalls.length, 0);
});

test('Authenticated endpoint defaults to denied when no real billing reader is provisioned',async()=>{
 const f=fixture({accessReader:undefined});
 const snapshot=await run(request(),f.deps);
 assert.equal(snapshot.statusCode,200);assert.ok(snapshot.body.providers.every(p=>p.status==='unavailable'));
 for(const action of ['connect','sync']){
  const res=await run(request('POST',{action,providerId:'gmail'}),f.deps);
  assert.equal(res.statusCode,403);assert.equal(res.body.error,'CONNECTION_PREMIUM_REQUIRED');
 }
 assert.equal(f.pending.size,0);assert.equal(f.driverCalls.length,0);
 const res=await run(request('POST',{action:'disconnect',providerId:'gmail'}),f.deps);
 assert.equal(res.statusCode,200);assert.equal(res.body.disconnected,true);
});
test('Synthetic and foreign-session receipts cannot grant Premium despite public provider readiness',async()=>{
 for(const make of [(o,s)=>({...premiumReceipt(o,s),state:'sandbox_eligible'}),(o,s)=>({...premiumReceipt(o,s),liveMode:false}),(o,s)=>({...premiumReceipt(o,s),sessionHash:'A'.repeat(43)}),(o,s)=>({...premiumReceipt(o,s),ownerId:SESSION}),(o,s)=>({...premiumReceipt(o,s),validUntil:Math.floor(Date.parse(NOW)/1000)})]){
  const f=fixture({accessReader:{read:async(o,s)=>make(o,s)}});
  const res=await run(request('POST',{action:'connect',providerId:'gmail'}),f.deps);
  assert.equal(res.statusCode,403);assert.equal(f.pending.size,0);
 }
});
