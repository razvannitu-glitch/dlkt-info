(() => {
  'use strict';

  const api = window.DLKTTrustControl;
  if (!api) return;

  const parsed = api.parseSearch(window.location.search);
  const policy = { ...(parsed.state === 'valid' ? parsed.policy : api.defaultPolicy) };
  const state = { policy, selectedId: api.candidates[0].id, toastTimer: null };

  const elements = {
    form: document.querySelector('[data-trust-form]'),
    controls: Array.from(document.querySelectorAll('[data-policy-control]')),
    policyState: document.querySelector('[data-policy-state]'),
    policyWarning: document.querySelector('[data-policy-warning]'),
    apply: document.querySelector('[data-apply-policy]'),
    todayLinks: Array.from(document.querySelectorAll('[data-today-link]')),
    reset: document.querySelector('[data-reset-policy]'),
    totalCount: document.querySelector('[data-total-count]'),
    includedCount: document.querySelector('[data-included-count]'),
    excludedCount: document.querySelector('[data-excluded-count]'),
    conflictCount: document.querySelector('[data-conflict-count]'),
    projectionSummary: document.querySelector('[data-projection-summary]'),
    projectionList: document.querySelector('[data-projection-list]'),
    selectedTitle: document.querySelector('[data-selected-title]'),
    selectedDecision: document.querySelector('[data-selected-decision]'),
    selectedTopic: document.querySelector('[data-selected-topic]'),
    selectedHeadline: document.querySelector('[data-selected-headline]'),
    selectedEntity: document.querySelector('[data-selected-entity]'),
    selectedTrust: document.querySelector('[data-selected-trust]'),
    selectedMateriality: document.querySelector('[data-selected-materiality]'),
    selectedAge: document.querySelector('[data-selected-age]'),
    selectedSourceCount: document.querySelector('[data-selected-source-count]'),
    selectedSources: document.querySelector('[data-selected-sources]'),
    selectedReasons: document.querySelector('[data-selected-reasons]'),
    toast: document.querySelector('[data-toast]'),
    toastTitle: document.querySelector('[data-toast-title]'),
    toastCopy: document.querySelector('[data-toast-copy]'),
  };

  const create = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const titleCase = (value) => String(value).split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
  const pad = (value) => String(value).padStart(2, '0');

  function readPolicy() {
    const data = new FormData(elements.form);
    return api.normalizePolicy({
      minimumTrust: data.get('minimumTrust'),
      conflictPolicy: data.get('conflictPolicy'),
      authorityRequirement: data.get('authorityRequirement'),
      minimumSources: Number(data.get('minimumSources')),
      maximumEvidenceAgeHours: Number(data.get('maximumEvidenceAgeHours')),
      requireOfficialForHighImpact: data.get('requireOfficialForHighImpact') === 'on',
    });
  }

  function writePolicy(value) {
    for (const control of elements.controls) {
      if (control.type === 'checkbox') control.checked = Boolean(value[control.name]);
      else control.value = String(value[control.name]);
    }
  }

  function formatAge(hours) {
    if (hours < 1) return `${Math.round(hours * 60)} min`;
    return `${hours % 1 === 0 ? hours : hours.toFixed(1)} h`;
  }

  function policyName(value) {
    if (value.minimumTrust === 'confirmed' && value.authorityRequirement === 'official') return 'Official-only strict briefing';
    if (value.minimumTrust === 'single-source' && value.conflictPolicy === 'include-warning') return 'Exploratory briefing with warnings';
    return 'Balanced verified briefing';
  }

  function showToast(title, copy) {
    clearTimeout(state.toastTimer);
    elements.toastTitle.textContent = title;
    elements.toastCopy.textContent = copy;
    elements.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2600);
  }

  function renderProjection(projection) {
    elements.projectionList.replaceChildren();
    api.candidates.forEach((candidate, index) => {
      const decision = projection.decisions.find((item) => item.candidateId === candidate.id);
      const button = create('button', `projection-card ${decision.included ? 'is-included' : 'is-excluded'}${candidate.id === state.selectedId ? ' is-selected' : ''}`);
      button.type = 'button';
      button.dataset.candidateId = candidate.id;
      button.setAttribute('aria-pressed', String(candidate.id === state.selectedId));
      const number = create('span', 'projection-index', pad(index + 1));
      const copy = create('span', 'projection-copy');
      copy.append(create('span', '', `${candidate.topic} · ${titleCase(candidate.trust)}`));
      copy.append(create('strong', '', candidate.title));
      copy.append(create('p', '', decision.included
        ? (decision.warnings[0] ?? 'Meets every active trust rule.')
        : decision.blockingReasons[0]));
      const status = create('span', 'projection-decision', decision.included ? 'Included' : 'Held back');
      button.append(number, copy, status);
      button.addEventListener('click', () => { state.selectedId = candidate.id; render(); });
      elements.projectionList.append(button);
    });
  }

  function renderSelected(projection) {
    const candidate = api.candidateById[state.selectedId] ?? api.candidates[0];
    const decision = projection.decisions.find((item) => item.candidateId === candidate.id);
    elements.selectedTitle.textContent = candidate.label;
    elements.selectedDecision.textContent = decision.included ? 'Included' : 'Held back';
    elements.selectedDecision.classList.toggle('is-excluded', !decision.included);
    elements.selectedTopic.textContent = candidate.topic;
    elements.selectedHeadline.textContent = candidate.title;
    elements.selectedEntity.textContent = candidate.entity;
    elements.selectedTrust.textContent = titleCase(candidate.trust);
    elements.selectedMateriality.textContent = titleCase(candidate.materiality);
    elements.selectedAge.textContent = formatAge(candidate.evidenceAgeHours);
    elements.selectedSourceCount.textContent = String(candidate.sources.length);

    elements.selectedSources.replaceChildren();
    candidate.sources.forEach((source, index) => {
      const row = create('div', 'source-row');
      row.append(create('span', '', pad(index + 1)));
      const copy = create('span');
      copy.append(create('strong', '', source.label), create('small', '', `${titleCase(source.authority)} source`));
      row.append(copy, create('span', 'authority-mark', titleCase(source.authority)));
      elements.selectedSources.append(row);
    });

    elements.selectedReasons.replaceChildren();
    const reasons = decision.included
      ? [...(decision.warnings.length ? decision.warnings : ['Meets every active trust rule.'])]
      : decision.blockingReasons;
    reasons.forEach((reason) => elements.selectedReasons.append(create('li', decision.included ? '' : 'is-blocked', reason)));
  }

  function render() {
    const projection = api.project(state.policy);
    elements.totalCount.textContent = pad(api.candidates.length);
    elements.includedCount.textContent = pad(projection.includedIds.length);
    elements.excludedCount.textContent = pad(projection.excludedIds.length);
    elements.conflictCount.textContent = pad(api.candidates.filter((candidate) => candidate.trust === 'conflicting').length);
    elements.projectionSummary.textContent = `${projection.includedIds.length} included · ${projection.excludedIds.length} held back`;
    elements.policyState.textContent = policyName(state.policy);
    const todayUrl = api.buildTodayUrl(state.policy, window.location.search);
    elements.apply.href = todayUrl;
    elements.todayLinks.forEach((link) => { link.href = todayUrl; });
    renderProjection(projection);
    renderSelected(projection);
  }

  writePolicy(state.policy);
  elements.policyWarning.hidden = parsed.state !== 'invalid';
  elements.controls.forEach((control) => control.addEventListener('change', () => {
    state.policy = { ...readPolicy() };
    render();
    showToast('Policy updated', 'The finite briefing projection was recalculated.');
  }));
  elements.reset.addEventListener('click', () => {
    state.policy = { ...api.defaultPolicy };
    writePolicy(state.policy);
    render();
    showToast('Balanced policy restored', 'No hidden rule was retained.');
  });
  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
    const index = api.candidates.findIndex((candidate) => candidate.id === state.selectedId);
    if (event.key.toLowerCase() === 'j') { event.preventDefault(); state.selectedId = api.candidates[(index + 1) % api.candidates.length].id; render(); }
    if (event.key.toLowerCase() === 'k') { event.preventDefault(); state.selectedId = api.candidates[(index - 1 + api.candidates.length) % api.candidates.length].id; render(); }
  });
  render();
})();
