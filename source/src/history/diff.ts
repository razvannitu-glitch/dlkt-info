import type {
  BriefingHistoryCard,
  BriefingHistoryDiff,
  BriefingHistoryRun,
  BriefingRankMove,
} from './contracts.js';

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const ID = /^[a-z0-9][a-z0-9:._-]{1,127}$/u;
const HASH = /^[a-f0-9]{64}$/u;

function assertCard(card: BriefingHistoryCard): void {
  if (!ID.test(card.id) || !ID.test(card.entityId) || !ID.test(card.topicId) || !HASH.test(card.stateHash)
    || !Number.isInteger(card.rank) || card.rank < 1 || card.rank > 12
    || !Number.isFinite(card.score) || card.score < 0 || card.score > 1000) {
    throw new Error('BRIEFING_HISTORY_CARD_INVALID');
  }
}

function indexRun(run: BriefingHistoryRun): ReadonlyMap<string, BriefingHistoryCard> {
  if (!ID.test(run.id) || !ISO_INSTANT.test(run.generatedAt) || !Number.isFinite(Date.parse(run.generatedAt))
    || run.cards.length > 12) throw new Error('BRIEFING_HISTORY_RUN_INVALID');
  const index = new Map<string, BriefingHistoryCard>();
  const ranks = new Set<number>();
  for (const card of run.cards) {
    assertCard(card);
    if (index.has(card.id) || ranks.has(card.rank)) throw new Error('BRIEFING_HISTORY_RUN_DUPLICATE');
    index.set(card.id, card);
    ranks.add(card.rank);
  }
  return index;
}

export function compareBriefingRuns(previous: BriefingHistoryRun, current: BriefingHistoryRun): BriefingHistoryDiff {
  if (Date.parse(previous.generatedAt) >= Date.parse(current.generatedAt)) throw new Error('BRIEFING_HISTORY_ORDER_INVALID');
  const before = indexRun(previous);
  const after = indexRun(current);
  const newCardIds: string[] = [];
  const updatedCardIds: string[] = [];
  const retainedCardIds: string[] = [];
  const resolvedCardIds: string[] = [];
  const rankMoves: BriefingRankMove[] = [];

  for (const card of current.cards) {
    const prior = before.get(card.id);
    if (!prior) newCardIds.push(card.id);
    else if (prior.stateHash !== card.stateHash) updatedCardIds.push(card.id);
    else retainedCardIds.push(card.id);
    if (prior && prior.rank !== card.rank) {
      rankMoves.push(Object.freeze({
        cardId: card.id,
        previousRank: prior.rank,
        currentRank: card.rank,
        delta: prior.rank - card.rank,
      }));
    }
  }
  for (const card of previous.cards) if (!after.has(card.id)) resolvedCardIds.push(card.id);

  const sorted = (values: string[]): readonly string[] => Object.freeze(values.sort());
  return Object.freeze({
    previousRunId: previous.id,
    currentRunId: current.id,
    newCardIds: sorted(newCardIds),
    updatedCardIds: sorted(updatedCardIds),
    retainedCardIds: sorted(retainedCardIds),
    resolvedCardIds: sorted(resolvedCardIds),
    rankMoves: Object.freeze(rankMoves.sort((left, right) => left.currentRank - right.currentRank || left.cardId.localeCompare(right.cardId))),
  });
}
