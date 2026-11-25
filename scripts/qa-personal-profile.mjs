import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const COOKIE = 'DLKT_QA_PRIVATE_SESSION';
const TOKENS = new Map([['fixture-alpha', A], ['fixture-bravo', B]]);
const NAMES = new Map([[A, 'QA_ALPHA_PRIVATE'], [B, 'QA_BRAVO_PRIVATE']]);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(value).digest('hex');
const identity = owner => ({
  version: 'dlkt-info-identity-1', configured: true, enabled: true,
  authenticated: owner !== null, blocker: null,
  user: owner === null ? null : {id: owner, email: owner === A ? 'alpha@example.test' : 'bravo@example.test'},
});

async function bounded(promise, label, milliseconds = 8000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('DLKT_PERSONAL_QA_TIMEOUT_' + label)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/**
 * Loopback-only, opt-in transport fixture. Synthetic owners and profiles live in
 * Node memory. It is NOT a Supabase session, OTP, billing or hosted-RLS test.
 */
export async function personalProfileFixture(publicFixture) {
  const [wallet, daily, local, cards, selection, account, personalContract] = await Promise.all([
    import('../source/.build/src/wallet/contracts.js'),
    import('../source/.build/src/daily/contracts.js'),
    import('../source/.build/src/local/contracts.js'),
    import('../source/.build/src/iceo/card-validation.js'),
    import('../source/.build/src/daily/selection.js'),
    import('../source/.build/src/account/contracts.js'),
    import('../source/.build/src/personal/contracts.js'),
  ]);
  assert.equal(typeof account.ACCOUNT_VERSION,'string');
  assert.ok(Array.isArray(personalContract.LOCAL_NEEDS)&&personalContract.LOCAL_NEEDS.length>0);
  const legacy = {
    version: 'dlkt-info-wallet-profile-1',
    revision: '33333333-3333-4333-8333-333333333333',
    updatedAt: new Date().toISOString(),
    value: {displayName: NAMES.get(A), locale: 'en', timezone: 'Europe/Bucharest',
      briefingTime: '08:00', interests: ['technology'], personalPriority: 'balanced'},
  };
  const bravo = {
    version: wallet.WALLET_PROFILE_VERSION,
    revision: '44444444-4444-4444-8444-444444444444',
    updatedAt: new Date().toISOString(),
    value: wallet.parseWalletProfile({
      displayName: NAMES.get(B), locale: 'en', timezone: 'UTC', briefingTime: '09:00',
      interests: ['science'], personalPriority: 'balanced', cityId: '683506', localNeeds: ['weather'],
    }),
  };
  const profiles = new Map([[A, legacy], [B, bravo]]);
  const requests = [], writes = [], errors = [], holds = new Map(), allHolds = new Set(), failures = new Map();
  let active = false, expiryMilliseconds = 300000, additionalTechnology = 0;
  const techUrl = 'https://github.com/nodejs/node/releases/tag/v22.1.0';
  const scienceUrl = 'https://www.nasa.gov/science/controlled-research-fixture/';
  const techId = digest(techUrl).slice(0, 24), scienceId = digest(scienceUrl).slice(0, 24);
  // Distinct publications exercise pagination without defeating the real
  // reader's intentional software:nodejs release grouping.
  const paginationPublications = [
    ['photonic-processors', 'Photonic processors map waveguide interference across laboratory test chips'],
    ['distributed-compilers', 'Distributed compilers reorder dependency graphs for reproducible binary assembly'],
    ['soft-robotics', 'Soft robotics actuators measure tendon displacement during grasping trials'],
    ['quantum-calibration', 'Quantum calibration sequences compare trapped ion control pulse drift'],
    ['semiconductor-packaging', 'Semiconductor packaging experiments quantify thermal expansion in bonded layers'],
    ['optical-routing', 'Optical routing algorithms allocate wavelength channels across mesh networks'],
    ['neuromorphic-memory', 'Neuromorphic memory arrays characterize conductance changes during training'],
    ['terahertz-antennas', 'Terahertz antenna measurements isolate substrate resonance in compact receivers'],
    ['formal-verification', 'Formal verification methods prove termination of asynchronous message protocols'],
    ['precision-lithography', 'Precision lithography tools align nanoscale masks using interferometric references'],
    ['synthetic-aperture', 'Synthetic aperture electronics reconstruct phase maps from distributed sensors'],
    ['haptic-feedback', 'Haptic feedback devices encode surface textures with programmable vibration patterns'],
    ['reversible-computing', 'Reversible computing circuits evaluate energy recovery under variable clock rates'],
    ['microfluidic-control', 'Microfluidic control boards regulate droplet timing through embedded processors'],
    ['timing-networks', 'Timing networks synchronize remote oscillators using bidirectional optical links'],
    ['magnetic-storage', 'Magnetic storage experiments characterize switching thresholds in patterned films'],
    ['compiler-toolchains', 'Compiler toolchains preserve floating point bounds through optimization passes'],
    ['acoustic-modems', 'Acoustic modems adapt packet coding to changing underwater propagation paths'],
    ['tactile-sensors', 'Tactile sensor matrices resolve shear forces on flexible robotic fingertips'],
    ['memory-compression', 'Memory compression techniques reduce lookup traffic for sparse numerical arrays'],
    ['edge-inference', 'Edge inference processors schedule tensor operations under strict power budgets'],
    ['laser-metrology', 'Laser metrology instruments compare displacement noise across optical cavities'],
  ];
  const publicationUrl = index => 'https://www.nist.gov/news-events/news/controlled-qa-' + paginationPublications[index][0];
  const expected = {
    alpha: A, bravo: B, alphaName: NAMES.get(A), bravoName: NAMES.get(B),
    technology: 'topic:' + techId, science: 'topic:' + scienceId,
    utility: 'local:' + publicFixture.localIds[0], weather: 'local:' + publicFixture.localIds[1],
    techUrl, scienceUrl, cityName: publicFixture.city.name,
    accountNeeds:[...personalContract.LOCAL_NEEDS],accountInterests:[...daily.DAILY_TOPICS],
  };

  function topicSnapshot() {
    const now = Date.now(), stamp = new Date(now).toISOString();
    const technology = {
      id: techId, identity: techUrl, title: 'Controlled Node.js release fixture', topic: 'technology',
      kind: 'software-release', sourceUrl: techUrl, publisher: 'Node.js maintainers', sourceIds: ['nodejs'],
      date: new Date(now - 10000).toISOString(), dateLabel: 'Published', observedAt: stamp, contentHash: '',
      boundary: 'Controlled browser fixture; not a live release check or a recommendation for your installation.',
      deadline: null, version: 'v22.1.0', attribution: 'Controlled fixture using the original Node.js release URL.',
      sourceState: 'verified',
    };
    const science = {
      id: scienceId, identity: scienceUrl, title: 'Controlled ocean research fixture', topic: 'science',
      kind: 'publication', sourceUrl: scienceUrl, publisher: 'NASA', sourceIds: ['nasa-news'],
      date: new Date(now - 12000).toISOString(), dateLabel: 'Published', observedAt: stamp, contentHash: '',
      boundary: 'Synthetic browser fixture; this is not a published NASA article or a live source check.',
      deadline: null, version: null, attribution: 'Synthetic QA source record, not live NASA reporting.',
      sourceState: 'verified',
    };
    const publications = paginationPublications.slice(0, additionalTechnology).map(([_slug, title], index) => {
      const url = publicationUrl(index);
      return {...technology, id: digest(url).slice(0, 24), identity: url, sourceUrl: url,
        kind: 'publication', publisher: 'NIST', sourceIds: ['nist-news'], title, version: null,
        date: new Date(now - 15000 - index * 1000).toISOString(),
        boundary: 'Synthetic browser fixture; this is not a published NIST article or a live source check.',
        attribution: 'Synthetic pagination fixture. No publisher article or research finding is claimed.'};
    });
    const sourceCards = [technology, science, ...publications];
    for (const card of sourceCards) card.contentHash = digest(JSON.stringify(cards.cardContent(card)));
    const source = (id, label, publisher, topic, termsUrl) => ({
      id, label, publisher, topic, state: 'verified', checkedAt: stamp, verifiedAt: stamp,
      count: 1, rejected: 0, error: null, retryAt: null, scope: 'Controlled browser source fixture.',
      termsUrl, windowed: true,
    });
    const value = {
      version: 'iceo-primary-mesh-1', product: 'dlkt-info', productVersion: 'controlled-personal-browser',
      mode: 'current-source-records', generatedAt: stamp, state: 'partial',
      cards: sourceCards,
      sources: [
        source('nodejs', 'Node.js', 'Node.js maintainers', 'technology', 'https://github.com/nodejs/node/blob/main/LICENSE'),
        ...(additionalTechnology === 0 ? [] : [{...source('nist-news', 'NIST technology and research', 'NIST', 'technology',
          'https://www.nist.gov/copyrights-disclaimers'), count: publications.length}]),
        source('nasa-news', 'NASA', 'NASA', 'space', 'https://www.nasa.gov/nasa-brand-center/images-and-media/'),
      ],
      conflictCount: 0, duplicateCount: 0, deltaAvailable: false,
      scheduledDelivery: false, accountPersistence: false, coverage: ['technology', 'science'],
    };
    assert.equal(daily.validTopicSnapshot(value, now), true, 'personal topic fixture passes the actual public source contract');
    const matched = selection.selectDaily({cityId: null, topics: ['technology'], query: '', budget: 5000, timezone: 'UTC'},
      value, null, null, [], now);
    const expectedIds = [expected.technology, ...publications.map(card => 'topic:' + card.id)].sort();
    assert.equal(matched.topicCount, additionalTechnology + 1, 'the real selector retains one Node.js group plus distinct publications');
    assert.deepEqual(matched.items.map(item => item.id).sort(), expectedIds, 'fixture pagination counts actual selected story identities');
    return value;
  }

  function ownerFor(req) {
    const header = req.headers.cookie;
    const token = typeof header === 'string'
      ? header.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1)
      : undefined;
    return TOKENS.get(token) ?? null;
  }
  function snapshot(owner) {
    if (owner === null) return wallet.walletSnapshot('signed-out');
    const value = profiles.get(owner) ?? null;
    return wallet.walletSnapshot('signed-in', value === null ? null : wallet.parseWalletProfileState(clone(value)));
  }
  function send(res, status, value, headers = {}) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers});
    res.end(JSON.stringify(value));
  }
  async function body(req) {
    const maximum = wallet.WALLET_PROFILE_MAX_BYTES;
    if (!/^application\/json(?:\s*;|$)/iu.test(req.headers['content-type'] ?? '')) throw Error('CONTENT_TYPE_REQUIRED');
    const length = req.headers['content-length'];
    if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > maximum)) throw Error('BODY_TOO_LARGE');
    const parts = []; let bytes = 0;
    for await (const part of req) {
      bytes += part.length;
      if (bytes > maximum) throw Error('BODY_TOO_LARGE');
      parts.push(part);
    }
    const raw = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(parts));
    if (!raw) throw Error('BODY_EMPTY');
    return JSON.parse(raw);
  }
  async function delayed(kind, value) {
    const gate = holds.get(kind);
    if (!gate) return value;
    holds.delete(kind);
    gate.enter();
    await gate.wait;
    return value;
  }
  function fail(kind) {
    if (!failures.has(kind)) return null;
    const status = failures.get(kind); failures.delete(kind);
    return {status, value: {error: 'CONTROLLED_PRIVATE_FIXTURE_UNAVAILABLE'}};
  }
  async function respond(req, res, url) {
    const method = req.method ?? '', owner = ownerFor(req);
    const ownerHeader = req.headers['x-dlkt-info-owner'];
    const record = {path: url.pathname, query: url.search, method, owner, ownerHeader: ownerHeader ?? null,
      hasCookie: typeof req.headers.cookie === 'string' && req.headers.cookie.length > 0,
      hasAuthorization: req.headers.authorization !== undefined, status: null};
    requests.push(record);
    const reply = (status, value, headers) => {record.status = status; send(res, status, value, headers);};
    if (url.pathname === '/api/account-session') {
      if (url.search || !['GET', 'DELETE'].includes(method)) {reply(405, {error: 'METHOD_NOT_ALLOWED'}); return;}
      if (req.headers['x-dlkt-info-request'] !== 'identity-v1') {reply(403, {error: 'ORIGIN_REJECTED'}); return;}
      const failed = fail('session'); if (failed) {reply(failed.status, failed.value); return;}
      const value = method === 'DELETE' ? identity(null) : identity(owner);
      await delayed('session', null);
      reply(200, value, method === 'DELETE' ? {'Set-Cookie': COOKIE + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'} : {});
      return;
    }
    if(url.pathname==='/api/account'){
      if(url.search||method!=='GET'){req.resume();reply(405,{error:'METHOD_NOT_ALLOWED'});return;}
      if(req.headers['x-dlkt-info-request']!=='account-v1'){reply(403,{error:'ORIGIN_REJECTED'});return;}
      reply(200,{version:account.ACCOUNT_VERSION,enabled:true,state:null});return;
    }
    if (url.pathname === '/api/wallet') {
      if (url.search || !['GET', 'PUT', 'DELETE'].includes(method)) {reply(405, {error: 'METHOD_NOT_ALLOWED'}); return;}
      if (req.headers['x-dlkt-info-request'] !== 'wallet-v1') {reply(403, {error: 'ORIGIN_REJECTED'}); return;}
      if (ownerHeader !== undefined && (typeof ownerHeader !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(ownerHeader))) {
        req.resume(); reply(400, {error: 'WALLET_OWNER_INVALID'}); return;
      }
      if (owner === null) {req.resume(); reply(method === 'GET' ? 200 : 401, method === 'GET' ? snapshot(null) : {error: 'AUTHENTICATION_REQUIRED'}); return;}
      if (ownerHeader !== undefined && ownerHeader.toLowerCase() !== owner) {
        req.resume(); reply(409, {error: 'WALLET_OWNER_CHANGED'}); return;
      }
      const kind = method === 'GET' ? 'wallet-read' : method === 'PUT' ? 'wallet-save' : 'wallet-delete';
      const failed = fail(kind); if (failed) {req.resume(); reply(failed.status, failed.value); return;}
      if (method === 'GET') {
        const value = snapshot(owner);
        await delayed(kind, null); reply(200, value); return;
      }
      let input;
      try { input = await bounded(body(req), 'REQUEST_BODY', 4000); }
      catch {reply(400, {error: 'WALLET_INPUT_INVALID'}); return;}
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {reply(400, {error: 'WALLET_INPUT_INVALID'}); return;}
      const stored = profiles.get(owner) ?? null;
      if (input.expectedRevision !== (stored?.revision ?? null)) {reply(409, {error: 'WALLET_CONFLICT'}); return;}
      if (method === 'DELETE') {
        if (Object.keys(input).join(',') !== 'expectedRevision' || stored === null) {reply(400, {error: 'WALLET_INPUT_INVALID'}); return;}
        profiles.set(owner, null); writes.push({owner, method, expectedRevision: input.expectedRevision});
        await delayed(kind, null); reply(200, snapshot(owner)); return;
      }
      if (Object.keys(input).sort().join(',') !== 'expectedRevision,value') {reply(400, {error: 'WALLET_INPUT_INVALID'}); return;}
      let value;
      try { value = wallet.parseWalletProfile(input.value); } catch {reply(400, {error: 'WALLET_PROFILE_INVALID'}); return;}
      profiles.set(owner, {version: wallet.WALLET_PROFILE_VERSION, revision: randomUUID(), updatedAt: new Date().toISOString(), value});
      writes.push({owner, method, expectedRevision: input.expectedRevision, value: clone(value)});
      const saved = snapshot(owner);
      await delayed(kind, null); reply(200, saved); return;
    }
    if (method !== 'GET') {reply(405, {error: 'METHOD_NOT_ALLOWED'}); return;}
    const kind = url.pathname === '/api/iceo' ? 'topics' : url.pathname === '/api/local' ? 'local' : 'places';
    const failed = fail(kind); if (failed) {reply(failed.status, failed.value); return;}
    let response = url.pathname === '/api/iceo' ? {status: 200, value: topicSnapshot()} : await publicFixture.response(url);
    if (kind === 'local' && response.status === 200 && expiryMilliseconds !== 300000) {
      response = clone(response);
      const expiry = new Date(Date.now() + expiryMilliseconds).toISOString();
      response.value.cards = response.value.cards.map(card => card.kind === 'utility-notice' ? {...card, validTo: expiry} : card);
      assert.equal(local.currentLocalSnapshot(response.value, publicFixture.city, Date.now()), true,
        'short-lived operational fixture still passes the unchanged source contract');
    }
    await delayed(kind, null);
    reply(response.status, response.value);
  }
  return {
    expected, requests, writes, errors,
    get active() {return active;},
    activate() {assert.equal(active, false); active = true;},
    deactivate() {active = false; for (const gate of allHolds) gate.release();},
    profile(owner) {return clone(profiles.get(owner) ?? null);},
    replaceProfile(owner, value) {assert.ok(owner === A || owner === B); profiles.set(owner, clone(value));},
    expandTechnology(count) {
      assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= 22);
      additionalTechnology = count;
      return Array.from({length: count}, (_, index) => 'topic:' + digest(publicationUrl(index)).slice(0, 24));
    },
    expireUtilitiesAfter(milliseconds) {assert.ok(milliseconds >= 1000 && milliseconds <= 300000); expiryMilliseconds = milliseconds;},
    failNext(kind, status = 503) {assert.equal(failures.has(kind), false); failures.set(kind, status);},
    holdNext(kind) {
      assert.equal(holds.has(kind), false, 'only one pending hold per endpoint kind');
      let enter, release;
      const entered = new Promise(resolve => {enter = resolve;});
      const wait = new Promise(resolve => {release = resolve;});
      const gate = {enter, release, wait}; holds.set(kind, gate); allHolds.add(gate);
      return {entered: () => bounded(entered, 'HELD_' + kind), release};
    },
    handle(req, res, url) {
      if (!active || !['/api/account-session', '/api/account', '/api/wallet', '/api/places', '/api/local', '/api/iceo'].includes(url.pathname)) return false;
      void respond(req, res, url).catch(error => {
        errors.push({path: url.pathname, message: String(error instanceof Error ? error.message : error).slice(0, 300)});
        send(res, 500, {error: 'CONTROLLED_PRIVATE_FIXTURE_FAILED'});
      });
      return true;
    },
  };
}

