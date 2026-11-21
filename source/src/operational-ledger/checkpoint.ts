import { SourceRegistry } from '../core/source-registry.js';
import { isInstant, isRecord } from '../core/guards.js';
import {
  EU_OFFICIAL_FEEDS,
  EU_OFFICIAL_PACK_ID,
  EU_OFFICIAL_PACK_VERSION,
  EU_OFFICIAL_SOURCES,
  euOfficialEntryClaim,
  fetchEuOfficialFeed,
  prepareEuOfficialFeed,
  readEuOfficialCheckpoint,
  type EuOfficialCheckpoint,
} from '../packs/eu-official/index.js';
import { canonicalJson, canonicalSha256 } from './canonical.js';
import {
  OPERATIONAL_CHECKPOINT_VERSION,
  OPERATIONAL_LEDGER_INTERVAL_MINUTES,
  OPERATIONAL_POINTER_VERSION,
  type OperationalCheckpoint,
  type OperationalCheckpointUnsigned,
  type OperationalFeedCheckpoint,
  type OperationalLedgerSourceDependencies,
  type OperationalPointer,
} from './contracts.js';

const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const registry = new SourceRegistry(EU_OFFICIAL_SOURCES);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export const operationalSlotAt = (now: number): string => {
  if (!Number.isFinite(now) || now < 0) throw new Error('OPERATIONAL_LEDGER_CLOCK_INVALID');
  const interval = OPERATIONAL_LEDGER_INTERVAL_MINUTES * 60_000;
  return new Date(Math.floor(now / interval) * interval).toISOString();
};

const definitionFor = (feedId: string) => EU_OFFICIAL_FEEDS.find((definition) => definition.id === feedId) ?? null;

export const operationalCheckpointUnsigned = (checkpoint: OperationalCheckpoint): OperationalCheckpointUnsigned => ({
  version: checkpoint.version,
  product: checkpoint.product,
  pack: checkpoint.pack,
  packVersion: checkpoint.packVersion,
  ledgerInstanceId: checkpoint.ledgerInstanceId,
  sequence: checkpoint.sequence,
  slotAt: checkpoint.slotAt,
  previousCheckpointHash: checkpoint.previousCheckpointHash,
  feeds: checkpoint.feeds,
  entryCount: checkpoint.entryCount,
  sourceState: checkpoint.sourceState,
});

export const readOperationalCheckpoint = (value: unknown): OperationalCheckpoint => {
  if (!isRecord(value) || !exactKeys(value, [
    'version', 'product', 'pack', 'packVersion', 'ledgerInstanceId', 'sequence', 'slotAt',
    'previousCheckpointHash', 'feeds', 'entryCount', 'sourceState', 'checkpointHash',
  ]) || value.version !== OPERATIONAL_CHECKPOINT_VERSION || value.product !== 'dlkt-info'
      || value.pack !== EU_OFFICIAL_PACK_ID || value.packVersion !== EU_OFFICIAL_PACK_VERSION
      || typeof value.ledgerInstanceId !== 'string' || !UUID.test(value.ledgerInstanceId)
      || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1
      || !isInstant(value.slotAt) || !(value.previousCheckpointHash === null
        || (typeof value.previousCheckpointHash === 'string' && HASH.test(value.previousCheckpointHash)))
      || !Array.isArray(value.feeds) || value.feeds.length !== EU_OFFICIAL_FEEDS.length
      || !Number.isSafeInteger(value.entryCount) || (value.entryCount as number) < 0
      || value.sourceState !== 'complete' || typeof value.checkpointHash !== 'string'
      || !HASH.test(value.checkpointHash)) {
    throw new Error('OPERATIONAL_CHECKPOINT_SHAPE_INVALID');
  }

  const feeds: OperationalFeedCheckpoint[] = value.feeds.map((item) => {
    if (!isRecord(item) || !exactKeys(item, ['id', 'kind', 'sourceId', 'label', 'checkpoint'])
        || typeof item.id !== 'string') throw new Error('OPERATIONAL_CHECKPOINT_FEED_INVALID');
    const definition = definitionFor(item.id);
    if (!definition || item.kind !== definition.kind || item.sourceId !== definition.sourceId
        || item.label !== definition.label) throw new Error('OPERATIONAL_CHECKPOINT_FEED_IDENTITY_INVALID');
    return Object.freeze({
      id: definition.id, kind: definition.kind, sourceId: definition.sourceId, label: definition.label,
      checkpoint: readEuOfficialCheckpoint(item.checkpoint, definition),
    });
  });
  const entryCount = feeds.reduce((total, feed) => total + feed.checkpoint.entries.length, 0);
  if (entryCount !== value.entryCount) throw new Error('OPERATIONAL_CHECKPOINT_COUNT_INVALID');

  const checkpoint: OperationalCheckpoint = Object.freeze({
    version: OPERATIONAL_CHECKPOINT_VERSION,
    product: 'dlkt-info',
    pack: EU_OFFICIAL_PACK_ID,
    packVersion: EU_OFFICIAL_PACK_VERSION,
    ledgerInstanceId: value.ledgerInstanceId,
    sequence: value.sequence as number,
    slotAt: value.slotAt,
    previousCheckpointHash: value.previousCheckpointHash as string | null,
    feeds: Object.freeze(feeds),
    entryCount,
    sourceState: 'complete',
    checkpointHash: value.checkpointHash,
  });
  if (canonicalSha256(operationalCheckpointUnsigned(checkpoint)) !== checkpoint.checkpointHash) {
    throw new Error('OPERATIONAL_CHECKPOINT_HASH_INVALID');
  }
  return checkpoint;
};

