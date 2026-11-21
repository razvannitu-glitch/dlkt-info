(() => {
  'use strict';

  const bridgeApi = window.DLKTCompanionBridge;
  const trustApi = window.DLKTTrustControl;
  const actionApi = window.DLKTActionControl;
  const inboxApi = window.DLKTActionInbox;
  const deliveryApi = window.DLKTDeliveryControl;
  const memoryData = window.DLKTMemoryControlData;
  const historyData = window.DLKTBriefingHistory;
  if (!bridgeApi || !trustApi || !actionApi || !inboxApi || !deliveryApi || !memoryData || !historyData) {
    throw new Error('UNIFIED_SHELL_DEPENDENCY_UNAVAILABLE');
  }

  const VERSION = 'dlkt-info-unified-shell-preview-1';
  const STAGES = Object.freeze(['briefing', 'trust', 'memory', 'actions', 'inbox', 'delivery']);
  const ALLOWED_QUERY_KEYS = new Set([
    'bridge', 'topics', 'entities', 'tz', 'at', 'max', 'min', 'actionable',
    'trust', 'level', 'conflicts', 'authority', 'sources', 'age', 'officialHigh',
    'actions', 'watch', 'remind', 'compare', 'resolved', 'ignore',
    'delivery', 'dw', 'dr', 'dc', 'dx', 'di', 'qh', 'qs', 'qe', 'cap', 'gap', 'bypass', 'conflict', 'trustFloor', 'materialityFloor', 'channel',
    '_vercel_share',
  ]);
  const MATERIALITY_RANK = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
  const DEFAULT_DEFINITION = Object.freeze({
    topics: Object.freeze(['technology', 'business', 'regulation', 'opportunities', 'supply']),
    entities: Object.freeze([]),
    timezone: 'Europe/Bucharest', deliveryLocalTime: '08:00', maxCards: 6, minMateriality: 'medium', onlyActionable: false,
  });
  const DEFAULT_ACTIONS = Object.freeze({
    watch: Object.freeze(['demo-tech-pricing', 'demo-supply']),
    remind: Object.freeze(['demo-grant-window']),
    compare: Object.freeze(['demo-eu-consultation']),
    resolved: Object.freeze([]),
    ignore: Object.freeze([]),
  });
  const TRUST_PRESETS = Object.freeze({
    strict: Object.freeze({ minimumTrust: 'confirmed', conflictPolicy: 'exclude', authorityRequirement: 'official', minimumSources: 2, maximumEvidenceAgeHours: 24, requireOfficialForHighImpact: true }),
    balanced: trustApi.defaultPolicy,
    explore: Object.freeze({ minimumTrust: 'single-source', conflictPolicy: 'include-warning', authorityRequirement: 'reputable-secondary', minimumSources: 1, maximumEvidenceAgeHours: 168, requireOfficialForHighImpact: false }),
  });
  const CARD_DETAILS = Object.freeze({
    'demo-tech-pricing': Object.freeze({
      observed: 'Observed 07:42', before: 'New pricing announced for a later date.', now: 'New pricing is listed as active.',
      why: 'It changes the operating cost of products that depend on this API.', action: 'Review usage-heavy flows before the next billing cycle.', actionable: true,
    }),
    'demo-market-entry': Object.freeze({
      observed: 'Observed 06:55', before: 'No verified local operating partner.', now: 'Two primary partners confirm market entry.',
      why: 'The move changes the competitive map in a market you follow.', action: 'Compare positioning, channel strategy and local pricing.', actionable: true,
    }),
    'demo-eu-consultation': Object.freeze({
      observed: 'Observed 05:20', before: 'The response window closed earlier.', now: 'The official deadline moved later.',
      why: 'The extension creates time to submit evidence or coordinate a response.', action: 'Recalculate the response plan against the official deadline.', actionable: true,
    }),
    'demo-grant-window': Object.freeze({
      observed: 'Observed 04:10', before: 'The programme appeared only in the annual plan.', now: 'The application portal and final documents are open.',
      why: 'The eligibility profile matches digital community and information infrastructure work.', action: 'Run a short eligibility screen before investing in a consortium.', actionable: true,
    }),
    'demo-route': Object.freeze({
      observed: 'Observed 03:05', before: 'No direct service appeared in the published timetable.', now: 'One primary timetable lists a direct summer route.',
      why: 'The route could reduce travel friction once inventory becomes bookable.', action: 'Wait for airport confirmation or bookable inventory.', actionable: false,
    }),
    'demo-supply': Object.freeze({
      observed: 'Observed 02:20', before: 'Both sources reported constrained availability.', now: 'The manufacturer reports availability while a distributor still reports delay.',
      why: 'The change may unblock a project, but the contradiction must be resolved first.', action: 'Verify the exact SKU before committing funds.', actionable: true,
    }),
  });

  const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  };
  const cloneDefinition = (value) => ({ ...value, topics: [...value.topics], entities: [...(value.entities ?? [])] });
  const cloneActions = (value) => actionApi.cloneSelections(value);
  const cloneDelivery = (value) => deliveryApi.clonePolicy(value);
  const cloneTrust = (value) => ({ ...value });

  function defaultState() {
    const delivery = cloneDelivery(deliveryApi.defaultPolicy);
    delivery.timezone = DEFAULT_DEFINITION.timezone;
    return {
      definition: cloneDefinition(DEFAULT_DEFINITION),
      trustPolicy: cloneTrust(trustApi.defaultPolicy),
      actions: cloneActions(DEFAULT_ACTIONS),
      deliveryPolicy: delivery,
      selectedStage: 'briefing',
      selectedCardId: null,
      queryState: 'default',
      queryReason: null,
    };
  }

  function parseHash(hash) {
    const params = new URLSearchParams(typeof hash === 'string' && hash.startsWith('#') ? hash.slice(1) : hash);
    const stage = params.get('stage');
    const card = params.get('card');
    return Object.freeze({
      stage: STAGES.includes(stage) ? stage : 'briefing',
      card: typeof card === 'string' && /^[a-z0-9][a-z0-9:._-]{1,127}$/u.test(card) ? card : null,
    });
  }

  function parseSearch(search, hash = '') {
    const state = defaultState();
    const parameters = new URLSearchParams(typeof search === 'string' && search.startsWith('?') ? search.slice(1) : search);
    const unknownKey = [...parameters.keys()].find((key) => !ALLOWED_QUERY_KEYS.has(key));
    if (unknownKey) {
      const fragment = parseHash(hash);
      state.selectedStage = fragment.stage;
      state.selectedCardId = fragment.card;
      state.queryState = 'invalid';
      state.queryReason = `UNIFIED_QUERY_UNKNOWN:${unknownKey}`;
      return state;
    }
    const bridge = bridgeApi.parseSearch(search);
    const trust = trustApi.parseSearch(search);
    const actions = actionApi.parseSearch(search);
    const delivery = deliveryApi.parseSearch(search);
    const states = [bridge.state, trust.state, actions.state, delivery.state];
    if (bridge.state === 'valid') state.definition = cloneDefinition(bridge.definition);
    if (trust.state === 'valid') state.trustPolicy = cloneTrust(trust.policy);
    if (actions.state === 'valid') state.actions = cloneActions(actions.selections);
    if (delivery.state === 'valid' || delivery.state === 'absent') state.deliveryPolicy = cloneDelivery(delivery.policy);
    state.deliveryPolicy.timezone = state.definition.timezone;
    const fragment = parseHash(hash);
    state.selectedStage = fragment.stage;
    state.selectedCardId = fragment.card;
    if (states.includes('invalid')) {
      state.queryState = 'invalid';
      state.queryReason = [bridge.reason, trust.reason, actions.reason, delivery.reason].filter(Boolean)[0] ?? 'INVALID_STATE';
    } else if (states.every((entry) => entry === 'absent')) {
      state.queryState = 'default';
    } else {
      state.queryState = 'valid';
    }
    return state;
  }

  function signalMatches(signal, candidate) {
    if (!signal.active) return false;
    if (signal.targetType === 'topic') return signal.targetId === candidate.topicId;
    if (signal.targetType === 'entity') return signal.targetId === candidate.entityId;
    if (signal.targetType === 'kind') return signal.targetId === candidate.kind.toLowerCase();
    return false;
  }

  function memoryProjection(candidate) {
    const baseline = memoryData.candidates.find((entry) => entry.id === candidate.id);
    const signals = memoryData.signals.filter((signal) => signalMatches(signal, candidate));
    const memoryWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
    return Object.freeze({
      baseScore: baseline?.baseScore ?? 0,
      memoryWeight,
      score: (baseline?.baseScore ?? 0) + memoryWeight,
      signals: Object.freeze(signals.map((signal) => Object.freeze({ ...signal }))),
    });
  }

  function trustDecisionMap(policy) {
    const projection = trustApi.project(policy);
    return Object.freeze({ projection, byId: new Map(projection.decisions.map((decision) => [decision.candidateId, decision])) });
  }

  function entityIncluded(definition, candidate) {
    if (!definition.entities.length) return true;
    const haystack = `${candidate.entity} ${candidate.entityId} ${candidate.label}`.normalize('NFKC').toLocaleLowerCase('en-US');
    return definition.entities.some((entity) => {
      const needle = entity.normalize('NFKC').toLocaleLowerCase('en-US');
      return haystack.includes(needle) || needle.includes(candidate.entity.toLocaleLowerCase('en-US'));
    });
  }

  function cardProjection(state) {
    const trust = trustDecisionMap(state.trustPolicy);
    const ignored = new Set(state.actions.ignore);
    const resolved = new Set(state.actions.resolved);
    const minimum = MATERIALITY_RANK[state.definition.minMateriality] ?? 0;
    const cards = actionApi.candidates.map((candidate) => {
      const detail = CARD_DETAILS[candidate.id];
      const trustCandidate = trustApi.candidateById[candidate.id];
      const decision = trust.byId.get(candidate.id);
      const memory = memoryProjection(candidate);
      const history = historyData.cardHistory[candidate.id] ?? null;
      return Object.freeze({
        ...candidate,
        detail,
        trustCandidate,
        trustDecision: decision,
        memory,
        history,
        included: Boolean(decision?.included)
          && state.definition.topics.includes(candidate.topicId)
          && entityIncluded(state.definition, candidate)
          && (MATERIALITY_RANK[candidate.materiality.toLowerCase()] ?? 0) >= minimum
          && (!state.definition.onlyActionable || detail.actionable)
          && !ignored.has(candidate.id)
          && !resolved.has(candidate.id),
      });
    }).filter((candidate) => candidate.included)
      .sort((left, right) => right.memory.score - left.memory.score || left.id.localeCompare(right.id))
      .slice(0, state.definition.maxCards);
    return Object.freeze({ cards: Object.freeze(cards), trust: trust.projection });
  }

  function combinedSearch(state) {
    let search = bridgeApi.buildSearch(state.definition);
    const trustUrl = trustApi.buildTrustUrl(state.trustPolicy, search);
    search = new URL(trustUrl, 'https://dlkt.invalid').search;
    search = actionApi.buildSearch(state.actions, search);
    search = deliveryApi.buildSearch(state.deliveryPolicy, search);
    return search;
  }

  function buildRoute(route, state) {
    return `${route}${combinedSearch(state)}`;
  }

  function project(state) {
    const cardState = cardProjection(state);
    const actionProjection = actionApi.project(state.actions);
    const inboxProjection = inboxApi.project(state.actions);
    const actionSearch = actionApi.buildSearch(state.actions);
    const deliveryProjection = deliveryApi.project(state.deliveryPolicy, actionSearch);
    const selectedCard = cardState.cards.find((card) => card.id === state.selectedCardId) ?? cardState.cards[0] ?? null;
    const currentActions = selectedCard
      ? actionProjection.candidates.find((candidate) => candidate.candidateId === selectedCard.id)?.activeActions ?? []
      : [];
    const currentDelivery = selectedCard
      ? deliveryProjection.decisions.find((decision) => decision.candidateId === selectedCard.id) ?? null
      : null;
    const currentInbox = selectedCard
      ? inboxProjection.items.filter((item) => item.candidateId === selectedCard.id)
      : [];
    const query = combinedSearch(state);
    const links = Object.freeze(Object.fromEntries([
      ['companion', `/companion${query}`], ['today', `/today${query}`], ['history', `/history${query}`], ['memory', `/memory${query}`],
      ['trust', `/trust${query}`], ['actions', `/actions${query}`], ['inbox', `/inbox${query}`], ['delivery', `/delivery${query}`], ['review', '/review'],
    ]));
    return deepFreeze({
      version: VERSION,
      cards: cardState.cards,
      selectedCard,
      trustProjection: cardState.trust,
      actionProjection,
      inboxProjection,
      deliveryProjection,
      currentActions,
      currentDelivery,
      currentInbox,
      memorySignalCount: memoryData.signals.filter((signal) => signal.active).length,
      links,
      query,
      automaticExecution: false,
      factualStateChanged: false,
      browserStorage: false,
    });
  }

  function trustPreset(name) {
    const preset = TRUST_PRESETS[name];
    if (!preset) throw new Error('UNIFIED_SHELL_TRUST_PRESET_INVALID');
    return cloneTrust(preset);
  }

  function hashFor(stage, cardId) {
    const params = new URLSearchParams();
    params.set('stage', STAGES.includes(stage) ? stage : 'briefing');
    if (cardId) params.set('card', cardId);
    return `#${params.toString()}`;
  }

  Object.defineProperty(window, 'DLKTUnifiedCompanion', {
    value: Object.freeze({
      version: VERSION,
      stages: STAGES,
      defaultDefinition: DEFAULT_DEFINITION,
      defaultActions: DEFAULT_ACTIONS,
      trustPresets: TRUST_PRESETS,
      defaultState,
      parseSearch,
      project,
      combinedSearch,
      buildRoute,
      trustPreset,
      hashFor,
      cloneDefinition,
      cloneActions,
      cloneDelivery,
      cloneTrust,
    }),
    writable: false,
    configurable: false,
  });
})();
