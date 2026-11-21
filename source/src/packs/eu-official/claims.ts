import { createHash } from 'node:crypto';
import type { AtomicClaim, EvidenceRef } from '../../core/contracts.js';
import type { EuOfficialEntry } from './contracts.js';

const DAY = 86_400_000;

export const euOfficialExternalClaimKey = (entry: EuOfficialEntry): string =>
  `eu-source-claim:${createHash('sha256').update(`${entry.sourceId}|${entry.celexId}|${entry.fingerprint}`).digest('hex')}`;

const value = (entry: EuOfficialEntry): readonly string[] => Object.freeze([
  entry.documentTitle,
  `creator:${entry.creator}`,
  `celex:${entry.celexId}`,
  `feed:${entry.feedKind}`,
]);

export function euOfficialEntryClaim(entry: EuOfficialEntry, observedAt: string): AtomicClaim {
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) throw new Error('EU_CLAIM_CLOCK_INVALID');
  const evidence: EvidenceRef = Object.freeze({
    sourceId: entry.sourceId,
    url: entry.link,
    title: `${entry.celexId}: ${entry.documentTitle}`.slice(0, 300),
    retrievedAt: observedAt,
    publishedAt: entry.publishedAt,
    contentHash: entry.fingerprint,
  });
  const proposal = entry.feedKind === 'commission-proposals';
  return Object.freeze({
    id: `eu-claim:${createHash('sha256').update(`${entry.feedId}|${entry.celexId}|${entry.fingerprint}`).digest('hex').slice(0, 24)}`,
    entity: Object.freeze({
      id: `eu-document:${createHash('sha256').update(entry.celexId).digest('hex').slice(0, 24)}`,
      type: proposal ? 'eu-proposal' : 'eu-legal-document',
      label: entry.celexId,
    }),
    topicId: 'regulation',
    kind: 'regulation',
    predicate: proposal ? 'official-eu-proposal-listing' : 'official-eu-legislation-listing',
    value: value(entry),
    materiality: 'low',
    actionability: proposal ? 0.25 : 0.4,
    observedAt,
    effectiveAt: null,
    validFrom: observedAt,
    validUntil: new Date(observed + 45 * DAY).toISOString(),
    locale: 'en',
    geography: 'European Union',
    affects: Object.freeze(proposal
      ? ['eu-policy-pipeline', 'regulatory-monitoring']
      : ['eu-legal-monitoring', 'compliance-review']),
    evidence: Object.freeze([evidence]),
  });
}
