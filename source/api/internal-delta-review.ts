import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RpcTransport } from '../src/data/contracts.js';
import { readServiceConfiguration, SupabaseServiceRpcTransport } from '../src/service/index.js';
import { DlktInfoInternalTrialGateway, readInternalTrialConfiguration } from '../src/trials/index.js';

interface Dependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly transport?: RpcTransport;
  readonly now?: () => number;
}

const MAX_BODY_BYTES = 2048;
const CARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL = /[\u0000-\u001f\u007f]/u;

const respond = (response: ServerResponse, status: number, body: unknown): void => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.end(JSON.stringify(body));
};

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

const readJson = async (request: IncomingMessage): Promise<unknown> => {
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

const parseReview = (value: unknown): Readonly<{ cardId: string; decision: 'approved' | 'rejected'; note: string }> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('REVIEW_INVALID');
  const row = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(['cardId', 'decision', 'note'].sort())
    || typeof row.cardId !== 'string' || !CARD_ID.test(row.cardId)
    || !['approved', 'rejected'].includes(String(row.decision))
    || typeof row.note !== 'string' || row.note.length < 3 || row.note.length > 500
    || row.note.trim() !== row.note || CONTROL.test(row.note)) throw new Error('REVIEW_INVALID');
  return Object.freeze({ cardId: row.cardId, decision: row.decision as 'approved' | 'rejected', note: row.note });
};

export async function handleInternalDeltaReview(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: Dependencies = {},
): Promise<void> {
  if (!['GET', 'POST'].includes(request.method ?? '')) {
    response.setHeader('Allow', 'GET, POST');
    respond(response, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  const environment = dependencies.environment ?? process.env;
  const service = readServiceConfiguration(environment);
  const trial = readInternalTrialConfiguration(environment);
  if (service.state !== 'ready' || trial.state !== 'ready' || !trial.reviewEnabled
    || !trial.reviewSecret || !trial.reviewerId) {
    respond(response, 503, { ok: false, error: 'INTERNAL_REVIEW_NOT_AVAILABLE' });
    return;
  }
  if (!authorized(header(request, 'authorization'), trial.reviewSecret)) {
    respond(response, 401, { ok: false, error: 'UNAUTHORIZED' });
    return;
  }
  const transport = dependencies.transport ?? new SupabaseServiceRpcTransport(service);
  const gateway = new DlktInfoInternalTrialGateway(transport);
  if (request.method === 'GET') {
    try {
      const candidates = await gateway.readReviewQueue(20);
      respond(response, 200, {
        ok: true,
        count: candidates.length,
        candidates,
        publicCardsEnabled: false,
      });
    } catch {
      respond(response, 502, { ok: false, error: 'REVIEW_QUEUE_UNAVAILABLE' });
    }
    return;
  }
  if (!/^application\/json(?:\s*;|$)/iu.test(header(request, 'content-type') ?? '')) {
    respond(response, 415, { ok: false, error: 'CONTENT_TYPE_REQUIRED' });
    return;
  }
  let input;
  try { input = parseReview(await readJson(request)); } catch {
    respond(response, 400, { ok: false, error: 'INVALID_REVIEW' });
    return;
  }
  try {
    const result = await gateway.review({
      ...input,
      reviewer: trial.reviewerId,
      now: new Date(dependencies.now?.() ?? Date.now()).toISOString(),
    });
    respond(response, 200, {
      ok: true,
      trialStatus: result.trialStatus,
      cardReviewState: result.cardReviewState,
      pending: result.pendingCount,
      approved: result.approvedCount,
      rejected: result.rejectedCount,
      publicCardsCreated: false,
    });
  } catch {
    respond(response, 409, { ok: false, error: 'REVIEW_NOT_APPLIED' });
  }
}

export default async function internalDeltaReview(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleInternalDeltaReview(request, response);
}
