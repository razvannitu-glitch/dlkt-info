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
  type EuOfficialParsedFeed,
} from '../packs/eu-official/index.js';
import {
  LIVE_OFFICIAL_SNAPSHOT_VERSION,
  type LiveOfficialCard,
  type LiveOfficialFeedProjection,
  type LiveOfficialSnapshot,
  type LiveOfficialSnapshotDependencies,
  type LiveOfficialSourceProjection,
} from './contracts.js';

const MAX_SERIALIZED_BYTES = 500_000;
const registry = new SourceRegistry(EU_OFFICIAL_SOURCES);

const sourceProjection = (sourceId: string): LiveOfficialSourceProjection => {
  const source = registry.get(sourceId);
  if (!source || source.authority !== 'official' || source.rights.attributionRequired !== true
      || typeof source.rights.termsUrl !== 'string') {
    throw new Error('LIVE_OFFICIAL_SOURCE_INVALID');
  }
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

const toCard = (
  definition: EuOfficialFeedDefinition,
  parsed: EuOfficialParsedFeed,
  entry: EuOfficialEntry,
): LiveOfficialCard => {
  const observedAt = parsed.retrievedAt;
  const claim = euOfficialEntryClaim(entry, observedAt);
  if (!registry.authorizeClaim(claim, Date.parse(observedAt))) throw new Error('LIVE_OFFICIAL_PROVENANCE_REJECTED');
  const proposal = entry.feedKind === 'commission-proposals';
  return Object.freeze({
    id: `live-eu:${createHash('sha256').update(`${definition.id}|${entry.celexId}|${entry.fingerprint}`).digest('hex').slice(0, 24)}`,
    feedId: definition.id,
    feedKind: entry.feedKind,
    feedLabel: definition.label,
    celexId: entry.celexId,
    title: entry.documentTitle,
    creator: entry.creator,
    sourceUrl: entry.link,
    source: sourceProjection(entry.sourceId),
    publishedAt: entry.publishedAt ?? parsed.channelPublishedAt,
    observedAt,
    stateLabel: proposal ? 'Official proposal listing' : 'Official legislation listing',
    legalCaveat: proposal
      ? 'This official listing does not mean the proposal was adopted, entered into force or created a current legal obligation.'
      : 'Legal effect, territorial scope, applicability and effective dates must be verified in the linked official act.',
    trust: 'official-source',
    deltaStatus: 'not-available-without-baseline',
    aiInterpretation: false,
  });
};

const feedAvailable = (
  definition: EuOfficialFeedDefinition,
  parsed: EuOfficialParsedFeed,
  bodyHash: string,
  cards: readonly LiveOfficialCard[],
): LiveOfficialFeedProjection => Object.freeze({
  id: definition.id,
  label: definition.label,
  kind: definition.kind,
  status: 'available',
  retrievedAt: parsed.retrievedAt,
  channelPublishedAt: parsed.channelPublishedAt,
  bodyHash,
  entryCount: parsed.entries.length,
  authorizedClaimCount: cards.length,
  errorCode: null,
});

const feedUnavailable = (definition: EuOfficialFeedDefinition, error: unknown): LiveOfficialFeedProjection => Object.freeze({
  id: definition.id,
  label: definition.label,
  kind: definition.kind,
  status: 'unavailable',
  retrievedAt: null,
  channelPublishedAt: null,
  bodyHash: null,
  entryCount: 0,
  authorizedClaimCount: 0,
  errorCode: failureCode(error),
});

const byMostRecent = (left: LiveOfficialCard, right: LiveOfficialCard): number => {
  const dateDifference = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  if (dateDifference !== 0) return dateDifference;
  const feedDifference = left.feedId.localeCompare(right.feedId);
  return feedDifference !== 0 ? feedDifference : left.celexId.localeCompare(right.celexId);
};

const uniqueCards = (cards: readonly LiveOfficialCard[]): readonly LiveOfficialCard[] => {
  const unique = new Map<string, LiveOfficialCard>();
  for (const card of cards) if (!unique.has(card.id)) unique.set(card.id, card);
  return Object.freeze([...unique.values()].sort(byMostRecent));
};

const snapshot = (
  generatedAt: string,
  feeds: readonly LiveOfficialFeedProjection[],
  availableCards: readonly LiveOfficialCard[],
  cards: readonly LiveOfficialCard[],
  truncated: boolean,
): LiveOfficialSnapshot => {
  const partial = feeds.some((feed) => feed.status === 'unavailable');
  return Object.freeze({
    version: LIVE_OFFICIAL_SNAPSHOT_VERSION,
    product: PRODUCT_ID,
    productVersion: PRODUCT_VERSION,
    pack: EU_OFFICIAL_PACK_ID,
    packVersion: EU_OFFICIAL_PACK_VERSION,
    mode: 'live-read-only',
    generatedAt,
    complete: !partial && !truncated,
    partial,
    deltaAvailable: false,
    databaseUsed: false,
    persistenceUsed: false,
    databaseChanged: false,
    automaticPublication: false,
    publicCardsCreated: false,
    aiInterpretation: false,
    availableCardCount: availableCards.length,
    returnedCardCount: cards.length,
    truncatedByPayloadBudget: truncated,
    feeds: Object.freeze(feeds.map((feed) => Object.freeze({ ...feed }))),
    cards: Object.freeze(cards.map((card) => Object.freeze({ ...card, source: Object.freeze({ ...card.source }) }))),
    boundaries: Object.freeze([
      'Current official listings only; this response does not claim what changed since a previous briefing.',
      'Titles and metadata come from EUR-Lex. DLKT does not infer legal effect or provide legal advice.',
      'No account, database, checkpoint, delivery job or public card is created by this read-only snapshot.',
    ]),
  });
};

const fitPayload = (
  generatedAt: string,
  feeds: readonly LiveOfficialFeedProjection[],
  availableCards: readonly LiveOfficialCard[],
): LiveOfficialSnapshot => {
  let selected = [...availableCards];
  let projected = snapshot(generatedAt, feeds, availableCards, selected, false);
  while (selected.length > 0 && Buffer.byteLength(JSON.stringify(projected), 'utf8') > MAX_SERIALIZED_BYTES) {
    selected = selected.slice(0, -1);
    projected = snapshot(generatedAt, feeds, availableCards, selected, true);
  }
  if (Buffer.byteLength(JSON.stringify(projected), 'utf8') > MAX_SERIALIZED_BYTES) {
    throw new Error('LIVE_OFFICIAL_RESPONSE_TOO_LARGE');
  }
  return projected;
};

export async function buildLiveOfficialSnapshot(
  dependencies: LiveOfficialSnapshotDependencies = {},
): Promise<LiveOfficialSnapshot> {
  const now = dependencies.now ?? Date.now;
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const generatedAt = new Date(now()).toISOString();
  const outcomes = await Promise.allSettled(EU_OFFICIAL_FEEDS.map(async (definition) => {
    const fetched = await fetchEuOfficialFeed({ definition, fetchImplementation, now });
    if (fetched.status !== 'modified') throw new Error('LIVE_OFFICIAL_BASELINE_REQUIRED');
    const parsed = parseEuOfficialRss(definition, fetched.body, fetched.retrievedAt);
    const cards = Object.freeze(parsed.entries.map((entry) => toCard(definition, parsed, entry)));
    return Object.freeze({ definition, parsed, cards, bodyHash: fetched.bodyHash });
  }));

  const feeds: LiveOfficialFeedProjection[] = [];
  const cards: LiveOfficialCard[] = [];
  outcomes.forEach((outcome, index) => {
    const definition = EU_OFFICIAL_FEEDS[index];
    if (!definition) throw new Error('LIVE_OFFICIAL_FEED_INDEX_INVALID');
    if (outcome.status === 'fulfilled') {
      feeds.push(feedAvailable(definition, outcome.value.parsed, outcome.value.bodyHash, outcome.value.cards));
      cards.push(...outcome.value.cards);
    } else {
      feeds.push(feedUnavailable(definition, outcome.reason));
    }
  });

  if (cards.length === 0) throw new Error('LIVE_OFFICIAL_ALL_SOURCES_FAILED');
  const availableCards = uniqueCards(cards);
  return fitPayload(generatedAt, Object.freeze(feeds), availableCards);
}
