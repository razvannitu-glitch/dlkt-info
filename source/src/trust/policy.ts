import type { CardTrust, Materiality, SourceAuthority } from '../core/contracts.js';
import {
  TRUST_CONTROL_MARKER,
  TRUST_CONTROL_QUERY_KEYS,
  defaultTrustPolicy,
  type AuthorityRequirement,
  type ConflictPolicy,
  type MaximumEvidenceAgeHours,
  type MinimumSourceCount,
  type MinimumTrust,
  type TrustCandidate,
  type TrustDecision,
  type TrustPolicy,
  type TrustPolicyParseResult,
  type TrustProjection,
} from './contracts.js';

const trustRank: Readonly<Record<Exclude<CardTrust, 'conflicting'>, number>> = Object.freeze({
  confirmed: 3,
  corroborated: 2,
  'single-source': 1,
});

const authorityRank: Readonly<Record<SourceAuthority, number>> = Object.freeze({
  official: 4,
  primary: 3,
  'reputable-secondary': 2,
  community: 1,
  unknown: 0,
});

const materialityRank: Readonly<Record<Materiality, number>> = Object.freeze({
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
});

const minimumTrustValues = Object.freeze(['confirmed', 'corroborated', 'single-source'] as const);
const conflictValues = Object.freeze(['exclude', 'include-warning'] as const);
const authorityValues = Object.freeze(['official', 'primary', 'reputable-secondary', 'community'] as const);
const candidateAuthorityValues = new Set<SourceAuthority>([...authorityValues, 'unknown']);
const sourceCountValues = Object.freeze([1, 2] as const);
const ageValues = Object.freeze([24, 72, 168] as const);
const allowedForeignKeys = new Set([
  'bridge', 'topics', 'entities', 'tz', 'at', 'max', 'min', 'actionable',
  'actions', 'watch', 'remind', 'compare', 'resolved', 'ignore', '_vercel_share',
  'delivery', 'dw', 'dr', 'dc', 'dx', 'di', 'qh', 'qs', 'qe', 'cap', 'gap', 'bypass', 'conflict', 'trustFloor', 'materialityFloor', 'channel',
]);

function exactKeys(value: Record<string, unknown>): boolean {
  const expected = new Set([
    'minimumTrust', 'conflictPolicy', 'authorityRequirement', 'minimumSources',
    'maximumEvidenceAgeHours', 'requireOfficialForHighImpact',
  ]);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

export function parseTrustPolicy(value: unknown): TrustPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('TRUST_POLICY_INVALID');
  const row = value as Record<string, unknown>;
  if (!exactKeys(row)
    || typeof row.minimumTrust !== 'string' || !minimumTrustValues.includes(row.minimumTrust as MinimumTrust)
    || typeof row.conflictPolicy !== 'string' || !conflictValues.includes(row.conflictPolicy as ConflictPolicy)
    || typeof row.authorityRequirement !== 'string' || !authorityValues.includes(row.authorityRequirement as AuthorityRequirement)
    || typeof row.minimumSources !== 'number' || !sourceCountValues.includes(row.minimumSources as MinimumSourceCount)
    || typeof row.maximumEvidenceAgeHours !== 'number' || !ageValues.includes(row.maximumEvidenceAgeHours as MaximumEvidenceAgeHours)
    || typeof row.requireOfficialForHighImpact !== 'boolean') throw new Error('TRUST_POLICY_INVALID');
  return Object.freeze({
    minimumTrust: row.minimumTrust as MinimumTrust,
    conflictPolicy: row.conflictPolicy as ConflictPolicy,
    authorityRequirement: row.authorityRequirement as AuthorityRequirement,
    minimumSources: row.minimumSources as MinimumSourceCount,
    maximumEvidenceAgeHours: row.maximumEvidenceAgeHours as MaximumEvidenceAgeHours,
    requireOfficialForHighImpact: row.requireOfficialForHighImpact,
  });
}

