import type { ExplainableMemorySignal, MemoryCandidate, MemoryImpact } from './contracts.js';

const ID = /^[a-z0-9][a-z0-9:._-]{1,127}$/u;

function applies(signal: ExplainableMemorySignal, candidate: MemoryCandidate): boolean {
  if (signal.targetType === 'topic') return signal.targetId === candidate.topicId;
  if (signal.targetType === 'entity') return signal.targetId === candidate.entityId;
  return signal.targetId === candidate.kind;
}

function assertSignal(signal: ExplainableMemorySignal): void {
  if (!ID.test(signal.id) || !ID.test(signal.targetId) || !Number.isFinite(signal.weight)
    || signal.weight < -50 || signal.weight > 50 || signal.reason.length < 3 || signal.reason.length > 240) {
    throw new Error('EXPLAINABLE_MEMORY_SIGNAL_INVALID');
  }
}

export function explainMemoryImpact(candidate: MemoryCandidate, signals: readonly ExplainableMemorySignal[]): MemoryImpact {
  if (!ID.test(candidate.topicId) || !ID.test(candidate.entityId) || !ID.test(candidate.kind) || signals.length > 100) {
    throw new Error('EXPLAINABLE_MEMORY_INPUT_INVALID');
  }
  const applied = signals.filter((signal) => {
    assertSignal(signal);
    return applies(signal, candidate);
  }).sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight) || left.id.localeCompare(right.id));
  const total = applied.reduce((sum, signal) => sum + signal.weight, 0);
  return Object.freeze({ total: Number(total.toFixed(3)), applied: Object.freeze(applied) });
}
