import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const RELEASE_FILE = 'RELEASE-0.9.46.json';
const manifest = JSON.parse(readFileSync(RELEASE_FILE, 'utf8'));
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const read = (file) => readFileSync(file, 'utf8');

if (manifest.product !== 'dlkt-info'
  || manifest.engine !== 'dlkt-info-inphocore-engine-orchestra'
  || manifest.version !== '0.9.46'
  || manifest.walletVersion !== 'dlkt-info-wallet-1'
  || manifest.walletProfileVersion !== 'dlkt-info-wallet-profile-1'
  || manifest.connectionsVersion !== 'dlkt-info-connections-1'
  || manifest.engineVersion !== '0.1.0'
  || manifest.dataFoundationVersion !== 'dlkt-info-data-1'
  || manifest.companionVersion !== 'dlkt-info-companion-1'
  || manifest.realCompanionVersion !== 'dlkt-info-real-companion-1'
  || manifest.operationalLedgerVersion !== 'dlkt-info-operational-delta-ledger-1'
  || manifest.operationalCheckpointVersion !== 'dlkt-info-operational-checkpoint-1'
  || manifest.operationalDeltaVersion !== 'dlkt-info-operational-delta-1'
  || manifest.blobSdkVersion !== '2.9.0'
  || manifest.zodOverrideVersion !== '4.6.7'
  || manifest.persistenceVersion !== 'dlkt-info-persistence-2'
  || manifest.identityVersion !== 'dlkt-info-identity-1'
  || manifest.serviceVersion !== 'dlkt-info-service-1'
  || manifest.internalTrialVersion !== 'dlkt-info-internal-delta-trial-1'
  || manifest.informationPackId !== 'eu-official-change-radar'
  || manifest.informationPackVersion !== '0.1.1'
  || manifest.sourceAcquisitionMigration !== '20261111224500_dlkt_info_source_acquisition'
  || manifest.privateBaselineMigration !== '20261111233000_dlkt_info_private_baseline_commit'
  || manifest.internalTrialMigration !== '20261112003000_dlkt_info_internal_real_delta_trial'
  || manifest.reviewPublicationMode !== 'human-review-private-no-auto-publication'
  || manifest.visualReviewConsoleVersion !== 'dlkt-info-visual-review-console-1'
  || manifest.dailyCompanionVersion !== 'dlkt-info-daily-companion-1'
  || manifest.liveOfficialSnapshotVersion !== 'dlkt-info-live-official-snapshot-1'
  || manifest.deltaOfficialSnapshotVersion !== 'dlkt-info-eu-release-delta-1'
  || manifest.deltaOfficialBaselineVersion !== 'dlkt-info-eu-release-baseline-1'
  || manifest.deltaOfficialBaselineCapturedAt !== '2026-11-13T15:49:44.186Z'
  || manifest.deltaOfficialBaselineHash !== '157b9edae0f0f22a399f1318fdcad8275b86cf5de39649ea33ed3c6e218e601a'
  || manifest.officialApiCacheBoundaryVersion !== 'dlkt-info-origin-safe-cache-1'
  || manifest.companionBridgeVersion !== 'dlkt-info-companion-bridge-1'
  || manifest.briefingHistoryVersion !== 'dlkt-info-briefing-history-1'
  || manifest.explainableMemoryVersion !== 'dlkt-info-explainable-memory-1'
  || manifest.memoryControlVersion !== 'dlkt-info-memory-control-1'
  || manifest.trustControlVersion !== 'dlkt-info-trust-control-1'
  || manifest.actionControlVersion !== 'dlkt-info-action-control-1'
  || manifest.actionInboxVersion !== 'dlkt-info-action-inbox-1'
  || manifest.deliveryControlVersion !== 'dlkt-info-delivery-control-1'
  || manifest.unifiedShellVersion !== 'dlkt-info-unified-shell-1'
  || manifest.firstRunActivationVersion !== 'dlkt-info-first-run-activation-1'
  || manifest.companionEntitiesMigration !== '20261112221500_dlkt_info_companion_entities'
  || manifest.activationAccountHandoffVersion !== 'dlkt-info-activation-account-handoff-1'
  || manifest.activationHandoffMigration !== '20261112233000_dlkt_info_activation_account_handoff'
  || manifest.provisioningControlVersion !== 'dlkt-info-provisioning-control-2'
  || manifest.systemIdentityVersion !== 'dlkt-info-system-identity-1'
  || manifest.databaseReadinessVersion !== 'dlkt-info-database-readiness-2'
  || manifest.schemaManifestVersion !== 'dlkt-info-schema-manifest-8'
  || manifest.provisioningIdentityMigration !== '20261113115256_dlkt_info_provisioning_identity_guard'
  || manifest.databaseReadinessMigration !== '20261122200813_dlkt_info_news_corpus'
  || manifest.expectedSchemaFingerprint !== 'ef03f90d229d089f8871c64b996994c79c65d0e1e3a0f8e2b0bb08dc2d6f6dec'
  || manifest.revision !== 'iceo-primary-mesh-1'
  || manifest.iceoVersion !== 'iceo-primary-mesh-1'
  || manifest.publicSourceCount !== 51
  || manifest.publicPublisherCount !== 25
  || manifest.reviewedNewsPublisherFamilies !== 72
  || manifest.publicEditorialCategoryCount !== 20
  || manifest.publicDailyTarget !== 30 || manifest.publicDailyMaximum !== 40
  || manifest.publicDailyRefreshSchedule !== '*/2 * * * *'
  || manifest.localNewsSourceCount !== 2) {
  throw new Error('RELEASE_IDENTITY');
}

const expected = new Set(Object.keys(manifest.files));
for (const [file, hash] of Object.entries(manifest.files)) {
  if (path.isAbsolute(file) || file.split('/').includes('..') || file.startsWith('supabase/.temp/')
    || /(^|\/)\.env(?:\.|$)/u.test(file)) {
    throw new Error(`RELEASE_PATH:${file}`);
  }
  if (!existsSync(file) || lstatSync(file).isSymbolicLink() || digest(file) !== hash) {
    throw new Error(`RELEASE_HASH:${file}`);
  }
}

const scan = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (file === 'supabase/.temp') continue;
    if (entry.isSymbolicLink()) throw new Error(`RELEASE_SYMLINK:${file}`);
    if (entry.isDirectory()) scan(file);
    else if (!expected.has(file)) throw new Error(`RELEASE_UNMANIFESTED:${file}`);
  }
};
for (const directory of ['api', 'src', 'tests', 'public', 'supabase', 'scripts']) scan(directory);

const rootFiles = [
  'DATA-DELIVERY-FOUNDATION.md', 'DLKT-INFO-BOUNDARY.md', 'DLKT-KATE-PALETTE.md',
  'EU-OFFICIAL-CHANGE-RADAR.md', 'IDENTITY-SESSION-GATE.md', 'INTERNAL-REAL-DELTA-TRIAL.md',
  'PERSISTENCE-ADAPTER.md', 'PERSONAL-COMPANION-LOOP.md', 'PRIVATE-BASELINE-WORKER.md',
  'BRIEFING-HISTORY-MEMORY.md', 'COMPANION-BRIEFING-BRIDGE.md', 'DAILY-COMPANION-EXPERIENCE.md',
  'PRODUCT-EXPERIENCE.md', 'VISUAL-REVIEW-CONSOLE.md', 'MEMORY-CONTROL-ROOM.md', 'TRUST-CONTROL-ROOM.md',
  'PERSONAL-ACTION-LAYER.md', 'ACTION-INBOX-FOLLOW-UP.md', 'DELIVERY-NOTIFICATION-CONTROL.md', 'UNIFIED-COMPANION-SHELL.md', 'FIRST-RUN-ACTIVATION.md', 'ACTIVATION-ACCOUNT-HANDOFF.md', 'PROVISIONING-CONTROL-PLANE.md', 'DATABASE-READINESS-ATTESTATION.md', 'LIVE-OFFICIAL-SNAPSHOT.md', 'DELTA-FIRST-RELEASE-BASELINE.md', 'ORIGIN-SAFE-CACHE-BOUNDARY.md', 'REAL-COMPANION-BRIDGE.md', 'OPERATIONAL-DELTA-LEDGER.md',
  'INFO-WALLET.md', 'package-lock.json', 'package.json', 'tsconfig.build.json',
  'tsconfig.json', 'vercel.json', 'verify-release.mjs',
];
for (const file of rootFiles) if (!expected.has(file)) throw new Error(`RELEASE_ROOT_FILE:${file}`);

