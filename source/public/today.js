(() => {
  'use strict';

  const historyData = window.DLKTBriefingHistory;

  const allCards = Object.freeze([
    Object.freeze({
      id: 'demo-tech-pricing', topic: 'Technology', topicId: 'technology', actionable: true, mapLabel: 'API pricing', kind: 'Changed', trust: 'Confirmed', entity: 'DEMO AI Platform', observed: 'Observed 07:42', theme: 'white', materiality: 'High', score: 96,
      title: 'An API price moved from announced to active.',
      direct: 'The new rate is now present in the official pricing state, not only in a future announcement.',
      before: 'New pricing announced for a later date.', now: 'New pricing listed as active.',
      why: 'It changes the operating cost of products that depend on this API.', action: 'Review usage-heavy flows before the next billing cycle.',
      reason: 'You follow AI infrastructure, API economics and material product changes.', nextSignal: 'A revised enterprise tier or migration credit published by the same official source.',
      ruleTopic: 'AI infrastructure', ruleCopy: 'Material changes only · Official sources preferred', sourceState: 'Confirmed by two sources', sourceAge: 'Latest evidence observed 18 minutes ago.', sidebarNext: 'Enterprise pricing and migration credits',
      sources: Object.freeze([
        Object.freeze({ title: 'DEMO AI Platform · Official pricing', authority: 'Official', observed: 'Observed 07:42', detail: 'Pricing state and effective date verified.' }),
        Object.freeze({ title: 'DEMO AI Platform · Developer update', authority: 'Primary', observed: 'Observed 07:45', detail: 'Implementation notice confirms activation.' }),
      ]),
    }),
    Object.freeze({
      id: 'demo-market-entry', topic: 'Business', topicId: 'business', actionable: true, mapLabel: 'Competitor move', kind: 'New', trust: 'Confirmed', entity: 'DEMO Competitor', observed: 'Observed 06:55', theme: 'black', materiality: 'High', score: 92,
      title: 'A competitor entered a market you track.',
      direct: 'The company opened local availability in a country that was previously waitlist-only.',
      before: 'Country available only through an interest waitlist.', now: 'Commercial availability listed as open.',
      why: 'It changes the competitive landscape and may validate demand in that market.', action: 'Compare local pricing, positioning and partner strategy.',
      reason: 'You track competitor expansion, product launches and European markets.', nextSignal: 'Local customer references, reseller appointments or a localized price page.',
      ruleTopic: 'Competitor intelligence', ruleCopy: 'Market entries · Pricing · Partnerships', sourceState: 'Official launch state confirmed', sourceAge: 'Latest evidence observed 65 minutes ago.', sidebarNext: 'Local pricing and partner announcements',
      sources: Object.freeze([
        Object.freeze({ title: 'DEMO Competitor · Availability page', authority: 'Official', observed: 'Observed 06:55', detail: 'Country status changed from waitlist to available.' }),
      ]),
    }),
    Object.freeze({
      id: 'demo-eu-consultation', topic: 'Regulation', topicId: 'regulation', actionable: true, mapLabel: 'EU consultation', kind: 'Changed', trust: 'Confirmed', entity: 'DEMO EU File', observed: 'Observed 05:20', theme: 'coral', materiality: 'Medium', score: 88,
      title: 'An EU consultation moved from announced to open.',
      direct: 'The submission window is active and now has a verified closing date.',
      before: 'Consultation announced without an active submission form.', now: 'Submission form open until 18 December.',
      why: 'It creates a limited window to influence rules relevant to digital services.', action: 'Decide whether to submit directly or through an industry association.',
      reason: 'You follow EU regulation, digital policy and opportunities to participate.', nextSignal: 'A deadline change, supporting questionnaire update or published stakeholder summary.',
      ruleTopic: 'EU digital regulation', ruleCopy: 'Official milestones · Participation windows', sourceState: 'Official regulatory source', sourceAge: 'Latest evidence observed 2 hours ago.', sidebarNext: 'Deadline and consultation document revisions',
      sources: Object.freeze([
        Object.freeze({ title: 'DEMO EU Portal · Consultation record', authority: 'Official', observed: 'Observed 05:20', detail: 'Status, form and deadline verified.' }),
        Object.freeze({ title: 'DEMO Directorate · Supporting note', authority: 'Official', observed: 'Observed 05:24', detail: 'Scope and participation terms verified.' }),
      ]),
    }),
    Object.freeze({
      id: 'demo-grant-window', topic: 'Opportunity', topicId: 'opportunities', actionable: true, mapLabel: 'Funding window', kind: 'New', trust: 'Confirmed', entity: 'DEMO Innovation Fund', observed: 'Observed 04:10', theme: 'white', materiality: 'High', score: 94,
      title: 'A funding window relevant to your work is now open.',
      direct: 'The call accepts applications and the official documents now define eligible applicants and budget.',
      before: 'Programme listed in the annual plan only.', now: 'Application portal open with final documents.',
      why: 'The eligibility profile matches digital community and information infrastructure projects.', action: 'Run a ten-minute eligibility screen before investing in a consortium.',
      reason: 'You asked DLKT to prioritize actionable European funding opportunities.', nextSignal: 'Partner-search events, corrigenda or a revised applicant guide.',
      ruleTopic: 'Funding opportunities', ruleCopy: 'Actionable only · Eligibility match required', sourceState: 'Official call documents available', sourceAge: 'Latest evidence observed 3 hours ago.', sidebarNext: 'Partner search and applicant-guide changes',
      sources: Object.freeze([
        Object.freeze({ title: 'DEMO Funding Portal · Call page', authority: 'Official', observed: 'Observed 04:10', detail: 'Open status, deadline and budget verified.' }),
        Object.freeze({ title: 'DEMO Programme · Applicant guide', authority: 'Official', observed: 'Observed 04:12', detail: 'Eligibility criteria verified.' }),
      ]),
    }),
    Object.freeze({
      id: 'demo-route', topic: 'Travel', topicId: 'travel', actionable: false, mapLabel: 'Direct route', kind: 'New', trust: 'Single-source', entity: 'DEMO Airline', observed: 'Observed 03:05', theme: 'black', materiality: 'Medium', score: 79,
      title: 'A direct route was added for the summer schedule.',
      direct: 'A non-stop connection now appears in the airline schedule for the dates you monitor.',
      before: 'Only connecting itineraries were available.', now: 'Three direct weekly flights appear in schedule.',
      why: 'It reduces travel time for a destination saved in your companion profile.', action: 'Track fare publication before deciding; the schedule may still change.',
      reason: 'You follow selected destinations and asked for new direct routes, not general travel news.', nextSignal: 'Bookable fares, airport confirmation or a schedule revision.',
      ruleTopic: 'Selected travel routes', ruleCopy: 'Direct connections · Material schedule changes', sourceState: 'One primary source only', sourceAge: 'Latest evidence observed 4 hours ago.', sidebarNext: 'Bookable inventory and airport confirmation',
      sources: Object.freeze([
        Object.freeze({ title: 'DEMO Airline · Seasonal timetable', authority: 'Primary', observed: 'Observed 03:05', detail: 'Route and weekly frequency present; fares not yet published.' }),
      ]),
    }),
    Object.freeze({
      id: 'demo-supply', topic: 'Supply', topicId: 'supply', actionable: false, mapLabel: 'Component status', kind: 'Changed', trust: 'Conflicting', entity: 'DEMO Component', observed: 'Observed 02:18', theme: 'coral', materiality: 'High', score: 73,
      title: 'A critical component moved to available, but one distributor still shows delay.',
      direct: 'The manufacturer lists availability while a secondary distributor still reports a four-week lead time.',
      before: 'Manufacturer and distributor both showed waitlist.', now: 'Manufacturer available · Distributor delayed.',
      why: 'The change may unblock a project, but the contradictory state requires confirmation before purchase.', action: 'Verify the exact SKU with the manufacturer and avoid treating the secondary listing as resolved.',
      reason: 'You follow a critical component and asked to preserve contradictions rather than average them away.', nextSignal: 'Distributor stock refresh or a manufacturer allocation notice for the exact SKU.',
      ruleTopic: 'Critical supply watch', ruleCopy: 'Contradictions visible · Exact SKU required', sourceState: 'Active contradiction', sourceAge: 'Latest evidence observed 5 hours ago.', sidebarNext: 'Distributor refresh for the exact SKU',
      sources: Object.freeze([
        Object.freeze({ title: 'DEMO Manufacturer · Product availability', authority: 'Official', observed: 'Observed 02:18', detail: 'Exact SKU listed as available.' }),
        Object.freeze({ title: 'DEMO Distributor · Inventory page', authority: 'Secondary', observed: 'Observed 02:20', detail: 'Exact SKU lists a four-week lead time.' }),
      ]),
    }),
  ]);

  const bridgeApi = window.DLKTCompanionBridge;
  const bridgeResult = bridgeApi && typeof bridgeApi.parseSearch === 'function'
    ? bridgeApi.parseSearch(window.location.search)
    : Object.freeze({ state: 'invalid', definition: null, reason: 'BRIDGE_UNAVAILABLE' });
  const bridgeDefinition = bridgeResult.state === 'valid' ? bridgeResult.definition : null;
  const trustApi = window.DLKTTrustControl;
  const trustResult = trustApi && typeof trustApi.parseSearch === 'function'
    ? trustApi.parseSearch(window.location.search)
    : Object.freeze({ state: 'invalid', policy: null, reason: 'TRUST_CONTROL_UNAVAILABLE' });
  const trustPolicy = trustResult.state === 'valid' ? trustResult.policy : null;
  const trustProjection = trustPolicy && typeof trustApi.project === 'function' ? trustApi.project(trustPolicy) : null;
  const trustedIds = trustProjection ? new Set(trustProjection.includedIds) : null;
  const actionApi = window.DLKTActionControl;
  if (!actionApi || typeof actionApi.parseSearch !== 'function') throw new Error('ACTION_CONTROL_UNAVAILABLE');
  const actionResult = actionApi.parseSearch(window.location.search);
  const initialActions = actionResult.state === 'valid'
    ? actionApi.cloneSelections(actionResult.selections)
    : actionApi.emptySelections();
  const materialityRank = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
  const topicLabels = Object.freeze({ technology: 'Technology', business: 'Business', regulation: 'Regulation', opportunities: 'Opportunities', supply: 'Supply' });
  const companionCandidates = bridgeDefinition
    ? [...allCards]
        .filter((card) => bridgeDefinition.topics.includes(card.topicId))
        .filter((card) => materialityRank[card.materiality.toLowerCase()] >= materialityRank[bridgeDefinition.minMateriality])
        .filter((card) => !bridgeDefinition.onlyActionable || card.actionable === true)
    : [...allCards];
  const trustedCandidates = trustedIds ? companionCandidates.filter((card) => trustedIds.has(card.id)) : companionCandidates;
  const rankedCandidates = bridgeDefinition
    ? [...trustedCandidates].sort((left, right) => right.score - left.score)
    : [...trustedCandidates];
  const cards = Object.freeze(rankedCandidates.slice(0, bridgeDefinition?.maxCards ?? allCards.length));

  const state = {
    index: 0,
    read: new Set(),
    feedback: new Map(),
    followed: new Set(),
    actions: initialActions,
    wheelLocked: false,
    pointerStartX: null,
    pointerStartY: null,
    toastTimer: null,
  };

  const elements = {
    shell: document.querySelector('[data-briefing-shell]'),
    briefingLabel: document.querySelector('[data-briefing-label]'),
    bridgeBanner: document.querySelector('[data-bridge-banner]'),
    bridgeState: document.querySelector('[data-bridge-state]'),
    bridgeSummary: document.querySelector('[data-bridge-summary]'),
    trustBanner: document.querySelector('[data-trust-banner]'),
    trustState: document.querySelector('[data-trust-state]'),
    trustSummary: document.querySelector('[data-trust-summary]'),
    trustLinks: Array.from(document.querySelectorAll('[data-open-trust]')),
    actionLinks: Array.from(document.querySelectorAll('[data-open-actions]')),
    inboxLinks: Array.from(document.querySelectorAll('[data-open-inbox]')),
    deliveryLinks: Array.from(document.querySelectorAll('[data-open-delivery]')),
    empty: document.querySelector('[data-empty]'),
    emptyReason: document.querySelector('[data-empty-reason]'),
    completeNext: document.querySelector('[data-complete-next]'),
    currentDate: document.querySelector('[data-current-date]'),
    progressCurrent: document.querySelector('[data-progress-current]'),
    progressTotal: document.querySelector('[data-progress-total]'),
    progressBar: document.querySelector('[data-progress-bar]'),
    readingTime: document.querySelector('[data-reading-time]'),
    unreadCount: document.querySelector('[data-unread-count]'),
    map: document.querySelector('[data-briefing-map]'),
    stage: document.querySelector('[data-card-stage]'),
    card: document.querySelector('[data-daily-card]'),
    watermark: document.querySelector('[data-card-watermark]'),
    topic: document.querySelector('[data-card-topic]'),
    kind: document.querySelector('[data-card-kind]'),
    trust: document.querySelector('[data-card-trust]'),
    historyStatus: document.querySelector('[data-card-history-status]'),
    historyRank: document.querySelector('[data-history-rank]'),
    historyMove: document.querySelector('[data-history-move]'),
    historyRanking: document.querySelector('[data-history-ranking]'),
    historyMemory: document.querySelector('[data-history-memory]'),
    observed: document.querySelector('[data-card-observed]'),
    entity: document.querySelector('[data-card-entity]'),
    title: document.querySelector('[data-card-title]'),
    direct: document.querySelector('[data-card-direct]'),
    before: document.querySelector('[data-card-before]'),
    now: document.querySelector('[data-card-now]'),
    why: document.querySelector('[data-card-why]'),
    action: document.querySelector('[data-card-action]'),
    materiality: document.querySelector('[data-card-materiality]'),
    sourceCount: document.querySelector('[data-card-source-count]'),
    score: document.querySelector('[data-card-score]'),
    reason: document.querySelector('[data-card-reason]'),
    nextSignal: document.querySelector('[data-card-next-signal]'),
    sidebarNext: document.querySelector('[data-sidebar-next-signal]'),
    ruleTopic: document.querySelector('[data-rule-topic]'),
    ruleCopy: document.querySelector('[data-rule-copy]'),
    sourceState: document.querySelector('[data-source-state]'),
    sourceAge: document.querySelector('[data-source-age]'),
    previous: document.querySelector('[data-card-previous]'),
    next: document.querySelector('[data-card-next]'),
    feedbackButtons: Array.from(document.querySelectorAll('[data-feedback]')),
    follow: document.querySelector('[data-follow-entity]'),
    contextToggle: document.querySelector('[data-toggle-context]'),
    contextDrawer: document.querySelector('[data-context-drawer]'),
    sourceDialog: document.querySelector('[data-sources-dialog]'),
    sourceList: document.querySelector('[data-sources-list]'),
    openSources: document.querySelector('[data-open-sources]'),
    actionDialog: document.querySelector('[data-action-dialog]'),
    openActionDialog: document.querySelector('[data-open-action-dialog]'),
    actionCount: document.querySelector('[data-card-action-count]'),
    actionDialogTopic: document.querySelector('[data-action-dialog-topic]'),
    actionDialogTitle: document.querySelector('[data-action-dialog-title]'),
    actionDialogEntity: document.querySelector('[data-action-dialog-entity]'),
    actionButtons: Array.from(document.querySelectorAll('[data-card-action-type]')),
    complete: document.querySelector('[data-complete]'),
    completeCount: document.querySelector('[data-complete-count]'),
    completeRelevant: document.querySelector('[data-complete-relevant]'),
    completeFollowed: document.querySelector('[data-complete-followed]'),
    completeActions: document.querySelector('[data-complete-actions]'),
    reviewBriefing: document.querySelector('[data-review-briefing]'),
    toast: document.querySelector('[data-toast]'),
    toastTitle: document.querySelector('[data-toast-title]'),
    toastCopy: document.querySelector('[data-toast-copy]'),
    memoryLinks: Array.from(document.querySelectorAll('[data-open-memory]')),
  };

  const pad = (value) => String(value).padStart(2, '0');
  const safeText = (value, fallback = '') => typeof value === 'string' && value.length <= 900 ? value : fallback;
  const create = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  const titleCaseMateriality = (value) => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  const trustLabel = (value) => String(value).split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');

  function renderBridgeProjection() {
    if (bridgeResult.state === 'absent') return;
    elements.bridgeBanner.hidden = false;
    if (bridgeResult.state === 'invalid') {
      elements.bridgeState.textContent = 'Invalid Companion link';
      elements.bridgeSummary.textContent = 'The unsafe or incomplete configuration was ignored. Full synthetic preview loaded.';
      return;
    }
    const topics = bridgeDefinition.topics.map((topic) => topicLabels[topic]).join(' · ');
    elements.bridgeState.textContent = 'Built from Companion';
    elements.bridgeSummary.textContent = `${topics} · ${titleCaseMateriality(bridgeDefinition.minMateriality)}+ · ${bridgeDefinition.maxCards} max${bridgeDefinition.onlyActionable ? ' · Actionable only' : ''}`;
    elements.briefingLabel.textContent = `Personal briefing · ${bridgeDefinition.deliveryLocalTime}`;
    elements.completeNext.textContent = `Next scheduled briefing · Tomorrow at ${bridgeDefinition.deliveryLocalTime} · ${bridgeDefinition.timezone}`;
  }

  function renderTrustProjection() {
    const controlPolicy = trustPolicy ?? trustApi?.defaultPolicy ?? null;
    const trustHref = controlPolicy && typeof trustApi?.buildTrustUrl === 'function'
      ? trustApi.buildTrustUrl(controlPolicy, window.location.search)
      : '/trust';
    elements.trustLinks.forEach((link) => { link.href = trustHref; });
    if (trustResult.state === 'absent') return;
    elements.trustBanner.hidden = false;
    if (trustResult.state === 'invalid') {
      elements.trustState.textContent = 'Invalid trust link';
      elements.trustSummary.textContent = 'Unsafe or incomplete evidence rules were ignored. The safe synthetic preview was loaded.';
      return;
    }
    const conflict = trustPolicy.conflictPolicy === 'exclude' ? 'Conflicts excluded' : 'Conflicts shown with warning';
    elements.trustState.textContent = 'Trust policy applied';
    elements.trustSummary.textContent = `${trustLabel(trustPolicy.minimumTrust)}+ · ${trustPolicy.minimumSources} source${trustPolicy.minimumSources === 1 ? '' : 's'} · ${trustLabel(trustPolicy.authorityRequirement)}+ · ${conflict}`;
  }

  function renderEmptyState() {
    elements.shell.hidden = true;
    elements.empty.hidden = false;
    const topics = bridgeDefinition ? bridgeDefinition.topics.map((topic) => topicLabels[topic]).join(', ') : 'the selected topics';
    const trustReason = trustPolicy ? ' and passed your evidence policy' : '';
    elements.emptyReason.textContent = `No ${bridgeDefinition?.minMateriality ?? 'selected'}-or-higher ${bridgeDefinition?.onlyActionable ? 'actionable ' : ''}change matched ${topics}${trustReason}.`;
  }

  function showToast(title, copy) {
    if (!elements.toast) return;
    elements.toastTitle.textContent = title;
    elements.toastCopy.textContent = copy;
    elements.toast.hidden = false;
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2600);
  }

  function buildMap() {
    elements.map.replaceChildren();
    cards.forEach((card, index) => {
      const button = create('button', 'map-item');
      button.type = 'button';
      button.dataset.cardIndex = String(index);
      button.setAttribute('aria-label', `Open card ${index + 1}: ${card.mapLabel}`);
      button.append(create('span', '', pad(index + 1)), create('strong', '', card.mapLabel), create('i'));
      button.addEventListener('click', () => goTo(index));
      elements.map.append(button);
    });
  }

  function renderMap() {
    const buttons = Array.from(elements.map.querySelectorAll('[data-card-index]'));
    buttons.forEach((button, index) => {
      button.classList.toggle('is-active', index === state.index);
      button.classList.toggle('is-read', state.read.has(cards[index].id));
      button.setAttribute('aria-current', index === state.index ? 'step' : 'false');
    });
  }

  function renderSources(card) {
    elements.sourceList.replaceChildren();
    card.sources.forEach((source, index) => {
      const row = create('article', 'source-row');
      const number = create('span', 'source-index', pad(index + 1));
      const copy = create('div');
      copy.append(create('strong', '', safeText(source.title, 'Verified source')));
      copy.append(create('p', '', `${safeText(source.observed, 'Observed')} · ${safeText(source.detail, 'Evidence verified.')}`));
      const authority = create('span', 'source-authority', safeText(source.authority, 'Source'));
      row.append(number, copy, authority);
      elements.sourceList.append(row);
    });
  }

  function memoryControlHref() {
    const relevant = [];
    const less = [];
    const follow = [];
    cards.forEach((candidate) => {
      const feedback = state.feedback.get(candidate.id);
      if (feedback === 'relevant') relevant.push(candidate.id);
      if (feedback === 'less') less.push(candidate.id);
      if (state.followed.has(candidate.entity)) follow.push(candidate.id);
    });
    const parameters = new URLSearchParams();
    if (relevant.length) parameters.set('relevant', relevant.join(','));
    if (less.length) parameters.set('less', less.join(','));
    if (follow.length) parameters.set('follow', follow.join(','));
    const query = parameters.toString();
    return query ? `/memory?${query}` : '/memory';
  }

  function updateMemoryLinks() {
    const href = memoryControlHref();
    elements.memoryLinks.forEach((link) => { link.href = href; });
  }

  function actionControlHref(route = '/actions') {
    return actionApi.buildUrl(state.actions, window.location.search, route);
  }

  function updateActionLinks() {
    const actionsHref = actionControlHref('/actions');
    const inboxHref = actionControlHref('/inbox');
    const deliveryHref = actionControlHref('/delivery');
    elements.actionLinks.forEach((link) => { link.href = actionsHref; });
    elements.inboxLinks.forEach((link) => { link.href = inboxHref; });
    elements.deliveryLinks.forEach((link) => { link.href = deliveryHref; });
  }

  function actionTypesFor(cardId) {
    return actionApi.actionOrder.filter((type) => state.actions[actionApi.keyByType[type]].includes(cardId));
  }

  function renderActionState(card) {
    const active = actionTypesFor(card.id);
    elements.actionCount.textContent = String(active.length);
    elements.openActionDialog.classList.toggle('is-active', active.length > 0);
    elements.openActionDialog.setAttribute('aria-label', active.length > 0
      ? `Manage ${active.length} explicit action${active.length === 1 ? '' : 's'} for ${card.mapLabel}`
      : `Act on ${card.mapLabel}`);
    elements.actionDialogTopic.textContent = card.topic;
    elements.actionDialogTitle.textContent = card.mapLabel;
    elements.actionDialogEntity.textContent = card.entity;
    elements.actionButtons.forEach((button) => {
      const type = button.dataset.cardActionType;
      const pressed = active.includes(type);
      button.setAttribute('aria-pressed', String(pressed));
      button.classList.toggle('is-active', pressed);
      const status = button.lastElementChild;
      if (status) status.textContent = pressed ? 'Active' : 'Off';
    });
    updateActionLinks();
  }

  function toggleAction(type) {
    if (!actionApi.actionOrder.includes(type)) return;
    const card = cards[state.index];
    const key = actionApi.keyByType[type];
    const wasActive = state.actions[key].includes(card.id);
    if (type === 'ignore-pattern') {
      Object.keys(actionApi.typeByKey).forEach((actionKey) => {
        state.actions[actionKey] = state.actions[actionKey].filter((id) => id !== card.id);
      });
      if (!wasActive) state.actions.ignore = [...state.actions.ignore, card.id];
    } else {
      state.actions.ignore = state.actions.ignore.filter((id) => id !== card.id);
      state.actions[key] = wasActive
        ? state.actions[key].filter((id) => id !== card.id)
        : [...state.actions[key], card.id];
    }
    state.actions = actionApi.normalizeSelections(state.actions);
    renderActionState(card);
    const definition = actionApi.definitions[type];
    showToast(wasActive ? 'Action removed' : 'Action added', wasActive
      ? 'The explicit action was removed from this session.'
      : definition.effect);
  }

  function renderFeedback(card) {
    const currentFeedback = state.feedback.get(card.id) ?? null;
    elements.feedbackButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.feedback === currentFeedback));
    });
    elements.follow.setAttribute('aria-pressed', String(state.followed.has(card.entity)));
    elements.follow.textContent = state.followed.has(card.entity) ? 'Following entity' : 'Follow entity';
    updateMemoryLinks();
  }

  function renderHistory(card) {
    const history = historyData?.cardHistory?.[card.id] ?? null;
    if (!history) {
      elements.historyStatus.textContent = card.kind === 'New' ? 'New since last briefing' : 'Changed since last briefing';
      elements.historyRank.textContent = `#${state.index + 1}`;
      elements.historyMove.textContent = 'Current briefing rank';
      elements.historyMemory.textContent = 'No synthetic memory explanation is available for this card.';
      elements.historyRanking.replaceChildren();
      return;
    }
    elements.historyStatus.textContent = history.statusLabel;
    elements.historyRank.textContent = `#${history.currentRank}`;
    elements.historyMove.textContent = history.moveLabel;
    elements.historyMemory.textContent = history.memorySummary;
    elements.historyRanking.replaceChildren();
    const maximum = Math.max(...history.ranking.map((component) => Math.abs(component.points)), 1);
    history.ranking.slice(0, 4).forEach((component) => {
      const row = create('div', 'mini-rank-row');
      const label = create('span', '', component.label);
      const bar = create('i');
      const fill = create('b');
      fill.style.width = `${Math.max(4, Math.round((Math.abs(component.points) / maximum) * 100))}%`;
      bar.append(fill);
      row.append(label, bar, create('strong', '', `${component.points > 0 ? '+' : ''}${component.points}`));
      elements.historyRanking.append(row);
    });
  }

  function renderProgress() {
    const current = state.index + 1;
    const unread = Math.max(0, cards.length - state.read.size);
    elements.progressCurrent.textContent = pad(current);
    elements.progressTotal.textContent = pad(cards.length);
    elements.progressBar.style.width = `${(current / cards.length) * 100}%`;
    elements.readingTime.textContent = `${Math.max(1, Math.ceil(unread * 0.65))} min`;
    elements.unreadCount.textContent = String(unread);
    elements.watermark.textContent = pad(current);
  }

  function renderCard(immediate = false) {
    const card = cards[state.index];
    const apply = () => {
      elements.card.className = `daily-card theme-${card.theme}`;
      elements.topic.textContent = card.topic;
      elements.kind.textContent = card.kind;
      elements.trust.textContent = card.trust;
      elements.observed.textContent = card.observed;
      elements.entity.textContent = card.entity;
      elements.title.textContent = card.title;
      elements.direct.textContent = card.direct;
      elements.before.textContent = card.before;
      elements.now.textContent = card.now;
      elements.why.textContent = card.why;
      elements.action.textContent = card.action;
      elements.materiality.textContent = card.materiality;
      elements.sourceCount.textContent = String(card.sources.length);
      elements.score.textContent = String(card.score);
      elements.reason.textContent = card.reason;
      elements.nextSignal.textContent = card.nextSignal;
      elements.sidebarNext.textContent = card.sidebarNext;
      elements.ruleTopic.textContent = card.ruleTopic;
      elements.ruleCopy.textContent = card.ruleCopy;
      elements.sourceState.textContent = card.sourceState;
      elements.sourceAge.textContent = card.sourceAge;
      renderHistory(card);
      elements.previous.disabled = state.index === 0;
      elements.next.replaceChildren();
      elements.next.append(document.createTextNode(state.index === cards.length - 1 ? 'Finish briefing ' : 'Next change '), create('span', '', '→'));
      elements.contextDrawer.hidden = true;
      elements.contextToggle.setAttribute('aria-expanded', 'false');
      elements.contextToggle.lastElementChild.textContent = '＋';
      renderFeedback(card);
      renderActionState(card);
      renderSources(card);
      renderMap();
      renderProgress();
      elements.card.classList.remove('is-changing');
    };

    if (immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      apply();
      return;
    }
    elements.card.classList.add('is-changing');
    window.setTimeout(apply, 120);
  }

  function goTo(index) {
    if (!Number.isInteger(index) || index < 0 || index >= cards.length || index === state.index) return;
    state.read.add(cards[state.index].id);
    state.index = index;
    renderCard();
  }

  function next() {
    state.read.add(cards[state.index].id);
    if (state.index >= cards.length - 1) {
      state.read.add(cards[state.index].id);
      showComplete();
      return;
    }
    state.index += 1;
    renderCard();
  }

  function previous() {
    if (state.index <= 0) return;
    state.index -= 1;
    renderCard();
  }

  function setFeedback(value) {
    const card = cards[state.index];
    if (state.feedback.get(card.id) === value) state.feedback.delete(card.id);
    else state.feedback.set(card.id, value);
    renderFeedback(card);
    showToast(value === 'relevant' ? 'Marked relevant' : 'Preference noted', value === 'relevant' ? 'DLKT would rank similar material changes higher.' : 'DLKT would reduce similar cards in future briefings.');
  }

  function toggleFollow() {
    const entity = cards[state.index].entity;
    if (state.followed.has(entity)) state.followed.delete(entity);
    else state.followed.add(entity);
    renderFeedback(cards[state.index]);
    showToast(state.followed.has(entity) ? 'Entity followed' : 'Entity unfollowed', state.followed.has(entity) ? `Future material changes for ${entity} would be prioritized.` : `Future changes for ${entity} would return to normal ranking.`);
  }

  function showComplete() {
    elements.completeCount.textContent = String(cards.length);
    elements.completeRelevant.textContent = String(Array.from(state.feedback.values()).filter((value) => value === 'relevant').length);
    elements.completeFollowed.textContent = String(state.followed.size);
    elements.completeActions.textContent = String(Object.values(state.actions).reduce((sum, ids) => sum + ids.length, 0));
    updateMemoryLinks();
    updateActionLinks();
    elements.complete.hidden = false;
    document.body.style.overflow = 'hidden';
    elements.reviewBriefing.focus();
  }

  function hideComplete() {
    elements.complete.hidden = true;
    document.body.style.overflow = '';
    state.index = 0;
    renderCard(true);
    elements.stage.focus();
  }

  function toggleContext() {
    const willOpen = elements.contextDrawer.hidden;
    elements.contextDrawer.hidden = !willOpen;
    elements.contextToggle.setAttribute('aria-expanded', String(willOpen));
    elements.contextToggle.lastElementChild.textContent = willOpen ? '−' : '＋';
  }

  function openSources() {
    if (typeof elements.sourceDialog.showModal === 'function') elements.sourceDialog.showModal();
    else elements.sourceDialog.setAttribute('open', '');
  }

  function openActionDialog() {
    renderActionState(cards[state.index]);
    if (typeof elements.actionDialog.showModal === 'function') elements.actionDialog.showModal();
    else elements.actionDialog.setAttribute('open', '');
  }

  function handleKey(event) {
    if (cards.length === 0 || !elements.complete.hidden || elements.sourceDialog.open || elements.actionDialog.open) return;
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'j') { event.preventDefault(); next(); }
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'k') { event.preventDefault(); previous(); }
    if (event.key.toLowerCase() === 'r') { event.preventDefault(); setFeedback('relevant'); }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFollow(); }
    if (event.key.toLowerCase() === 'a') { event.preventDefault(); openActionDialog(); }
  }

  function initializeDate() {
    try {
      elements.currentDate.textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: '2-digit', month: 'long', ...(bridgeDefinition ? { timeZone: bridgeDefinition.timezone } : {}) }).format(new Date());
    } catch {
      elements.currentDate.textContent = 'Today';
    }
  }

  elements.previous.addEventListener('click', previous);
  elements.next.addEventListener('click', next);
  elements.feedbackButtons.forEach((button) => button.addEventListener('click', () => setFeedback(button.dataset.feedback)));
  elements.follow.addEventListener('click', toggleFollow);
  elements.contextToggle.addEventListener('click', toggleContext);
  elements.openSources.addEventListener('click', openSources);
  elements.openActionDialog.addEventListener('click', openActionDialog);
  elements.actionButtons.forEach((button) => button.addEventListener('click', () => toggleAction(button.dataset.cardActionType)));
  elements.reviewBriefing.addEventListener('click', hideComplete);
  document.addEventListener('keydown', handleKey);

  elements.stage.addEventListener('wheel', (event) => {
    if (state.wheelLocked || Math.abs(event.deltaY) < 35) return;
    state.wheelLocked = true;
    if (event.deltaY > 0) next(); else previous();
    window.setTimeout(() => { state.wheelLocked = false; }, 650);
  }, { passive: true });

  elements.stage.addEventListener('pointerdown', (event) => {
    state.pointerStartX = event.clientX;
    state.pointerStartY = event.clientY;
  });
  elements.stage.addEventListener('pointerup', (event) => {
    if (state.pointerStartX === null || state.pointerStartY === null) return;
    const deltaX = event.clientX - state.pointerStartX;
    const deltaY = event.clientY - state.pointerStartY;
    state.pointerStartX = null;
    state.pointerStartY = null;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 60) return;
    if (Math.abs(deltaX) > Math.abs(deltaY)) deltaX < 0 ? next() : previous();
    else deltaY < 0 ? next() : previous();
  });

  initializeDate();
  renderBridgeProjection();
  renderTrustProjection();
  if (cards.length === 0) renderEmptyState();
  else {
    buildMap();
    renderCard(true);
  }
})();
