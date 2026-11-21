import { Buffer } from 'node:buffer';
import { PRODUCT_VERSION } from '../core/contracts.js';
import { SourceRegistry } from '../core/source-registry.js';
import type {
  DeltaOfficialChangedField,
  DeltaOfficialPreviousState,
  DeltaOfficialSourceProjection,
} from '../delta-official/contracts.js';
import {
  EU_OFFICIAL_PACK_ID,
  EU_OFFICIAL_PACK_VERSION,
  EU_OFFICIAL_SOURCES,
  type EuOfficialEntry,
} from '../packs/eu-official/index.js';
import {
  OPERATIONAL_DELTA_VERSION,
  OPERATIONAL_LEDGER_VERSION,
  type OperationalCheckpoint,
  type OperationalDeltaCard,
  type OperationalDeltaFeedProjection,
  type OperationalDeltaSnapshot,
} from './contracts.js';

const MAX_SERIALIZED_BYTES = 500_000;
const registry = new SourceRegistry(EU_OFFICIAL_SOURCES);
const LEGAL_BOUNDARY = 'An operational delta proves only how the registered EUR-Lex feed listing changed between two verified collections. Adoption, applicability, entry into force, withdrawal and case-specific legal effect must be verified in the linked act.';

const changedFields = (before: EuOfficialEntry, current: EuOfficialEntry): readonly DeltaOfficialChangedField[] => {
  const fields: DeltaOfficialChangedField[] = [];
  if (before.documentTitle !== current.documentTitle) fields.push('title');
  if (before.creator !== current.creator) fields.push('creator');
  if (before.link !== current.link) fields.push('source-url');
  if (before.guid !== current.guid) fields.push('document-guid');
  if (before.publishedAt !== current.publishedAt) fields.push('publication-time');
  return Object.freeze(fields);
};

const sourceProjection = (sourceId: string): DeltaOfficialSourceProjection => {
  const source = registry.get(sourceId);
  if (!source || source.authority !== 'official' || source.rights.attributionRequired !== true
      || typeof source.rights.termsUrl !== 'string') throw new Error('OPERATIONAL_SOURCE_INVALID');
  return Object.freeze({
    id: source.id, name: source.name, authority: 'official', attributionRequired: true,
    termsUrl: source.rights.termsUrl, rightsReviewExpiresAt: source.rights.reviewExpiresAt,
  });
};

const previousState = (entry: EuOfficialEntry): DeltaOfficialPreviousState => Object.freeze({
  title: entry.documentTitle, creator: entry.creator, sourceUrl: entry.link,
  publishedAt: entry.publishedAt, fingerprint: entry.fingerprint,
});

const card = (
  current: EuOfficialEntry,
  previous: EuOfficialEntry | null,
  feedLabel: string,
  baselineAt: string,
  observedAt: string,
): OperationalDeltaCard => Object.freeze({
  id: `operational:${current.feedId}:${current.celexId}:${current.fingerprint}`,
  kind: previous ? 'changed' : 'new', feedId: current.feedId, feedKind: current.feedKind,
  feedLabel, celexId: current.celexId, title: current.documentTitle, creator: current.creator,
  sourceUrl: current.link, source: sourceProjection(current.sourceId),
  publishedAt: current.publishedAt ?? observedAt, observedAt, baselineAt,
  previous: previous ? previousState(previous) : null,
  changedFields: previous ? changedFields(previous, current) : Object.freeze([]),
  stateLabel: previous ? 'Official metadata changed' : 'New official listing',
  legalCaveat: LEGAL_BOUNDARY, trust: 'official-source',
  deltaStatus: 'verified-between-operational-checkpoints', aiInterpretation: false,
});