function privateProbe() {
  const get = id => document.getElementById(id);
  const panel = get('wallet-personal');
  return {
    profileHidden: get('wallet-profile-panel')?.hidden ?? true,
    name: get('wallet-display-name')?.value ?? '',
    locale: get('wallet-locale')?.value ?? '',
    timezone: get('wallet-timezone')?.value ?? '',
    briefingTime: get('wallet-briefing-time')?.value ?? '',
    priorities: [...document.querySelectorAll('#wallet-profile-form input[name="personalPriority"]:checked')].map(node => node.value),
    city: get('wallet-city')?.checked ? get('wallet-city').value : '',
    needs: [...document.querySelectorAll('#wallet-local-needs input:checked')].map(node => node.value).sort(),
    interests: [...document.querySelectorAll('#wallet-interests input:checked')].map(node => node.value).sort(),
    personalHidden: panel?.hidden ?? true,
    status: get('wallet-status')?.textContent ?? '',
    personalStatus: get('wallet-personal-status')?.textContent ?? '',
    coverage: get('wallet-personal-coverage')?.textContent ?? '',
    cards: [...document.querySelectorAll('#wallet-personal-cards article[data-personal-id]')].map(node => ({
      id: node.dataset.personalId, title: node.querySelector('h3')?.textContent ?? '',
      reason: node.querySelector('.personal-reason')?.textContent ?? '',
      text: node.textContent, urls: [...node.querySelectorAll('a[href]')].map(link => link.href),
    })),
    signInVisible: !(get('wallet-signin')?.hidden ?? true),
    documentWidth: document.documentElement.scrollWidth, viewport: innerWidth,
  };
}
function emptyPrivate(probe) {
  assert.equal(probe.name, '', 'private display name is cleared');
  assert.equal(probe.locale, '', 'private preferred language is cleared');
  assert.equal(probe.timezone, '', 'private time zone is cleared');
  assert.equal(probe.briefingTime, '', 'private reading time is cleared');
  assert.deepEqual(probe.priorities, [], 'private daily mix preference is cleared');
  assert.equal(probe.city, '', 'private selected city is cleared');
  assert.deepEqual(probe.needs, [], 'private needs are cleared');
  assert.deepEqual(probe.interests, [], 'private interests are cleared');
  assert.deepEqual(probe.cards, [], 'private derived cards are cleared');
  assert.equal(probe.coverage, '', 'private coverage is cleared');
  assert.equal(probe.profileHidden, true, 'private editor is hidden');
}
async function setCookie(call, origin, owner) {
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
  await call('Network.enable');
  const result = await call('Network.setCookie', {
    name: COOKIE, value: owner === A ? 'fixture-alpha' : 'fixture-bravo',
    url: origin + '/', path: '/', httpOnly: true, secure: false, sameSite: 'Strict',
  });
  assert.notEqual(result.success, false, 'synthetic QA cookie is scoped to the loopback origin');
}
async function waitFor(call, evaluate, expression, label, milliseconds = 8000) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    if (await evaluate(call, expression)) return;
    await pause(80);
  }
  throw Error('DLKT_PERSONAL_QA_WAIT_' + label + '_' + JSON.stringify(await evaluate(call, '(' + privateProbe.toString() + ')()')));
}
async function activate(call, evaluate, focusSelector, keyboard, selector) {
  await waitFor(call, evaluate, '(function(){const n=document.querySelector(' + JSON.stringify(selector) + ');return Boolean(n&&!n.disabled&&!n.hidden&&n.getClientRects().length);})()',
    'CONTROL_' + selector);
  await focusSelector(call, selector); await keyboard(call, 'Enter');
}
async function fill(call, evaluate, value) {
  await evaluate(call, '(function(value){' +
    'const city=document.getElementById("wallet-city");if(!city||city.type!=="checkbox")throw Error("QA_CITY_FIELD_MISSING");' +
    'if(value.cityId&&city.value!==value.cityId)throw Error("QA_CITY_OPTION_MISSING");city.checked=Boolean(value.cityId);' +
    'for(const n of document.querySelectorAll("#wallet-local-needs input"))n.checked=value.localNeeds.includes(n.value);' +
    'for(const n of document.querySelectorAll("#wallet-interests input"))n.checked=value.interests.includes(n.value);' +
    'if(value.displayName!==undefined)document.getElementById("wallet-display-name").value=value.displayName;' +
    'city.dispatchEvent(new Event("change",{bubbles:true}));return true;})(' + JSON.stringify(value) + ')');
}
async function dailyMemory(call, evaluate, seed = false) {
  return evaluate(call, '(async function(seed){const {DeviceMemory}=await import("/device-memory.js");const m=new DeviceMemory();' +
    'if(seed){const prior=await m.readDaily();await m.writeDaily({version:"dlkt-personal-edition-1",profile:{cityId:null,topics:["culture"],query:"",budget:2,timezone:"UTC"},edition:null,feedback:[]},prior?.revision??null);}' +
    'return JSON.stringify(await m.readDaily());})(' + String(seed) + ')');
}
function personalSurface() {
  const visible = node => node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const rect = node => {const box = node.getBoundingClientRect(); return {left: box.left, right: box.right, width: box.width, height: box.height};};
  const root = document.getElementById('wallet-personal');
  const controls = ['wallet-save', 'wallet-personal-refresh', 'wallet-personal-more']
    .map(id => document.getElementById(id)).filter(visible).map(node => ({id: node.id, fontSize: parseFloat(getComputedStyle(node).fontSize), ...rect(node)}));
  for (const input of document.querySelectorAll('#wallet-city, #wallet-local-needs input')) {
    const label = input.closest('label');
    if (visible(label)) controls.push({id: input.id || 'local-need:' + input.value,
      fontSize: parseFloat(getComputedStyle(label).fontSize), ...rect(label)});
  }
  const cards = [...document.querySelectorAll('#wallet-personal-cards article[data-personal-id]')];
  return {width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    root: root && visible(root) ? rect(root) : null, controls,
    cards: cards.map(node => ({id: node.dataset.personalId, ...rect(node)})),
    reasons: cards.map(node => node.querySelector('.personal-reason')?.textContent?.trim() ?? '')};
}

