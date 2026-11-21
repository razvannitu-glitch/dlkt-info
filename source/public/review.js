(() => {
  'use strict';

  const candidates = [
    {
      id: 'demo-eu-001',
      entity: 'DEMO-EU-001',
      topic: 'EU regulation',
      kind: 'Changed',
      sourceLabel: 'Official source',
      observed: 'Observed 21:00 UTC',
      title: 'The official proposal listing changed.',
      direct: 'The proposal remains active, but its official title and classification were updated between two verified checkpoints.',
      why: 'The document should be re-read before any legal or commercial interpretation is reused. The change may alter how teams classify and monitor it.',
      changed: 'The title moved from a generic data-exchange framework to a more specific trusted-data-spaces framework.',
      before: 'Proposal for a framework on trustworthy data exchange',
      after: 'Proposal for a European framework on trusted data spaces',
      materiality: 'Medium',
      trust: 'Confirmed',
      score: 92,
      previousClaim: 'claim:demo-eu-001:v1',
      currentClaim: 'claim:demo-eu-001:v2',
      state: 'pending',
      sources: [
        { title: 'EUR-Lex official listing · synthetic example', detail: 'Official · retrieved 21:00 UTC', url: 'https://example.com/dlkt-info/source/demo-eu-001' },
      ],
      audit: [
        { title: 'Candidate created by Delta First', time: '21:00 UTC' },
        { title: 'Claim provenance verified', time: '21:00 UTC' },
        { title: 'Awaiting human review', time: '21:01 UTC' },
      ],
    },
    {
      id: 'demo-eu-002',
      entity: 'DEMO-EU-002',
      topic: 'Official publication',
      kind: 'New',
      sourceLabel: 'Official source',
      observed: 'Observed 20:56 UTC',
      title: 'A new official act entered the monitored feed.',
      direct: 'The act is new to this source checkpoint and has no prior claim in the private ledger.',
      why: 'A newly listed act may require attention from users tracking this policy area, but its legal effect must still be verified in the linked document.',
      changed: 'No previous state existed. The official listing appeared after the last successful checkpoint.',
      before: 'No verified listing in the previous checkpoint',
      after: 'Official listing present with a canonical document identity',
      materiality: 'High',
      trust: 'Confirmed',
      score: 87,
      previousClaim: 'none',
      currentClaim: 'claim:demo-eu-002:v1',
      state: 'pending',
      sources: [
        { title: 'EUR-Lex legislation feed · synthetic example', detail: 'Official · retrieved 20:56 UTC', url: 'https://example.com/dlkt-info/source/demo-eu-002' },
      ],
      audit: [
        { title: 'New claim appended to private ledger', time: '20:56 UTC' },
        { title: 'Source rights and path rules verified', time: '20:56 UTC' },
        { title: 'Awaiting human review', time: '20:57 UTC' },
      ],
    },
    {
      id: 'demo-eu-003',
      entity: 'DEMO-EU-003',
      topic: 'Regulatory monitoring',
      kind: 'Conflicted',
      sourceLabel: 'Two sources',
      observed: 'Observed 20:42 UTC',
      title: 'Two verified sources describe the state differently.',
      direct: 'The official source reports an open consultation while a reputable secondary source describes it as closed. No factual conclusion is selected.',
      why: 'Any downstream recommendation that depends on participation availability is blocked until a reviewer resolves the contradiction.',
      changed: 'A secondary claim introduced a conflicting state after the official claim had already been recorded.',
      before: 'Official claim: consultation open',
      after: 'Conflict: open versus closed',
      materiality: 'Critical',
      trust: 'Conflicting',
      score: 98,
      previousClaim: 'claim:demo-eu-003:official',
      currentClaim: 'claim:demo-eu-003:secondary',
      state: 'pending',
      sources: [
        { title: 'Official consultation page · synthetic example', detail: 'Official · retrieved 20:40 UTC', url: 'https://example.com/dlkt-info/source/demo-eu-003-official' },
        { title: 'Secondary policy bulletin · synthetic example', detail: 'Reputable secondary · retrieved 20:42 UTC', url: 'https://example.com/dlkt-info/source/demo-eu-003-secondary' },
      ],
      audit: [
        { title: 'Official claim recorded', time: '20:40 UTC' },
        { title: 'Contradicting claim detected', time: '20:42 UTC' },
        { title: 'Dependent conclusion blocked', time: '20:42 UTC' },
      ],
    },
  ];

  const state = { selectedId: candidates[0].id, filter: 'pending', toastTimer: null };
  const byId = (id) => document.getElementById(id);
  const one = (selector) => document.querySelector(selector);
  const all = (selector) => Array.from(document.querySelectorAll(selector));
  const safe = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;

  const elements = {
    queueList: one('[data-queue-list]'),
    queueCount: one('[data-queue-count]'),
    filters: all('[data-queue-filter]'),
    position: one('[data-candidate-position]'),
    entity: one('[data-candidate-entity]'),
    kind: one('[data-card-kind]'),
    source: one('[data-card-source]'),
    time: one('[data-card-time]'),
    topic: one('[data-card-topic]'),
    title: one('[data-card-title]'),
    direct: one('[data-card-direct]'),
    why: one('[data-card-why]'),
    changed: one('[data-card-changed]'),
    before: one('[data-card-before]'),
    after: one('[data-card-after]'),
    materiality: one('[data-card-materiality]'),
    trust: one('[data-card-trust]'),
    score: one('[data-card-score]'),
    sourceCount: one('[data-card-source-count]'),
    previousClaim: one('[data-previous-claim]'),
    currentClaim: one('[data-current-claim]'),
    sourceList: one('[data-source-list]'),
    decisionState: one('[data-decision-state]'),
    note: one('[data-review-note]'),
    noteCount: one('[data-note-count]'),
    approve: one('[data-approve]'),
    reject: one('[data-reject]'),
    auditList: one('[data-audit-list]'),
    prev: one('[data-candidate-prev]'),
    next: one('[data-candidate-next]'),
    toast: one('[data-toast]'),
    toastSymbol: one('[data-toast-symbol]'),
    toastTitle: one('[data-toast-title]'),
    toastCopy: one('[data-toast-copy]'),
  };

  const selected = () => candidates.find((candidate) => candidate.id === state.selectedId) ?? candidates[0];
  const visibleCandidates = () => candidates.filter((candidate) => state.filter === 'pending' ? candidate.state === 'pending' : candidate.state !== 'pending');

  const create = (tag, className = '', text = '') => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };

  const sourceLink = (source) => {
    try {
      const url = new URL(source.url);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch {
      return null;
    }
  };

  const renderQueue = () => {
    const visible = visibleCandidates();
    elements.queueList.replaceChildren();
    elements.queueCount.textContent = String(visible.length).padStart(2, '0');

    if (!visible.length) {
      const empty = create('div', 'queue-item');
      const copy = create('div', 'queue-copy');
      copy.append(create('strong', '', state.filter === 'pending' ? 'No pending candidates.' : 'No decisions recorded yet.'));
      copy.append(create('span', '', 'Switch the queue filter to continue.'));
      empty.append(create('span', 'queue-index', '—'), copy);
      elements.queueList.append(empty);
      return;
    }

    if (!visible.some((candidate) => candidate.id === state.selectedId)) state.selectedId = visible[0].id;

    visible.forEach((candidate, index) => {
      const button = create('button', `queue-item${candidate.id === state.selectedId ? ' is-selected' : ''}${candidate.state !== 'pending' ? ' is-decided' : ''}`);
      button.type = 'button';
      button.dataset.candidateId = candidate.id;
      button.setAttribute('aria-pressed', String(candidate.id === state.selectedId));
      const position = create('span', 'queue-index', String(index + 1).padStart(2, '0'));
      const copy = create('span', 'queue-copy');
      copy.append(create('strong', '', candidate.title));
      copy.append(create('span', '', `${candidate.entity} · ${candidate.topic}`));
      const status = create('span', 'queue-item-state', candidate.state === 'pending' ? candidate.kind : candidate.state);
      button.append(position, copy, status);
      button.addEventListener('click', () => {
        state.selectedId = candidate.id;
        elements.note.value = '';
        updateNoteCount();
        render();
      });
      elements.queueList.append(button);
    });
  };

  const renderSources = (candidate) => {
    elements.sourceList.replaceChildren();
    candidate.sources.forEach((source) => {
      const row = create('div', 'source-row');
      const copy = create('div');
      copy.append(create('strong', '', safe(source.title, 'Verified source')));
      copy.append(create('span', '', safe(source.detail, 'Provenance recorded')));
      const href = sourceLink(source);
      const action = href ? create('a', '', 'Inspect source ↗') : create('span', '', 'Source unavailable');
      if (href && action instanceof HTMLAnchorElement) {
        action.href = href;
        action.target = '_blank';
        action.rel = 'noopener noreferrer';
      }
      row.append(copy, action);
      elements.sourceList.append(row);
    });
  };

  const renderAudit = (candidate) => {
    elements.auditList.replaceChildren();
    candidate.audit.slice().reverse().forEach((event) => {
      const item = create('li');
      item.append(create('b', '', event.title), create('time', '', event.time));
      elements.auditList.append(item);
    });
  };

  const renderCandidate = () => {
    const candidate = selected();
    const currentVisible = visibleCandidates();
    const visibleIndex = Math.max(0, currentVisible.findIndex((item) => item.id === candidate.id));
    elements.position.textContent = `${String(visibleIndex + 1).padStart(2, '0')} / ${String(Math.max(1, currentVisible.length)).padStart(2, '0')}`;
    elements.entity.textContent = candidate.entity;
    elements.kind.textContent = candidate.kind;
    elements.source.textContent = candidate.sourceLabel;
    elements.time.textContent = candidate.observed;
    elements.topic.textContent = candidate.topic;
    elements.title.textContent = candidate.title;
    elements.direct.textContent = candidate.direct;
    elements.why.textContent = candidate.why;
    elements.changed.textContent = candidate.changed;
    elements.before.textContent = candidate.before;
    elements.after.textContent = candidate.after;
    elements.materiality.textContent = candidate.materiality;
    elements.trust.textContent = candidate.trust;
    elements.score.textContent = String(candidate.score);
    elements.sourceCount.textContent = String(candidate.sources.length);
    elements.previousClaim.textContent = candidate.previousClaim;
    elements.currentClaim.textContent = candidate.currentClaim;
    renderSources(candidate);
    renderAudit(candidate);

    const isPending = candidate.state === 'pending';
    elements.approve.disabled = !isPending;
    elements.reject.disabled = !isPending;
    elements.note.disabled = !isPending;
    elements.decisionState.className = `decision-state${candidate.state === 'approved' ? ' is-approved' : candidate.state === 'rejected' ? ' is-rejected' : ''}`;
    elements.decisionState.replaceChildren(create('i'));
    elements.decisionState.append(document.createTextNode(candidate.state === 'pending' ? 'Awaiting decision' : candidate.state === 'approved' ? 'Approved internally' : 'Rejected internally'));
  };

  const updateNoteCount = () => {
    elements.noteCount.textContent = `${elements.note.value.length} / 320`;
  };

  const showToast = (decision) => {
    window.clearTimeout(state.toastTimer);
    const approved = decision === 'approved';
    elements.toastSymbol.textContent = approved ? '✓' : '×';
    elements.toastTitle.textContent = approved ? 'Candidate approved internally' : 'Candidate rejected internally';
    elements.toastCopy.textContent = approved
      ? 'Decision recorded in this preview. Publication remains blocked.'
      : 'Decision recorded in this preview. No downstream action was created.';
    elements.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 4200);
  };

  const decide = (decision) => {
    const candidate = selected();
    if (candidate.state !== 'pending') return;
    candidate.state = decision;
    const note = elements.note.value.trim();
    candidate.audit.push({
      title: `${decision === 'approved' ? 'Approved' : 'Rejected'} by synthetic reviewer${note ? ` · ${note.slice(0, 90)}` : ''}`,
      time: 'Preview now',
    });
    showToast(decision);
    elements.note.value = '';
    updateNoteCount();
    const remaining = candidates.filter((item) => item.state === 'pending');
    if (state.filter === 'pending' && remaining.length) state.selectedId = remaining[0].id;
    else if (state.filter === 'pending' && !remaining.length) state.filter = 'decided';
    render();
  };

  const move = (direction) => {
    const visible = visibleCandidates();
    if (!visible.length) return;
    const index = visible.findIndex((candidate) => candidate.id === state.selectedId);
    const nextIndex = (Math.max(index, 0) + direction + visible.length) % visible.length;
    state.selectedId = visible[nextIndex].id;
    elements.note.value = '';
    updateNoteCount();
    render();
  };

  const renderFilters = () => {
    elements.filters.forEach((button) => {
      const active = button.dataset.queueFilter === state.filter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
  };

  const render = () => {
    renderFilters();
    renderQueue();
    renderCandidate();
  };

  elements.filters.forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.queueFilter === 'decided' ? 'decided' : 'pending';
    const visible = visibleCandidates();
    if (visible.length) state.selectedId = visible[0].id;
    elements.note.value = '';
    updateNoteCount();
    render();
  }));
  elements.prev.addEventListener('click', () => move(-1));
  elements.next.addEventListener('click', () => move(1));
  elements.approve.addEventListener('click', () => decide('approved'));
  elements.reject.addEventListener('click', () => decide('rejected'));
  elements.note.addEventListener('input', updateNoteCount);
  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    if (event.key.toLowerCase() === 'j') move(1);
    if (event.key.toLowerCase() === 'k') move(-1);
    if (event.key.toLowerCase() === 'a') decide('approved');
    if (event.key.toLowerCase() === 'r') decide('rejected');
  });

  updateNoteCount();
  render();
})();
