import {createHash} from 'node:crypto';
import {cardContent, copyCard, validCard} from '../iceo/card-validation.js';
import type {EvidenceCard, SourceDefinition} from '../iceo/contracts.js';
import {ICEO_SOURCES} from '../iceo/registry.js';
import {canonicalNewsUrl,publisherForNewsUrl} from '../iceo/news-sources.js';
import {newsCategoryFromSourceId,EDITORIAL_CATEGORY_TOPICS} from '../iceo/editorial-categories.js';
import type {CurrentCard} from './current-card.js';

export const SHARE_ARCHIVE_VERSION = 'dlkt-share-archive-1' as const;
export const MAX_ARCHIVE_CARD_BYTES = 32_768;
const FRESHNESS_MS = 3_600_000;
const CLOCK_TOLERANCE_MS = 300_000;
const CARD_FIELDS = new Set(['id','identity','title','topic','kind','sourceUrl','publisher','sourceIds','date','dateLabel','observedAt','contentHash','boundary','deadline','version','attribution','sourceState','summary','byline','licenseUrl','context']);
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** An immutable record of a previous source check. Reading it does not recheck the source. */
export interface ArchivedCard {
  readonly version: typeof SHARE_ARCHIVE_VERSION;
  readonly card: EvidenceCard;
  readonly capturedAt: string;
  readonly sourceCheckExpiresAt: string;
  readonly partial: boolean;
}

export interface ArchiveStore {
  readonly writable: boolean;
  read(id: string, revision: string | null): Promise<ArchivedCard | null>;
  /** Input must come from currentCard on the server-owned snapshot, never a request body. */
  capture(current: CurrentCard, now: number): Promise<ArchivedCard>;
}

export class ArchiveError extends Error {
  constructor(readonly code: 'SHARE_ARCHIVE_INVALID' | 'SHARE_ARCHIVE_UNAVAILABLE') {
    super(code);
    this.name = 'ArchiveError';
  }
}

export function validArchiveReference(id: string, revision: string | null): boolean {
  return /^[a-f0-9]{24}$/u.test(id) && (revision === null || /^[a-f0-9]{64}$/u.test(revision));
}

function allowedSource(card: EvidenceCard, source: SourceDefinition, url: URL): boolean {
  if(source.adapter==='news-index'){
    const category=newsCategoryFromSourceId(source.id),publisher=publisherForNewsUrl(card.sourceUrl);
    const unclassified=source.id==='news-unclassified'&&card.topic==='other';
    const pairedCategory=source.id==='editorial-frontpage'&&publisher!==null&&['ap','guardian','pcgamer','bbc'].includes(publisher.id)
      &&card.sourceIds.some(id=>{const paired=newsCategoryFromSourceId(id);return id==='news-unclassified'&&card.topic==='other'||paired!==null&&card.topic===EDITORIAL_CATEGORY_TOPICS[paired];});
    return (category!==null&&card.topic===EDITORIAL_CATEGORY_TOPICS[category]||unclassified||pairedCategory)
      &&publisher!==null&&publisher.label===card.publisher
      &&card.kind==='publication'&&card.dateLabel==='Published'&&card.identity===card.sourceUrl
      &&canonicalNewsUrl(card.sourceUrl)===card.sourceUrl&&card.summary===undefined&&card.byline===undefined
      &&card.licenseUrl===undefined&&card.deadline===null&&card.version===null;
  }
  if (source.publisher !== card.publisher) return false;
  if (source.adapter === 'cellar-sparql') {
    if (card.kind !== 'legal-document' || !/^celex:[0-9A-Z][0-9]{4}[A-Z0-9()/_-]{3,60}$/u.test(card.identity)) return false;
    return card.sourceUrl === `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${encodeURIComponent(card.identity.slice(6))}`;
  }
  if (card.identity !== card.sourceUrl) return false;
  if (source.adapter === 'github-releases') return card.kind === 'software-release'
    && url.origin === 'https://github.com' && url.pathname.startsWith(`/${source.repo ?? ''}/releases/tag/`)
    && card.version !== null && /^v?\d+\.\d+\.\d+$/u.test(card.version)
    && decodeURIComponent(url.pathname.split('/').at(-1) ?? '') === card.version;
  if (source.adapter === 'ecb-rss') return url.origin === 'https://www.ecb.europa.eu'
    && card.kind === (source.id === 'ecb-procurement' ? 'procurement-notice' : 'publication');
  return card.kind === 'publication' && source.feed !== undefined && url.search === ''
    && source.feed.articleOrigins.includes(url.origin)
    && source.feed.articlePaths.some(prefix => url.pathname.startsWith(prefix));
}

