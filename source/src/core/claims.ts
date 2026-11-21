import { createHash } from 'node:crypto';
import type {
  AtomicClaim,
  CardTrust,
  ClaimValue,
  Materiality,
  ReconciledClaim,
  SourceAuthority,
} from './contracts.js';
import { assertAtomicClaim } from './guards.js';
import { SourceRegistry } from './source-registry.js';

const authorityRank: Readonly<Record<SourceAuthority, number>> = Object.freeze({
  official: 5,
  primary: 4,
  'reputable-secondary': 3,
  community: 2,
  unknown: 1,
});

export const materialityRank: Readonly<Record<Materiality, number>> = Object.freeze({
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
});

export const claimKey = (claim: AtomicClaim): string => `${claim.entity.id}|${claim.predicate}`;

export function stableValue(value: ClaimValue): string {
  if (Array.isArray(value)) return JSON.stringify([...value].sort((left, right) => String(left).localeCompare(String(right))));
  return JSON.stringify(value);
}

export const claimFingerprint = (claim: AtomicClaim): string => createHash('sha256')
  .update([claimKey(claim), stableValue(claim.value), claim.validFrom, claim.validUntil ?? '',
    ...claim.evidence.map((evidence) => `${evidence.sourceId}|${evidence.url}|${evidence.contentHash}`).sort()].join('\n'))
  .digest('hex');

export function isClaimCurrent(claim: AtomicClaim, now: number): boolean {
  const observed = Date.parse(claim.observedAt);
  const from = Date.parse(claim.validFrom);
  const until = claim.validUntil === null ? Number.POSITIVE_INFINITY : Date.parse(claim.validUntil);
  return Number.isFinite(now) && observed <= now + 60_000 && from <= now && until > now;
}

function bestClaim(claims: readonly AtomicClaim[], registry: SourceRegistry): AtomicClaim {
  return [...claims].sort((left, right) => {
    const authority = (claim: AtomicClaim): number => Math.max(...claim.evidence.map((evidence) => {
      const source = registry.get(evidence.sourceId);
      return source ? authorityRank[source.authority] : 0;
    }), 0);
    return authority(right) - authority(left)
      || Date.parse(right.observedAt) - Date.parse(left.observedAt)
      || left.id.localeCompare(right.id);
  })[0] as AtomicClaim;
}

function trustFor(claims: readonly AtomicClaim[], registry: SourceRegistry): CardTrust {
  const sourceIds = new Set(claims.flatMap((claim) => claim.evidence.map((evidence) => evidence.sourceId)));
  const authorities = [...sourceIds].map((sourceId) => registry.get(sourceId)?.authority ?? 'unknown');
  if (authorities.includes('official')) return 'confirmed';
  if (sourceIds.size >= 2 && authorities.some((authority) => authority === 'primary' || authority === 'reputable-secondary')) return 'corroborated';
  return 'single-source';
}

export interface ReconciliationResult {
  readonly accepted: readonly AtomicClaim[];
  readonly rejected: readonly Readonly<{ claimId: string; reason: 'invalid' | 'unauthorized' | 'expired' | 'duplicate' }>[];
  readonly claims: ReadonlyMap<string, ReconciledClaim>;
}

export function reconcileClaims(input: readonly AtomicClaim[], registry: SourceRegistry, now: number): ReconciliationResult {
  const accepted: AtomicClaim[] = [];
  const rejected: Array<{ claimId: string; reason: 'invalid' | 'unauthorized' | 'expired' | 'duplicate' }> = [];
  const fingerprints = new Set<string>();

  for (const claim of input) {
    try { assertAtomicClaim(claim); } catch { rejected.push({ claimId: String(claim?.id ?? 'unknown'), reason: 'invalid' }); continue; }
    if (!isClaimCurrent(claim, now)) { rejected.push({ claimId: claim.id, reason: 'expired' }); continue; }
    if (!registry.authorizeClaim(claim, now)) { rejected.push({ claimId: claim.id, reason: 'unauthorized' }); continue; }
    const fingerprint = claimFingerprint(claim);
    if (fingerprints.has(fingerprint)) { rejected.push({ claimId: claim.id, reason: 'duplicate' }); continue; }
    fingerprints.add(fingerprint);
    accepted.push(structuredClone(claim));
  }

  const grouped = new Map<string, AtomicClaim[]>();
  for (const claim of accepted) {
    const key = claimKey(claim);
    const group = grouped.get(key) ?? [];
    group.push(claim);
    grouped.set(key, group);
  }

  const reconciled = new Map<string, ReconciledClaim>();
  for (const [key, claims] of grouped) {
    const values = new Set(claims.map((claim) => stableValue(claim.value)));
    const contested = values.size > 1;
    const preferred = bestClaim(claims, registry);
    reconciled.set(key, Object.freeze({
      key,
      status: contested ? 'contested' : 'supported',
      selectedClaimId: contested ? null : preferred.id,
      reviewPriorityClaimId: preferred.id,
      claims: Object.freeze(claims.map((claim) => structuredClone(claim))),
      blockedDependencies: Object.freeze(contested ? [...new Set(claims.flatMap((claim) => claim.affects))].sort() : []),
      trust: contested ? 'conflicting' : trustFor(claims, registry),
    }));
  }

  return Object.freeze({
    accepted: Object.freeze(accepted.map((claim) => structuredClone(claim))),
    rejected: Object.freeze(rejected.map((item) => Object.freeze({ ...item }))),
    claims: reconciled,
  });
}

export function strongestMateriality(claims: readonly AtomicClaim[]): Materiality {
  return [...claims].sort((left, right) => materialityRank[right.materiality] - materialityRank[left.materiality])[0]?.materiality ?? 'low';
}
