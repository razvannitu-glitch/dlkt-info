import { createHash } from 'node:crypto';
import type { AtomicClaim, CardSource, ClaimDelta, InfoCard, InfoPack } from './contracts.js';
import type { ScoredDelta } from './relevance.js';
import { SourceRegistry } from './source-registry.js';

const claimsFor = (delta: ClaimDelta): readonly AtomicClaim[] => delta.current?.claims ?? delta.previous?.claims ?? [];

function cardSources(delta: ClaimDelta, registry: SourceRegistry): readonly CardSource[] {
  const unique = new Map<string, CardSource>();
  for (const claim of claimsFor(delta)) {
    for (const evidence of claim.evidence) {
      const source = registry.get(evidence.sourceId);
      if (!source) continue;
      const key = `${evidence.sourceId}|${evidence.url}|${evidence.contentHash}`;
      unique.set(key, Object.freeze({
        sourceId: source.id,
        title: evidence.title,
        url: evidence.url,
        authority: source.authority,
        retrievedAt: evidence.retrievedAt,
      }));
    }
  }
  return Object.freeze([...unique.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.url.localeCompare(right.url)));
}

function minimumExpiry(claims: readonly AtomicClaim[]): string | null {
  const values = claims.map((claim) => claim.validUntil).filter((value): value is string => value !== null)
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return values[0] ?? null;
}

export function composeCard(scored: ScoredDelta, pack: InfoPack, registry: SourceRegistry, now: number): InfoCard {
  const claims = claimsFor(scored.delta);
  const claim = claims[0];
  if (!claim || !pack.supportedKinds.includes(claim.kind)) throw new Error('PACK_UNSUPPORTED_DELTA');
  const projection = pack.project(scored.delta);
  const id = createHash('sha256').update(`${scored.delta.id}|${pack.id}|${pack.version}`).digest('hex').slice(0, 24);
  return Object.freeze({
    id,
    deltaId: scored.delta.id,
    topicId: claim.topicId,
    entity: structuredClone(claim.entity),
    kind: scored.delta.kind,
    title: projection.title,
    direct: projection.direct,
    whyItMatters: projection.whyItMatters,
    changedSince: projection.changedSince,
    materiality: scored.delta.materiality,
    trust: scored.delta.current?.trust ?? scored.delta.previous?.trust ?? 'single-source',
    score: scored.score,
    blockedDependencies: Object.freeze([...(scored.delta.current?.blockedDependencies ?? [])]),
    sources: cardSources(scored.delta, registry),
    createdAt: new Date(now).toISOString(),
    expiresAt: minimumExpiry(claims),
  });
}
