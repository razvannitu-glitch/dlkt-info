import { explainMemoryImpact } from '../history/memory.js';
import type { ExplainableMemorySignal } from '../history/contracts.js';
import type { MemoryControlCandidate, MemoryControlProjection } from './contracts.js';

const ID = /^[a-z0-9][a-z0-9:._-]{1,127}$/u;

function assertCandidate(candidate: MemoryControlCandidate): void {
  if (!ID.test(candidate.id) || !ID.test(candidate.topicId) || !ID.test(candidate.entityId)
    || !ID.test(candidate.kind) || candidate.label.length < 2 || candidate.label.length > 120
    || !Number.isFinite(candidate.baseScore) || candidate.baseScore < 0 || candidate.baseScore > 1_000
    || !Number.isInteger(candidate.baselineRank) || candidate.baselineRank < 1 || candidate.baselineRank > 12) {
    throw new Error('MEMORY_CONTROL_CANDIDATE_INVALID');
  }
}

export function projectMemoryControl(
  candidates: readonly MemoryControlCandidate[],
  signals: readonly ExplainableMemorySignal[],
): readonly MemoryControlProjection[] {
  if (candidates.length < 1 || candidates.length > 12 || signals.length > 24) {
    throw new Error('MEMORY_CONTROL_INPUT_INVALID');
  }
  const ids = new Set<string>();
  const ranks = new Set<number>();
  const calculated = candidates.map((candidate) => {
    assertCandidate(candidate);
    if (ids.has(candidate.id) || ranks.has(candidate.baselineRank)) throw new Error('MEMORY_CONTROL_DUPLICATE');
    ids.add(candidate.id);
    ranks.add(candidate.baselineRank);
    const impact = explainMemoryImpact({
      topicId: candidate.topicId,
      entityId: candidate.entityId,
      kind: candidate.kind,
    }, signals);
    return {
      candidate,
      memoryScore: impact.total,
      totalScore: Number((candidate.baseScore + impact.total).toFixed(3)),
      appliedSignals: impact.applied,
    };
  });

  calculated.sort((left, right) => right.totalScore - left.totalScore
    || right.candidate.baseScore - left.candidate.baseScore
    || left.candidate.id.localeCompare(right.candidate.id));

  return Object.freeze(calculated.map((item, index): MemoryControlProjection => Object.freeze({
    id: item.candidate.id,
    label: item.candidate.label,
    baseScore: item.candidate.baseScore,
    memoryScore: item.memoryScore,
    totalScore: item.totalScore,
    baselineRank: item.candidate.baselineRank,
    projectedRank: index + 1,
    rankDelta: item.candidate.baselineRank - (index + 1),
    appliedSignals: item.appliedSignals,
  })));
}
