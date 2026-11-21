import type { EuOfficialFeedKind } from '../packs/eu-official/contracts.js';

export const DELTA_OFFICIAL_BASELINE_VERSION = 'dlkt-info-eu-release-baseline-1' as const;
export const DELTA_OFFICIAL_SNAPSHOT_VERSION = 'dlkt-info-eu-release-delta-1' as const;
export const DELTA_OFFICIAL_REQUEST_MARKER = 'eu-delta-v1' as const;
export const DELTA_OFFICIAL_ROUTE = '/delta' as const;
export const DELTA_OFFICIAL_API_ROUTE = '/api/eu-official-delta' as const;

export interface EuReleaseBaselineEntry {
  readonly feedId: string;
  readonly feedKind: EuOfficialFeedKind;
  readonly sourceId: string;
  readonly celexId: string;
  readonly documentTitle: string;
  readonly creator: string;
  readonly link: string;
  readonly guid: string;
  readonly publishedAt: string | null;
  readonly fingerprint: string;
}

export interface EuReleaseBaselineFeed {
  readonly feedId: string;
  readonly feedKind: EuOfficialFeedKind;
  readonly sourceId: string;
  readonly label: string;
  readonly retrievedAt: string;
  readonly channelPublishedAt: string;
  readonly bodyHash: string;
  readonly entries: readonly EuReleaseBaselineEntry[];
}

export interface EuReleaseBaselineUnsigned {
  readonly version: typeof DELTA_OFFICIAL_BASELINE_VERSION;
  readonly product: 'dlkt-info';
  readonly pack: 'eu-official-change-radar';
  readonly packVersion: string;
  readonly capturedAt: string;
  readonly feeds: readonly EuReleaseBaselineFeed[];
  readonly entryCount: number;
}

export interface EuReleaseBaseline extends EuReleaseBaselineUnsigned {
  readonly baselineHash: string;
}

export interface DeltaOfficialSourceProjection {
  readonly id: string;
  readonly name: string;
  readonly authority: 'official';
  readonly attributionRequired: true;
  readonly termsUrl: string;
  readonly rightsReviewExpiresAt: string;
}

export type DeltaOfficialChangedField = 'title' | 'creator' | 'source-url' | 'document-guid' | 'publication-time';

export interface DeltaOfficialPreviousState {
  readonly title: string;
  readonly creator: string;
  readonly sourceUrl: string;
  readonly publishedAt: string | null;
  readonly fingerprint: string;
}

export interface DeltaOfficialCard {
  readonly id: string;
  readonly kind: 'new' | 'changed';
  readonly feedId: string;
  readonly feedKind: EuOfficialFeedKind;
  readonly feedLabel: string;
  readonly celexId: string;
  readonly title: string;
  readonly creator: string;
  readonly sourceUrl: string;
  readonly source: DeltaOfficialSourceProjection;
  readonly publishedAt: string;
  readonly observedAt: string;
  readonly baselineAt: string;
  readonly previous: DeltaOfficialPreviousState | null;
  readonly changedFields: readonly DeltaOfficialChangedField[];
  readonly stateLabel: 'New official listing' | 'Official metadata changed';
  readonly legalCaveat: string;
  readonly trust: 'official-source';
  readonly deltaStatus: 'verified-against-release-baseline';
  readonly aiInterpretation: false;
}

export interface DeltaOfficialFeedProjection {
  readonly id: string;
  readonly label: string;
  readonly kind: EuOfficialFeedKind;
  readonly status: 'available' | 'unavailable';
  readonly baselineEntryCount: number;
  readonly currentEntryCount: number;
  readonly authorizedClaimCount: number;
  readonly newCount: number;
  readonly changedCount: number;
  readonly unchangedCount: number;
  readonly rolledOffIgnoredCount: number;
  readonly retrievedAt: string | null;
  readonly channelPublishedAt: string | null;
  readonly bodyHash: string | null;
  readonly errorCode: string | null;
}

export interface DeltaOfficialSnapshot {
  readonly version: typeof DELTA_OFFICIAL_SNAPSHOT_VERSION;
  readonly product: 'dlkt-info';
  readonly productVersion: string;
  readonly pack: 'eu-official-change-radar';
  readonly packVersion: string;
  readonly mode: 'release-baseline-delta';
  readonly baselineVersion: typeof DELTA_OFFICIAL_BASELINE_VERSION;
  readonly baselineAt: string;
  readonly baselineHash: string;
  readonly generatedAt: string;
  readonly complete: boolean;
  readonly partial: boolean;
  readonly feeds: readonly DeltaOfficialFeedProjection[];
  readonly baselineEntryCount: number;
  readonly currentEntryCount: number;
  readonly newCount: number;
  readonly changedCount: number;
  readonly unchangedCount: number;
  readonly rolledOffIgnoredCount: number;
  readonly availableCardCount: number;
  readonly returnedCardCount: number;
  readonly truncatedByPayloadBudget: boolean;
  readonly cards: readonly DeltaOfficialCard[];
  readonly deltaAvailable: true;
  readonly baselinePersistence: 'immutable-release-artifact';
  readonly databaseUsed: false;
  readonly persistenceUsed: true;
  readonly databaseChanged: false;
  readonly automaticPublication: false;
  readonly publicCardsCreated: false;
  readonly aiInterpretation: false;
  readonly rolloffResolutionDisabled: true;
  readonly legalBoundary: string;
}

export interface DeltaOfficialSnapshotDependencies {
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => number;
  readonly baseline?: EuReleaseBaseline;
}

export const deltaOfficialContract = Object.freeze({
  version: DELTA_OFFICIAL_SNAPSHOT_VERSION,
  baselineVersion: DELTA_OFFICIAL_BASELINE_VERSION,
  route: DELTA_OFFICIAL_ROUTE,
  apiRoute: DELTA_OFFICIAL_API_ROUTE,
  mode: 'release-baseline-delta' as const,
  sourceAuthority: 'official' as const,
  baselinePersistence: 'immutable-release-artifact' as const,
  userDefinedCardBudget: true,
  deltaAvailable: true,
  databaseUsed: false,
  databaseChanged: false,
  automaticPublication: false,
  publicCardsCreated: false,
  aiInterpretation: false,
  rolloffResolutionDisabled: true,
  responseCache: 'private-no-store' as const,
  serverMemoryCacheSeconds: 900,
});