/** Strict public projection: extra fields, foreign URLs and forged content revisions fail closed. */
export function validArchiveCard(value: unknown): value is EvidenceCard {
  try {
    if (!validCard(value) || Object.keys(value).some(key => !CARD_FIELDS.has(key))
      || Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_ARCHIVE_CARD_BYTES
      || value.sourceState === 'stale' || value.sourceIds.length < 1 || value.sourceIds.length > 8
      || new Set(value.sourceIds).size !== value.sourceIds.length
      || digest(value.identity).slice(0,24) !== value.id || digest(cardContent(value)) !== value.contentHash) return false;
    const url = new URL(value.sourceUrl);
    if (value.sourceUrl.length > 3000 || url.href !== value.sourceUrl || url.hash !== ''
      || /[\u0000-\u001f\u007f\\]/u.test(value.sourceUrl)) return false;
    // No unreviewed publisher or source-to-URL substitution can enter the public archive.
    return value.sourceIds.every(id => {
      const source = ICEO_SOURCES.find(candidate => candidate.id === id);
      return source !== undefined && allowedSource(value, source, url);
    });
  } catch {
    return false;
  }
}

export function captureArchiveRecord(current: CurrentCard, now: number): ArchivedCard {
  const observed = Date.parse(current.card.observedAt);
  if (!Number.isFinite(now) || !validArchiveCard(current.card) || typeof current.partial !== 'boolean'
    || !Number.isFinite(current.validUntil) || observed > now + CLOCK_TOLERANCE_MS
    || observed < now - FRESHNESS_MS || current.validUntil <= now
    || current.validUntil > observed + FRESHNESS_MS || current.validUntil > now + FRESHNESS_MS + CLOCK_TOLERANCE_MS
    || current.card.sourceIds.some(id => {
      const source = ICEO_SOURCES.find(candidate => candidate.id === id);
      return source === undefined || new Date(now).toISOString().slice(0,10) > source.rightsReviewBy;
    })) throw new ArchiveError('SHARE_ARCHIVE_INVALID');
  return Object.freeze({version: SHARE_ARCHIVE_VERSION, card: copyCard(current.card),
    capturedAt: new Date(now).toISOString(), sourceCheckExpiresAt: new Date(current.validUntil).toISOString(), partial: current.partial});
}

/** Parse the public SQL row without converting old evidence into a current verification. */
export function archiveRecordFromRow(value: unknown): ArchivedCard {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ArchiveError('SHARE_ARCHIVE_UNAVAILABLE');
  const row = value as Record<string, unknown>;
  const fields = ['id','revision','card','captured_at','source_check_expires_at','partial'];
  if (Object.keys(row).length !== fields.length || Object.keys(row).some(key => !fields.includes(key))
    || !validArchiveCard(row.card) || row.id !== row.card.id || row.revision !== row.card.contentHash
    || typeof row.captured_at !== 'string' || typeof row.source_check_expires_at !== 'string'
    || typeof row.partial !== 'boolean') throw new ArchiveError('SHARE_ARCHIVE_UNAVAILABLE');
  const captured = Date.parse(row.captured_at), expires = Date.parse(row.source_check_expires_at), observed = Date.parse(row.card.observedAt);
  if (!Number.isFinite(captured) || !Number.isFinite(expires) || expires <= captured
    || observed > captured + CLOCK_TOLERANCE_MS || observed < captured - FRESHNESS_MS
    || expires > observed + FRESHNESS_MS || expires > captured + FRESHNESS_MS + CLOCK_TOLERANCE_MS) throw new ArchiveError('SHARE_ARCHIVE_UNAVAILABLE');
  return Object.freeze({version: SHARE_ARCHIVE_VERSION, card: copyCard(row.card),
    capturedAt: new Date(captured).toISOString(), sourceCheckExpiresAt: new Date(expires).toISOString(), partial: row.partial});
}
