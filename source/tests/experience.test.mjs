import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');

test('premium experience contains the finite briefing product architecture', () => {
  for (const file of ['public/index.html', 'public/styles.css', 'public/app.js', 'public/review.html', 'public/review.css', 'public/review.js', 'public/memory.html', 'public/memory.css', 'public/memory.js', 'public/memory-data.js', 'public/trust.html', 'public/trust.css', 'public/trust.js', 'public/trust-data.js', 'public/actions.html', 'public/actions.css', 'public/actions.js', 'public/action-data.js', 'public/favicon.svg', 'public/manifest.webmanifest', 'public/robots.txt']) {
    assert.equal(existsSync(file), true, `${file} must exist`);
  }
  const html = read('public/index.html');
  assert.match(html, /DLKT/u);
  assert.match(html, /Information[\s\S]*that matters/u);
  assert.match(html, /id="companion-form"/u);
  assert.match(html, /Tell it what matters/u);
  assert.match(html, /id="account-panel"/u);
  assert.match(html, /data-account-email-form/u);
  assert.match(html, /data-account-code-form/u);
  assert.match(html, /data-save-companion/u);
  assert.match(html, /HttpOnly/u);
  assert.ok((html.match(/href="\/companion"/gu) ?? []).length >= 2);
  assert.equal((html.match(/href="\/start">Build briefing<\/a>/gu) ?? []).length, 2);
  assert.match(html, /id="briefing"/u);
  assert.match(html, /InfoCard scroll/u);
  assert.match(html, /Synthetic data only|synthetic data only|synthetic product preview/u);
  assert.match(html, /The engine and data model are real[\s\S]*Live data is still disabled/u);
  assert.match(html, /<script src="\/app\.js" defer><\/script>/u);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/iu);
  assert.doesNotMatch(html, /<style\b/iu);
  assert.doesNotMatch(html, /https?:\/\//iu);
});

