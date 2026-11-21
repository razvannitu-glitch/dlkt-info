import type { CardTrust, Materiality, SourceAuthority } from '../core/contracts.js';

export const TRUST_CONTROL_VERSION = 'dlkt-info-trust-control-1' as const;
export const TRUST_CONTROL_ROUTE = '/trust' as const;
export const TRUST_CONTROL_MODE = 'synthetic-session-preview' as const;
export const TRUST_CONTROL_MARKER = 'trust-v1' as const;
export const TRUST_CONTROL_QUERY_KEYS = Object.freeze([
  'trust', 'level', 'conflicts', 'authority', 'sources', 'age', 'officialHigh',
] as const);

export type MinimumTrust = Exclude<CardTrust, 'conflicting'>;
export type ConflictPolicy = 'exclude' | 'include-warning';
export type AuthorityRequirement = Exclude<SourceAuthority, 'unknown'>;
export type MinimumSourceCount = 1 | 2;
export type MaximumEvidenceAgeHours = 24 | 72 | 168;

export interface TrustPolicy {
  readonly minimumTrust: MinimumTrust;
  readonly conflictPolicy: ConflictPolicy;
  readonly authorityRequirement: AuthorityRequirement;
  readonly minimumSources: MinimumSourceCount;
  readonly maximumEvidenceAgeHours: MaximumEvidenceAgeHours;
  readonly requireOfficialForHighImpact: boolean;
}

export interface TrustCandidateSource {
  readonly authority: SourceAuthority;
}

export interface TrustCandidate {
  readonly id: string;
  readonly trust: CardTrust;
  readonly materiality: Materiality;
  readonly evidenceAgeHours: number;
  readonly sources: readonly TrustCandidateSource[];
}

export interface TrustDecision {
  readonly candidateId: string;
  readonly included: boolean;
  readonly blockingReasons: readonly string[];
  readonly warnings: readonly string[];
}

export interface TrustProjection {
  readonly policy: TrustPolicy;
  readonly decisions: readonly TrustDecision[];
  readonly includedIds: readonly string[];
  readonly excludedIds: readonly string[];
}

export type TrustPolicyParseResult =
  | Readonly<{ state: 'absent'; policy: null }>
  | Readonly<{ state: 'invalid'; policy: null; reason: string }>
  | Readonly<{ state: 'valid'; policy: TrustPolicy }>;

export const defaultTrustPolicy: TrustPolicy = Object.freeze({
  minimumTrust: 'corroborated',
  conflictPolicy: 'exclude',
  authorityRequirement: 'primary',
  minimumSources: 2,
  maximumEvidenceAgeHours: 72,
  requireOfficialForHighImpact: true,
});

export const trustControlContract = Object.freeze({
  version: TRUST_CONTROL_VERSION,
  route: TRUST_CONTROL_ROUTE,
  mode: TRUST_CONTROL_MODE,
  marker: TRUST_CONTROL_MARKER,
  browserStorage: false,
  persistenceEnabled: false,
  hiddenTrustRulesAllowed: false,
  automaticTruthSelection: false,
  policyIsUserVisible: true,
  maximumCandidates: 12,
});
