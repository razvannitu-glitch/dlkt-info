import type { DeltaOfficialChangedField, DeltaOfficialPreviousState, DeltaOfficialSourceProjection } from '../delta-official/contracts.js';
import type { EuOfficialCheckpoint, EuOfficialFeedKind } from '../packs/eu-official/contracts.js';

export const OPERATIONAL_LEDGER_VERSION = 'dlkt-info-operational-delta-ledger-1' as const;
export const OPERATIONAL_LEDGER_IDENTITY_VERSION = 'dlkt-info-operational-ledger-identity-1' as const;
export const OPERATIONAL_CHECKPOINT_VERSION = 'dlkt-info-operational-checkpoint-1' as const;
export const OPERATIONAL_POINTER_VERSION = 'dlkt-info-operational-pointer-1' as const;
export const OPERATIONAL_DELTA_VERSION = 'dlkt-info-operational-delta-1' as const;
export const OPERATIONAL_LEDGER_REQUEST_MARKER = 'operational-delta-v1' as const;
export const OPERATIONAL_LEDGER_ROOT = 'dlkt-info/operational-ledger/v1' as const;
export const OPERATIONAL_LEDGER_INTERVAL_MINUTES = 60 as const;
export const OPERATIONAL_LEDGER_COLLECT_ROUTE = '/api/operational-delta-collect' as const;
export const OPERATIONAL_LEDGER_READ_ROUTE = '/api/operational-delta' as const;
export const OPERATIONAL_LEDGER_HEALTH_ROUTE = '/api/operational-delta-health' as const;

export interface OperationalLedgerIdentity {
  readonly version: typeof OPERATIONAL_LEDGER_IDENTITY_VERSION;
  readonly product: 'dlkt-info';
  readonly purpose: 'operational-delta-ledger';
  readonly instanceId: string;
  readonly region: 'fra1';
  readonly createdAt: string;
}

export interface OperationalFeedCheckpoint {
  readonly id: string;
  readonly kind: EuOfficialFeedKind;
  readonly sourceId: string;
  readonly label: string;
  readonly checkpoint: EuOfficialCheckpoint;
}

export interface OperationalCheckpointUnsigned {
  readonly version: typeof OPERATIONAL_CHECKPOINT_VERSION;
  readonly product: 'dlkt-info';
  readonly pack: 'eu-official-change-radar';
  readonly packVersion: string;
  readonly ledgerInstanceId: string;
  readonly sequence: number;
  readonly slotAt: string;
  readonly previousCheckpointHash: string | null;
  readonly feeds: readonly OperationalFeedCheckpoint[];
  readonly entryCount: number;
  readonly sourceState: 'complete';
}

export interface OperationalCheckpoint extends OperationalCheckpointUnsigned {
  readonly checkpointHash: string;
}

export interface OperationalPointer {
  readonly version: typeof OPERATIONAL_POINTER_VERSION;
  readonly product: 'dlkt-info';
  readonly ledgerInstanceId: string;
  readonly sequence: number;
  readonly slotAt: string;
  readonly checkpointHash: string;
  readonly previousCheckpointHash: string | null;
  readonly updatedAt: string;
}

export interface OperationalDeltaFeedProjection {
  readonly id: string;
  readonly label: string;
  readonly kind: EuOfficialFeedKind;
  readonly status: 'available';
  readonly previousEntryCount: number;
  readonly currentEntryCount: number;
  readonly newCount: number;
  readonly changedCount: number;
  readonly unchangedCount: number;
  readonly rolledOffIgnoredCount: number;
  readonly checkedAt: string;
  readonly bodyHash: string;
}

export interface OperationalDeltaCard {
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
  readonly deltaStatus: 'verified-between-operational-checkpoints';
  readonly aiInterpretation: false;
}

export interface OperationalDeltaSnapshot {
  readonly version: typeof OPERATIONAL_DELTA_VERSION;
  readonly product: 'dlkt-info';
  readonly productVersion: string;
  readonly pack: 'eu-official-change-radar';
  readonly packVersion: string;
  readonly mode: 'operational-consecutive-delta';
  readonly ledgerVersion: typeof OPERATIONAL_LEDGER_VERSION;
  readonly ledgerInstanceId: string;
  readonly sequence: number;
  readonly baselineAt: string;
  readonly baselineHash: string;
  readonly generatedAt: string;
  readonly checkpointHash: string;
  readonly previousCheckpointHash: string | null;
  readonly baselineEstablished: boolean;
  readonly complete: true;
  readonly partial: false;
  readonly feeds: readonly OperationalDeltaFeedProjection[];
  readonly baselineEntryCount: number;
  readonly currentEntryCount: number;
  readonly newCount: number;
  readonly changedCount: number;
  readonly unchangedCount: number;
  readonly rolledOffIgnoredCount: number;
  readonly availableCardCount: number;
  readonly returnedCardCount: number;
  readonly truncatedByPayloadBudget: boolean;
  readonly cards: readonly OperationalDeltaCard[];
  readonly deltaAvailable: boolean;
  readonly baselinePersistence: 'private-content-addressed-ledger';
  readonly databaseUsed: false;
  readonly blobUsed: true;
  readonly persistenceUsed: true;
  readonly databaseChanged: false;
  readonly automaticPublication: false;
  readonly publicCardsCreated: false;
  readonly automaticExecution: false;
  readonly aiInterpretation: false;
  readonly rolloffResolutionDisabled: true;
  readonly legalBoundary: string;
}

export type OperationalCollectionStatus =
  | 'initialized'
  | 'committed'
  | 'already-committed'
  | 'superseded'
  | 'slot-conflict'
  | 'source-unavailable';

export interface OperationalCollectionResult {
  readonly version: typeof OPERATIONAL_LEDGER_VERSION;
  readonly status: OperationalCollectionStatus;
  readonly slotAt: string;
  readonly sequence: number | null;
  readonly checkpointHash: string | null;
  readonly previousCheckpointHash: string | null;
  readonly newCount: number;
  readonly changedCount: number;
  readonly unchangedCount: number;
  readonly rolledOffIgnoredCount: number;
  readonly errorCode: string | null;
  readonly databaseChanged: false;
  readonly publicCardsCreated: false;
  readonly automaticPublication: false;
}

export interface OperationalLedgerRecord {
  readonly pathname: string;
  readonly body: string;
  readonly etag: string;
}

export interface OperationalLedgerStorage {
  read(pathname: string): Promise<OperationalLedgerRecord | null>;
  create(pathname: string, body: string): Promise<OperationalLedgerRecord>;
  compareAndSwap(pathname: string, body: string, expectedEtag: string): Promise<OperationalLedgerRecord>;
}

export interface OperationalLedgerSourceDependencies {
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => number;
}

export interface OperationalLedgerContract {
  readonly version: typeof OPERATIONAL_LEDGER_VERSION;
  readonly checkpointStorage: 'private-content-addressed-blob';
  readonly pointerUpdate: 'etag-compare-and-swap';
  readonly immutableCheckpoints: true;
  readonly deterministicHourlySlots: true;
  readonly concurrentWriterSafety: true;
  readonly sourceFailureAdvancesPointer: false;
  readonly rolloffResolutionDisabled: true;
  readonly browserStorage: false;
  readonly databaseUsed: false;
  readonly automaticPublication: false;
  readonly publicCardsCreated: false;
}

export const operationalLedgerContract: OperationalLedgerContract = Object.freeze({
  version: OPERATIONAL_LEDGER_VERSION,
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
});
