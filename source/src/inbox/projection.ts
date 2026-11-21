import type { ActionCandidate, ActionType, UserAction } from '../actions/contracts.js';
import { projectActionControl } from '../actions/control.js';
import {
  ACTION_INBOX_ROUTE,
  ACTION_INBOX_VERSION,
  type ActionInboxItem,
  type ActionInboxProjection,
  type ActionInboxState,
  type ActionObservation,
} from './contracts.js';

const ID = /^[a-z0-9][a-z0-9:._-]{1,127}$/u;
const HASH = /^[a-f0-9]{16,128}$/u;
const stateRank: Readonly<Record<ActionInboxState, number>> = Object.freeze({
  'due-now': 0,
  scheduled: 1,
  'waiting-for-delta': 2,
  'attention-resolved': 3,
  muted: 4,
});
const actionRank: Readonly<Record<ActionType, number>> = Object.freeze({
  'watch-change': 0,
  'remind-next-briefing': 1,
  'compare-next': 2,
  'mark-resolved': 3,
  'ignore-pattern': 4,
});

function validDate(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function assertObservation(value: ActionObservation): void {
  if (!value || typeof value !== 'object' || !ID.test(value.candidateId)
    || !HASH.test(value.currentClaimStateHash) || !validDate(value.observedAt)
    || typeof value.materialDelta !== 'boolean' || typeof value.conflictActive !== 'boolean') {
    throw new Error('ACTION_OBSERVATION_INVALID');
  }
}

function classify(
  action: UserAction,
  candidate: ActionCandidate,
  observation: ActionObservation,
  nowMs: number,
): ActionInboxItem {
  const claimStateChanged = observation.currentClaimStateHash !== candidate.claimStateHash;
  let state: ActionInboxState;
  let dueAt: string | null = null;
  let reason: string;

  switch (action.type) {
    case 'watch-change':
      if (claimStateChanged && observation.materialDelta) {
        state = 'due-now';
        dueAt = observation.observedAt;
        reason = 'A new material verified delta triggered this watch.';
      } else {
        state = 'waiting-for-delta';
        reason = observation.conflictActive
          ? 'The watch remains active while the unresolved contradiction is preserved.'
          : 'No new material verified delta has appeared since the action was created.';
      }
      break;
    case 'compare-next':
      if (claimStateChanged && observation.materialDelta) {
        state = 'due-now';
        dueAt = observation.observedAt;
        reason = 'A new verified state is available for comparison.';
      } else {
        state = 'waiting-for-delta';
        reason = 'The next materially different verified state has not appeared yet.';
      }
      break;
    case 'remind-next-briefing': {
      if (action.scheduledFor === null || !validDate(action.scheduledFor)) throw new Error('ACTION_REMINDER_SCHEDULE_INVALID');
      dueAt = action.scheduledFor;
      if (Date.parse(action.scheduledFor) <= nowMs) {
        state = 'due-now';
        reason = 'The explicit one-time reminder is due now.';
      } else {
        state = 'scheduled';
        reason = 'The card will return once at the selected briefing time.';
      }
      break;
    }
    case 'mark-resolved':
      if (claimStateChanged && observation.materialDelta) {
        state = 'due-now';
        dueAt = observation.observedAt;
        reason = 'A new material delta reopened attention after the previous resolution.';
      } else {
        state = 'attention-resolved';
        reason = 'Attention remains resolved; the factual claim itself was not changed.';
      }
      break;
    case 'ignore-pattern':
      state = 'muted';
      reason = observation.materialDelta
        ? 'A material delta is currently held back by this explicit user rule.'
        : 'Future matching changes remain muted until the user reverses the rule.';
      break;
  }

  return Object.freeze({
    actionId: action.id,
    candidateId: candidate.id,
    actionType: action.type,
    state,
    dueAt,
    reason,
    claimStateChanged,
    materialDelta: observation.materialDelta,
    conflictActive: observation.conflictActive,
    automaticExecution: false,
    factualStateChanged: false,
  });
}

export function projectActionInbox(
  candidates: readonly ActionCandidate[],
  actions: readonly UserAction[],
  observations: readonly ActionObservation[],
  generatedAt: string,
): ActionInboxProjection {
  projectActionControl(candidates, actions);
  if (!validDate(generatedAt) || observations.length !== candidates.length || observations.length > 12) {
    throw new Error('ACTION_INBOX_INPUT_INVALID');
  }

  const observationMap = new Map<string, ActionObservation>();
  for (const observation of observations) {
    assertObservation(observation);
    if (observationMap.has(observation.candidateId)) throw new Error('ACTION_OBSERVATION_DUPLICATE');
    observationMap.set(observation.candidateId, observation);
  }
  if (candidates.some((candidate) => !observationMap.has(candidate.id))) throw new Error('ACTION_OBSERVATION_MISSING');

  const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate] as const));
  const nowMs = Date.parse(generatedAt);
  const items = actions.map((action) => {
    const candidate = candidateMap.get(action.candidateId);
    const observation = observationMap.get(action.candidateId);
    if (!candidate || !observation) throw new Error('ACTION_INBOX_REFERENCE_INVALID');
    return classify(action, candidate, observation, nowMs);
  }).sort((left, right) => stateRank[left.state] - stateRank[right.state]
    || actionRank[left.actionType] - actionRank[right.actionType]
    || left.candidateId.localeCompare(right.candidateId)
    || left.actionId.localeCompare(right.actionId));

  const scheduledTimes = items
    .filter((item) => item.state === 'scheduled' && item.dueAt !== null)
    .map((item) => item.dueAt as string)
    .sort((left, right) => Date.parse(left) - Date.parse(right));

  return Object.freeze({
    version: ACTION_INBOX_VERSION,
    route: ACTION_INBOX_ROUTE,
    generatedAt,
    items: Object.freeze(items),
    totalCount: items.length,
    dueNowCount: items.filter((item) => item.state === 'due-now').length,
    scheduledCount: items.filter((item) => item.state === 'scheduled').length,
    waitingCount: items.filter((item) => item.state === 'waiting-for-delta').length,
    resolvedCount: items.filter((item) => item.state === 'attention-resolved').length,
    mutedCount: items.filter((item) => item.state === 'muted').length,
    suppressedMaterialDeltaCount: items.filter((item) => item.state === 'muted' && item.materialDelta).length,
    nextScheduledAt: scheduledTimes[0] ?? null,
    automaticExecution: false,
    factualStateChanged: false,
  });
}
