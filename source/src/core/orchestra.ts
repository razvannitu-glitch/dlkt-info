import { createHash } from 'node:crypto';
import type { AtomicClaim, Briefing, BriefingDefinition, InfoPack, SourceRecord } from './contracts.js';
import { assertBriefingDefinition, isInstant } from './guards.js';
import { reconcileClaims } from './claims.js';
import { compareClaims } from './delta.js';
import { scoreDelta } from './relevance.js';
import { composeCard } from './cards.js';
import { genericInfoPack } from './generic-pack.js';
import { nextDeliveryAt } from './schedule.js';
import { SourceRegistry } from './source-registry.js';

export interface OrchestraInput {
  readonly definition: BriefingDefinition;
  readonly sources: readonly SourceRecord[];
  readonly previousClaims: readonly AtomicClaim[];
  readonly currentClaims: readonly AtomicClaim[];
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly now: number;
  readonly packs?: readonly InfoPack[];
}

export interface OrchestraDiagnostics {
  readonly acceptedPrevious: number;
  readonly acceptedCurrent: number;
  readonly rejectedPrevious: number;
  readonly rejectedCurrent: number;
  readonly stableClaimsOmitted: number;
  readonly sourceRegistrySize: number;
}

export interface OrchestraResult {
  readonly briefing: Briefing;
  readonly diagnostics: OrchestraDiagnostics;
}

function packForKind(kind: AtomicClaim['kind'], packs: readonly InfoPack[]): InfoPack {
  return packs.find((pack) => pack.supportedKinds.includes(kind)) ?? genericInfoPack;
}

export function runBriefingOrchestra(input: OrchestraInput): OrchestraResult {
  assertBriefingDefinition(input.definition);
  if (!isInstant(input.windowStart) || !isInstant(input.windowEnd) || !Number.isFinite(input.now)) throw new Error('ORCHESTRA_CLOCK_INVALID');
  const start = Date.parse(input.windowStart);
  const end = Date.parse(input.windowEnd);
  if (!(start < end) || end > input.now + 60_000 || input.now - end > 3_600_000) throw new Error('ORCHESTRA_WINDOW_INVALID');

  const registry = new SourceRegistry(input.sources);
  const previous = reconcileClaims(input.previousClaims, registry, start);
  const current = reconcileClaims(input.currentClaims, registry, input.now);
  const deltas = compareClaims(previous.claims, current.claims);
  const scored = deltas.map((delta) => scoreDelta(delta, input.definition, registry, input.now))
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((left, right) => right.score - left.score || left.delta.id.localeCompare(right.delta.id));
  const packs = Object.freeze([...(input.packs ?? []), genericInfoPack]);
  const cards = scored.slice(0, input.definition.maxCards).map((item) => {
    const claim = item.delta.current?.claims[0] ?? item.delta.previous?.claims[0];
    if (!claim) throw new Error('DELTA_WITHOUT_CLAIM');
    return composeCard(item, packForKind(claim.kind, packs), registry, input.now);
  });
  const briefingId = createHash('sha256').update([
    input.definition.id,
    input.windowStart,
    input.windowEnd,
    ...cards.map((card) => card.id),
  ].join('|')).digest('hex').slice(0, 24);
  const contestedCount = [...current.claims.values()].filter((claim) => claim.status === 'contested').length;
  const briefing: Briefing = Object.freeze({
    version: 'dlkt-info-briefing-1',
    id: briefingId,
    definitionId: input.definition.id,
    generatedAt: new Date(input.now).toISOString(),
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    nextDeliveryAt: nextDeliveryAt(input.definition, input.now),
    cards: Object.freeze(cards),
    totalEligibleDeltas: scored.length,
    omittedByLimit: Math.max(0, scored.length - cards.length),
    contestedCount,
    status: cards.length > 0 ? 'ready' : 'empty',
  });
  return Object.freeze({
    briefing,
    diagnostics: Object.freeze({
      acceptedPrevious: previous.accepted.length,
      acceptedCurrent: current.accepted.length,
      rejectedPrevious: previous.rejected.length,
      rejectedCurrent: current.rejected.length,
      stableClaimsOmitted: Math.max(0, Math.min(previous.claims.size, current.claims.size) - deltas.length),
      sourceRegistrySize: registry.size,
    }),
  });
}
