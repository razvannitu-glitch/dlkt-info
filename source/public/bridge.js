(() => {
  'use strict';

  const VERSION = 'dlkt-info-companion-bridge-1';
  const MARKER = 'companion-v1';
  const TOPICS = Object.freeze(['technology', 'business', 'regulation', 'opportunities', 'supply']);
  const MATERIALITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
  const BRIDGE_KEYS = Object.freeze(['bridge', 'topics', 'entities', 'tz', 'at', 'max', 'min', 'actionable']);
  const TRUST_KEYS = Object.freeze(['trust', 'level', 'conflicts', 'authority', 'sources', 'age', 'officialHigh']);
  const ACTION_KEYS = Object.freeze(['actions', 'watch', 'remind', 'compare', 'resolved', 'ignore']);
  const DELIVERY_KEYS = Object.freeze(['delivery', 'dw', 'dr', 'dc', 'dx', 'di', 'qh', 'qs', 'qe', 'cap', 'gap', 'bypass', 'conflict', 'trustFloor', 'materialityFloor', 'channel']);
  const ALLOWED_KEYS = new Set([...BRIDGE_KEYS, ...TRUST_KEYS, ...ACTION_KEYS, ...DELIVERY_KEYS, '_vercel_share']);
  const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
  const TIMEZONE = /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+$/u;
  const ENTITY = /^[\p{L}\p{M}\p{N} .,&+'’()/_:–—-]+$/u;

  const one = (params, key) => {
    const values = params.getAll(key);
    return values.length === 1 ? values[0] ?? null : null;
  };
  const optionalOne = (params, key) => {
    const values = params.getAll(key);
    if (values.length === 0) return undefined;
    return values.length === 1 ? values[0] ?? null : null;
  };

  const validTimezone = (value) => {
    if (typeof value !== 'string' || value.length > 64 || !TIMEZONE.test(value)) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); return true; } catch { return false; }
  };
  const normalizeEntity = (value) => {
    if (typeof value !== 'string') throw new Error('BRIDGE_ENTITY_INVALID');
    const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    if (normalized.length < 2 || normalized.length > 80 || normalized.includes('|')
        || /[\u0000-\u001f\u007f]/u.test(normalized) || !ENTITY.test(normalized)) {
      throw new Error('BRIDGE_ENTITY_INVALID');
    }
    return normalized;
  };

  const normalize = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('BRIDGE_INPUT_INVALID');
    const topics = Array.isArray(value.topics) ? value.topics : [];
    const entities = Array.isArray(value.entities) ? value.entities.map(normalizeEntity) : [];
    if (topics.length < 1 || topics.length > TOPICS.length || new Set(topics).size !== topics.length
      || topics.some((topic) => typeof topic !== 'string' || !TOPICS.includes(topic))
      || entities.reduce((total, entity) => total + entity.length, 0) > 131072
      || new Set(entities.map((entity) => entity.toLocaleLowerCase('en-US'))).size !== entities.length
      || !validTimezone(value.timezone)
      || typeof value.deliveryLocalTime !== 'string' || !TIME.test(value.deliveryLocalTime)
      || !Number.isSafeInteger(value.maxCards) || value.maxCards < 1 || value.maxCards > 2147483647
      || typeof value.minMateriality !== 'string' || !MATERIALITIES.includes(value.minMateriality)
      || typeof value.onlyActionable !== 'boolean') throw new Error('BRIDGE_INPUT_INVALID');
    return Object.freeze({
      topics: Object.freeze([...topics]),
      entities: Object.freeze([...entities]),
      timezone: value.timezone,
      deliveryLocalTime: value.deliveryLocalTime,
      maxCards: value.maxCards,
      minMateriality: value.minMateriality,
      onlyActionable: value.onlyActionable,
    });
  };

  const buildSearch = (preferences) => {
    const value = normalize(preferences);
    const params = new URLSearchParams();
    params.set('bridge', MARKER);
    params.set('topics', value.topics.join(','));
    if (value.entities.length) params.set('entities', value.entities.join('|'));
    params.set('tz', value.timezone);
    params.set('at', value.deliveryLocalTime);
    params.set('max', String(value.maxCards));
    params.set('min', value.minMateriality);
    params.set('actionable', value.onlyActionable ? '1' : '0');
    const search = `?${params.toString()}`;
    if (search.length > 32768) throw new Error('BRIDGE_SEARCH_TOO_LARGE');
    return search;
  };

  const parseSearch = (search) => {
    if (typeof search !== 'string' || search.length > 32768) return Object.freeze({ state: 'invalid', definition: null, reason: 'SEARCH_INVALID' });
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    if (!params.has('bridge')) return Object.freeze({ state: 'absent', definition: null });
    for (const key of params.keys()) {
      if (!ALLOWED_KEYS.has(key)) return Object.freeze({ state: 'invalid', definition: null, reason: 'UNKNOWN_PARAMETER' });
    }
    if (one(params, 'bridge') !== MARKER) return Object.freeze({ state: 'invalid', definition: null, reason: 'MARKER_INVALID' });
    const topics = one(params, 'topics');
    const entities = optionalOne(params, 'entities');
    const timezone = one(params, 'tz');
    const deliveryLocalTime = one(params, 'at');
    const maximum = one(params, 'max');
    const minimum = one(params, 'min');
    const actionable = one(params, 'actionable');
    if (topics === null || entities === null || timezone === null || deliveryLocalTime === null || maximum === null || minimum === null || actionable === null
      || !/^(?:0|1)$/u.test(actionable) || !/^[1-9]\d*$/u.test(maximum) || !Number.isSafeInteger(Number(maximum)) || Number(maximum) > 2147483647) {
      return Object.freeze({ state: 'invalid', definition: null, reason: 'PARAMETER_INVALID' });
    }
    try {
      return Object.freeze({ state: 'valid', definition: Object.freeze({
        ...normalize({
          topics: topics.split(','),
          entities: entities ? entities.split('|') : [],
          timezone,
          deliveryLocalTime,
          maxCards: Number(maximum),
          minMateriality: minimum,
          onlyActionable: actionable === '1',
        }),
        bridgeVersion: VERSION,
      }) });
    } catch {
      return Object.freeze({ state: 'invalid', definition: null, reason: 'DEFINITION_INVALID' });
    }
  };

  Object.defineProperty(window, 'DLKTCompanionBridge', {
    value: Object.freeze({
      version: VERSION,
      topics: TOPICS,
      materialities: MATERIALITIES,
      entityCapacity: 'payload-bounded',
      cardBudget: 'user-defined-positive-integer',
      normalize,
      buildSearch,
      buildUrl: (preferences) => `/today${buildSearch(preferences)}`,
      parseSearch,
    }),
    writable: false,
    configurable: false,
  });
})();
