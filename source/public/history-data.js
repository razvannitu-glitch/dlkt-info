(() => {
  'use strict';

  const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  };

  const data = {
    version: 'dlkt-info-briefing-history-preview-1',
    synthetic: true,
    currentRunId: 'briefing:2026-11-12:0800',
    cardHistory: {
      'demo-tech-pricing': {
        status: 'updated', statusLabel: 'Updated since last briefing', firstSeen: '11 November · 08:00',
        previousRank: 3, currentRank: 1, previousScore: 148, currentScore: 174,
        moveLabel: 'Moved up 2 places',
        memorySummary: 'Explicit Technology rule and two relevant-feedback signals increased priority.',
        ranking: [
          { label: 'Materiality', points: 75, reason: 'High operating-cost impact.' },
          { label: 'Change type', points: 25, reason: 'The verified state changed.' },
          { label: 'Freshness', points: 18, reason: 'Observed inside the current briefing window.' },
          { label: 'Actionability', points: 16, reason: 'A concrete cost review is available.' },
          { label: 'Source authority', points: 20, reason: 'Official and primary evidence.' },
          { label: 'Personal rules', points: 20, reason: 'Technology and API economics are selected.' },
        ],
      },
      'demo-market-entry': {
        status: 'new', statusLabel: 'New since last briefing', firstSeen: 'Today · 06:55',
        previousRank: null, currentRank: 2, previousScore: null, currentScore: 165,
        moveLabel: 'Entered at #2',
        memorySummary: 'Followed competitor plus explicit Business interest raised this card immediately.',
        ranking: [
          { label: 'Materiality', points: 75, reason: 'High competitive impact.' },
          { label: 'Change type', points: 15, reason: 'New verified market state.' },
          { label: 'Freshness', points: 18, reason: 'Observed this morning.' },
          { label: 'Actionability', points: 18, reason: 'A market-response review is possible.' },
          { label: 'Source authority', points: 14, reason: 'Primary company evidence.' },
          { label: 'Personal rules', points: 25, reason: 'Business interest and followed entity match.' },
        ],
      },
      'demo-eu-consultation': {
        status: 'updated', statusLabel: 'Updated since last briefing', firstSeen: '10 November · 08:00',
        previousRank: 5, currentRank: 3, previousScore: 111, currentScore: 146,
        moveLabel: 'Moved up 2 places',
        memorySummary: 'The deadline change crossed the user’s Regulation and actionable thresholds.',
        ranking: [
          { label: 'Materiality', points: 50, reason: 'Medium regulatory impact.' },
          { label: 'Change type', points: 25, reason: 'The official deadline changed.' },
          { label: 'Freshness', points: 17, reason: 'New official evidence arrived today.' },
          { label: 'Actionability', points: 18, reason: 'The response plan can be adjusted now.' },
          { label: 'Source authority', points: 20, reason: 'Official European sources.' },
          { label: 'Personal rules', points: 16, reason: 'Regulation is explicitly selected.' },
        ],
      },
      'demo-grant-window': {
        status: 'new', statusLabel: 'New since last briefing', firstSeen: 'Today · 04:10',
        previousRank: null, currentRank: 4, previousScore: null, currentScore: 143,
        moveLabel: 'Entered at #4',
        memorySummary: 'Actionable-only and Opportunities rules included the newly opened call.',
        ranking: [
          { label: 'Materiality', points: 75, reason: 'High funding relevance.' },
          { label: 'Change type', points: 15, reason: 'New application state.' },
          { label: 'Freshness', points: 14, reason: 'Observed inside this briefing window.' },
          { label: 'Actionability', points: 20, reason: 'Eligibility can be checked immediately.' },
          { label: 'Source authority', points: 20, reason: 'Official call documentation.' },
          { label: 'Personal rules', points: 14, reason: 'Opportunities is explicitly selected.' },
        ],
      },
      'demo-route': {
        status: 'new', statusLabel: 'New since last briefing', firstSeen: 'Today · 03:05',
        previousRank: null, currentRank: 5, previousScore: null, currentScore: 108,
        moveLabel: 'Entered at #5',
        memorySummary: 'No stored preference raised this card; source certainty and medium materiality keep it lower.',
        ranking: [
          { label: 'Materiality', points: 50, reason: 'Medium travel impact.' },
          { label: 'Change type', points: 15, reason: 'New published route.' },
          { label: 'Freshness', points: 12, reason: 'Observed during the current window.' },
          { label: 'Actionability', points: 8, reason: 'Travel planning is possible but not urgent.' },
          { label: 'Source authority', points: 14, reason: 'One primary source.' },
          { label: 'Personal rules', points: 9, reason: 'No explicit Travel memory signal.' },
        ],
      },
      'demo-supply': {
        status: 'updated', statusLabel: 'Conflict updated since last briefing', firstSeen: '11 November · 08:00',
        previousRank: 2, currentRank: 6, previousScore: 159, currentScore: 103,
        moveLabel: 'Moved down 4 places',
        memorySummary: 'Supply is selected, but less-like feedback and unresolved evidence reduced personal priority.',
        ranking: [
          { label: 'Materiality', points: 75, reason: 'High operational impact.' },
          { label: 'Change type', points: 30, reason: 'Active contradiction changed.' },
          { label: 'Freshness', points: 10, reason: 'Evidence is several hours old.' },
          { label: 'Actionability', points: 0, reason: 'No safe decision until the conflict resolves.' },
          { label: 'Source authority', points: 20, reason: 'Official evidence is present.' },
          { label: 'Personal rules', points: -12, reason: 'Less-like feedback reduced similar supply cards.' },
        ],
      },
    },
    runs: [
      {
        id: 'briefing:2026-11-12:0800', label: 'Today', time: '08:00', relative: 'Current briefing', cardCount: 6,
        counts: { new: 3, updated: 3, resolved: 2, conflicted: 1 },
        summary: 'Six material changes. Three are new, three changed again, and two previous signals no longer require attention.',
        cardIds: ['demo-tech-pricing', 'demo-market-entry', 'demo-eu-consultation', 'demo-grant-window', 'demo-route', 'demo-supply'],
        resolved: ['DEMO payment outage', 'DEMO regional stock alert'],
      },
      {
        id: 'briefing:2026-11-11:0800', label: 'Yesterday', time: '08:00', relative: 'Previous briefing', cardCount: 5,
        counts: { new: 2, updated: 2, resolved: 1, conflicted: 1 },
        summary: 'Five material changes. Pricing was still announced, the component conflict ranked second, and the market entry was not yet visible.',
        cardIds: ['demo-supply', 'demo-tech-pricing', 'demo-eu-consultation'],
        resolved: ['DEMO API latency watch'],
      },
      {
        id: 'briefing:2026-11-10:0800', label: 'Tuesday', time: '08:00', relative: 'Two briefings ago', cardCount: 4,
        counts: { new: 1, updated: 2, resolved: 1, conflicted: 0 },
        summary: 'Four changes. The EU consultation first appeared and no active supply contradiction was present.',
        cardIds: ['demo-eu-consultation'],
        resolved: ['DEMO cloud maintenance'],
      },
      {
        id: 'briefing:2026-11-09:0800', label: 'Monday', time: '08:00', relative: 'Three briefings ago', cardCount: 3,
        counts: { new: 2, updated: 1, resolved: 0, conflicted: 0 },
        summary: 'Three changes established the synthetic history baseline. Stable information was omitted from every later briefing.',
        cardIds: [],
        resolved: [],
      },
    ],
    memory: [
      { id: 'memory:technology', source: 'Explicit rule', target: 'Technology', effect: '+20', direction: 'up', reason: 'Selected directly in Companion settings.' },
      { id: 'memory:regulation', source: 'Explicit rule', target: 'Regulation', effect: '+16', direction: 'up', reason: 'Selected directly in Companion settings.' },
      { id: 'memory:competitor', source: 'Followed entity', target: 'DEMO Competitor', effect: '+10', direction: 'up', reason: 'The user explicitly followed this entity.' },
      { id: 'memory:relevant-ai', source: 'Relevant feedback', target: 'AI infrastructure', effect: '+8', direction: 'up', reason: 'Two similar cards were marked relevant in earlier briefings.' },
      { id: 'memory:less-supply', source: 'Less-like feedback', target: 'Supply availability', effect: '−12', direction: 'down', reason: 'Similar non-actionable supply cards were marked less relevant.' },
    ],
  };

  Object.defineProperty(window, 'DLKTBriefingHistory', {
    value: deepFreeze(data), configurable: false, enumerable: false, writable: false,
  });
})();