export const readOperationalPointer = (value: unknown): OperationalPointer => {
  if (!isRecord(value) || !exactKeys(value, [
    'version', 'product', 'ledgerInstanceId', 'sequence', 'slotAt', 'checkpointHash',
    'previousCheckpointHash', 'updatedAt',
  ]) || value.version !== OPERATIONAL_POINTER_VERSION || value.product !== 'dlkt-info'
      || typeof value.ledgerInstanceId !== 'string' || !UUID.test(value.ledgerInstanceId)
      || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1
      || !isInstant(value.slotAt) || typeof value.checkpointHash !== 'string' || !HASH.test(value.checkpointHash)
      || !(value.previousCheckpointHash === null
        || (typeof value.previousCheckpointHash === 'string' && HASH.test(value.previousCheckpointHash)))
      || !isInstant(value.updatedAt)) throw new Error('OPERATIONAL_POINTER_INVALID');
  return Object.freeze({
    version: OPERATIONAL_POINTER_VERSION, product: 'dlkt-info', ledgerInstanceId: value.ledgerInstanceId,
    sequence: value.sequence as number, slotAt: value.slotAt, checkpointHash: value.checkpointHash,
    previousCheckpointHash: value.previousCheckpointHash as string | null, updatedAt: value.updatedAt,
  });
};

export const serializeOperationalCheckpoint = (checkpoint: OperationalCheckpoint): string => canonicalJson(checkpoint);
export const serializeOperationalPointer = (pointer: OperationalPointer): string => canonicalJson(pointer);

export async function buildOperationalCheckpoint(input: Readonly<{
  ledgerInstanceId: string;
  sequence: number;
  slotAt: string;
  previous: OperationalCheckpoint | null;
  dependencies?: OperationalLedgerSourceDependencies;
}>): Promise<OperationalCheckpoint> {
  const previousByFeed = new Map(input.previous?.feeds.map((feed) => [feed.id, feed.checkpoint] as const) ?? []);
  const fetchImplementation = input.dependencies?.fetchImplementation;
  const slotTimestamp = Date.parse(input.slotAt);
  if (!Number.isFinite(slotTimestamp)) throw new Error('OPERATIONAL_SLOT_INVALID');

  const feeds = await Promise.all(EU_OFFICIAL_FEEDS.map(async (definition): Promise<OperationalFeedCheckpoint> => {
    const previousCheckpoint = previousByFeed.get(definition.id) ?? null;
    const result = await fetchEuOfficialFeed({
      definition,
      ...(previousCheckpoint?.etag ? { previousEtag: previousCheckpoint.etag } : {}),
      ...(previousCheckpoint?.lastModified ? { previousLastModified: previousCheckpoint.lastModified } : {}),
      ...(fetchImplementation ? { fetchImplementation } : {}),
      now: () => slotTimestamp,
    });
    const prepared = prepareEuOfficialFeed({ definition, result, previousCheckpoint });
    const observed = Date.parse(prepared.checkpoint.checkedAt);
    if (!Number.isFinite(observed)) throw new Error('OPERATIONAL_FEED_CLOCK_INVALID');
    for (const entry of prepared.checkpoint.entries) {
      if (!registry.authorizeClaim(euOfficialEntryClaim(entry, prepared.checkpoint.checkedAt), observed)) {
        throw new Error('OPERATIONAL_FEED_PROVENANCE_INVALID');
      }
    }
    return Object.freeze({
      id: definition.id, kind: definition.kind, sourceId: definition.sourceId, label: definition.label,
      checkpoint: prepared.checkpoint,
    });
  }));

  const unsigned: OperationalCheckpointUnsigned = Object.freeze({
    version: OPERATIONAL_CHECKPOINT_VERSION,
    product: 'dlkt-info', pack: EU_OFFICIAL_PACK_ID, packVersion: EU_OFFICIAL_PACK_VERSION,
    ledgerInstanceId: input.ledgerInstanceId, sequence: input.sequence, slotAt: input.slotAt,
    previousCheckpointHash: input.previous?.checkpointHash ?? null,
    feeds: Object.freeze(feeds),
    entryCount: feeds.reduce((total, feed) => total + feed.checkpoint.entries.length, 0),
    sourceState: 'complete',
  });
  return Object.freeze({ ...unsigned, checkpointHash: canonicalSha256(unsigned) });
}
