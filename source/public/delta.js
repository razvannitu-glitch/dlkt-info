(() => {
  'use strict';

  const API = '/api/eu-official-delta';
  const MARKER = 'eu-delta-v1';
  const FILTERS = new Set(['all', 'new', 'changed', 'commission-proposals', 'parliament-council-legislation']);
  const state = { snapshot: null, filter: 'all', budget: 6, cursor: 0, visible: [] };
  const query = (selector) => document.querySelector(selector);
  const text = (selector, value) => { const node = query(selector); if (node) node.textContent = String(value); };
  const element = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const formatTime = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Unavailable';
  };
  const compactHash = (value) => typeof value === 'string' && value.length >= 16 ? `${value.slice(0, 8)}…${value.slice(-8)}` : 'Unavailable';
  const positiveBudget = (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : 6;
  };
  const setHidden = (selector, hidden) => { const node = query(selector); if (node) node.hidden = hidden; };

  const readUrl = () => {
    const parameters = new URLSearchParams(window.location.search);
    const filter = parameters.get('filter');
    const budget = parameters.get('budget');
    const card = Number(parameters.get('card'));
    state.filter = filter && FILTERS.has(filter) ? filter : 'all';
    state.budget = positiveBudget(budget ?? 6);
    state.cursor = Number.isSafeInteger(card) && card >= 0 ? card : 0;
    const filterControl = query('[data-filter]');
    const budgetControl = query('[data-budget]');
    if (filterControl instanceof HTMLSelectElement) filterControl.value = state.filter;
    if (budgetControl instanceof HTMLInputElement) budgetControl.value = String(state.budget);
  };

  const writeUrl = () => {
    const parameters = new URLSearchParams();
    if (state.filter !== 'all') parameters.set('filter', state.filter);
    if (state.budget !== 6) parameters.set('budget', String(state.budget));
    if (state.cursor > 0) parameters.set('card', String(state.cursor));
    const search = parameters.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
  };

  const validateSnapshot = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SNAPSHOT_INVALID');
    if (value.version !== 'dlkt-info-eu-release-delta-1' || value.mode !== 'release-baseline-delta'
        || value.deltaAvailable !== true || value.databaseUsed !== false || value.aiInterpretation !== false
        || !Array.isArray(value.feeds) || !Array.isArray(value.cards)) throw new Error('SNAPSHOT_CONTRACT_INVALID');
    return value;
  };

  const filteredCards = () => {
    if (!state.snapshot) return [];
    const cards = state.snapshot.cards.filter((card) => {
      if (state.filter === 'all') return true;
      if (state.filter === 'new' || state.filter === 'changed') return card.kind === state.filter;
      return card.feedKind === state.filter;
    });
    return cards.slice(0, state.budget);
  };

  const renderFeeds = () => {
    const grid = query('[data-feed-grid]');
    if (!grid || !state.snapshot) return;
    grid.replaceChildren();
    for (const feed of state.snapshot.feeds) {
      const card = element('article', 'feed-card');
      card.dataset.state = feed.status;
      const header = element('header');
      header.append(element('span', '', feed.status === 'available' ? 'Official feed available' : 'Official feed unavailable'), element('b'));
      const title = element('h3', '', feed.label);
      const stats = element('dl', 'feed-stats');
      for (const [number, label] of [[feed.newCount, 'new'], [feed.changedCount, 'changed'], [feed.unchangedCount, 'same'], [feed.rolledOffIgnoredCount, 'roll-off ignored']]) {
        const group = element('div');
        group.append(element('dt', '', String(number)), element('dd', '', label));
        stats.append(group);
      }
      card.append(header, title, stats);
      grid.append(card);
    }
  };

  const renderMetrics = () => {
    if (!state.snapshot) return;
    text('[data-change-total]', state.snapshot.availableCardCount);
    text('[data-new-count]', state.snapshot.newCount);
    text('[data-changed-count]', state.snapshot.changedCount);
    text('[data-unchanged-count]', state.snapshot.unchangedCount);
    text('[data-source-count]', state.snapshot.feeds.filter((feed) => feed.status === 'available').length);
    text('[data-baseline-at]', formatTime(state.snapshot.baselineAt));
    text('[data-generated-at]', formatTime(state.snapshot.generatedAt));
    text('[data-baseline-hash]', compactHash(state.snapshot.baselineHash));
    text('[data-legal-boundary]', state.snapshot.legalBoundary);
    text('[data-footer-state]', state.snapshot.partial ? 'Partial official comparison' : 'Complete official comparison');
  };

  const renderMap = () => {
    const list = query('[data-map-list]');
    if (!list) return;
    list.replaceChildren();
    state.visible.forEach((card, index) => {
      const button = element('button');
      button.type = 'button';
      button.setAttribute('aria-current', index === state.cursor ? 'true' : 'false');
      const number = element('b', '', String(index + 1).padStart(2, '0'));
      const copy = element('span');
      copy.append(element('strong', '', `${card.kind.toUpperCase()} · ${card.celexId}`), element('small', '', card.title));
      button.append(number, copy);
      button.addEventListener('click', () => { state.cursor = index; renderResult(); });
      list.append(button);
    });
  };

  const comparisonSection = (label, title, creator, publishedAt) => {
    const section = element('section');
    section.append(element('span', '', label), element('h3', '', title), element('p', '', creator));
    if (publishedAt) section.append(element('p', '', formatTime(publishedAt)));
    return section;
  };

  const renderCard = () => {
    const article = query('[data-card]');
    if (!article) return;
    article.replaceChildren();
    const card = state.visible[state.cursor];
    if (!card) return;
    const topline = element('div', 'card-topline');
    topline.append(
      element('span', 'card-badge primary', card.stateLabel),
      element('span', 'card-badge', card.feedLabel),
      element('span', 'card-badge', card.celexId),
      element('span', 'card-badge', 'Official source'),
    );
    const title = element('h2', '', card.title);
    const creator = element('p', 'card-creator', card.creator);
    const comparison = element('div', 'comparison');
    if (card.kind === 'new') {
      comparison.append(
        comparisonSection('Release baseline', 'Not present in the verified baseline', 'No earlier listing with this CELEX identity.', card.baselineAt),
        comparisonSection('Current official feed', card.title, card.creator, card.publishedAt),
      );
    } else {
      comparison.append(
        comparisonSection('Before', card.previous?.title ?? 'Previous metadata unavailable', card.previous?.creator ?? '', card.previous?.publishedAt),
        comparisonSection('Now', card.title, card.creator, card.publishedAt),
      );
    }
    const fields = element('div', 'changed-fields');
    const fieldLabels = card.kind === 'new' ? ['new CELEX listing'] : card.changedFields.map((field) => field.replaceAll('-', ' '));
    for (const field of fieldLabels) fields.append(element('span', '', field));
    const sourcePanel = element('div', 'source-panel');
    const sourceCopy = element('div');
    sourceCopy.append(element('strong', '', card.source.name), element('small', '', `Observed ${formatTime(card.observedAt)} · Attribution required`));
    const sourceLink = element('a', '', 'Open official act ↗');
    sourceLink.href = card.sourceUrl;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    sourcePanel.append(sourceCopy, sourceLink);
    const legal = element('p', 'legal-note', card.legalCaveat);
    article.append(topline, title, creator, comparison, fields, sourcePanel, legal);
  };

  const renderResult = () => {
    state.visible = filteredCards();
    if (state.cursor >= state.visible.length) state.cursor = 0;
    const hasCards = state.visible.length > 0;
    setHidden('[data-loading]', true);
    setHidden('[data-error]', true);
    setHidden('[data-empty]', hasCards);
    setHidden('[data-card]', !hasCards);
    setHidden('[data-card-navigation]', !hasCards);
    text('[data-result-progress]', `${state.visible.length} of ${state.snapshot?.availableCardCount ?? 0} matching your view`);
    if (hasCards) {
      renderCard();
      renderMap();
      text('[data-card-position]', `${state.cursor + 1} / ${state.visible.length}`);
    } else {
      const list = query('[data-map-list]');
      if (list) list.replaceChildren();
    }
    writeUrl();
  };

  const load = async () => {
    setHidden('[data-loading]', false);
    setHidden('[data-error]', true);
    setHidden('[data-empty]', true);
    setHidden('[data-card]', true);
    setHidden('[data-card-navigation]', true);
    try {
      const response = await fetch(API, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'X-DLKT-Info-Request': MARKER },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`DELTA_HTTP_${response.status}`);
      state.snapshot = validateSnapshot(await response.json());
      renderMetrics();
      renderFeeds();
      renderResult();
    } catch (error) {
      setHidden('[data-loading]', true);
      setHidden('[data-error]', false);
      text('[data-error-copy]', error instanceof Error ? `Verified comparison unavailable: ${error.message}` : 'Verified comparison unavailable.');
      text('[data-footer-state]', 'Verified comparison unavailable');
    }
  };

  query('[data-controls]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const filter = query('[data-filter]');
    const budget = query('[data-budget]');
    state.filter = filter instanceof HTMLSelectElement && FILTERS.has(filter.value) ? filter.value : 'all';
    state.budget = positiveBudget(budget instanceof HTMLInputElement ? budget.value : 6);
    state.cursor = 0;
    renderResult();
  });
  query('[data-refresh]')?.addEventListener('click', () => { void load(); });
  query('[data-error-retry]')?.addEventListener('click', () => { void load(); });
  query('[data-previous]')?.addEventListener('click', () => {
    if (state.visible.length === 0) return;
    state.cursor = (state.cursor - 1 + state.visible.length) % state.visible.length;
    renderResult();
  });
  query('[data-next]')?.addEventListener('click', () => {
    if (state.visible.length === 0) return;
    state.cursor = (state.cursor + 1) % state.visible.length;
    renderResult();
  });
  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'j') query('[data-next]')?.click();
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'k') query('[data-previous]')?.click();
  });

  readUrl();
  void load();
})();
