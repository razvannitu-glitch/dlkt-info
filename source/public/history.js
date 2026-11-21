(() => {
  'use strict';
  const data = window.DLKTBriefingHistory;
  if (!data || data.synthetic !== true) return;

  const elements = {
    runList: document.querySelector('[data-run-list]'), runTitle: document.querySelector('[data-run-title]'),
    runRelative: document.querySelector('[data-run-relative]'), runSummary: document.querySelector('[data-run-summary]'),
    countNew: document.querySelector('[data-count-new]'), countUpdated: document.querySelector('[data-count-updated]'),
    countResolved: document.querySelector('[data-count-resolved]'), countConflicted: document.querySelector('[data-count-conflicted]'),
    runCards: document.querySelector('[data-run-cards]'), runResolved: document.querySelector('[data-run-resolved]'),
    rankingSelect: document.querySelector('[data-ranking-select]'), rankingStatus: document.querySelector('[data-ranking-status]'),
    rankingTitle: document.querySelector('[data-ranking-title]'), rankingPosition: document.querySelector('[data-ranking-position]'),
    rankingMove: document.querySelector('[data-ranking-move]'), rankingScore: document.querySelector('[data-ranking-score]'),
    rankingFirstSeen: document.querySelector('[data-ranking-first-seen]'), rankingComponents: document.querySelector('[data-ranking-components]'),
    memorySummary: document.querySelector('[data-memory-summary]'), memoryList: document.querySelector('[data-memory-list]'),
  };
  const labels = Object.freeze({
    'demo-tech-pricing': 'API pricing', 'demo-market-entry': 'Competitor move', 'demo-eu-consultation': 'EU consultation',
    'demo-grant-window': 'Funding window', 'demo-route': 'Direct route', 'demo-supply': 'Component status',
  });
  let selectedRunId = data.currentRunId;
  let selectedCardId = 'demo-tech-pricing';
  const create = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
  const tag = (text) => create('span', 'history-tag', text);

  function runById(id) { return data.runs.find((run) => run.id === id) ?? data.runs[0]; }
  function renderRuns() {
    elements.runList.replaceChildren();
    data.runs.forEach((run) => {
      const button = create('button', 'run-button'); button.type = 'button'; button.setAttribute('role', 'listitem');
      button.setAttribute('aria-pressed', String(run.id === selectedRunId));
      button.append(create('span', '', run.relative), create('strong', '', run.label), create('b', '', run.time), create('small', '', `${run.cardCount} delivered changes`));
      button.addEventListener('click', () => { selectedRunId = run.id; renderRuns(); renderComparison(); });
      elements.runList.append(button);
    });
  }
  function renderTags(container, values, emptyText) {
    container.replaceChildren();
    if (!values.length) container.append(create('span', 'history-tag', emptyText));
    else values.forEach((value) => container.append(tag(labels[value] ?? value)));
  }
  function renderComparison() {
    const run = runById(selectedRunId);
    elements.runTitle.textContent = `${run.label} · ${run.time}`; elements.runRelative.textContent = run.relative;
    elements.runSummary.textContent = run.summary; elements.countNew.textContent = String(run.counts.new);
    elements.countUpdated.textContent = String(run.counts.updated); elements.countResolved.textContent = String(run.counts.resolved);
    elements.countConflicted.textContent = String(run.counts.conflicted);
    renderTags(elements.runCards, run.cardIds, 'No delivered card in baseline');
    renderTags(elements.runResolved, run.resolved, 'Nothing resolved in this window');
  }
  function renderRankingSelect() {
    elements.rankingSelect.replaceChildren();
    Object.keys(data.cardHistory).forEach((id) => {
      const option = create('option', '', labels[id] ?? id); option.value = id; elements.rankingSelect.append(option);
    });
    elements.rankingSelect.value = selectedCardId;
  }
  function renderRanking() {
    const item = data.cardHistory[selectedCardId] ?? data.cardHistory['demo-tech-pricing'];
    elements.rankingStatus.textContent = item.statusLabel; elements.rankingTitle.textContent = labels[selectedCardId] ?? selectedCardId;
    elements.rankingPosition.textContent = `#${item.currentRank}`; elements.rankingMove.textContent = item.moveLabel;
    elements.rankingScore.textContent = String(item.currentScore); elements.rankingFirstSeen.textContent = `First seen ${item.firstSeen}`;
    elements.memorySummary.textContent = item.memorySummary; elements.rankingComponents.replaceChildren();
    const maximum = Math.max(...item.ranking.map((component) => Math.abs(component.points)), 1);
    item.ranking.forEach((component) => {
      const row = create('article', 'rank-component'); const label = create('span', '', component.label); const track = create('i');
      const fill = create('b'); fill.style.width = `${Math.max(4, Math.round((Math.abs(component.points) / maximum) * 100))}%`; track.append(fill);
      const points = create('b', '', `${component.points > 0 ? '+' : ''}${component.points}`); const reason = create('p', '', component.reason);
      row.append(label, track, points, reason); elements.rankingComponents.append(row);
    });
  }
  function renderMemory() {
    elements.memoryList.replaceChildren();
    data.memory.forEach((item) => {
      const row = create('article', 'memory-row'); const effect = create('b', item.direction === 'down' ? 'is-down' : '', item.effect);
      row.append(create('span', '', item.source), create('strong', '', item.target), effect, create('p', '', item.reason)); elements.memoryList.append(row);
    });
  }
  elements.rankingSelect.addEventListener('change', () => { selectedCardId = elements.rankingSelect.value; renderRanking(); });
  renderRuns(); renderComparison(); renderRankingSelect(); renderRanking(); renderMemory();
})();
