import { createHash } from 'node:crypto';
import { PRODUCT_ID, PRODUCT_VERSION } from '../core/contracts.js';
import { SourceRegistry } from '../core/source-registry.js';
import {
  EU_OFFICIAL_FEEDS,
  EU_OFFICIAL_PACK_ID,
  EU_OFFICIAL_PACK_VERSION,
  EU_OFFICIAL_SOURCES,
  euOfficialEntryClaim,
  fetchEuOfficialFeed,
  parseEuOfficialRss,
  type EuOfficialEntry,
  type EuOfficialFeedDefinition,
} from '../packs/eu-official/index.js';
import { readEuReleaseBaseline } from './baseline.js';
import {
  DELTA_OFFICIAL_BASELINE_VERSION,
  DELTA_OFFICIAL_SNAPSHOT_VERSION,
  type DeltaOfficialCard,
  type DeltaOfficialChangedField,
  type DeltaOfficialFeedProjection,
  type DeltaOfficialSnapshot,
  type DeltaOfficialSnapshotDependencies,
  type DeltaOfficialSourceProjection,
  type EuReleaseBaseline,
  type EuReleaseBaselineEntry,
  type EuReleaseBaselineFeed,
} from './contracts.js';

const MAX_SERIALIZED_BYTES = 500_000;
const registry = new SourceRegistry(EU_OFFICIAL_SOURCES);
const LEGAL_BOUNDARY = 'A feed listing confirms only that EUR-Lex exposes the item in the current official feed. Adoption, applicability, entry into force and case-specific legal effect must be verified in the linked act.';

const sourceProjection = (sourceId: string): DeltaOfficialSourceProjection => {
  const source = registry.get(sourceId);
  if (!source || source.authority !== 'official' || source.rights.attributionRequired !== true
      || typeof source.rights.termsUrl !== 'string') throw new Error('DELTA_OFFICIAL_SOURCE_INVALID');
  return Object.freeze({
    id: source.id,
    name: source.name,
    authority: 'official',
    attributionRequired: true,
    termsUrl: source.rights.termsUrl,
    rightsReviewExpiresAt: source.rights.reviewExpiresAt,
  });
};

const failureCode = (error: unknown): string => {
  if (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) return 'SOURCE_TIMEOUT';
  const message = error instanceof Error ? error.message : '';
  if (/^EU_RSS_HTTP_/u.test(message)) return 'SOURCE_HTTP_ERROR';
  if (/CONTENT_TYPE|BODY|XML|CHANNEL|LANGUAGE|ITEM|LINK|CELEX|CELLAR|DATE|TEXT/u.test(message)) {
    return 'SOURCE_PAYLOAD_INVALID';
  }
  if (/SOURCE|REGISTRY|RIGHTS|PROVENANCE|AUTHORIZ/u.test(message)) return 'SOURCE_AUTHORIZATION_FAILED';
  return 'SOURCE_UNAVAILABLE';
};

const changedFields = (previous: EuReleaseBaselineEntry, current: EuOfficialEntry): readonly DeltaOfficialChangedField[] => {
  const fields: DeltaOfficialChangedField[] = [];
  if (previous.documentTitle !== current.documentTitle) fields.push('title');
  if (previous.creator !== current.creator) fields.push('creator');
  if (previous.link !== current.link) fields.push('source-url');
  if (previous.guid !== current.guid) fields.push('document-guid');
  if (previous.publishedAt !== current.publishedAt) fields.push('publication-time');
  return Object.freeze(fields);
};

const toCard = (
  definition: EuOfficialFeedDefinition,
  entry: EuOfficialEntry,
  observedAt: string,
  baseline: EuReleaseBaseline,
  previous: EuReleaseBaselineEntry | null,
): DeltaOfficialCard => {
  const fields = previous ? changedFields(previous, entry) : Object.freeze([] as DeltaOfficialChangedField[]);
  const kind = previous ? 'changed' : 'new';
  const source = sourceProjection(entry.sourceId);
  return Object.freeze({
    id: `eu-delta:${createHash('sha256').update(`${kind}|${entry.feedId}|${entry.celexId}|${entry.fingerprint}|${baseline.baselineHash}`).digest('hex').slice(0, 32)}`,
    kind,
    feedId: entry.feedId,
    feedKind: entry.feedKind,
    feedLabel: definition.label,
    celexId: entry.celexId,
    title: entry.documentTitle,
    creator: entry.creator,
    sourceUrl: entry.link,
    source,
    publishedAt: entry.publishedAt ?? observedAt,
    observedAt,
    baselineAt: baseline.capturedAt,
    previous: previous ? Object.freeze({
      title: previous.documentTitle,
      creator: previous.creator,
      sourceUrl: previous.link,
      publishedAt: previous.publishedAt,
      fingerprint: previous.fingerprint,
    }) : null,
    changedFields: fields,
    stateLabel: previous ? 'Official metadata changed' : 'New official listing',
    legalCaveat: LEGAL_BOUNDARY,
    trust: 'official-source',
    deltaStatus: 'verified-against-release-baseline',
    aiInterpretation: false,
  });
};