const core = read('src/core/contracts.ts');
const persistenceContracts = read('src/persistence/contracts.ts');
const persistenceConfig = read('src/persistence/config.ts');
const persistenceRest = read('src/persistence/rest.ts');
const identityContracts = read('src/identity/contracts.ts');
const serviceContracts = read('src/service/contracts.ts');
const serviceConfig = read('src/service/config.ts');
const serviceRest = read('src/service/rest.ts');
const trialContracts = read('src/trials/contracts.ts');
const trialConfig = read('src/trials/config.ts');
const trialGuards = read('src/trials/guards.ts');
const trialGateway = read('src/trials/gateway.ts');
const trialProjector = read('src/trials/projector.ts');
const reviewContracts = read('src/review/contracts.ts');
const todayContracts = read('src/today/contracts.ts');
const bridgeContracts = read('src/bridge/contracts.ts');
const bridgeGuards = read('src/bridge/guards.ts');
const historyContracts = read('src/history/contracts.ts');
const historyDiff = read('src/history/diff.ts');
const historyMemory = read('src/history/memory.ts');
const memoryContracts = read('src/memory/contracts.ts');
const memoryControl = read('src/memory/control.ts');
const trustContracts = read('src/trust/contracts.ts');
const trustPolicy = read('src/trust/policy.ts');
const actionContracts = read('src/actions/contracts.ts');
const actionControl = read('src/actions/control.ts');
const actionTransport = read('src/actions/transport.ts');
const inboxContracts = read('src/inbox/contracts.ts');
const inboxProjection = read('src/inbox/projection.ts');
const deliveryContracts = read('src/delivery/contracts.ts');
const deliveryPolicy = read('src/delivery/policy.ts');
const deliveryTransport = read('src/delivery/transport.ts');
const shellContracts = read('src/shell/contracts.ts');
const shellProjection = read('src/shell/projection.ts');
const activationContracts = read('src/activation/contracts.ts');
const activationProjection = read('src/activation/projection.ts');
const handoffContracts = read('src/handoff/contracts.ts');
const provisioningContracts = read('src/provisioning/contracts.ts');
const provisioningGuards = read('src/provisioning/guards.ts');
const provisioningTransport = read('src/provisioning/transport.ts');
const provisioningProjection = read('src/provisioning/projection.ts');
const provisioningReadinessManifest = read('src/provisioning/readiness-manifest.ts');
const liveOfficialContracts = read('src/live-official/contracts.ts');
const liveOfficialSnapshot = read('src/live-official/snapshot.ts');
const liveOfficialApi = read('api/eu-official-live.ts');
const deltaOfficialContracts = read('src/delta-official/contracts.ts');
const deltaOfficialBaseline = read('src/delta-official/baseline.generated.ts');
const deltaOfficialBaselineGuard = read('src/delta-official/baseline.ts');
const deltaOfficialSnapshot = read('src/delta-official/snapshot.ts');
const deltaOfficialApi = read('api/eu-official-delta.ts');
const privateSnapshotCache = read('src/http/private-snapshot-cache.ts');
const realCompanionContracts = read('src/real-companion/contracts.ts');
const realCompanionDefinition = read('src/real-companion/definition.ts');
const realCompanionSource = read('src/real-companion/source.ts');
const realCompanionProjection = read('src/real-companion/projection.ts');
const realCompanionApi = read('api/companion.ts');
const operationalContracts = read('src/operational-ledger/contracts.ts');
const operationalCanonical = read('src/operational-ledger/canonical.ts');
const operationalConfiguration = read('src/operational-ledger/configuration.ts');
const operationalStorage = read('src/operational-ledger/storage.ts');
const operationalIdentity = read('src/operational-ledger/identity.ts');
const operationalCheckpoint = read('src/operational-ledger/checkpoint.ts');
const operationalDelta = read('src/operational-ledger/delta.ts');
const operationalReader = read('src/operational-ledger/reader.ts');
const operationalWorker = read('src/operational-ledger/worker.ts');
const operationalCollectApi = read('api/operational-delta-collect.ts');
const operationalReadApi = read('api/operational-delta.ts');
const operationalHealthApi = read('api/operational-delta-health.ts');
const operationalBootstrap = read('scripts/bootstrap-operational-ledger.mjs');
const relevance = read('src/core/relevance.ts');
const healthApi = read('api/health.ts');
const trialHealthApi = read('api/internal-delta-health.ts');
const trialWorkerApi = read('api/internal-delta-trial.ts');
const trialReviewApi = read('api/internal-delta-review.ts');
const acquireApi = read('api/eu-official-acquire.ts');
const acquisitionMigration = read('supabase/migrations/20261111224500_dlkt_info_source_acquisition.sql');
const baselineMigration = read('supabase/migrations/20261111233000_dlkt_info_private_baseline_commit.sql');
const trialMigration = read('supabase/migrations/20261112003000_dlkt_info_internal_real_delta_trial.sql');
const companionEntitiesMigration = read('supabase/migrations/20261112221500_dlkt_info_companion_entities.sql');
const activationHandoffMigration = read('supabase/migrations/20261112233000_dlkt_info_activation_account_handoff.sql');
const provisioningIdentityMigration = read('supabase/migrations/20261113115256_dlkt_info_provisioning_identity_guard.sql');
const databaseReadinessBaselineMigration = read('supabase/migrations/20261113125146_dlkt_info_database_readiness_attestation.sql');
const databaseReadinessMigration = read('supabase/migrations/20261119142617_dlkt_info_public_acl_attestation.sql');
const sharedCardArchiveMigration = read('supabase/migrations/20261120184745_dlkt_info_public_share_archive.sql');
const provisioningHealthApi = read('api/provisioning-health.ts');
const browser = read('public/app.js');
const reviewBrowser = read('public/review.js');
const todayBrowser = read('public/today.js');
const bridgeBrowser = read('public/bridge.js');
const historyBrowser = read('public/history.js');
const historyData = read('public/history-data.js');
const memoryBrowser = read('public/memory.js');
const memoryData = read('public/memory-data.js');
const trustBrowser = read('public/trust.js');
const trustData = read('public/trust-data.js');
const actionBrowser = read('public/actions.js');
const actionData = read('public/action-data.js');
const inboxBrowser = read('public/inbox.js');
const inboxData = read('public/inbox-data.js');
const deliveryBrowser = read('public/delivery.js');
const deliveryData = read('public/delivery-data.js');
const shellBrowser = read('public/companion-shell.js');
const realCompanionBrowser = read('public/real-companion.js');
const activationBrowser = read('public/start.js');
const shellData = read('public/companion-shell-data.js');
const indexHtml = read('public/index.html');
const reviewHtml = read('public/review.html');
const todayHtml = read('public/today.html');
const historyHtml = read('public/history.html');
const memoryHtml = read('public/memory.html');
const trustHtml = read('public/trust.html');
const actionHtml = read('public/actions.html');
const inboxHtml = read('public/inbox.html');
const deliveryHtml = read('public/delivery.html');
const shellHtml = read('public/companion-preview.html');
const realCompanionHtml = read('public/companion.html');
const activationHtml = read('public/start.html');
const liveOfficialHtml = read('public/live.html');
const styles = read('public/styles.css');
const reviewStyles = read('public/review.css');
const todayStyles = read('public/today.css');
const historyStyles = read('public/history.css');
const memoryStyles = read('public/memory.css');
const trustStyles = read('public/trust.css');
const actionStyles = read('public/actions.css');
const inboxStyles = read('public/inbox.css');
const deliveryStyles = read('public/delivery.css');
const shellStyles = read('public/companion.css');
const realCompanionStyles = read('public/real-companion.css');
const activationStyles = read('public/start.css');
const liveOfficialStyles = read('public/live.css');
const liveOfficialBrowser = read('public/live.js');
const deltaOfficialHtml = read('public/delta.html');
const deltaOfficialStyles = read('public/delta.css');
const deltaOfficialBrowser = read('public/delta.js');
const favicon = read('public/favicon.svg');
const webmanifest = read('public/manifest.webmanifest');
const packageJson = JSON.parse(read('package.json'));
const config = JSON.parse(read('vercel.json'));

if (!core.includes("PRODUCT_ID = 'dlkt-info'")
  || !core.includes("PRODUCT_VERSION = '0.9.46'")
  || !core.includes("ENGINE_ID = 'dlkt-info-inphocore-engine-orchestra'")
  || !core.includes("ENGINE_VERSION = '0.1.0'")
  || !persistenceContracts.includes("PERSISTENCE_ADAPTER_VERSION = 'dlkt-info-persistence-2'")
  || !identityContracts.includes("IDENTITY_VERSION = 'dlkt-info-identity-1'")
  || !serviceContracts.includes("SERVICE_CONFIGURATION_VERSION = 'dlkt-info-service-1'")
  || !trialContracts.includes("INTERNAL_DELTA_TRIAL_VERSION = 'dlkt-info-internal-delta-trial-1'")
  || !trialContracts.includes("INTERNAL_DELTA_TRIAL_MIGRATION = '20261112003000_dlkt_info_internal_real_delta_trial'")
  || !reviewContracts.includes("VISUAL_REVIEW_CONSOLE_VERSION = 'dlkt-info-visual-review-console-1'")
  || !reviewContracts.includes("VISUAL_REVIEW_CONSOLE_ROUTE = '/review'")
  || !reviewContracts.includes("VISUAL_REVIEW_CONSOLE_MODE = 'synthetic-preview-only'")
  || !todayContracts.includes("DAILY_COMPANION_VERSION = 'dlkt-info-daily-companion-1'")
  || !todayContracts.includes("DAILY_COMPANION_ROUTE = '/today'")
  || !todayContracts.includes("DAILY_COMPANION_MODE = 'synthetic-finite-preview'")
  || !bridgeContracts.includes("COMPANION_BRIDGE_VERSION = 'dlkt-info-companion-bridge-1'")
  || !bridgeContracts.includes("COMPANION_BRIDGE_ROUTE = '/today'")
  || !bridgeContracts.includes("COMPANION_BRIDGE_MARKER = 'companion-v1'")
  || !historyContracts.includes("BRIEFING_HISTORY_VERSION = 'dlkt-info-briefing-history-1'")
  || !historyContracts.includes("EXPLAINABLE_MEMORY_VERSION = 'dlkt-info-explainable-memory-1'")
  || !historyContracts.includes("BRIEFING_HISTORY_ROUTE = '/history'")
  || !memoryContracts.includes("MEMORY_CONTROL_VERSION = 'dlkt-info-memory-control-1'")
  || !memoryContracts.includes("MEMORY_CONTROL_ROUTE = '/memory'")
  || !memoryContracts.includes("MEMORY_CONTROL_MODE = 'synthetic-session-preview'")
  || !trustContracts.includes("TRUST_CONTROL_VERSION = 'dlkt-info-trust-control-1'")
  || !trustContracts.includes("TRUST_CONTROL_ROUTE = '/trust'")
  || !trustContracts.includes("TRUST_CONTROL_MODE = 'synthetic-session-preview'")
  || !trustContracts.includes("TRUST_CONTROL_MARKER = 'trust-v1'")
  || !actionContracts.includes("ACTION_CONTROL_VERSION = 'dlkt-info-action-control-1'")
  || !actionContracts.includes("ACTION_CONTROL_ROUTE = '/actions'")
  || !actionContracts.includes("ACTION_CONTROL_MODE = 'synthetic-session-preview'")
  || !actionContracts.includes("ACTION_CONTROL_MARKER = 'actions-v1'")
  || !inboxContracts.includes("ACTION_INBOX_VERSION = 'dlkt-info-action-inbox-1'")
  || !inboxContracts.includes("ACTION_INBOX_ROUTE = '/inbox'")
  || !inboxContracts.includes("ACTION_INBOX_MODE = 'synthetic-session-preview'")
  || !deliveryContracts.includes("DELIVERY_CONTROL_VERSION = 'dlkt-info-delivery-control-1'")
  || !deliveryContracts.includes("DELIVERY_CONTROL_ROUTE = '/delivery'")
  || !deliveryContracts.includes("DELIVERY_CONTROL_MODE = 'synthetic-session-preview'")
  || !deliveryContracts.includes("DELIVERY_CONTROL_MARKER = 'delivery-v1'")
  || !shellContracts.includes("UNIFIED_SHELL_VERSION = 'dlkt-info-unified-shell-1'")
  || !shellContracts.includes("UNIFIED_SHELL_ROUTE = '/companion-preview'")
  || !shellContracts.includes("UNIFIED_SHELL_MODE = 'synthetic-session-preview'")
  || !realCompanionContracts.includes("REAL_COMPANION_VERSION = 'dlkt-info-real-companion-1'")
  || !realCompanionContracts.includes("REAL_COMPANION_ROUTE = '/companion'")
  || !realCompanionContracts.includes("REAL_COMPANION_MODE = 'real-delta-first'")
  || !activationContracts.includes("FIRST_RUN_ACTIVATION_VERSION = 'dlkt-info-first-run-activation-1'")
  || !activationContracts.includes("FIRST_RUN_ACTIVATION_ROUTE = '/start'")
  || !activationContracts.includes("FIRST_RUN_ACTIVATION_MODE = 'synthetic-session-preview'")
  || !persistenceContracts.includes("COMPANION_ENTITIES_MIGRATION = '20261112221500_dlkt_info_companion_entities'")
  || !persistenceContracts.includes("ACTIVATION_HANDOFF_MIGRATION = '20261112233000_dlkt_info_activation_account_handoff'")
  || !handoffContracts.includes("ACTIVATION_ACCOUNT_HANDOFF_VERSION = 'dlkt-info-activation-account-handoff-1'")
  || !handoffContracts.includes("ACTIVATION_ACCOUNT_HANDOFF_SOURCE_ROUTE = '/start'")
  || !handoffContracts.includes("ACTIVATION_ACCOUNT_HANDOFF_DESTINATION_ROUTE = '/companion'")) {
  throw new Error('RELEASE_NAMESPACE');
}

const prohibited = /veciniada-platform|INPHO_SUPABASE|sports-edge-ai|wantadaaa/iu;
for (const source of [
  core, persistenceContracts, persistenceConfig, persistenceRest, identityContracts,
  serviceContracts, serviceConfig, serviceRest, trialContracts, trialConfig, trialGuards,
  trialGateway, trialProjector, reviewContracts, todayContracts, bridgeContracts, bridgeGuards, activationContracts, activationProjection, handoffContracts, provisioningContracts, provisioningGuards, provisioningTransport, provisioningProjection, handoffContracts,
  historyContracts, historyDiff, historyMemory, memoryContracts, memoryControl, trustContracts, trustPolicy, actionContracts, actionControl, actionTransport, inboxContracts, inboxProjection, deliveryContracts, deliveryPolicy, deliveryTransport, shellContracts, shellProjection, relevance, healthApi, trialHealthApi, trialWorkerApi, trialReviewApi,
  acquireApi, acquisitionMigration, baselineMigration, trialMigration, companionEntitiesMigration, activationHandoffMigration, provisioningIdentityMigration, databaseReadinessMigration, provisioningReadinessManifest, provisioningHealthApi, reviewHtml, reviewStyles, reviewBrowser,
  todayHtml, todayStyles, todayBrowser, bridgeBrowser, historyHtml, historyStyles, historyBrowser, historyData,
  memoryHtml, memoryStyles, memoryBrowser, memoryData, trustHtml, trustStyles, trustBrowser, trustData, actionHtml, actionStyles, actionBrowser, actionData, inboxHtml, inboxStyles, inboxBrowser, inboxData, deliveryHtml, deliveryStyles, deliveryBrowser, deliveryData, shellHtml, shellStyles, shellBrowser, shellData, realCompanionHtml, realCompanionStyles, realCompanionBrowser, activationHtml, activationStyles, activationBrowser,
]) if (prohibited.test(source)) throw new Error('RELEASE_CROSS_PROJECT_CONTAMINATION');