test('visual system is locked to the exact Kate logo palette and responsive accessibility contract', () => {
  const css = read('public/styles.css');
  const paletteAssets = [
    css,
    read('public/index.html'),
    read('public/start.html'),
    read('public/start.css'),
    read('public/review.html'),
    read('public/review.css'),
    read('public/review.js'),
    read('public/memory.html'),
    read('public/memory.css'),
    read('public/memory.js'),
    read('public/memory-data.js'),
    read('public/trust.html'),
    read('public/trust.css'),
    read('public/trust.js'),
    read('public/trust-data.js'),
    read('public/actions.html'),
    read('public/actions.css'),
    read('public/actions.js'),
    read('public/action-data.js'),
    read('public/favicon.svg'),
    read('public/manifest.webmanifest'),
  ].join('\n').toLowerCase();
  const directColors = [...new Set(paletteAssets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();

  assert.deepEqual(directColors, ['#000000', '#f66061', '#ffffff']);
  assert.match(css, /--dlkt-black:\s*#000000/iu);
  assert.match(css, /--dlkt-white:\s*#ffffff/iu);
  assert.match(css, /--dlkt-coral:\s*#f66061/iu);
  assert.match(css, /--red-deep:\s*color-mix\(in srgb, var\(--dlkt-coral\) 80%, var\(--dlkt-black\)\)/iu);
  assert.match(css, /\.primary-action[^}]*color:\s*var\(--black\)[^}]*background:\s*var\(--red\)/iu);
  assert.match(css, /\.status-section[^}]*color:\s*var\(--black\)[^}]*background:\s*var\(--red\)/iu);

  const rgb = (hex) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const luminance = (hex) => rgb(hex)
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (left, right) => {
    const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  const coralInk = '#c54d4e';
  assert.ok(contrast('#000000', '#f66061') >= 4.5);
  assert.ok(contrast(coralInk, '#ffffff') >= 4.5);

  assert.match(css, /@media \(max-width: 1320px\)[\s\S]*?\.desktop-nav, \.preview-badge \{ display: none; \}[\s\S]*?\.menu-toggle \{ display: inline-flex; \}/u);
  assert.match(css, /@media \(max-width: 1500px\) and \(min-width: 1321px\)[\s\S]*?\.desktop-nav \{ gap:[\s\S]*?\.preview-badge \{ display: none; \}/u);
  assert.match(css, /@media \(max-width: 560px\)/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(css, /:focus-visible/u);
  assert.doesNotMatch(css, /url\(/iu);
});

test('browser controller renders external data through DOM text APIs only', () => {
  const source = read('public/app.js');
  assert.match(source, /fetch\('\/api\/demo'/u);
  assert.match(source, /`\/companion\$\{bridge\.buildSearch\(preferences\)\}`/u);
  assert.doesNotMatch(source, /fetch\('\/api\/companion'/u);
  assert.match(source, /fetch\('\/api\/auth'/u);
  assert.match(source, /fetch\('\/api\/persistence'/u);
  assert.match(source, /X-DLKT-Info-Request':\s*'identity-v1'/u);
  assert.match(source, /X-DLKT-Info-Request':\s*'persistence-v1'/u);
  assert.match(source, /credentials:\s*'same-origin'/u);
  assert.match(source, /textContent/u);
  assert.match(source, /replaceChildren/u);
  assert.match(source, /noopener noreferrer/u);
  assert.match(source, /AbortSignal\.timeout\(10_000\)/u);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function/iu);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|access_token|refresh_token|Authorization/iu);
});

test('Vercel contract is staging-safe, same-origin and non-indexable', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.deepEqual(config.rewrites, [
    { source: '/', destination: '/index.html' },
    { source: '/briefing', destination: '/index.html' },
    { source: '/start', destination: '/start.html' },
    { source: '/companion', destination: '/companion.html' },
    { source: '/companion-preview', destination: '/companion-preview.html' },
    { source: '/live', destination: '/live.html' },
    { source: '/delta', destination: '/delta.html' },
    { source: '/review', destination: '/review.html' },
    { source: '/today', destination: '/today.html' },
    { source: '/history', destination: '/history.html' },
    { source: '/memory', destination: '/memory.html' },
    { source: '/trust', destination: '/trust.html' },
    { source: '/actions', destination: '/actions.html' },
    { source: '/inbox', destination: '/inbox.html' },
    { source: '/delivery', destination: '/delivery.html' },
  ]);
  assert.equal(config.functions['api/auth.ts'].maxDuration, 10);
  assert.equal(config.functions['api/persistence.ts'].maxDuration, 10);
  assert.equal(config.functions['api/eu-official-live.ts'].maxDuration, 15);
  assert.equal(config.functions['api/eu-official-delta.ts'].maxDuration, 15);
  assert.equal(config.functions['api/internal-delta-trial.ts'].maxDuration, 30);
  assert.equal(config.functions['api/internal-delta-review.ts'].maxDuration, 10);
  assert.equal(config.headers.find((entry) => entry.source === '/api/internal-delta-trial')?.headers[0]?.value, 'private, no-store');
  assert.equal(config.headers.find((entry) => entry.source === '/api/internal-delta-review')?.headers[0]?.value, 'private, no-store');
  assert.deepEqual(config.schedules['internal-delta-trial'], {
    schedule: '47 * * * *', path: '/api/internal-delta-trial', requestMethod: 'GET',
  });
  assert.equal(config.headers.find((entry) => entry.source === '/api/auth')?.headers[0]?.value, 'private, no-store');
  const global = config.headers.find((entry) => entry.source === '/(.*)');
  assert.ok(global);
  const headers = new Map(global.headers.map((entry) => [entry.key.toLowerCase(), entry.value]));
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('x-robots-tag'), 'noindex, nofollow');
  const csp = headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/u);
  assert.match(csp, /script-src 'self'/u);
  assert.match(csp, /style-src 'self'/u);
  assert.match(csp, /connect-src 'self'/u);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/u);
});

test('health contract distinguishes product and engine versions', async () => {
  const { default: health } = await import('../.build/api/health.js');
  const headers = new Map();
  let body = '';
  const response = {
    statusCode: 0,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
    end(value = '') { body = String(value); },
  };
  health({ method: 'GET' }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300');
  const payload = JSON.parse(body);
  assert.deepEqual({
    product: payload.product,
    productVersion: payload.productVersion,
    engine: payload.engine,
    engineVersion: payload.engineVersion,
    status: payload.status,
  }, {
    product: 'dlkt-info',
    productVersion: '0.9.46',
    engine: 'dlkt-info-inphocore-engine-orchestra',
    engineVersion: '0.1.0',
    status: 'operational-delta-ledger-ready',
  });
  assert.equal(payload.capabilities.includes('infocard-scroll'), true);
  assert.equal(payload.capabilities.includes('transactional-outbox'), true);
  assert.equal(payload.capabilities.includes('personal-companion-loop'), true);
  assert.equal(payload.capabilities.includes('dedicated-persistence-adapter'), true);
  assert.equal(payload.capabilities.includes('authenticated-companion-rpc'), true);
  assert.equal(payload.capabilities.includes('email-otp-identity'), true);
  assert.equal(payload.capabilities.includes('http-only-session'), true);
  assert.equal(payload.capabilities.includes('server-side-session-refresh'), true);
  assert.deepEqual(payload.briefingHistory, {
    version: 'dlkt-info-briefing-history-1',
    memoryVersion: 'dlkt-info-explainable-memory-1',
    route: '/history',
    mode: 'synthetic-finite-preview',
    maximumRuns: 7,
    browserStorage: false,
    realDataEnabled: false,
    rankExplanation: true,
    memoryExplanation: true,
    stableSignalsRepeated: false,
  });
  assert.deepEqual(payload.memoryControl, {
    version: 'dlkt-info-memory-control-1',
    route: '/memory',
    mode: 'synthetic-session-preview',
    maximumSignals: 24,
    maximumCandidates: 12,
    minimumWeight: -50,
    maximumWeight: 50,
    browserStorage: false,
    persistenceEnabled: false,
    hiddenSignalsAllowed: false,
    undoAvailable: true,
    automaticProfileMutation: false,
  });
  assert.deepEqual(payload.trustControl, {
    version: 'dlkt-info-trust-control-1',
    route: '/trust',
    mode: 'synthetic-session-preview',
    marker: 'trust-v1',
    browserStorage: false,
    persistenceEnabled: false,
    hiddenTrustRulesAllowed: false,
    automaticTruthSelection: false,
    policyIsUserVisible: true,
    maximumCandidates: 12,
  });
  assert.equal(payload.capabilities.includes('user-controlled-trust-policy'), true);
  assert.equal(payload.capabilities.includes('source-authority-threshold'), true);
  assert.equal(payload.capabilities.includes('explicit-conflict-visibility'), true);
  assert.equal(payload.capabilities.includes('evidence-freshness-gate'), true);
  assert.equal(payload.capabilities.includes('zero-automatic-truth-selection'), true);
  assert.deepEqual(payload.actionControl, {
    version: 'dlkt-info-action-control-1',
    route: '/actions',
    mode: 'synthetic-session-preview',
    marker: 'actions-v1',
    maximumCandidates: 12,
    maximumActions: 24,
    browserStorage: false,
    persistenceEnabled: false,
    notificationDeliveryEnabled: false,
    automaticExecution: false,
    factualClaimMutation: false,
    actionLedgerVisible: true,
    undoAvailable: true,
  });
  for (const capability of [
    'explicit-personal-actions','claim-bound-action-ledger','watch-next-material-change',
    'next-briefing-reminder-preview','compare-next-verified-state',
    'attention-resolution-without-claim-mutation','explicit-pattern-ignore',
    'zero-automatic-action-execution',
  ]) assert.equal(payload.capabilities.includes(capability), true, capability);
  assert.deepEqual(payload.actionInbox, {
    version: 'dlkt-info-action-inbox-1',
    route: '/inbox',
    mode: 'synthetic-session-preview',
    maximumActions: 24,
    browserStorage: false,
    persistenceEnabled: false,
    automaticExecution: false,
    factualStateMutation: false,
    finite: true,
  });
  assert.equal(payload.capabilities.includes('finite-action-inbox'), true);
  assert.equal(payload.capabilities.includes('material-delta-follow-up'), true);
  assert.equal(payload.capabilities.includes('explicit-muted-change-ledger'), true);
  assert.equal(payload.capabilities.includes('attention-reopen-on-material-delta'), true);
  assert.equal(payload.capabilities.includes('zero-hidden-follow-up-execution'), true);
  assert.deepEqual(payload.deliveryControl, {
    version: 'dlkt-info-delivery-control-1',
    route: '/delivery',
    mode: 'synthetic-session-preview',
    marker: 'delivery-v1',
    maximumCandidates: 24,
    maximumRecentReceipts: 100,
    browserStorage: false,
    persistenceEnabled: false,
    emailEnabled: false,
    pushEnabled: false,
    automaticExecution: false,
    factualStateMutation: false,
    quietHoursRequired: true,
    antiSpamRequired: true,
    decisionReasonVisible: true,
    finite: true,
  });
  for (const capability of ['user-controlled-delivery-policy','quiet-hours-enforcement','daily-alert-cap','minimum-alert-gap','duplicate-alert-collapse','visible-delivery-reasons','zero-automatic-delivery']) {
    assert.equal(payload.capabilities.includes(capability), true);
  }
  assert.deepEqual(payload.unifiedShell, {
    version: 'dlkt-info-unified-shell-1',
    route: '/companion-preview',
    mode: 'synthetic-session-preview',
    stages: ['briefing', 'trust', 'memory', 'actions', 'inbox', 'delivery'],
    cardBudget: 'user-defined-positive-integer',
    entityCapacity: 'payload-bounded',
    browserStorage: false,
    persistenceEnabled: false,
    automaticExecution: false,
    factualStateMutation: false,
    unifiedUrlState: true,
    finite: true,
  });
  assert.deepEqual(payload.firstRunActivation, {
    version: 'dlkt-info-first-run-activation-1',
    route: '/start',
    mode: 'synthetic-session-preview',
    steps: ['interests', 'trust', 'delivery', 'preview'],
    entityCapacity: 'payload-bounded',
    cardBudget: 'user-defined-positive-integer',
    browserStorage: false,
    persistenceEnabled: false,
    automaticExecution: false,
    factualStateMutation: false,
  });
  assert.deepEqual(payload.activationAccountHandoff, {
    version: 'dlkt-info-activation-account-handoff-1',
    sourceRoute: '/start',
    destinationRoute: '/companion',
    identityMethod: 'email-otp',
    sessionBoundary: 'http-only-cookie',
    persistenceAdapter: 'dlkt-info-persistence-2',
    persistenceMode: 'dedicated-runtime-gate',
    exactContractSave: true,
    crossDeviceRestore: true,
    explicitUrlWins: true,
    entityCapacity: 'payload-bounded',
    cardBudget: 'user-defined-positive-integer',
    browserStorage: false,
    automaticExecution: false,
    factualStateMutation: false,
  });
  assert.deepEqual(payload.operationalLedger, {
    version: 'dlkt-info-operational-delta-ledger-1',
    checkpointStorage: 'private-content-addressed-blob',
    pointerUpdate: 'etag-compare-and-swap',
    immutableCheckpoints: true,
    deterministicHourlySlots: true,
    concurrentWriterSafety: true,
    sourceFailureAdvancesPointer: false,
    rolloffResolutionDisabled: true,
    browserStorage: false,
    databaseUsed: false,
    automaticPublication: false,
    publicCardsCreated: false,
    status: 'installed-not-activated',
    collectionIntervalMinutes: 60,
    collectRoute: '/api/operational-delta-collect',
    readRoute: '/api/operational-delta',
    healthRoute: '/api/operational-delta-health',
    blocker: 'OPERATIONAL_LEDGER_DISABLED',
  });
  assert.deepEqual(payload.realCompanion, {
    version: 'dlkt-info-real-companion-1',
    route: '/companion',
    apiRoute: '/api/companion',
    mode: 'real-delta-first',
    sourceMode: 'operational-ledger-first-with-release-fallback',
    cardBudget: 'user-defined-positive-integer',
    entityCapacity: 'payload-bounded',
    deterministicEntityMatching: true,
    authoritativeSourceSufficiency: true,
    operationalLedgerPreferred: true,
    releaseBaselineFallback: true,
    zeroSyntheticCards: true,
    zeroFillerCards: true,
    caughtUpState: true,
    partialSourceState: true,
    browserStorage: false,
    databaseUsed: false,
    automaticPublication: false,
    automaticExecution: false,
    aiInterpretation: false,
    degradedStateHttpStatus: 200,
    responseCache: 'private-no-store',
    sourceCacheSeconds: 900,
  });
  for (const capability of ['real-companion-bridge','real-delta-filtering','deterministic-entity-matching','truthful-caught-up-state','zero-synthetic-companion-cards','shared-official-source-fetch']) {
    assert.equal(payload.capabilities.includes(capability), true, capability);
  }
  for (const capability of ['operational-delta-ledger','immutable-content-addressed-checkpoints','etag-cas-pointer','consecutive-verification-delta','source-failure-no-pointer-advance']) {
    assert.equal(payload.capabilities.includes(capability), true, capability);
  }
  assert.deepEqual(payload.liveOfficialSnapshot, {
    version: 'dlkt-info-live-official-snapshot-1',
    route: '/live',
    apiRoute: '/api/eu-official-live',
    mode: 'live-read-only',
    sourceAuthority: 'official',
    userDefinedCardBudget: true,
    deltaAvailable: false,
    databaseUsed: false,
    persistenceUsed: false,
    automaticPublication: false,
    publicCardsCreated: false,
    aiInterpretation: false,
    responseCache: 'private-no-store',
    serverMemoryCacheSeconds: 900,
  });
  assert.deepEqual(payload.deltaOfficial, {
    version: 'dlkt-info-eu-release-delta-1',
    baselineVersion: 'dlkt-info-eu-release-baseline-1',
    route: '/delta',
    apiRoute: '/api/eu-official-delta',
    mode: 'release-baseline-delta',
    sourceAuthority: 'official',
    baselinePersistence: 'immutable-release-artifact',
    userDefinedCardBudget: true,
    deltaAvailable: true,
    databaseUsed: false,
    databaseChanged: false,
    automaticPublication: false,
    publicCardsCreated: false,
    aiInterpretation: false,
    rolloffResolutionDisabled: true,
    responseCache: 'private-no-store',
    serverMemoryCacheSeconds: 900,
  });
  assert.equal(payload.capabilities.includes('origin-safe-private-snapshot-cache'), true);
  assert.equal(payload.capabilities.includes('authorization-before-cache'), true);
  assert.equal(payload.capabilities.includes('zero-cdn-response-reuse'), true);
  assert.deepEqual(payload.officialApiCacheBoundary, {
    version: 'dlkt-info-origin-safe-cache-1',
    responseCache: 'private-no-store',
    serverMemoryCacheSeconds: 900,
    methodValidatedBeforeCache: true,
    queryValidatedBeforeCache: true,
    requestMarkerValidatedBeforeCache: true,
    originValidatedBeforeCache: true,
    etagRevalidation: true,
    intermediaryReuseAllowed: false,
    loaderFailuresCached: false,
    containsCredentials: false,
    containsUserData: false,
  });
  assert.deepEqual(payload.provisioningControl, {
    version: 'dlkt-info-provisioning-control-2',
    identityVersion: 'dlkt-info-system-identity-1',
    identityRpc: 'dlkt_info_read_system_identity',
    identityMigration: '20261113115256_dlkt_info_provisioning_identity_guard',
    readinessVersion: 'dlkt-info-database-readiness-2',
    readinessRpc: 'dlkt_info_read_database_readiness',
    readinessMigration: '20261121080311_dlkt_info_continuous_refresh',
    schemaManifestVersion: 'dlkt-info-schema-manifest-6',
    expectedSchemaFingerprint: '481dee0bc8f4c8807fff49856c8aebf399ae637ffbde42a9e3d61ea9340bf240',
    route: '/api/provisioning-health',
    expectedProduct: 'dlkt-info',
    expectedEngine: 'dlkt-info-inphocore-engine-orchestra',
    expectedDataRegion: 'eu-central-1',
    dedicatedProjectRequired: true,
    databaseInstanceBindingRequired: true,
    schemaAttestationRequired: true,
    activationReceiptRequired: true,
    environmentFlagsAreInsufficient: true,
    publishableKeyIsNotBearerToken: true,
    failClosed: true,
    secretsExposed: false,
    automaticExecution: false,
    factualStateMutation: false,
  });
  for (const capability of ['live-official-readonly-snapshot','real-eurlex-data','zero-persistence-live-view','no-false-delta','etag-revalidation','partial-source-degradation']) assert.equal(payload.capabilities.includes(capability), true);
  for (const capability of ['first-run-activation','explicit-entity-tracking','finite-attention-budget','activation-account-handoff','exact-contract-persistence','authenticated-cross-device-restore','user-defined-card-budget','payload-bounded-entity-tracking','database-identity-attestation','database-readiness-attestation','schema-fingerprint','activation-receipt','schema-drift-fail-closed','private-function-least-privilege','wrong-project-fail-closed','runtime-provisioning-gate','environment-flags-insufficient','zero-secret-health-check']) {
    assert.equal(payload.capabilities.includes(capability), true);
  }
  for (const capability of ['unified-companion-shell','single-session-state','cross-control-url-continuity','finite-operational-journey','zero-duplicated-decision-logic']) {
    assert.equal(payload.capabilities.includes(capability), true);
  }
  assert.deepEqual(payload.companionBridge, {
    version: 'dlkt-info-companion-bridge-1',
    route: '/today',
    marker: 'companion-v1',
    transport: 'strict-query',
    entityCapacity: 'payload-bounded',
    cardBudget: 'user-defined-positive-integer',
    browserStorage: false,
    unknownParameters: 'reject',
    invalidState: 'safe-preview',
    zeroResultState: 'explicit',
  });
  assert.deepEqual(payload.dailyCompanion, {
    version: 'dlkt-info-daily-companion-1',
    route: '/today',
    mode: 'synthetic-finite-preview',
    finite: true,
    cardBudget: 'user-defined-positive-integer',
    infiniteScroll: false,
    sessionPersistence: false,
    realDataEnabled: false,
  });
  assert.deepEqual(payload.visualReviewConsole, {
    version: 'dlkt-info-visual-review-console-1',
    route: '/review',
    mode: 'synthetic-preview-only',
    candidateLimit: 12,
    decisionsPersisted: false,
    automaticPublication: false,
    publicCardsEnabled: false,
  });
  assert.equal(payload.capabilities.includes('visual-review-console-preview'), true);
  assert.equal(payload.capabilities.includes('explicit-caught-up-state'), true);
  assert.equal(payload.capabilities.includes('relevance-feedback-preview'), true);
  assert.equal(payload.capabilities.includes('finite-end-user-briefing'), true);
  assert.equal(payload.capabilities.includes('daily-companion-experience'), true);
  assert.equal(payload.capabilities.includes('explicit-zero-result-state'), true);
  assert.equal(payload.capabilities.includes('no-browser-storage-bridge'), true);
  assert.equal(payload.capabilities.includes('strict-url-preferences'), true);
  assert.equal(payload.capabilities.includes('explainable-memory-ledger'), true);
  assert.equal(payload.capabilities.includes('user-controlled-memory'), true);
  assert.equal(payload.capabilities.includes('bounded-feedback-impact'), true);
  assert.equal(payload.capabilities.includes('next-briefing-rank-preview'), true);
  assert.equal(payload.capabilities.includes('session-only-memory-undo'), true);
  assert.equal(payload.capabilities.includes('zero-hidden-memory-signals'), true);
  assert.equal(payload.capabilities.includes('explainable-ranking'), true);
  assert.equal(payload.capabilities.includes('new-since-last-briefing'), true);
  assert.equal(payload.capabilities.includes('finite-briefing-history'), true);
  assert.equal(payload.capabilities.includes('companion-to-briefing-bridge'), true);
  assert.equal(payload.capabilities.includes('before-after-delta-inspection'), true);
  assert.equal(payload.capabilities.includes('synthetic-human-gate-interaction'), true);
  assert.equal(payload.companionVersion, 'dlkt-info-companion-1');
  assert.equal(payload.capabilities.includes('eu-official-change-radar'), true);
  assert.equal(payload.capabilities.includes('source-acquisition-checkpoints'), true);
  assert.equal(payload.capabilities.includes('private-baseline-worker'), true);
  assert.equal(payload.capabilities.includes('atomic-source-claim-commit'), true);
  assert.deepEqual(payload.informationPacks, [{
    id: 'eu-official-change-radar', version: '0.1.1', status: 'installed-not-activated',
    sources: 2, feeds: 2, baselineRequired: true, privateWorkerReady: true, privateClaimLedgerReady: true,
    scheduledAcquisitionConfigured: true, publicCardsEnabled: false, liveAcquisitionEnabled: false,
    blocker: 'DEDICATED_SUPABASE_PROJECT_REQUIRED',
  }]);
  assert.deepEqual(payload.identity, {
    version: 'dlkt-info-identity-1',
    configured: false,
    enabled: false,
    sessionBoundary: 'http-only-cookie',
    signInMethod: 'email-otp',
    blocker: 'DEDICATED_SUPABASE_PROJECT_REQUIRED',
  });
  assert.deepEqual(payload.persistence, {
    adapterVersion: 'dlkt-info-persistence-2',
    configuration: 'missing',
    configured: false,
    provisioned: false,
    authEnabled: false,
    realDataEnabled: false,
    sourceAcquisitionEnabled: false,
    deliveryWorkersEnabled: false,
    blocker: 'DEDICATED_SUPABASE_PROJECT_REQUIRED',
  });
  assert.deepEqual(payload.dataFoundation, {
    version: 'dlkt-info-data-1',
    migration: '20261111184500_dlkt_info_data_delivery_foundation',
    configuration: 'missing',
    provisioned: false,
    authEnabled: false,
    realDataEnabled: false,
    sourceAcquisitionEnabled: false,
    deliveryWorkersEnabled: false,
    blocker: 'DEDICATED_SUPABASE_PROJECT_REQUIRED',
  });
});

test('demo API is explicitly synthetic and never cacheable', async () => {
  const { default: demo } = await import('../.build/api/demo.js');
  const headers = new Map();
  let body = '';
  const response = {
    statusCode: 0,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
    end(value = '') { body = String(value); },
  };
  demo({ method: 'GET' }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(headers.get('cache-control'), 'private, no-store');
  assert.equal(headers.get('x-dlkt-info-synthetic'), '1');
  const payload = JSON.parse(body);
  assert.equal(payload.synthetic, true);
  assert.equal(payload.briefing.cards.length, 5);
  assert.equal(payload.briefing.contestedCount, 1);
  assert.equal(payload.diagnostics.sourceRegistrySize, 4);
});
