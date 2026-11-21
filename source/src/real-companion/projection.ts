import { PRODUCT_VERSION } from '../core/contracts.js';
import type { DeltaOfficialCard } from '../delta-official/contracts.js';
import type { OperationalDeltaCard } from '../operational-ledger/index.js';
type RealDeltaCard = DeltaOfficialCard | OperationalDeltaCard;
import type { TrustPolicy } from '../trust/contracts.js';
import {
  REAL_COMPANION_MODE,
  REAL_COMPANION_VERSION,
  type RealCompanionCard,
  type RealCompanionCurrentOfficial,
  type RealCompanionDefinition,
  type RealCompanionSnapshot,
  type RealCompanionSourceBundle,
  type RealCompanionSourceState,
  type RealCompanionTrustDecision,
} from './contracts.js';

const normalizeText = (value: string): string => value
  .normalize('NFKC')
  .toLocaleLowerCase('en-US')
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
  .replace(/\s+/gu, ' ')
  .trim();

const matchesEntity = (card: RealDeltaCard, entity: string): boolean => {
  const query = normalizeText(entity);
  if (!query) return false;
  if (card.celexId.toLocaleLowerCase('en-US') === entity.toLocaleLowerCase('en-US')) return true;
  return [card.title, card.creator, card.feedLabel, card.source.name, card.celexId]
    .map(normalizeText)
    .some((candidate) => candidate === query || candidate.includes(` ${query} `)
      || candidate.startsWith(`${query} `) || candidate.endsWith(` ${query}`));
};

const evidenceAgeHours = (observedAt: string, generatedAt: string): number => {
  const observed = Date.parse(observedAt);
  const generated = Date.parse(generatedAt);
  if (!Number.isFinite(observed) || !Number.isFinite(generated) || generated < observed) return Number.POSITIVE_INFINITY;
  return Math.round(((generated - observed) / 3_600_000) * 100) / 100;
};

const trustDecision = (card: RealDeltaCard, policy: TrustPolicy, generatedAt: string): RealCompanionTrustDecision => {
  const age = evidenceAgeHours(card.observedAt, generatedAt);
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  if (age > policy.maximumEvidenceAgeHours) {
    blockingReasons.push(`Official observation is older than ${policy.maximumEvidenceAgeHours} hours.`);
  }
  if (policy.minimumSources > 1) {
    warnings.push('One official authority directly proves this narrow listing claim; impact conclusions still require separate corroboration.');
  }
  return Object.freeze({
    included: blockingReasons.length === 0,
    trust: 'confirmed',
    authority: 'official',
    evidenceAgeHours: age,
    authoritativeSourceSufficient: true,
    blockingReasons: Object.freeze(blockingReasons),
    warnings: Object.freeze(warnings),
  });
};

const currentOfficial = (sources: RealCompanionSourceBundle): RealCompanionCurrentOfficial => {
  const live = sources.live;
  return Object.freeze({
    available: live !== null,
    route: '/live',
    generatedAt: live?.generatedAt ?? null,
    complete: live?.complete ?? false,
    partial: live?.partial ?? false,
    availableCardCount: live?.availableCardCount ?? 0,
    returnedCardCount: live?.returnedCardCount ?? 0,
    availableFeedCount: live?.feeds.filter((feed) => feed.status === 'available').length ?? 0,
    unavailableFeedCount: live?.feeds.filter((feed) => feed.status === 'unavailable').length ?? 0,
  });
};

const sourceState = (sources: RealCompanionSourceBundle): RealCompanionSourceState => {
  if (!sources.delta) return 'unavailable';
  if (sources.delta.partial || !sources.live || sources.live.partial) return 'partial';
  return 'complete';
};

