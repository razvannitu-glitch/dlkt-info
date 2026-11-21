(() => {
  'use strict';

  const bridge = window.DLKTCompanionBridge;
  const trust = window.DLKTTrustControl;
  const actions = window.DLKTActionControl;
  if (!bridge || !trust || !actions) throw new Error('FIRST_RUN_DEPENDENCY_UNAVAILABLE');

  const VERSION = 'dlkt-info-first-run-activation-1';
  const STEPS = Object.freeze(['interests', 'trust', 'delivery', 'preview']);
  const STEP_COPY = Object.freeze({
    interests: Object.freeze({ kicker: '01 · Interests', title: 'Tell it what matters.', explanation: 'Choose broad domains, then add the exact companies, products, laws or places you want followed.' }),
    trust: Object.freeze({ kicker: '02 · Trust', title: 'Choose what qualifies.', explanation: 'Evidence policy is explicit. Change it any time without changing the underlying facts.' }),
    delivery: Object.freeze({ kicker: '03 · Delivery', title: 'Set an attention budget.', explanation: 'Choose one local time and the finite number of cards you want in each briefing.' }),
    preview: Object.freeze({ kicker: '04 · Preview', title: 'Inspect the contract.', explanation: 'Review every active rule before entering the Companion.' }),
  });
  const TRUST_PRESETS = Object.freeze({
    strict: Object.freeze({ minimumTrust: 'confirmed', conflictPolicy: 'exclude', authorityRequirement: 'official', minimumSources: 2, maximumEvidenceAgeHours: 24, requireOfficialForHighImpact: true }),
    balanced: Object.freeze({ minimumTrust: 'corroborated', conflictPolicy: 'exclude', authorityRequirement: 'primary', minimumSources: 2, maximumEvidenceAgeHours: 72, requireOfficialForHighImpact: true }),
    open: Object.freeze({ minimumTrust: 'single-source', conflictPolicy: 'include-warning', authorityRequirement: 'reputable-secondary', minimumSources: 1, maximumEvidenceAgeHours: 168, requireOfficialForHighImpact: false }),
  });
  const TRUST_COPY = Object.freeze({
    strict: 'Confirmed information from official sources, backed by two sources and no active conflict.',
    balanced: 'Corroborated or confirmed information from primary or official sources. Active contradictions are excluded.',
    open: 'Single-source signals may enter, and contradictions remain visible with an explicit warning.',
  });
  const MATERIALITY = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
  const state = {
    step: 0,
    topics: ['technology', 'regulation', 'opportunities'],
    entities: [],
    trustPreset: 'balanced',
    minMateriality: 'medium',
    onlyActionable: false,
    timezone: 'Europe/Bucharest',
    deliveryLocalTime: '08:00',
    maxCards: 6,
    identityBusy: false,
    accountActivated: false,
    challengeEmail: '',
    persistedBriefingId: null,
    identity: { configured: false, enabled: false, authenticated: false, user: null, blocker: null },
  };
  let toastTimer = null;

  const elements = {
    stepButtons: Array.from(document.querySelectorAll('[data-step-button]')),
    panels: Array.from(document.querySelectorAll('[data-step-panel]')),
    topicButtons: Array.from(document.querySelectorAll('[data-topic]')),
    entityForm: document.querySelector('[data-entity-form]'),
    entityInput: document.querySelector('[data-entity-input]'),
    entityFeedback: document.querySelector('[data-entity-feedback]'),
    entityCount: document.querySelector('[data-entity-count]'),
    entityChips: document.querySelector('[data-entity-chips]'),
    entitySuggestions: Array.from(document.querySelectorAll('[data-entity-suggestion]')),
    trustPresets: Array.from(document.querySelectorAll('[data-trust-preset]')),
    minMateriality: document.querySelector('[data-min-materiality]'),
    actionableOnly: document.querySelector('[data-actionable-only]'),
    trustProof: document.querySelector('[data-trust-proof]'),
    timezone: document.querySelector('[data-timezone]'),
    deliveryTime: document.querySelector('[data-delivery-time]'),
    cardLimit: document.querySelector('[data-card-limit]'),
    deliverySummary: document.querySelector('[data-delivery-summary]'),
    timezoneSummary: document.querySelector('[data-timezone-summary]'),
    stepKicker: document.querySelector('[data-step-kicker]'),
    stepTitle: document.querySelector('[data-step-title]'),
    stepExplanation: document.querySelector('[data-step-explanation]'),
    stepPosition: document.querySelector('[data-step-position]'),
    progressFill: document.querySelector('[data-progress-fill]'),
    back: document.querySelector('[data-back]'),
    next: document.querySelector('[data-next]'),
    launch: document.querySelector('[data-launch]'),
    saveOpen: document.querySelector('[data-save-open]'),
    accountStatus: document.querySelector('[data-account-status]'),
    accountEmailForm: document.querySelector('[data-account-email-form]'),
    accountEmail: document.querySelector('[data-account-email]'),
    accountCodeForm: document.querySelector('[data-account-code-form]'),
    accountCode: document.querySelector('[data-account-code]'),
    changeEmail: document.querySelector('[data-change-email]'),
    accountSignedIn: document.querySelector('[data-account-signed-in]'),
    accountUser: document.querySelector('[data-account-user]'),
    accountSignOut: document.querySelector('[data-account-sign-out]'),
    metricTopics: document.querySelector('[data-metric-topics]'),
    metricEntities: document.querySelector('[data-metric-entities]'),
    metricCards: document.querySelector('[data-metric-cards]'),
    railTopics: document.querySelector('[data-rail-topics]'),
    railEntities: document.querySelector('[data-rail-entities]'),
    railTrust: document.querySelector('[data-rail-trust]'),
    railTime: document.querySelector('[data-rail-time]'),
    railMax: document.querySelector('[data-rail-max]'),
    resultLine: document.querySelector('[data-result-line]'),
    resultExplanation: document.querySelector('[data-result-explanation]'),
    resultCount: document.querySelector('[data-result-count]'),
    summaryTopics: document.querySelector('[data-summary-topics]'),
    summaryEntities: document.querySelector('[data-summary-entities]'),
    summaryTrust: document.querySelector('[data-summary-trust]'),
    summaryDelivery: document.querySelector('[data-summary-delivery]'),
    toast: document.querySelector('[data-toast]'),
    toastTitle: document.querySelector('[data-toast-title]'),
    toastCopy: document.querySelector('[data-toast-copy]'),
  };
  if (Object.values(elements).some((value) => value === null)) throw new Error('FIRST_RUN_DOM_INCOMPLETE');

  const pad = (value) => String(value).padStart(2, '0');
  const title = (value) => value.charAt(0).toUpperCase() + value.slice(1);
  const create = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };

  const sameArray = (left, right) => Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => value === right[index]);
  const sameTrustPolicy = (left, right) => Boolean(left && right
    && left.minimumTrust === right.minimumTrust
    && left.conflictPolicy === right.conflictPolicy
    && left.authorityRequirement === right.authorityRequirement
    && left.minimumSources === right.minimumSources
    && left.maximumEvidenceAgeHours === right.maximumEvidenceAgeHours
    && left.requireOfficialForHighImpact === right.requireOfficialForHighImpact);

  function identityProjection(payload) {
    if (!payload || typeof payload !== 'object' || payload.version !== 'dlkt-info-identity-1'
        || typeof payload.configured !== 'boolean' || typeof payload.enabled !== 'boolean'
        || typeof payload.authenticated !== 'boolean') return null;
    const user = payload.authenticated && payload.user && typeof payload.user === 'object'
      && typeof payload.user.id === 'string' && typeof payload.user.email === 'string'
      ? { id: payload.user.id, email: payload.user.email }
      : null;
    if (payload.authenticated && !user) return null;
    return {
      configured: payload.configured,
      enabled: payload.enabled,
      authenticated: payload.authenticated,
      blocker: typeof payload.blocker === 'string' ? payload.blocker : null,
      user,
    };
  }

  async function identityRequest(method, body = null) {
    const headers = { Accept: 'application/json', 'X-DLKT-Info-Request': 'identity-v1' };
    if (body !== null) headers['Content-Type'] = 'application/json';
    const response = await fetch('/api/auth', {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? 'IDENTITY_REQUEST_FAILED');
    return payload;
  }

  function setAccountMessage(message, error = false) {
    elements.accountStatus.textContent = message;
    elements.accountStatus.classList.toggle('is-error', error);
  }

  function renderAccount(message = '') {
    const enabled = state.identity.enabled === true;
    const authenticated = state.identity.authenticated === true;
    const activeSignIn = state.accountActivated && enabled && !authenticated;
    elements.saveOpen.disabled = state.identityBusy || !enabled;
    const label = elements.saveOpen.querySelector('span');
    if (label) label.textContent = state.identityBusy
      ? 'Working…'
      : authenticated ? 'Save & open Companion' : enabled ? 'Sign in & save' : 'Cross-device save unavailable';
    elements.accountEmailForm.hidden = !activeSignIn || Boolean(state.challengeEmail);
    elements.accountCodeForm.hidden = !activeSignIn || !state.challengeEmail;
    elements.accountSignedIn.hidden = !authenticated;
    elements.accountUser.textContent = authenticated ? state.identity.user.email : '';
    if (message) setAccountMessage(message);
    else if (authenticated) setAccountMessage('Authenticated. This exact contract can now be saved and opened.');
    else if (enabled) setAccountMessage('Secure email verification is available. No preference must be re-entered.');
    else setAccountMessage('Cross-device persistence remains closed until the dedicated DLKT database is active.');
  }

  async function loadIdentity() {
    try {
      const projection = identityProjection(await identityRequest('GET'));
      if (!projection) throw new Error('IDENTITY_STATUS_INVALID');
      state.identity = projection;
      renderAccount();
    } catch {
      state.identity = { configured: false, enabled: false, authenticated: false, user: null, blocker: 'IDENTITY_STATUS_UNAVAILABLE' };
      renderAccount('Secure account status could not be verified.', true);
    }
  }

  async function requestIdentityCode() {
    if (state.identityBusy || !state.identity.enabled) return;
    const email = elements.accountEmail.value.trim();
    if (!email) { setAccountMessage('Enter a valid email.', true); elements.accountEmail.focus(); return; }
    state.identityBusy = true;
    renderAccount('Sending one-time code…');
    try {
      await identityRequest('POST', { action: 'request-code', email, timezone: state.timezone, locale: 'en' });
      state.challengeEmail = email;
      renderAccount(`Code sent to ${email}.`);
      window.requestAnimationFrame(() => elements.accountCode.focus());
    } catch {
      renderAccount('The one-time code could not be sent.', true);
    } finally {
      state.identityBusy = false;
      renderAccount(elements.accountStatus.textContent);
    }
  }

  function savedProjectionMatches(payload, pref, policy) {
    return Boolean(payload && typeof payload === 'object' && payload.version === 'dlkt-info-persistence-2'
      && payload.briefing && payload.rule && payload.trustPolicy
      && payload.briefing.timezone === pref.timezone
      && payload.briefing.deliveryLocalTime === pref.deliveryLocalTime
      && payload.briefing.maxCards === pref.maxCards
      && sameArray(payload.rule.topics, pref.topics)
      && sameArray(payload.rule.entities, pref.entities)
      && payload.rule.minMateriality === pref.minMateriality
      && payload.rule.onlyActionable === pref.onlyActionable
      && sameTrustPolicy(payload.trustPolicy, policy));
  }

  async function persistAndOpen() {
    if (state.identityBusy || !state.identity.authenticated) return;
    state.identityBusy = true;
    renderAccount('Saving the exact activation contract…');
    const pref = preferences();
    const policy = TRUST_PRESETS[state.trustPreset];
    try {
      const response = await fetch('/api/persistence', {
        method: 'PUT',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-DLKT-Info-Request': 'persistence-v1' },
        body: JSON.stringify({ briefingId: state.persistedBriefingId, ...pref, trustPolicy: policy }),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 401) {
        state.identity = { ...state.identity, authenticated: false, user: null };
        state.accountActivated = true;
        throw new Error('SESSION_EXPIRED');
      }
      if (!response.ok || !savedProjectionMatches(payload, pref, policy)) throw new Error('PERSISTENCE_SAVE_FAILED');
      state.persistedBriefingId = payload.briefing.id;
      setAccountMessage('Saved. Opening your Companion…');
      window.location.assign(companionUrl());
    } catch (error) {
      const expired = error instanceof Error && error.message === 'SESSION_EXPIRED';
      renderAccount(expired ? 'Session expired. Verify your email again.' : 'The exact contract was not saved. Nothing was partially applied.', true);
    } finally {
      state.identityBusy = false;
      renderAccount(elements.accountStatus.textContent);
    }
  }

  async function verifyIdentityCode() {
    if (state.identityBusy || !state.challengeEmail) return;
    const code = elements.accountCode.value.trim();
    if (!code) { setAccountMessage('Enter the one-time code.', true); elements.accountCode.focus(); return; }
    state.identityBusy = true;
    renderAccount('Verifying and creating the secure session…');
    try {
      const projection = identityProjection(await identityRequest('PUT', { action: 'verify-code', email: state.challengeEmail, code }));
      if (!projection?.authenticated) throw new Error('IDENTITY_VERIFICATION_FAILED');
      state.identity = projection;
      state.identityBusy = false;
      renderAccount('Verified. Saving the exact contract…');
      await persistAndOpen();
    } catch {
      state.identityBusy = false;
      renderAccount('The code was not accepted.', true);
    }
  }

  async function signOut() {
    if (state.identityBusy) return;
    state.identityBusy = true;
    renderAccount('Signing out…');
    try { await identityRequest('DELETE'); } catch { /* Endpoint clears local HttpOnly cookies. */ }
    state.identityBusy = false;
    state.challengeEmail = '';
    state.persistedBriefingId = null;
    state.identity = { ...state.identity, authenticated: false, user: null };
    renderAccount('Signed out. The current activation contract remains session-only.');
  }

  function preferences() {
    return bridge.normalize({
      topics: state.topics,
      entities: state.entities,
      timezone: state.timezone,
      deliveryLocalTime: state.deliveryLocalTime,
      maxCards: state.maxCards,
      minMateriality: state.minMateriality,
      onlyActionable: state.onlyActionable,
    });
  }

  function entityMatches(candidate) {
    if (!state.entities.length) return true;
    const haystack = `${candidate.entity} ${candidate.entityId} ${candidate.label}`.normalize('NFKC').toLocaleLowerCase('en-US');
    return state.entities.some((entity) => {
      const needle = entity.normalize('NFKC').toLocaleLowerCase('en-US');
      return haystack.includes(needle) || needle.includes(candidate.entity.toLocaleLowerCase('en-US'));
    });
  }

  function projectedCards() {
    const policy = TRUST_PRESETS[state.trustPreset];
    const decisions = new Map(trust.project(policy).decisions.map((decision) => [decision.candidateId, decision]));
    return actions.candidates.filter((candidate) => decisions.get(candidate.id)?.included
      && state.topics.includes(candidate.topicId)
      && entityMatches(candidate)
      && (MATERIALITY[candidate.materiality.toLowerCase()] ?? 0) >= MATERIALITY[state.minMateriality]
      && (!state.onlyActionable || Boolean(candidate.suggested)))
      .slice(0, state.maxCards).length;
  }

  function companionUrl() {
    const search = bridge.buildSearch(preferences());
    const trustUrl = trust.buildTrustUrl(TRUST_PRESETS[state.trustPreset], search);
    return `/companion${new URL(trustUrl, window.location.origin).search}#stage=briefing`;
  }

  function showToast(titleText, copy) {
    elements.toastTitle.textContent = titleText;
    elements.toastCopy.textContent = copy;
    elements.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2600);
  }

  function renderEntities() {
    elements.entityChips.replaceChildren();
    state.entities.forEach((entity) => {
      const chip = create('span', 'entity-chip');
      chip.append(create('span', '', entity));
      const remove = create('button', '', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${entity}`);
      remove.addEventListener('click', () => { state.entities = state.entities.filter((entry) => entry !== entity); render(); });
      chip.append(remove);
      elements.entityChips.append(chip);
    });
    elements.entityCount.textContent = String(state.entities.length);
  }

  function addEntity(raw) {
    try {
      const next = bridge.normalize({ ...preferences(), entities: [...state.entities, raw] }).entities;
      state.entities = [...next];
      elements.entityInput.value = '';
      elements.entityFeedback.textContent = 'Specific entities narrow a broad topic without hiding the rule.';
      elements.entityFeedback.classList.remove('is-error');
      showToast('Entity added', `${next.at(-1)} is now visible in the activation contract.`);
      render();
    } catch {
      elements.entityFeedback.textContent = 'Use 2–80 characters. Duplicate names, control characters and the “|” separator are not allowed.';
      elements.entityFeedback.classList.add('is-error');
      elements.entityInput.focus();
    }
  }

  function render() {
    const current = STEPS[state.step];
    const copy = STEP_COPY[current];
    const count = projectedCards();
    const policy = TRUST_PRESETS[state.trustPreset];
    const pref = preferences();

    elements.stepButtons.forEach((button, index) => {
      button.classList.toggle('is-active', index === state.step);
      button.classList.toggle('is-complete', index < state.step);
      button.setAttribute('aria-current', index === state.step ? 'step' : 'false');
    });
    elements.panels.forEach((panel) => { panel.hidden = panel.dataset.stepPanel !== current; panel.classList.toggle('is-active', !panel.hidden); });
    elements.stepKicker.textContent = copy.kicker;
    elements.stepTitle.textContent = copy.title;
    elements.stepExplanation.textContent = copy.explanation;
    elements.stepPosition.textContent = `Step ${state.step + 1} of ${STEPS.length}`;
    elements.progressFill.style.width = `${((state.step + 1) / STEPS.length) * 100}%`;
    elements.back.hidden = state.step === 0;
    elements.next.hidden = state.step === STEPS.length - 1;
    elements.launch.hidden = state.step !== STEPS.length - 1;
    elements.launch.href = companionUrl();

    elements.topicButtons.forEach((button) => button.setAttribute('aria-pressed', String(state.topics.includes(button.dataset.topic))));
    elements.trustPresets.forEach((button) => button.classList.toggle('is-active', button.dataset.trustPreset === state.trustPreset));
    elements.minMateriality.value = state.minMateriality;
    elements.actionableOnly.checked = state.onlyActionable;
    elements.trustProof.textContent = TRUST_COPY[state.trustPreset];
    elements.timezone.value = state.timezone;
    elements.deliveryTime.value = state.deliveryLocalTime;
    elements.cardLimit.value = String(state.maxCards);
    elements.deliverySummary.textContent = state.deliveryLocalTime;
    elements.timezoneSummary.textContent = state.timezone;
    renderEntities();

    elements.metricTopics.textContent = pad(state.topics.length);
    elements.metricEntities.textContent = pad(state.entities.length);
    elements.metricCards.textContent = pad(count);
    elements.railTopics.textContent = pad(state.topics.length);
    elements.railEntities.textContent = pad(state.entities.length);
    elements.railTrust.textContent = title(state.trustPreset);
    elements.railTime.textContent = state.deliveryLocalTime;
    elements.railMax.textContent = pad(state.maxCards);

    elements.resultLine.textContent = `${state.topics.length} topics · ${state.entities.length} entities · ${title(state.trustPreset)} trust · ${state.maxCards}-card briefing`;
    elements.resultExplanation.textContent = count
      ? `The current synthetic dataset would produce ${count} ${count === 1 ? 'card' : 'cards'}. Real collection and persistence remain disabled until the dedicated database is provisioned.`
      : 'No synthetic card matches every active rule. DLKT shows zero instead of inventing content. Real collection and persistence remain disabled.';
    elements.resultCount.textContent = pad(count);
    elements.summaryTopics.textContent = pref.topics.map(title).join(', ');
    elements.summaryEntities.textContent = pref.entities.length ? pref.entities.join(', ') : 'Broad topics only';
    elements.summaryTrust.textContent = `${title(state.trustPreset)} · ${title(policy.minimumTrust)} · ${title(policy.authorityRequirement)} · ${policy.maximumEvidenceAgeHours}h`;
    elements.summaryDelivery.textContent = `${pref.deliveryLocalTime} · ${pref.timezone} · ${pref.maxCards} cards`;
  }

  elements.stepButtons.forEach((button, index) => button.addEventListener('click', () => { state.step = index; render(); }));
  elements.topicButtons.forEach((button) => button.addEventListener('click', () => {
    const topic = button.dataset.topic;
    const exists = state.topics.includes(topic);
    if (exists && state.topics.length === 1) { showToast('One topic required', 'Activation needs at least one explicit domain.'); return; }
    state.topics = exists ? state.topics.filter((entry) => entry !== topic) : [...state.topics, topic];
    render();
  }));
  elements.entityForm.addEventListener('submit', (event) => { event.preventDefault(); addEntity(elements.entityInput.value); });
  elements.entitySuggestions.forEach((button) => button.addEventListener('click', () => { if (!state.entities.includes(button.dataset.entitySuggestion)) addEntity(button.dataset.entitySuggestion); }));
  elements.trustPresets.forEach((button) => button.addEventListener('click', () => { state.trustPreset = button.dataset.trustPreset; render(); }));
  elements.minMateriality.addEventListener('change', () => { state.minMateriality = elements.minMateriality.value; render(); });
  elements.actionableOnly.addEventListener('change', () => { state.onlyActionable = elements.actionableOnly.checked; render(); });
  elements.timezone.addEventListener('change', () => { state.timezone = elements.timezone.value; render(); });
  elements.deliveryTime.addEventListener('change', () => { state.deliveryLocalTime = elements.deliveryTime.value; render(); });
  elements.cardLimit.addEventListener('change', () => {
    const value = Number(elements.cardLimit.value);
    if (Number.isSafeInteger(value) && value > 0 && value <= 2147483647) state.maxCards = value;
    else elements.cardLimit.value = String(state.maxCards);
    render();
  });
  elements.back.addEventListener('click', () => { state.step = Math.max(0, state.step - 1); render(); });
  elements.next.addEventListener('click', () => { state.step = Math.min(STEPS.length - 1, state.step + 1); render(); });
  elements.saveOpen.addEventListener('click', () => {
    if (state.identity.authenticated) { void persistAndOpen(); return; }
    if (!state.identity.enabled) return;
    state.accountActivated = true;
    renderAccount('Enter the email that should own this exact Companion contract.');
    window.requestAnimationFrame(() => elements.accountEmail.focus());
  });
  elements.accountEmailForm.addEventListener('submit', (event) => { event.preventDefault(); void requestIdentityCode(); });
  elements.accountCodeForm.addEventListener('submit', (event) => { event.preventDefault(); void verifyIdentityCode(); });
  elements.changeEmail.addEventListener('click', () => {
    state.challengeEmail = '';
    elements.accountCode.value = '';
    renderAccount('Enter another email.');
    window.requestAnimationFrame(() => elements.accountEmail.focus());
  });
  elements.accountSignOut.addEventListener('click', () => { void signOut(); });
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    if (event.key === 'ArrowLeft' && state.step > 0) { event.preventDefault(); state.step--; render(); }
    if (event.key === 'ArrowRight' && state.step < STEPS.length - 1) { event.preventDefault(); state.step++; render(); }
  });

  Object.defineProperty(window, 'DLKTFirstRunActivation', {
    value: Object.freeze({ version: VERSION, steps: STEPS, trustPresets: TRUST_PRESETS, preferences, projectedCards, companionUrl }),
    writable: false,
    configurable: false,
  });
  render();
  renderAccount('Checking secure account availability…');
  void loadIdentity();
})();