if (packageJson.version !== '0.9.46'
  || packageJson.devDependencies?.['@electric-sql/pglite'] !== '0.5.16'
  || packageJson.dependencies?.['fast-xml-parser'] !== '5.12.0'
  || packageJson.dependencies?.['@vercel/blob'] !== '2.9.0'
  || packageJson.overrides?.zod !== '4.6.7'
  || !packageJson.scripts?.test?.includes('tests/database/*.test.mjs')
  || packageJson.scripts?.['verify:eu-live'] !== 'npm run build && node scripts/verify-eu-official-live.mjs') {
  throw new Error('RELEASE_PACKAGE_CONTRACT');
}

const paletteAssets = [styles, indexHtml, activationStyles, activationHtml, activationBrowser, reviewStyles, reviewHtml, reviewBrowser, todayStyles, todayHtml, todayBrowser, bridgeBrowser, historyStyles, historyHtml, historyBrowser, historyData, memoryStyles, memoryHtml, memoryBrowser, memoryData, trustStyles, trustHtml, trustBrowser, trustData, actionStyles, actionHtml, actionBrowser, actionData, inboxStyles, inboxHtml, inboxBrowser, inboxData, deliveryStyles, deliveryHtml, deliveryBrowser, deliveryData, shellStyles, shellHtml, shellBrowser, shellData, realCompanionStyles, realCompanionHtml, realCompanionBrowser, favicon, webmanifest].join('\n').toLowerCase();
const directColors = [...new Set(paletteAssets.match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
if (JSON.stringify(directColors) !== JSON.stringify(['#000000', '#f66061', '#ffffff'])
  || !styles.includes('--dlkt-black: #000000')
  || !styles.includes('--dlkt-white: #ffffff')
  || !styles.includes('--dlkt-coral: #f66061')) {
  throw new Error(`RELEASE_PALETTE:${JSON.stringify(directColors)}`);
}

if (!indexHtml.includes('id="companion-form"') || !indexHtml.includes('id="account-panel"')
  || !indexHtml.includes('<script src="/bridge.js" defer></script>')
  || !browser.includes('`/companion${bridge.buildSearch(preferences)}`') || browser.includes("fetch('/api/companion'") || !browser.includes("fetch('/api/auth'")
  || !browser.includes("fetch('/api/persistence'") || !browser.includes('window.location.assign(companionUrl)')
  || /localStorage|sessionStorage|document\.cookie|access_token|refresh_token|Authorization/iu.test(browser)) {
  throw new Error('RELEASE_PRODUCT_LOOP');
}

for (const fragment of [
  'Internal Review Console', 'Synthetic preview', 'Publication blocked',
  'data-queue-list', 'data-card-before', 'data-card-after', 'data-source-list',
  'data-approve', 'data-reject', 'data-audit-list',
]) if (!reviewHtml.includes(fragment)) throw new Error(`RELEASE_REVIEW_HTML:${fragment}`);
for (const fragment of [
  '.console-shell', '.review-queue', '.review-workspace', '.decision-panel',
  '.change-comparison', '.publication-lock', '@media (max-width: 640px)',
]) if (!reviewStyles.includes(fragment)) throw new Error(`RELEASE_REVIEW_STYLE:${fragment}`);
for (const fragment of [
  "kind: 'Changed'", "kind: 'New'", "kind: 'Conflicted'",
  'replaceChildren', 'Publication remains blocked', "event.key.toLowerCase() === 'a'",
]) if (!reviewBrowser.includes(fragment)) throw new Error(`RELEASE_REVIEW_BROWSER:${fragment}`);
if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu.test(reviewBrowser)) {
  throw new Error('RELEASE_REVIEW_BROWSER_UNSAFE');
}
if (!indexHtml.includes('href="/review">Review preview</a>')
  || !config.rewrites?.some((entry) => entry.source === '/review' && entry.destination === '/review.html')) {
  throw new Error('RELEASE_REVIEW_ROUTE');
}

for (const fragment of [
  'Daily Companion', 'Finite by design', 'Delta lens', 'Why this reached you',
  'No infinite feed.', 'You’re caught up.', 'data-briefing-map', 'data-sources-dialog',
]) if (!todayHtml.includes(fragment)) throw new Error(`RELEASE_TODAY_HTML:${fragment}`);
for (const fragment of [
  '.today-shell', '.briefing-rail', '.daily-card', '.delta-lens',
  '.companion-context', '.briefing-complete', '@media (max-width: 680px)',
]) if (!todayStyles.includes(fragment)) throw new Error(`RELEASE_TODAY_STYLE:${fragment}`);
for (const fragment of [
  "topic: 'Technology'", "topic: 'Business'", "topic: 'Regulation'",
  "topic: 'Opportunity'", "topic: 'Travel'", "topic: 'Supply'",
  'replaceChildren', 'showComplete', 'setFeedback', 'toggleFollow',
]) if (!todayBrowser.includes(fragment)) throw new Error(`RELEASE_TODAY_BROWSER:${fragment}`);
if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu.test(todayBrowser)) {
  throw new Error('RELEASE_TODAY_BROWSER_UNSAFE');
}
if (!indexHtml.includes('href="/today">Today preview</a>')
  || !config.rewrites?.some((entry) => entry.source === '/today' && entry.destination === '/today.html')) {
  throw new Error('RELEASE_TODAY_ROUTE');
}

for (const fragment of [
  'Briefing History', 'Explainable Memory', 'A finite change ledger.', 'No hidden priority score.',
  'Nothing learns in secret.', 'data-run-list', 'data-ranking-select', 'data-memory-list',
]) if (!historyHtml.includes(fragment)) throw new Error(`RELEASE_HISTORY_HTML:${fragment}`);
for (const fragment of [
  '.history-shell', '.history-timeline', '.history-comparison', '.ranking-explainer',
  '.memory-ledger', '@media (max-width: 720px)',
]) if (!historyStyles.includes(fragment)) throw new Error(`RELEASE_HISTORY_STYLE:${fragment}`);
for (const fragment of [
  'DLKTBriefingHistory', 'selectedRunId', 'selectedCardId', 'renderComparison', 'renderRanking', 'renderMemory', 'replaceChildren',
]) if (!historyBrowser.includes(fragment) && !historyData.includes(fragment)) throw new Error(`RELEASE_HISTORY_BROWSER:${fragment}`);
if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu.test(`${historyBrowser}
${historyData}`)) {
  throw new Error('RELEASE_HISTORY_BROWSER_UNSAFE');
}
if (!indexHtml.includes('href="/history">History preview</a>')
  || !config.rewrites?.some((entry) => entry.source === '/history' && entry.destination === '/history.html')) {
  throw new Error('RELEASE_HISTORY_ROUTE');
}

for (const fragment of [
  'Memory Control', 'Nothing learns in secret', 'Visible ledger', 'Next briefing preview',
  'No hidden profile', 'data-signal-list', 'data-ranking-list', 'data-toggle-signal', 'data-undo',
]) if (!memoryHtml.includes(fragment)) throw new Error(`RELEASE_MEMORY_HTML:${fragment}`);
for (const fragment of [
  '.memory-console', '.signal-panel', '.ranking-panel', '.control-panel',
  '.memory-control-link', '@media(max-width:560px)',
]) if (!(memoryStyles + todayStyles).includes(fragment)) throw new Error(`RELEASE_MEMORY_STYLE:${fragment}`);
for (const fragment of [
  'DLKTMemoryControlData', 'URLSearchParams', 'state.undo', 'MEMORY_QUERY_DUPLICATE',
  'MEMORY_QUERY_INVALID', 'replaceChildren',
]) if (!(memoryBrowser + memoryData).includes(fragment)) throw new Error(`RELEASE_MEMORY_BROWSER:${fragment}`);
if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu.test(`${memoryBrowser}
${memoryData}`)) {
  throw new Error('RELEASE_MEMORY_BROWSER_UNSAFE');
}
if (!indexHtml.includes('href="/memory">Memory preview</a>')
  || !todayHtml.includes('data-open-memory')
  || !historyHtml.includes('Open Memory Control Room')
  || !todayBrowser.includes('function memoryControlHref()')
  || !config.rewrites?.some((entry) => entry.source === '/memory' && entry.destination === '/memory.html')) {
  throw new Error('RELEASE_MEMORY_ROUTE');
}
for (const fragment of [
  'data-card-history-status', 'data-history-rank', 'data-history-move', 'data-history-ranking', 'data-history-memory',
]) if (!todayHtml.includes(fragment)) throw new Error(`RELEASE_TODAY_HISTORY:${fragment}`);
for (const fragment of [
  'RankingBreakdown', 'materiality', 'deltaKind', 'recency', 'actionability', 'sourceAuthority', 'ruleWeight',
]) if (!relevance.includes(fragment)) throw new Error(`RELEASE_RANKING_EXPLANATION:${fragment}`);

for (const fragment of [
  'Personal Action Layer', 'Nothing acts in secret', 'Actions change attention, not truth.',
  'data-candidate-list', 'data-action-choice-list', 'data-action-ledger', 'data-undo', 'data-reset',
]) if (!actionHtml.includes(fragment)) throw new Error(`RELEASE_ACTION_HTML:${fragment}`);
for (const fragment of [
  '.actions-console', '.candidate-panel', '.action-inspector', '.control-panel',
  '.action-ledger', '@media(max-width:560px)',
]) if (!actionStyles.includes(fragment)) throw new Error(`RELEASE_ACTION_STYLE:${fragment}`);
for (const fragment of [
  'DLKTActionControl', 'ACTION_IGNORE_EXCLUSIVE', 'automaticExecution: false',
  'factualStateChanged: false', 'replaceChildren', 'state.undo', 'buildUrl', 'parseSearch',
]) if (!(actionBrowser + actionData).includes(fragment)) throw new Error(`RELEASE_ACTION_BROWSER:${fragment}`);
if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu.test(`${actionBrowser}
${actionData}`)) {
  throw new Error('RELEASE_ACTION_BROWSER_UNSAFE');
}
for (const fragment of [
  'data-open-action-dialog', 'data-action-dialog', 'data-card-action-type="watch-change"',
  'data-card-action-type="ignore-pattern"', 'data-complete-actions', 'data-open-actions',
]) if (!todayHtml.includes(fragment)) throw new Error(`RELEASE_ACTION_TODAY_HTML:${fragment}`);
for (const fragment of [
  'actionApi.parseSearch(window.location.search)', 'actionControlHref', 'toggleAction',
  "type === 'ignore-pattern'", 'state.actions = actionApi.normalizeSelections',
]) if (!todayBrowser.includes(fragment)) throw new Error(`RELEASE_ACTION_TODAY_BROWSER:${fragment}`);
if (!indexHtml.includes('href="/actions">Actions preview</a>')
  || !config.rewrites?.some((entry) => entry.source === '/actions' && entry.destination === '/actions.html')) {
  throw new Error('RELEASE_ACTION_ROUTE');
}

