import {
  UNIFIED_SHELL_ROUTE,
  UNIFIED_SHELL_VERSION,
  type UnifiedShellInput,
  type UnifiedShellProjection,
  type UnifiedShellStage,
  type UnifiedShellStep,
} from './contracts.js';

const ID = /^[a-z0-9][a-z0-9:._-]{1,127}$/u;
const STAGES: readonly UnifiedShellStage[] = Object.freeze(['briefing', 'trust', 'memory', 'actions', 'inbox', 'delivery']);
const LABELS: Readonly<Record<UnifiedShellStage, string>> = Object.freeze({
  briefing: 'Briefing', trust: 'Trust', memory: 'Memory', actions: 'Actions', inbox: 'Inbox', delivery: 'Delivery',
});

function bounded(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw new Error(`UNIFIED_SHELL_${name}_INVALID`);
  return value;
}

function step(id: UnifiedShellStage, count: number, state: UnifiedShellStep['state'], explanation: string): UnifiedShellStep {
  return Object.freeze({ id, label: LABELS[id], count, state, explanation });
}

export function projectUnifiedShell(input: UnifiedShellInput): UnifiedShellProjection {
  if (!STAGES.includes(input.selectedStage)) throw new Error('UNIFIED_SHELL_STAGE_INVALID');
  if (input.currentCardId !== null && !ID.test(input.currentCardId)) throw new Error('UNIFIED_SHELL_CARD_INVALID');

  const briefingCardCount = bounded(input.briefingCardCount, 'BRIEFING_COUNT');
  const trackedEntityCount = bounded(input.trackedEntityCount, 'TRACKED_ENTITY_COUNT');
  const trustIncludedCount = bounded(input.trustIncludedCount, 'TRUST_INCLUDED');
  const trustExcludedCount = bounded(input.trustExcludedCount, 'TRUST_EXCLUDED');
  const memorySignalCount = bounded(input.memorySignalCount, 'MEMORY_COUNT');
  const activeActionCount = bounded(input.activeActionCount, 'ACTION_COUNT');
  const dueNowCount = bounded(input.dueNowCount, 'DUE_COUNT');
  const waitingCount = bounded(input.waitingCount, 'WAITING_COUNT');
  const notifyNowCount = bounded(input.notifyNowCount, 'NOTIFY_COUNT');
  const deferredCount = bounded(input.deferredCount, 'DEFERRED_COUNT');
  const nextBriefingCount = bounded(input.nextBriefingCount, 'NEXT_BRIEFING_COUNT');

  if (input.currentCardId !== null && briefingCardCount === 0) throw new Error('UNIFIED_SHELL_ORPHAN_CARD');

  const steps = Object.freeze([
    step('briefing', briefingCardCount, briefingCardCount > 0 ? 'ready' : 'empty', briefingCardCount > 0
      ? `${briefingCardCount} finite card${briefingCardCount === 1 ? '' : 's'} passed the current filters.`
      : 'No card passes the current Companion and Trust rules.'),
    step('trust', trustIncludedCount, trustExcludedCount > 0 ? 'attention' : trustIncludedCount > 0 ? 'ready' : 'empty', trustExcludedCount > 0
      ? `${trustExcludedCount} candidate${trustExcludedCount === 1 ? '' : 's'} held back by the evidence policy.`
      : `${trustIncludedCount} candidate${trustIncludedCount === 1 ? '' : 's'} satisfy the evidence policy.`),
    step('memory', memorySignalCount, memorySignalCount > 0 ? 'ready' : 'empty', memorySignalCount > 0
      ? `${memorySignalCount} visible signal${memorySignalCount === 1 ? '' : 's'} explain prioritisation.`
      : 'No memory signal affects the current briefing.'),
    step('actions', activeActionCount, activeActionCount > 0 ? 'ready' : 'empty', activeActionCount > 0
      ? `${activeActionCount} explicit action${activeActionCount === 1 ? '' : 's'} remain reversible.`
      : 'No explicit action is active.'),
    step('inbox', dueNowCount, dueNowCount > 0 ? 'attention' : waitingCount > 0 ? 'waiting' : 'empty', dueNowCount > 0
      ? `${dueNowCount} item${dueNowCount === 1 ? '' : 's'} require attention now.`
      : waitingCount > 0 ? `${waitingCount} item${waitingCount === 1 ? '' : 's'} wait for a verified delta.` : 'No action requires follow-up.'),
    step('delivery', notifyNowCount + deferredCount, notifyNowCount > 0 ? 'attention' : deferredCount > 0 || nextBriefingCount > 0 ? 'waiting' : 'empty', notifyNowCount > 0
      ? `${notifyNowCount} interruption${notifyNowCount === 1 ? '' : 's'} pass the delivery policy.`
      : deferredCount > 0 ? `${deferredCount} interruption${deferredCount === 1 ? '' : 's'} deferred by quiet hours.`
        : `${nextBriefingCount} item${nextBriefingCount === 1 ? '' : 's'} stay inside the next briefing.`),
  ] satisfies readonly UnifiedShellStep[]);

  return Object.freeze({
    version: UNIFIED_SHELL_VERSION,
    route: UNIFIED_SHELL_ROUTE,
    selectedStage: input.selectedStage,
    currentCardId: input.currentCardId,
    steps,
    readyCount: steps.filter((entry) => entry.state === 'ready').length,
    attentionCount: steps.filter((entry) => entry.state === 'attention').length,
    finiteCardCount: briefingCardCount,
    trackedEntityCount,
    activeActionCount,
    immediateAttentionCount: dueNowCount + notifyNowCount,
    nextBriefingCount,
    browserStorage: false,
    persistenceEnabled: false,
    automaticExecution: false,
    factualStateMutation: false,
    finite: true,
  });
}