export function evaluateTrustCandidate(candidate: TrustCandidate, input: unknown): TrustDecision {
  const policy = parseTrustPolicy(input);
  if (!candidate || typeof candidate !== 'object' || typeof candidate.id !== 'string' || candidate.id.length < 1
    || !Number.isFinite(candidate.evidenceAgeHours) || candidate.evidenceAgeHours < 0
    || !Array.isArray(candidate.sources) || candidate.sources.length < 1 || candidate.sources.length > 12
    || candidate.sources.some((source) => !source || typeof source !== 'object'
      || !candidateAuthorityValues.has((source as { authority?: SourceAuthority }).authority ?? 'unknown'))) {
    throw new Error('TRUST_CANDIDATE_INVALID');
  }
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  const authorities: SourceAuthority[] = candidate.sources.map((source) => source.authority);
  const bestAuthority = Math.max(...authorities.map((authority) => authorityRank[authority] ?? 0));

  if (candidate.trust === 'conflicting') {
    if (policy.conflictPolicy === 'exclude') blockingReasons.push('Unresolved contradiction is excluded by your policy.');
    else warnings.push('Unresolved contradiction remains visible and blocked from automatic action.');
  } else if (trustRank[candidate.trust] < trustRank[policy.minimumTrust]) {
    blockingReasons.push(`Trust level ${candidate.trust} is below ${policy.minimumTrust}.`);
  }
  if (candidate.sources.length < policy.minimumSources) {
    blockingReasons.push(`Only ${candidate.sources.length} source is available; ${policy.minimumSources} are required.`);
  }
  if (bestAuthority < authorityRank[policy.authorityRequirement]) {
    blockingReasons.push(`No source meets the ${policy.authorityRequirement} authority requirement.`);
  }
  if (candidate.evidenceAgeHours > policy.maximumEvidenceAgeHours) {
    blockingReasons.push(`Evidence is older than ${policy.maximumEvidenceAgeHours} hours.`);
  }
  if (policy.requireOfficialForHighImpact && materialityRank[candidate.materiality] >= materialityRank.high
    && !authorities.includes('official')) {
    blockingReasons.push('High-impact information requires an official source.');
  }

  return Object.freeze({
    candidateId: candidate.id,
    included: blockingReasons.length === 0,
    blockingReasons: Object.freeze(blockingReasons),
    warnings: Object.freeze(warnings),
  });
}

export function projectTrustPolicy(candidates: readonly TrustCandidate[], input: unknown): TrustProjection {
  if (!Array.isArray(candidates) || candidates.length > 12) throw new Error('TRUST_CANDIDATES_INVALID');
  const policy = parseTrustPolicy(input);
  const decisions = Object.freeze(candidates.map((candidate) => evaluateTrustCandidate(candidate, policy)));
  return Object.freeze({
    policy,
    decisions,
    includedIds: Object.freeze(decisions.filter((decision) => decision.included).map((decision) => decision.candidateId)),
    excludedIds: Object.freeze(decisions.filter((decision) => !decision.included).map((decision) => decision.candidateId)),
  });
}

function one(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] ?? null : null;
}

export function buildTrustPolicySearch(input: unknown): string {
  const policy = parseTrustPolicy(input);
  const params = new URLSearchParams();
  params.set('trust', TRUST_CONTROL_MARKER);
  params.set('level', policy.minimumTrust);
  params.set('conflicts', policy.conflictPolicy);
  params.set('authority', policy.authorityRequirement);
  params.set('sources', String(policy.minimumSources));
  params.set('age', String(policy.maximumEvidenceAgeHours));
  params.set('officialHigh', policy.requireOfficialForHighImpact ? '1' : '0');
  return `?${params.toString()}`;
}

export function parseTrustPolicySearch(search: string): TrustPolicyParseResult {
  if (typeof search !== 'string' || search.length > 1400) return Object.freeze({ state: 'invalid', policy: null, reason: 'SEARCH_INVALID' });
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const hasTrustKey = TRUST_CONTROL_QUERY_KEYS.some((key) => params.has(key));
  if (!hasTrustKey) return Object.freeze({ state: 'absent', policy: null });
  for (const key of params.keys()) {
    if (!TRUST_CONTROL_QUERY_KEYS.includes(key as (typeof TRUST_CONTROL_QUERY_KEYS)[number]) && !allowedForeignKeys.has(key)) {
      return Object.freeze({ state: 'invalid', policy: null, reason: 'UNKNOWN_PARAMETER' });
    }
  }
  if (TRUST_CONTROL_QUERY_KEYS.some((key) => params.getAll(key).length !== 1)) {
    return Object.freeze({ state: 'invalid', policy: null, reason: 'DUPLICATE_OR_PARTIAL' });
  }
  if (one(params, 'trust') !== TRUST_CONTROL_MARKER) return Object.freeze({ state: 'invalid', policy: null, reason: 'MARKER_INVALID' });
  try {
    return Object.freeze({
      state: 'valid',
      policy: parseTrustPolicy({
        minimumTrust: one(params, 'level'),
        conflictPolicy: one(params, 'conflicts'),
        authorityRequirement: one(params, 'authority'),
        minimumSources: Number(one(params, 'sources')),
        maximumEvidenceAgeHours: Number(one(params, 'age')),
        requireOfficialForHighImpact: one(params, 'officialHigh') === '1',
      }),
    });
  } catch {
    return Object.freeze({ state: 'invalid', policy: null, reason: 'POLICY_INVALID' });
  }
}

export function defaultTrustProjection(candidates: readonly TrustCandidate[]): TrustProjection {
  return projectTrustPolicy(candidates, defaultTrustPolicy);
}
