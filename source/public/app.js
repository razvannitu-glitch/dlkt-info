(() => {
  'use strict';

  const state = {
    allCards: [],
    cards: [],
    topic: 'all',
    index: 0,
    payload: null,
    pointerStartX: null,
    companionBusy: false,
    identityBusy: false,
    identity: { configured: false, enabled: false, authenticated: false, user: null, blocker: null },
    challengeEmail: '',
    persistedBriefingId: null,
    accountReturnFocus: null,
  };

  const elements = {
    stage: document.getElementById('card-stage'),
    dots: document.getElementById('card-dots'),
    hero: document.getElementById('hero-card-stack'),
    prev: document.querySelector('[data-card-prev]'),
    next: document.querySelector('[data-card-next]'),
    topicButtons: Array.from(document.querySelectorAll('[data-topic]')),
    visibleCount: document.getElementById('visible-count'),
    changes: document.getElementById('stat-changes'),
    conflicts: document.getElementById('stat-conflicts'),
    sources: document.getElementById('stat-sources'),
    time: document.getElementById('stat-time'),
    deliveryLocal: document.getElementById('delivery-local'),
    nextDelivery: document.getElementById('next-delivery'),
    cardLimit: document.getElementById('card-limit'),
    menuToggle: document.querySelector('[data-menu-toggle]'),
    mobileNav: document.querySelector('[data-mobile-nav]'),
    companionForm: document.getElementById('companion-form'),
    companionTopics: Array.from(document.querySelectorAll('#companion-form input[name="topics"]')),
    companionTimezone: document.getElementById('companion-timezone'),
    companionTime: document.getElementById('companion-time'),
    companionLimit: document.getElementById('companion-limit'),
    companionMateriality: document.getElementById('companion-materiality'),
    companionActionable: document.getElementById('companion-actionable'),
    companionStatus: document.getElementById('companion-status'),
    companionSummaryTitle: document.getElementById('companion-summary-title'),
    companionSummaryCopy: document.getElementById('companion-summary-copy'),
    companionSubmit: document.querySelector('.companion-submit'),
    companionSave: document.querySelector('[data-save-companion]'),
    companionMemoryTitle: document.querySelector('[data-companion-memory-title]'),
    companionMemoryCopy: document.querySelector('[data-companion-memory-copy]'),
    accountToggle: document.querySelector('[data-account-toggle]'),
    accountLabel: document.querySelector('[data-account-label]'),
    accountPanel: document.querySelector('[data-account-panel]'),
    accountBackdrop: document.querySelector('[data-account-backdrop]'),
    accountClose: document.querySelector('[data-account-close]'),
    accountUnavailable: document.querySelector('[data-account-unavailable]'),
    accountEmailForm: document.querySelector('[data-account-email-form]'),
    accountCodeForm: document.querySelector('[data-account-code-form]'),
    accountSignedIn: document.querySelector('[data-account-signed-in]'),
    accountEmailInput: document.getElementById('account-email'),
    accountCodeInput: document.getElementById('account-code'),
    accountEmailText: document.querySelector('[data-account-email]'),
    accountStatus: document.querySelector('[data-account-status]'),
    accountChangeEmail: document.querySelector('[data-account-change-email]'),
    accountSignOut: document.querySelector('[data-account-sign-out]'),
  };

  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (typeof text === 'string') element.textContent = text;
    return element;
  };

  const safeText = (value, fallback = '') => typeof value === 'string' && value.length <= 3000 ? value : fallback;

  const safeNumber = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  const titleCase = (value) => safeText(value, 'Signal')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  const validCard = (card) => Boolean(
    card
    && typeof card === 'object'
    && typeof card.id === 'string'
    && typeof card.topicId === 'string'
    && typeof card.title === 'string'
    && typeof card.direct === 'string'
    && typeof card.whyItMatters === 'string'
    && typeof card.changedSince === 'string'
    && card.entity
    && typeof card.entity.label === 'string'
    && Array.isArray(card.sources),
  );

  const safeSourceUrl = (value) => {
    if (typeof value !== 'string' || value.length > 1800) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
      return url.href;
    } catch {
      return null;
    }
  };

  const formatDelivery = (iso, timezone) => {
    if (typeof iso !== 'string' || !Number.isFinite(Date.parse(iso))) return 'Not scheduled';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: typeof timezone === 'string' ? timezone : 'UTC',
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(iso));
    } catch {
      return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
    }
  };

  const cardSources = (card) => {
    const details = create('details', 'card-sources');
    const summary = create('summary', '', `${card.sources.length} ${card.sources.length === 1 ? 'source' : 'sources'} ↗`);
    const list = create('div', 'card-source-list');

    for (const source of card.sources) {
      if (!source || typeof source !== 'object') continue;
      const href = safeSourceUrl(source.url);
      const item = href ? create('a') : create('span');
      item.textContent = safeText(source.title, safeText(source.sourceId, 'Source'));
      if (href && item instanceof HTMLAnchorElement) {
        item.href = href;
        item.target = '_blank';
        item.rel = 'noopener noreferrer';
      }
      list.append(item);
    }

    if (!list.childElementCount) list.append(create('span', '', 'Source metadata unavailable'));
    details.append(summary, list);
    return details;
  };

  const buildCard = (card, position) => {
    const article = create('article', `info-card${card.trust === 'conflicting' ? ' is-conflicting' : ''}`);
    article.dataset.cardIndex = String(position);
    article.setAttribute('aria-label', `InfoCard ${position + 1} of ${state.cards.length}`);
    article.setAttribute('aria-hidden', position === state.index ? 'false' : 'true');

    const kicker = create('div', 'card-kicker');
    kicker.append(
      create('span', 'card-topic', titleCase(card.topicId)),
      create('span', 'card-trust', titleCase(card.trust)),
    );

    const heading = create('h3', '', safeText(card.title, 'Material update'));
    const body = create('div', 'card-body');
    const direct = create('p', 'card-direct', safeText(card.direct, 'No direct reading is available.'));
    const explanation = create('div');
    explanation.append(
      create('p', 'card-explain', safeText(card.whyItMatters, 'No impact statement is available.')),
      create('p', 'card-change', safeText(card.changedSince, 'New since the previous briefing.')),
    );
    body.append(direct, explanation);

    const footer = create('div', 'card-footer');
    const meta = create('div', 'card-meta');
    meta.append(
      create('span', '', titleCase(card.materiality)),
      create('span', '', titleCase(card.kind)),
      create('span', '', safeText(card.entity.label, 'Entity')),
    );
    if (Array.isArray(card.blockedDependencies) && card.blockedDependencies.length) {
      meta.append(create('span', '', `${card.blockedDependencies.length} blocked`));
    }
    footer.append(meta, cardSources(card));
    article.append(kicker, heading, body, footer);
    return article;
  };

  const buildHeroCard = (card) => {
    const article = create('article', 'hero-card');
    article.append(create('p', '', titleCase(card.topicId)));
    article.append(create('h2', '', safeText(card.title, 'Material update')));
    const status = create('span', 'hero-card-status', card.trust === 'conflicting' ? '!' : '→');
    status.setAttribute('aria-hidden', 'true');
    article.append(status);
    article.append(create('span', '', `${titleCase(card.trust)} · ${card.sources.length} ${card.sources.length === 1 ? 'source' : 'sources'}`));
    elements.hero?.replaceChildren(article);
  };

  const buildEmpty = (title, message) => {
    const empty = create('article', 'empty-card');
    empty.append(create('h3', '', title), create('p', '', message));
    return empty;
  };

  const updateStats = () => {
    const sources = new Set();
    let conflicts = 0;
    for (const card of state.cards) {
      if (card.trust === 'conflicting') conflicts += 1;
      for (const source of card.sources) {
        if (source && typeof source.sourceId === 'string') sources.add(source.sourceId);
      }
    }
    if (elements.visibleCount) elements.visibleCount.textContent = String(state.cards.length);
    if (elements.changes) elements.changes.textContent = String(state.cards.length);
    if (elements.conflicts) elements.conflicts.textContent = String(conflicts);
    if (elements.sources) elements.sources.textContent = String(sources.size);
    if (elements.time) elements.time.textContent = `${Math.max(1, Math.ceil(state.cards.length * 0.55))} min`;
  };

  const updateNavigation = () => {
    const hasCards = state.cards.length > 0;
    if (elements.prev) elements.prev.disabled = !hasCards || state.index <= 0;
    if (elements.next) elements.next.disabled = !hasCards || state.index >= state.cards.length - 1;

    if (elements.dots) {
      const dots = state.cards.map((card, index) => {
        const button = create('button', index === state.index ? 'is-active' : '');
        button.type = 'button';
        button.setAttribute('aria-label', `Show InfoCard ${index + 1}: ${safeText(card.entity?.label, 'signal')}`);
        button.setAttribute('aria-pressed', index === state.index ? 'true' : 'false');
        button.addEventListener('click', () => showCard(index));
        return button;
      });
      elements.dots.replaceChildren(...dots);
    }
  };

  const showCard = (index) => {
    if (!state.cards.length || !Number.isInteger(index)) return;
    state.index = Math.min(state.cards.length - 1, Math.max(0, index));
    const cardElements = elements.stage ? Array.from(elements.stage.querySelectorAll('.info-card')) : [];
    cardElements.forEach((cardElement, cardIndex) => {
      const active = cardIndex === state.index;
      cardElement.classList.toggle('is-active', active);
      cardElement.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    const current = state.cards[state.index];
    if (current) buildHeroCard(current);
    updateNavigation();
  };

  const renderCards = () => {
    if (!elements.stage) return;
    if (!state.cards.length) {
      elements.stage.replaceChildren(buildEmpty('Nothing material here.', 'This topic has no synthetic material changes in the current briefing. The finite briefing stays honest instead of filling space.'));
      elements.hero?.replaceChildren(buildEmpty('No material signal.', 'Choose another topic to inspect the synthetic briefing.'));
      updateStats();
      updateNavigation();
      return;
    }

    state.index = Math.min(state.index, state.cards.length - 1);
    elements.stage.replaceChildren(...state.cards.map(buildCard));
    updateStats();
    showCard(state.index);
  };

  const filterCards = (topic) => {
    state.topic = topic;
    state.index = 0;
    state.cards = topic === 'all' ? [...state.allCards] : state.allCards.filter((card) => card.topicId === topic);
    for (const button of elements.topicButtons) {
      const active = button.dataset.topic === topic;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    renderCards();
  };

  const configureBriefing = (payload) => {
    const definition = payload.definition && typeof payload.definition === 'object' ? payload.definition : {};
    if (elements.deliveryLocal) elements.deliveryLocal.textContent = safeText(definition.deliveryLocalTime, '08:00');
    if (elements.cardLimit) elements.cardLimit.textContent = String(Math.max(1, Math.min(12, safeNumber(definition.maxCards, 5))));
    if (elements.nextDelivery) {
      elements.nextDelivery.textContent = formatDelivery(payload.briefing?.nextDeliveryAt, safeText(definition.timezone, 'UTC'));
    }
  };

  const companionPreferences = () => ({
    topics: elements.companionTopics
      .filter((input) => input instanceof HTMLInputElement && input.checked)
      .map((input) => input.value),
    timezone: elements.companionTimezone instanceof HTMLSelectElement ? elements.companionTimezone.value : 'Europe/Bucharest',
    deliveryLocalTime: elements.companionTime instanceof HTMLInputElement ? elements.companionTime.value : '08:00',
    maxCards: elements.companionLimit instanceof HTMLSelectElement ? Number(elements.companionLimit.value) : 5,
    minMateriality: elements.companionMateriality instanceof HTMLSelectElement ? elements.companionMateriality.value : 'low',
    onlyActionable: elements.companionActionable instanceof HTMLInputElement && elements.companionActionable.checked,
  });

  const updateCompanionSummary = (preferences = companionPreferences()) => {
    const topicCount = Array.isArray(preferences.topics) ? preferences.topics.length : 0;
    const cardCount = Math.max(1, Math.min(12, safeNumber(preferences.maxCards, 5)));
    const delivery = safeText(preferences.deliveryLocalTime, '08:00');
    const topicWord = topicCount === 1 ? 'topic' : 'topics';
    const cardWord = cardCount === 1 ? 'card' : 'cards';
    if (elements.companionSummaryTitle) {
      elements.companionSummaryTitle.textContent = `${topicCount} ${topicWord}. ${cardCount} ${cardWord}. ${delivery}.`;
    }
    if (elements.companionSummaryCopy) {
      const threshold = titleCase(safeText(preferences.minMateriality, 'low'));
      const mode = preferences.onlyActionable ? ' Only actionable changes.' : '';
      elements.companionSummaryCopy.textContent = `A finite synthetic briefing ranked from ${threshold.toLowerCase()} materiality upward.${mode}`;
    }
  };

  const applyPayload = (payload) => {
    if (!payload || payload.synthetic !== true || !payload.briefing || !Array.isArray(payload.briefing.cards)) {
      throw new Error('BRIEFING_CONTRACT');
    }
    state.payload = payload;
    state.allCards = payload.briefing.cards.filter(validCard).slice(0, 12);
    configureBriefing(payload);
    filterCards('all');
  };

  const setAccountStatus = (message, error = false) => {
    if (!elements.accountStatus) return;
    elements.accountStatus.textContent = message;
    elements.accountStatus.classList.toggle('is-error', error);
  };

  const syncSaveButton = () => {
    const authenticated = state.identity.authenticated === true;
    const available = state.identity.enabled === true;
    if (elements.companionSave instanceof HTMLButtonElement) {
      elements.companionSave.disabled = state.companionBusy || state.identityBusy || !available;
      const label = elements.companionSave.querySelector('span');
      if (label) label.textContent = authenticated ? 'Save across devices' : (available ? 'Sign in to save' : 'Save unavailable');
    }
    if (elements.companionMemoryTitle) {
      elements.companionMemoryTitle.textContent = authenticated ? 'Cross-device memory ready' : (available ? 'Secure sign-in required' : 'Session preview');
    }
    if (elements.companionMemoryCopy) {
      elements.companionMemoryCopy.textContent = authenticated
        ? 'Your current companion rules can be persisted through the authenticated data boundary.'
        : (available
          ? 'Sign in with a one-time code to save and restore this briefing across devices.'
          : 'Nothing is persisted until the dedicated DLKT database is active.');
    }
  };

  const identityProjection = (payload) => {
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
  };

  const renderIdentity = (projection, message = '') => {
    const identity = identityProjection({ version: 'dlkt-info-identity-1', ...projection });
    state.identity = identity ?? { configured: false, enabled: false, authenticated: false, user: null, blocker: 'IDENTITY_STATUS_INVALID' };
    const authenticated = state.identity.authenticated === true;
    const enabled = state.identity.enabled === true;
    elements.accountToggle?.classList.toggle('is-available', enabled);
    elements.accountToggle?.classList.toggle('is-authenticated', authenticated);
    if (elements.accountLabel) elements.accountLabel.textContent = authenticated ? 'My account' : 'Account';
    if (elements.accountUnavailable) elements.accountUnavailable.hidden = enabled;
    if (elements.accountEmailForm) elements.accountEmailForm.hidden = !enabled || authenticated || Boolean(state.challengeEmail);
    if (elements.accountCodeForm) elements.accountCodeForm.hidden = !enabled || authenticated || !state.challengeEmail;
    if (elements.accountSignedIn) elements.accountSignedIn.hidden = !authenticated;
    if (elements.accountEmailText) elements.accountEmailText.textContent = authenticated ? safeText(state.identity.user?.email, 'Signed-in user') : '';
    if (message) setAccountStatus(message, false);
    else if (!enabled) setAccountStatus('The dedicated account backend is not provisioned. Anonymous briefing remains available.', false);
    else if (authenticated) setAccountStatus('Secure session active. Your access token remains HttpOnly.', false);
    else if (state.challengeEmail) setAccountStatus('Enter the one-time code sent to your email.', false);
    else setAccountStatus('Use a one-time email code. No password is stored by DLKT.', false);
    syncSaveButton();
  };

  const setIdentityBusy = (busy) => {
    state.identityBusy = busy;
    for (const form of [elements.accountEmailForm, elements.accountCodeForm]) {
      if (!(form instanceof HTMLFormElement)) continue;
      for (const control of form.querySelectorAll('button, input')) control.disabled = busy;
    }
    if (elements.accountSignOut instanceof HTMLButtonElement) elements.accountSignOut.disabled = busy;
    syncSaveButton();
  };

  const accountFocusable = () => elements.accountPanel
    ? Array.from(elements.accountPanel.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]'))
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
    : [];

  const openAccount = () => {
    if (!elements.accountPanel || !elements.accountBackdrop) return;
    state.accountReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    elements.accountPanel.hidden = false;
    elements.accountBackdrop.hidden = false;
    elements.accountToggle?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('account-open');
    window.requestAnimationFrame(() => {
      const preferred = state.identity.enabled
        ? (state.challengeEmail ? elements.accountCodeInput : (state.identity.authenticated ? elements.accountSignOut : elements.accountEmailInput))
        : elements.accountClose;
      if (preferred instanceof HTMLElement) preferred.focus();
    });
  };

  const closeAccount = () => {
    if (!elements.accountPanel || !elements.accountBackdrop) return;
    elements.accountPanel.hidden = true;
    elements.accountBackdrop.hidden = true;
    elements.accountToggle?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('account-open');
    if (state.accountReturnFocus instanceof HTMLElement) state.accountReturnFocus.focus();
    state.accountReturnFocus = null;
  };

  const identityRequest = async (method, body) => {
    const response = await fetch('/api/auth', {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-DLKT-Info-Request': 'identity-v1',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* Fail through status handling. */ }
    return { response, payload };
  };

  const applyPersistedCompanion = (projection) => {
    if (!projection || projection.version !== 'dlkt-info-persistence-2'
        || !projection.profile || typeof projection.profile !== 'object') throw new Error('PERSISTENCE_CONTRACT');
    const briefing = projection.briefing;
    const rule = projection.rule;
    const trustPolicy = projection.trustPolicy;
    if (!briefing || !rule || !trustPolicy || !Array.isArray(rule.topics)) return;
    state.persistedBriefingId = typeof briefing.id === 'string' ? briefing.id : null;
    const topics = new Set(rule.topics.filter((topic) => typeof topic === 'string'));
    for (const input of elements.companionTopics) {
      if (input instanceof HTMLInputElement) input.checked = topics.has(input.value);
    }
    if (elements.companionTimezone instanceof HTMLSelectElement && typeof briefing.timezone === 'string') {
      if (!Array.from(elements.companionTimezone.options).some((option) => option.value === briefing.timezone)) {
        elements.companionTimezone.add(new Option(briefing.timezone.replace('_', ' '), briefing.timezone));
      }
      elements.companionTimezone.value = briefing.timezone;
    }
    if (elements.companionTime instanceof HTMLInputElement && typeof briefing.deliveryLocalTime === 'string') {
      elements.companionTime.value = briefing.deliveryLocalTime;
    }
    if (elements.companionLimit instanceof HTMLInputElement && Number.isSafeInteger(briefing.maxCards) && briefing.maxCards > 0) {
      elements.companionLimit.value = String(briefing.maxCards);
    }
    if (elements.companionMateriality instanceof HTMLSelectElement && typeof rule.minMateriality === 'string') {
      elements.companionMateriality.value = rule.minMateriality;
    }
    if (elements.companionActionable instanceof HTMLInputElement) elements.companionActionable.checked = rule.onlyActionable === true;
    updateCompanionSummary();
  };

  const loadPersistedCompanion = async () => {
    if (!state.identity.authenticated) return;
    try {
      const response = await fetch('/api/persistence', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-DLKT-Info-Request': 'persistence-v1' },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 401) {
        renderIdentity({ configured: true, enabled: true, authenticated: false, user: null, blocker: null }, 'Your secure session ended. Sign in again to save.');
        return;
      }
      if (!response.ok) throw new Error('PERSISTENCE_HTTP');
      applyPersistedCompanion(await response.json());
      if (elements.companionStatus) {
        elements.companionStatus.textContent = 'Your saved companion rules were restored securely.';
        elements.companionStatus.classList.remove('is-error');
      }
    } catch {
      if (elements.companionStatus) {
        elements.companionStatus.textContent = 'Your account is active, but saved rules could not be restored yet.';
        elements.companionStatus.classList.add('is-error');
      }
    }
  };

  const loadIdentity = async () => {
    try {
      const { response, payload } = await identityRequest('GET');
      if (!response.ok || !payload) throw new Error('IDENTITY_HTTP');
      const projection = identityProjection(payload);
      if (!projection) throw new Error('IDENTITY_CONTRACT');
      renderIdentity(projection);
      if (projection.authenticated) await loadPersistedCompanion();
    } catch {
      renderIdentity({ configured: false, enabled: false, authenticated: false, user: null, blocker: 'IDENTITY_STATUS_UNAVAILABLE' }, 'Account status is temporarily unavailable. Anonymous briefing remains available.');
    }
  };

  const requestIdentityCode = async () => {
    if (state.identityBusy || !(elements.accountEmailInput instanceof HTMLInputElement)) return;
    if (!elements.accountEmailInput.reportValidity()) return;
    const email = elements.accountEmailInput.value.trim();
    setIdentityBusy(true);
    setAccountStatus('Sending a one-time code…');
    try {
      const { response } = await identityRequest('POST', {
        action: 'request-code',
        email,
        timezone: elements.companionTimezone instanceof HTMLSelectElement ? elements.companionTimezone.value : 'UTC',
        locale: safeText(document.documentElement.lang, 'en'),
      });
      if (response.status === 429) throw new Error('RATE_LIMITED');
      if (!response.ok) throw new Error('IDENTITY_HTTP');
      state.challengeEmail = email;
      renderIdentity({ ...state.identity, authenticated: false, user: null }, 'One-time code sent. Check your inbox.');
      window.requestAnimationFrame(() => elements.accountCodeInput?.focus());
    } catch (error) {
      setAccountStatus(error instanceof Error && error.message === 'RATE_LIMITED'
        ? 'Too many attempts. Wait before requesting another code.'
        : 'The code could not be sent. Try again later.', true);
    } finally {
      setIdentityBusy(false);
    }
  };

  const verifyIdentityCode = async () => {
    if (state.identityBusy || !state.challengeEmail || !(elements.accountCodeInput instanceof HTMLInputElement)) return;
    if (!elements.accountCodeInput.reportValidity()) return;
    setIdentityBusy(true);
    setAccountStatus('Verifying the secure code…');
    try {
      const { response, payload } = await identityRequest('PUT', {
        action: 'verify-code',
        email: state.challengeEmail,
        code: elements.accountCodeInput.value,
      });
      if (!response.ok || !payload) throw new Error('IDENTITY_HTTP');
      const projection = identityProjection(payload);
      if (!projection?.authenticated) throw new Error('IDENTITY_CONTRACT');
      state.challengeEmail = '';
      elements.accountCodeInput.value = '';
      renderIdentity(projection, 'Signed in securely. Cross-device saving is ready.');
      await loadPersistedCompanion();
    } catch {
      setAccountStatus('The code is invalid or expired. Request a new code and try again.', true);
    } finally {
      setIdentityBusy(false);
    }
  };

  const signOut = async () => {
    if (state.identityBusy) return;
    setIdentityBusy(true);
    try { await identityRequest('DELETE'); } catch { /* Local HttpOnly cookies are cleared by the endpoint. */ }
    state.challengeEmail = '';
    state.persistedBriefingId = null;
    renderIdentity({ configured: state.identity.configured, enabled: state.identity.enabled, authenticated: false, user: null, blocker: state.identity.blocker }, 'Signed out. The current page remains a session-only preview.');
    setIdentityBusy(false);
  };

  const saveCompanion = async () => {
    if (!state.identity.authenticated) {
      openAccount();
      return;
    }
    if (state.identityBusy) return;
    const preferences = companionPreferences();
    if (preferences.topics.length === 0) {
      if (elements.companionStatus) {
        elements.companionStatus.textContent = 'Choose at least one topic before saving.';
        elements.companionStatus.classList.add('is-error');
      }
      return;
    }
    setIdentityBusy(true);
    if (elements.companionStatus) {
      elements.companionStatus.textContent = 'Saving your companion rules securely…';
      elements.companionStatus.classList.remove('is-error');
    }
    try {
      const response = await fetch('/api/persistence', {
        method: 'PUT',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-DLKT-Info-Request': 'persistence-v1' },
        body: JSON.stringify({
          briefingId: state.persistedBriefingId,
          ...preferences,
          trustPolicy: {
            minimumTrust: 'corroborated',
            conflictPolicy: 'exclude',
            authorityRequirement: 'primary',
            minimumSources: 2,
            maximumEvidenceAgeHours: 72,
            requireOfficialForHighImpact: true,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 401) {
        renderIdentity({ configured: true, enabled: true, authenticated: false, user: null, blocker: null }, 'Your secure session ended. Sign in again.');
        openAccount();
        return;
      }
      if (!response.ok) throw new Error('PERSISTENCE_HTTP');
      applyPersistedCompanion(await response.json());
      if (elements.companionStatus) elements.companionStatus.textContent = 'Saved across devices. Delivery time and selection are now canonical.';
    } catch {
      if (elements.companionStatus) {
        elements.companionStatus.textContent = 'Your settings could not be saved. The current session remains unchanged.';
        elements.companionStatus.classList.add('is-error');
      }
    } finally {
      setIdentityBusy(false);
    }
  };

  const setCompanionBusy = (busy) => {
    state.companionBusy = busy;
    if (elements.companionSubmit instanceof HTMLButtonElement) {
      elements.companionSubmit.disabled = busy;
      const label = elements.companionSubmit.querySelector('span');
      if (label) label.textContent = busy ? 'Building…' : 'Build and open my briefing';
    }
    syncSaveButton();
  };

  const buildPersonalBriefing = async () => {
    if (state.companionBusy) return;
    const preferences = companionPreferences();
    updateCompanionSummary(preferences);
    if (preferences.topics.length === 0) {
      if (elements.companionStatus) {
        elements.companionStatus.textContent = 'Choose at least one topic.';
        elements.companionStatus.classList.add('is-error');
      }
      return;
    }

    setCompanionBusy(true);
    if (elements.companionStatus) {
      elements.companionStatus.textContent = 'Opening the real verified Companion…';
      elements.companionStatus.classList.remove('is-error');
    }
    try {
      const bridge = window.DLKTCompanionBridge;
      if (!bridge || typeof bridge.buildSearch !== 'function') throw new Error('COMPANION_BRIDGE_UNAVAILABLE');
      const companionUrl = `/companion${bridge.buildSearch(preferences)}`;
      window.location.assign(companionUrl);
    } catch {
      if (elements.companionStatus) {
        elements.companionStatus.textContent = 'The verified Companion could not be opened. Your current page remains unchanged.';
        elements.companionStatus.classList.add('is-error');
      }
      setCompanionBusy(false);
    }
  };

  const loadBriefing = async () => {
    try {
      const response = await fetch('/api/demo', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('BRIEFING_HTTP');
      const payload = await response.json();
      applyPayload(payload);
      updateCompanionSummary();
    } catch {
      state.allCards = [];
      state.cards = [];
      if (elements.stage) {
        elements.stage.replaceChildren(buildEmpty('Briefing unavailable.', 'The protected synthetic preview could not be loaded. No replacement facts were invented.'));
      }
      if (elements.hero) {
        elements.hero.replaceChildren(buildEmpty('Engine response unavailable.', 'The interface remains fail-closed.'));
      }
      updateStats();
      updateNavigation();
    }
  };

  const move = (direction) => showCard(state.index + direction);

  elements.prev?.addEventListener('click', () => move(-1));
  elements.next?.addEventListener('click', () => move(1));
  elements.stage?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
  });
  elements.stage?.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    state.pointerStartX = event.clientX;
  });
  elements.stage?.addEventListener('pointerup', (event) => {
    if (state.pointerStartX === null) return;
    const distance = event.clientX - state.pointerStartX;
    state.pointerStartX = null;
    if (Math.abs(distance) < 55) return;
    move(distance < 0 ? 1 : -1);
  });
  elements.stage?.addEventListener('pointercancel', () => { state.pointerStartX = null; });

  for (const button of elements.topicButtons) {
    button.addEventListener('click', () => filterCards(button.dataset.topic || 'all'));
  }

  elements.companionForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void buildPersonalBriefing();
  });
  elements.companionForm?.addEventListener('change', () => updateCompanionSummary());
  elements.companionSave?.addEventListener('click', () => { void saveCompanion(); });
  elements.accountToggle?.addEventListener('click', openAccount);
  elements.accountClose?.addEventListener('click', closeAccount);
  elements.accountBackdrop?.addEventListener('click', closeAccount);
  elements.accountEmailForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void requestIdentityCode();
  });
  elements.accountCodeForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void verifyIdentityCode();
  });
  elements.accountChangeEmail?.addEventListener('click', () => {
    state.challengeEmail = '';
    if (elements.accountCodeInput instanceof HTMLInputElement) elements.accountCodeInput.value = '';
    renderIdentity({ ...state.identity, authenticated: false, user: null }, 'Enter the email that should receive a new one-time code.');
    window.requestAnimationFrame(() => elements.accountEmailInput?.focus());
  });
  elements.accountSignOut?.addEventListener('click', () => { void signOut(); });
  updateCompanionSummary();
  syncSaveButton();

  const closeMenu = () => {
    if (!elements.menuToggle || !elements.mobileNav) return;
    elements.menuToggle.setAttribute('aria-expanded', 'false');
    elements.mobileNav.hidden = true;
  };
  elements.menuToggle?.addEventListener('click', () => {
    if (!elements.mobileNav) return;
    const open = elements.menuToggle?.getAttribute('aria-expanded') === 'true';
    elements.menuToggle?.setAttribute('aria-expanded', open ? 'false' : 'true');
    elements.mobileNav.hidden = open;
  });
  elements.mobileNav?.addEventListener('click', (event) => {
    if (event.target instanceof HTMLAnchorElement) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (!elements.accountPanel?.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAccount();
        return;
      }
      if (event.key === 'Tab') {
        const focusable = accountFocusable();
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    if (event.key === 'Escape') closeMenu();
  });

  void loadBriefing();
  void loadIdentity();
})();
