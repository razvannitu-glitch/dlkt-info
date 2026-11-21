import type { IncomingMessage, ServerResponse } from 'node:http';
import { ENGINE_ID, ENGINE_VERSION, PRODUCT_ID, PRODUCT_VERSION } from '../src/core/contracts.js';
import { DATA_FOUNDATION_MIGRATION, DATA_FOUNDATION_VERSION } from '../src/data/contracts.js';
import { COMPANION_VERSION } from '../src/companion/contracts.js';
import { companionBridgeContract } from '../src/bridge/index.js';
import { IDENTITY_VERSION } from '../src/identity/contracts.js';
import { persistenceRuntimeProjection, readPersistenceConfiguration } from '../src/persistence/index.js';
import { EU_OFFICIAL_FEEDS, EU_OFFICIAL_PACK_ID, EU_OFFICIAL_PACK_VERSION, EU_OFFICIAL_SOURCES } from '../src/packs/eu-official/index.js';
import { INTERNAL_DELTA_TRIAL_MIGRATION, INTERNAL_DELTA_TRIAL_VERSION, readInternalTrialConfiguration } from '../src/trials/index.js';
import { visualReviewConsoleContract } from '../src/review/index.js';
import { dailyCompanionContract } from '../src/today/index.js';
import { briefingHistoryContract } from '../src/history/index.js';
import { memoryControlContract } from '../src/memory/index.js';
import { trustControlContract } from '../src/trust/index.js';
import { actionControlContract } from '../src/actions/index.js';
import { actionInboxContract } from '../src/inbox/index.js';
import { deliveryControlContract } from '../src/delivery/index.js';
import { unifiedShellContract } from '../src/shell/index.js';
import { firstRunActivationContract } from '../src/activation/index.js';
import { activationAccountHandoffContract } from '../src/handoff/index.js';
import { provisioningControlContract } from '../src/provisioning/index.js';
import { liveOfficialSnapshotContract } from '../src/live-official/index.js';
import { deltaOfficialContract } from '../src/delta-official/index.js';
import { officialApiCacheBoundaryContract } from '../src/http/private-snapshot-cache.js';
import { realCompanionContract } from '../src/real-companion/index.js';
import {
  OPERATIONAL_LEDGER_COLLECT_ROUTE,
  OPERATIONAL_LEDGER_HEALTH_ROUTE,
  OPERATIONAL_LEDGER_INTERVAL_MINUTES,
  OPERATIONAL_LEDGER_READ_ROUTE,
  operationalLedgerContract,
  readOperationalLedgerConfiguration,
} from '../src/operational-ledger/index.js';

