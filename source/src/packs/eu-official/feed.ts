import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type {
  EuOfficialEntry,
  EuOfficialFeedDefinition,
  EuOfficialFetchResult,
  EuOfficialParsedFeed,
} from './contracts.js';

const CONTROL = /[\u0000-\u001f\u007f]/u;
const CELEX = /^[0-9A-Z][0-9A-Z()./-]{4,63}$/u;
const CONTENT_TYPE = /^(?:application\/(?:rss\+xml|xml)|text\/xml)(?:\s*;|$)/iu;
const ORIGIN = 'https://eur-lex.europa.eu';
const MAX_ITEMS = 200;

type RecordValue = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, maximum: number, allowEmpty = false): string => {
  if (typeof value !== 'string') throw new Error('EU_RSS_TEXT_INVALID');
  const clean = value.replace(/\s+/gu, ' ').trim();
  if ((!allowEmpty && clean.length === 0) || clean.length > maximum || CONTROL.test(clean)) {
    throw new Error('EU_RSS_TEXT_INVALID');
  }
  return clean;
};

const optionalText = (value: unknown, maximum: number): string => {
  if (value === undefined || value === null || value === '') return '';
  return text(value, maximum, true);
};

const shortText = (value: string, maximum: number): string =>
  value.length <= maximum ? value : `${value.slice(0, maximum - 1).trimEnd()}…`;

const instant = (value: string, retrievedAt: string): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > Date.parse(retrievedAt) + 172_800_000) {
    throw new Error('EU_RSS_DATE_INVALID');
  }
  return new Date(timestamp).toISOString();
};

const queryIdentity = (value: string, expectedPrefix: 'CELEX:' | 'CELLAR:'): string => {
  const url = new URL(value);
  const keys = [...url.searchParams.keys()];
  const values = url.searchParams.getAll('uri');
  if (url.origin !== ORIGIN || url.pathname !== '/legal-content/AUTO/' || keys.length !== 1
    || keys[0] !== 'uri' || values.length !== 1 || !values[0]?.startsWith(expectedPrefix)) {
    throw new Error('EU_RSS_LINK_INVALID');
  }
  return values[0].slice(expectedPrefix.length);
};

const canonicalDocumentUrl = (celexId: string): string => {
  const url = new URL('/legal-content/AUTO/', ORIGIN);
  url.searchParams.set('uri', `CELEX:${celexId}`);
  return url.toString();
};

function normalizeEntry(
  definition: EuOfficialFeedDefinition,
  value: unknown,
  retrievedAt: string,
): EuOfficialEntry {
  if (!isRecord(value)) throw new Error('EU_RSS_ITEM_INVALID');
  const rawTitle = text(value.title, 1200);
  const titleMatch = /^CELEX:([^:]+)(?::\s*(.*))?$/u.exec(rawTitle);
  if (!titleMatch) throw new Error('EU_RSS_CELEX_TITLE_INVALID');
  const celexId = titleMatch[1]?.trim() ?? '';
  if (!CELEX.test(celexId)) throw new Error('EU_RSS_CELEX_INVALID');
  const linkCelex = queryIdentity(text(value.link, 1800), 'CELEX:');
  if (linkCelex !== celexId) throw new Error('EU_RSS_CELEX_MISMATCH');
  const guidIdentity = queryIdentity(text(value.guid, 1800), 'CELLAR:');
  if (!/^[a-f0-9-]{20,80}$/iu.test(guidIdentity)) throw new Error('EU_RSS_CELLAR_INVALID');

  const title = shortText((titleMatch[2]?.trim() || `CELEX ${celexId}`), 300);
  const creator = shortText(optionalText(value['dc:creator'], 400) || 'European Union institution', 200);
  const publishedAtRaw = optionalText(value.pubDate, 100);
  const publishedAt = publishedAtRaw ? instant(publishedAtRaw, retrievedAt) : null;
  const link = canonicalDocumentUrl(celexId);
  const guid = `${ORIGIN}/legal-content/AUTO/?uri=CELLAR:${guidIdentity}`;
  const fingerprint = createHash('sha256').update(JSON.stringify({
    feedId: definition.id,
    celexId,
    title,
    creator,
    link,
    guid,
    publishedAt,
    description: shortText(optionalText(value.description, 1000), 500),
  })).digest('hex');

  return Object.freeze({
    feedId: definition.id,
    feedKind: definition.kind,
    sourceId: definition.sourceId,
    celexId,
    documentTitle: title,
    creator,
    link,
    guid,
    publishedAt,
    fingerprint,
  });
}