export function projectOperationalDelta(
  current: OperationalCheckpoint,
  previous: OperationalCheckpoint | null,
): OperationalDeltaSnapshot {
  if (previous && (previous.ledgerInstanceId !== current.ledgerInstanceId
      || previous.checkpointHash !== current.previousCheckpointHash
      || previous.sequence + 1 !== current.sequence
      || Date.parse(previous.slotAt) >= Date.parse(current.slotAt))) {
    throw new Error('OPERATIONAL_CHECKPOINT_CHAIN_INVALID');
  }
  const previousByFeed = new Map(previous?.feeds.map((feed) => [feed.id, feed] as const) ?? []);
  const feedProjections: OperationalDeltaFeedProjection[] = [];
  const cards: OperationalDeltaCard[] = [];
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  let rolledOffIgnoredCount = 0;

  for (const currentFeed of current.feeds) {
    const previousFeed = previousByFeed.get(currentFeed.id) ?? null;
    const previousByCelex = new Map(previousFeed?.checkpoint.entries.map((entry) => [entry.celexId, entry] as const) ?? []);
    const currentIds = new Set<string>();
    let feedNew = 0;
    let feedChanged = 0;
    let feedUnchanged = 0;
    for (const entry of currentFeed.checkpoint.entries) {
      currentIds.add(entry.celexId);
      const before = previousByCelex.get(entry.celexId) ?? null;
      if (!previous) {
        feedUnchanged += 1;
      } else if (!before) {
        feedNew += 1;
        cards.push(card(entry, null, currentFeed.label, previous.slotAt, current.slotAt));
      } else if (before.fingerprint !== entry.fingerprint) {
        feedChanged += 1;
        cards.push(card(entry, before, currentFeed.label, previous.slotAt, current.slotAt));
      } else {
        feedUnchanged += 1;
      }
    }
    const rolledOff = previousFeed
      ? previousFeed.checkpoint.entries.filter((entry) => !currentIds.has(entry.celexId)).length : 0;
    newCount += feedNew;
    changedCount += feedChanged;
    unchangedCount += feedUnchanged;
    rolledOffIgnoredCount += rolledOff;
    feedProjections.push(Object.freeze({
      id: currentFeed.id, label: currentFeed.label, kind: currentFeed.kind, status: 'available',
      previousEntryCount: previousFeed?.checkpoint.entries.length ?? currentFeed.checkpoint.entries.length,
      currentEntryCount: currentFeed.checkpoint.entries.length,
      newCount: feedNew, changedCount: feedChanged, unchangedCount: feedUnchanged,
      rolledOffIgnoredCount: rolledOff, checkedAt: currentFeed.checkpoint.checkedAt,
      bodyHash: currentFeed.checkpoint.bodyHash,
    }));
  }

  cards.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)
    || left.feedId.localeCompare(right.feedId) || left.celexId.localeCompare(right.celexId));
  const baselineAt = previous?.slotAt ?? current.slotAt;
  const baselineHash = previous?.checkpointHash ?? current.checkpointHash;
  const base = {
    version: OPERATIONAL_DELTA_VERSION,
    product: 'dlkt-info' as const,
    productVersion: PRODUCT_VERSION,
    pack: EU_OFFICIAL_PACK_ID,
    packVersion: EU_OFFICIAL_PACK_VERSION,
    mode: 'operational-consecutive-delta' as const,
    ledgerVersion: OPERATIONAL_LEDGER_VERSION,
    ledgerInstanceId: current.ledgerInstanceId,
    sequence: current.sequence,
    baselineAt,
    baselineHash,
    generatedAt: current.slotAt,
    checkpointHash: current.checkpointHash,
    previousCheckpointHash: current.previousCheckpointHash,
    baselineEstablished: previous === null,
    complete: true as const,
    partial: false as const,
    feeds: Object.freeze(feedProjections),
    baselineEntryCount: previous?.entryCount ?? current.entryCount,
    currentEntryCount: current.entryCount,
    newCount,
    changedCount,
    unchangedCount,
    rolledOffIgnoredCount,
    availableCardCount: cards.length,
    deltaAvailable: previous !== null,
    baselinePersistence: 'private-content-addressed-ledger' as const,
    databaseUsed: false as const,
    blobUsed: true as const,
    persistenceUsed: true as const,
    databaseChanged: false as const,
    automaticPublication: false as const,
    publicCardsCreated: false as const,
    automaticExecution: false as const,
    aiInterpretation: false as const,
    rolloffResolutionDisabled: true as const,
    legalBoundary: LEGAL_BOUNDARY,
  };

  const returned = [...cards];
  let truncatedByPayloadBudget = false;
  while (returned.length > 0) {
    const candidate = { ...base, returnedCardCount: returned.length, truncatedByPayloadBudget, cards: returned };
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= MAX_SERIALIZED_BYTES) break;
    returned.pop();
    truncatedByPayloadBudget = true;
  }
  const snapshot: OperationalDeltaSnapshot = Object.freeze({
    ...base,
    returnedCardCount: returned.length,
    truncatedByPayloadBudget,
    cards: Object.freeze(returned),
  });
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_SERIALIZED_BYTES) {
    throw new Error('OPERATIONAL_DELTA_RESPONSE_TOO_LARGE');
  }
  return snapshot;
}
