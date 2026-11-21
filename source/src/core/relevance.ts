import type { AtomicClaim, BriefingDefinition, ClaimDelta, InterestRule, Materiality, SourceAuthority } from './contracts.js';
import { materialityRank } from './claims.js';
import { SourceRegistry } from './source-registry.js';

const authorityWeight: Readonly<Record<SourceAuthority, number>> = Object.freeze({
  official: 20,
  primary: 14,
  'reputable-secondary': 8,
  community: 2,
  unknown: 0,
});
const deltaWeight = Object.freeze({ new: 15, changed: 25, resolved: 10, conflicted: 30 });
const minRank = (materiality: Materiality): number => materialityRank[materiality];

const claimsFor = (delta: ClaimDelta): readonly AtomicClaim[] => delta.current?.claims ?? delta.previous?.claims ?? [];

function ruleMatches(rule: InterestRule, delta: ClaimDelta): boolean {
  const claims = claimsFor(delta);
  const claim = claims[0];
  if (!claim || minRank(delta.materiality) < minRank(rule.minMateriality)) return false;
  if (rule.excludeTopics.includes(claim.topicId) || rule.excludeEntities.includes(claim.entity.id)) return false;
  if (rule.includeTopics.length > 0 && !rule.includeTopics.includes(claim.topicId)) return false;
  if (rule.includeEntities.length > 0 && !rule.includeEntities.includes(claim.entity.id)) return false;
  if (rule.includeGeographies.length > 0 && (claim.geography === null || !rule.includeGeographies.includes(claim.geography))) return false;
  if (rule.languages.length > 0 && !rule.languages.includes(claim.locale)) return false;
  if (rule.onlyActionable && Math.max(...claims.map((item) => item.actionability), 0) <= 0) return false;
  return true;
}

function maxAuthority(claims: readonly AtomicClaim[], registry: SourceRegistry): number {
  return Math.max(...claims.flatMap((claim) => claim.evidence.map((evidence) => {
    const source = registry.get(evidence.sourceId);
    return source ? authorityWeight[source.authority] : 0;
  })), 0);
}

export interface RankingBreakdown {
  readonly materiality: number;
  readonly deltaKind: number;
  readonly recency: number;
  readonly actionability: number;
  readonly sourceAuthority: number;
  readonly ruleWeight: number;
  readonly total: number;
}

export interface ScoredDelta {
  readonly delta: ClaimDelta;
  readonly score: number;
  readonly matchedRuleIds: readonly string[];
  readonly ranking: RankingBreakdown;
}

export function scoreDelta(delta: ClaimDelta, definition: BriefingDefinition, registry: SourceRegistry, now: number): ScoredDelta | null {
  const rules = definition.rules.filter((rule) => ruleMatches(rule, delta));
  if (rules.length === 0) return null;
  const claims = claimsFor(delta);
  const hours = Math.max(0, (now - Date.parse(delta.detectedAt)) / 3_600_000);
  const recency = Math.max(0, 20 - Math.min(20, hours / 6));
  const materiality = materialityRank[delta.materiality] * 25;
  const kind = deltaWeight[delta.kind];
  const actionability = Math.max(...claims.map((claim) => claim.actionability), 0) * 20;
  const authority = maxAuthority(claims, registry);
  const ruleWeight = Math.max(...rules.map((rule) => rule.weight), 0) * 10;
  const score = materiality + kind + recency + actionability + authority + ruleWeight;
  const total = Number(score.toFixed(3));
  return Object.freeze({
    delta,
    score: total,
    matchedRuleIds: Object.freeze(rules.map((rule) => rule.id).sort()),
    ranking: Object.freeze({
      materiality,
      deltaKind: kind,
      recency: Number(recency.toFixed(3)),
      actionability,
      sourceAuthority: authority,
      ruleWeight,
      total,
    }),
  });
}
