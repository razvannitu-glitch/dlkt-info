import { createHash } from 'node:crypto';
import { claimKey, reconcileClaims } from '../core/claims.js';
import type { AtomicClaim, BriefingDefinition, ClaimDelta } from '../core/contracts.js';
import { ENGINE_VERSION, PRODUCT_VERSION } from '../core/contracts.js';
import { compareClaims } from '../core/delta.js';
import { runBriefingOrchestra } from '../core/orchestra.js';
import { SourceRegistry } from '../core/source-registry.js';
import {
  EU_OFFICIAL_PACK_ID,
  EU_OFFICIAL_PACK_VERSION,
  EU_OFFICIAL_SOURCES,
  euOfficialChangePack,
} from '../packs/eu-official/index.js';
import type { InternalDeltaJob, InternalTrialCardLink, InternalTrialProjection } from './contracts.js';
import { INTERNAL_DELTA_TRIAL_VERSION } from './contracts.js';

const definition: BriefingDefinition = Object.freeze({
  id: 'internal-eu-delta-trial',
  ownerId: 'internal-review',
  name: 'Internal EU Delta Trial',
  timezone: 'UTC',
  deliveryLocalTime: '00:00',
  weekdays: Object.freeze([1, 2, 3, 4, 5, 6, 7]),
  channels: Object.freeze(['web'] as const),
  maxCards: 12,
  rules: Object.freeze([Object.freeze({
    id: 'internal-eu-regulation',
    includeTopics: Object.freeze(['regulation']),
    excludeTopics: Object.freeze([]),
    includeEntities: Object.freeze([]),
    excludeEntities: Object.freeze([]),
    includeGeographies: Object.freeze(['European Union']),
    languages: Object.freeze(['en']),
    minMateriality: 'low' as const,
    weight: 1,
    onlyActionable: false,
  })]),
});

const relationships = (delta: ClaimDelta, cardId: string): readonly InternalTrialCardLink[] => {
  const values = new Map<string, InternalTrialCardLink>();
  for (const claim of delta.current?.claims ?? []) {
    const relationship = delta.current?.status === 'contested' && claim.id !== delta.current.reviewPriorityClaimId
      ? 'contradicts' : 'supports';
    values.set(`${claim.id}|${relationship}`, Object.freeze({ externalCardId: cardId, claimId: claim.id, relationship }));
  }
  for (const claim of delta.previous?.claims ?? []) {
    const relationship = delta.current ? 'supersedes' : 'supports';
    values.set(`${claim.id}|${relationship}`, Object.freeze({ externalCardId: cardId, claimId: claim.id, relationship }));
  }
  return Object.freeze([...values.values()].sort((left, right) => left.claimId.localeCompare(right.claimId)
    || left.relationship.localeCompare(right.relationship)));
};

export function projectInternalDeltaTrial(job: InternalDeltaJob, now: number): InternalTrialProjection {
  if (!Number.isFinite(now) || Date.parse(job.windowEnd) > now + 60_000 || now - Date.parse(job.windowEnd) > 3_600_000) {
    throw new Error('DLKT_INFO_INTERNAL_TRIAL_WINDOW_INVALID');
  }
  const result = runBriefingOrchestra({
    definition,
    sources: EU_OFFICIAL_SOURCES,
    previousClaims: job.previousClaims,
    currentClaims: job.currentClaims,
    windowStart: job.windowStart,
    windowEnd: job.windowEnd,
    now,
    packs: [euOfficialChangePack],
  });

  const registry = new SourceRegistry(EU_OFFICIAL_SOURCES);
  const previous = reconcileClaims(job.previousClaims, registry, now);
  const current = reconcileClaims(job.currentClaims, registry, now);
  const deltas = compareClaims(previous.claims, current.claims);
  const byId = new Map(deltas.map((delta) => [delta.id, delta]));
  const cards = Object.freeze(result.briefing.cards.map((card, index) => Object.freeze({ position: index + 1, card })));
  const links = Object.freeze(cards.flatMap(({ card }) => {
    const delta = byId.get(card.deltaId);
    if (!delta) throw new Error('DLKT_INFO_INTERNAL_TRIAL_DELTA_MISSING');
    return relationships(delta, card.id);
  }));
  if (cards.some(({ card }) => !job.currentClaims.some((claim) => claim.entity.id === card.entity.id))) {
    throw new Error('DLKT_INFO_INTERNAL_TRIAL_ENTITY_SCOPE_INVALID');
  }
  const payloadHash = createHash('sha256').update(JSON.stringify({
    version: INTERNAL_DELTA_TRIAL_VERSION,
    jobId: job.jobId,
    sourceBatchId: job.sourceBatchId,
    packId: EU_OFFICIAL_PACK_ID,
    packVersion: EU_OFFICIAL_PACK_VERSION,
    engineVersion: ENGINE_VERSION,
    productVersion: PRODUCT_VERSION,
    briefing: result.briefing,
    links,
  })).digest('hex');
  return Object.freeze({
    version: INTERNAL_DELTA_TRIAL_VERSION,
    briefing: result.briefing,
    cards,
    links,
    payloadHash,
  });
}

export const internalTrialClaimKeys = (claims: readonly AtomicClaim[]): readonly string[] =>
  Object.freeze([...new Set(claims.map(claimKey))].sort());
