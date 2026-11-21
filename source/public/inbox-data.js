(() => {
  'use strict';

  const actionApi = window.DLKTActionControl;
  if (!actionApi) throw new Error('ACTION_CONTROL_UNAVAILABLE');

  const VERSION = 'dlkt-info-action-inbox-1';
  const GENERATED_AT = '2026-11-12T10:00:00.000Z';
  const STATE_ORDER = Object.freeze({ 'due-now': 0, scheduled: 1, 'waiting-for-delta': 2, 'attention-resolved': 3, muted: 4 });
  const ACTION_ORDER = Object.freeze({ 'watch-change': 0, 'remind-next-briefing': 1, 'compare-next': 2, 'mark-resolved': 3, 'ignore-pattern': 4 });
  const DEFAULT_SELECTIONS = Object.freeze({
    watch: Object.freeze(['demo-tech-pricing', 'demo-supply']),
    remind: Object.freeze(['demo-grant-window']),
    compare: Object.freeze(['demo-tech-pricing', 'demo-eu-consultation']),
    resolved: Object.freeze(['demo-market-entry']),
    ignore: Object.freeze(['demo-route']),
  });
  const OBSERVATIONS = Object.freeze({
    'demo-tech-pricing': Object.freeze({ changed: true, materialDelta: true, conflictActive: false, observed: 'Observed 09:12', currentState: 'Active rate changed again after the briefing baseline.' }),
    'demo-market-entry': Object.freeze({ changed: true, materialDelta: true, conflictActive: false, observed: 'Observed 09:18', currentState: 'A second local partner was confirmed after attention had been resolved.' }),
    'demo-eu-consultation': Object.freeze({ changed: false, materialDelta: false, conflictActive: false, observed: 'Checked 09:25', currentState: 'No materially different official state is available yet.' }),
    'demo-grant-window': Object.freeze({ changed: false, materialDelta: false, conflictActive: false, observed: 'Scheduled', currentState: 'One-time return is scheduled for tomorrow at 08:00.' }),
    'demo-route': Object.freeze({ changed: true, materialDelta: true, conflictActive: false, observed: 'Observed 09:31', currentState: 'Bookable inventory appeared, but your explicit ignore rule is still active.' }),
    'demo-supply': Object.freeze({ changed: false, materialDelta: false, conflictActive: true, observed: 'Checked 09:40', currentState: 'The manufacturer and distributor still disagree; no new decisive delta exists.' }),
  });

  const copySelections = (value) => Object.fromEntries(Object.keys(actionApi.typeByKey).map((key) => [key, [...(value[key] ?? [])]]));

  function actionEntries(selections) {
    const output = [];
    for (const [key, type] of Object.entries(actionApi.typeByKey)) {
      for (const candidateId of selections[key]) output.push({ candidateId, type });
    }
    return output;
  }

  function classify(candidate, type) {
    const observation = OBSERVATIONS[candidate.id];
    let state;
    let dueLabel = 'No due time';
    let reason;
    if (type === 'watch-change') {
      state = observation.changed && observation.materialDelta ? 'due-now' : 'waiting-for-delta';
      reason = state === 'due-now' ? 'A new material verified delta triggered this watch.'
        : observation.conflictActive ? 'The watch remains active while the contradiction is preserved.' : 'No new material verified delta has appeared.';
    } else if (type === 'compare-next') {
      state = observation.changed && observation.materialDelta ? 'due-now' : 'waiting-for-delta';
      reason = state === 'due-now' ? 'A materially different verified state is ready for comparison.' : 'The next materially different verified state has not appeared yet.';
    } else if (type === 'remind-next-briefing') {
      state = 'scheduled'; dueLabel = 'Tomorrow · 08:00'; reason = 'The card will return once in the next finite briefing.';
    } else if (type === 'mark-resolved') {
      state = observation.changed && observation.materialDelta ? 'due-now' : 'attention-resolved';
      reason = state === 'due-now' ? 'A new material delta reopened attention after the previous resolution.' : 'Attention remains resolved; the factual claim was not changed.';
    } else {
      state = 'muted'; reason = observation.materialDelta ? 'A material delta is held back by this explicit user rule.' : 'Future matching changes remain muted until you reverse the rule.';
    }
    if (state === 'due-now') dueLabel = observation.observed;
    return Object.freeze({
      id: `inbox:${type}:${candidate.id}`,
      actionId: `action:${type}:${candidate.id}`,
      candidateId: candidate.id,
      candidate,
      type,
      action: actionApi.definitions[type],
      state,
      stateLabel: state === 'due-now' ? 'Due now' : state === 'scheduled' ? 'Scheduled' : state === 'waiting-for-delta' ? 'Waiting' : state === 'attention-resolved' ? 'Resolved attention' : 'Muted',
      group: state === 'due-now' ? 'due' : state === 'scheduled' || state === 'waiting-for-delta' ? 'waiting' : 'quiet',
      dueLabel,
      reason,
      observation,
      factualStateChanged: false,
      automaticExecution: false,
      removed: false,
    });
  }

  function project(selections) {
    const normalized = actionApi.normalizeSelections(selections);
    const items = actionEntries(normalized).map(({ candidateId, type }) => {
      const candidate = actionApi.candidates.find((entry) => entry.id === candidateId);
      if (!candidate) throw new Error('ACTION_INBOX_REFERENCE_INVALID');
      return classify(candidate, type);
    }).sort((left, right) => STATE_ORDER[left.state] - STATE_ORDER[right.state]
      || ACTION_ORDER[left.type] - ACTION_ORDER[right.type]
      || left.candidateId.localeCompare(right.candidateId));
    return Object.freeze({
      version: VERSION,
      generatedAt: GENERATED_AT,
      selections: Object.freeze(copySelections(normalized)),
      items: Object.freeze(items),
      dueNowCount: items.filter((item) => item.state === 'due-now').length,
      scheduledCount: items.filter((item) => item.state === 'scheduled').length,
      waitingCount: items.filter((item) => item.state === 'waiting-for-delta').length,
      resolvedCount: items.filter((item) => item.state === 'attention-resolved').length,
      mutedCount: items.filter((item) => item.state === 'muted').length,
      suppressedMaterialDeltaCount: items.filter((item) => item.state === 'muted' && item.observation.materialDelta).length,
      automaticExecution: false,
      factualStateChanged: false,
    });
  }

  function fromSearch(search) {
    const parsed = actionApi.parseSearch(search);
    const selections = parsed.state === 'valid' ? parsed.selections : parsed.state === 'absent' ? DEFAULT_SELECTIONS : DEFAULT_SELECTIONS;
    return Object.freeze({ parsed, projection: project(selections) });
  }

  Object.defineProperty(window, 'DLKTActionInbox', {
    value: Object.freeze({ version: VERSION, defaultSelections: DEFAULT_SELECTIONS, observations: OBSERVATIONS, project, fromSearch }),
    writable: false,
    configurable: false,
  });
})();
