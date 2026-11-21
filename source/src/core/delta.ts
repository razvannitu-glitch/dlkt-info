import { createHash } from 'node:crypto';
import type { ClaimDelta, DeltaKind, ReconciledClaim } from './contracts.js';
import { stableValue, strongestMateriality } from './claims.js';

const signature = (claim: ReconciledClaim): string => JSON.stringify({
  status: claim.status,
  values: [...new Set(claim.claims.map((item) => stableValue(item.value)))].sort(),
  blocked: [...claim.blockedDependencies].sort(),
});

const eventAt = (claim: ReconciledClaim | null): string => {
  const values = claim?.claims.map((item) => item.observedAt).sort((left, right) => Date.parse(right) - Date.parse(left));
  return values?.[0] ?? new Date(0).toISOString();
};

const deltaId = (key: string, kind: DeltaKind, previous: ReconciledClaim | null, current: ReconciledClaim | null): string =>
  createHash('sha256').update(`${key}|${kind}|${previous ? signature(previous) : ''}|${current ? signature(current) : ''}`).digest('hex').slice(0, 24);

export function compareClaims(previous: ReadonlyMap<string, ReconciledClaim>, current: ReadonlyMap<string, ReconciledClaim>): readonly ClaimDelta[] {
  const keys = [...new Set([...previous.keys(), ...current.keys()])].sort();
  const deltas: ClaimDelta[] = [];

  for (const key of keys) {
    const before = previous.get(key) ?? null;
    const after = current.get(key) ?? null;
    let kind: DeltaKind | null = null;
    if (!before && after) kind = after.status === 'contested' ? 'conflicted' : 'new';
    else if (before && !after) kind = 'resolved';
    else if (before && after && signature(before) !== signature(after)) kind = after.status === 'contested' ? 'conflicted' : 'changed';
    if (!kind) continue;

    const source = after ?? before;
    if (!source) continue;
    deltas.push(Object.freeze({
      id: deltaId(key, kind, before, after),
      key,
      kind,
      previous: before,
      current: after,
      materiality: strongestMateriality(source.claims),
      detectedAt: eventAt(after ?? before),
    }));
  }
  return Object.freeze(deltas);
}
