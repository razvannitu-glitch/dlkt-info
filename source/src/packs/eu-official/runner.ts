import type { AtomicClaim } from '../../core/contracts.js';
import { runBriefingOrchestra, type OrchestraResult } from '../../core/orchestra.js';
import { euOfficialEntryClaim, euOfficialExternalClaimKey } from './claims.js';
import {
  EU_OFFICIAL_CHECKPOINT_VERSION,
  type EuOfficialAcquisitionInput,
  type EuOfficialCheckpoint,
  type EuOfficialPackDiagnostics,
  type EuOfficialPackInput,
  type EuOfficialPreparedFeed,
} from './contracts.js';
import { parseEuOfficialRss } from './feed.js';
import { euOfficialChangePack } from './pack.js';
import { EU_OFFICIAL_SOURCES } from './registry.js';

const checkpoint = (input: EuOfficialAcquisitionInput): EuOfficialCheckpoint => {
  if (input.result.status === 'not-modified') {
    if (!input.previousCheckpoint || input.previousCheckpoint.feedId !== input.definition.id) {
      throw new Error('EU_CHECKPOINT_REQUIRED_FOR_304');
    }
    return Object.freeze({
      ...structuredClone(input.previousCheckpoint),
      checkedAt: input.result.retrievedAt,
      etag: input.result.etag ?? input.previousCheckpoint.etag,
      lastModified: input.result.lastModified ?? input.previousCheckpoint.lastModified,
    });
  }
  const parsed = parseEuOfficialRss(input.definition, input.result.body, input.result.retrievedAt);
  return Object.freeze({
    version: EU_OFFICIAL_CHECKPOINT_VERSION,
    feedId: input.definition.id,
    checkedAt: input.result.retrievedAt,
    bodyHash: input.result.bodyHash,
    etag: input.result.etag,
    lastModified: input.result.lastModified,
    channelPublishedAt: parsed.channelPublishedAt,
    entries: parsed.entries,
  });
};

export function prepareEuOfficialFeed(input: EuOfficialAcquisitionInput): EuOfficialPreparedFeed {
  if (input.previousCheckpoint && (input.previousCheckpoint.version !== EU_OFFICIAL_CHECKPOINT_VERSION
    || input.previousCheckpoint.feedId !== input.definition.id)) throw new Error('EU_CHECKPOINT_INVALID');
  const current = checkpoint(input);
  const currentById = new Map(current.entries.map((entry) => [entry.celexId, entry]));
  const previousEntries = input.previousCheckpoint?.entries ?? [];
  const previousById = new Map(previousEntries.map((entry) => [entry.celexId, entry]));
  const baselineEstablished = input.previousCheckpoint === null;
  const previousClaims: AtomicClaim[] = [];
  const currentClaims: AtomicClaim[] = [];
  const ingestClaims: import('./contracts.js').EuOfficialClaimIngestion[] = [];
  let stableEntryCount = 0;
  let newEntryCount = 0;
  let changedEntryCount = 0;

  for (const entry of current.entries) {
    const before = previousById.get(entry.celexId);
    if (baselineEstablished) {
      const claim = euOfficialEntryClaim(entry, current.checkedAt);
      previousClaims.push(claim);
      currentClaims.push(claim);
      ingestClaims.push(Object.freeze({
        externalKey: euOfficialExternalClaimKey(entry),
        supersedesExternalKey: null,
        changeKind: 'baseline',
        claim,
      }));
      stableEntryCount += 1;
      continue;
    }
    const currentClaim = euOfficialEntryClaim(entry, current.checkedAt);
    currentClaims.push(currentClaim);
    if (!before) {
      ingestClaims.push(Object.freeze({
        externalKey: euOfficialExternalClaimKey(entry),
        supersedesExternalKey: null,
        changeKind: 'new',
        claim: currentClaim,
      }));
      newEntryCount += 1;
      continue;
    }
    previousClaims.push(euOfficialEntryClaim(before, input.previousCheckpoint?.checkedAt ?? current.checkedAt));
    if (before.fingerprint === entry.fingerprint) stableEntryCount += 1;
    else {
      ingestClaims.push(Object.freeze({
        externalKey: euOfficialExternalClaimKey(entry),
        supersedesExternalKey: euOfficialExternalClaimKey(before),
        changeKind: 'changed',
        claim: currentClaim,
      }));
      changedEntryCount += 1;
    }
  }

  return Object.freeze({
    checkpoint: current,
    previousClaims: Object.freeze(previousClaims),
    currentClaims: Object.freeze(currentClaims),
    ingestClaims: Object.freeze(ingestClaims),
    baselineEstablished,
    notModified: input.result.status === 'not-modified'
      || (input.previousCheckpoint?.bodyHash !== undefined && input.previousCheckpoint.bodyHash === current.bodyHash),
    stableEntryCount,
    newEntryCount,
    changedEntryCount,
    rolledOffEntryCount: previousEntries.filter((entry) => !currentById.has(entry.celexId)).length,
  });
}

const claimAtSnapshot = (claim: AtomicClaim, snapshotAt: string): AtomicClaim => {
  const timestamp = Date.parse(snapshotAt);
  if (!Number.isFinite(timestamp)) throw new Error('EU_SNAPSHOT_CLOCK_INVALID');
  return Object.freeze({
    ...structuredClone(claim),
    observedAt: snapshotAt,
    validFrom: snapshotAt,
    validUntil: new Date(timestamp + 45 * 86_400_000).toISOString(),
    evidence: Object.freeze(claim.evidence.map((evidence) => Object.freeze({ ...structuredClone(evidence), retrievedAt: snapshotAt }))),
  });
};

export function runEuOfficialPack(input: EuOfficialPackInput): Readonly<{
  result: OrchestraResult;
  checkpoints: readonly EuOfficialCheckpoint[];
  diagnostics: EuOfficialPackDiagnostics;
}> {
  if (input.acquisitions.length !== 2 || new Set(input.acquisitions.map((entry) => entry.definition.id)).size !== 2) {
    throw new Error('EU_PACK_FEED_SET_INVALID');
  }
  const prepared = input.acquisitions.map(prepareEuOfficialFeed);
  const result = runBriefingOrchestra({
    definition: input.definition,
    sources: EU_OFFICIAL_SOURCES,
    previousClaims: prepared.flatMap((feed) => feed.previousClaims.map((claim) => claimAtSnapshot(claim, input.windowStart))),
    currentClaims: prepared.flatMap((feed) => feed.currentClaims),
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    now: input.now,
    packs: [euOfficialChangePack],
  });
  return Object.freeze({
    result,
    checkpoints: Object.freeze(prepared.map((feed) => feed.checkpoint)),
    diagnostics: Object.freeze({
      feeds: Object.freeze(prepared.map((feed) => Object.freeze({
        feedId: feed.checkpoint.feedId,
        baselineEstablished: feed.baselineEstablished,
        notModified: feed.notModified,
        stableEntryCount: feed.stableEntryCount,
        newEntryCount: feed.newEntryCount,
        changedEntryCount: feed.changedEntryCount,
        rolledOffEntryCount: feed.rolledOffEntryCount,
      }))),
      sources: EU_OFFICIAL_SOURCES,
    }),
  });
}