export function parseEuOfficialRss(
  definition: EuOfficialFeedDefinition,
  xml: string,
  retrievedAt: string,
): EuOfficialParsedFeed {
  if (!Number.isFinite(Date.parse(retrievedAt)) || Buffer.byteLength(xml, 'utf8') > 500_000
    || /<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new Error('EU_RSS_DOCUMENT_INVALID');
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (validation !== true) throw new Error('EU_RSS_XML_INVALID');
  const parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: false,
    isArray: (_name, path) => path === 'rss.channel.item',
  });
  const parsed: unknown = parser.parse(xml);
  if (!isRecord(parsed) || !isRecord(parsed.rss) || !isRecord(parsed.rss.channel)) {
    throw new Error('EU_RSS_SHAPE_INVALID');
  }
  const channel = parsed.rss.channel;
  const channelTitle = text(channel.title, 300);
  if (channelTitle !== definition.expectedChannelTitle) throw new Error('EU_RSS_CHANNEL_INVALID');
  const channelPublishedAt = instant(text(channel.pubDate, 100), retrievedAt);
  if (text(channel.language, 20).toLowerCase() !== 'en') throw new Error('EU_RSS_LANGUAGE_INVALID');
  const items = Array.isArray(channel.item) ? channel.item : [channel.item];
  if (items.length < 1 || items.length > MAX_ITEMS) throw new Error('EU_RSS_ITEM_COUNT_INVALID');
  const entries = items.map((item) => normalizeEntry(definition, item, retrievedAt));
  const identities = new Set(entries.map((entry) => entry.celexId));
  if (identities.size !== entries.length) throw new Error('EU_RSS_DUPLICATE_CELEX');
  return Object.freeze({
    feedId: definition.id,
    channelTitle,
    channelPublishedAt,
    retrievedAt,
    entries: Object.freeze(entries),
  });
}

const header = (response: Response, name: string): string | null => {
  const value = response.headers.get(name);
  if (value === null) return null;
  const clean = value.trim();
  if (clean.length < 1 || clean.length > 512 || CONTROL.test(clean)) throw new Error('EU_RSS_HEADER_INVALID');
  return clean;
};

async function readBoundedBody(response: Response, maximum: number): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximum)) {
    throw new Error('EU_RSS_BODY_TOO_LARGE');
  }
  if (!response.body) throw new Error('EU_RSS_BODY_MISSING');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximum) throw new Error('EU_RSS_BODY_TOO_LARGE');
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function fetchEuOfficialFeed(input: Readonly<{
  definition: EuOfficialFeedDefinition;
  previousEtag?: string | null;
  previousLastModified?: string | null;
  fetchImplementation?: typeof fetch;
  signal?: AbortSignal;
  now?: () => number;
}>): Promise<EuOfficialFetchResult> {
  const registered = new URL(input.definition.url);
  if (registered.origin !== ORIGIN || registered.pathname !== '/EN/display-feed.rss'
    || registered.searchParams.size !== 1 || !/^16[12]$/u.test(registered.searchParams.get('rssId') ?? '')) {
    throw new Error('EU_RSS_DEFINITION_INVALID');
  }
  const timeout = AbortSignal.timeout(8000);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  const headers: Record<string, string> = {
    Accept: 'application/rss+xml',
    'User-Agent': 'DLKT-Info/0.9.19 (+https://www.dlkt.ee)',
  };
  if (input.previousEtag) headers['If-None-Match'] = input.previousEtag;
  if (input.previousLastModified) headers['If-Modified-Since'] = input.previousLastModified;
  const response = await (input.fetchImplementation ?? fetch)(input.definition.url, {
    method: 'GET',
    headers,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal,
  });
  const retrievedAt = new Date((input.now ?? Date.now)()).toISOString();
  const etag = header(response, 'etag');
  const lastModified = header(response, 'last-modified');
  if (response.status === 304) {
    return Object.freeze({ status: 'not-modified', definition: input.definition, retrievedAt, etag, lastModified });
  }
  if (response.status !== 200) throw new Error(`EU_RSS_HTTP_${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!CONTENT_TYPE.test(contentType)) throw new Error('EU_RSS_CONTENT_TYPE_INVALID');
  const body = await readBoundedBody(response, 500_000);
  return Object.freeze({
    status: 'modified',
    definition: input.definition,
    retrievedAt,
    body,
    bodyHash: createHash('sha256').update(body).digest('hex'),
    etag,
    lastModified,
  });
}
