/**
 * DLKT Universal Flow — deterministic, side-effect-free candidate ranking.
 * This module is intentionally not wired into production until release gates
 * and real-source integration tests have been completed.
 */
export type Scope = "neighborhood" | "city" | "region" | "country" | "global" | "unknown";
export type CardKind = "news" | "administrative" | "historical" | "discovery" | "commercial" | "essential" | "other";

export interface FlowCandidate {
  readonly id: string;
  readonly eventId: string;
  readonly publisherId: string;
  readonly kind: CardKind;
  readonly scope: Scope;
  readonly countryCode: string | null;
  readonly cityId: string | null;
  readonly publishedAt: string;
  readonly verified: boolean;
  readonly rightsCleared: boolean;
  readonly importance: number;
}

export interface FlowContext {
  readonly countryCode: string;
  readonly cityId: string | null;
  readonly now: string;
  readonly seenEventIds: ReadonlySet<string>;
  readonly limit: number;
}

const scopeWeights: Readonly<Record<Scope, number>> = {
  neighborhood: 120, city: 95, region: 70, country: 55, global: 25, unknown: 0,
};

function validDate(value: string): number | null {
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : null;
}

function geoScore(candidate: FlowCandidate, context: FlowContext): number {
  if (candidate.countryCode === context.countryCode) {
    if (context.cityId !== null && candidate.cityId === context.cityId) {
      return scopeWeights[candidate.scope] + 50;
    }
    return candidate.scope === "global" ? 25 : 55;
  }
  return candidate.scope === "global" ? 25 : 10;
}

/** Input ordering cannot influence the outcome. Does not invent or enrich content. */
export function composeUniversalFlow(
  candidates: readonly FlowCandidate[],
  context: FlowContext,
): FlowCandidate[] {
  const now = validDate(context.now);
  if (now === null || !Number.isSafeInteger(context.limit) || context.limit < 0 || context.limit > 200) {
    throw new RangeError("Invalid flow context");
  }
  const eligible = candidates.filter((candidate) => {
    const time = validDate(candidate.publishedAt);
    return candidate.verified && candidate.rightsCleared
      && candidate.id.length > 0 && candidate.eventId.length > 0
      && candidate.publisherId.length > 0
      && !context.seenEventIds.has(candidate.eventId)
      && time !== null && time <= now
      && Number.isFinite(candidate.importance)
      && candidate.importance >= 0 && candidate.importance <= 100;
  });
  const ranked = eligible.map((candidate) => {
    const ageHours = Math.max(0, (now - Date.parse(candidate.publishedAt)) / 3_600_000);
    const freshness = Math.max(0, 48 - ageHours) / 2;
    return { candidate, score: geoScore(candidate, context) + candidate.importance + freshness };
  }).sort((a, b) => b.score - a.score
    || a.candidate.eventId.localeCompare(b.candidate.eventId)
    || a.candidate.id.localeCompare(b.candidate.id));

  const selected: FlowCandidate[] = [];
  const events = new Set<string>();
  const publisherCounts = new Map<string, number>();
  const kinds = new Map<CardKind, number>();
  const pool = [...ranked];
  while (selected.length < context.limit && pool.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const item = pool[i];
      if (!item || events.has(item.candidate.eventId)) continue;
      const publisherPenalty = (publisherCounts.get(item.candidate.publisherId) ?? 0) * 25;
      const kindPenalty = (kinds.get(item.candidate.kind) ?? 0) * 7;
      const score = item.score - publisherPenalty - kindPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestScore === -Infinity) break;
    const [chosen] = pool.splice(bestIndex, 1);
    if (!chosen) break;
    const candidate = chosen.candidate;
    events.add(candidate.eventId);
    selected.push(candidate);
    publisherCounts.set(candidate.publisherId, (publisherCounts.get(candidate.publisherId) ?? 0) + 1);
    kinds.set(candidate.kind, (kinds.get(candidate.kind) ?? 0) + 1);
  }
  return selected;
}
