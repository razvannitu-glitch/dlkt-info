(() => {
  'use strict';
  const data = window.DLKTMemoryControlData;
  if (!data || data.synthetic !== true || !Array.isArray(data.candidates) || !Array.isArray(data.signals)) return;

  const originalSignals = data.signals.map((signal) => ({ ...signal, defaultWeight: signal.weight }));
  const allowedCards = new Set(data.candidates.map((candidate) => candidate.id));
  const params = new URLSearchParams(window.location.search);
  const queryKeys = ['relevant', 'less', 'follow'];
  let queryState = 'Canonical synthetic memory';

  const parseList = (key) => {
    const values = params.getAll(key);
    if (values.length > 1) throw new Error('MEMORY_QUERY_DUPLICATE');
    if (values.length === 0 || values[0] === '') return [];
    const items = values[0].split(',');
    if (items.length > 6 || new Set(items).size !== items.length || items.some((item) => !allowedCards.has(item))) {
      throw new Error('MEMORY_QUERY_INVALID');
    }
    return items;
  };

  try {
    const selections = Object.fromEntries(queryKeys.map((key) => [key, parseList(key)]));
    if (queryKeys.some((key) => selections[key].length > 0)) {
      originalSignals.forEach((signal) => {
        if (signal.source === 'relevant-feedback') signal.active = selections.relevant.includes(signal.originCardId);
        if (signal.source === 'less-like-feedback') signal.active = selections.less.includes(signal.originCardId);
        if (signal.source === 'followed-entity') signal.active = selections.follow.includes(signal.originCardId);
      });
      queryState = 'Session feedback imported from Today';
    }
  } catch {
    queryState = 'Invalid feedback link ignored · canonical preview restored';
  }

  const initialSignals = originalSignals.map((signal) => ({ ...signal }));
  const state = {
    signals: initialSignals.map((signal) => ({ ...signal })),
    selectedSignalId: initialSignals[0].id,
    selectedCandidateId: data.candidates[0].id,
    filter: 'all',
    undo: [],
    toastTimer: null,
  };

  const elements = {
    activeCount: document.querySelector('[data-active-count]'), netEffect: document.querySelector('[data-net-effect]'),
    signalCount: document.querySelector('[data-signal-count]'), signalList: document.querySelector('[data-signal-list]'),
    filters: Array.from(document.querySelectorAll('[data-signal-filter]')), rankingList: document.querySelector('[data-ranking-list]'),
    queryState: document.querySelector('[data-query-state]'), candidateTopic: document.querySelector('[data-candidate-topic]'),
    candidateLabel: document.querySelector('[data-candidate-label]'), candidateRank: document.querySelector('[data-candidate-rank]'),
    candidateBase: document.querySelector('[data-candidate-base]'), candidateMemory: document.querySelector('[data-candidate-memory]'),
    candidateTotal: document.querySelector('[data-candidate-total]'), candidateMove: document.querySelector('[data-candidate-move]'),
    appliedCount: document.querySelector('[data-applied-count]'), appliedList: document.querySelector('[data-applied-list]'),
    controlTarget: document.querySelector('[data-control-target]'), controlSource: document.querySelector('[data-control-source]'),
    controlEffect: document.querySelector('[data-control-effect]'), controlReason: document.querySelector('[data-control-reason]'),
    controlImpact: document.querySelector('[data-control-impact]'), toggle: document.querySelector('[data-toggle-signal]'),
    toggleCopy: document.querySelector('[data-toggle-copy]'), strength: Array.from(document.querySelectorAll('[data-strength]')),
    undo: document.querySelector('[data-undo]'), reset: document.querySelector('[data-reset]'),
    toast: document.querySelector('[data-toast]'), toastTitle: document.querySelector('[data-toast-title]'), toastCopy: document.querySelector('[data-toast-copy]'),
  };

  const create = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
  const signed = (value) => `${value > 0 ? '+' : ''}${value}`;
  const selectedSignal = () => state.signals.find((signal) => signal.id === state.selectedSignalId) ?? state.signals[0];
  const signalApplies = (signal, candidate) => signal.active && ((signal.targetType === 'topic' && signal.targetId === candidate.topicId)
    || (signal.targetType === 'entity' && signal.targetId === candidate.entityId)
    || (signal.targetType === 'kind' && signal.targetId === candidate.kind));

  const projection = () => data.candidates.map((candidate) => {
    const applied = state.signals.filter((signal) => signalApplies(signal, candidate));
    const memory = applied.reduce((sum, signal) => sum + signal.weight, 0);
    return { ...candidate, memory, total: candidate.baseScore + memory, applied };
  }).sort((left, right) => right.total - left.total || right.baseScore - left.baseScore || left.id.localeCompare(right.id))
    .map((candidate, index) => ({ ...candidate, projectedRank: index + 1, rankDelta: candidate.baselineRank - (index + 1) }));

  function showToast(title, copy) {
    window.clearTimeout(state.toastTimer); elements.toastTitle.textContent = title; elements.toastCopy.textContent = copy;
    elements.toast.hidden = false; state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2400);
  }

  function snapshot() {
    state.undo.push(state.signals.map((signal) => ({ id: signal.id, active: signal.active, weight: signal.weight })));
    if (state.undo.length > 20) state.undo.shift();
    elements.undo.disabled = false;
  }

  function filteredSignals() {
    if (state.filter === 'up') return state.signals.filter((signal) => signal.active && signal.weight > 0);
    if (state.filter === 'down') return state.signals.filter((signal) => signal.active && signal.weight < 0);
    if (state.filter === 'off') return state.signals.filter((signal) => !signal.active);
    return state.signals;
  }

  function renderStats() {
    const active = state.signals.filter((signal) => signal.active);
    const net = active.reduce((sum, signal) => sum + signal.weight, 0);
    elements.activeCount.textContent = String(active.length).padStart(2, '0');
    elements.netEffect.textContent = signed(net);
    elements.signalCount.textContent = String(filteredSignals().length);
    elements.queryState.textContent = queryState;
  }

  function renderSignals() {
    elements.signalList.replaceChildren();
    const list = filteredSignals();
    list.forEach((signal) => {
      const button = create('button', 'signal-row'); button.type = 'button'; button.dataset.signalId = signal.id;
      button.classList.toggle('is-selected', signal.id === state.selectedSignalId); button.classList.toggle('is-off', !signal.active);
      button.setAttribute('aria-pressed', String(signal.active));
      const copy = create('span'); copy.append(create('span', '', signal.sourceLabel), create('strong', '', signal.targetLabel), create('small', '', signal.active ? 'Active in next briefing' : 'Disabled'));
      const effect = create('b', signal.weight < 0 ? 'is-down' : '', signal.active ? signed(signal.weight) : 'OFF');
      button.append(copy, effect); button.addEventListener('click', () => { state.selectedSignalId = signal.id; render(); });
      elements.signalList.append(button);
    });
    if (!list.length) elements.signalList.append(create('p', 'empty-signals', 'No signals match this filter.'));
  }

  function renderRanking() {
    const ranked = projection(); const maximum = Math.max(...ranked.map((candidate) => candidate.total), 1);
    elements.rankingList.replaceChildren();
    ranked.forEach((candidate) => {
      const button = create('button', 'ranking-row'); button.type = 'button'; button.dataset.candidateId = candidate.id;
      button.classList.toggle('is-selected', candidate.id === state.selectedCandidateId);
      const rank = create('span', '', String(candidate.projectedRank).padStart(2, '0'));
      const copy = create('span', 'ranking-copy'); copy.append(create('strong', '', candidate.label), create('small', '', `${candidate.topic} · ${candidate.entity}`));
      const track = create('span', 'score-track'); const fill = create('i'); fill.style.width = `${Math.max(8, Math.round((candidate.total / maximum) * 100))}%`; track.append(fill);
      const memory = create('span', `rank-memory${candidate.memory < 0 ? ' is-down' : ''}`, signed(candidate.memory));
      const moveText = candidate.rankDelta > 0 ? `↑ ${candidate.rankDelta}` : candidate.rankDelta < 0 ? `↓ ${Math.abs(candidate.rankDelta)}` : '—';
      const move = create('span', `rank-move${candidate.rankDelta > 0 ? ' is-up' : ''}`, moveText);
      button.append(rank, copy, track, memory, move); button.addEventListener('click', () => { state.selectedCandidateId = candidate.id; render(); });
      elements.rankingList.append(button);
    });
    renderCandidate(ranked);
  }

  function renderCandidate(ranked) {
    const candidate = ranked.find((item) => item.id === state.selectedCandidateId) ?? ranked[0];
    state.selectedCandidateId = candidate.id;
    elements.candidateTopic.textContent = candidate.topic; elements.candidateLabel.textContent = candidate.label;
    elements.candidateRank.textContent = `#${String(candidate.projectedRank).padStart(2, '0')}`;
    elements.candidateBase.textContent = String(candidate.baseScore); elements.candidateMemory.textContent = signed(candidate.memory);
    elements.candidateTotal.textContent = String(candidate.total);
    elements.candidateMove.textContent = candidate.rankDelta > 0 ? `Up ${candidate.rankDelta}` : candidate.rankDelta < 0 ? `Down ${Math.abs(candidate.rankDelta)}` : `Stays #${candidate.projectedRank}`;
    elements.appliedCount.textContent = String(candidate.applied.length); elements.appliedList.replaceChildren();
    candidate.applied.forEach((signal) => {
      const row = create('div', 'applied-row'); const copy = create('div'); copy.append(create('strong', '', signal.targetLabel), create('span', '', signal.sourceLabel));
      row.append(copy, create('b', '', signed(signal.weight))); elements.appliedList.append(row);
    });
    if (!candidate.applied.length) elements.appliedList.append(create('p', 'empty-applied', 'No memory signal affects this card. Its rank comes only from factual relevance.'));
  }

  function strengthFor(signal) {
    const ratio = Math.abs(signal.weight / signal.defaultWeight);
    return ratio < .76 ? 'low' : ratio > 1.24 ? 'strong' : 'standard';
  }

  function renderControl() {
    const signal = selectedSignal();
    elements.controlTarget.textContent = signal.targetLabel; elements.controlSource.textContent = signal.sourceLabel;
    elements.controlEffect.textContent = signal.active ? signed(signal.weight) : 'OFF'; elements.controlReason.textContent = signal.reason;
    elements.controlImpact.textContent = `This signal ${signal.weight >= 0 ? 'raises' : 'lowers'} cards matching ${signal.targetLabel} in the next briefing preview.`;
    elements.toggle.setAttribute('aria-pressed', String(signal.active)); elements.toggleCopy.textContent = signal.active ? 'Signal active' : 'Signal disabled';
    const currentStrength = strengthFor(signal); elements.strength.forEach((button) => button.classList.toggle('is-active', button.dataset.strength === currentStrength));
  }

  function render() { renderStats(); renderSignals(); renderRanking(); renderControl(); elements.undo.disabled = state.undo.length === 0; }

  function mutate(mutator, title) { snapshot(); mutator(); render(); showToast(title, 'The next briefing preview was recalculated.'); }

  elements.filters.forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.signalFilter; elements.filters.forEach((item) => { item.classList.toggle('is-active', item === button); item.setAttribute('aria-selected', String(item === button)); }); render();
  }));
  elements.toggle.addEventListener('click', () => mutate(() => { selectedSignal().active = !selectedSignal().active; }, selectedSignal().active ? 'Signal disabled' : 'Signal activated'));
  elements.strength.forEach((button) => button.addEventListener('click', () => {
    const signal = selectedSignal(); const factor = button.dataset.strength === 'low' ? .5 : button.dataset.strength === 'strong' ? 1.5 : 1;
    mutate(() => { const sign = signal.defaultWeight < 0 ? -1 : 1; signal.weight = sign * Math.min(50, Math.max(1, Math.round(Math.abs(signal.defaultWeight) * factor))); signal.active = true; }, 'Signal strength updated');
  }));
  elements.undo.addEventListener('click', () => {
    const previous = state.undo.pop(); if (!previous) return;
    previous.forEach((item) => { const signal = state.signals.find((candidate) => candidate.id === item.id); if (signal) { signal.active = item.active; signal.weight = item.weight; } });
    render(); showToast('Last change undone', 'The previous memory projection was restored.');
  });
  elements.reset.addEventListener('click', () => {
    snapshot(); state.signals = initialSignals.map((signal) => ({ ...signal })); state.selectedSignalId = state.signals[0].id; state.selectedCandidateId = data.candidates[0].id;
    render(); showToast('Preview reset', 'All synthetic memory signals returned to their initial state.');
  });
  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) return;
    const list = filteredSignals(); const index = Math.max(0, list.findIndex((signal) => signal.id === state.selectedSignalId));
    if (event.key.toLowerCase() === 'j') { state.selectedSignalId = list[Math.min(list.length - 1, index + 1)]?.id ?? state.selectedSignalId; render(); }
    if (event.key.toLowerCase() === 'k') { state.selectedSignalId = list[Math.max(0, index - 1)]?.id ?? state.selectedSignalId; render(); }
    if (event.key === ' ') { event.preventDefault(); elements.toggle.click(); }
    if (event.key.toLowerCase() === 'z') elements.undo.click();
  });
  render();
})();