export function projectRealCompanion(
  definition: RealCompanionDefinition,
  sources: RealCompanionSourceBundle,
): RealCompanionSnapshot {
  const delta = sources.delta;
  const generatedAt = delta?.generatedAt ?? sources.live?.generatedAt ?? sources.checkedAt;
  const topicEnabled = definition.preferences.topics.includes('regulation');
  let topicExcludedCount = 0;
  let entityExcludedCount = 0;
  let trustExcludedCount = 0;
  let actionableExcludedCount = 0;
  const eligible: RealCompanionCard[] = [];

  for (const card of delta?.cards ?? []) {
    if (!topicEnabled) { topicExcludedCount += 1; continue; }
    const matchedEntities = definition.preferences.entities.filter((entity) => matchesEntity(card, entity));
    if (definition.preferences.entities.length > 0 && matchedEntities.length === 0) { entityExcludedCount += 1; continue; }
    const decision = trustDecision(card, definition.trustPolicy, generatedAt);
    if (!decision.included) { trustExcludedCount += 1; continue; }
    const actionable = true as const;
    if (definition.preferences.onlyActionable && !actionable) { actionableExcludedCount += 1; continue; }
    const reasons = [
      'Topic match: Regulation.',
      matchedEntities.length > 0
        ? `Entity match: ${matchedEntities.join(', ')}.`
        : 'Broad companion scope: no entity restriction.',
      'Trust match: official authority directly proves the listing claim.',
    ];
    eligible.push(Object.freeze({
      id: card.id,
      kind: card.kind,
      topic: 'regulation',
      feedId: card.feedId,
      feedLabel: card.feedLabel,
      celexId: card.celexId,
      title: card.title,
      creator: card.creator,
      sourceUrl: card.sourceUrl,
      sourceName: card.source.name,
      publishedAt: card.publishedAt,
      observedAt: card.observedAt,
      baselineAt: card.baselineAt,
      previous: card.previous,
      changedFields: card.changedFields,
      stateLabel: card.stateLabel,
      matchReasons: Object.freeze(reasons),
      matchedEntities: Object.freeze(matchedEntities),
      actionable,
      actionLabel: 'Open official source',
      trustDecision: decision,
      requestedMinimumMateriality: definition.preferences.minMateriality,
      materialityAssessment: 'unassessed',
      materialityFilterApplied: false,
      legalCaveat: card.legalCaveat,
      aiInterpretation: false,
    }));
  }

  eligible.sort((left, right) => {
    const observed = Date.parse(right.observedAt) - Date.parse(left.observedAt);
    if (observed !== 0) return observed;
    if (left.kind !== right.kind) return left.kind === 'changed' ? -1 : 1;
    return left.celexId.localeCompare(right.celexId);
  });
  const cards = Object.freeze(eligible.slice(0, definition.preferences.maxCards));
  const verifiedDeltaCount = delta?.availableCardCount ?? 0;
  const resultState = !delta
    ? 'unavailable'
    : verifiedDeltaCount === 0
      ? 'caught-up'
      : eligible.length === 0
        ? 'no-match'
        : 'ready';
  const caughtUpMessage = resultState === 'caught-up'
    ? sources.deltaMode === 'operational-ledger'
      ? 'Caught up — no verified changes since the last operational verification.'
      : 'Caught up — no verified changes since the current verified release baseline.'
    : resultState === 'no-match'
      ? 'No verified changes match this Companion configuration.'
      : resultState === 'unavailable'
        ? 'Official sources are temporarily unavailable.'
        : null;

  return Object.freeze({
    version: REAL_COMPANION_VERSION,
    product: 'dlkt-info',
    productVersion: PRODUCT_VERSION,
    mode: REAL_COMPANION_MODE,
    generatedAt,
    resultState,
    sourceState: sourceState(sources),
    deltaMode: sources.deltaMode,
    preferences: definition.preferences,
    trustPolicy: definition.trustPolicy,
    baselineAt: delta?.baselineAt ?? sources.baselineAt,
    baselineHash: delta?.baselineHash ?? sources.baselineHash,
    cards,
    counts: Object.freeze({
      verifiedDeltaCount,
      topicExcludedCount,
      entityExcludedCount,
      trustExcludedCount,
      actionableExcludedCount,
      eligibleBeforeBudgetCount: eligible.length,
      returnedCardCount: cards.length,
      truncatedByCardBudget: eligible.length > cards.length,
    }),
    currentOfficial: currentOfficial(sources),
    sourceErrors: Object.freeze({ delta: sources.deltaError, live: sources.liveError }),
    caughtUpMessage,
    materialityPolicy: 'not-applied-without-impact-evidence',
    browserStorage: false,
    databaseUsed: false,
    databaseChanged: false,
    automaticPublication: false,
    automaticExecution: false,
    publicCardsCreated: false,
    aiInterpretation: false,
    boundaries: Object.freeze([
      'Delta cards state only what changed in registered official EUR-Lex metadata against the immutable release baseline.',
      'Materiality is not inferred from a title or listing; the requested materiality threshold remains visible but is not applied without impact evidence.',
      'One official authority is sufficient only for the narrow claim that the authority published the listing.',
      'No account, database record, notification, public card or automatic action is created.',
    ]),
  });
}
