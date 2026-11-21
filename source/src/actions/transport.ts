import {
  ACTION_CONTROL_MARKER,
  ACTION_CONTROL_QUERY_KEYS,
  type ActionSearchParseResult,
  type ActionType,
  type UserAction,
} from './contracts.js';

const ID = /^[a-z0-9][a-z0-9:._-]{1,127}$/u;
const QUERY_TO_TYPE = Object.freeze({
  watch: 'watch-change',
  remind: 'remind-next-briefing',
  compare: 'compare-next',
  resolved: 'mark-resolved',
  ignore: 'ignore-pattern',
} as const satisfies Readonly<Record<string, ActionType>>);
const FOREIGN_KEYS = new Set([
  'bridge', 'topics', 'entities', 'tz', 'at', 'max', 'min', 'actionable',
  'trust', 'level', 'conflicts', 'authority', 'sources', 'age', 'officialHigh',
  'delivery', 'dw', 'dr', 'dc', 'dx', 'di', 'qh', 'qs', 'qe', 'cap', 'gap', 'bypass', 'conflict', 'trustFloor', 'materialityFloor', 'channel', '_vercel_share',
]);

function parseIds(value: string | null): readonly string[] {
  if (value === null || value === '') return Object.freeze([]);
  const ids = value.split(',');
  if (ids.length > 12 || new Set(ids).size !== ids.length || ids.some((id) => !ID.test(id))) {
    throw new Error('ACTION_QUERY_IDS_INVALID');
  }
  return Object.freeze(ids);
}

function buildAction(candidateId: string, type: ActionType): UserAction {
  return Object.freeze({
    id: `action:${type}:${candidateId}`,
    candidateId,
    type,
    status: 'active' as const,
    createdAt: '2026-11-12T08:00:00.000Z',
    scheduledFor: type === 'remind-next-briefing' ? '2026-11-13T08:00:00.000Z' : null,
    reason: `Explicit ${type} action selected by the user.`,
  });
}

export function parseActionSearch(search: string): ActionSearchParseResult {
  if (typeof search !== 'string' || search.length > 2_048) {
    return Object.freeze({ state: 'invalid', actions: Object.freeze([]), reason: 'ACTION_QUERY_LENGTH' });
  }
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  if (!keys.some((key) => ACTION_CONTROL_QUERY_KEYS.includes(key as typeof ACTION_CONTROL_QUERY_KEYS[number]))) {
    return Object.freeze({ state: 'absent', actions: Object.freeze([]) });
  }
  if (keys.some((key) => !ACTION_CONTROL_QUERY_KEYS.includes(key as typeof ACTION_CONTROL_QUERY_KEYS[number]) && !FOREIGN_KEYS.has(key))) {
    return Object.freeze({ state: 'invalid', actions: Object.freeze([]), reason: 'ACTION_QUERY_UNKNOWN' });
  }
  if (ACTION_CONTROL_QUERY_KEYS.some((key) => params.getAll(key).length > 1) || params.get('actions') !== ACTION_CONTROL_MARKER) {
    return Object.freeze({ state: 'invalid', actions: Object.freeze([]), reason: 'ACTION_QUERY_DUPLICATE_OR_MARKER' });
  }
  try {
    const actions: UserAction[] = [];
    const seen = new Set<string>();
    for (const [key, type] of Object.entries(QUERY_TO_TYPE) as [keyof typeof QUERY_TO_TYPE, ActionType][]) {
      for (const candidateId of parseIds(params.get(key))) {
        if (seen.has(`${candidateId}:${type}`)) throw new Error('ACTION_QUERY_DUPLICATE_ACTION');
        seen.add(`${candidateId}:${type}`);
        actions.push(buildAction(candidateId, type));
      }
    }
    const ignored = new Set(actions.filter((action) => action.type === 'ignore-pattern').map((action) => action.candidateId));
    if (actions.some((action) => action.type !== 'ignore-pattern' && ignored.has(action.candidateId))) {
      throw new Error('ACTION_QUERY_IGNORE_EXCLUSIVE');
    }
    if (actions.length > 24) throw new Error('ACTION_QUERY_LIMIT');
    return Object.freeze({ state: 'valid', actions: Object.freeze(actions) });
  } catch (error) {
    return Object.freeze({ state: 'invalid', actions: Object.freeze([]), reason: error instanceof Error ? error.message : 'ACTION_QUERY_INVALID' });
  }
}

export function buildActionSearch(actions: readonly UserAction[]): string {
  if (actions.length > 24) throw new Error('ACTION_QUERY_LIMIT');
  const params = new URLSearchParams();
  params.set('actions', ACTION_CONTROL_MARKER);
  for (const [key, type] of Object.entries(QUERY_TO_TYPE) as [keyof typeof QUERY_TO_TYPE, ActionType][]) {
    const ids = actions.filter((action) => action.status === 'active' && action.type === type).map((action) => action.candidateId);
    if (ids.length > 0) params.set(key, [...new Set(ids)].sort().join(','));
  }
  return `?${params.toString()}`;
}
