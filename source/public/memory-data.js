(() => {
  'use strict';
  const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  };
  window.DLKTMemoryControlData = deepFreeze({
    version: 'dlkt-info-memory-control-preview-1',
    synthetic: true,
    candidates: [
      { id: 'demo-tech-pricing', label: 'API pricing', topic: 'Technology', topicId: 'technology', entity: 'DEMO AI Platform', entityId: 'demo-ai-platform', kind: 'changed', baseScore: 154, baselineRank: 1 },
      { id: 'demo-market-entry', label: 'Competitor move', topic: 'Business', topicId: 'business', entity: 'DEMO Competitor', entityId: 'demo-competitor', kind: 'new', baseScore: 150, baselineRank: 2 },
      { id: 'demo-grant-window', label: 'Funding window', topic: 'Opportunities', topicId: 'opportunities', entity: 'DEMO Innovation Fund', entityId: 'demo-fund', kind: 'new', baseScore: 144, baselineRank: 3 },
      { id: 'demo-eu-consultation', label: 'EU consultation', topic: 'Regulation', topicId: 'regulation', entity: 'DEMO EU File', entityId: 'demo-eu-file', kind: 'changed', baseScore: 141, baselineRank: 4 },
      { id: 'demo-route', label: 'Direct route', topic: 'Travel', topicId: 'travel', entity: 'DEMO Air Route', entityId: 'demo-route', kind: 'new', baseScore: 136, baselineRank: 5 },
      { id: 'demo-supply', label: 'Component status', topic: 'Supply', topicId: 'supply', entity: 'DEMO Component', entityId: 'demo-component', kind: 'changed', baseScore: 134, baselineRank: 6 },
    ],
    signals: [
      { id: 'rule:technology', source: 'explicit-rule', sourceLabel: 'Explicit rule', targetType: 'topic', targetId: 'technology', targetLabel: 'Technology', weight: 20, active: true, originCardId: null, reason: 'Technology is one of your selected briefing topics.' },
      { id: 'rule:opportunities', source: 'explicit-rule', sourceLabel: 'Explicit rule', targetType: 'topic', targetId: 'opportunities', targetLabel: 'Opportunities', weight: 10, active: true, originCardId: null, reason: 'Actionable opportunities are part of your briefing definition.' },
      { id: 'rule:new-change', source: 'explicit-rule', sourceLabel: 'Explicit rule', targetType: 'kind', targetId: 'new', targetLabel: 'New verified changes', weight: 6, active: true, originCardId: null, reason: 'New verified states receive a bounded priority lift.' },
      { id: 'relevant:demo-tech-pricing', source: 'relevant-feedback', sourceLabel: 'Relevant feedback', targetType: 'entity', targetId: 'demo-ai-platform', targetLabel: 'DEMO AI Platform', weight: 12, active: true, originCardId: 'demo-tech-pricing', reason: 'You marked an API-pricing card as relevant.' },
      { id: 'follow:demo-market-entry', source: 'followed-entity', sourceLabel: 'Followed entity', targetType: 'entity', targetId: 'demo-competitor', targetLabel: 'DEMO Competitor', weight: 15, active: true, originCardId: 'demo-market-entry', reason: 'You chose to follow this competitor.' },
      { id: 'less:demo-supply', source: 'less-like-feedback', sourceLabel: 'Less-like feedback', targetType: 'topic', targetId: 'supply', targetLabel: 'Supply', weight: -18, active: true, originCardId: 'demo-supply', reason: 'You asked for fewer routine supply updates.' },
      { id: 'relevant:demo-route', source: 'relevant-feedback', sourceLabel: 'Relevant feedback', targetType: 'entity', targetId: 'demo-route', targetLabel: 'DEMO Air Route', weight: 8, active: false, originCardId: 'demo-route', reason: 'A direct-route card can be promoted when marked relevant.' },
      { id: 'follow:demo-grant-window', source: 'followed-entity', sourceLabel: 'Followed entity', targetType: 'entity', targetId: 'demo-fund', targetLabel: 'DEMO Innovation Fund', weight: 15, active: false, originCardId: 'demo-grant-window', reason: 'Following the fund would raise future verified changes from it.' },
    ],
  });
})();
