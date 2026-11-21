import type { SourceDefinition } from './contracts.js';
import { sourceRequest } from './registry.js';
export class AcquisitionError extends Error {
  constructor(readonly code: string, readonly retryAfterSeconds: number | null = null) { super(code); this.name = 'AcquisitionError'; }
}
/** Respect both HTTP Retry-After forms and GitHub's explicit rate-limit reset. */
export function sourceRetryDelay(headers: Headers, now: number): number | null {
  const retry = headers.get('retry-after');
  if (retry !== null) {
    const seconds = /^\d+$/.test(retry) ? Number(retry) : (Date.parse(retry) - now) / 1000;
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(86400, Math.ceil(seconds));
  }
  const reset = headers.get('x-ratelimit-reset');
  if (headers.get('x-ratelimit-remaining') === '0' && reset && /^\d+$/.test(reset)) {
    const seconds = Number(reset) - now / 1000;
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(86400, Math.ceil(seconds));
  }
  return null;
}
export interface SourceResponse { readonly text: string | null; readonly etag: string | null; readonly modified: string | null; readonly notModified: boolean }
export async function readBounded(response: Response, limit: number): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) { await response.body?.cancel(); throw new AcquisitionError('SOURCE_TOO_LARGE'); }
  if (!response.body) throw new AcquisitionError('SOURCE_EMPTY');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new AcquisitionError('SOURCE_TOO_LARGE'); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  if (size === 0) throw new AcquisitionError('SOURCE_EMPTY');
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
export async function acquire(source: SourceDefinition, now: number, fetcher: typeof fetch, previous?: { etag: string | null; modified: string | null }): Promise<SourceResponse> {
  const url = sourceRequest(source, now);
  const headers: Record<string, string> = {
    Accept: source.adapter === 'ecb-rss' || source.adapter === 'reviewed-feed' ? 'application/rss+xml, application/atom+xml, application/xml' : source.adapter === 'cellar-sparql' ? 'application/sparql-results+json' : 'application/vnd.github+json',
    'User-Agent': 'DLKT-Info-ICEO/1.0 (+https://www.dlkt.ee)',
  };
  if (source.adapter === 'github-releases') headers['X-GitHub-Api-Version'] = '2022-11-28';
  if (previous?.etag) headers['If-None-Match'] = previous.etag;
  if (previous?.modified) headers['If-Modified-Since'] = previous.modified;
  const response = await fetcher(url, { headers, method: 'GET', credentials: 'omit', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (response.status === 304) { await response.body?.cancel(); return { text: null, etag: previous?.etag ?? null, modified: previous?.modified ?? null, notModified: true }; }
  if (!response.ok) {
    const retry = sourceRetryDelay(response.headers, now); await response.body?.cancel();
    const limited = response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
    throw new AcquisitionError(response.status >= 300 && response.status < 400 ? 'SOURCE_REDIRECT_REJECTED' : limited ? 'SOURCE_RATE_LIMITED' : `SOURCE_HTTP_${response.status}`, retry);
  }
  const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const allowed = source.adapter === 'ecb-rss' || source.adapter === 'reviewed-feed' ? ['application/rss+xml','application/atom+xml','application/xml','text/xml'] : ['application/json','application/sparql-results+json'];
  if (!allowed.includes(type)) { await response.body?.cancel(); throw new AcquisitionError('SOURCE_CONTENT_TYPE_REJECTED'); }
  const text = await readBounded(response, 2_097_152);
  const safeHeader = (name: string): string | null => { const value=response.headers.get(name); return value && value.length <= 512 && !/[\r\n]/u.test(value) ? value : null; };
  return { text, etag: safeHeader('etag'), modified: safeHeader('last-modified'), notModified: false };
}
