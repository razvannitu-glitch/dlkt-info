import type { AtomicClaim, SourceRecord } from '../../core/contracts.js';

export const EU_OFFICIAL_PACK_ID = 'eu-official-change-radar' as const;
export const EU_OFFICIAL_PACK_VERSION = '0.1.1' as const;
export const EU_OFFICIAL_CHECKPOINT_VERSION = 'dlkt-info-eu-official-checkpoint-1' as const;

export type EuOfficialFeedKind = 'commission-proposals' | 'parliament-council-legislation';

export interface EuOfficialFeedDefinition {
  readonly id: string;
  readonly kind: EuOfficialFeedKind;
  readonly sourceId: string;
  readonly label: string;
  readonly url: string;
  readonly expectedChannelTitle: string;
}

export interface EuOfficialEntry {
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

export interface EuOfficialParsedFeed {
  readonly feedId: string;
  readonly channelTitle: string;
  readonly channelPublishedAt: string;
  readonly retrievedAt: string;
  readonly entries: readonly EuOfficialEntry[];
}

export interface EuOfficialCheckpoint {
  readonly version: typeof EU_OFFICIAL_CHECKPOINT_VERSION;
  readonly feedId: string;
  readonly checkedAt: string;
  readonly bodyHash: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly channelPublishedAt: string;
  readonly entries: readonly EuOfficialEntry[];
}

export interface EuOfficialModifiedFetch {
  readonly status: 'modified';
  readonly definition: EuOfficialFeedDefinition;
  readonly retrievedAt: string;
  readonly body: string;
  readonly bodyHash: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export interface EuOfficialNotModifiedFetch {
  readonly status: 'not-modified';
  readonly definition: EuOfficialFeedDefinition;
  readonly retrievedAt: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export type EuOfficialFetchResult = EuOfficialModifiedFetch | EuOfficialNotModifiedFetch;


export interface EuOfficialClaimIngestion {
  readonly externalKey: string;
  readonly supersedesExternalKey: string | null;
  readonly changeKind: 'baseline' | 'new' | 'changed';
  readonly claim: AtomicClaim;
}

export interface EuOfficialPreparedFeed {
  readonly checkpoint: EuOfficialCheckpoint;
  readonly previousClaims: readonly AtomicClaim[];
  readonly currentClaims: readonly AtomicClaim[];
  readonly ingestClaims: readonly EuOfficialClaimIngestion[];
  readonly baselineEstablished: boolean;
  readonly notModified: boolean;
  readonly stableEntryCount: number;
  readonly newEntryCount: number;
  readonly changedEntryCount: number;
  readonly rolledOffEntryCount: number;
}

export interface EuOfficialAcquisitionInput {
  readonly definition: EuOfficialFeedDefinition;
  readonly result: EuOfficialFetchResult;
  readonly previousCheckpoint: EuOfficialCheckpoint | null;
}

export interface EuOfficialPackInput {
  readonly definition: import('../../core/contracts.js').BriefingDefinition;
  readonly acquisitions: readonly EuOfficialAcquisitionInput[];
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly now: number;
}

export interface EuOfficialPackDiagnostics {
  readonly feeds: readonly Readonly<{
    feedId: string;
    baselineEstablished: boolean;
    notModified: boolean;
    stableEntryCount: number;
    newEntryCount: number;
    changedEntryCount: number;
    rolledOffEntryCount: number;
  }>[];
  readonly sources: readonly SourceRecord[];
}