for (const fragment of [
  'Action Inbox', 'Only what needs your decision', 'Follow-up without noise',
  'data-inbox-list', 'data-handle-action', 'data-activity-list', 'Fact boundary',
]) if (!inboxHtml.includes(fragment)) throw new Error(`RELEASE_INBOX_HTML:${fragment}`);
for (const fragment of [
  '.inbox-console', '.filter-panel', '.inbox-list-panel', '.inbox-inspector',
  '.activity-ledger', '@media(max-width:760px)', '@media(max-width:460px)',
]) if (!inboxStyles.includes(fragment)) throw new Error(`RELEASE_INBOX_STYLE:${fragment}`);
for (const fragment of [
  'DLKTActionInbox', 'DEFAULT_SELECTIONS', 'waiting-for-delta', 'attention-resolved',
  'suppressedMaterialDeltaCount', 'function handleSelected', 'Watch rearmed', 'Pattern unmuted',
  'automaticExecution: false', 'factualStateChanged: false', 'state.undo', 'replaceChildren',
]) if (!(inboxBrowser + inboxData).includes(fragment)) throw new Error(`RELEASE_INBOX_BROWSER:${fragment}`);
if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu.test(`${inboxBrowser}
${inboxData}`)) {
  throw new Error('RELEASE_INBOX_BROWSER_UNSAFE');
}
if (!indexHtml.includes('href="/inbox">Inbox preview</a>')
  || !todayHtml.includes('data-open-inbox')
  || !actionHtml.includes('data-open-inbox')
  || !todayBrowser.includes("actionControlHref('/inbox')")
  || !actionBrowser.includes("buildUrl(state.selections, window.location.search, '/inbox')")
  || !config.rewrites?.some((entry) => entry.source === '/inbox' && entry.destination === '/inbox.html')) {
  throw new Error('RELEASE_INBOX_ROUTE');
}


for (const fragment of [
  'Delivery Control', 'Every interruption must earn its place', 'Quiet hours', 'Anti-spam limits',
  'data-action-mode', 'data-simulate-quiet', 'data-simulate-recent', 'data-decision-list',
  'data-ledger-grid', 'Projection is not delivery.', 'data-undo', 'data-reset',
]) if (!deliveryHtml.includes(fragment)) throw new Error(`RELEASE_DELIVERY_HTML:${fragment}`);
for (const fragment of [
  '.delivery-console', '.policy-panel', '.projection-panel', '.decision-inspector',
  '.delivery-ledger', '.delivery-boundary', '@media(max-width:760px)', '@media(max-width:460px)',
]) if (!deliveryStyles.includes(fragment)) throw new Error(`RELEASE_DELIVERY_STYLE:${fragment}`);
for (const fragment of [
  'DLKTDeliveryControl', 'delivery-v1', 'quietHoursEnabled', 'dailyAlertCap',
  'minimumGapMinutes', 'minimumAlertTrust', 'minimumAlertMateriality', 'projectedKeys',
  'defer-quiet-hours', 'rate-limited', 'automaticExecution:false', 'factualStateChanged:false',
  'replaceChildren', 'history.replaceState', 'state.undo',
]) if (!(deliveryBrowser + deliveryData).includes(fragment)) throw new Error(`RELEASE_DELIVERY_BROWSER:${fragment}`);
if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu.test(`${deliveryBrowser}
${deliveryData}`)) {
  throw new Error('RELEASE_DELIVERY_BROWSER_UNSAFE');
}
if (!indexHtml.includes('href="/delivery">Delivery preview</a>')
  || !todayHtml.includes('data-open-delivery')
  || !actionHtml.includes('data-open-delivery')
  || !inboxHtml.includes('data-open-delivery')
  || !todayBrowser.includes("actionControlHref('/delivery')")
  || !actionBrowser.includes("buildUrl(state.selections, window.location.search, '/delivery')")
  || !inboxBrowser.includes('`/delivery${search}`')
  || !config.rewrites?.some((entry) => entry.source === '/delivery' && entry.destination === '/delivery.html')) {
  throw new Error('RELEASE_DELIVERY_ROUTE');
}

for (const fragment of [
  'Unified Companion', 'Know.', 'Decide.', 'Return.', 'One loop. No hidden logic.',
  'data-stage="briefing"', 'data-stage="trust"', 'data-stage="memory"',
  'data-stage="actions"', 'data-stage="inbox"', 'data-stage="delivery"',
  'Current verified change', 'Why. What. When.', 'Finite · Explainable · Reversible · Session only',
]) if (!shellHtml.includes(fragment)) throw new Error(`RELEASE_SHELL_HTML:${fragment}`);
for (const fragment of [
  '.journey-strip', '.companion-shell', '.briefing-rail', '.card-workspace',
  '.decision-rail', '.stage-workspace', '@media(max-width:760px)', '@media(max-width:460px)',
]) if (!shellStyles.includes(fragment)) throw new Error(`RELEASE_SHELL_STYLE:${fragment}`);
for (const fragment of [
  'DLKTUnifiedCompanion', 'DLKTCompanionBridge', 'DLKTTrustControl', 'DLKTActionControl',
  'DLKTActionInbox', 'DLKTDeliveryControl', 'combinedSearch', 'window.history.replaceState',
  'ALLOWED_QUERY_KEYS', 'UNIFIED_QUERY_UNKNOWN',
  'automaticExecution: false', 'factualStateChanged: false', 'browserStorage: false', 'replaceChildren',
]) if (!(shellBrowser + shellData).includes(fragment)) throw new Error(`RELEASE_SHELL_BROWSER:${fragment}`);
if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|document\.cookie|indexedDB|Authorization|access_token|refresh_token/iu.test(`${shellBrowser}
${shellData}`)
  || !shellBrowser.includes("privateJson('/api/auth', 'identity-v1')")
  || !shellBrowser.includes("privateJson('/api/persistence', 'persistence-v1')")
  || !shellBrowser.includes("credentials: 'same-origin'")) {
  throw new Error('RELEASE_SHELL_BROWSER_UNSAFE');
}
if (!indexHtml.includes('href="/companion"')
  || !config.rewrites?.some((entry) => entry.source === '/companion' && entry.destination === '/companion.html')
  || !config.rewrites?.some((entry) => entry.source === '/companion-preview' && entry.destination === '/companion-preview.html')) {
  throw new Error('RELEASE_COMPANION_ROUTE_ISOLATION');
}

for (const fragment of [
  "REAL_COMPANION_VERSION = 'dlkt-info-real-companion-1'", "REAL_COMPANION_MODE = 'real-delta-first'",
  "REAL_COMPANION_ROUTE = '/companion'", "REAL_COMPANION_API_ROUTE = '/api/companion'",
  'deterministicEntityMatching: true', 'authoritativeSourceSufficiency: true',
  'operationalLedgerPreferred: true', 'releaseBaselineFallback: true',
  'zeroSyntheticCards: true', 'zeroFillerCards: true', 'caughtUpState: true', 'degradedStateHttpStatus: 200',
  "responseCache: 'private-no-store'", 'sourceCacheSeconds: REAL_COMPANION_SOURCE_CACHE_SECONDS',
]) if (!realCompanionContracts.includes(fragment)) throw new Error(`RELEASE_REAL_COMPANION_CONTRACT:${fragment}`);
for (const fragment of [
  'parseCompanionBridgeSearch', 'parseTrustPolicySearch', 'DEFAULT_COMPANION_PREFERENCES', 'REAL_COMPANION_SEARCH_INVALID',
]) if (!realCompanionDefinition.includes(fragment)) throw new Error(`RELEASE_REAL_COMPANION_DEFINITION:${fragment}`);
for (const fragment of [
  'createRequestMemoizedFetch', 'Promise.allSettled', 'buildDeltaOfficialSnapshot', 'buildLiveOfficialSnapshot',
  'readLatestOperationalDelta', 'readOperationalLedgerConfiguration', 'ALL_OFFICIAL_SOURCES_UNAVAILABLE',
]) if (!realCompanionSource.includes(fragment)) throw new Error(`RELEASE_REAL_COMPANION_SOURCE:${fragment}`);
for (const fragment of [
  'projectRealCompanion', "resultState === 'caught-up'", "resultState === 'no-match'",
  "materialityAssessment: 'unassessed'", 'materialityFilterApplied: false', 'authoritativeSourceSufficient: true',
  'automaticPublication: false', 'automaticExecution: false', 'publicCardsCreated: false', 'aiInterpretation: false',
]) if (!realCompanionProjection.includes(fragment)) throw new Error(`RELEASE_REAL_COMPANION_PROJECTION:${fragment}`);
for (const fragment of [
  'handleRealCompanion', 'parseRealCompanionDefinition', 'buildRealCompanionSources', 'projectRealCompanion',
  "request.method !== 'POST'", 'QUERY_NOT_ALLOWED', 'ORIGIN_REJECTED', "Cache-Control', 'private, no-store'",
  'response.statusCode = 200',
  'createPrivateSnapshotCache', "X-DLKT-Info-Companion', 'real'", "X-DLKT-Info-Synthetic', '0'",
  "request.headers['if-none-match']", 'COMPANION_CONFIGURATION_INVALID',
]) if (!realCompanionApi.includes(fragment)) throw new Error(`RELEASE_REAL_COMPANION_API:${fragment}`);

