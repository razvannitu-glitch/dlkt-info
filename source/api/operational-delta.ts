import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  OPERATIONAL_LEDGER_REQUEST_MARKER,
  OPERATIONAL_LEDGER_VERSION,
  VercelBlobOperationalLedgerStorage,
  readLatestOperationalDelta,
  readOperationalLedgerConfiguration,
  type OperationalLedgerStorage,
} from '../src/operational-ledger/index.js';

interface Dependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly storage?: OperationalLedgerStorage;
}

const HOST = /^[a-z0-9.-]+(?::\d+)?$/iu;
const PROTOCOL = /^(?:https|http)$/u;
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
  if (marker !== OPERATIONAL_LEDGER_REQUEST_MARKER || !HOST.test(host) || !PROTOCOL.test(protocol)) return false;
  const origin = firstHeader(request.headers.origin);
  if (!origin) return trustedFetchMetadata(request);
  try { return new URL(origin).origin === `${protocol}://${host}` && trustedFetchMetadata(request); } catch { return false; }
};
const baseHeaders = (response: ServerResponse): void => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.setHeader('X-DLKT-Info-Operational-Ledger', '1');
};
const reply = (response: ServerResponse, status: number, body: unknown): void => {
  baseHeaders(response);
  response.statusCode = status;
  response.end(JSON.stringify(body));
};

export async function handleOperationalDelta(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: Dependencies = {},
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    reply(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  if (request.url && new URL(request.url, 'https://internal.invalid').search) {
    reply(response, 400, { error: 'QUERY_NOT_ALLOWED' });
    return;
  }
  if (!sameOrigin(request)) { reply(response, 403, { error: 'ORIGIN_REJECTED' }); return; }
  const configuration = readOperationalLedgerConfiguration(dependencies.environment ?? process.env);
  if (configuration.state !== 'ready') {
    reply(response, 503, { version: OPERATIONAL_LEDGER_VERSION, state: 'not-configured', blocker: configuration.blocker });
    return;
  }
  try {
    const storage = dependencies.storage ?? new VercelBlobOperationalLedgerStorage(configuration.auth);
    const result = await readLatestOperationalDelta(storage, configuration.instanceId);
    const body = result.state === 'ready'
      ? result.delta
      : Object.freeze({ version: OPERATIONAL_LEDGER_VERSION, product: 'dlkt-info', state: 'empty', cards: Object.freeze([]) });
    const serialized = JSON.stringify(body);
    const etag = `"${createHash('sha256').update(serialized).digest('hex')}"`;
    baseHeaders(response);
    response.setHeader('ETag', etag);
    response.setHeader('X-DLKT-Info-Ledger-State', result.state);
    if (firstHeader(request.headers['if-none-match']) === etag) {
      response.statusCode = 304;
      response.end();
      return;
    }
    response.statusCode = 200;
    response.end(request.method === 'HEAD' ? undefined : serialized);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = /IDENTITY|INSTANCE/u.test(message) ? 'LEDGER_IDENTITY_INVALID'
      : /CHECKPOINT|POINTER|HASH|CHAIN/u.test(message) ? 'LEDGER_INTEGRITY_INVALID' : 'LEDGER_READ_FAILED';
    reply(response, 503, { version: OPERATIONAL_LEDGER_VERSION, state: 'unavailable', error: code });
  }
}

export default async function operationalDelta(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleOperationalDelta(request, response);
}
