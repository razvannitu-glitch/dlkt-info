(() => {
  'use strict';

  const VERSION = 'dlkt-info-action-control-1';
  const MARKER = 'actions-v1';
  const ACTION_KEYS = Object.freeze(['actions', 'watch', 'remind', 'compare', 'resolved', 'ignore']);
  const FOREIGN_KEYS = new Set([
    'bridge', 'topics', 'entities', 'tz', 'at', 'max', 'min', 'actionable',
    'trust', 'level', 'conflicts', 'authority', 'sources', 'age', 'officialHigh',
  'delivery', 'dw', 'dr', 'dc', 'dx', 'di', 'qh', 'qs', 'qe', 'cap', 'gap', 'bypass', 'conflict', 'trustFloor', 'materialityFloor', 'channel', '_vercel_share',
  ]);
  const ID = /^[a-z0-9][a-z0-9:._-]{1,127}$/u;
  const TYPE_BY_KEY = Object.freeze({
    watch: 'watch-change', remind: 'remind-next-briefing', compare: 'compare-next',
    resolved: 'mark-resolved', ignore: 'ignore-pattern',
  });
  const KEY_BY_TYPE = Object.freeze(Object.fromEntries(Object.entries(TYPE_BY_KEY).map(([key, value]) => [value, key])));
  const ACTION_ORDER = Object.freeze(Object.values(TYPE_BY_KEY));
  const ACTION_DEFINITIONS = Object.freeze({
    'watch-change': Object.freeze({ label: 'Watch the next change', short: 'Watch', key: 'W', effect: 'Surface this entity only when a new material verified delta appears.', mode: 'continuous' }),
    'remind-next-briefing': Object.freeze({ label: 'Bring back next briefing', short: 'Remind', key: 'N', effect: 'Bring this card back once in the next finite briefing.', mode: 'one-time' }),
    'compare-next': Object.freeze({ label: 'Compare with next state', short: 'Compare', key: 'C', effect: 'Compare the current verified state with the next verified state for the same claim.', mode: 'one-time' }),
    'mark-resolved': Object.freeze({ label: 'Mark attention resolved', short: 'Resolved', key: 'X', effect: 'Remove this card from active attention without changing its factual state.', mode: 'attention' }),
    'ignore-pattern': Object.freeze({ label: 'Ignore this pattern', short: 'Ignore', key: 'I', effect: 'Hold back future cards matching this explicit pattern until you reverse the rule.', mode: 'rule' }),
  });
  const CANDIDATES = Object.freeze([
    Object.freeze({ id: 'demo-tech-pricing', label: 'API pricing', entity: 'DEMO AI Platform', entityId: 'demo-ai-platform', topic: 'Technology', topicId: 'technology', kind: 'Changed', materiality: 'High', trust: 'Confirmed', title: 'An API price moved from announced to active.', direct: 'The new rate is now present in the official pricing state.', nextSignal: 'Enterprise pricing, migration credits or another verified rate change.', suggested: 'compare-next' }),
    Object.freeze({ id: 'demo-market-entry', label: 'Competitor move', entity: 'DEMO Competitor', entityId: 'demo-competitor', topic: 'Business', topicId: 'business', kind: 'New', materiality: 'High', trust: 'Confirmed', title: 'A competitor entered a market you track.', direct: 'The official availability state changed from waitlist to available.', nextSignal: 'Localized pricing, partners or first customer references.', suggested: 'watch-change' }),
    Object.freeze({ id: 'demo-eu-consultation', label: 'EU consultation', entity: 'DEMO EU File', entityId: 'demo-eu-file', topic: 'Regulation', topicId: 'regulation', kind: 'Changed', materiality: 'Medium', trust: 'Confirmed', title: 'An EU consultation moved from announced to open.', direct: 'The response window is now active with a verified deadline.', nextSignal: 'Questionnaire changes, deadline extensions or a stakeholder summary.', suggested: 'remind-next-briefing' }),
    Object.freeze({ id: 'demo-grant-window', label: 'Funding window', entity: 'DEMO Innovation Fund', entityId: 'demo-innovation-fund', topic: 'Opportunity', topicId: 'opportunities', kind: 'New', materiality: 'High', trust: 'Confirmed', title: 'A funding window relevant to your work is now open.', direct: 'The official application portal and final documents are available.', nextSignal: 'Corrigenda, partner-search events or applicant-guide revisions.', suggested: 'watch-change' }),
    Object.freeze({ id: 'demo-route', label: 'Direct route', entity: 'DEMO Airline', entityId: 'demo-airline', topic: 'Travel', topicId: 'travel', kind: 'New', materiality: 'Medium', trust: 'Single-source', title: 'A direct route was added for the summer schedule.', direct: 'One primary timetable lists the new route; fares are not yet published.', nextSignal: 'Bookable inventory or airport confirmation.', suggested: 'compare-next' }),
    Object.freeze({ id: 'demo-supply', label: 'Component status', entity: 'DEMO Component', entityId: 'demo-component', topic: 'Supply', topicId: 'supply', kind: 'Changed', materiality: 'High', trust: 'Conflicting', title: 'Availability changed, but a distributor still reports delay.', direct: 'Manufacturer and distributor states remain contradictory.', nextSignal: 'Exact-SKU stock refresh or allocation notice.', suggested: 'watch-change' }),
  ]);
  const CANDIDATE_IDS = new Set(CANDIDATES.map((candidate) => candidate.id));

  const emptySelections = () => ({ watch: [], remind: [], compare: [], resolved: [], ignore: [] });
  const cloneSelections = (value) => Object.fromEntries(Object.keys(TYPE_BY_KEY).map((key) => [key, [...(value[key] ?? [])]]));

  function parseList(value) {
    if (value === null || value === '') return [];
    const ids = value.split(',');
    if (ids.length > 12 || new Set(ids).size !== ids.length || ids.some((id) => !ID.test(id) || !CANDIDATE_IDS.has(id))) throw new Error('ACTION_QUERY_IDS_INVALID');
    return ids;
  }

  function normalizeSelections(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ACTION_SELECTION_INVALID');
    const output = emptySelections();
    for (const key of Object.keys(TYPE_BY_KEY)) {
      const ids = Array.isArray(value[key]) ? value[key] : [];
      if (ids.length > 12 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !CANDIDATE_IDS.has(id))) throw new Error('ACTION_SELECTION_INVALID');
      output[key] = [...ids].sort();
    }
    const ignored = new Set(output.ignore);
    if (Object.keys(TYPE_BY_KEY).some((key) => key !== 'ignore' && output[key].some((id) => ignored.has(id)))) throw new Error('ACTION_IGNORE_EXCLUSIVE');
    const total = Object.values(output).reduce((sum, ids) => sum + ids.length, 0);
    if (total > 24) throw new Error('ACTION_SELECTION_LIMIT');
    return output;
  }

  function parseSearch(search) {
    if (typeof search !== 'string' || search.length > 2048) return Object.freeze({ state: 'invalid', selections: Object.freeze(emptySelections()), reason: 'ACTION_QUERY_LENGTH' });
    const params = new URLSearchParams(search);
    const keys = [...params.keys()];
    if (!keys.some((key) => ACTION_KEYS.includes(key))) return Object.freeze({ state: 'absent', selections: Object.freeze(emptySelections()) });
    if (keys.some((key) => !ACTION_KEYS.includes(key) && !FOREIGN_KEYS.has(key))) return Object.freeze({ state: 'invalid', selections: Object.freeze(emptySelections()), reason: 'ACTION_QUERY_UNKNOWN' });
    if (ACTION_KEYS.some((key) => params.getAll(key).length > 1) || params.get('actions') !== MARKER) return Object.freeze({ state: 'invalid', selections: Object.freeze(emptySelections()), reason: 'ACTION_QUERY_DUPLICATE_OR_MARKER' });
    try {
      const selections = emptySelections();
      for (const key of Object.keys(TYPE_BY_KEY)) selections[key] = parseList(params.get(key));
      return Object.freeze({ state: 'valid', selections: Object.freeze(normalizeSelections(selections)) });
    } catch (error) {
      return Object.freeze({ state: 'invalid', selections: Object.freeze(emptySelections()), reason: error instanceof Error ? error.message : 'ACTION_QUERY_INVALID' });
    }
  }

  function buildSearch(value, existingSearch = '') {
    const selections = normalizeSelections(value);
    const existing = new URLSearchParams(existingSearch);
    const params = new URLSearchParams();
    for (const [key, current] of existing.entries()) if (FOREIGN_KEYS.has(key) && !params.has(key)) params.set(key, current);
    params.set('actions', MARKER);
    for (const key of Object.keys(TYPE_BY_KEY)) if (selections[key].length) params.set(key, selections[key].join(','));
    return `?${params.toString()}`;
  }

  function buildUrl(value, existingSearch = '', route = '/actions') { return `${route}${buildSearch(value, existingSearch)}`; }

  function selectedTypes(candidateId, selections) {
    return ACTION_ORDER.filter((type) => selections[KEY_BY_TYPE[type]].includes(candidateId));
  }

  function project(value) {
    const selections = normalizeSelections(value);
    const candidates = CANDIDATES.map((candidate) => {
      const activeActions = selectedTypes(candidate.id, selections);
      const attentionState = activeActions.includes('ignore-pattern') ? 'ignored' : activeActions.includes('mark-resolved') ? 'resolved' : activeActions.length ? 'active' : 'none';
      return Object.freeze({ ...candidate, activeActions: Object.freeze(activeActions), attentionState, effects: Object.freeze(activeActions.map((type) => ACTION_DEFINITIONS[type].effect)), factualStateChanged: false, automaticExecution: false });
    });
    return Object.freeze({
      candidates: Object.freeze(candidates),
      activeActionCount: Object.values(selections).reduce((sum, ids) => sum + ids.length, 0),
      watchedCandidateCount: selections.watch.length,
      oneTimeActionCount: selections.remind.length + selections.compare.length,
      ignoredCandidateCount: selections.ignore.length,
    });
  }

  Object.defineProperty(window, 'DLKTActionControl', {
    value: Object.freeze({ version: VERSION, marker: MARKER, candidates: CANDIDATES, actionOrder: ACTION_ORDER, definitions: ACTION_DEFINITIONS, emptySelections, cloneSelections, normalizeSelections, parseSearch, buildSearch, buildUrl, project, keyByType: KEY_BY_TYPE, typeByKey: TYPE_BY_KEY }),
    writable: false,
    configurable: false,
  });
})();