/** Actual compiled UI over explicitly synthetic first-party transport. */
export async function verifyPersonalProfileFlow({call, origin, fixture, evaluate, loaded, focusSelector, keyboard,
  openIsolated, outputDir, emitVisualPreview}) {
  const expected = fixture.expected, observations = [];
  const probe = () => evaluate(call, '(' + privateProbe.toString() + ')()');
  const click = selector => activate(call, evaluate, focusSelector, keyboard, selector);
  const awaitCards = async (owner, ids) => waitFor(call, evaluate,
    '(function(){const p=(' + privateProbe.toString() + ')();return p.name===' + JSON.stringify(owner === A ? expected.alphaName : expected.bravoName) +
    '&&!document.getElementById("wallet-reload").disabled&&!document.getElementById("wallet-personal-refresh").disabled&&' +
    JSON.stringify(ids) + '.every(id=>p.cards.some(c=>c.id===id));})()', 'CARDS_' + (owner === A ? 'A' : 'B'));
  const reload = async (owner, ids) => {await setCookie(call, origin, owner); await click('#wallet-reload'); await awaitCards(owner, ids);};
  const screenshot = async width => {
    await evaluate(call, '(function(){document.getElementById("wallet-personal").scrollIntoView({block:"start"});return true;})()');
    const data = (await call('Page.captureScreenshot', {format: 'png', fromSurface: true, captureBeyondViewport: false})).data;
    assert.ok(typeof data === 'string' && data.length > 1000);
    const filename = 'dlkt-personal-wallet-' + width + '.png';
    writeFileSync(join(outputDir, filename), Buffer.from(data, 'base64'), {mode: 0o600});
    await emitVisualPreview(call, 'personal-wallet', width);
    return filename;
  };
  fixture.activate();
  try {
    await call('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true, scale: 1});
    const originalDaily = await dailyMemory(call, evaluate, true);
    await setCookie(call, origin, A);
    await call('Page.navigate', {url: origin + '/wallet'}); await loaded(call);
    await awaitCards(A, [expected.technology]);
    const initial = await probe();
    assert.equal(initial.city, '');
    assert.deepEqual(initial.needs, []);
    assert.equal(initial.cards.some(card => card.id.startsWith('local:')), false);
    assert.equal(fixture.writes.length, 0, 'reading a legacy account never writes an inferred profile');
    assert.equal(fixture.profile(A).version, 'dlkt-info-wallet-profile-1', 'legacy persistence remains untouched until explicit save');

    await fill(call, evaluate, {cityId: '683506', localNeeds: ['utilities'], interests: ['technology']});
    assert.deepEqual((await probe()).cards.map(card => card.id), initial.cards.map(card => card.id), 'unsaved form changes do not alter the confirmed personal feed');
    await click('#wallet-save');
    await awaitCards(A, [expected.utility, expected.technology]);
    let savedA = fixture.profile(A);
    assert.equal(savedA.version, 'dlkt-info-wallet-profile-2');
    assert.equal(savedA.value.cityId, '683506');
    assert.deepEqual(savedA.value.localNeeds, ['utilities']);
    assert.deepEqual(savedA.value.interests, ['technology']);
    assert.equal(fixture.writes.length, 1, 'only the explicit profile save writes account state');
    const alpha = await probe();
    assert.equal(alpha.cards.some(card => card.id === expected.weather || card.id === expected.science), false);
    for (const id of [expected.utility, expected.technology]) assert.ok(alpha.cards.find(card => card.id === id)?.reason.trim(), 'each selected card has an explicit personal rationale');
    const utilityReason = alpha.cards.find(card => card.id === expected.utility).reason;
    assert.ok(utilityReason.includes(expected.cityName) && utilityReason.includes('utilities')
      && utilityReason.includes('confirmed') && utilityReason.includes('selected') && utilityReason.includes('city context'),
      'local rationale names the confirmed city, declared need and limited city applicability');
    assert.ok(alpha.cards.find(card => card.id === expected.technology).reason.includes('selected by you'),
      'global rationale attributes selection to an explicit interest');
    assert.ok(alpha.cards.find(card => card.id === expected.technology)?.urls.includes(expected.techUrl), 'nonlocal interest card retains the exact original source URL');
    assert.ok(alpha.coverage.trim(), 'partial local source coverage remains visible');

    for (const width of [320, 390, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', {width, height: width === 1440 ? 900 : 844, deviceScaleFactor: 1, mobile: width < 768, scale: 1});
      const measured = await evaluate(call, '(' + personalSurface.toString() + ')()');
      assert.ok(measured.root && measured.documentWidth <= width + 2, 'private cards fit the viewport at ' + width);
      for (const box of [measured.root, ...measured.cards]) assert.ok(box.left >= -1 && box.right <= width + 1, 'personal content stays within viewport');
      assert.ok(measured.controls.some(control => control.id === 'wallet-city'), 'confirmed city checkbox label is measured');
      for (const control of measured.controls) {
        assert.ok(control.width >= 43.5 && control.height >= 43.5 && control.left >= -1 && control.right <= width + 1,
          'existing controls retain their target size: ' + JSON.stringify(control));
      }
      assert.ok(measured.reasons.every(Boolean));
      observations.push({width, measured, screenshot: await screenshot(width)});
    }
    await call('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true, scale: 1});

    const additional = fixture.expandTechnology(22);
    await click('#wallet-personal-refresh'); await awaitCards(A, [expected.utility, expected.technology]);
    assert.equal((await probe()).cards.length, 20, 'the initial private scrolling page is bounded');
    const moreControl = (await evaluate(call, '(' + personalSurface.toString() + ')()')).controls.find(control => control.id === 'wallet-personal-more');
    assert.ok(moreControl && moreControl.width >= 43.5 && moreControl.height >= 43.5, 'Show more retains an accessible control target');
    const technologyDetails = '[data-personal-id="' + expected.technology + '"] details';
    await focusSelector(call, technologyDetails + ' > summary'); await keyboard(call, 'Enter');
    assert.equal(await evaluate(call, 'document.querySelector(' + JSON.stringify(technologyDetails) + ').open'), true, 'source details open through the native control');
    await evaluate(call, '(function(){window.__dlktFirstPersonalNode=document.querySelector("#wallet-personal-cards article[data-personal-id]");window.__dlktOpenPersonalDetails=document.querySelector(' + JSON.stringify(technologyDetails) + ');return true;})()');
    await click('#wallet-personal-more');
    await waitFor(call, evaluate, 'document.querySelectorAll("#wallet-personal-cards article[data-personal-id]").length===24', 'SHOW_MORE_MATCHES');
    assert.equal(await evaluate(call, '(function(){return window.__dlktFirstPersonalNode===document.querySelector("#wallet-personal-cards article[data-personal-id]")&&window.__dlktOpenPersonalDetails===document.querySelector(' + JSON.stringify(technologyDetails) + ')&&window.__dlktOpenPersonalDetails.open;})()'), true, 'More retains the first existing node and the open source details');
    await evaluate(call, '(function(){delete window.__dlktFirstPersonalNode;delete window.__dlktOpenPersonalDetails;return true;})()');
    const allIds = (await probe()).cards.map(card => card.id);
    assert.equal(new Set(allIds).size, 24, 'paging does not duplicate source cards');
    assert.ok(additional.every(id => allIds.includes(id)), 'Show more retains every selected source identity');
    const more = await evaluate(call, '(' + personalSurface.toString() + ')()');
    assert.ok(more.documentWidth <= 392, 'expanded scrolling cards do not overflow at 390px');
    fixture.expandTechnology(0);
    await click('#wallet-personal-refresh'); await awaitCards(A, [expected.utility, expected.technology]);

    const memoryBeforeSave = await evaluate(call, '(async function(){const {DeviceMemory}=await import("/device-memory.js");return await new DeviceMemory().read();})()');
    const savedId = expected.technology.slice('topic:'.length);
    await click('[data-personal-save="' + savedId + '"]');
    await waitFor(call, evaluate, '(function(){const n=document.querySelector(\'[data-personal-save="' + savedId + '"]\');return n&&!n.disabled&&n.parentElement.textContent.includes("This public source card was saved");})()', 'SAVE_PUBLIC_CARD');
    const memoryAfterSave = await evaluate(call, '(async function(){const {DeviceMemory}=await import("/device-memory.js");return await new DeviceMemory().read();})()');
    assert.equal(memoryBeforeSave.cards.some(card => card.id === savedId), false, 'the selected public fixture was not previously saved');
    assert.equal(memoryAfterSave.cards.length, memoryBeforeSave.cards.length + 1, 'the explicit source action saves one public card');
    const savedCard = memoryAfterSave.cards.find(card => card.id === savedId);
    assert.equal(savedCard?.card.sourceUrl, expected.techUrl);
    assert.equal(/QA_ALPHA|QA_BRAVO|localNeeds|dlkt-info-wallet-profile/iu.test(JSON.stringify(savedCard)), false, 'the public saved record contains no private profile or rationale');
    assert.equal(await dailyMemory(call, evaluate), originalDaily, 'saving a public source card also preserves DailyState');

    // A second Chromium context has separate cookies and IndexedDB, but the same
    // Node fixture account. This proves transport restoration, not hosted auth.
    const second = await openIsolated();
    try {
      await setCookie(second.call, origin, A);
      await second.call('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true, scale: 1});
      await second.call('Page.navigate', {url: origin + '/wallet'}); await loaded(second.call);
      await second.call('Page.bringToFront');
      await waitFor(second.call, evaluate,
        '(function(){const p=(' + privateProbe.toString() + ')();return p.name===' + JSON.stringify(expected.alphaName) +
        '&&p.city==="683506"&&p.needs.includes("utilities")&&p.cards.some(c=>c.id===' + JSON.stringify(expected.technology) +
        ')&&p.cards.some(c=>c.id===' + JSON.stringify(expected.utility) + ');})()', 'ISOLATED_RESTORE');
      assert.equal(await dailyMemory(second.call, evaluate), 'null', 'fresh browser context has no inherited browser-only DailyState');
      assert.deepEqual(fixture.profile(A), savedA, 'restoring profile in a new browser context is read-only');
    } finally {await second.close(); await call('Page.bringToFront');}
    await awaitCards(A, [expected.utility, expected.technology]);
    await reload(B, [expected.weather, expected.science]);
    const bravo = await probe();
    assert.equal(bravo.cards.some(card => card.id === expected.utility || card.id === expected.technology), false);
    assert.ok(bravo.cards.find(card => card.id === expected.science)?.urls.includes(expected.scienceUrl));
    assert.deepEqual(bravo.needs, ['weather']);
    assert.deepEqual(bravo.interests, ['science']);
    assert.equal(bravo.name.includes('ALPHA'), false);

    // A delayed A profile response must never be painted under B, even when the
    // account change has no BroadcastChannel notification.
    await reload(A, [expected.utility, expected.technology]);
    const readGate = fixture.holdNext('wallet-read');
    await click('#wallet-reload'); await readGate.entered();
    emptyPrivate(await probe());
    await evaluate(call, '(function(){window.__dlktPersonalLeaks=[];const check=()=>{' +
      'const p=(' + privateProbe.toString() + ')();if(p.name.includes("QA_ALPHA")||p.cards.some(c=>' +
      JSON.stringify([expected.utility, expected.technology]) + '.includes(c.id)))window.__dlktPersonalLeaks.push("prior-owner");};' +
      'window.__dlktPersonalObserver=new MutationObserver(check);window.__dlktPersonalObserver.observe(document.body,{subtree:true,childList:true,attributes:true});return true;})()');
    await setCookie(call, origin, B); readGate.release();
    await waitFor(call, evaluate, 'document.getElementById("wallet-reload").disabled===false', 'READ_OWNER_CHANGED');
    emptyPrivate(await probe());
    assert.deepEqual(await evaluate(call, 'window.__dlktPersonalLeaks'), [], 'no transient prior-owner private DOM is observed');
    await evaluate(call, '(function(){window.__dlktPersonalObserver.disconnect();delete window.__dlktPersonalObserver;delete window.__dlktPersonalLeaks;return true;})()');
    await reload(B, [expected.weather, expected.science]);

    // The rendered A account has no profile and therefore a null CAS revision.
    // B is also empty: without owner binding the write could wrongly succeed.
    const originalBravo = fixture.profile(B);
    fixture.replaceProfile(A, null); fixture.replaceProfile(B, null);
    await setCookie(call, origin, A); await click('#wallet-reload');
    await waitFor(call, evaluate, 'document.getElementById("wallet-profile-panel").hidden===false&&!document.getElementById("wallet-save").disabled', 'EMPTY_ACCOUNT_A');
    await fill(call, evaluate, {displayName: 'QA_ALPHA_UNSAVED', cityId: '683506', localNeeds: ['utilities'], interests: ['technology']});
    const beforeWrites = fixture.writes.length, requestOffset = fixture.requests.length;
    await setCookie(call, origin, B);
    await click('#wallet-save');
    await waitFor(call, evaluate, 'document.getElementById("wallet-reload").disabled===false', 'NULL_CAS_OWNER_CHANGED');
    assert.equal(fixture.profile(B), null, 'the empty B account cannot receive A preferences after a null-revision owner race');
    assert.equal(fixture.writes.length, beforeWrites, 'owner race produces no profile write');
    emptyPrivate(await probe());
    const raced = fixture.requests.slice(requestOffset).filter(request => request.path === '/api/wallet' && request.method === 'PUT');
    assert.equal(raced.length, 1, 'the race reaches the private save boundary');
    assert.ok(raced.every(request => request.ownerHeader === A && request.owner === B && request.status === 409),
      'the actual raced request carries the captured owner and is rejected');
    fixture.replaceProfile(A, savedA); fixture.replaceProfile(B, originalBravo);
    await reload(A, [expected.utility, expected.technology]);

    // A write already accepted for A may finish after switching to B. Its ACK
    // must not paint A details or trigger a new selection under B.
    const saveGate = fixture.holdNext('wallet-save'), acceptedWrites = fixture.writes.length;
    await click('#wallet-save'); await saveGate.entered();
    emptyPrivate(await probe());
    const acceptedA = fixture.profile(A);
    assert.notEqual(acceptedA.revision, savedA.revision, 'the fixture holds a real accepted write acknowledgement');
    assert.deepEqual(acceptedA.value, savedA.value);
    await setCookie(call, origin, B); saveGate.release();
    await waitFor(call, evaluate, 'document.getElementById("wallet-reload").disabled===false', 'LATE_SAVE_OWNER_CHANGED');
    emptyPrivate(await probe());
    assert.deepEqual(fixture.profile(B), originalBravo, 'the accepted A write does not modify B');
    assert.equal(fixture.writes.length, acceptedWrites + 1, 'only the already accepted A write exists');
    savedA = acceptedA;
    await reload(A, [expected.utility, expected.technology]);

    // Public source requests can finish after another session changes the
    // canonical profile. The post-fetch private revision check must clear UI.
    const revisionGate = fixture.holdNext('topics');
    await click('#wallet-personal-refresh'); await revisionGate.entered();
    fixture.replaceProfile(A, {...savedA, revision: randomUUID()});
    revisionGate.release();
    await waitFor(call, evaluate, '(function(){const p=(' + privateProbe.toString() + ')();return p.profileHidden&&p.personalHidden&&!document.getElementById("wallet-reload").disabled;})()', 'SOURCE_PROFILE_CHANGED');
    emptyPrivate(await probe());
    fixture.replaceProfile(A, savedA);
    await reload(A, [expected.utility, expected.technology]);

    // Hold the reader's final profile verification, after its public sources
    // have loaded. A late A acknowledgement must be followed by an owner check.
    const finalReadGate = fixture.holdNext('wallet-read');
    await click('#wallet-personal-refresh'); await finalReadGate.entered();
    assert.deepEqual((await probe()).cards, [], 'the reader withholds cards while its final private read is pending');
    await setCookie(call, origin, B); finalReadGate.release();
    await waitFor(call, evaluate, '(function(){const p=(' + privateProbe.toString() + ')();return p.profileHidden&&p.personalHidden&&!document.getElementById("wallet-reload").disabled;})()', 'FINAL_READER_OWNER_CHANGED');
    emptyPrivate(await probe());
    await reload(A, [expected.utility, expected.technology]);

    const memoryBeforeRacedSave = await evaluate(call, '(async function(){const {DeviceMemory}=await import("/device-memory.js");return await new DeviceMemory().read();})()');
    const cardSaveGate = fixture.holdNext('wallet-read');
    await click('[data-personal-save="' + savedId + '"]'); await cardSaveGate.entered();
    await setCookie(call, origin, B); cardSaveGate.release();
    await waitFor(call, evaluate, '(function(){const p=(' + privateProbe.toString() + ')();return p.profileHidden&&p.personalHidden&&!document.getElementById("wallet-reload").disabled;})()', 'SAVE_CARD_OWNER_CHANGED');
    emptyPrivate(await probe());
    const memoryAfterRacedSave = await evaluate(call, '(async function(){const {DeviceMemory}=await import("/device-memory.js");return await new DeviceMemory().read();})()');
    assert.deepEqual(memoryAfterRacedSave, memoryBeforeRacedSave, 'late confirmation under another owner cannot save or replace a public source card');
    await reload(A, [expected.utility, expected.technology]);

    // Exercise the actual 20-second production deadline. No virtual clock or
    // shortened timeout is installed in the browser.
    const beforeTimedSave = await evaluate(call, '(async function(){const {DeviceMemory}=await import("/device-memory.js");return await new DeviceMemory().read();})()');
    const timeoutGate = fixture.holdNext('wallet-read'), timeoutStarted = Date.now();
    await click('[data-personal-save="' + savedId + '"]'); await timeoutGate.entered();
    await waitFor(call, evaluate, '(function(){const p=(' + privateProbe.toString() + ')();return p.profileHidden&&p.personalHidden&&!document.getElementById("wallet-reload").disabled;})()', 'SAVE_CARD_REAL_TIMEOUT', 23000);
    assert.ok(Date.now() - timeoutStarted >= 19000, 'the production timeout was exercised without accelerating time');
    emptyPrivate(await probe());
    const afterTimedSave = await evaluate(call, '(async function(){const {DeviceMemory}=await import("/device-memory.js");return await new DeviceMemory().read();})()');
    assert.deepEqual(afterTimedSave, beforeTimedSave, 'timed-out confirmation cannot create or replace a saved public card');
    timeoutGate.release();
    await reload(A, [expected.utility, expected.technology]);

    fixture.failNext('wallet-read', 503);
    await click('#wallet-reload');
    await waitFor(call, evaluate, 'document.getElementById("wallet-reload").disabled===false', 'FAILED_PROFILE_READ');
    emptyPrivate(await probe());
    await reload(A, [expected.utility, expected.technology]);

    fixture.failNext('local', 503);
    await click('#wallet-personal-refresh');
    await waitFor(call, evaluate, '(function(){const p=(' + privateProbe.toString() + ')();return p.cards.some(c=>c.id===' +
      JSON.stringify(expected.technology) + ')&&!p.cards.some(c=>c.id===' + JSON.stringify(expected.utility) + ');})()', 'PARTIAL_SOURCE');
    assert.ok((await probe()).coverage.trim(), 'failed local transport retains explicit coverage information');
    assert.equal(fixture.profile(A).revision, savedA.revision, 'source availability never rewrites the personal profile');

    fixture.expireUtilitiesAfter(4000);
    await click('#wallet-personal-refresh'); await awaitCards(A, [expected.utility, expected.technology]);
    await focusSelector(call, technologyDetails + ' > summary'); await keyboard(call, 'Enter');
    assert.equal(await evaluate(call, 'document.querySelector(' + JSON.stringify(technologyDetails) + ').open'), true);
    await evaluate(call, '(function(){window.__dlktExpiryTopic=document.querySelector(\'[data-personal-id="' + expected.technology + '"]\');window.__dlktExpiryDetails=document.querySelector(' + JSON.stringify(technologyDetails) + ');return true;})()');
    await waitFor(call, evaluate, '(function(){const p=(' + privateProbe.toString() + ')();return !p.cards.some(c=>c.id===' +
      JSON.stringify(expected.utility) + ')&&p.cards.some(c=>c.id===' + JSON.stringify(expected.technology) + ');})()', 'REAL_TIMER_EXPIRY', 6500);
    assert.equal(await evaluate(call, '(function(){return window.__dlktExpiryTopic===document.querySelector(\'[data-personal-id="' + expected.technology + '"]\')&&window.__dlktExpiryDetails===document.querySelector(' + JSON.stringify(technologyDetails) + ')&&window.__dlktExpiryDetails.open;})()'), true, 'expiry removes the stale local card while retaining an unchanged topic node and its open details');
    await evaluate(call, '(function(){delete window.__dlktExpiryTopic;delete window.__dlktExpiryDetails;return true;})()');
    fixture.expireUtilitiesAfter(300000);

    await click('#wallet-personal-refresh'); await awaitCards(A, [expected.utility, expected.technology]);
    const blurGate = fixture.holdNext('topics');
    await click('#wallet-personal-refresh'); await blurGate.entered();
    await evaluate(call, '(function(){window.dispatchEvent(new Event("blur"));return true;})()');
    emptyPrivate(await probe()); blurGate.release(); await pause(150); emptyPrivate(await probe());
    await evaluate(call, '(function(){window.dispatchEvent(new Event("focus"));return true;})()');
    await awaitCards(A, [expected.utility, expected.technology]);

    const beforeDeleteWrites = fixture.writes.length, preservedBravo = fixture.profile(B);
    await click('#wallet-delete');
    assert.equal(await evaluate(call, 'document.getElementById("wallet-delete-confirmation").hidden'), false, 'deletion requires its existing explicit confirmation');
    assert.equal(fixture.writes.length, beforeDeleteWrites, 'opening confirmation does not mutate the profile');
    await click('#wallet-delete-cancel');
    assert.deepEqual(fixture.profile(A), savedA, 'cancelling deletion preserves the account profile');
    await click('#wallet-delete'); await click('#wallet-delete-confirm');
    await waitFor(call, evaluate, '!document.getElementById("wallet-save").disabled&&document.getElementById("wallet-profile-panel").hidden===false&&document.getElementById("wallet-personal").hidden===true', 'DELETE_PROFILE');
    const deleted = await probe();
    assert.equal(fixture.profile(A), null, 'explicit confirmed delete removes only A preferences');
    assert.deepEqual(fixture.profile(B), preservedBravo, 'deleting A preferences does not modify B');
    assert.equal(deleted.name, ''); assert.equal(deleted.city, '');
    assert.deepEqual(deleted.needs, []); assert.deepEqual(deleted.interests, []);
    assert.deepEqual(deleted.cards, []); assert.equal(deleted.coverage, '');
    fixture.replaceProfile(A, savedA); await reload(A, [expected.utility, expected.technology]);

    const signoutGate = fixture.holdNext('topics');
    await click('#wallet-personal-refresh'); await signoutGate.entered();
    await click('#wallet-signout');
    await waitFor(call, evaluate, 'document.getElementById("wallet-signin").hidden===false', 'SIGNOUT');
    emptyPrivate(await probe()); signoutGate.release(); await pause(150); emptyPrivate(await probe());
    assert.equal(await dailyMemory(call, evaluate), originalDaily, 'the full private profile journey leaves browser-only DailyState unchanged');

    const publicRequests = fixture.requests.filter(request => ['/api/places', '/api/local', '/api/iceo'].includes(request.path));
    assert.ok(publicRequests.length > 0);
    assert.ok(publicRequests.every(request => !request.hasCookie && !request.hasAuthorization && request.ownerHeader === null),
      'source requests omit cookies, Authorization and private owner headers');
    assert.ok(publicRequests.every(request => !request.query.includes(A) && !request.query.includes(B)
      && !/interests|localNeeds|displayName|QA_ALPHA|QA_BRAVO/iu.test(request.query)), 'public source URLs contain no private profile fields');
    const signedInWalletReads = fixture.requests.filter(request => request.path === '/api/wallet' && request.owner !== null);
    assert.ok(signedInWalletReads.every(request => request.ownerHeader !== null), 'every new private Wallet operation carries its verified expected owner');
    return {
      status: 'CONTROLLED_PERSONAL_PROFILE_PASS', viewports: observations,
      legacyReadWithoutWrite: true, explicitSaveBeforeSelection: true,
      boundedScrollingPagination: true, explicitPublicCardSaveOnly: true, confirmedProfileDeletion: true,
      globalInterestAndLocalNeed: true, distinctAccountSelections: true,
      isolatedBrowserRestoration: true, delayedReadOwnerRace: true, nullRevisionSaveOwnerRace: true,
      delayedSaveOwnerRace: true, sourceCompletionRevalidatesRevision: true,
      finalReaderOwnerRevalidation: true, sourceCardSaveOwnerRevalidation: true, actualSaveTimeout: true, stableMoreAndExpiryNodes: true,
      profileRequestFailureClearsPrivate: true, partialSourceStateVisible: true,
      actualTimerExpiry: true, simulatedBlurClearsLateResults: true, signoutClearsLateResults: true,
      browserDailyStateUnchanged: true, publicRequestsWithoutCredentials: true,
      scope: 'Actual compiled Wallet and personal-card controllers in Chromium over bounded synthetic loopback transport; two independent browser contexts.',
      limitations: [
        'Synthetic QA cookies are not Supabase authentication, OTP delivery, live-account isolation or a hosted integration test.',
        'The browser transport fixture is not evidence of backend owner-header enforcement; actual API and PGlite tests cover that boundary separately.',
        'Source cards and source-check timestamps are controlled fixtures, not live publisher or utility checks.',
        'Blur is dispatched as a browser lifecycle event; physical Safari/iPhone and operating-system focus transitions are not certified.',
      ],
    };
  } catch (error) {
    try {
      const state = await probe();
      writeFileSync(join(outputDir, 'failed-personal-wallet.json'), JSON.stringify({state, fixtureErrors: fixture.errors}, null, 2) + '\n', {mode: 0o600});
      console.error('DLKT_PERSONAL_BROWSER_FAILURE', JSON.stringify({state, fixtureErrors: fixture.errors}));
      const image = (await call('Page.captureScreenshot', {format: 'png', fromSurface: true, captureBeyondViewport: false})).data;
      if (typeof image === 'string') writeFileSync(join(outputDir, 'failed-personal-wallet.png'), Buffer.from(image, 'base64'), {mode: 0o600});
    } catch {/* Preserve the original failed assertion. */}
    throw error;
  } finally {fixture.deactivate();}
}

function accountPreferencesProbe(){
 const must=selector=>{const node=document.querySelector(selector);if(!node)throw Error('QA_ACCOUNT_ELEMENT_MISSING:'+selector);return node;};
 const visible=node=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none';
 const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
 const lines=node=>{
  const result=[],tree=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let child;
  while((child=tree.nextNode())){
   const raw=child.textContent??'';if(!raw.trim()||!child.parentElement||!visible(child.parentElement))continue;
   const range=document.createRange();range.setStart(child,raw.search(/\S/u));range.setEnd(child,raw.search(/\s*$/u));
   for(const r of range.getClientRects())if(r.width>0&&r.height>0)result.push(r);
  }return result;
 };
 const textFits=node=>{const r=box(node),text=lines(node);return text.length>0&&text.every(t=>t.left>=r.left-1&&t.right<=r.right+1&&t.top>=r.top-1&&t.bottom<=r.bottom+1);};
 const paint=node=>{const s=getComputedStyle(node);return {background:s.backgroundColor,border:s.borderColor,outline:s.outline,outlineStyle:s.outlineStyle,outlineWidth:parseFloat(s.outlineWidth),outlineColor:s.outlineColor,shadow:s.boxShadow};};
 const group=id=>{
  const root=must('#'+id),choices=[...root.querySelectorAll('input')].map(input=>{
   const label=input.closest('label');if(!label)throw Error('QA_ACCOUNT_LABEL_MISSING:'+input.value);
   return {value:input.value,type:input.type,checked:input.checked,disabled:input.disabled,associated:[...(input.labels??[])].includes(label),
    visible:visible(label),text:label.textContent.trim(),textFits:textFits(label),...box(label),inputPaint:paint(input),labelPaint:paint(label),
    focused:document.activeElement===input,focusVisible:input.matches(':focus-visible')};
  });return {id,grid:root.classList.contains('account-choice-grid'),...box(root),choices};
 };
 const root=must('main.account-page'),form=must('#account-profile-form'),locale=must('#account-profile-locale'),city=must('#account-profile-city');
 const needs=group('account-profile-local-needs'),interests=group('account-profile-interests');
 const textFont=selector=>{
  const node=must(selector),tree=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let child;
  while((child=tree.nextNode()))if(child.textContent?.trim()&&child.parentElement)return parseFloat(getComputedStyle(child.parentElement).fontSize);
  throw Error('QA_ACCOUNT_TEXT_MISSING:'+selector);
 };
 const images=[...document.querySelectorAll('.account-welcome .account-kate img,#account-profile .account-section-heading img')].map(node=>({complete:node.complete,naturalWidth:node.naturalWidth,naturalHeight:node.naturalHeight,...box(node)}));
 const fields=['account-profile-name','account-profile-locale','account-profile-timezone'].map(id=>{const node=must('#'+id);return {id,...box(node),fontSize:parseFloat(getComputedStyle(node).fontSize)};});
 const save=must('#account-profile-save'),saveStyle=getComputedStyle(save);
 return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.readerTheme,
  root:box(root),interfaceLocale:document.documentElement.lang,formVisible:visible(form),panelHidden:must('#account-data').hidden,name:must('#account-profile-name').value,
  locale:locale.value,localeTag:locale.tagName,localeOptions:[...locale.options].map(option=>option.value),timezone:must('#account-profile-timezone').value,
  city:city.checked?city.value:'',cityLabelText:must('#account-profile-city-name').textContent.trim(),
  needs:needs.choices.filter(choice=>choice.checked).map(choice=>choice.value),interests:interests.choices.filter(choice=>choice.checked).map(choice=>choice.value),
  groups:[needs,interests],fields,images,welcomeText:must('#account-value').textContent.trim(),journeyCount:document.querySelectorAll('.account-journey>span').length,
  summary:must('#account-profile-summary').textContent.trim(),privateMessage:must('#account-profile-message').textContent.trim(),
  save:{disabled:save.disabled,visible:visible(save),textFits:textFits(save),paddingStart:parseFloat(saveStyle.paddingInlineStart),paddingEnd:parseFloat(saveStyle.paddingInlineEnd),...box(save)},
  fonts:{value:textFont('#account-value'),need:textFont('#account-profile-local-needs label'),interest:textFont('#account-profile-interests label'),save:textFont('#account-profile-save')}};
}
function assertAccountPreferencesLayout(state,width,expected){
 assert.equal(state.width,width);assert.equal(state.formVisible,true);assert.equal(state.localeTag,'SELECT');
 assert.ok(state.welcomeText.length>0);assert.equal(state.journeyCount,4);assert.equal(state.images.length,2);
 assert.ok(state.images.every(image=>image.complete&&image.naturalWidth>0&&image.naturalHeight>0),'both Kate images load');
 assert.ok(state.documentWidth<=width+2,'account has no horizontal document overflow');
 assert.equal(state.interfaceLocale,'ro','controlled account keeps the selected Romanian interface');
 assert.ok(state.fonts.need>=14&&state.fonts.interest>=14,'choice labels retain readable 14px type rather than inherited helper text');
 for(const [groupIndex,value,text]of [[0,'administration','Administratie'],[0,'local-reporting','Stiri locale'],[1,'business','Afaceri']])assert.equal(state.groups[groupIndex].choices.find(choice=>choice.value===value)?.text,text,'Romanian choice labels are rendered in the selected language');
 const inside=node=>node.left>=-1&&node.right<=width+1;assert.ok(inside(state.root));
 for(const field of state.fields)assert.ok(inside(field)&&field.height>=43.5&&field.fontSize>=16,'readable profile field: '+JSON.stringify(field));
 const canonical=[expected.accountNeeds,expected.accountInterests];
 for(let i=0;i<state.groups.length;i++){
  const group=state.groups[i],values=group.choices.map(choice=>choice.value);assert.equal(group.grid,true);assert.ok(inside(group));
  assert.ok(Math.abs(group.left-state.fields[0].left)<=1&&Math.abs(group.right-state.fields[0].right)<=1,'each choice grid uses the full form width, with aligned field edges');
  assert.deepEqual([...values].sort(),[...canonical[i]].sort(),'every canonical option appears exactly once');assert.equal(new Set(values).size,values.length);
  for(const choice of group.choices)assert.ok(choice.type==='checkbox'&&choice.associated&&choice.visible&&!choice.disabled&&choice.text&&choice.textFits&&inside(choice)&&choice.width>=43.5&&choice.height>=43.5&&choice.left>=group.left-1&&choice.right<=group.right+1,'native choice has a complete label: '+JSON.stringify(choice));
  for(let a=0;a<group.choices.length;a++)for(let b=a+1;b<group.choices.length;b++){const x=group.choices[a],y=group.choices[b];
   assert.ok(Math.min(x.right,y.right)-Math.max(x.left,y.left)<=1||Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)<=1,'choice cards do not overlap');}
 }
 assert.ok(state.save.visible&&!state.save.disabled&&state.save.textFits&&inside(state.save)&&state.save.width>=43.5&&state.save.height>=43.5&&state.save.paddingStart>=12&&state.save.paddingEnd>=12,'Save keeps full label and internal space');
}
function assertEmptyAccountPreferences(state,defaultOptions){
 assert.equal(state.formVisible,false);assert.equal(state.panelHidden,true);assert.equal(state.name,'');assert.equal(state.locale,'');assert.equal(state.timezone,'');assert.equal(state.city,'');
 assert.deepEqual(state.needs,[]);assert.deepEqual(state.interests,[]);assert.equal(state.summary,'');assert.equal(state.privateMessage,'');
 assert.deepEqual([...state.localeOptions].sort(),[...defaultOptions].sort(),'temporary private locale options are removed');
}
/** Actual compiled account UI over isolated synthetic loopback transport. */
export async function verifyAccountPreferencesFlow({call,origin,fixture,evaluate,loaded,focusSelector,keyboard,outputDir,emitVisualPreview,actionSpacingProbe,assertActionSpacing,contrastProbe,startTypographyStress,restoreTypographyStress}){
 assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/u);
 const {parseWalletProfile,WALLET_PROFILE_VERSION}=await import('../source/.build/src/wallet/contracts.js');
 const {LOCALES}=await import('../source/.build/src/i18n/locale.js');
 const originalA=fixture.profile(A),originalB=fixture.profile(B);assert.ok(originalA!==null);
 const writesBefore=fixture.writes.length,requestOffset=fixture.requests.length,errorOffset=fixture.errors.length;
 const observations=[],screenshots=[],variant='en-GB',defaultOptions=['',...LOCALES.map(locale=>locale.code)];
 const probe=()=>evaluate(call,'('+accountPreferencesProbe.toString()+')()');
 const click=selector=>activate(call,evaluate,focusSelector,keyboard,selector);
 const ready=async locale=>waitFor(call,evaluate,'(function(){const form=document.getElementById("account-profile-form"),save=document.getElementById("account-profile-save");return Boolean(form&&form.getClientRects().length&&save&&!save.disabled&&document.getElementById("account-profile-name").value==='+JSON.stringify(originalA.value.displayName)+'&&document.getElementById("account-profile-locale").value==='+JSON.stringify(locale)+');})()','ACCOUNT_PROFILE_'+locale);
 const setTheme=theme=>evaluate(call,'(function(theme){document.documentElement.dataset.readerTheme=theme;return true;})('+JSON.stringify(theme)+')');
 const resize=width=>call('Emulation.setDeviceMetricsOverride',{width,height:width===1440?900:width===768?1024:844,deviceScaleFactor:1,mobile:width<768,scale:1});
 const measure=async(width,theme,mode='normal')=>{
  await resize(width);await setTheme(theme);const state=await probe();assertAccountPreferencesLayout(state,width,fixture.expected);assert.equal(state.theme,theme);
  const spacing=await evaluate(call,'('+actionSpacingProbe.toString()+')()');assertActionSpacing(spacing,{width});
  const contrast=await evaluate(call,'('+contrastProbe.toString()+')({allCards:true,rootSelector:".account-welcome,#account-profile"})');
  assert.ok(contrast.samples.length>=fixture.expected.accountNeeds.length+fixture.expected.accountInterests.length,'contrast covers choice labels');
  for(const sample of contrast.samples)assert.ok(sample.ratio!==null&&sample.ratio+.01>=sample.minimum,'account text contrast: '+JSON.stringify(sample));
  observations.push({width,theme,mode,state,spacing,contrast});return state;
 };
 const capture=async width=>{
  await evaluate(call,'(function(){window.scrollTo(0,0);return true;})()');
  const height=await evaluate(call,'Math.ceil(Math.max(document.documentElement.scrollHeight,document.body.scrollHeight))');
  assert.ok(height>0&&height<=16000,'bounded account screenshot');
  const data=(await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}})).data;
  assert.ok(typeof data==='string'&&data.length>1000);
  const filename='dlkt-account-preferences-'+width+'.png';writeFileSync(join(outputDir,filename),Buffer.from(data,'base64'),{mode:0o600});screenshots.push(filename);
  await evaluate(call,'(function(){document.getElementById("account-profile").scrollIntoView({block:"start"});return true;})()');
  await emitVisualPreview(call,'account-profile',width);
 };
 let originalTheme=null,typographyActive=false;fixture.activate();
 try{
  await call('Page.bringToFront');await resize(390);await setCookie(call,origin,A);await call('Page.navigate',{url:origin+'/account'});await loaded(call);await ready(originalA.value.locale);
  const baseline=await probe();originalTheme=baseline.theme??null;assert.equal(defaultOptions.includes(variant),false);
  const seeded={version:WALLET_PROFILE_VERSION,revision:randomUUID(),updatedAt:new Date().toISOString(),value:parseWalletProfile({...originalA.value,locale:variant,cityId:'683506',localNeeds:['utilities'],interests:['technology']})};
  assert.equal(seeded.value.locale,variant);fixture.replaceProfile(A,seeded);await click('#account-reload');await ready(variant);
  assert.equal((await probe()).localeOptions.filter(value=>value===variant).length,1);assert.equal(fixture.writes.length,writesBefore);
  for(const groupIndex of [0,1]){
   const before=await probe(),group=before.groups[groupIndex],choice=group.choices.find(option=>!option.checked);assert.ok(choice);
   const selector='#'+group.id+' input[type="checkbox"][value='+JSON.stringify(choice.value)+']';
   const point=await evaluate(call,'(function(selector){const input=document.querySelector(selector),label=input?.closest("label");if(!input||!label)throw Error("QA_ACCOUNT_CLICK_LABEL_MISSING");label.scrollIntoView({block:"center"});const tree=document.createTreeWalker(label,NodeFilter.SHOW_TEXT);let n;while((n=tree.nextNode())){const raw=n.textContent??"";if(!raw.trim())continue;const r=document.createRange();r.setStart(n,raw.search(/\\S/u));r.setEnd(n,raw.search(/\\s*$/u));const line=[...r.getClientRects()].find(x=>x.width>0&&x.height>0);if(line){const x=(line.left+line.right)/2,y=(line.top+line.bottom)/2;const hit=document.elementFromPoint(x,y);if(!hit||!label.contains(hit))throw Error("QA_ACCOUNT_LABEL_OBSCURED");return {x,y};}}throw Error("QA_ACCOUNT_LABEL_TEXT_MISSING");})('+JSON.stringify(selector)+')');
   await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
   await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
   await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
   const clicked=await probe(),expectedSelected=[...group.choices.filter(option=>option.checked).map(option=>option.value),choice.value].sort();
   assert.deepEqual(clicked.groups[groupIndex].choices.filter(option=>option.checked).map(option=>option.value).sort(),expectedSelected);
   assert.deepEqual(clicked.groups[1-groupIndex].choices.map(option=>option.checked),before.groups[1-groupIndex].choices.map(option=>option.checked));
   const resting=clicked.groups[groupIndex].choices.find(option=>option.value===choice.value);
   await focusSelector(call,'#account-profile-timezone');let reached=false;
   for(let i=0;i<fixture.expected.accountNeeds.length+fixture.expected.accountInterests.length+12;i++){
    await keyboard(call,'Tab');if(await evaluate(call,'document.activeElement===document.querySelector('+JSON.stringify(selector)+')')){reached=true;break;}
   }
   assert.equal(reached,true);const focused=(await probe()).groups[groupIndex].choices.find(option=>option.value===choice.value);
   assert.equal(focused.focusVisible,true);
   const visibleOutline=paint=>paint.outlineWidth>=1&&!['none','hidden'].includes(paint.outlineStyle)&&paint.outlineColor.replaceAll(' ','')!=='rgba(0,0,0,0)'&&paint.outlineColor!=='transparent';
   assert.ok(visibleOutline(focused.inputPaint)||visibleOutline(focused.labelPaint)||focused.inputPaint.shadow!==resting.inputPaint.shadow||focused.labelPaint.shadow!==resting.labelPaint.shadow);
   await keyboard(call,'Space');assert.deepEqual((await probe()).groups[groupIndex].choices.map(option=>option.checked),group.choices.map(option=>option.checked));
   assert.equal(await evaluate(call,'document.activeElement===document.querySelector('+JSON.stringify(selector)+')'),true);
   await keyboard(call,'Space');assert.deepEqual((await probe()).groups[groupIndex].choices.filter(option=>option.checked).map(option=>option.value).sort(),expectedSelected);
   assert.equal(fixture.writes.length,writesBefore,'label and keyboard selection never autosave');
  }
  for(const width of [320,390,768,1440]){await measure(width,'prism');if(width===390||width===1440)await capture(width);}
  for(const width of [390,1440])await measure(width,'night');
  await resize(390);await setTheme('prism');const beforeFonts=(await probe()).fonts;
  const typography=await evaluate(call,'('+startTypographyStress.toString()+')()');typographyActive=true;
  try{const enlarged=await measure(390,'prism','computed-font-size-times-two');for(const [name,size]of Object.entries(beforeFonts))assert.ok(Math.abs(enlarged.fonts[name]-size*2)<.02,'account font doubles: '+name);}
  finally{assert.equal(await evaluate(call,'('+restoreTypographyStress.toString()+')()'),true);typographyActive=false;}
  const selected=await probe(),expectedValue=parseWalletProfile({...seeded.value,displayName:selected.name.trim()||null,locale:selected.locale,timezone:selected.timezone,cityId:selected.city||null,localNeeds:selected.needs,interests:selected.interests});
  const saveGate=fixture.holdNext('wallet-save');await click('#account-profile-save');await saveGate.entered();
  assert.equal(fixture.writes.length,writesBefore+1);const write=fixture.writes.at(-1),accepted=fixture.profile(A);
  assert.equal(write.owner,A);assert.equal(write.method,'PUT');assert.equal(write.expectedRevision,seeded.revision);
  assert.deepEqual(write.value,expectedValue);assert.deepEqual(accepted.value,expectedValue);assert.notEqual(accepted.revision,seeded.revision);assert.deepEqual(fixture.profile(B),originalB);
  assert.equal((await probe()).formVisible,false);saveGate.release();await ready(variant);assert.ok((await probe()).summary.includes(accepted.updatedAt));
  const reloadGate=fixture.holdNext('wallet-read');await click('#account-reload');await reloadGate.entered();assert.equal((await probe()).formVisible,false);reloadGate.release();await ready(variant);
  const restored=await probe();assert.deepEqual([...restored.needs].sort(),[...expectedValue.localNeeds].sort());assert.deepEqual([...restored.interests].sort(),[...expectedValue.interests].sort());assert.equal(restored.locale,variant);assert.equal(fixture.writes.length,writesBefore+1);
  await evaluate(call,'(function(){window.dispatchEvent(new Event("blur"));return true;})()');assertEmptyAccountPreferences(await probe(),defaultOptions);
  const readGate=fixture.holdNext('wallet-read');await evaluate(call,'(function(){window.dispatchEvent(new Event("focus"));return true;})()');await readGate.entered();
  await evaluate(call,'(function(){window.dispatchEvent(new Event("blur"));return true;})()');assertEmptyAccountPreferences(await probe(),defaultOptions);
  const lateRead=[...fixture.requests].reverse().find(request=>request.path==='/api/wallet'&&request.method==='GET'&&request.status===null);assert.ok(lateRead);
  readGate.release();const responseDeadline=Date.now()+8000;while(lateRead.status===null&&Date.now()<responseDeadline)await pause(20);assert.equal(lateRead.status,200);
  await bounded(evaluate(call,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'),'ACCOUNT_LATE_READ_FRAMES');
  assertEmptyAccountPreferences(await probe(),defaultOptions);
  const requests=fixture.requests.slice(requestOffset),copies=requests.filter(request=>request.path==='/api/account');
  assert.ok(copies.length>=3&&copies.every(request=>request.method==='GET'&&request.owner===A&&request.status===200));
  assert.ok(requests.filter(request=>request.path==='/api/account-session').every(request=>request.method==='GET'),'no OTP is requested or verified');
  assert.ok(requests.filter(request=>request.path==='/api/wallet').every(request=>request.ownerHeader===A));
  assert.deepEqual(fixture.errors.slice(errorOffset),[]);assert.equal(fixture.writes.length,writesBefore+1);assert.deepEqual(fixture.profile(B),originalB);
  return {status:'CONTROLLED_ACCOUNT_PREFERENCES_PASS',viewports:observations,screenshots,nativeLabelAndKeyboard:true,explicitAcknowledgedSave:true,localeVariant:variant,reloadRetainsSelections:true,
   simulatedBlurClearsPrivateAndLateRead:true,typography:{mode:typography.mode,nativeBrowserZoom:false,elementCount:typography.elementCount},
   scope:'Actual compiled account form over synthetic loopback identity, null reader-copy and Wallet profile transport.',
   limitations:['No hosted authentication, OTP request, email delivery or account isolation is exercised.','Themes are controlled CSS tokens; existing reader tests exercise the actual theme toggle.','Font doubling and dispatched lifecycle events do not certify physical device zoom or operating-system focus behavior.']};
 }finally{
  if(typographyActive)await evaluate(call,'('+restoreTypographyStress.toString()+')()').catch(()=>false);
  if(originalTheme!==null)await setTheme(originalTheme).catch(()=>false);
  fixture.replaceProfile(A,originalA);fixture.replaceProfile(B,originalB);fixture.deactivate();
 }
}
