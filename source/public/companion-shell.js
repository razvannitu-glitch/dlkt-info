(() => {
  'use strict';

  const api = window.DLKTUnifiedCompanion;
  const bridgeApi = window.DLKTCompanionBridge;
  const trustApi = window.DLKTTrustControl;
  const actionApi = window.DLKTActionControl;
  if (!api || !bridgeApi || !trustApi || !actionApi) throw new Error('UNIFIED_SHELL_UNAVAILABLE');

  let state = api.parseSearch(window.location.search, window.location.hash);
  let projection = null;
  let toastTimer = null;

  const elements = {
    finiteCount: document.querySelector('[data-finite-count]'), actionCount: document.querySelector('[data-action-count]'), attentionCount: document.querySelector('[data-attention-count]'),
    journey: Array.from(document.querySelectorAll('[data-stage]')), stepCounts: Array.from(document.querySelectorAll('[data-step-count]')), stepStates: Array.from(document.querySelectorAll('[data-step-state]')),
    cardCount: document.querySelector('[data-card-count]'), cardMap: document.querySelector('[data-card-map]'), queryState: document.querySelector('[data-query-state]'), queryCopy: document.querySelector('[data-query-copy]'), reset: document.querySelector('[data-reset-shell]'),
    cardPosition: document.querySelector('[data-card-position]'), cardTotal: document.querySelector('[data-card-total]'), cardPrev: document.querySelector('[data-card-prev]'), cardNext: document.querySelector('[data-card-next]'), card: document.querySelector('[data-unified-card]'), empty: document.querySelector('[data-empty-state]'),
    cardTopic: document.querySelector('[data-card-topic]'), cardKind: document.querySelector('[data-card-kind]'), cardTrust: document.querySelector('[data-card-trust]'), cardObserved: document.querySelector('[data-card-observed]'), cardEntity: document.querySelector('[data-card-entity]'), cardTitle: document.querySelector('[data-card-title]'), cardDirect: document.querySelector('[data-card-direct]'), cardBefore: document.querySelector('[data-card-before]'), cardNow: document.querySelector('[data-card-now]'), cardWhy: document.querySelector('[data-card-why]'), cardAction: document.querySelector('[data-card-action]'), cardRank: document.querySelector('[data-card-rank]'), cardMemoryScore: document.querySelector('[data-card-memory-score]'), cardTrustState: document.querySelector('[data-card-trust-state]'),
    memorySummary: document.querySelector('[data-memory-summary]'), memoryReasons: document.querySelector('[data-memory-reasons]'), trustSummary: document.querySelector('[data-trust-summary]'), trustReason: document.querySelector('[data-trust-reason]'), actionSummary: document.querySelector('[data-action-summary]'), quickActions: Array.from(document.querySelectorAll('[data-quick-action]')), deliverySummary: document.querySelector('[data-delivery-summary]'), deliveryReason: document.querySelector('[data-delivery-reason]'),
    stageKicker: document.querySelector('[data-stage-kicker]'), stageTitle: document.querySelector('[data-stage-title]'), stageExplanation: document.querySelector('[data-stage-explanation]'), stagePanels: Array.from(document.querySelectorAll('[data-stage-panel]')),
    topicButtons: Array.from(document.querySelectorAll('[data-topic]')), trackedEntities: document.querySelector('[data-tracked-entities]'), briefingTime: document.querySelector('[data-briefing-time]'), maxCards: document.querySelector('[data-max-cards]'), actionableOnly: document.querySelector('[data-actionable-only]'), trustPresets: Array.from(document.querySelectorAll('[data-trust-preset]')), trustLedger: document.querySelector('[data-trust-ledger]'), memoryLedger: document.querySelector('[data-memory-ledger]'), actionControls: Array.from(document.querySelectorAll('[data-action-type]')), actionLedger: document.querySelector('[data-action-ledger]'), inboxDue: document.querySelector('[data-inbox-due]'), inboxWaiting: document.querySelector('[data-inbox-waiting]'), inboxMuted: document.querySelector('[data-inbox-muted]'), inboxList: document.querySelector('[data-inbox-list]'), deliveryModes: Array.from(document.querySelectorAll('[data-delivery-mode]')), dailyCap: document.querySelector('[data-daily-cap]'), quietHours: document.querySelector('[data-quiet-hours]'), deliveryLedger: document.querySelector('[data-delivery-ledger]'),
    routeLinks: Array.from(document.querySelectorAll('[data-route]')), toast: document.querySelector('[data-toast]'), toastTitle: document.querySelector('[data-toast-title]'), toastCopy: document.querySelector('[data-toast-copy]'),
  };

  const STAGE_COPY = Object.freeze({
    briefing: Object.freeze({ kicker: '01 · Briefing definition', title: 'Control the finite brief.', explanation: 'Choose topics, threshold, time and maximum cards. The briefing always ends.' }),
    trust: Object.freeze({ kicker: '02 · Evidence policy', title: 'Choose what qualifies.', explanation: 'Trust is a visible policy, not an unexplained AI opinion.' }),
    memory: Object.freeze({ kicker: '03 · Explainable memory', title: 'See every influence.', explanation: 'Only visible, bounded signals may affect priority.' }),
    actions: Object.freeze({ kicker: '04 · Explicit action', title: 'Choose the consequence.', explanation: 'Actions change attention, never the factual claim.' }),
    inbox: Object.freeze({ kicker: '05 · Follow-up', title: 'Only what needs a decision.', explanation: 'The Inbox waits silently until a verified delta or due time exists.' }),
    delivery: Object.freeze({ kicker: '06 · Return path', title: 'Every interruption earns its place.', explanation: 'Quiet hours, trust and anti-spam rules decide how information returns.' }),
  });
  const STATE_LABEL = Object.freeze({ ready: 'Ready', attention: 'Attention', waiting: 'Waiting', empty: 'Empty' });
  const pad = (value) => String(value).padStart(2, '0');
  const create = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };

  function showToast(title, copy) {
    elements.toastTitle.textContent = title;
    elements.toastCopy.textContent = copy;
    elements.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2600);
  }

  async function privateJson(path, marker) {
    const response = await fetch(path, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-DLKT-Info-Request': marker },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null);
    return { response, payload };
  }

  function savedCompanion(payload) {
    if (!payload || typeof payload !== 'object' || payload.version !== 'dlkt-info-persistence-2'
        || !payload.briefing || !payload.rule || !payload.trustPolicy) return null;
    try {
      const definition = bridgeApi.normalize({
        topics: payload.rule.topics,
        entities: payload.rule.entities,
        timezone: payload.briefing.timezone,
        deliveryLocalTime: payload.briefing.deliveryLocalTime,
        maxCards: payload.briefing.maxCards,
        minMateriality: payload.rule.minMateriality,
        onlyActionable: payload.rule.onlyActionable,
      });
      const trustPolicy = trustApi.normalizePolicy(payload.trustPolicy);
      return { definition, trustPolicy };
    } catch {
      return null;
    }
  }

  async function hydrateSavedCompanion() {
    if (state.queryState !== 'default') return;
    try {
      const identity = await privateJson('/api/auth', 'identity-v1');
      if (!identity.response.ok || identity.payload?.authenticated !== true) return;
      const persisted = await privateJson('/api/persistence', 'persistence-v1');
      if (!persisted.response.ok) return;
      const saved = savedCompanion(persisted.payload);
      if (!saved) return;
      state.definition = api.cloneDefinition(saved.definition);
      state.trustPolicy = api.cloneTrust(saved.trustPolicy);
      state.deliveryPolicy.timezone = state.definition.timezone;
      state.queryState = 'valid';
      state.queryReason = null;
      showToast('Saved Companion restored', 'Your exact cross-device contract is active.');
      render();
    } catch {
      // The transparent session preview remains available when private persistence is unavailable.
    }
  }

  function stepProjection() {
    return [
      { id: 'briefing', count: projection.cards.length, state: projection.cards.length ? 'ready' : 'empty' },
      { id: 'trust', count: projection.trustProjection.includedIds.length, state: projection.trustProjection.excludedIds.length ? 'attention' : projection.trustProjection.includedIds.length ? 'ready' : 'empty' },
      { id: 'memory', count: projection.memorySignalCount, state: projection.memorySignalCount ? 'ready' : 'empty' },
      { id: 'actions', count: projection.actionProjection.activeActionCount, state: projection.actionProjection.activeActionCount ? 'ready' : 'empty' },
      { id: 'inbox', count: projection.inboxProjection.dueNowCount, state: projection.inboxProjection.dueNowCount ? 'attention' : projection.inboxProjection.waitingCount ? 'waiting' : 'empty' },
      { id: 'delivery', count: projection.deliveryProjection.notifyNowCount + projection.deliveryProjection.deferredCount, state: projection.deliveryProjection.notifyNowCount ? 'attention' : projection.deliveryProjection.deferredCount + projection.deliveryProjection.nextBriefingCount ? 'waiting' : 'empty' },
    ];
  }

  function syncState() {
    projection = api.project(state);
    if (projection.selectedCard && state.selectedCardId !== projection.selectedCard.id) state.selectedCardId = projection.selectedCard.id;
    if (!projection.selectedCard) state.selectedCardId = null;
    const path = `${window.location.pathname}${api.combinedSearch(state)}${api.hashFor(state.selectedStage, state.selectedCardId)}`;
    window.history.replaceState(null, '', path);
  }

  function renderJourney() {
    const steps = stepProjection();
    const byId = new Map(steps.map((entry) => [entry.id, entry]));
    elements.journey.forEach((button) => {
      const id = button.dataset.stage;
      const entry = byId.get(id);
      button.setAttribute('aria-pressed', String(id === state.selectedStage));
      button.dataset.state = entry?.state ?? 'empty';
    });
    elements.stepCounts.forEach((node) => { const entry = byId.get(node.dataset.stepCount); node.textContent = pad(entry?.count ?? 0); });
    elements.stepStates.forEach((node) => { const entry = byId.get(node.dataset.stepState); node.textContent = STATE_LABEL[entry?.state ?? 'empty']; });
    const active = STAGE_COPY[state.selectedStage];
    elements.stageKicker.textContent = active.kicker;
    elements.stageTitle.textContent = active.title;
    elements.stageExplanation.textContent = active.explanation;
    elements.stagePanels.forEach((panel) => { panel.hidden = panel.dataset.stagePanel !== state.selectedStage; panel.classList.toggle('is-active', !panel.hidden); });
  }

  function renderMetrics() {
    const immediate = projection.inboxProjection.dueNowCount + projection.deliveryProjection.notifyNowCount;
    elements.finiteCount.textContent = pad(projection.cards.length);
    elements.actionCount.textContent = pad(projection.actionProjection.activeActionCount);
    elements.attentionCount.textContent = pad(immediate);
    elements.cardCount.textContent = pad(projection.cards.length);
    elements.queryState.textContent = state.queryState === 'invalid' ? 'Unsafe state rejected' : state.queryState === 'valid' ? 'Shareable session state' : 'Transparent demo defaults';
    elements.queryCopy.textContent = state.queryState === 'invalid'
      ? `The malformed state was ignored: ${state.queryReason}. Safe defaults are active.`
      : 'Every active rule is visible and encoded in the current session URL.';
  }

  function selectCard(id) {
    if (!projection.cards.some((card) => card.id === id)) return;
    state.selectedCardId = id;
    render();
  }

  function renderCardMap() {
    elements.cardMap.replaceChildren();
    projection.cards.forEach((card, index) => {
      const button = create('button');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(card.id === state.selectedCardId));
      const number = create('span', '', pad(index + 1));
      const copy = create('div'); copy.append(create('strong', '', card.label), create('small', '', `${card.topic} · ${card.kind}`));
      const score = create('b', '', String(card.memory.score));
      button.append(number, copy, score);
      button.addEventListener('click', () => selectCard(card.id));
      elements.cardMap.append(button);
    });
  }

  function renderCard() {
    const card = projection.selectedCard;
    elements.card.hidden = !card;
    elements.empty.hidden = Boolean(card);
    elements.cardTotal.textContent = pad(projection.cards.length);
    elements.cardPrev.disabled = projection.cards.length < 2;
    elements.cardNext.disabled = projection.cards.length < 2;
    if (!card) { elements.cardPosition.textContent = '00'; return; }
    const index = projection.cards.findIndex((entry) => entry.id === card.id);
    elements.cardPosition.textContent = pad(index + 1);
    elements.cardTopic.textContent = card.topic;
    elements.cardKind.textContent = card.kind;
    elements.cardTrust.textContent = card.trust;
    elements.cardObserved.textContent = card.detail.observed;
    elements.cardEntity.textContent = card.entity;
    elements.cardTitle.textContent = card.title;
    elements.cardDirect.textContent = card.direct;
    elements.cardBefore.textContent = card.detail.before;
    elements.cardNow.textContent = card.detail.now;
    elements.cardWhy.textContent = card.detail.why;
    elements.cardAction.textContent = card.detail.action;
    elements.cardRank.textContent = `#${index + 1}`;
    elements.cardMemoryScore.textContent = `${card.memory.memoryWeight >= 0 ? '+' : ''}${card.memory.memoryWeight}`;
    elements.cardTrustState.textContent = card.trustDecision?.included ? 'Passed' : 'Held back';
  }

  function renderLogic() {
    const card = projection.selectedCard;
    elements.memoryReasons.replaceChildren();
    if (!card) {
      elements.memorySummary.textContent = 'No active card';
      elements.trustSummary.textContent = 'No trust decision';
      elements.trustReason.textContent = 'Change the visible rules to restore a finite briefing.';
      elements.actionSummary.textContent = 'No action available';
      elements.deliverySummary.textContent = 'No delivery decision';
      elements.deliveryReason.textContent = 'No candidate can interrupt.';
      return;
    }
    elements.memorySummary.textContent = `${card.memory.signals.length} visible signal${card.memory.signals.length === 1 ? '' : 's'}`;
    if (!card.memory.signals.length) elements.memoryReasons.append(create('li', '', 'No memory influence.'));
    card.memory.signals.slice(0, 4).forEach((signal) => { const row = create('li'); row.append(create('span', '', signal.targetLabel), create('b', '', `${signal.weight >= 0 ? '+' : ''}${signal.weight}`)); elements.memoryReasons.append(row); });
    const blocking = card.trustDecision?.blockingReasons ?? [];
    const warnings = card.trustDecision?.warnings ?? [];
    elements.trustSummary.textContent = card.trustDecision?.included ? 'Passed current policy' : 'Held back by policy';
    elements.trustReason.textContent = blocking[0] ?? warnings[0] ?? `${card.trustCandidate.sources.length} source${card.trustCandidate.sources.length === 1 ? '' : 's'} satisfy the visible evidence rule.`;
    elements.actionSummary.textContent = projection.currentActions.length ? projection.currentActions.map((type) => actionApi.definitions[type].short).join(' · ') : 'No action selected';
    elements.quickActions.forEach((button) => button.classList.toggle('is-active', projection.currentActions.includes(button.dataset.quickAction)));
    elements.deliverySummary.textContent = projection.currentDelivery ? projection.currentDelivery.label : 'No return rule yet';
    elements.deliveryReason.textContent = projection.currentDelivery?.reason ?? 'Choose an explicit action before DLKT can project a return path.';
  }

  function renderBriefingControls() {
    elements.topicButtons.forEach((button) => button.setAttribute('aria-pressed', String(state.definition.topics.includes(button.dataset.topic))));
    elements.trackedEntities.replaceChildren();
    if (!state.definition.entities.length) {
      elements.trackedEntities.append(create('b', '', 'Broad topics only'));
    } else {
      state.definition.entities.forEach((entity) => elements.trackedEntities.append(create('b', '', entity)));
    }
    elements.briefingTime.value = state.definition.deliveryLocalTime;
    elements.maxCards.value = String(state.definition.maxCards);
    elements.actionableOnly.checked = state.definition.onlyActionable;
  }

  function samePolicy(left, right) {
    return left.minimumTrust === right.minimumTrust && left.conflictPolicy === right.conflictPolicy && left.authorityRequirement === right.authorityRequirement
      && left.minimumSources === right.minimumSources && left.maximumEvidenceAgeHours === right.maximumEvidenceAgeHours && left.requireOfficialForHighImpact === right.requireOfficialForHighImpact;
  }

  function renderTrustControls() {
    elements.trustPresets.forEach((button) => button.classList.toggle('is-active', samePolicy(state.trustPolicy, api.trustPresets[button.dataset.trustPreset])));
    elements.trustLedger.replaceChildren();
    const entries = [
      ['Minimum trust', state.trustPolicy.minimumTrust], ['Conflict policy', state.trustPolicy.conflictPolicy], ['Authority', state.trustPolicy.authorityRequirement],
      ['Source minimum', String(state.trustPolicy.minimumSources)], ['Evidence age', `${state.trustPolicy.maximumEvidenceAgeHours} hours`], ['High impact', state.trustPolicy.requireOfficialForHighImpact ? 'Official required' : 'Visible warning'],
    ];
    entries.forEach(([label, value]) => { const row = create('div'); row.append(create('span', '', label), create('strong', '', value)); elements.trustLedger.append(row); });
  }

  function renderMemoryLedger() {
    elements.memoryLedger.replaceChildren();
    const card = projection.selectedCard;
    if (!card || !card.memory.signals.length) { const row = create('div'); row.append(create('span', '', 'No matching signal'), create('b', '', '0')); elements.memoryLedger.append(row); return; }
    card.memory.signals.forEach((signal) => { const row = create('div'); const copy = create('span', '', signal.targetLabel); copy.append(create('small', '', `${signal.sourceLabel} · ${signal.reason}`)); row.append(copy, create('b', '', `${signal.weight >= 0 ? '+' : ''}${signal.weight}`)); elements.memoryLedger.append(row); });
  }

  function renderActions() {
    const card = projection.selectedCard;
    elements.actionControls.forEach((button) => { button.disabled = !card; button.classList.toggle('is-active', Boolean(card && projection.currentActions.includes(button.dataset.actionType))); });
    elements.actionLedger.replaceChildren();
    const active = projection.actionProjection.candidates.flatMap((candidate) => candidate.activeActions.map((type) => ({ candidate, type })));
    if (!active.length) elements.actionLedger.append(create('p', '', 'No explicit actions. Nothing will happen automatically.'));
    active.slice(0, 8).forEach(({ candidate, type }) => elements.actionLedger.append(create('p', '', `${actionApi.definitions[type].short} · ${candidate.label}`)));
  }

  function renderInbox() {
    elements.inboxDue.textContent = pad(projection.inboxProjection.dueNowCount);
    elements.inboxWaiting.textContent = pad(projection.inboxProjection.waitingCount);
    elements.inboxMuted.textContent = pad(projection.inboxProjection.mutedCount);
    elements.inboxList.replaceChildren();
    projection.inboxProjection.items.slice(0, 8).forEach((item) => { const row = create('div'); const copy = create('span', '', item.label); copy.append(create('small', '', `${actionApi.definitions[item.type].short} · ${item.reason}`)); row.append(copy, create('b', '', item.state.replaceAll('-', ' '))); elements.inboxList.append(row); });
  }

  function renderDelivery() {
    elements.deliveryModes.forEach((select) => { select.value = state.deliveryPolicy.actionModes[select.dataset.deliveryMode]; });
    elements.dailyCap.value = String(state.deliveryPolicy.dailyAlertCap);
    elements.quietHours.checked = state.deliveryPolicy.quietHoursEnabled;
    elements.deliveryLedger.replaceChildren();
    projection.deliveryProjection.decisions.slice(0, 8).forEach((decision) => { const row = create('div'); const item = projection.inboxProjection.items.find((entry) => entry.candidateId === decision.candidateId); const copy = create('span', '', item?.label ?? decision.candidateId); copy.append(create('small', '', decision.reason)); row.append(copy, create('b', '', decision.label)); elements.deliveryLedger.append(row); });
  }

  function renderLinks() {
    elements.routeLinks.forEach((link) => { const href = projection.links[link.dataset.route]; if (href) link.href = href; });
  }

  function render() {
    syncState();
    renderMetrics();
    renderJourney();
    renderCardMap();
    renderCard();
    renderLogic();
    renderBriefingControls();
    renderTrustControls();
    renderMemoryLedger();
    renderActions();
    renderInbox();
    renderDelivery();
    renderLinks();
  }

  function moveCard(offset) {
    if (projection.cards.length < 2) return;
    const index = projection.cards.findIndex((card) => card.id === state.selectedCardId);
    const next = (index + offset + projection.cards.length) % projection.cards.length;
    state.selectedCardId = projection.cards[next].id;
    render();
  }

  function setStage(stage) {
    if (!api.stages.includes(stage)) return;
    state.selectedStage = stage;
    render();
  }

  function toggleAction(type) {
    const card = projection.selectedCard;
    if (!card || !actionApi.actionOrder.includes(type)) return;
    const key = actionApi.keyByType[type];
    const next = api.cloneActions(state.actions);
    const exists = next[key].includes(card.id);
    if (type === 'ignore-pattern') {
      Object.keys(next).forEach((entry) => { next[entry] = next[entry].filter((id) => id !== card.id); });
      if (!exists) next.ignore.push(card.id);
    } else {
      next.ignore = next.ignore.filter((id) => id !== card.id);
      next[key] = exists ? next[key].filter((id) => id !== card.id) : [...next[key], card.id];
    }
    state.actions = actionApi.normalizeSelections(next);
    showToast(exists ? 'Action removed' : 'Action added', exists ? 'The explicit session action was removed.' : actionApi.definitions[type].effect);
    render();
  }

  elements.journey.forEach((button) => button.addEventListener('click', () => setStage(button.dataset.stage)));
  elements.cardPrev.addEventListener('click', () => moveCard(-1));
  elements.cardNext.addEventListener('click', () => moveCard(1));
  [...elements.quickActions, ...elements.actionControls].forEach((button) => button.addEventListener('click', () => toggleAction(button.dataset.quickAction ?? button.dataset.actionType)));
  elements.topicButtons.forEach((button) => button.addEventListener('click', () => {
    const topic = button.dataset.topic;
    const topics = [...state.definition.topics];
    const exists = topics.includes(topic);
    if (exists && topics.length === 1) { showToast('One topic required', 'A finite briefing needs at least one explicit topic.'); return; }
    state.definition.topics = exists ? topics.filter((entry) => entry !== topic) : [...topics, topic];
    render();
  }));
  elements.briefingTime.addEventListener('change', () => { state.definition.deliveryLocalTime = elements.briefingTime.value; render(); });
  elements.maxCards.addEventListener('change', () => {
    const value = Number(elements.maxCards.value);
    if (Number.isSafeInteger(value) && value > 0 && value <= 2147483647) state.definition.maxCards = value;
    else elements.maxCards.value = String(state.definition.maxCards);
    render();
  });
  elements.actionableOnly.addEventListener('change', () => { state.definition.onlyActionable = elements.actionableOnly.checked; render(); });
  elements.trustPresets.forEach((button) => button.addEventListener('click', () => { state.trustPolicy = api.trustPreset(button.dataset.trustPreset); showToast('Trust policy changed', 'The briefing was re-evaluated before ranking.'); render(); }));
  elements.deliveryModes.forEach((select) => select.addEventListener('change', () => { state.deliveryPolicy.actionModes[select.dataset.deliveryMode] = select.value; render(); }));
  elements.dailyCap.addEventListener('change', () => { state.deliveryPolicy.dailyAlertCap = Number(elements.dailyCap.value); render(); });
  elements.quietHours.addEventListener('change', () => { state.deliveryPolicy.quietHoursEnabled = elements.quietHours.checked; render(); });
  elements.reset.addEventListener('click', () => { state = api.defaultState(); showToast('Preview reset', 'All visible Companion defaults were restored.'); render(); });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); moveCard(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); moveCard(1); }
    else if (/^[1-6]$/u.test(event.key)) { event.preventDefault(); setStage(api.stages[Number(event.key) - 1]); }
    else if (event.key.toLowerCase() === 'w') toggleAction('watch-change');
    else if (event.key.toLowerCase() === 'n') toggleAction('remind-next-briefing');
    else if (event.key.toLowerCase() === 'c') toggleAction('compare-next');
  });

  render();
  void hydrateSavedCompanion();
})();