interface ComparedFeed {
  readonly projection: DeltaOfficialFeedProjection;
  readonly cards: readonly DeltaOfficialCard[];
}

const compareFeed = async (
  definition: EuOfficialFeedDefinition,
  baselineFeed: EuReleaseBaselineFeed,
  baseline: EuReleaseBaseline,
  dependencies: DeltaOfficialSnapshotDependencies,
): Promise<ComparedFeed> => {
  const fetched = await fetchEuOfficialFeed({
    definition,
    ...(dependencies.fetchImplementation ? { fetchImplementation: dependencies.fetchImplementation } : {}),
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  if (fetched.status !== 'modified') throw new Error('DELTA_OFFICIAL_UNEXPECTED_304');
  const parsed = parseEuOfficialRss(definition, fetched.body, fetched.retrievedAt);
  const observed = Date.parse(fetched.retrievedAt);
  const baselineByCelex = new Map(baselineFeed.entries.map((entry) => [entry.celexId, entry] as const));
  const currentIds = new Set<string>();
  const cards: DeltaOfficialCard[] = [];
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  let authorizedClaimCount = 0;

  for (const entry of parsed.entries) {
    currentIds.add(entry.celexId);
    const claim = euOfficialEntryClaim(entry, fetched.retrievedAt);
    if (!registry.authorizeClaim(claim, observed)) throw new Error('DELTA_OFFICIAL_PROVENANCE_INVALID');
    authorizedClaimCount += 1;
    const previous = baselineByCelex.get(entry.celexId) ?? null;
    if (!previous) {
      newCount += 1;
      cards.push(toCard(definition, entry, fetched.retrievedAt, baseline, null));
    } else if (previous.fingerprint !== entry.fingerprint) {
      changedCount += 1;
      cards.push(toCard(definition, entry, fetched.retrievedAt, baseline, previous));
    } else {
      unchangedCount += 1;
    }
  }

  const rolledOffIgnoredCount = baselineFeed.entries.reduce(
    (count, entry) => count + (currentIds.has(entry.celexId) ? 0 : 1),
    0,
  );
  return Object.freeze({
    projection: Object.freeze({
      id: definition.id,
      label: definition.label,
      kind: definition.kind,
      status: 'available',
      baselineEntryCount: baselineFeed.entries.length,
      currentEntryCount: parsed.entries.length,
      authorizedClaimCount,
      newCount,
      changedCount,
      unchangedCount,
      rolledOffIgnoredCount,
      retrievedAt: fetched.retrievedAt,
      channelPublishedAt: parsed.channelPublishedAt,
      bodyHash: fetched.bodyHash,
      errorCode: null,
    }),
    cards: Object.freeze(cards),
  });
};

const unavailableFeed = (
  definition: EuOfficialFeedDefinition,
  baselineFeed: EuReleaseBaselineFeed,
  error: unknown,
): ComparedFeed => Object.freeze({
  projection: Object.freeze({
    id: definition.id,
    label: definition.label,
    kind: definition.kind,
    status: 'unavailable',
    baselineEntryCount: baselineFeed.entries.length,
    currentEntryCount: 0,
    authorizedClaimCount: 0,
    newCount: 0,
    changedCount: 0,
    unchangedCount: 0,
    rolledOffIgnoredCount: 0,
    retrievedAt: null,
    channelPublishedAt: null,
    bodyHash: null,
    errorCode: failureCode(error),
  }),
  cards: Object.freeze([]),
});

const cardOrder = (left: DeltaOfficialCard, right: DeltaOfficialCard): number => {
  const byTime = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  if (byTime !== 0) return byTime;
  if (left.kind !== right.kind) return left.kind === 'new' ? -1 : 1;
  return left.celexId.localeCompare(right.celexId);
};

export async function buildDeltaOfficialSnapshot(
  dependencies: DeltaOfficialSnapshotDependencies = {},
): Promise<DeltaOfficialSnapshot> {
  const baseline = dependencies.baseline ? structuredClone(dependencies.baseline) : readEuReleaseBaseline();
  const results = await Promise.allSettled(EU_OFFICIAL_FEEDS.map(async (definition) => {
    const baselineFeed = baseline.feeds.find((feed) => feed.feedId === definition.id);
    if (!baselineFeed) throw new Error('DELTA_OFFICIAL_BASELINE_FEED_MISSING');
    return compareFeed(definition, baselineFeed, baseline, dependencies);
  }));

  const compared = results.map((result, index) => {
    const definition = EU_OFFICIAL_FEEDS[index];
    if (!definition) throw new Error('DELTA_OFFICIAL_DEFINITION_MISSING');
    const baselineFeed = baseline.feeds.find((feed) => feed.feedId === definition.id);
    if (!baselineFeed) throw new Error('DELTA_OFFICIAL_BASELINE_FEED_MISSING');
    return result.status === 'fulfilled' ? result.value : unavailableFeed(definition, baselineFeed, result.reason);
  });
  const available = compared.filter((result) => result.projection.status === 'available');
  if (available.length === 0) throw new Error('DELTA_OFFICIAL_ALL_SOURCES_FAILED');

  const projections = Object.freeze(compared.map((result) => result.projection));
  const allCards = compared.flatMap((result) => result.cards).sort(cardOrder);
  const counts = projections.reduce((totals, feed) => ({
    baseline: totals.baseline + feed.baselineEntryCount,
    current: totals.current + feed.currentEntryCount,
    new: totals.new + feed.newCount,
    changed: totals.changed + feed.changedCount,
    unchanged: totals.unchanged + feed.unchangedCount,
    rolledOff: totals.rolledOff + feed.rolledOffIgnoredCount,
  }), { baseline: 0, current: 0, new: 0, changed: 0, unchanged: 0, rolledOff: 0 });
  const generatedAt = new Date((dependencies.now ?? Date.now)()).toISOString();
  const base = {
    version: DELTA_OFFICIAL_SNAPSHOT_VERSION,
    product: PRODUCT_ID,
    productVersion: PRODUCT_VERSION,
    pack: EU_OFFICIAL_PACK_ID,
    packVersion: EU_OFFICIAL_PACK_VERSION,
    mode: 'release-baseline-delta' as const,
    baselineVersion: DELTA_OFFICIAL_BASELINE_VERSION,
    baselineAt: baseline.capturedAt,
    baselineHash: baseline.baselineHash,
    generatedAt,
    complete: available.length === compared.length,
    partial: available.length !== compared.length,
    feeds: projections,
    baselineEntryCount: counts.baseline,
    currentEntryCount: counts.current,
    newCount: counts.new,
    changedCount: counts.changed,
    unchangedCount: counts.unchanged,
    rolledOffIgnoredCount: counts.rolledOff,
    availableCardCount: allCards.length,
    deltaAvailable: true as const,
    baselinePersistence: 'immutable-release-artifact' as const,
    databaseUsed: false as const,
    persistenceUsed: true as const,
    databaseChanged: false as const,
    automaticPublication: false as const,
    publicCardsCreated: false as const,
    aiInterpretation: false as const,
    rolloffResolutionDisabled: true as const,
    legalBoundary: LEGAL_BOUNDARY,
  };

  const returned = [...allCards];
  let truncatedByPayloadBudget = false;
  while (returned.length > 0) {
    const candidate = { ...base, returnedCardCount: returned.length, truncatedByPayloadBudget, cards: returned };
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= MAX_SERIALIZED_BYTES) break;
    returned.pop();
    truncatedByPayloadBudget = true;
  }
  const snapshot: DeltaOfficialSnapshot = Object.freeze({
    ...base,
    returnedCardCount: returned.length,
    truncatedByPayloadBudget,
    cards: Object.freeze(returned),
  });
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_SERIALIZED_BYTES) {
    throw new Error('DELTA_OFFICIAL_RESPONSE_TOO_LARGE');
  }
  return snapshot;
}
