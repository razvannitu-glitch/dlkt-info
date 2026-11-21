(() => {
  'use strict';

  const api = window.DLKTActionControl;
  if (!api) throw new Error('ACTION_CONTROL_UNAVAILABLE');
  const parsed = api.parseSearch(window.location.search);
  const initial = parsed.state === 'valid' ? api.cloneSelections(parsed.selections) : api.emptySelections();
  const state = { selectedId: api.candidates[0].id, selections: initial, undo: [], toastTimer: null };
  const elements = {
    activeCount: document.querySelector('[data-active-count]'), watchCount: document.querySelector('[data-watch-count]'), oneTimeCount: document.querySelector('[data-one-time-count]'),
    queryState: document.querySelector('[data-query-state]'), candidateList: document.querySelector('[data-candidate-list]'), actionChoiceList: document.querySelector('[data-action-choice-list]'),
    candidateTopic: document.querySelector('[data-candidate-topic]'), candidateLabel: document.querySelector('[data-candidate-label]'), candidateEntity: document.querySelector('[data-candidate-entity]'), candidateTitle: document.querySelector('[data-candidate-title]'), candidateDirect: document.querySelector('[data-candidate-direct]'), candidateMateriality: document.querySelector('[data-candidate-materiality]'), candidateTrust: document.querySelector('[data-candidate-trust]'), candidateKind: document.querySelector('[data-candidate-kind]'), candidateNext: document.querySelector('[data-candidate-next]'),
    attentionState: document.querySelector('[data-attention-state]'), activeActionCount: document.querySelector('[data-active-action-count]'), effectList: document.querySelector('[data-effect-list]'), ledger: document.querySelector('[data-action-ledger]'),
    undo: document.querySelector('[data-undo]'), reset: document.querySelector('[data-reset]'), todayLinks: Array.from(document.querySelectorAll('[data-open-today]')), inboxLinks: Array.from(document.querySelectorAll('[data-open-inbox]')), deliveryLinks: Array.from(document.querySelectorAll('[data-open-delivery]')),
    toast: document.querySelector('[data-toast]'), toastTitle: document.querySelector('[data-toast-title]'), toastCopy: document.querySelector('[data-toast-copy]'),
  };
  const create = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
  const pad = (value) => String(value).padStart(2, '0');

  function snapshot() { return api.cloneSelections(state.selections); }
  function selectedCandidate() { return api.candidates.find((candidate) => candidate.id === state.selectedId) ?? api.candidates[0]; }
  function isActive(candidateId, type) { return state.selections[api.keyByType[type]].includes(candidateId); }
  function activeTypes(candidateId) { return api.actionOrder.filter((type) => isActive(candidateId, type)); }
  function showToast(title, copy) { elements.toastTitle.textContent = title; elements.toastCopy.textContent = copy; elements.toast.hidden = false; window.clearTimeout(state.toastTimer); state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2400); }
  function mutate(operation, title, copy) { state.undo.push(snapshot()); if (state.undo.length > 20) state.undo.shift(); operation(); render(); showToast(title, copy); }

  function toggle(type) {
    const candidateId = state.selectedId;
    const key = api.keyByType[type];
    const currentlyActive = state.selections[key].includes(candidateId);
    mutate(() => {
      if (type === 'ignore-pattern') {
        for (const actionKey of Object.keys(api.typeByKey)) state.selections[actionKey] = state.selections[actionKey].filter((id) => id !== candidateId);
        if (!currentlyActive) state.selections.ignore.push(candidateId);
      } else {
        state.selections.ignore = state.selections.ignore.filter((id) => id !== candidateId);
        state.selections[key] = currentlyActive ? state.selections[key].filter((id) => id !== candidateId) : [...state.selections[key], candidateId];
      }
      state.selections = api.normalizeSelections(state.selections);
    }, currentlyActive ? 'Action removed' : 'Action added', currentlyActive ? 'The explicit action was removed from this session.' : api.definitions[type].effect);
  }

  function updateLinks() {
    const todayHref = api.buildUrl(state.selections, window.location.search, '/today');
    const inboxHref = api.buildUrl(state.selections, window.location.search, '/inbox');
    const deliveryHref = api.buildUrl(state.selections, window.location.search, '/delivery');
    elements.todayLinks.forEach((link) => { link.href = todayHref; });
    elements.inboxLinks.forEach((link) => { link.href = inboxHref; });
    elements.deliveryLinks.forEach((link) => { link.href = deliveryHref; });
  }

  function renderMetrics(projection) {
    elements.activeCount.textContent = pad(projection.activeActionCount);
    elements.watchCount.textContent = pad(projection.watchedCandidateCount);
    elements.oneTimeCount.textContent = pad(projection.oneTimeActionCount);
    elements.queryState.textContent = parsed.state === 'valid' ? 'Imported from Today' : parsed.state === 'invalid' ? 'Unsafe action link ignored' : 'No imported actions';
  }

  function renderCandidates(projection) {
    elements.candidateList.replaceChildren();
    projection.candidates.forEach((candidate, index) => {
      const button = create('button', `candidate-row${candidate.id === state.selectedId ? ' is-selected' : ''}`);
      button.type = 'button'; button.dataset.candidateId = candidate.id; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(candidate.id === state.selectedId));
      const number = create('span', '', pad(index + 1)); const copy = create('div'); copy.append(create('strong', '', candidate.label), create('small', '', `${candidate.topic} · ${candidate.entity}`));
      const status = create('b', '', candidate.activeActions.length ? `${candidate.activeActions.length} active` : 'No action'); button.append(number, copy, status);
      button.addEventListener('click', () => { state.selectedId = candidate.id; render(); }); elements.candidateList.append(button);
    });
  }

  function renderInspector(projection) {
    const candidate = projection.candidates.find((item) => item.id === state.selectedId) ?? projection.candidates[0];
    elements.candidateTopic.textContent = candidate.topic; elements.candidateLabel.textContent = candidate.label; elements.candidateEntity.textContent = candidate.entity; elements.candidateTitle.textContent = candidate.title; elements.candidateDirect.textContent = candidate.direct; elements.candidateMateriality.textContent = candidate.materiality; elements.candidateTrust.textContent = candidate.trust; elements.candidateKind.textContent = candidate.kind; elements.candidateNext.textContent = candidate.nextSignal;
    elements.attentionState.textContent = candidate.attentionState === 'none' ? 'NO ACTION' : candidate.attentionState.toUpperCase();
    elements.activeActionCount.textContent = `${candidate.activeActions.length} active`;
    elements.effectList.replaceChildren();
    if (!candidate.activeActions.length) elements.effectList.append(create('p', '', 'No action changes the next briefing yet.'));
    else candidate.activeActions.forEach((type) => { const row = create('div', 'effect-row'); row.append(create('b', '', api.definitions[type].short), create('p', '', api.definitions[type].effect)); elements.effectList.append(row); });
  }

  function renderControls() {
    const candidate = selectedCandidate(); elements.actionChoiceList.replaceChildren();
    api.actionOrder.forEach((type) => {
      const definition = api.definitions[type]; const active = isActive(candidate.id, type); const button = create('button', `action-choice${active ? ' is-active' : ''}`); button.type = 'button'; button.dataset.actionType = type; button.setAttribute('aria-pressed', String(active));
      const key = create('span', '', definition.key); const copy = create('div'); copy.append(create('strong', '', definition.label), create('small', '', definition.effect)); button.append(key, copy, create('b', '', active ? 'Active' : definition.mode)); button.addEventListener('click', () => toggle(type)); elements.actionChoiceList.append(button);
    });
    elements.undo.disabled = state.undo.length === 0;
  }

  function renderLedger(projection) {
    elements.ledger.replaceChildren(); const active = projection.candidates.filter((candidate) => candidate.activeActions.length > 0);
    if (!active.length) { elements.ledger.append(create('p', 'ledger-empty', 'No actions selected. Nothing will happen automatically.')); return; }
    active.forEach((candidate) => candidate.activeActions.forEach((type) => {
      const definition = api.definitions[type]; const card = create('article', 'ledger-card'); card.dataset.ledgerCandidate = candidate.id; card.append(create('span', '', `${definition.mode} · ${candidate.topic}`), create('strong', '', `${definition.short} · ${candidate.label}`), create('p', '', definition.effect));
      const remove = create('button', '', 'Remove action'); remove.type = 'button'; remove.addEventListener('click', () => { state.selectedId = candidate.id; toggle(type); }); card.append(remove); elements.ledger.append(card);
    }));
  }

  function render() { const projection = api.project(state.selections); renderMetrics(projection); renderCandidates(projection); renderInspector(projection); renderControls(); renderLedger(projection); updateLinks(); }

  elements.undo.addEventListener('click', () => { const previous = state.undo.pop(); if (!previous) return; state.selections = previous; render(); showToast('Last change undone', 'The previous action projection was restored.'); });
  elements.reset.addEventListener('click', () => mutate(() => { state.selections = api.emptySelections(); }, 'Actions reset', 'Every session action was cleared.'));
  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const index = api.candidates.findIndex((candidate) => candidate.id === state.selectedId);
    if (event.key.toLowerCase() === 'j') { event.preventDefault(); state.selectedId = api.candidates[(index + 1) % api.candidates.length].id; render(); }
    if (event.key.toLowerCase() === 'k') { event.preventDefault(); state.selectedId = api.candidates[(index - 1 + api.candidates.length) % api.candidates.length].id; render(); }
    const shortcut = { w: 'watch-change', n: 'remind-next-briefing', c: 'compare-next', x: 'mark-resolved', i: 'ignore-pattern' }[event.key.toLowerCase()];
    if (shortcut) { event.preventDefault(); toggle(shortcut); }
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); elements.undo.click(); }
  });
  render();
})();
