import type { ActionCandidate, ActionCandidateProjection, ActionControlProjection, ActionType, UserAction } from './contracts.js';

const ID = /^[a-z0-9][a-z0-9:._-]{1,127}$/u;
const HASH = /^[a-f0-9]{16,128}$/u;
const ACTION_ORDER: readonly ActionType[] = Object.freeze([
  'watch-change', 'remind-next-briefing', 'compare-next', 'mark-resolved', 'ignore-pattern',
]);
const actionSet = new Set<ActionType>(ACTION_ORDER);

function assertCandidate(candidate: ActionCandidate): void {
  if (!ID.test(candidate.id) || !ID.test(candidate.entityId) || !ID.test(candidate.topicId)
    || candidate.label.length < 2 || candidate.label.length > 160 || !HASH.test(candidate.claimStateHash)) {
    throw new Error('ACTION_CANDIDATE_INVALID');
  }
}

function assertAction(action: UserAction): void {
  if (!ID.test(action.id) || !ID.test(action.candidateId) || !actionSet.has(action.type)
    || action.status !== 'active' || action.reason.length < 2 || action.reason.length > 240
    || !Number.isFinite(Date.parse(action.createdAt))
    || (action.scheduledFor !== null && !Number.isFinite(Date.parse(action.scheduledFor)))) {
    throw new Error('USER_ACTION_INVALID');
  }
}

export function actionEffect(type: ActionType): string {
  switch (type) {
    case 'watch-change': return 'Surface this entity only when a new material verified delta appears.';
    case 'remind-next-briefing': return 'Bring the current card back once in the next finite briefing.';
    case 'compare-next': return 'Compare this verified state with the next verified state for the same claim.';
    case 'mark-resolved': return 'Remove the current card from active attention without changing its factual state.';
    case 'ignore-pattern': return 'Hold back future cards matching this explicit pattern until the user reverses the rule.';
  }
}

export function projectActionControl(
  candidates: readonly ActionCandidate[],
  actions: readonly UserAction[],
): ActionControlProjection {
  if (candidates.length < 1 || candidates.length > 12 || actions.length > 24) {
    throw new Error('ACTION_CONTROL_INPUT_INVALID');
  }
  const candidateIds = new Set<string>();
  for (const candidate of candidates) {
    assertCandidate(candidate);
    if (candidateIds.has(candidate.id)) throw new Error('ACTION_CANDIDATE_DUPLICATE');
    candidateIds.add(candidate.id);
  }

  const actionIds = new Set<string>();
  const byCandidate = new Map<string, UserAction[]>();
  for (const action of actions) {
    assertAction(action);
    if (actionIds.has(action.id) || !candidateIds.has(action.candidateId)) throw new Error('ACTION_REFERENCE_INVALID');
    actionIds.add(action.id);
    const current = byCandidate.get(action.candidateId) ?? [];
    if (current.some((candidate) => candidate.type === action.type)) throw new Error('ACTION_TYPE_DUPLICATE');
    current.push(action);
    byCandidate.set(action.candidateId, current);
  }

  const projections: ActionCandidateProjection[] = candidates.map((candidate) => {
    const selected = byCandidate.get(candidate.id) ?? [];
    const activeActions = ACTION_ORDER.filter((type) => selected.some((action) => action.type === type));
    if (activeActions.includes('ignore-pattern') && activeActions.length > 1) throw new Error('ACTION_IGNORE_EXCLUSIVE');
    const attentionState = activeActions.includes('ignore-pattern') ? 'ignored'
      : activeActions.includes('mark-resolved') ? 'resolved'
        : activeActions.length > 0 ? 'active' : 'none';
    return Object.freeze({
      candidateId: candidate.id,
      label: candidate.label,
      activeActions: Object.freeze(activeActions),
      attentionState,
      nextBriefingEffects: Object.freeze(activeActions.map(actionEffect)),
      automaticExecution: false as const,
      factualStateChanged: false as const,
    });
  });

  return Object.freeze({
    candidates: Object.freeze(projections),
    activeActionCount: actions.length,
    watchedCandidateCount: projections.filter((candidate) => candidate.activeActions.includes('watch-change')).length,
    oneTimeActionCount: projections.reduce((count, candidate) => count
      + Number(candidate.activeActions.includes('remind-next-briefing'))
      + Number(candidate.activeActions.includes('compare-next')), 0),
    ignoredCandidateCount: projections.filter((candidate) => candidate.attentionState === 'ignored').length,
  });
}
