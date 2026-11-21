(() => {
  'use strict';

  const VERSION = 'dlkt-info-trust-control-1';
  const MARKER = 'trust-v1';
  const TRUST_KEYS = Object.freeze(['trust', 'level', 'conflicts', 'authority', 'sources', 'age', 'officialHigh']);
  const FOREIGN_KEYS = new Set(['bridge', 'topics', 'entities', 'tz', 'at', 'max', 'min', 'actionable', 'actions', 'watch', 'remind', 'compare', 'resolved', 'ignore', 'delivery', 'dw', 'dr', 'dc', 'dx', 'di', 'qh', 'qs', 'qe', 'cap', 'gap', 'bypass', 'conflict', 'trustFloor', 'materialityFloor', 'channel', '_vercel_share']);
  const TRUST_LEVELS = Object.freeze(['confirmed', 'corroborated', 'single-source']);
  const CONFLICT_POLICIES = Object.freeze(['exclude', 'include-warning']);
  const AUTHORITIES = Object.freeze(['official', 'primary', 'reputable-secondary', 'community']);
  const SOURCE_COUNTS = Object.freeze([1, 2]);
  const AGE_LIMITS = Object.freeze([24, 72, 168]);
  const TRUST_RANK = Object.freeze({ confirmed: 3, corroborated: 2, 'single-source': 1 });
  const AUTHORITY_RANK = Object.freeze({ official: 4, primary: 3, 'reputable-secondary': 2, community: 1, unknown: 0 });
  const MATERIALITY_RANK = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });

  const defaultPolicy = Object.freeze({
    minimumTrust: 'corroborated',
    conflictPolicy: 'exclude',
    authorityRequirement: 'primary',
    minimumSources: 2,
    maximumEvidenceAgeHours: 72,
    requireOfficialForHighImpact: true,
  });

  const candidates = Object.freeze([
    Object.freeze({
      id: 'demo-tech-pricing', label: 'API pricing', entity: 'DEMO AI Platform', topic: 'Technology',
      title: 'An API price moved from announced to active.', trust: 'confirmed', materiality: 'high',
      evidenceAgeHours: 0.3, sources: Object.freeze([
        Object.freeze({ authority: 'official', label: 'Official pricing' }),
        Object.freeze({ authority: 'primary', label: 'Developer update' }),
      ]),
    }),
    Object.freeze({
      id: 'demo-market-entry', label: 'Competitor move', entity: 'DEMO Competitor', topic: 'Business',
      title: 'A competitor entered a market you track.', trust: 'confirmed', materiality: 'high',
      evidenceAgeHours: 1.2, sources: Object.freeze([
        Object.freeze({ authority: 'official', label: 'Public company register' }),
        Object.freeze({ authority: 'primary', label: 'Company newsroom' }),
      ]),
    }),
    Object.freeze({
      id: 'demo-eu-consultation', label: 'EU consultation', entity: 'DEMO EU File', topic: 'Regulation',
      title: 'An EU consultation reopened with a new deadline.', trust: 'confirmed', materiality: 'medium',
      evidenceAgeHours: 2, sources: Object.freeze([
        Object.freeze({ authority: 'official', label: 'Consultation record' }),
        Object.freeze({ authority: 'official', label: 'Directorate note' }),
      ]),
    }),
    Object.freeze({
      id: 'demo-grant-window', label: 'Funding window', entity: 'DEMO Innovation Fund', topic: 'Opportunity',
      title: 'A funding window relevant to your work is now open.', trust: 'confirmed', materiality: 'high',
      evidenceAgeHours: 3, sources: Object.freeze([
        Object.freeze({ authority: 'official', label: 'Funding portal' }),
        Object.freeze({ authority: 'official', label: 'Applicant guide' }),
      ]),
    }),
    Object.freeze({
      id: 'demo-route', label: 'Direct route', entity: 'DEMO Airline', topic: 'Travel',
      title: 'A direct route was added for the summer schedule.', trust: 'single-source', materiality: 'medium',
      evidenceAgeHours: 4, sources: Object.freeze([
        Object.freeze({ authority: 'primary', label: 'Airline timetable' }),
      ]),
    }),
    Object.freeze({
      id: 'demo-supply', label: 'Component status', entity: 'DEMO Component', topic: 'Supply',
      title: 'A critical component moved to available, but one distributor still shows delay.', trust: 'conflicting', materiality: 'high',
      evidenceAgeHours: 5, sources: Object.freeze([
        Object.freeze({ authority: 'official', label: 'Manufacturer availability' }),
        Object.freeze({ authority: 'reputable-secondary', label: 'Distributor inventory' }),
      ]),
    }),
  ]);

  const copyPolicy = (value) => Object.freeze({
    minimumTrust: value.minimumTrust,
    conflictPolicy: value.conflictPolicy,
    authorityRequirement: value.authorityRequirement,
    minimumSources: value.minimumSources,
    maximumEvidenceAgeHours: value.maximumEvidenceAgeHours,
    requireOfficialForHighImpact: value.requireOfficialForHighImpact,
  });

  function validPolicy(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === 6
      && TRUST_LEVELS.includes(value.minimumTrust)
      && CONFLICT_POLICIES.includes(value.conflictPolicy)
      && AUTHORITIES.includes(value.authorityRequirement)
      && SOURCE_COUNTS.includes(value.minimumSources)
      && AGE_LIMITS.includes(value.maximumEvidenceAgeHours)
      && typeof value.requireOfficialForHighImpact === 'boolean');
  }

  function normalizePolicy(value) {
    if (!validPolicy(value)) throw new Error('TRUST_POLICY_INVALID');
    return copyPolicy(value);
  }

  function evaluate(candidate, input) {
    const policy = normalizePolicy(input);
    const blockingReasons = [];
    const warnings = [];
    const authorities = candidate.sources.map((source) => source.authority);
    const bestAuthority = Math.max(...authorities.map((authority) => AUTHORITY_RANK[authority] ?? 0));

    if (candidate.trust === 'conflicting') {
      if (policy.conflictPolicy === 'exclude') blockingReasons.push('Unresolved contradiction is excluded.');
      else warnings.push('Contradiction remains visible and blocked from automatic action.');
    } else if (TRUST_RANK[candidate.trust] < TRUST_RANK[policy.minimumTrust]) {
      blockingReasons.push(`${candidate.trust} is below your ${policy.minimumTrust} threshold.`);
    }
    if (candidate.sources.length < policy.minimumSources) {
      blockingReasons.push(`${candidate.sources.length} source does not meet the ${policy.minimumSources}-source minimum.`);
    }
    if (bestAuthority < AUTHORITY_RANK[policy.authorityRequirement]) {
      blockingReasons.push(`No source reaches ${policy.authorityRequirement} authority.`);
    }
    if (candidate.evidenceAgeHours > policy.maximumEvidenceAgeHours) {
      blockingReasons.push(`Evidence is older than ${policy.maximumEvidenceAgeHours} hours.`);
    }
    if (policy.requireOfficialForHighImpact && MATERIALITY_RANK[candidate.materiality] >= MATERIALITY_RANK.high
      && !authorities.includes('official')) {
      blockingReasons.push('High-impact information requires an official source.');
    }

    return Object.freeze({ candidateId: candidate.id, included: blockingReasons.length === 0,
      blockingReasons: Object.freeze(blockingReasons), warnings: Object.freeze(warnings) });
  }

  function project(input) {
    const policy = normalizePolicy(input);
    const decisions = Object.freeze(candidates.map((candidate) => evaluate(candidate, policy)));
    return Object.freeze({
      policy,
      decisions,
      includedIds: Object.freeze(decisions.filter((decision) => decision.included).map((decision) => decision.candidateId)),
      excludedIds: Object.freeze(decisions.filter((decision) => !decision.included).map((decision) => decision.candidateId)),
    });
  }

  const one = (params, key) => {
    const values = params.getAll(key);
    return values.length === 1 ? values[0] ?? null : null;
  };

  function parseSearch(search) {
    if (typeof search !== 'string' || search.length > 1400) return Object.freeze({ state: 'invalid', policy: null, reason: 'SEARCH_INVALID' });
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const hasTrust = TRUST_KEYS.some((key) => params.has(key));
    if (!hasTrust) return Object.freeze({ state: 'absent', policy: null });
    for (const key of params.keys()) {
      if (!TRUST_KEYS.includes(key) && !FOREIGN_KEYS.has(key)) return Object.freeze({ state: 'invalid', policy: null, reason: 'UNKNOWN_PARAMETER' });
    }
    if (TRUST_KEYS.some((key) => params.getAll(key).length !== 1) || one(params, 'trust') !== MARKER) {
      return Object.freeze({ state: 'invalid', policy: null, reason: 'DUPLICATE_OR_PARTIAL' });
    }
    const policy = {
      minimumTrust: one(params, 'level'),
      conflictPolicy: one(params, 'conflicts'),
      authorityRequirement: one(params, 'authority'),
      minimumSources: Number(one(params, 'sources')),
      maximumEvidenceAgeHours: Number(one(params, 'age')),
      requireOfficialForHighImpact: one(params, 'officialHigh') === '1',
    };
    return validPolicy(policy)
      ? Object.freeze({ state: 'valid', policy: normalizePolicy(policy) })
      : Object.freeze({ state: 'invalid', policy: null, reason: 'POLICY_INVALID' });
  }

  function trustParameters(input) {
    const policy = normalizePolicy(input);
    const params = new URLSearchParams();
    params.set('trust', MARKER);
    params.set('level', policy.minimumTrust);
    params.set('conflicts', policy.conflictPolicy);
    params.set('authority', policy.authorityRequirement);
    params.set('sources', String(policy.minimumSources));
    params.set('age', String(policy.maximumEvidenceAgeHours));
    params.set('officialHigh', policy.requireOfficialForHighImpact ? '1' : '0');
    return params;
  }

  function validCompanionParameters(search) {
    const bridge = window.DLKTCompanionBridge;
    if (!bridge || typeof bridge.parseSearch !== 'function' || typeof bridge.buildSearch !== 'function') return new URLSearchParams();
    const parsed = bridge.parseSearch(search);
    return parsed.state === 'valid' ? new URLSearchParams(bridge.buildSearch(parsed.definition).slice(1)) : new URLSearchParams();
  }

  function combinedParameters(input, search) {
    const params = validCompanionParameters(search);
    const trust = trustParameters(input);
    trust.forEach((value, key) => params.set(key, value));
    return params;
  }

  const buildTodayUrl = (policy, search = '') => `/today?${combinedParameters(policy, search).toString()}`;
  const buildTrustUrl = (policy, search = '') => `/trust?${combinedParameters(policy, search).toString()}`;
  const candidateById = Object.freeze(Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate])));

  Object.defineProperty(window, 'DLKTTrustControl', {
    value: Object.freeze({
      version: VERSION,
      marker: MARKER,
      queryKeys: TRUST_KEYS,
      defaultPolicy,
      candidates,
      candidateById,
      normalizePolicy,
      evaluate,
      project,
      parseSearch,
      buildTodayUrl,
      buildTrustUrl,
    }),
    writable: false,
    configurable: false,
  });
})();
