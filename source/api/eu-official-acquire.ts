import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DlktInfoSourceAcquisitionGateway } from '../src/data/source-acquisition-gateway.js';
import { DlktInfoSourceClaimGateway } from '../src/data/source-claim-gateway.js';
import type { RpcTransport } from '../src/data/contracts.js';
import { EU_OFFICIAL_FEEDS, EuOfficialAcquisitionWorker } from '../src/packs/eu-official/index.js';
import { readServiceConfiguration, SupabaseServiceRpcTransport } from '../src/service/index.js';

interface AcquisitionDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetchImplementation?: typeof fetch;
  readonly transport?: RpcTransport;
  readonly now?: () => number;
}

const reply = (response: ServerResponse, status: number, body: unknown): void => {
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

export async function handleEuOfficialAcquisition(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: AcquisitionDependencies = {},
): Promise<void> {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    reply(response, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const configuration = readServiceConfiguration(dependencies.environment ?? process.env);
  if (configuration.state !== 'ready') {
    reply(response, 503, { ok: false, error: 'SOURCE_ACQUISITION_NOT_AVAILABLE' });
    return;
  }
  if (!authorized(header(request, 'authorization'), configuration.cronSecret)) {
    reply(response, 401, { ok: false, error: 'UNAUTHORIZED' });
    return;
  }

  const transport = dependencies.transport ?? new SupabaseServiceRpcTransport(
    configuration,
    dependencies.fetchImplementation,
  );
  const acquisition = new DlktInfoSourceAcquisitionGateway(transport);
  const claims = new DlktInfoSourceClaimGateway(transport);
  const port = Object.freeze({
    reserve: acquisition.reserve.bind(acquisition),
    complete: acquisition.complete.bind(acquisition),
    commitModified: claims.commitModified.bind(claims),
  });
  const worker = new EuOfficialAcquisitionWorker({
    port,
    workerId: 'worker:eu-official:scheduled',
    ...(dependencies.fetchImplementation ? { fetchImplementation: dependencies.fetchImplementation } : {}),
  });
  const now = (dependencies.now ?? Date.now)();
  if (!Number.isFinite(now)) {
    reply(response, 500, { ok: false, error: 'SOURCE_ACQUISITION_CLOCK_INVALID' });
    return;
  }

  const settled = await Promise.allSettled(EU_OFFICIAL_FEEDS.map((feed) => worker.acquire(feed, now)));
  const feeds = settled.map((result, index) => {
    const definition = EU_OFFICIAL_FEEDS[index];
    if (!definition) throw new Error('EU_FEED_INDEX_INVALID');
    if (result.status === 'rejected') {
      return Object.freeze({
        feedId: definition.id,
        sourceKey: definition.sourceId,
        status: 'failed',
        reason: 'acquisition-failed',
        checkpointVersion: null,
        entryCount: 0,
        ingestedClaimCount: 0,
        insertedClaimCount: 0,
      });
    }
    return Object.freeze({
      feedId: result.value.feedId,
      sourceKey: result.value.sourceKey,
      status: result.value.status,
      reason: result.value.reason,
      checkpointVersion: result.value.checkpointVersion,
      entryCount: result.value.entryCount,
      ingestedClaimCount: result.value.ingestedClaimCount,
      insertedClaimCount: result.value.insertedClaimCount,
    });
  });
  const failed = settled.filter((result) => result.status === 'rejected').length;
  reply(response, failed === 0 ? 200 : 502, {
    ok: failed === 0,
    pack: 'eu-official-change-radar',
    baselinePolicy: 'first-run-private-no-public-cards',
    feeds,
    failedFeeds: failed,
    publicCardsCreated: false,
  });
}

export default async function euOfficialAcquire(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleEuOfficialAcquisition(request, response);
}
