import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  OPERATIONAL_LEDGER_VERSION,
  VercelBlobOperationalLedgerStorage,
  collectOperationalDelta,
  readOperationalLedgerConfiguration,
  type OperationalLedgerStorage,
} from '../src/operational-ledger/index.js';

interface Dependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly storage?: OperationalLedgerStorage;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => number;
}

const header = (request: IncomingMessage, name: string): string | null => {
  const value = request.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : Array.isArray(value) && value.length === 1 ? value[0] ?? null : null;
};
const authorized = (value: string | null, secret: string): boolean => {
  if (value === null) return false;
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const received = Buffer.from(value, 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
};
const reply = (response: ServerResponse, status: number, body: unknown): void => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.setHeader('X-DLKT-Info-Operational-Ledger', '1');
  response.end(JSON.stringify(body));
};

export async function handleOperationalDeltaCollect(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: Dependencies = {},
): Promise<void> {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    reply(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  if (request.url && new URL(request.url, 'https://internal.invalid').search) {
    reply(response, 400, { error: 'QUERY_NOT_ALLOWED' });
    return;
  }
  const environment = dependencies.environment ?? process.env;
  const configuration = readOperationalLedgerConfiguration(environment);
  if (configuration.state !== 'ready') {
    reply(response, 503, { version: OPERATIONAL_LEDGER_VERSION, error: configuration.blocker });
    return;
  }
  const cronSecret = environment.CRON_SECRET;
  if (typeof cronSecret !== 'string' || cronSecret.length < 24 || cronSecret.length > 512
      || !authorized(header(request, 'authorization'), cronSecret)) {
    reply(response, 401, { error: 'UNAUTHORIZED' });
    return;
  }
  try {
    const storage = dependencies.storage ?? new VercelBlobOperationalLedgerStorage(configuration.auth);
    const result = await collectOperationalDelta({
      storage,
      instanceId: configuration.instanceId,
      dependencies: {
        ...(dependencies.fetchImplementation ? { fetchImplementation: dependencies.fetchImplementation } : {}),
        ...(dependencies.now ? { now: dependencies.now } : {}),
      },
    });
    const status = result.status === 'source-unavailable' ? 503 : result.status === 'slot-conflict' ? 409 : 200;
    reply(response, status, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = /IDENTITY|INSTANCE/u.test(message) ? 'LEDGER_IDENTITY_INVALID'
      : /CHECKPOINT|POINTER|HASH|CHAIN/u.test(message) ? 'LEDGER_INTEGRITY_INVALID'
        : /CONFLICT/u.test(message) ? 'LEDGER_CONFLICT' : 'LEDGER_COLLECTION_FAILED';
    reply(response, 503, { version: OPERATIONAL_LEDGER_VERSION, error: code });
  }
}

export default async function operationalDeltaCollect(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleOperationalDeltaCollect(request, response);
}
