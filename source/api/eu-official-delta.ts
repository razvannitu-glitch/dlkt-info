import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPrivateSnapshotCache, type PrivateSnapshotCache } from '../src/http/private-snapshot-cache.js';
import {
  DELTA_OFFICIAL_REQUEST_MARKER,
  buildDeltaOfficialSnapshot,
  type DeltaOfficialSnapshot,
  type DeltaOfficialSnapshotDependencies,
} from '../src/delta-official/index.js';

const HOST = /^[a-z0-9.-]+(?::\d+)?$/iu;
const PROTOCOL = /^(?:https|http)$/u;
const SERVER_CACHE_MILLISECONDS = 900_000;
const productionCache = createPrivateSnapshotCache<DeltaOfficialSnapshot>(SERVER_CACHE_MILLISECONDS);

interface DeltaOfficialApiDependencies extends DeltaOfficialSnapshotDependencies {
  readonly buildSnapshot?: (dependencies?: DeltaOfficialSnapshotDependencies) => Promise<DeltaOfficialSnapshot>;
  readonly cache?: PrivateSnapshotCache<DeltaOfficialSnapshot>;
  readonly cacheNow?: () => number;
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
  if (marker !== DELTA_OFFICIAL_REQUEST_MARKER || !HOST.test(host) || !PROTOCOL.test(protocol)) return false;
  const origin = firstHeader(request.headers.origin);
  if (!origin) return trustedFetchMetadata(request);
  try { return new URL(origin).origin === `${protocol}://${host}`; } catch { return false; }
};

const hasQuery = (request: IncomingMessage): boolean => {
  try { return new URL(request.url ?? '/', 'https://dlkt-info.invalid').search.length > 0; } catch { return true; }
};

const setBoundaryHeaders = (response: ServerResponse): void => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.setHeader('X-DLKT-Info-Live', '1');
  response.setHeader('X-DLKT-Info-Delta', '1');
  response.setHeader('X-DLKT-Info-Baseline', 'release-artifact');
  response.setHeader('X-DLKT-Info-Database', '0');
  response.setHeader('X-DLKT-Info-AI-Interpretation', '0');
};

const errorReply = (response: ServerResponse, status: number, code: string): void => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  setBoundaryHeaders(response);
  response.end(JSON.stringify({ error: code }));
};

export async function handleEuOfficialDelta(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: DeltaOfficialApiDependencies = {},
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    errorReply(response, 405, 'METHOD_NOT_ALLOWED');
    return;
  }
  if (hasQuery(request)) { errorReply(response, 400, 'QUERY_NOT_ALLOWED'); return; }
  if (!sameOrigin(request)) { errorReply(response, 403, 'ORIGIN_REJECTED'); return; }

  try {
    const buildSnapshot = dependencies.buildSnapshot ?? buildDeltaOfficialSnapshot;
    const useProductionCache = !dependencies.cache && !dependencies.buildSnapshot && !dependencies.fetchImplementation;
    const cache = dependencies.cache ?? (useProductionCache
      ? productionCache
      : createPrivateSnapshotCache<DeltaOfficialSnapshot>(SERVER_CACHE_MILLISECONDS));
    const cacheResult = await cache.get(
      async () => buildSnapshot(dependencies),
      (dependencies.cacheNow ?? Date.now)(),
    );
    const serialized = JSON.stringify(cacheResult.value);
    const etag = `"${createHash('sha256').update(serialized).digest('hex')}"`;
    setBoundaryHeaders(response);
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('ETag', etag);
    response.setHeader('Last-Modified', new Date(cacheResult.value.generatedAt).toUTCString());
    response.setHeader('X-DLKT-Info-Server-Cache', cacheResult.state);
    if (firstHeader(request.headers['if-none-match']) === etag) {
      response.statusCode = 304;
      response.end();
      return;
    }
    response.statusCode = 200;
    response.end(request.method === 'HEAD' ? undefined : serialized);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'DELTA_OFFICIAL_UNAVAILABLE';
    errorReply(response, 503, code === 'DELTA_OFFICIAL_ALL_SOURCES_FAILED' ? code : 'DELTA_OFFICIAL_UNAVAILABLE');
  }
}

export default async function euOfficialDelta(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleEuOfficialDelta(request, response);
}
