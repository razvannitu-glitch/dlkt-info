import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ENGINE_VERSION, PRODUCT_VERSION } from '../src/core/contracts.js';
import type { RpcTransport } from '../src/data/contracts.js';
import { EU_OFFICIAL_PACK_ID, EU_OFFICIAL_PACK_VERSION } from '../src/packs/eu-official/index.js';
import { readServiceConfiguration, SupabaseServiceRpcTransport } from '../src/service/index.js';
import {
  DlktInfoInternalTrialGateway,
  INTERNAL_DELTA_TRIAL_WORKER_ID,
  projectInternalDeltaTrial,
  readInternalTrialConfiguration,
} from '../src/trials/index.js';

interface Dependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly transport?: RpcTransport;
  readonly now?: () => number;
}

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

const failureCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  if (/ORCHESTRA|INTERNAL_TRIAL|SOURCE|CLAIM|PACK|DELTA/u.test(message)) return 'TRIAL_PAYLOAD_INVALID';
  if (/HTTP|TIMEOUT|RESPONSE|RPC/u.test(message)) return 'TRIAL_UPSTREAM_UNAVAILABLE';
  return 'TRIAL_EXECUTION_FAILED';
};

export async function handleInternalDeltaTrial(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: Dependencies = {},
): Promise<void> {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    respond(response, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  const environment = dependencies.environment ?? process.env;
  const service = readServiceConfiguration(environment);
  const trialConfiguration = readInternalTrialConfiguration(environment);
  if (service.state !== 'ready' || trialConfiguration.state !== 'ready') {
    respond(response, 503, { ok: false, error: 'INTERNAL_DELTA_TRIAL_NOT_AVAILABLE' });
    return;
  }
  if (!authorized(header(request, 'authorization'), service.cronSecret)) {
    respond(response, 401, { ok: false, error: 'UNAUTHORIZED' });
    return;
  }

  const transport = dependencies.transport ?? new SupabaseServiceRpcTransport(service);
  const gateway = new DlktInfoInternalTrialGateway(transport);
  const now = dependencies.now?.() ?? Date.now();
  const nowIso = new Date(now).toISOString();
  let jobs;
  try {
    jobs = await gateway.claimJobs({ workerId: INTERNAL_DELTA_TRIAL_WORKER_ID, limit: 10, now: nowIso, leaseSeconds: 180 });
  } catch {
    respond(response, 502, { ok: false, error: 'INTERNAL_DELTA_QUEUE_UNAVAILABLE' });
    return;
  }

  const diagnostics: Array<Readonly<{ status: 'ready_for_review' | 'empty' | 'failed'; cardCount: number }>> = [];
  for (const job of jobs) {
    try {
      const projection = projectInternalDeltaTrial(job, now);
      const summary = await gateway.complete({
        jobId: job.jobId,
        workerId: INTERNAL_DELTA_TRIAL_WORKER_ID,
        projection,
        packId: EU_OFFICIAL_PACK_ID,
        packVersion: EU_OFFICIAL_PACK_VERSION,
        engineVersion: ENGINE_VERSION,
        productVersion: PRODUCT_VERSION,
        windowStart: job.windowStart,
        windowEnd: job.windowEnd,
        now: nowIso,
      });
      diagnostics.push(Object.freeze({ status: summary.status === 'empty' ? 'empty' : 'ready_for_review', cardCount: summary.cardCount }));
    } catch (error) {
      try {
        await gateway.fail({
          jobId: job.jobId,
          workerId: INTERNAL_DELTA_TRIAL_WORKER_ID,
          errorCode: failureCode(error),
          retryAt: new Date(now + 5 * 60_000).toISOString(),
          now: nowIso,
        });
      } catch { /* Lease failure is intentionally not reflected with private identifiers. */ }
      diagnostics.push(Object.freeze({ status: 'failed', cardCount: 0 }));
    }
  }

  respond(response, diagnostics.some((item) => item.status === 'failed') ? 207 : 200, {
    ok: diagnostics.every((item) => item.status !== 'failed'),
    version: 'dlkt-info-internal-delta-trial-1',
    processed: diagnostics.length,
    readyForReview: diagnostics.filter((item) => item.status === 'ready_for_review').length,
    empty: diagnostics.filter((item) => item.status === 'empty').length,
    failed: diagnostics.filter((item) => item.status === 'failed').length,
    candidateCards: diagnostics.reduce((total, item) => total + item.cardCount, 0),
    publicCardsCreated: false,
  });
}

export default async function internalDeltaTrial(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleInternalDeltaTrial(request, response);
}
