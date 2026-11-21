import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPrivateSnapshotCache, type PrivateSnapshotCache } from '../src/http/private-snapshot-cache.js';
import {
  REAL_COMPANION_REQUEST_MARKER,
  REAL_COMPANION_SOURCE_CACHE_SECONDS,
  buildRealCompanionSources,
  parseRealCompanionDefinition,
  projectRealCompanion,
  type RealCompanionSnapshot,
  type RealCompanionSourceBundle,
  type RealCompanionSourceDependencies,
} from '../src/real-companion/index.js';

const MAX_BODY_BYTES = 65_536;
const HOST = /^[a-z0-9.-]+(?::\d+)?$/iu;
const PROTOCOL = /^(?:https|http)$/u;
const sourceCache = createPrivateSnapshotCache<RealCompanionSourceBundle>(REAL_COMPANION_SOURCE_CACHE_SECONDS * 1_000);

interface CompanionApiDependencies extends RealCompanionSourceDependencies {
  readonly buildSources?: (dependencies?: RealCompanionSourceDependencies) => Promise<RealCompanionSourceBundle>;
  readonly cache?: PrivateSnapshotCache<RealCompanionSourceBundle>;
}

const firstHeader = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '').split(',')[0]?.trim() ?? '';

const trustedFetchMetadata = (request: IncomingMessage): boolean =>
  firstHeader(request.headers['sec-fetch-site']).toLowerCase() === 'same-origin'
  && ['cors', 'same-origin'].includes(firstHeader(request.headers['sec-fetch-mode']).toLowerCase())
  && firstHeader(request.headers['sec-fetch-dest']).toLowerCase() === 'empty';

const sameOrigin = (request: IncomingMessage): boolean => {
  const marker = firstHeader(request.headers['x-dlkt-info-request']);
  const host = firstHeader(request.headers['x-forwarded-host']) || firstHeader(request.headers.host);
  const protocol = (firstHeader(request.headers['x-forwarded-proto']) || 'https').toLowerCase();
  if (marker !== REAL_COMPANION_REQUEST_MARKER || !HOST.test(host) || !PROTOCOL.test(protocol)) return false;
  const origin = firstHeader(request.headers.origin);
  if (!origin) return trustedFetchMetadata(request);
  try { return new URL(origin).origin === `${protocol}://${host}`; } catch { return false; }
};

const hasQuery = (request: IncomingMessage): boolean => {
  try { return new URL(request.url ?? '/', 'https://dlkt-info.invalid').search.length > 0; } catch { return true; }
};

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  if (size === 0) throw new Error('BODY_EMPTY');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
};

const parseSearchBody = (value: unknown): string => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('BODY_INVALID');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.search !== 'string') throw new Error('BODY_INVALID');
  return record.search;
};

const setHeaders = (response: ServerResponse): void => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Vary', 'Origin, Sec-Fetch-Site');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.setHeader('X-DLKT-Info-Companion', 'real');
  response.setHeader('X-DLKT-Info-Synthetic', '0');
  response.setHeader('X-DLKT-Info-Database', '0');
  response.setHeader('X-DLKT-Info-Automatic-Execution', '0');
};

const reply = (response: ServerResponse, status: number, body: unknown): void => {
  setHeaders(response);
  response.statusCode = status;
  response.end(JSON.stringify(body));
};

export async function handleRealCompanion(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: CompanionApiDependencies = {},
): Promise<void> {
  setHeaders(response);
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.statusCode = 405;
    response.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
    return;
  }
  if (hasQuery(request)) { reply(response, 400, { error: 'QUERY_NOT_ALLOWED' }); return; }
  if (!sameOrigin(request)) { reply(response, 403, { error: 'ORIGIN_REJECTED' }); return; }
  if (!/^application\/json(?:\s*;|$)/iu.test(firstHeader(request.headers['content-type']))) {
    reply(response, 415, { error: 'CONTENT_TYPE_REQUIRED' });
    return;
  }

  try {
    const search = parseSearchBody(await readBody(request));
    const definition = parseRealCompanionDefinition(search);
    const buildSources = dependencies.buildSources ?? buildRealCompanionSources;
    const cache = dependencies.cache ?? sourceCache;
    const cacheResult = await cache.get(() => buildSources(dependencies));
    const snapshot: RealCompanionSnapshot = projectRealCompanion(definition, cacheResult.value);
    const serialized = JSON.stringify(snapshot);
    const etag = `"${createHash('sha256').update(serialized).digest('hex')}"`;
    response.setHeader('ETag', etag);
    response.setHeader('X-DLKT-Info-Server-Cache', cacheResult.state);
    response.setHeader('X-DLKT-Info-Source-State', snapshot.sourceState);
    if (firstHeader(request.headers['if-none-match']) === etag) {
      response.statusCode = 304;
      response.end();
      return;
    }
    response.statusCode = 200;
    response.end(serialized);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'BODY_TOO_LARGE') { reply(response, 413, { error: 'BODY_TOO_LARGE' }); return; }
    if (message === 'BODY_EMPTY' || message === 'BODY_INVALID' || error instanceof SyntaxError
      || message.startsWith('REAL_COMPANION_')) {
      reply(response, 400, { error: 'COMPANION_CONFIGURATION_INVALID' });
      return;
    }
    reply(response, 503, { error: 'REAL_COMPANION_UNAVAILABLE' });
  }
}

export default async function companion(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleRealCompanion(request, response);
}
