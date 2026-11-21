import { createHash } from 'node:crypto';
import { SourceRegistry } from '../core/source-registry.js';
import {
  EU_OFFICIAL_FEEDS,
  EU_OFFICIAL_PACK_ID,
  EU_OFFICIAL_PACK_VERSION,
  EU_OFFICIAL_SOURCES,
  euOfficialEntryClaim,
} from '../packs/eu-official/index.js';
import { EU_RELEASE_BASELINE } from './baseline.generated.js';
import {
  DELTA_OFFICIAL_BASELINE_VERSION,
  type EuReleaseBaseline,
  type EuReleaseBaselineUnsigned,
} from './contracts.js';

const SHA256 = /^[a-f0-9]{64}$/u;
const registry = new SourceRegistry(EU_OFFICIAL_SOURCES);

export const computeEuReleaseBaselineHash = (baseline: EuReleaseBaselineUnsigned): string =>
  createHash('sha256').update(JSON.stringify(baseline)).digest('hex');

const validateBaseline = (baseline: EuReleaseBaseline): void => {
  if (baseline.version !== DELTA_OFFICIAL_BASELINE_VERSION
      || baseline.product !== 'dlkt-info'
      || baseline.pack !== EU_OFFICIAL_PACK_ID
      || baseline.packVersion !== EU_OFFICIAL_PACK_VERSION
      || !Number.isFinite(Date.parse(baseline.capturedAt))
      || !SHA256.test(baseline.baselineHash)
      || baseline.feeds.length !== EU_OFFICIAL_FEEDS.length) {
    throw new Error('DELTA_BASELINE_IDENTITY_INVALID');
  }

  const unsigned: EuReleaseBaselineUnsigned = {
    version: baseline.version,
    product: baseline.product,
    pack: baseline.pack,
    packVersion: baseline.packVersion,
    capturedAt: baseline.capturedAt,
    feeds: baseline.feeds,
    entryCount: baseline.entryCount,
  };
  if (computeEuReleaseBaselineHash(unsigned) !== baseline.baselineHash) {
    throw new Error('DELTA_BASELINE_HASH_INVALID');
  }

  const capturedAt = Date.parse(baseline.capturedAt);
  let entryCount = 0;
  for (const definition of EU_OFFICIAL_FEEDS) {
    const feed = baseline.feeds.find((candidate) => candidate.feedId === definition.id);
    if (!feed || feed.feedKind !== definition.kind || feed.sourceId !== definition.sourceId
        || feed.label !== definition.label || !SHA256.test(feed.bodyHash)
        || !Number.isFinite(Date.parse(feed.retrievedAt))
        || !Number.isFinite(Date.parse(feed.channelPublishedAt))
        || feed.entries.length < 1 || feed.entries.length > 200) {
      throw new Error('DELTA_BASELINE_FEED_INVALID');
    }
    const identities = new Set<string>();
    for (const entry of feed.entries) {
      if (entry.feedId !== definition.id || entry.feedKind !== definition.kind
          || entry.sourceId !== definition.sourceId || identities.has(entry.celexId)
          || !SHA256.test(entry.fingerprint)) {
        throw new Error('DELTA_BASELINE_ENTRY_INVALID');
      }
      identities.add(entry.celexId);
      const claim = euOfficialEntryClaim(entry, feed.retrievedAt);
      if (!registry.authorizeClaim(claim, capturedAt)) throw new Error('DELTA_BASELINE_PROVENANCE_INVALID');
    }
    entryCount += feed.entries.length;
  }
  if (entryCount !== baseline.entryCount) throw new Error('DELTA_BASELINE_COUNT_INVALID');
};

export const readEuReleaseBaseline = (): EuReleaseBaseline => {
  const baseline = structuredClone(EU_RELEASE_BASELINE);
  validateBaseline(baseline);
  return baseline;
};