export default function health(req: IncomingMessage, res: ServerResponse): void {
  const persistence = persistenceRuntimeProjection(readPersistenceConfiguration(process.env));
  const internalTrial = readInternalTrialConfiguration(process.env);
  const operationalLedger = readOperationalLedgerConfiguration(process.env);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
    return;
  }
  res.statusCode = 200;
  if (req.method === 'HEAD') { res.end(); return; }
  res.end(JSON.stringify({
    product: PRODUCT_ID,
    productVersion: PRODUCT_VERSION,
    engine: ENGINE_ID,
    engineVersion: ENGINE_VERSION,
    status: 'operational-delta-ledger-ready',
    scope: 'independent',
    companionVersion: COMPANION_VERSION,
    identity: {
      version: IDENTITY_VERSION,
      configured: persistence.configured,
      enabled: persistence.authEnabled,
      sessionBoundary: 'http-only-cookie',
      signInMethod: 'email-otp',
      blocker: persistence.authEnabled ? null : persistence.blocker,
    },
    persistence,
    dataFoundation: {
      version: DATA_FOUNDATION_VERSION,
      migration: DATA_FOUNDATION_MIGRATION,
      configuration: persistence.configuration,
      provisioned: persistence.provisioned,
      authEnabled: persistence.authEnabled,
      realDataEnabled: persistence.realDataEnabled,
      sourceAcquisitionEnabled: persistence.sourceAcquisitionEnabled,
      deliveryWorkersEnabled: persistence.deliveryWorkersEnabled,
      blocker: persistence.blocker,
    },
    visualReviewConsole: visualReviewConsoleContract,
    dailyCompanion: dailyCompanionContract,
    briefingHistory: briefingHistoryContract,
    memoryControl: memoryControlContract,
    trustControl: trustControlContract,
    actionControl: actionControlContract,
    actionInbox: actionInboxContract,
    deliveryControl: deliveryControlContract,
    firstRunActivation: firstRunActivationContract,
    activationAccountHandoff: activationAccountHandoffContract,
    provisioningControl: provisioningControlContract,
    liveOfficialSnapshot: liveOfficialSnapshotContract,
    deltaOfficial: deltaOfficialContract,
    officialApiCacheBoundary: officialApiCacheBoundaryContract,
    realCompanion: realCompanionContract,
    operationalLedger: {
      ...operationalLedgerContract,
      status: operationalLedger.state === 'ready' ? 'configured-not-verified' : 'installed-not-activated',
      collectionIntervalMinutes: OPERATIONAL_LEDGER_INTERVAL_MINUTES,
      collectRoute: OPERATIONAL_LEDGER_COLLECT_ROUTE,
      readRoute: OPERATIONAL_LEDGER_READ_ROUTE,
      healthRoute: OPERATIONAL_LEDGER_HEALTH_ROUTE,
      blocker: operationalLedger.state === 'ready' ? 'OPERATIONAL_LEDGER_IDENTITY_BOOTSTRAP_REQUIRED' : operationalLedger.blocker,
    },
    unifiedShell: unifiedShellContract,
    companionBridge: companionBridgeContract,
    internalTrial: {
      version: INTERNAL_DELTA_TRIAL_VERSION,
      migration: INTERNAL_DELTA_TRIAL_MIGRATION,
      status: internalTrial.state === 'ready' ? 'ready' : 'installed-not-activated',
      privateWorkerReady: true,
      finiteCardLimit: 12,
      humanReviewRequired: true,
      reviewEnabled: internalTrial.state === 'ready' && internalTrial.reviewEnabled,
      automaticPublication: false,
      publicCardsEnabled: false,
      blocker: internalTrial.state === 'ready' ? null : persistence.blocker ?? 'INTERNAL_TRIAL_DISABLED',
    },
    informationPacks: [{
      id: EU_OFFICIAL_PACK_ID,
      version: EU_OFFICIAL_PACK_VERSION,
      status: persistence.sourceAcquisitionEnabled ? 'active' : 'installed-not-activated',
      sources: EU_OFFICIAL_SOURCES.length,
      feeds: EU_OFFICIAL_FEEDS.length,
      baselineRequired: true,
      privateWorkerReady: true,
      privateClaimLedgerReady: true,
      scheduledAcquisitionConfigured: true,
      publicCardsEnabled: false,
      liveAcquisitionEnabled: persistence.sourceAcquisitionEnabled,
      blocker: persistence.sourceAcquisitionEnabled ? null : persistence.blocker ?? 'SOURCE_ACQUISITION_DISABLED',
    }],
    capabilities: [
      'atomic-claims', 'provenance', 'contradictions', 'delta-first',
      'finite-briefings', 'scheduled-delivery', 'infocard-scroll',
      'isolated-rls-data-model', 'idempotent-scheduler', 'transactional-outbox',
      'delivery-receipts', 'cross-device-memory', 'personal-companion-loop',
      'same-origin-companion-preview', 'dedicated-persistence-adapter',
      'authenticated-companion-rpc', 'email-otp-identity',
      'http-only-session', 'server-side-session-refresh',
      'eu-official-change-radar', 'source-acquisition-checkpoints',
      'private-baseline-worker', 'atomic-source-claim-commit', 'append-only-source-claim-ledger',
      'internal-real-delta-trial', 'claim-linked-review-candidates',
      'human-review-gate', 'zero-automatic-publication',
      'visual-review-console-preview', 'before-after-delta-inspection',
      'synthetic-human-gate-interaction',
      'daily-companion-experience', 'finite-end-user-briefing',
      'relevance-feedback-preview', 'explicit-caught-up-state',
      'first-run-activation', 'explicit-entity-tracking', 'finite-attention-budget',
      'activation-account-handoff', 'exact-contract-persistence', 'authenticated-cross-device-restore',
      'user-defined-card-budget', 'payload-bounded-entity-tracking',
      'database-identity-attestation', 'database-readiness-attestation', 'schema-fingerprint',
      'activation-receipt', 'schema-drift-fail-closed', 'private-function-least-privilege',
      'live-official-readonly-snapshot', 'real-eurlex-data', 'zero-persistence-live-view',
      'no-false-delta', 'etag-revalidation', 'partial-source-degradation',
      'origin-safe-private-snapshot-cache', 'authorization-before-cache', 'zero-cdn-response-reuse',
      'real-companion-bridge', 'real-delta-filtering', 'deterministic-entity-matching',
      'truthful-caught-up-state', 'zero-synthetic-companion-cards', 'shared-official-source-fetch',
      'operational-delta-ledger', 'immutable-content-addressed-checkpoints', 'etag-cas-pointer',
      'consecutive-verification-delta', 'source-failure-no-pointer-advance', 'rolloff-resolution-disabled',
      'release-baseline-delta', 'immutable-release-baseline', 'verified-new-listings',
      'verified-metadata-changes', 'rolloff-resolution-disabled', 'zero-filler-delta',
      'wrong-project-fail-closed', 'runtime-provisioning-gate', 'environment-flags-insufficient', 'zero-secret-health-check',
      'companion-to-briefing-bridge', 'strict-url-preferences',
      'no-browser-storage-bridge', 'explicit-zero-result-state',
      'finite-briefing-history', 'new-since-last-briefing',
      'explainable-ranking', 'explainable-memory-ledger',
      'user-controlled-memory', 'bounded-feedback-impact',
      'next-briefing-rank-preview', 'session-only-memory-undo',
      'zero-hidden-memory-signals',
      'user-controlled-trust-policy', 'source-authority-threshold',
      'explicit-conflict-visibility', 'evidence-freshness-gate',
      'zero-automatic-truth-selection',
      'explicit-personal-actions', 'claim-bound-action-ledger',
      'watch-next-material-change', 'next-briefing-reminder-preview',
      'compare-next-verified-state', 'attention-resolution-without-claim-mutation',
      'explicit-pattern-ignore', 'zero-automatic-action-execution',
      'finite-action-inbox', 'material-delta-follow-up',
      'explicit-muted-change-ledger', 'attention-reopen-on-material-delta',
      'zero-hidden-follow-up-execution',
      'user-controlled-delivery-policy', 'quiet-hours-enforcement',
      'daily-alert-cap', 'minimum-alert-gap', 'duplicate-alert-collapse',
      'visible-delivery-reasons', 'zero-automatic-delivery',
      'unified-companion-shell', 'single-session-state',
      'cross-control-url-continuity', 'finite-operational-journey',
      'zero-duplicated-decision-logic',
    ],
  }));
}
