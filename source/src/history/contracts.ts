export const BRIEFING_HISTORY_VERSION = 'dlkt-info-briefing-history-1' as const;
export const EXPLAINABLE_MEMORY_VERSION = 'dlkt-info-explainable-memory-1' as const;
export const BRIEFING_HISTORY_ROUTE = '/history' as const;

export type HistoryCardState = 'new' | 'updated' | 'retained' | 'resolved';
export type MemorySignalSource = 'explicit-rule' | 'relevant-feedback' | 'less-like-feedback' | 'followed-entity';

export interface BriefingHistoryCard {
  readonly id: string;
  readonly entityId: string;
  readonly topicId: string;
  readonly stateHash: string;
  readonly rank: number;
  readonly score: number;
}

export interface BriefingHistoryRun {
  readonly id: string;
  readonly generatedAt: string;
  readonly cards: readonly BriefingHistoryCard[];
}

export interface BriefingRankMove {
  readonly cardId: string;
  readonly previousRank: number;
  readonly currentRank: number;
  readonly delta: number;
}

export interface BriefingHistoryDiff {
  readonly previousRunId: string;
  readonly currentRunId: string;
  readonly newCardIds: readonly string[];
  readonly updatedCardIds: readonly string[];
  readonly retainedCardIds: readonly string[];
  readonly resolvedCardIds: readonly string[];
  readonly rankMoves: readonly BriefingRankMove[];
}

export interface ExplainableMemorySignal {
  readonly id: string;
  readonly source: MemorySignalSource;
  readonly targetType: 'topic' | 'entity' | 'kind';
  readonly targetId: string;
  readonly weight: number;
  readonly reason: string;
}

export interface MemoryCandidate {
  readonly topicId: string;
  readonly entityId: string;
  readonly kind: string;
}

export interface MemoryImpact {
  readonly total: number;
  readonly applied: readonly ExplainableMemorySignal[];
}

export const briefingHistoryContract = Object.freeze({
  version: BRIEFING_HISTORY_VERSION,
  memoryVersion: EXPLAINABLE_MEMORY_VERSION,
  route: BRIEFING_HISTORY_ROUTE,
  mode: 'synthetic-finite-preview',
  maximumRuns: 7,
  browserStorage: false,
  realDataEnabled: false,
  rankExplanation: true,
  memoryExplanation: true,
  stableSignalsRepeated: false,
} as const);
