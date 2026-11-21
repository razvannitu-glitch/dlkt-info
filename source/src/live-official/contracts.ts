import type { EuOfficialFeedKind } from '../packs/eu-official/contracts.js';

export const LIVE_OFFICIAL_SNAPSHOT_VERSION = 'dlkt-info-live-official-snapshot-1' as const;
export const LIVE_OFFICIAL_REQUEST_MARKER = 'eu-live-v1' as const;
export const LIVE_OFFICIAL_ROUTE = '/live' as const;
export const LIVE_OFFICIAL_API_ROUTE = '/api/eu-official-live' as const;

export interface LiveOfficialSourceProjection {
  readonly id: string;
  readonly name: string;
  readonly authority: 'official';
  readonly attributionRequired: true;
  readonly termsUrl: string;
  readonly rightsReviewExpiresAt: string;
}

export interface LiveOfficialFeedProjection {
  readonly id: string;
  readonly label: string;
  readonly kind: EuOfficialFeedKind;
  readonly status: 'available' | 'unavailable';
  readonly retrievedAt: string | null;
  readonly channelPublishedAt: string | null;
  readonly bodyHash: string | null;
  readonly entryCount: number;
  readonly authorizedClaimCount: number;
  readonly errorCode: string | null;
}

export interface LiveOfficialCard {
  readonly id: string;
  readonly feedId: string;
  readonly feedKind: EuOfficialFeedKind;
  readonly feedLabel: string;
  readonly celexId: string;
  readonly title: string;
  readonly creator: string;
  readonly sourceUrl: string;
  readonly source: LiveOfficialSourceProjection;
  readonly publishedAt: string;
  readonly observedAt: string;
  readonly stateLabel: 'Official proposal listing' | 'Official legislation listing';
  readonly legalCaveat: string;
  readonly trust: 'official-source';
  readonly deltaStatus: 'not-available-without-baseline';
  readonly aiInterpretation: false;
}

export interface LiveOfficialSnapshot {
  readonly version: typeof LIVE_OFFICIAL_SNAPSHOT_VERSION;
  readonly product: 'dlkt-info';
  readonly productVersion: string;
  readonly pack: 'eu-official-change-radar';
  readonly packVersion: string;
  readonly mode: 'live-read-only';
  readonly generatedAt: string;
  readonly complete: boolean;
  readonly partial: boolean;
  readonly deltaAvailable: false;
  readonly databaseUsed: false;
  readonly persistenceUsed: false;
  readonly databaseChanged: false;
  readonly automaticPublication: false;
  readonly publicCardsCreated: false;
  readonly aiInterpretation: false;
  readonly availableCardCount: number;
  readonly returnedCardCount: number;
  readonly truncatedByPayloadBudget: boolean;
  readonly feeds: readonly LiveOfficialFeedProjection[];
  readonly cards: readonly LiveOfficialCard[];
  readonly boundaries: readonly string[];
}

export interface LiveOfficialSnapshotDependencies {
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => number;
}

export const liveOfficialSnapshotContract = Object.freeze({
  version: LIVE_OFFICIAL_SNAPSHOT_VERSION,
  route: LIVE_OFFICIAL_ROUTE,
  apiRoute: LIVE_OFFICIAL_API_ROUTE,
  mode: 'live-read-only' as const,
  sourceAuthority: 'official' as const,
  userDefinedCardBudget: true,
  deltaAvailable: false,
  databaseUsed: false,
  persistenceUsed: false,
  automaticPublication: false,
  publicCardsCreated: false,
  aiInterpretation: false,
  responseCache: 'private-no-store' as const,
  serverMemoryCacheSeconds: 900,
});
