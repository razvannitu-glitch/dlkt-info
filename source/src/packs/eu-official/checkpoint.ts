import { isInstant, isSafeEvidenceUrl } from '../../core/guards.js';
import {
  EU_OFFICIAL_CHECKPOINT_VERSION,
  type EuOfficialCheckpoint,
  type EuOfficialEntry,
  type EuOfficialFeedDefinition,
} from './contracts.js';

const HASH = /^[a-f0-9]{64}$/u;
const CELEX = /^[0-9A-Z][0-9A-Z()./-]{4,63}$/u;
const CELLAR = /^[a-f0-9-]{20,80}$/iu;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const cleanText = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= maximum
    && value.trim() === value && !CONTROL.test(value);
const nullableText = (value: unknown, maximum: number): value is string | null =>
  value === null || cleanText(value, maximum);

const readEntry = (value: unknown, definition: EuOfficialFeedDefinition): EuOfficialEntry => {
  if (!isRecord(value) || !exactKeys(value, [
    'feedId', 'feedKind', 'sourceId', 'celexId', 'documentTitle', 'creator',
    'link', 'guid', 'publishedAt', 'fingerprint',
  ]) || value.feedId !== definition.id || value.feedKind !== definition.kind
    || value.sourceId !== definition.sourceId || !cleanText(value.celexId, 64) || !CELEX.test(value.celexId)
    || !cleanText(value.documentTitle, 300) || !cleanText(value.creator, 200)
    || !isSafeEvidenceUrl(value.link) || !isSafeEvidenceUrl(value.guid)
    || !(value.publishedAt === null || isInstant(value.publishedAt))
    || typeof value.fingerprint !== 'string' || !HASH.test(value.fingerprint)) {
    throw new Error('EU_CHECKPOINT_ENTRY_INVALID');
  }
  const link = new URL(value.link);
  const guid = new URL(value.guid);
  if (link.origin !== 'https://eur-lex.europa.eu' || link.pathname !== '/legal-content/AUTO/'
    || link.searchParams.size !== 1 || link.searchParams.get('uri') !== `CELEX:${value.celexId}`
    || guid.origin !== 'https://eur-lex.europa.eu' || guid.pathname !== '/legal-content/AUTO/'
    || guid.searchParams.size !== 1 || !CELLAR.test((guid.searchParams.get('uri') ?? '').replace(/^CELLAR:/u, ''))
    || !(guid.searchParams.get('uri') ?? '').startsWith('CELLAR:')) throw new Error('EU_CHECKPOINT_ENTRY_INVALID');
  return Object.freeze({
    feedId: definition.id,
    feedKind: definition.kind,
    sourceId: definition.sourceId,
    celexId: value.celexId,
    documentTitle: value.documentTitle,
    creator: value.creator,
    link: value.link,
    guid: value.guid,
    publishedAt: value.publishedAt as string | null,
    fingerprint: value.fingerprint,
  });
};

export function readEuOfficialCheckpoint(value: unknown, definition: EuOfficialFeedDefinition): EuOfficialCheckpoint {
  if (!isRecord(value) || !exactKeys(value, [
    'version', 'feedId', 'checkedAt', 'bodyHash', 'etag', 'lastModified', 'channelPublishedAt', 'entries',
  ]) || value.version !== EU_OFFICIAL_CHECKPOINT_VERSION || value.feedId !== definition.id
    || !isInstant(value.checkedAt) || typeof value.bodyHash !== 'string' || !HASH.test(value.bodyHash)
    || !nullableText(value.etag, 512) || !nullableText(value.lastModified, 512)
    || !isInstant(value.channelPublishedAt) || !Array.isArray(value.entries)
    || value.entries.length < 1 || value.entries.length > 200) throw new Error('EU_CHECKPOINT_INVALID');
  const entries = value.entries.map((entry) => readEntry(entry, definition));
  if (new Set(entries.map((entry) => entry.celexId)).size !== entries.length) throw new Error('EU_CHECKPOINT_INVALID');
  return Object.freeze({
    version: EU_OFFICIAL_CHECKPOINT_VERSION,
    feedId: definition.id,
    checkedAt: value.checkedAt,
    bodyHash: value.bodyHash,
    etag: value.etag as string | null,
    lastModified: value.lastModified as string | null,
    channelPublishedAt: value.channelPublishedAt,
    entries: Object.freeze(entries),
  });
}
