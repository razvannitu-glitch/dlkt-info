(() => {
  'use strict';

  const API = '/api/eu-official-live';
  const MARKER = 'eu-live-v1';
  const allowedFeeds = new Set(['all', 'commission-proposals', 'parliament-council-legislation']);
  const state = { snapshot: null, feed: 'all', budget: 6, index: 0, loading: false };

  const select = (value) => document.querySelector(value);
  const selectAll = (value) => [...document.querySelectorAll(value)];
  const elements = {
    shell: select('[data-live-shell]'), total: select('[data-live-total]'), feeds: select('[data-live-feeds]'), returned: select('[data-live-returned]'),
    budget: select('[data-budget]'), reload: select('[data-reload]'), statusTitle: select('[data-status-title]'), statusCopy: select('[data-status-copy]'),
    queue: select('[data-queue-list]'), queueCount: select('[data-queue-count]'), queueEnd: select('[data-queue-end]'),
    cardState: select('[data-card-state]'), cardCelex: select('[data-card-celex]'), cardPosition: select('[data-card-position]'), cardFeed: select('[data-card-feed]'),
    cardTitle: select('[data-card-title]'), cardCreator: select('[data-card-creator]'), cardStateCopy: select('[data-card-state-copy]'), cardPublished: select('[data-card-published]'),
    cardObserved: select('[data-card-observed]'), cardCaveat: select('[data-card-caveat]'), previous: select('[data-previous]'), next: select('[data-next]'), progress: select('[data-progress]'),
    sourceName: select('[data-source-name]'), sourceAuthority: select('[data-source-authority]'), sourceExpiry: select('[data-source-expiry]'), sourceFeedStatus: select('[data-source-feed-status]'),
    sourceLink: select('[data-source-link]'), termsLink: select('[data-terms-link]'), diagnostics: select('[data-diagnostics]'), boundaries: select('[data-boundaries]'),
    error: select('[data-error]'), errorRetry: select('[data-error-retry]'),
  };

  const required = Object.values(elements).every(Boolean);
  if (!required) return;

  const text = (node, value) => { node.textContent = String(value); };
  const positiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
  const safeDate = (value) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp) : 'Unavailable';
  };
  const safeOfficialUrl = (value) => {
    try {
      const url = new URL(value);
      return url.origin === 'https://eur-lex.europa.eu' && url.pathname === '/legal-content/AUTO/' ? url.href : null;
    } catch { return null; }
  };
  const safeTermsUrl = (value) => {
    try {
      const url = new URL(value);
      return url.origin === 'https://eur-lex.europa.eu' && url.pathname.startsWith('/content/legal-notice/') ? url.href : null;
    } catch { return null; }
  };

  const validateCard = (card) => card && typeof card === 'object'
    && typeof card.id === 'string' && typeof card.feedId === 'string'
    && ['commission-proposals', 'parliament-council-legislation'].includes(card.feedKind)
    && typeof card.feedLabel === 'string' && typeof card.celexId === 'string'
    && typeof card.title === 'string' && typeof card.creator === 'string'
    && safeOfficialUrl(card.sourceUrl) !== null && typeof card.publishedAt === 'string'
    && typeof card.observedAt === 'string' && typeof card.legalCaveat === 'string'
    && card.trust === 'official-source' && card.deltaStatus === 'not-available-without-baseline'
    && card.aiInterpretation === false && card.source && card.source.authority === 'official'
    && safeTermsUrl(card.source.termsUrl) !== null;

  const validateSnapshot = (snapshot) => snapshot && typeof snapshot === 'object'
    && snapshot.version === 'dlkt-info-live-official-snapshot-1'
    && snapshot.product === 'dlkt-info' && snapshot.mode === 'live-read-only'
    && snapshot.deltaAvailable === false && snapshot.databaseUsed === false
    && snapshot.persistenceUsed === false && snapshot.databaseChanged === false
    && snapshot.automaticPublication === false && snapshot.publicCardsCreated === false
    && snapshot.aiInterpretation === false && Array.isArray(snapshot.feeds)
    && Array.isArray(snapshot.cards) && snapshot.cards.every(validateCard)
    && Array.isArray(snapshot.boundaries) && snapshot.boundaries.every((entry) => typeof entry === 'string');

  const filtered = () => {
    if (!state.snapshot) return [];
    const cards = state.feed === 'all' ? state.snapshot.cards : state.snapshot.cards.filter((card) => card.feedKind === state.feed);
    return cards.slice(0, state.budget);
  };

  const updateUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('cards', String(state.budget));
    if (state.feed === 'all') url.searchParams.delete('feed'); else url.searchParams.set('feed', state.feed);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const create = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };

  const renderQueue = (cards) => {
    const nodes = cards.map((card, index) => {
      const button = create('button', index === state.index ? 'is-active' : '');
      button.type = 'button';
      button.setAttribute('aria-current', index === state.index ? 'true' : 'false');
      const number = create('span', '', String(index + 1).padStart(2, '0'));
      const copy = create('div');
      copy.append(create('b', '', card.celexId), create('small', '', card.stateLabel));
      button.append(number, copy);
      button.addEventListener('click', () => { state.index = index; render(); });
      return button;
    });
    elements.queue.replaceChildren(...nodes);
    text(elements.queueCount, `${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`);
    elements.queueEnd.hidden = cards.length === 0;
  };

  const renderDiagnostics = () => {
    if (!state.snapshot) return;
    const nodes = state.snapshot.feeds.map((feed) => {
      const article = create('article', 'diagnostic-card');
      article.append(create('span', '', feed.status === 'available' ? 'AVAILABLE' : 'UNAVAILABLE'));
      article.append(create('h3', '', feed.label));
      article.append(create('p', '', feed.status === 'available'
        ? 'Official XML fetched, parsed and authorized through Source Registry.'
        : `No cards accepted. ${feed.errorCode ?? 'Source unavailable.'}`));
      const facts = create('dl');
      const fact = (label, value) => { const row = create('div'); row.append(create('dt', '', label), create('dd', '', value)); return row; };
      facts.append(
        fact('Entries', String(feed.entryCount)),
        fact('Authorized claims', String(feed.authorizedClaimCount)),
        fact('Retrieved', feed.retrievedAt ? safeDate(feed.retrievedAt) : 'Not retrieved'),
        fact('Feed state', feed.status),
      );
      article.append(facts);
      return article;
    });
    elements.diagnostics.replaceChildren(...nodes);
  };

  const renderBoundaries = () => {
    if (!state.snapshot) return;
    elements.boundaries.replaceChildren(...state.snapshot.boundaries.map((boundary, index) => {
      const item = create('article', 'boundary-item');
      item.append(create('b', '', String(index + 1).padStart(2, '0')), create('p', '', boundary));
      return item;
    }));
  };

  const renderCard = (cards) => {
    const card = cards[state.index];
    if (!card) return;
    text(elements.cardState, card.stateLabel);
    text(elements.cardCelex, card.celexId);
    text(elements.cardPosition, `${state.index + 1} / ${cards.length}`);
    text(elements.cardFeed, card.feedLabel);
    text(elements.cardTitle, card.title);
    text(elements.cardCreator, card.creator);
    text(elements.cardStateCopy, card.stateLabel);
    text(elements.cardPublished, safeDate(card.publishedAt));
    text(elements.cardObserved, safeDate(card.observedAt));
    text(elements.cardCaveat, card.legalCaveat);
    text(elements.sourceName, card.source.name);
    text(elements.sourceAuthority, 'Official');
    text(elements.sourceExpiry, safeDate(card.source.rightsReviewExpiresAt));
    const feed = state.snapshot.feeds.find((entry) => entry.id === card.feedId);
    text(elements.sourceFeedStatus, feed?.status ?? 'unknown');
    elements.sourceLink.href = safeOfficialUrl(card.sourceUrl) ?? '/';
    elements.termsLink.href = safeTermsUrl(card.source.termsUrl) ?? '/';
    elements.previous.disabled = state.index === 0;
    elements.next.disabled = state.index >= cards.length - 1;
    elements.progress.style.width = `${((state.index + 1) / cards.length) * 100}%`;
  };

  const render = () => {
    if (!state.snapshot) return;
    const cards = filtered();
    if (state.index >= cards.length) state.index = Math.max(0, cards.length - 1);
    text(elements.total, state.snapshot.availableCardCount);
    text(elements.feeds, state.snapshot.feeds.filter((feed) => feed.status === 'available').length);
    text(elements.returned, cards.length);
    text(elements.statusTitle, state.snapshot.partial ? 'Partial official snapshot' : 'Official sources validated');
    text(elements.statusCopy, cards.length === 0
      ? 'The selected filter produced zero cards. No content was invented.'
      : `${cards.length} of ${state.snapshot.availableCardCount} available official listings are inside the current finite budget.`);
    renderQueue(cards);
    renderDiagnostics();
    renderBoundaries();
    elements.shell.hidden = cards.length === 0;
    if (cards.length > 0) renderCard(cards);
  };

  const setLoading = (loading) => {
    state.loading = loading;
    elements.reload.disabled = loading;
    text(elements.reload.querySelector('span'), loading ? 'Loading official sources' : 'Reload snapshot');
  };

  const load = async () => {
    if (state.loading) return;
    setLoading(true);
    elements.error.hidden = true;
    try {
      const response = await fetch(API, {
        method: 'GET', credentials: 'same-origin', cache: 'default',
        headers: { Accept: 'application/json', 'X-DLKT-Info-Request': MARKER },
      });
      if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('application/json')) throw new Error('LIVE_RESPONSE_INVALID');
      const payload = await response.json();
      if (!validateSnapshot(payload)) throw new Error('LIVE_PAYLOAD_INVALID');
      state.snapshot = Object.freeze(payload);
      state.index = 0;
      render();
    } catch {
      state.snapshot = null;
      elements.shell.hidden = true;
      elements.error.hidden = false;
      text(elements.statusTitle, 'Official snapshot unavailable');
      text(elements.statusCopy, 'No card was generated and no state was changed.');
    } finally {
      setLoading(false);
    }
  };

  const query = new URLSearchParams(window.location.search);
  state.budget = positiveInteger(query.get('cards'), 6);
  state.feed = allowedFeeds.has(query.get('feed')) ? query.get('feed') : 'all';
  elements.budget.value = String(state.budget);
  selectAll('[data-feed]').forEach((button) => {
    const active = button.dataset.feed === state.feed;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', () => {
      state.feed = allowedFeeds.has(button.dataset.feed) ? button.dataset.feed : 'all';
      state.index = 0;
      selectAll('[data-feed]').forEach((candidate) => {
        const selected = candidate.dataset.feed === state.feed;
        candidate.classList.toggle('is-active', selected);
        candidate.setAttribute('aria-pressed', String(selected));
      });
      updateUrl();
      render();
    });
  });
  elements.budget.addEventListener('change', () => {
    state.budget = positiveInteger(elements.budget.value, state.budget);
    elements.budget.value = String(state.budget);
    state.index = 0;
    updateUrl();
    render();
  });
  elements.previous.addEventListener('click', () => { if (state.index > 0) { state.index -= 1; render(); } });
  elements.next.addEventListener('click', () => { if (state.index < filtered().length - 1) { state.index += 1; render(); } });
  elements.reload.addEventListener('click', load);
  elements.errorRetry.addEventListener('click', load);
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowLeft' && state.index > 0) { state.index -= 1; render(); }
    if (event.key === 'ArrowRight' && state.index < filtered().length - 1) { state.index += 1; render(); }
  });
  updateUrl();
  void load();
})();
