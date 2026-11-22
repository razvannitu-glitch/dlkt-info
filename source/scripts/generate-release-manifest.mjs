import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ICEO_SOURCES } from '../.build/src/iceo/registry.js';
import {NEWS_PUBLISHERS} from '../.build/src/iceo/news-sources.js';
import {PUBLIC_EDITORIAL_CATEGORIES} from '../.build/src/iceo/editorial-categories.js';
import {SCHEMA_MANIFEST_VERSION,DATABASE_READINESS_MIGRATION,EXPECTED_SCHEMA_FINGERPRINT} from '../.build/src/provisioning/readiness-manifest.js';

const version = '0.9.46';
const output = `RELEASE-${version}.json`;
const files = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (file === 'supabase/.temp') continue;
    if (entry.isDirectory()) walk(file);
    else files.push(file);
  }
};
for (const directory of ['api', 'src', 'tests', 'public', 'supabase', 'scripts']) walk(directory);
files.push(
  'DATA-DELIVERY-FOUNDATION.md', 'DLKT-INFO-BOUNDARY.md', 'DLKT-KATE-PALETTE.md',
  'EU-OFFICIAL-CHANGE-RADAR.md', 'IDENTITY-SESSION-GATE.md', 'INTERNAL-REAL-DELTA-TRIAL.md',
  'PERSISTENCE-ADAPTER.md', 'PERSONAL-COMPANION-LOOP.md', 'PRIVATE-BASELINE-WORKER.md',
  'BRIEFING-HISTORY-MEMORY.md', 'COMPANION-BRIEFING-BRIDGE.md', 'DAILY-COMPANION-EXPERIENCE.md',
  'PRODUCT-EXPERIENCE.md', 'VISUAL-REVIEW-CONSOLE.md', 'MEMORY-CONTROL-ROOM.md', 'TRUST-CONTROL-ROOM.md',
  'PERSONAL-ACTION-LAYER.md', 'ACTION-INBOX-FOLLOW-UP.md', 'DELIVERY-NOTIFICATION-CONTROL.md',
  'UNIFIED-COMPANION-SHELL.md', 'FIRST-RUN-ACTIVATION.md', 'ACTIVATION-ACCOUNT-HANDOFF.md',
  'PROVISIONING-CONTROL-PLANE.md', 'DATABASE-READINESS-ATTESTATION.md', 'LIVE-OFFICIAL-SNAPSHOT.md', 'DELTA-FIRST-RELEASE-BASELINE.md', 'ORIGIN-SAFE-CACHE-BOUNDARY.md', 'REAL-COMPANION-BRIDGE.md', 'OPERATIONAL-DELTA-LEDGER.md',
  'ICEO-PUBLIC-PREVIEW.md', 'NEWS-TAXONOMY.md', 'READER-VALUE.md', 'SOURCE-INSIGHTS.md', 'DEVICE-MEMORY.md', 'SOURCE-COMPARISON.md', 'ACCOUNT-EDITION-BRIDGE.md', 'VERIFIED-EDITIONS.md', 'MINIMAL-READER.md', 'LOCAL-BRIEFING.md', 'CLEAR-ENTRY.md', 'PERSONAL-EDITION.md', 'CLEAR-RETURN.md', 'STABLE-SELECTION.md', 'DIRECT-CARDS.md', 'PALMA-DAILY.md', 'PALMA-DAILY-ACCEPTANCE.json', 'READABLE-LOCAL.md', 'PALMA-VISIBLE-INFORMATION-ACCEPTANCE.json', 'CITY-SOURCES.json', 'DAILY-SOURCE-EXPANSION.md', 'DAILY-INTERESTS-ACCEPTANCE.md', 'TODAY-GLANCE-ACCEPTANCE.md', 'TODAY-GLANCE-SOURCES.md', 'NEWS-TICKER-ACCEPTANCE.md', 'TICKER-REPAIR-ACCEPTANCE.md', 'MOBILE-TICKER-ACCEPTANCE.md', 'FOOTER-LEGAL-ACCEPTANCE.md', 'FOOTER-LEGAL-SOURCES.md', 'MINIMAL-UI-ACCEPTANCE.md', 'KATE-IDENTITY.md', 'DAILY-CARD-MIX.md', 'ORGANIZATIONS.md', 'TODAY-GENERAL.md', 'PRACTICAL-TODAY.md', 'CONSUMER-SHARE.md', 'MOBILE-SHARE.md', 'RETURN-BRIEF.md', 'CARD-PHOTOS.md', 'CARD-PHOTOS-SOURCES.md', 'LOCAL-FIRST.md', 'CONTEXTUAL-EDITION.md', 'HOMEPAGE-CARDS.md', 'CITY-EDITION.md', 'INFO-WALLET.md', 'vercel.public.json', 'package-lock.json', 'package.json', 'tsconfig.build.json', 'tsconfig.json', 'vercel.json', 'verify-release.mjs',
);
files.sort();
const hashes = Object.fromEntries(files.map((file) => [
  file,
  createHash('sha256').update(readFileSync(file)).digest('hex'),
]));
const manifest = {
  product: 'dlkt-info',
  engine: 'dlkt-info-inphocore-engine-orchestra',
  version,
  walletVersion: 'dlkt-info-wallet-1',
  walletProfileVersion: 'dlkt-info-wallet-profile-1',
  connectionsVersion: 'dlkt-info-connections-1',
  iceoVersion: 'iceo-primary-mesh-1',
  publicSourceCount: ICEO_SOURCES.length,
  publicPublisherCount: new Set(ICEO_SOURCES.map(source=>source.publisher)).size,
  reviewedNewsPublisherFamilies: NEWS_PUBLISHERS.length,
  publicEditorialCategoryCount: PUBLIC_EDITORIAL_CATEGORIES.length,
  publicDailyTarget: 30,
  publicDailyMaximum: 40,
  publicDailyRefreshSchedule: '*/2 * * * *',
  localNewsSourceCount: 2,
  engineVersion: '0.1.0',
  dataFoundationVersion: 'dlkt-info-data-1',
  companionVersion: 'dlkt-info-companion-1',
  realCompanionVersion: 'dlkt-info-real-companion-1',
  operationalLedgerVersion: 'dlkt-info-operational-delta-ledger-1',
  operationalCheckpointVersion: 'dlkt-info-operational-checkpoint-1',
  operationalDeltaVersion: 'dlkt-info-operational-delta-1',
  blobSdkVersion: '2.9.0',
  zodOverrideVersion: '4.6.7',
  companionBridgeVersion: 'dlkt-info-companion-bridge-1',
  briefingHistoryVersion: 'dlkt-info-briefing-history-1',
  explainableMemoryVersion: 'dlkt-info-explainable-memory-1',
  memoryControlVersion: 'dlkt-info-memory-control-1',
  trustControlVersion: 'dlkt-info-trust-control-1',
  actionControlVersion: 'dlkt-info-action-control-1',
  actionInboxVersion: 'dlkt-info-action-inbox-1',
  deliveryControlVersion: 'dlkt-info-delivery-control-1',
  unifiedShellVersion: 'dlkt-info-unified-shell-1',
  firstRunActivationVersion: 'dlkt-info-first-run-activation-1',
  activationAccountHandoffVersion: 'dlkt-info-activation-account-handoff-1',
  provisioningControlVersion: 'dlkt-info-provisioning-control-2',
  systemIdentityVersion: 'dlkt-info-system-identity-1',
  databaseReadinessVersion: 'dlkt-info-database-readiness-2',
  schemaManifestVersion: SCHEMA_MANIFEST_VERSION,
  persistenceVersion: 'dlkt-info-persistence-2',
  identityVersion: 'dlkt-info-identity-1',
  serviceVersion: 'dlkt-info-service-1',
  internalTrialVersion: 'dlkt-info-internal-delta-trial-1',
  visualReviewConsoleVersion: 'dlkt-info-visual-review-console-1',
  dailyCompanionVersion: 'dlkt-info-daily-companion-1',
  liveOfficialSnapshotVersion: 'dlkt-info-live-official-snapshot-1',
  deltaOfficialSnapshotVersion: 'dlkt-info-eu-release-delta-1',
  deltaOfficialBaselineVersion: 'dlkt-info-eu-release-baseline-1',
  deltaOfficialBaselineCapturedAt: '2026-11-13T15:49:44.186Z',
  deltaOfficialBaselineHash: '157b9edae0f0f22a399f1318fdcad8275b86cf5de39649ea33ed3c6e218e601a',
  officialApiCacheBoundaryVersion: 'dlkt-info-origin-safe-cache-1',
  informationPackId: 'eu-official-change-radar',
  informationPackVersion: '0.1.1',
  sourceAcquisitionMigration: '20261111224500_dlkt_info_source_acquisition',
  privateBaselineMigration: '20261111233000_dlkt_info_private_baseline_commit',
  internalTrialMigration: '20261112003000_dlkt_info_internal_real_delta_trial',
  companionEntitiesMigration: '20261112221500_dlkt_info_companion_entities',
  activationHandoffMigration: '20261112233000_dlkt_info_activation_account_handoff',
  provisioningIdentityMigration: '20261113115256_dlkt_info_provisioning_identity_guard',
  databaseReadinessMigration: DATABASE_READINESS_MIGRATION,
  expectedSchemaFingerprint: EXPECTED_SCHEMA_FINGERPRINT,
  reviewPublicationMode: 'human-review-private-no-auto-publication',
  revision: 'iceo-primary-mesh-1',
  createdAt: new Date().toISOString(),
  palette: { black: '#000000', white: '#FFFFFF', coral: '#F66061' },
  files: hashes,
};
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, files: files.length, version, revision: manifest.revision }));
