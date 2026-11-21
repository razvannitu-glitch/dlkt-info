import type { Materiality } from '../core/contracts.js';
import type { CompanionPreferences } from '../companion/contracts.js';
import type { DeltaOfficialCard, DeltaOfficialChangedField, DeltaOfficialPreviousState, DeltaOfficialSnapshot } from '../delta-official/contracts.js';
import type { LiveOfficialSnapshot } from '../live-official/contracts.js';
import type { OperationalDeltaCard, OperationalDeltaSnapshot, OperationalLedgerStorage } from '../operational-ledger/index.js';
import type { TrustPolicy } from '../trust/contracts.js';

export const REAL_COMPANION_VERSION = 'dlkt-info-real-companion-1' as const;
export const REAL_COMPANION_MODE = 'real-delta-first' as const;
export const REAL_COMPANION_ROUTE = '/companion' as const;
export const REAL_COMPANION_API_ROUTE = '/api/companion' as const;
export const REAL_COMPANION_REQUEST_MARKER = 'companion-v1' as const;
export const REAL_COMPANION_SOURCE_CACHE_SECONDS = 900 as const;

export type RealCompanionResultState = 'ready' | 'caught-up' | 'no-match' | 'unavailable';
export type RealCompanionSourceState = 'complete' | 'partial' | 'unavailable';

export interface RealCompanionDefinition {
  readonly preferences: CompanionPreferences;
  readonly trustPolicy: TrustPolicy;
}

export interface RealCompanionSourceBundle {
  readonly checkedAt: string;
  readonly baselineAt: string;
  readonly baselineHash: string;
  readonly delta: DeltaOfficialSnapshot | OperationalDeltaSnapshot | null;
  readonly deltaMode: 'operational-ledger' | 'release-baseline' | 'none';
  readonly live: LiveOfficialSnapshot | null;
  readonly deltaError: string | null;
  readonly liveError: string | null;
}

export interface RealCompanionTrustDecision {
  readonly included: boolean;
  readonly trust: 'confirmed';
  readonly authority: 'official';
  readonly evidenceAgeHours: number;
  readonly authoritativeSourceSufficient: true;
  readonly blockingReasons: readonly string[];
  readonly warnings: readonly string[];
}

export interface RealCompanionCard {
  readonly id: string;
  readonly kind: DeltaOfficialCard['kind'] | OperationalDeltaCard['kind'];
  readonly topic: 'regulation';
  readonly feedId: string;
  readonly feedLabel: string;
  readonly celexId: string;
  readonly title: string;
  readonly creator: string;
  readonly sourceUrl: string;
  readonly sourceName: string;
  readonly publishedAt: string;
  readonly observedAt: string;
  readonly baselineAt: string;
  readonly previous: DeltaOfficialPreviousState | null;
  readonly changedFields: readonly DeltaOfficialChangedField[];
  readonly stateLabel: DeltaOfficialCard['stateLabel'] | OperationalDeltaCard['stateLabel'];
  readonly matchReasons: readonly string[];
  readonly matchedEntities: readonly string[];
  readonly actionable: true;
  readonly actionLabel: 'Open official source';
  readonly trustDecision: RealCompanionTrustDecision;
  readonly requestedMinimumMateriality: Materiality;
  readonly materialityAssessment: 'unassessed';
  readonly materialityFilterApplied: false;
  readonly legalCaveat: string;
  readonly aiInterpretation: false;
}

export interface RealCompanionCurrentOfficial {
  readonly available: boolean;
  readonly route: '/live';
  readonly generatedAt: string | null;
  readonly complete: boolean;
  readonly partial: boolean;
  readonly availableCardCount: number;
  readonly returnedCardCount: number;
  readonly availableFeedCount: number;
  readonly unavailableFeedCount: number;
}

export interface RealCompanionFilterCounts {
  readonly verifiedDeltaCount: number;
  readonly topicExcludedCount: number;
  readonly entityExcludedCount: number;
  readonly trustExcludedCount: number;
  readonly actionableExcludedCount: number;
  readonly eligibleBeforeBudgetCount: number;
  readonly returnedCardCount: number;
  readonly truncatedByCardBudget: boolean;
}

export interface RealCompanionSnapshot {
  readonly version: typeof REAL_COMPANION_VERSION;
  readonly product: 'dlkt-info';
  readonly productVersion: string;
  readonly mode: typeof REAL_COMPANION_MODE;
  readonly generatedAt: string;
  readonly resultState: RealCompanionResultState;
  readonly sourceState: RealCompanionSourceState;
  readonly deltaMode: 'operational-ledger' | 'release-baseline' | 'none';
  readonly preferences: CompanionPreferences;
  readonly trustPolicy: TrustPolicy;
  readonly baselineAt: string | null;
  readonly baselineHash: string | null;
  readonly cards: readonly RealCompanionCard[];
  readonly counts: RealCompanionFilterCounts;
  readonly currentOfficial: RealCompanionCurrentOfficial;
  readonly sourceErrors: Readonly<{ delta: string | null; live: string | null }>;
  readonly caughtUpMessage: string | null;
  readonly materialityPolicy: 'not-applied-without-impact-evidence';
  readonly browserStorage: false;
  readonly databaseUsed: false;
  readonly databaseChanged: false;
  readonly automaticPublication: false;
  readonly automaticExecution: false;
  readonly publicCardsCreated: false;
  readonly aiInterpretation: false;
  readonly boundaries: readonly string[];
}

export interface RealCompanionSourceDependencies {
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => number;
  readonly buildDelta?: (dependencies?: Readonly<{ fetchImplementation?: typeof fetch; now?: () => number }>) => Promise<DeltaOfficialSnapshot>;
  readonly buildLive?: (dependencies?: Readonly<{ fetchImplementation?: typeof fetch; now?: () => number }>) => Promise<LiveOfficialSnapshot>;
  readonly readOperational?: () => Promise<OperationalDeltaSnapshot | null>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly operationalStorage?: OperationalLedgerStorage;
}

export const realCompanionContract = Object.freeze({
  version: REAL_COMPANION_VERSION,
  route: REAL_COMPANION_ROUTE,
  apiRoute: REAL_COMPANION_API_ROUTE,
  mode: REAL_COMPANION_MODE,
  sourceMode: 'operational-ledger-first-with-release-fallback' as const,
  cardBudget: 'user-defined-positive-integer' as const,
  entityCapacity: 'payload-bounded' as const,
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
  responseCache: 'private-no-store' as const,
  sourceCacheSeconds: REAL_COMPANION_SOURCE_CACHE_SECONDS,
});
