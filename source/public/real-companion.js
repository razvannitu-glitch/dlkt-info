(() => {
  'use strict';

  const VERSION = 'dlkt-info-real-companion-1';
  let snapshot = null;
  let index = 0;
  let etag = null;
  let loading = false;

  const select = (selector) => document.querySelector(selector);
  const selectAll = (selector) => Array.from(document.querySelectorAll(selector));
  const elements = {
    grid: select('[data-companion-grid]'), heroStatus: select('[data-hero-status]'), statusKicker: select('[data-status-kicker]'), statusValue: select('[data-status-value]'), statusCopy: select('[data-status-copy]'),
    verifiedCount: select('[data-verified-count]'), relevantCount: select('[data-relevant-count]'), sourceState: select('[data-source-state]'),
    topicList: select('[data-topic-list]'), entityList: select('[data-entity-list]'), trustLevel: select('[data-trust-level]'), authorityLevel: select('[data-authority-level]'), sourceMinimum: select('[data-source-minimum]'), evidenceAge: select('[data-evidence-age]'), cardBudget: select('[data-card-budget]'), actionableOnly: select('[data-actionable-only]'), materialityFloor: select('[data-materiality-floor]'),
    loadingState: select('[data-loading-state]'), emptyState: select('[data-empty-state]'), emptyKicker: select('[data-empty-kicker]'), emptyTitle: select('[data-empty-title]'), emptyCopy: select('[data-empty-copy]'), errorState: select('[data-error-state]'), errorCopy: select('[data-error-copy]'), card: select('[data-card]'),
    cardKind: select('[data-card-kind]'), cardFeed: select('[data-card-feed]'), cardTrust: select('[data-card-trust]'), cardPosition: select('[data-card-position]'), cardTotal: select('[data-card-total]'), cardCelex: select('[data-card-celex]'), cardTitle: select('[data-card-title]'), cardCreator: select('[data-card-creator]'), cardPublished: select('[data-card-published]'), cardObserved: select('[data-card-observed]'), changePanel: select('[data-change-panel]'), changedFields: select('[data-changed-fields]'), cardBefore: select('[data-card-before]'), cardNow: select('[data-card-now]'), reasonList: select('[data-reason-list]'), sourceName: select('[data-source-name]'), cardBaseline: select('[data-card-baseline]'), sourceLink: select('[data-source-link]'), legalBoundary: select('[data-legal-boundary]'), cardProgress: select('[data-card-progress]'), cardPrev: select('[data-card-prev]'), cardNext: select('[data-card-next]'),
    proofSourceState: select('[data-proof-source-state]'), proofFeedCount: select('[data-proof-feed-count]'), baselineAt: select('[data-baseline-at]'), baselineHash: select('[data-baseline-hash]'), currentCount: select('[data-current-count]'), topicExcluded: select('[data-topic-excluded]'), entityExcluded: select('[data-entity-excluded]'), trustExcluded: select('[data-trust-excluded]'), budgetHidden: select('[data-budget-hidden]'), lastVerified: select('[data-last-verified]'),
    refresh: selectAll('[data-refresh]'), configureLinks: selectAll('[data-configure-link]'),
  };

  const text = (node, value) => { if (node) node.textContent = String(value); };
  const pad = (value) => String(value).padStart(2, '0');
  const formatDate = (value) => {
    if (!value || !Number.isFinite(Date.parse(value))) return '—';
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
  };
  const shortHash = (value) => typeof value === 'string' && value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value || '—';
  const label = (value) => String(value).replaceAll('-', ' ');
  const companionSearch = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete('_vercel_share');
    const encoded = params.toString();
    return encoded ? `?${encoded}` : '';
  };

  const create = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  };

  function validPayload(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
      && value.version === VERSION && value.product === 'dlkt-info'
      && ['ready', 'caught-up', 'no-match', 'unavailable'].includes(value.resultState)
      && ['complete', 'partial', 'unavailable'].includes(value.sourceState)
      && value.preferences && Array.isArray(value.preferences.topics) && Array.isArray(value.preferences.entities)
      && value.trustPolicy && Array.isArray(value.cards) && value.counts && value.currentOfficial
      && value.cards.every((card) => card && typeof card === 'object' && ['new', 'changed'].includes(card.kind)
        && typeof card.celexId === 'string' && typeof card.title === 'string'
        && typeof card.sourceUrl === 'string' && card.aiInterpretation === false)
      && value.browserStorage === false && value.databaseUsed === false && value.databaseChanged === false
      && value.automaticPublication === false && value.automaticExecution === false
      && value.publicCardsCreated === false && value.aiInterpretation === false
      && !Object.prototype.hasOwnProperty.call(value, 'synthetic'));
  }

  function renderPills(container, values, emptyLabel) {
    if (!container) return;
    container.replaceChildren();
    if (!values.length) {
      const item = create('span', '', emptyLabel);
      item.dataset.empty = 'true';
      container.append(item);
      return;
    }
    values.forEach((value) => container.append(create('span', '', label(value))));
  }

  function renderContract() {
    const preferences = snapshot.preferences;
    const trust = snapshot.trustPolicy;
    renderPills(elements.topicList, preferences.topics, 'No topics');
    renderPills(elements.entityList, preferences.entities, 'Broad scope');
    text(elements.trustLevel, label(trust.minimumTrust));
    text(elements.authorityLevel, label(trust.authorityRequirement));
    text(elements.sourceMinimum, `${trust.minimumSources} requested`);
    text(elements.evidenceAge, `≤ ${trust.maximumEvidenceAgeHours}h`);
    text(elements.cardBudget, preferences.maxCards);
    text(elements.actionableOnly, preferences.onlyActionable ? 'Yes' : 'No');
    text(elements.materialityFloor, `${label(preferences.minMateriality)} · unassessed`);
    elements.configureLinks.forEach((link) => { link.href = `/start${companionSearch()}`; });
  }

  function renderProof() {
    const counts = snapshot.counts;
    const current = snapshot.currentOfficial;
    text(elements.proofSourceState, snapshot.sourceState.toUpperCase());
    text(elements.proofFeedCount, `${current.availableFeedCount}/${current.availableFeedCount + current.unavailableFeedCount}`);
    text(elements.baselineAt, formatDate(snapshot.baselineAt));
    text(elements.baselineHash, shortHash(snapshot.baselineHash));
    if (elements.baselineHash) elements.baselineHash.title = snapshot.baselineHash || '';
    text(elements.currentCount, current.availableCardCount);
    text(elements.topicExcluded, counts.topicExcludedCount);
    text(elements.entityExcluded, counts.entityExcludedCount);
    text(elements.trustExcluded, counts.trustExcludedCount);
    text(elements.budgetHidden, Math.max(0, counts.eligibleBeforeBudgetCount - counts.returnedCardCount));
  }

  function stateCopy() {
    if (snapshot.resultState === 'caught-up') return { kicker: 'CAUGHT UP', title: 'No verified changes.', copy: snapshot.caughtUpMessage || 'Nothing changed against the latest verified checkpoint.' };
    if (snapshot.resultState === 'no-match') return { kicker: 'NO MATCH', title: 'Nothing relevant now.', copy: snapshot.caughtUpMessage || 'Verified changes exist, but none match this Companion contract.' };
    return { kicker: 'UNAVAILABLE', title: 'Official sources unavailable.', copy: snapshot.caughtUpMessage || 'No unverified substitute was generated.' };
  }

  function showStage(target) {
    [elements.loadingState, elements.emptyState, elements.errorState, elements.card].forEach((element) => { if (element) element.hidden = element !== target; });
  }

  function renderHero() {
    const relevant = snapshot.cards.length;
    text(elements.verifiedCount, snapshot.counts.verifiedDeltaCount);
    text(elements.relevantCount, relevant);
    text(elements.sourceState, snapshot.sourceState.toUpperCase());
    elements.heroStatus.dataset.state = snapshot.resultState;
    if (snapshot.resultState === 'ready') {
      text(elements.statusKicker, 'RELEVANT NOW'); text(elements.statusValue, relevant); text(elements.statusCopy, relevant === 1 ? 'verified change' : 'verified changes');
    } else if (snapshot.resultState === 'caught-up') {
      text(elements.statusKicker, 'CAUGHT UP'); text(elements.statusValue, 0); text(elements.statusCopy, 'no verified changes');
    } else if (snapshot.resultState === 'no-match') {
      text(elements.statusKicker, 'FILTERED'); text(elements.statusValue, 0); text(elements.statusCopy, 'matching changes');
    } else {
      text(elements.statusKicker, 'SOURCE STATE'); text(elements.statusValue, '!'); text(elements.statusCopy, 'temporarily unavailable');
    }
  }

  function previousSummary(card) {
    if (!card.previous) return 'No prior state. This CELEX identity was absent from the previous verified checkpoint.';
    return `${card.previous.title} · ${card.previous.creator} · ${formatDate(card.previous.publishedAt)}`;
  }
  function currentSummary(card) { return `${card.title} · ${card.creator} · ${formatDate(card.publishedAt)}`; }

  function renderCard() {
    const cards = snapshot.cards;
    if (!cards.length) return;
    index = Math.min(Math.max(index, 0), cards.length - 1);
    const card = cards[index];
    text(elements.cardKind, card.kind === 'changed' ? 'OFFICIAL METADATA CHANGED' : 'NEW OFFICIAL LISTING');
    text(elements.cardFeed, card.feedLabel);
    text(elements.cardTrust, `${card.trustDecision.trust.toUpperCase()} · ${card.trustDecision.authority.toUpperCase()}`);
    text(elements.cardPosition, pad(index + 1));
    text(elements.cardTotal, pad(cards.length));
    text(elements.cardCelex, `CELEX ${card.celexId}`);
    text(elements.cardTitle, card.title);
    text(elements.cardCreator, card.creator);
    text(elements.cardPublished, formatDate(card.publishedAt));
    text(elements.cardObserved, formatDate(card.observedAt));
    elements.changePanel.hidden = card.kind !== 'changed';
    text(elements.changedFields, card.changedFields.length ? card.changedFields.map(label).join(' · ') : 'Official metadata changed');
    text(elements.cardBefore, previousSummary(card));
    text(elements.cardNow, currentSummary(card));
    elements.reasonList.replaceChildren();
    card.matchReasons.forEach((reason) => elements.reasonList.append(create('p', '', reason)));
    card.trustDecision.warnings.forEach((warning) => elements.reasonList.append(create('p', '', warning)));
    text(elements.sourceName, card.sourceName);
    text(elements.cardBaseline, formatDate(card.baselineAt));
    elements.sourceLink.href = card.sourceUrl;
    text(elements.legalBoundary, card.legalCaveat);
    text(elements.cardProgress, `${index + 1} of ${cards.length}`);
    elements.cardPrev.disabled = index === 0;
    elements.cardNext.disabled = index === cards.length - 1;
    showStage(elements.card);
  }

  function render() {
    elements.grid.setAttribute('aria-busy', 'false');
    renderContract(); renderProof(); renderHero();
    if (snapshot.resultState === 'ready' && snapshot.cards.length) renderCard();
    else if (snapshot.resultState === 'unavailable') {
      text(elements.errorCopy, snapshot.caughtUpMessage || 'The Companion did not substitute unverified information.');
      showStage(elements.errorState);
    } else {
      const copy = stateCopy();
      text(elements.emptyKicker, copy.kicker); text(elements.emptyTitle, copy.title); text(elements.emptyCopy, copy.copy);
      showStage(elements.emptyState);
    }
    text(elements.lastVerified, `Verified ${formatDate(snapshot.generatedAt)}`);
  }

  async function load() {
    if (loading) return;
    loading = true;
    elements.grid.setAttribute('aria-busy', 'true');
    showStage(elements.loadingState);
    try {
      const headers = { 'Content-Type': 'application/json', 'X-DLKT-Info-Request': 'companion-v1', 'Accept': 'application/json' };
      if (etag) headers['If-None-Match'] = etag;
      const response = await fetch('/api/companion', {
        method: 'POST', credentials: 'same-origin', headers,
        body: JSON.stringify({ search: companionSearch() }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 304 && snapshot) { render(); return; }
      const payload = await response.json();
      if (!validPayload(payload)) throw new Error('REAL_COMPANION_RESPONSE_INVALID');
      snapshot = Object.freeze(payload);
      etag = response.headers.get('etag');
      index = 0;
      render();
    } catch {
      snapshot = null;
      elements.grid.setAttribute('aria-busy', 'false');
      text(elements.errorCopy, 'Official verification failed. No unverified substitute was generated.');
      elements.heroStatus.dataset.state = 'unavailable';
      text(elements.statusKicker, 'SOURCE STATE'); text(elements.statusValue, '!'); text(elements.statusCopy, 'verification failed');
      showStage(elements.errorState);
      text(elements.lastVerified, 'Verification unavailable');
    } finally { loading = false; }
  }

  elements.cardPrev?.addEventListener('click', () => { if (index > 0) { index -= 1; renderCard(); } });
  elements.cardNext?.addEventListener('click', () => { if (snapshot && index < snapshot.cards.length - 1) { index += 1; renderCard(); } });
  elements.refresh.forEach((button) => button.addEventListener('click', load));
  document.addEventListener('keydown', (event) => {
    if (!snapshot?.cards.length) return;
    if (event.key === 'ArrowLeft' && index > 0) { index -= 1; renderCard(); }
    if (event.key === 'ArrowRight' && index < snapshot.cards.length - 1) { index += 1; renderCard(); }
  });

  Object.defineProperty(window, 'DLKTRealCompanion', { value: Object.freeze({ version: VERSION, reload: load }), writable: false, configurable: false });
  load();
})();
