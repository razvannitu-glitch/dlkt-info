(() => {
  'use strict';

  const actionApi = window.DLKTActionControl;
  const inboxApi = window.DLKTActionInbox;
  if (!actionApi || !inboxApi) throw new Error('ACTION_INBOX_UNAVAILABLE');
  const initialResult = inboxApi.fromSearch(window.location.search);
  const cloneItem = (item) => ({ ...item, observation: { ...item.observation } });
  const baselineItems = initialResult.projection.items.map(cloneItem);
  const initialSelections = actionApi.cloneSelections(initialResult.projection.selections);
  const state = { items: baselineItems.map(cloneItem), selections: initialSelections, selectedId: baselineItems[0]?.id ?? null, filter: 'all', undo: [], activity: [], toastTimer: null };

  const elements = {
    dueCount: document.querySelector('[data-due-count]'), waitingCount: document.querySelector('[data-waiting-count]'), scheduledCount: document.querySelector('[data-scheduled-count]'), quietCount: document.querySelector('[data-quiet-count]'), heroDue: document.querySelector('[data-hero-due]'),
    queryState: document.querySelector('[data-query-state]'), filters: Array.from(document.querySelectorAll('[data-filter]')), filterAll: document.querySelector('[data-filter-all]'), filterDue: document.querySelector('[data-filter-due]'), filterWaiting: document.querySelector('[data-filter-waiting]'), filterQuiet: document.querySelector('[data-filter-quiet]'),
    list: document.querySelector('[data-inbox-list]'), empty: document.querySelector('[data-inbox-empty]'), listSummary: document.querySelector('[data-list-summary]'),
    itemTopic: document.querySelector('[data-item-topic]'), itemLabel: document.querySelector('[data-item-label]'), itemState: document.querySelector('[data-item-state]'), itemEntity: document.querySelector('[data-item-entity]'), itemTitle: document.querySelector('[data-item-title]'), itemCurrent: document.querySelector('[data-item-current]'), itemAction: document.querySelector('[data-item-action]'), itemTrust: document.querySelector('[data-item-trust]'), itemMateriality: document.querySelector('[data-item-materiality]'), itemDue: document.querySelector('[data-item-due]'), itemReason: document.querySelector('[data-item-reason]'), itemNext: document.querySelector('[data-item-next]'), conflictNote: document.querySelector('[data-conflict-note]'), handle: document.querySelector('[data-handle-action]'),
    actionLinks: Array.from(document.querySelectorAll('[data-open-actions]')), todayLinks: Array.from(document.querySelectorAll('[data-open-today]')), deliveryLinks: Array.from(document.querySelectorAll('[data-open-delivery]')),
    activity: document.querySelector('[data-activity-list]'), undo: document.querySelector('[data-undo]'), reset: document.querySelector('[data-reset]'),
    toast: document.querySelector('[data-toast]'), toastTitle: document.querySelector('[data-toast-title]'), toastCopy: document.querySelector('[data-toast-copy]'),
  };

  const create = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
  const pad = (value) => String(value).padStart(2, '0');
  const visibleItems = () => state.items.filter((item) => !item.removed && (state.filter === 'all' || item.group === state.filter));
  const activeItems = () => state.items.filter((item) => !item.removed);

  function selectionsFromItems() {
    const selections = actionApi.emptySelections();
    activeItems().forEach((item) => selections[actionApi.keyByType[item.type]].push(item.candidateId));
    Object.values(selections).forEach((ids) => ids.sort());
    return selections;
  }

  function snapshot() {
    return { items: state.items.map(cloneItem), selectedId: state.selectedId, filter: state.filter, activity: state.activity.map((item) => ({ ...item })) };
  }

  function restore(value) {
    state.items = value.items.map(cloneItem); state.selectedId = value.selectedId; state.filter = value.filter; state.activity = value.activity.map((item) => ({ ...item })); render();
  }

  function showToast(title, copy) {
    elements.toastTitle.textContent = title; elements.toastCopy.textContent = copy; elements.toast.hidden = false; window.clearTimeout(state.toastTimer); state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2600);
  }

  function ensureSelection() {
    const visible = visibleItems();
    if (!visible.some((item) => item.id === state.selectedId)) state.selectedId = visible[0]?.id ?? null;
  }

  function renderCounts() {
    const items = activeItems();
    const due = items.filter((item) => item.state === 'due-now').length;
    const scheduled = items.filter((item) => item.state === 'scheduled').length;
    const waiting = items.filter((item) => item.state === 'waiting-for-delta').length;
    const quiet = items.filter((item) => item.state === 'muted' || item.state === 'attention-resolved').length;
    elements.dueCount.textContent = pad(due); elements.heroDue.textContent = pad(due); elements.waitingCount.textContent = pad(waiting); elements.scheduledCount.textContent = pad(scheduled); elements.quietCount.textContent = pad(quiet);
    elements.filterAll.textContent = pad(items.length); elements.filterDue.textContent = pad(due); elements.filterWaiting.textContent = pad(waiting + scheduled); elements.filterQuiet.textContent = pad(quiet);
    elements.listSummary.textContent = `${items.length} active action${items.length === 1 ? '' : 's'}`;
  }

  function renderFilters() { elements.filters.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter))); }

  function renderList() {
    const items = visibleItems(); elements.list.replaceChildren(); elements.empty.hidden = items.length !== 0;
    items.forEach((item, index) => {
      const button = create('button', `inbox-item state-${item.state}`); button.type = 'button'; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(item.id === state.selectedId)); button.dataset.itemId = item.id;
      const order = create('span', 'item-order', pad(index + 1));
      const copy = create('div', 'item-main'); copy.append(create('span', 'item-kicker', `${item.candidate.topic} · ${item.action.short}`), create('strong', '', item.candidate.label), create('p', '', item.reason));
      const status = create('div', 'item-status'); status.append(create('b', '', item.stateLabel), create('span', '', item.dueLabel));
      button.append(order, copy, status); button.addEventListener('click', () => { state.selectedId = item.id; render(); }); elements.list.append(button);
    });
  }

  function handleLabel(item) {
    if (item.state === 'due-now' && item.type === 'watch-change') return 'Acknowledge & rearm watch';
    if (item.state === 'due-now' && item.type === 'mark-resolved') return 'Acknowledge & resolve attention';
    if (item.state === 'due-now') return 'Mark handled';
    if (item.state === 'muted') return 'Unmute pattern';
    if (item.state === 'attention-resolved') return 'Reopen attention';
    if (item.state === 'scheduled') return 'Cancel reminder';
    return 'Stop waiting';
  }

  function renderInspector() {
    const item = state.items.find((candidate) => candidate.id === state.selectedId && !candidate.removed);
    const inspector = document.querySelector('.inbox-inspector'); inspector.hidden = !item;
    if (!item) return;
    elements.itemTopic.textContent = item.candidate.topic; elements.itemLabel.textContent = item.candidate.label; elements.itemState.textContent = item.stateLabel.toUpperCase(); elements.itemEntity.textContent = item.candidate.entity; elements.itemTitle.textContent = item.action.label; elements.itemCurrent.textContent = item.observation.currentState; elements.itemAction.textContent = item.action.short; elements.itemTrust.textContent = item.candidate.trust; elements.itemMateriality.textContent = item.candidate.materiality; elements.itemDue.textContent = item.dueLabel; elements.itemReason.textContent = item.reason; elements.itemNext.textContent = item.candidate.nextSignal; elements.conflictNote.hidden = !item.observation.conflictActive; elements.handle.textContent = handleLabel(item);
  }

  function renderActivity() {
    elements.activity.replaceChildren();
    if (!state.activity.length) { elements.activity.append(create('p', 'activity-empty', 'No follow-up decision has been made in this session.')); return; }
    state.activity.slice().reverse().forEach((entry, index) => { const row = create('article', 'activity-row'); row.append(create('span', '', pad(state.activity.length - index)), create('strong', '', entry.title), create('p', '', entry.copy)); elements.activity.append(row); });
  }

  function renderLinks() {
    const selections = selectionsFromItems(); const search = actionApi.buildSearch(selections, window.location.search);
    elements.actionLinks.forEach((link) => { link.href = `/actions${search}`; });
    elements.todayLinks.forEach((link) => { link.href = `/today${search}`; });
    elements.deliveryLinks.forEach((link) => { link.href = `/delivery${search}`; });
  }

  function renderQueryState() {
    elements.queryState.textContent = initialResult.parsed.state === 'valid' ? 'Imported explicit actions' : initialResult.parsed.state === 'invalid' ? 'Unsafe action link ignored' : 'Canonical synthetic preview';
  }

  function render() {
    ensureSelection(); renderCounts(); renderFilters(); renderList(); renderInspector(); renderActivity(); renderLinks(); renderQueryState(); elements.undo.disabled = state.undo.length === 0;
  }

  function pushActivity(title, copy) { state.activity.push({ title, copy }); }

  function handleSelected() {
    const item = state.items.find((candidate) => candidate.id === state.selectedId && !candidate.removed); if (!item) return;
    state.undo.push(snapshot());
    if (item.state === 'due-now' && item.type === 'watch-change') {
      item.state = 'waiting-for-delta'; item.stateLabel = 'Waiting'; item.group = 'waiting'; item.dueLabel = 'Rearmed now'; item.reason = 'The current delta was acknowledged. The continuous watch is armed for the next material change.'; item.observation = { ...item.observation, changed: false, materialDelta: false }; pushActivity('Watch rearmed', `${item.candidate.label} now waits for the next material verified delta.`);
    } else if (item.state === 'due-now' && item.type === 'mark-resolved') {
      item.state = 'attention-resolved'; item.stateLabel = 'Resolved attention'; item.group = 'quiet'; item.dueLabel = 'Handled now'; item.reason = 'The new delta was acknowledged and personal attention is resolved again.'; item.observation = { ...item.observation, changed: false, materialDelta: false }; pushActivity('Attention resolved again', `${item.candidate.label} remains factual history, not an active task.`);
    } else if (item.state === 'due-now') {
      item.removed = true; pushActivity('One-time action completed', `${item.action.label} for ${item.candidate.label} was handled in this session.`);
    } else if (item.state === 'muted') {
      item.removed = true; pushActivity('Pattern unmuted', `${item.candidate.label} may appear again when it crosses your Companion and Trust rules.`);
    } else if (item.state === 'attention-resolved') {
      item.removed = true; pushActivity('Attention reopened', `${item.candidate.label} is no longer held in the resolved-attention state.`);
    } else {
      item.removed = true; pushActivity('Action cancelled', `${item.action.label} for ${item.candidate.label} was removed.`);
    }
    render(); showToast('Action Inbox updated', 'The session-only follow-up projection was recalculated.');
  }

  elements.filters.forEach((button) => button.addEventListener('click', () => { state.filter = button.dataset.filter; render(); }));
  elements.handle.addEventListener('click', handleSelected);
  elements.undo.addEventListener('click', () => { const previous = state.undo.pop(); if (!previous) return; restore(previous); showToast('Decision undone', 'The previous Action Inbox state was restored.'); });
  elements.reset.addEventListener('click', () => { state.undo.push(snapshot()); state.items = baselineItems.map(cloneItem); state.selectedId = state.items[0]?.id ?? null; state.filter = 'all'; state.activity = []; render(); showToast('Preview reset', 'The canonical Action Inbox state was restored.'); });
  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    const items = visibleItems(); const index = items.findIndex((item) => item.id === state.selectedId);
    if (event.key.toLowerCase() === 'j' && items.length) { event.preventDefault(); state.selectedId = items[Math.min(items.length - 1, index + 1)]?.id ?? items[0].id; render(); }
    if (event.key.toLowerCase() === 'k' && items.length) { event.preventDefault(); state.selectedId = items[Math.max(0, index - 1)]?.id ?? items[0].id; render(); }
    if (event.key.toLowerCase() === 'h') { event.preventDefault(); handleSelected(); }
    if (event.key.toLowerCase() === 'z' && !elements.undo.disabled) { event.preventDefault(); elements.undo.click(); }
  });

  render();
})();