for (const fragment of [
  "OPERATIONAL_LEDGER_VERSION = 'dlkt-info-operational-delta-ledger-1'",
  "OPERATIONAL_CHECKPOINT_VERSION = 'dlkt-info-operational-checkpoint-1'",
  "OPERATIONAL_DELTA_VERSION = 'dlkt-info-operational-delta-1'",
  "OPERATIONAL_LEDGER_ROOT = 'dlkt-info/operational-ledger/v1'",
  "checkpointStorage: 'private-content-addressed-blob'", "pointerUpdate: 'etag-compare-and-swap'",
  'immutableCheckpoints: true', 'concurrentWriterSafety: true', 'sourceFailureAdvancesPointer: false',
]) if (!operationalContracts.includes(fragment)) throw new Error(`RELEASE_OPERATIONAL_CONTRACT:${fragment}`);
for (const fragment of ['canonicalJson', 'canonicalSha256', "createHash('sha256')"]) {
  if (!operationalCanonical.includes(fragment)) throw new Error(`RELEASE_OPERATIONAL_CANONICAL:${fragment}`);
}
for (const fragment of [
  'DLKT_INFO_OPERATIONAL_LEDGER_ENABLED', 'DLKT_INFO_LEDGER_INSTANCE_ID', 'DLKT_INFO_LEDGER_STORE_ID',
  'DLKT_INFO_LEDGER_BLOB_TOKEN', 'VERCEL_OIDC_TOKEN', 'OPERATIONAL_LEDGER_STORAGE_CREDENTIALS_REQUIRED',
]) if (!operationalConfiguration.includes(fragment)) throw new Error(`RELEASE_OPERATIONAL_CONFIG:${fragment}`);
if (operationalConfiguration.includes('BLOB_READ_WRITE_TOKEN')) throw new Error('RELEASE_OPERATIONAL_GENERIC_BLOB_FALLBACK');
for (const fragment of [
  "access: 'private'", 'useCache: false', 'allowOverwrite: false', 'allowOverwrite: true',
  'ifMatch: expectedEtag', 'BlobPreconditionFailedError', 'OperationalLedgerConflictError',
]) if (!operationalStorage.includes(fragment)) throw new Error(`RELEASE_OPERATIONAL_STORAGE:${fragment}`);
for (const fragment of [
  'assertOperationalLedgerIdentity', 'bootstrapOperationalLedgerIdentity', 'OPERATIONAL_LEDGER_INSTANCE_MISMATCH',
]) if (!operationalIdentity.includes(fragment)) throw new Error(`RELEASE_OPERATIONAL_IDENTITY:${fragment}`);
for (const fragment of [
  'buildOperationalCheckpoint', 'operationalSlotAt', 'canonicalSha256', 'registry.authorizeClaim',
  'readOperationalCheckpoint', 'readOperationalPointer',
]) if (!operationalCheckpoint.includes(fragment)) throw new Error(`RELEASE_OPERATIONAL_CHECKPOINT:${fragment}`);
for (const fragment of [
  'projectOperationalDelta', "mode: 'operational-consecutive-delta'", 'rolledOffIgnoredCount',
  "deltaStatus: 'verified-between-operational-checkpoints'", 'rolloffResolutionDisabled: true',
  'automaticPublication: false', 'publicCardsCreated: false', 'aiInterpretation: false',
]) if (!operationalDelta.includes(fragment)) throw new Error(`RELEASE_OPERATIONAL_DELTA:${fragment}`);
for (const fragment of [
  'readLatestOperationalDelta', 'OPERATIONAL_POINTER_CHECKPOINT_MISMATCH', 'OPERATIONAL_PREVIOUS_CHECKPOINT_MISSING',
]) if (!operationalReader.includes(fragment)) throw new Error(`RELEASE_OPERATIONAL_READER:${fragment}`);
for (const fragment of [
  'collectOperationalDelta', 'compareAndSwap', "status: 'source-unavailable'", "status: 'slot-conflict'",
  'OPERATIONAL_SLOT_ALREADY_COMMITTED', 'sourceError',
]) if (!operationalWorker.includes(fragment)) throw new Error(`RELEASE_OPERATIONAL_WORKER:${fragment}`);
for (const [source, fragments] of [
  [operationalCollectApi, ['timingSafeEqual', 'CRON_SECRET', 'collectOperationalDelta', "Cache-Control', 'private, no-store'", 'UNAUTHORIZED']],
  [operationalReadApi, ['sameOrigin', 'readLatestOperationalDelta', "request.method !== 'GET' && request.method !== 'HEAD'", 'ORIGIN_REJECTED', "Cache-Control', 'private, no-store'", "request.headers['if-none-match']"]],
  [operationalHealthApi, ['installed-not-activated', 'configured-not-verified', 'identityVerified', 'requiredEnvironment']],
  [operationalBootstrap, ['DLKT_INFO_LEDGER_BOOTSTRAP_CONFIRM', 'bootstrapOperationalLedgerIdentity']],
]) for (const fragment of fragments) if (!source.includes(fragment)) throw new Error(`RELEASE_OPERATIONAL_SURFACE:${fragment}`);
if (realCompanionApi.includes('buildSyntheticBriefing')
  || /Authorization\s*[:=]|sb_secret_|service_role|Supabase|dlkt_info_/iu.test(realCompanionApi + realCompanionSource + realCompanionProjection)) {
  throw new Error('RELEASE_REAL_COMPANION_BOUNDARY');
}
for (const fragment of [
  'Real Companion', 'Only verified changes.', 'Or nothing.', 'Official data',
  'YOUR CONTRACT', 'WHY THIS REACHED YOU', 'No verified changes.', 'No synthetic cards.',
]) if (!realCompanionHtml.includes(fragment)) throw new Error(`RELEASE_REAL_COMPANION_HTML:${fragment}`);
for (const fragment of [
  "const VERSION = 'dlkt-info-real-companion-1'", "fetch('/api/companion'", "X-DLKT-Info-Request': 'companion-v1'",
  "credentials: 'same-origin'", 'AbortSignal.timeout(15_000)', 'textContent', 'replaceChildren',
  "params.delete('_vercel_share')", 'search: companionSearch()',
]) if (!realCompanionBrowser.includes(fragment)) throw new Error(`RELEASE_REAL_COMPANION_BROWSER:${fragment}`);
if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|indexedDB|document\.cookie|Bearer\s+|sb_secret_/iu.test(realCompanionBrowser)
  || /companion-shell-data|trust-data|action-data|inbox-data|delivery-data|memory-data|history-data|demo-/iu.test(realCompanionHtml)) {
  throw new Error('RELEASE_REAL_COMPANION_BROWSER_BOUNDARY');
}
const realCompanionColors = [...new Set((realCompanionHtml + realCompanionStyles + realCompanionBrowser).toLowerCase().match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
if (JSON.stringify(realCompanionColors) !== JSON.stringify(['#000000', '#f66061', '#ffffff'])) {
  throw new Error(`RELEASE_REAL_COMPANION_PALETTE:${realCompanionColors.join(',')}`);
}

for (const fragment of [
  'First-run activation', 'Build your brief.', 'Tracked entities', 'Evidence standard',
  'Daily delivery time', 'Open my Companion', 'data-step-panel="interests"',
  'data-step-panel="trust"', 'data-step-panel="delivery"', 'data-step-panel="preview"',
]) if (!activationHtml.includes(fragment)) throw new Error(`RELEASE_ACTIVATION_HTML:${fragment}`);
for (const fragment of [
  '.activation-hero', '.activation-shell', '.activation-progress', '.topic-grid',
  '.trust-grid', '.activation-result', '@media(max-width:520px)',
]) if (!activationStyles.includes(fragment)) throw new Error(`RELEASE_ACTIVATION_STYLE:${fragment}`);
for (const fragment of [
  'DLKTCompanionBridge', 'DLKTTrustControl', 'DLKTActionControl', 'bridge.normalize',
  'bridge.buildSearch', 'trust.buildTrustUrl', 'replaceChildren', 'persistAndOpen', 'savedProjectionMatches',
]) if (!activationBrowser.includes(fragment) && !bridgeBrowser.includes(fragment)) throw new Error(`RELEASE_ACTIVATION_BROWSER:${fragment}`);
if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|document\.cookie|indexedDB|Authorization|access_token|refresh_token/iu.test(activationBrowser)
  || !activationBrowser.includes("fetch('/api/auth'")
  || !activationBrowser.includes("fetch('/api/persistence'")
  || !activationBrowser.includes("credentials: 'same-origin'")
  || !config.rewrites?.some((entry) => entry.source === '/start' && entry.destination === '/start.html')
  || !indexHtml.includes('href="/start">Build briefing</a>')) {
  throw new Error('RELEASE_ACTIVATION_BOUNDARY');
}
for (const fragment of [
  'p_entities text[]', 'include_entities', 'DLKT_INFO_COMPANION_ENTITIES_INVALID',
  'cardinality(p_entities)', 'lower(entity)',
]) if (!companionEntitiesMigration.includes(fragment)) throw new Error(`RELEASE_COMPANION_ENTITIES_MIGRATION:${fragment}`);
for (const fragment of [
  'dlkt_info_briefings_card_budget_check check (max_cards > 0)',
  'is_valid_text_collection(include_entities,160,131072)',
  'minimum_trust', 'conflict_policy', 'authority_requirement', 'minimum_sources',
  'maximum_evidence_age_hours', 'require_official_for_high_impact',
  'jsonb_array_length(v_cards) > v_max_cards',
  "'version', 'dlkt-info-persistence-2'",
]) if (!activationHandoffMigration.includes(fragment)) throw new Error(`RELEASE_ACTIVATION_HANDOFF_MIGRATION:${fragment}`);
if (/p_max_cards not between 1 and 12|is_valid_text_set\(p_entities, 8|max_cards between 1 and 12/u.test(activationHandoffMigration)) {
  throw new Error('RELEASE_FIXED_PRODUCT_CAP');
}

for (const fragment of [
  'dlkt-info-companion-bridge-1', 'companion-v1', 'buildSearch', 'buildUrl', 'parseSearch',
  'UNKNOWN_PARAMETER', 'safe-preview', 'strict-query',
]) if (!bridgeBrowser.includes(fragment) && !bridgeContracts.includes(fragment) && !bridgeGuards.includes(fragment)) {
  throw new Error(`RELEASE_BRIDGE_CONTRACT:${fragment}`);
}
for (const fragment of [
  'bridgeApi.parseSearch(window.location.search)', 'onlyActionable', 'renderEmptyState',
  'Invalid Companion link', 'Nothing crossed your threshold',
]) if (!todayBrowser.includes(fragment) && !todayHtml.includes(fragment)) throw new Error(`RELEASE_BRIDGE_TODAY:${fragment}`);
if (/localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu.test(bridgeBrowser)
  || !indexHtml.includes('<script src="/bridge.js" defer></script>')
  || !todayHtml.includes('<script src="/bridge.js" defer></script>')) {
  throw new Error('RELEASE_BRIDGE_BROWSER_BOUNDARY');
}

for (const fragment of [
  'Trust is a setting.', 'Trust policy', 'What survives the filter', 'Source ladder',
  'data-policy-control', 'data-projection-list', 'data-selected-sources', 'data-apply-policy',
]) if (!trustHtml.includes(fragment)) throw new Error(`RELEASE_TRUST_HTML:${fragment}`);
for (const fragment of [
  '.trust-shell', '.policy-panel', '.projection-panel', '.evidence-panel',
  '.source-ladder', '.truth-boundary', '@media (max-width: 520px)',
]) if (!trustStyles.includes(fragment)) throw new Error(`RELEASE_TRUST_STYLE:${fragment}`);
for (const fragment of [
  "minimumTrust: 'corroborated'", "conflictPolicy: 'exclude'", "authorityRequirement: 'primary'",
  'minimumSources: 2', 'maximumEvidenceAgeHours: 72', 'requireOfficialForHighImpact: true',
  'blockingReasons', 'warnings', 'buildTodayUrl', 'buildTrustUrl', 'replaceChildren',
]) if (!(trustData + trustBrowser).includes(fragment)) throw new Error(`RELEASE_TRUST_BROWSER:${fragment}`);
if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|localStorage|sessionStorage|document\.cookie|indexedDB|fetch\s*\(/iu.test(`${trustData}
${trustBrowser}`)) {
  throw new Error('RELEASE_TRUST_BROWSER_BOUNDARY');
}
if (!todayHtml.includes('<script src="/trust-data.js" defer></script>')
  || !todayHtml.includes('data-trust-banner')
  || !todayBrowser.includes('const trustProjection =')
  || !todayBrowser.includes('const trustedCandidates = trustedIds ? companionCandidates.filter')
  || !todayBrowser.includes('renderTrustProjection();')
  || !bridgeBrowser.includes('...TRUST_KEYS')
  || !config.rewrites?.some((entry) => entry.source === '/trust' && entry.destination === '/trust.html')) {
  throw new Error('RELEASE_TRUST_TODAY_BRIDGE');
}

const dedicatedEnvironment = [
  'DLKT_INFO_SUPABASE_PROJECT_REF', 'DLKT_INFO_SUPABASE_URL', 'DLKT_INFO_SUPABASE_PUBLISHABLE_KEY',
  'DLKT_INFO_DATA_FOUNDATION_READY', 'DLKT_INFO_AUTH_ENABLED', 'DLKT_INFO_REAL_DATA_ENABLED',
  'DLKT_INFO_SOURCE_ACQUISITION_ENABLED', 'DLKT_INFO_DELIVERY_WORKERS_ENABLED',
];
for (const key of dedicatedEnvironment) if (!persistenceContracts.includes(`'${key}'`)) {
  throw new Error(`RELEASE_PERSISTENCE_ENV:${key}`);
}
for (const key of [
  'DLKT_INFO_INTERNAL_TRIAL_ENABLED', 'DLKT_INFO_INTERNAL_REVIEW_ENABLED',
  'DLKT_INFO_INTERNAL_REVIEW_SECRET', 'DLKT_INFO_INTERNAL_REVIEWER_ID',
]) if (!trialContracts.includes(`'${key}'`)) throw new Error(`RELEASE_TRIAL_ENV:${key}`);

if (/(?:process\.env|environment)\.(?:NEXT_PUBLIC_)?SUPABASE_(?:URL|ANON_KEY|SERVICE_ROLE_KEY)/u.test(
  [persistenceContracts, persistenceConfig, persistenceRest, serviceConfig, serviceRest, trialConfig].join('\n'),
)) throw new Error('RELEASE_GENERIC_SUPABASE_FALLBACK');

for (const rpc of [
  'dlkt_info_reserve_source_acquisition', 'dlkt_info_complete_source_acquisition',
  'dlkt_info_read_source_acquisition', 'dlkt_info_commit_source_acquisition',
  'dlkt_info_claim_internal_delta_jobs', 'dlkt_info_complete_internal_delta_trial',
  'dlkt_info_fail_internal_delta_job', 'dlkt_info_review_internal_delta_card',
  'dlkt_info_read_internal_delta_review_queue',
]) if (!serviceRest.includes(`'${rpc}'`)) throw new Error(`RELEASE_SERVICE_RPC:${rpc}`);
if (!serviceRest.includes('apikey: this.#configuration.secretKey')
  || /Authorization.*secretKey/u.test(serviceRest)
  || !serviceRest.includes("redirect: 'error'")
  || !serviceRest.includes("cache: 'no-store'")) throw new Error('RELEASE_SERVICE_BOUNDARY');

for (const fragment of [
  'timingSafeEqual', 'Bearer ${secret}', "error: 'INTERNAL_DELTA_TRIAL_NOT_AVAILABLE'",
  "error: 'UNAUTHORIZED'", 'projectInternalDeltaTrial', 'publicCardsCreated: false',
]) if (!trialWorkerApi.includes(fragment)) throw new Error(`RELEASE_TRIAL_WORKER_API:${fragment}`);
for (const fragment of [
  'timingSafeEqual', 'readReviewQueue(20)', "decision: 'approved' | 'rejected'",
  'reviewer: trial.reviewerId', 'publicCardsEnabled: false', 'publicCardsCreated: false',
]) if (!trialReviewApi.includes(fragment)) throw new Error(`RELEASE_TRIAL_REVIEW_API:${fragment}`);
for (const secretName of ['DLKT_INFO_SUPABASE_SECRET_KEY', 'CRON_SECRET', 'DLKT_INFO_INTERNAL_REVIEW_SECRET']) {
  if (trialWorkerApi.includes(`${secretName}:`) || trialReviewApi.includes(`${secretName}:`)) {
    throw new Error(`RELEASE_SECRET_OUTPUT:${secretName}`);
  }
}

for (const fragment of [
  'runBriefingOrchestra', 'EU_OFFICIAL_SOURCES', 'euOfficialChangePack',
  'maxCards: 12', 'payloadHash', 'relationships(delta, card.id)',
]) if (!trialProjector.includes(fragment)) throw new Error(`RELEASE_TRIAL_PROJECTOR:${fragment}`);
for (const fragment of [
  'readInternalDeltaJobs', 'readInternalReviewQueue', 'readInternalTrialSummary',
  'readInternalTrialReview', 'isSafeEvidenceUrl',
]) if (!trialGuards.includes(fragment)) throw new Error(`RELEASE_TRIAL_GUARD:${fragment}`);

for (const fragment of [
  'create table if not exists dlkt_info_private.internal_delta_jobs',
  'create table if not exists dlkt_info_private.internal_delta_trials',
  'create table if not exists dlkt_info_private.internal_delta_trial_cards',
  'create table if not exists dlkt_info_private.internal_delta_trial_card_claims',
  'create table if not exists dlkt_info_private.internal_delta_review_events',
  'dlkt_info_claim_internal_delta_jobs', 'dlkt_info_complete_internal_delta_trial',
  'dlkt_info_fail_internal_delta_job', 'dlkt_info_review_internal_delta_card',
  'dlkt_info_read_internal_delta_review_queue',
  'source_claim_batches_enqueue_internal_delta', 'internal_claim_payload',
  'internal_delta_review_events', 'p_reviewer', 'public_cards_created = false', 'SOURCE_UNSUPPORTED',
  'source_claim_batches', 'review_expires_at > p_now',
]) if (!trialMigration.includes(fragment)) throw new Error(`RELEASE_TRIAL_MIGRATION:${fragment}`);
if (trialMigration.includes('insert into public.dlkt_info_briefing_cards')
  || !trialMigration.includes('revoke all on dlkt_info_private.internal_delta_trials from service_role')
  || !trialMigration.includes('grant execute on function public.dlkt_info_review_internal_delta_card')
  || !trialMigration.includes('internal_delta_review_events_immutable')) {
  throw new Error('RELEASE_ZERO_AUTOMATIC_PUBLICATION');
}

for (const fragment of [
  "status: 'operational-delta-ledger-ready'", 'humanReviewRequired: true',
  'automaticPublication: false', 'publicCardsEnabled: false',
  "'internal-real-delta-trial'", "'human-review-gate'", "'zero-automatic-publication'",
  "'visual-review-console-preview'", "'before-after-delta-inspection'",
  "'synthetic-human-gate-interaction'", "'daily-companion-experience'",
  "'finite-end-user-briefing'", "'relevance-feedback-preview'",
  "'explicit-caught-up-state'", 'dailyCompanion: dailyCompanionContract',
  'companionBridge: companionBridgeContract', "'companion-to-briefing-bridge'",
  "'strict-url-preferences'", "'no-browser-storage-bridge'", "'explicit-zero-result-state'",
  'briefingHistory: briefingHistoryContract', "'finite-briefing-history'",
  "'new-since-last-briefing'", "'explainable-ranking'", "'explainable-memory-ledger'",
  'memoryControl: memoryControlContract', "'user-controlled-memory'",
  "'bounded-feedback-impact'", "'next-briefing-rank-preview'",
  "'session-only-memory-undo'", "'zero-hidden-memory-signals'",
  'trustControl: trustControlContract', "'user-controlled-trust-policy'",
  "'source-authority-threshold'", "'explicit-conflict-visibility'",
  "'evidence-freshness-gate'", "'zero-automatic-truth-selection'",
  'actionControl: actionControlContract', "'explicit-personal-actions'",
  'actionInbox: actionInboxContract', "'finite-action-inbox'", "'material-delta-follow-up'",
  "'explicit-muted-change-ledger'", "'attention-reopen-on-material-delta'",
  "'zero-hidden-follow-up-execution'",
  'deliveryControl: deliveryControlContract', "'user-controlled-delivery-policy'",
  'unifiedShell: unifiedShellContract', "'unified-companion-shell'",
  "'single-session-state'", "'cross-control-url-continuity'",
  "'finite-operational-journey'", "'zero-duplicated-decision-logic'",
  'firstRunActivation: firstRunActivationContract', "'first-run-activation'",
  'liveOfficialSnapshot: liveOfficialSnapshotContract', "'live-official-readonly-snapshot'",
  'deltaOfficial: deltaOfficialContract', "'release-baseline-delta'",
  'officialApiCacheBoundary: officialApiCacheBoundaryContract', "'origin-safe-private-snapshot-cache'",
  'realCompanion: realCompanionContract', "'real-companion-bridge'",
  "'real-delta-filtering'", "'deterministic-entity-matching'",
  "'truthful-caught-up-state'", "'zero-synthetic-companion-cards'",
  "'shared-official-source-fetch'",
  "'authorization-before-cache'", "'zero-cdn-response-reuse'",
  "'immutable-release-baseline'", "'verified-new-listings'",
  "'verified-metadata-changes'", "'rolloff-resolution-disabled'", "'zero-filler-delta'",
  "'real-eurlex-data'", "'zero-persistence-live-view'", "'no-false-delta'",
  "'etag-revalidation'", "'partial-source-degradation'",
  'provisioningControl: provisioningControlContract', "'database-identity-attestation'",
  "'wrong-project-fail-closed'", "'runtime-provisioning-gate'",
  "'environment-flags-insufficient'", "'zero-secret-health-check'",
  'activationAccountHandoff: activationAccountHandoffContract', "'activation-account-handoff'",
  "'exact-contract-persistence'", "'authenticated-cross-device-restore'",
  "'user-defined-card-budget'", "'payload-bounded-entity-tracking'",
  "'explicit-entity-tracking'", "'finite-attention-budget'",
  "'quiet-hours-enforcement'", "'daily-alert-cap'", "'minimum-alert-gap'",
  "'duplicate-alert-collapse'", "'visible-delivery-reasons'", "'zero-automatic-delivery'",
  "'claim-bound-action-ledger'", "'watch-next-material-change'",
  "'next-briefing-reminder-preview'", "'compare-next-verified-state'",
  "'attention-resolution-without-claim-mutation'", "'explicit-pattern-ignore'",
  "'zero-automatic-action-execution'",
  "'operational-delta-ledger'", "'immutable-content-addressed-checkpoints'",
  "'etag-cas-pointer'", "'consecutive-verification-delta'", "'source-failure-no-pointer-advance'",
]) if (!healthApi.includes(fragment)) throw new Error(`RELEASE_HEALTH:${fragment}`);
for (const fragment of [
  'humanReviewRequired: true', 'publicationAutomatic: false', 'publicCardsEnabled: false',
  'INTERNAL_DELTA_TRIAL_ENVIRONMENT_KEYS',
]) if (!trialHealthApi.includes(fragment)) throw new Error(`RELEASE_TRIAL_HEALTH:${fragment}`);

if (config.functions?.['api/internal-delta-trial.ts']?.maxDuration !== 30
  || config.functions?.['api/internal-delta-review.ts']?.maxDuration !== 10
  || config.functions?.['api/internal-delta-health.ts']?.maxDuration !== 10
  || config.functions?.['api/operational-delta-collect.ts']?.maxDuration !== 30
  || config.functions?.['api/operational-delta.ts']?.maxDuration !== 15
  || config.functions?.['api/operational-delta-health.ts']?.maxDuration !== 10
  || config.schedules?.['eu-official-acquisition']?.schedule !== '17 * * * *'
  || config.schedules?.['internal-delta-trial']?.schedule !== '47 * * * *'
  || config.schedules?.['internal-delta-trial']?.path !== '/api/internal-delta-trial'
  || config.schedules?.['operational-delta-ledger']?.schedule !== '27 * * * *'
  || config.schedules?.['operational-delta-ledger']?.path !== '/api/operational-delta-collect'
  || config.schedules?.['operational-delta-ledger']?.requestMethod !== 'GET') {
  throw new Error('RELEASE_SCHEDULES');
}
for (const route of ['/api/internal-delta-trial', '/api/internal-delta-review', '/api/operational-delta-collect', '/api/operational-delta', '/api/operational-delta-health']) {
  const entry = config.headers?.find((candidate) => candidate.source === route);
  if (entry?.headers?.[0]?.value !== 'private, no-store') throw new Error(`RELEASE_PRIVATE_ROUTE:${route}`);
}

for (const fragment of [
  'databaseInstanceBindingRequired: true', 'schemaAttestationRequired: true', 'activationReceiptRequired: true',
  'environmentFlagsAreInsufficient: true',
  'publishableKeyIsNotBearerToken: true', 'failClosed: true', 'secretsExposed: false',
]) if (!provisioningContracts.includes(fragment)) throw new Error(`RELEASE_PROVISIONING_CONTRACT:${fragment}`);
for (const fragment of [
  'DLKT_INFO_DATABASE_INSTANCE_MISMATCH', 'DLKT_INFO_DATABASE_IDENTITY_MIGRATION_REQUIRED',
  'DLKT_INFO_DATABASE_READINESS_MIGRATION_REQUIRED', 'DLKT_INFO_DATABASE_NOT_READY',
  'DLKT_INFO_DATABASE_ACTIVATION_RECEIPT_INVALID', 'SupabaseProvisioningTransport', 'projectProvisioningControl',
]) if (!(provisioningProjection + provisioningTransport).includes(fragment)) throw new Error(`RELEASE_PROVISIONING_RUNTIME:${fragment}`);
if (!provisioningTransport.includes('apikey: this.#configuration.publishableKey')
  || /Authorization:\s*[`'"]Bearer/u.test(provisioningTransport)
  || !provisioningHealthApi.includes("Cache-Control', 'private, no-store")) {
  throw new Error('RELEASE_PROVISIONING_SECRET_BOUNDARY');
}
for (const fragment of [
  'create table if not exists dlkt_info_private.system_identity',
  'instance_id uuid not null default gen_random_uuid()',
  'create or replace function public.dlkt_info_read_system_identity()',
  'security definer',
  'revoke all on table dlkt_info_private.system_identity from public, anon, authenticated',
  'grant execute on function public.dlkt_info_read_system_identity() to anon, authenticated, service_role',
  "data_region = 'eu-central-1'", 'not automatic_execution', 'not public_cards_enabled',
]) if (!provisioningIdentityMigration.includes(fragment)) throw new Error(`RELEASE_PROVISIONING_MIGRATION:${fragment}`);

for (const fragment of [
  'alter default privileges in schema dlkt_info_private revoke execute on functions from public',
  'grant execute on all functions in schema dlkt_info_private to service_role',
]) if (!databaseReadinessBaselineMigration.includes(fragment)) throw new Error(`RELEASE_DATABASE_READINESS_BASELINE:${fragment}`);
for (const fragment of [
  'create or replace function public.dlkt_info_read_database_readiness()',
  'a57f050de7d0516ce8f7b45db43098a8086688a06c1fc27efcdd4e0352e21420',
  'publicDataPermissions',
  "revoke all privileges (%s) on table %s from public, anon, authenticated cascade",
  "revoke all privileges on table %s from public, anon, authenticated cascade",
  'revoke all privileges on sequence public.dlkt_info_briefing_events_id_seq from public, anon, authenticated cascade',
  'privateFunctionPermissions', 'noUnexpectedObjects', 'activationReceipt',
  'grant execute on function public.dlkt_info_read_database_readiness() to anon, authenticated, service_role',
]) if (!databaseReadinessMigration.includes(fragment)) throw new Error(`RELEASE_DATABASE_READINESS_MIGRATION:${fragment}`);
for (const fragment of [
  "DATABASE_READINESS_VERSION = 'dlkt-info-database-readiness-2'",
  "SCHEMA_MANIFEST_VERSION = 'dlkt-info-schema-manifest-8'",
  "EXPECTED_SCHEMA_FINGERPRINT = 'ef03f90d229d089f8871c64b996994c79c65d0e1e3a0f8e2b0bb08dc2d6f6dec'",
  '"relations": 33', '"functions": 67', '"rls": 21', '"policies": 29', '"triggers": 34',
]) if (!provisioningReadinessManifest.includes(fragment)) throw new Error(`RELEASE_SCHEMA_MANIFEST:${fragment}`);
for (const fragment of [
  'create table public.dlkt_info_shared_cards',
  'alter table public.dlkt_info_shared_cards enable row level security',
  'grant select on public.dlkt_info_shared_cards to anon, authenticated, service_role',
  'create table dlkt_info_private.share_archive_writer',
  "set search_path = ''", 'SHARE_ARCHIVE_WRITE_DENIED', 'SHARE_ARCHIVE_IMMUTABLE',
  'on conflict (id,revision) do nothing', 'dlkt_info_shared_cards_no_truncate',
  '20261120184745_dlkt_info_public_share_archive',
  '2046fac81fee84aba2c66b69a3e9141286598a17eab8456d7f8a309dc9cf368b',
  'publicDataPermissions', 'privateFunctionPermissions', 'noUnexpectedObjects',
]) if (!sharedCardArchiveMigration.includes(fragment)) throw new Error(`RELEASE_SHARED_CARD_ARCHIVE:${fragment}`);

for (const fragment of [
  "OFFICIAL_API_CACHE_BOUNDARY_VERSION = 'dlkt-info-origin-safe-cache-1'",
  "responseCache: 'private-no-store'", 'serverMemoryCacheSeconds: 900',
  'methodValidatedBeforeCache: true', 'queryValidatedBeforeCache: true',
  'requestMarkerValidatedBeforeCache: true', 'originValidatedBeforeCache: true',
  'intermediaryReuseAllowed: false', 'loaderFailuresCached: false',
  "export function createPrivateSnapshotCache<T>", "state: 'hit'", "state: 'shared'", "state: 'miss'",
]) if (!privateSnapshotCache.includes(fragment)) throw new Error(`RELEASE_PRIVATE_CACHE:${fragment}`);

for (const fragment of [
  "LIVE_OFFICIAL_SNAPSHOT_VERSION = 'dlkt-info-live-official-snapshot-1'",
  "LIVE_OFFICIAL_REQUEST_MARKER = 'eu-live-v1'",
  "LIVE_OFFICIAL_ROUTE = '/live'", "LIVE_OFFICIAL_API_ROUTE = '/api/eu-official-live'",
  "mode: 'live-read-only' as const", 'userDefinedCardBudget: true', 'deltaAvailable: false',
  'databaseUsed: false', 'persistenceUsed: false', 'automaticPublication: false',
  'publicCardsCreated: false', 'aiInterpretation: false', "responseCache: 'private-no-store'",
  'serverMemoryCacheSeconds: 900',
]) if (!liveOfficialContracts.includes(fragment)) throw new Error(`RELEASE_LIVE_OFFICIAL_CONTRACT:${fragment}`);
for (const fragment of [
  'Promise.allSettled', 'registry.authorizeClaim', 'LIVE_OFFICIAL_ALL_SOURCES_FAILED',
  'MAX_SERIALIZED_BYTES = 500_000', "deltaStatus: 'not-available-without-baseline'",
  'databaseChanged: false', 'automaticPublication: false', 'aiInterpretation: false',
]) if (!liveOfficialSnapshot.includes(fragment)) throw new Error(`RELEASE_LIVE_OFFICIAL_SNAPSHOT:${fragment}`);
for (const fragment of [
  'LIVE_OFFICIAL_REQUEST_MARKER', "request.method !== 'GET' && request.method !== 'HEAD'",
  'INVALID_REQUEST_ORIGIN', 'QUERY_NOT_ALLOWED', "Cache-Control', 'private, no-store'",
  'createPrivateSnapshotCache', "X-DLKT-Info-Server-Cache'", "X-DLKT-Info-Delta', '0'",
  "X-DLKT-Info-Persistence', '0'", 'LIVE_OFFICIAL_SNAPSHOT_UNAVAILABLE',
]) if (!liveOfficialApi.includes(fragment)) throw new Error(`RELEASE_LIVE_OFFICIAL_API:${fragment}`);
if (/s-maxage|stale-while-revalidate|Cache-Control', 'public/iu.test(liveOfficialApi + deltaOfficialApi)) {
  throw new Error('RELEASE_PUBLIC_CACHE_REGRESSION');
}
if (/Authorization\s*[:=]|sb_secret_|service_role|Supabase|dlkt_info_/iu.test(liveOfficialApi + liveOfficialSnapshot)) {
  throw new Error('RELEASE_LIVE_OFFICIAL_STORAGE_BOUNDARY');
}
for (const fragment of ['Live Official Snapshot', 'Official signals.', 'Finite card budget', 'Source proof', 'Legal boundary', 'Real data. Zero hidden execution.']) {
  if (!liveOfficialHtml.includes(fragment)) throw new Error(`RELEASE_LIVE_OFFICIAL_HTML:${fragment}`);
}
if (/innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(|new Function|document\.write/iu.test(liveOfficialBrowser)
  || /localStorage|sessionStorage|indexedDB|document\.cookie/iu.test(liveOfficialBrowser)) {
  throw new Error('RELEASE_LIVE_OFFICIAL_BROWSER_BOUNDARY');
}
const liveColors = [...new Set((liveOfficialHtml + liveOfficialStyles + liveOfficialBrowser).toLowerCase().match(/#[0-9a-f]{3,8}/gu) ?? [])].sort();
if (JSON.stringify(liveColors) !== JSON.stringify(['#000000', '#f66061', '#ffffff'])) throw new Error(`RELEASE_LIVE_OFFICIAL_PALETTE:${liveColors.join(',')}`);
if (config.functions?.['api/eu-official-live.ts']?.maxDuration !== 15
  || !config.rewrites?.some((entry) => entry.source === '/live' && entry.destination === '/live.html')) {
  throw new Error('RELEASE_LIVE_OFFICIAL_VERCEL');
}


for (const fragment of [
  "DELTA_OFFICIAL_BASELINE_VERSION = 'dlkt-info-eu-release-baseline-1'",
  "DELTA_OFFICIAL_SNAPSHOT_VERSION = 'dlkt-info-eu-release-delta-1'",
  "DELTA_OFFICIAL_REQUEST_MARKER = 'eu-delta-v1'", "DELTA_OFFICIAL_ROUTE = '/delta'",
  "DELTA_OFFICIAL_API_ROUTE = '/api/eu-official-delta'", "baselinePersistence: 'immutable-release-artifact'",
  'rolloffResolutionDisabled: true', 'userDefinedCardBudget: true', "responseCache: 'private-no-store'",
  'serverMemoryCacheSeconds: 900',
]) if (!deltaOfficialContracts.includes(fragment)) throw new Error(`RELEASE_DELTA_CONTRACT:${fragment}`);
for (const fragment of [
  '"capturedAt": "2026-11-13T15:49:44.186Z"',
  '"baselineHash": "157b9edae0f0f22a399f1318fdcad8275b86cf5de39649ea33ed3c6e218e601a"',
  '"entryCount": 200', '"feedId": "eu-commission-proposals"', '"feedId": "eu-parliament-council-legislation"',
]) if (!deltaOfficialBaseline.includes(fragment)) throw new Error(`RELEASE_DELTA_BASELINE:${fragment}`);
for (const fragment of [
  'computeEuReleaseBaselineHash', 'DELTA_BASELINE_HASH_INVALID', 'registry.authorizeClaim',
  'DELTA_BASELINE_PROVENANCE_INVALID', 'structuredClone(EU_RELEASE_BASELINE)',
]) if (!deltaOfficialBaselineGuard.includes(fragment)) throw new Error(`RELEASE_DELTA_BASELINE_GUARD:${fragment}`);
for (const fragment of [
  'Promise.allSettled', 'previous.fingerprint !== entry.fingerprint', 'rolledOffIgnoredCount',
  "const kind = previous ? 'changed' : 'new'", 'DELTA_OFFICIAL_ALL_SOURCES_FAILED',
  "baselinePersistence: 'immutable-release-artifact'", 'rolloffResolutionDisabled: true',
  'databaseUsed: false', 'automaticPublication: false', 'aiInterpretation: false',
]) if (!deltaOfficialSnapshot.includes(fragment)) throw new Error(`RELEASE_DELTA_SNAPSHOT:${fragment}`);
for (const fragment of [
  'DELTA_OFFICIAL_REQUEST_MARKER', "request.method !== 'GET' && request.method !== 'HEAD'",
  'QUERY_NOT_ALLOWED', 'ORIGIN_REJECTED', "X-DLKT-Info-Delta', '1'",
  "X-DLKT-Info-Baseline', 'release-artifact'", "X-DLKT-Info-Database', '0'",
  "X-DLKT-Info-AI-Interpretation', '0'", "Cache-Control', 'private, no-store'",
  'createPrivateSnapshotCache', "X-DLKT-Info-Server-Cache'", "request.headers['if-none-match']",
]) if (!deltaOfficialApi.includes(fragment)) throw new Error(`RELEASE_DELTA_API:${fragment}`);
if (/Authorization\s*[:=]|sb_secret_|service_role|Supabase|dlkt_info_/iu.test(deltaOfficialApi + deltaOfficialSnapshot + deltaOfficialBaselineGuard)) {
  throw new Error('RELEASE_DELTA_STORAGE_BOUNDARY');
}
for (const fragment of [
  'Delta First', 'What changed.', 'Nothing else.', 'No verified changes since this baseline.',
  'data-change-total', 'data-baseline-at', 'data-feed-grid', 'data-card', 'data-empty',
]) if (!deltaOfficialHtml.includes(fragment)) throw new Error(`RELEASE_DELTA_HTML:${fragment}`);
for (const fragment of ['#000000', '#ffffff', '#f66061', '@media(max-width:780px)', '@media(max-width:480px)']) {
  if (!deltaOfficialStyles.toLowerCase().includes(fragment.toLowerCase())) throw new Error(`RELEASE_DELTA_STYLE:${fragment}`);
}
for (const fragment of [
  "const API = '/api/eu-official-delta'", "const MARKER = 'eu-delta-v1'", 'textContent',
  'replaceChildren', "credentials: 'same-origin'", 'AbortSignal.timeout(12_000)', 'positiveBudget',
]) if (!deltaOfficialBrowser.includes(fragment)) throw new Error(`RELEASE_DELTA_BROWSER:${fragment}`);
if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|localStorage|sessionStorage|document\.cookie|access_token|refresh_token/iu.test(deltaOfficialBrowser)) {
  throw new Error('RELEASE_DELTA_BROWSER_BOUNDARY');
}
if (config.functions?.['api/eu-official-delta.ts']?.maxDuration !== 15
  || !config.rewrites?.some((entry) => entry.source === '/delta' && entry.destination === '/delta.html')) {
  throw new Error('RELEASE_DELTA_VERCEL');
}

for (const [document, fragments] of [
  [read('INTERNAL-REAL-DELTA-TRIAL.md'), ['cannot publish automatically', 'append-only events', 'minute 47']],
  [read('DATA-DELIVERY-FOUNDATION.md'), ['ten forward-only migrations', '27 product tables', 'five service-only internal-trial RPCs', 'two public non-secret provisioning-attestation RPCs']],
  [read('DLKT-INFO-BOUNDARY.md'), ['separate secrets', 'forbids automatic creation of public cards']],
  [read('PERSISTENCE-ADAPTER.md'), ['Persistence projection version `dlkt-info-persistence-2`', 'user-defined finite card budget', 'dedicated Supabase project remains the activation requirement']],
  [read('PRODUCT-EXPERIENCE.md'), ['normal entry begins at `/start`', 'finite personal information companion', 'zero-card result']],
  [read('VISUAL-REVIEW-CONSOLE.md'), ['dedicated visual preview at `/review`', 'three explicitly synthetic candidates', 'performs no external request']],
  [read('DAILY-COMPANION-EXPERIENCE.md'), ['connects the homepage Companion', 'zero-result screen', 'performs no external request']],
  [read('COMPANION-BRIEFING-BRIDGE.md'), ['strict URL contract', 'does not use browser storage', 'explicit zero-result state']],
  [read('BRIEFING-HISTORY-MEMORY.md'), ['finite synthetic history', 'Ranking is inspectable', 'Explainable Memory']],
  [read('MEMORY-CONTROL-ROOM.md'), ['transparent, finite memory control surface at `/memory`', 'No hidden signal is allowed', 'strict allowlisted URL contract']],
  [read('TRUST-CONTROL-ROOM.md'), ['transparent evidence-policy surface at `/trust`', 'never edits an atomic claim', 'applies trust before ranking']],
  [read('PERSONAL-ACTION-LAYER.md'), ['explicit, finite next step', 'Actions change attention, not truth.', 'Ignore is exclusive', 'No secret, authentication token or hidden profile']],
  [read('ACTION-INBOX-FOLLOW-UP.md'), ['finite Action Inbox at `/inbox`', 'due now, scheduled, waiting for a material delta', 'changes attention, never truth', 'no automatic execution']],
  [read('DELIVERY-NOTIFICATION-CONTROL.md'), ['transparent delivery-policy surface at `/delivery`', 'Quiet hours are timezone-aware and visible.', 'Anti-spam protection is structural', 'Projection is not delivery.']],
  [read('UNIFIED-COMPANION-SHELL.md'), ['`/companion-preview` combines Briefing', 'valid explicit URL is authoritative', 'positive card budget', 'no filler content is invented']],
  [read('FIRST-RUN-ACTIVATION.md'), ['`/start` converts four explicit decisions', 'no fixed item ceiling', 'email OTP', 'no browser storage']],
  [read('ACTIVATION-ACCOUNT-HANDOFF.md'), ['preserves one exact Companion contract', 'email OTP', 'explicit, valid Companion URL always wins', 'does not impose a commercial ceiling']],
  [read('PROVISIONING-CONTROL-PLANE.md'), ['environment flags as proof', 'database-specific UUID', 'fails closed before OTP', 'WANTADAAA and VECINIADA databases are explicitly ineligible']],
  [read('DATABASE-READINESS-ATTESTATION.md'), ['27 relations', 'activation receipt', 'Any missing table', 'six side-effect-free validators']],
  [read('LIVE-OFFICIAL-SNAPSHOT.md'), ['current external data', 'not Delta First', 'same-origin GET and HEAD', 'no AI interpretation']],
  [read('DELTA-FIRST-RELEASE-BASELINE.md'), ['immutable release artifact', 'reported as a new official listing', 'never reported as resolved', 'returns no invented card']],
  [read('ORIGIN-SAFE-CACHE-BOUNDARY.md'), ['before reading any cached snapshot', 'private, no-store', 'individual server instance', 'Loader failures are never cached']],
  [read('REAL-COMPANION-BRIDGE.md'), ['canonical real-data Companion', 'zero cards', 'One official authority is sufficient only', 'private, no-store']],
]) for (const fragment of fragments) if (!document.includes(fragment)) throw new Error(`RELEASE_DOCUMENT:${fragment}`);

// Wallet release boundaries supplement the existing gate without weakening it.
const walletPublic=JSON.parse(read('vercel.public.json'));
if(!walletPublic.functions['api/wallet.ts']||!walletPublic.rewrites.some(rule=>rule.source==='/wallet'&&rule.destination==='/wallet.html'))throw new Error('RELEASE_WALLET_ROUTE');
for(const file of ['src/wallet/contracts.ts','src/wallet/store.ts','src/wallet/providers.ts','src/wallet/events.ts','src/wallet/daily.ts','src/wallet/gmail.ts','src/wallet/browser.ts','src/wallet/home-browser.ts','api/wallet.ts','public/wallet.html','public/wallet-contracts.js','public/data-guards.js','public/wallet-providers.js','public/wallet-browser.js','public/wallet-home-browser.js'])if(!expected.has(file))throw new Error(`RELEASE_WALLET_FILE:${file}`);
for(const file of ['public/wallet-gmail.js','public/wallet-store.js'])if(existsSync(file))throw new Error(`RELEASE_WALLET_PRIVATE_ASSET:${file}`);
if(walletPublic.functions['api/connections.ts']?.maxDuration!==60||Object.keys(walletPublic.functions).length!==15||walletPublic.functions['api/article-photo.ts']?.maxDuration!==25||walletPublic.functions['api/share-archive.ts']?.maxDuration!==60||walletPublic.functions['api/iceo-refresh.ts']?.maxDuration!==60||JSON.stringify(walletPublic.schedules)!==JSON.stringify({'iceo-daily-top':{schedule:'*/2 * * * *',path:'/api/iceo-refresh',requestMethod:'GET',jitter:1}}))throw new Error('RELEASE_CONNECTIONS_ROUTE');
for(const file of ['api/connections.ts','src/connections/types.ts','src/connections/config.ts','src/connections/crypto.ts','src/connections/store.ts','src/connections/providers.ts','src/connections/provider-http.ts','src/connections/service.ts','src/connections/browser.ts','public/connections-browser.js','public/connections-types.js','public/wallet-events.js','public/wallet.css'])if(!expected.has(file))throw new Error(`RELEASE_CONNECTIONS_FILE:${file}`);
for(const file of ['public/connections-crypto.js','public/connections-store.js','public/connections-config.js','public/connections-service.js','public/connections-providers.js','public/connections-provider-http.js'])if(existsSync(file))throw new Error(`RELEASE_CONNECTIONS_PRIVATE_ASSET:${file}`);
if(!read('public/iceo.html').includes('href="/wallet"')||!read('public/wallet.html').includes('/wallet-browser.js'))throw new Error('RELEASE_WALLET_ENTRY');
for(const file of ['api/share-archive.ts','src/share/content.ts','src/iceo/saved-updates.ts','src/local/event-calendar.ts','public/saved-updates.js','public/local-event-calendar.js'])if(!expected.has(file))throw new Error(`RELEASE_USEFUL_INFORMATION_FILE:${file}`);
for(const file of ['public/share-content.js','public/content.js'])if(existsSync(file))throw new Error(`RELEASE_SHARE_SERVER_ASSET:${file}`);


// Exact original-photo route and its shared public reference must be part of this release.
for(const file of ['api/article-photo.ts','src/media/article-photo-source.ts','src/media/article-photo-raster.ts','src/media/article-photo-service.ts','src/media/article-photo-reference.ts','public/article-photo-reference.js'])if(!expected.has(file))throw new Error('RELEASE_ARTICLE_PHOTO_FILE:'+file);

const migrationResult = execFileSync(process.execPath, ['tests/database/migration-smoke.mjs'], { encoding: 'utf8' }).trim();
if (!migrationResult.includes('\"tables\":32')
  || !migrationResult.includes('\"companion_functions\":2')
  || !migrationResult.includes('\"acquisition_functions\":4')
  || !migrationResult.includes('\"trial_functions\":5')
  || !migrationResult.includes('\"eu_sources\":2')
  || !migrationResult.includes('\"provisioning_functions\":2')) throw new Error(`RELEASE_MIGRATION_SMOKE:${migrationResult}`);

execFileSync('npm', ['run', 'verify'], { stdio: 'inherit' });
console.log('DLKT_INFO_RELEASE_OK', JSON.stringify({
  version: manifest.version,
  engineVersion: manifest.engineVersion,
  serviceVersion: manifest.serviceVersion,
  internalTrialVersion: manifest.internalTrialVersion,
  visualReviewConsoleVersion: manifest.visualReviewConsoleVersion,
  dailyCompanionVersion: manifest.dailyCompanionVersion,
  liveOfficialSnapshotVersion: manifest.liveOfficialSnapshotVersion,
  deltaOfficialSnapshotVersion: manifest.deltaOfficialSnapshotVersion,
  deltaOfficialBaselineVersion: manifest.deltaOfficialBaselineVersion,
  deltaOfficialBaselineCapturedAt: manifest.deltaOfficialBaselineCapturedAt,
  deltaOfficialBaselineHash: manifest.deltaOfficialBaselineHash,
  officialApiCacheBoundaryVersion: manifest.officialApiCacheBoundaryVersion,
  realCompanionVersion: manifest.realCompanionVersion,
  operationalLedgerVersion: manifest.operationalLedgerVersion,
  operationalCheckpointVersion: manifest.operationalCheckpointVersion,
  operationalDeltaVersion: manifest.operationalDeltaVersion,
  blobSdkVersion: manifest.blobSdkVersion,
  zodOverrideVersion: manifest.zodOverrideVersion,
  companionBridgeVersion: manifest.companionBridgeVersion,
  briefingHistoryVersion: manifest.briefingHistoryVersion,
  explainableMemoryVersion: manifest.explainableMemoryVersion,
  memoryControlVersion: manifest.memoryControlVersion,
  trustControlVersion: manifest.trustControlVersion,
  actionControlVersion: manifest.actionControlVersion,
  actionInboxVersion: manifest.actionInboxVersion,
  deliveryControlVersion: manifest.deliveryControlVersion,
  unifiedShellVersion: manifest.unifiedShellVersion,
  firstRunActivationVersion: manifest.firstRunActivationVersion,
  activationAccountHandoffVersion: manifest.activationAccountHandoffVersion,
  provisioningControlVersion: manifest.provisioningControlVersion,
  systemIdentityVersion: manifest.systemIdentityVersion,
  databaseReadinessVersion: manifest.databaseReadinessVersion,
  schemaManifestVersion: manifest.schemaManifestVersion,
  companionEntitiesMigration: manifest.companionEntitiesMigration,
  activationHandoffMigration: manifest.activationHandoffMigration,
  provisioningIdentityMigration: manifest.provisioningIdentityMigration,
  databaseReadinessMigration: manifest.databaseReadinessMigration,
  expectedSchemaFingerprint: manifest.expectedSchemaFingerprint,
  informationPackVersion: manifest.informationPackVersion,
  internalTrialMigration: manifest.internalTrialMigration,
  revision: manifest.revision,
  palette: manifest.palette,
  files: Object.keys(manifest.files).length,
}));
