import { buildDeltaOfficialSnapshot, readEuReleaseBaseline } from '../delta-official/index.js';
import { buildLiveOfficialSnapshot } from '../live-official/index.js';
import {
  VercelBlobOperationalLedgerStorage,
  readLatestOperationalDelta,
  readOperationalLedgerConfiguration,
  type OperationalDeltaSnapshot,
} from '../operational-ledger/index.js';
import type { RealCompanionSourceBundle, RealCompanionSourceDependencies } from './contracts.js';

interface StoredResponse {
  readonly body: Uint8Array;
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly (readonly [string, string])[];
}

const requestKey = (input: RequestInfo | URL, init?: RequestInit): string => {
  const request = new Request(input, init);
  const headers = [...request.headers.entries()].sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify({ method: request.method, url: request.url, headers });
};

export function createRequestMemoizedFetch(fetchImplementation: typeof fetch = fetch): typeof fetch {
  const responses = new Map<string, Promise<StoredResponse>>();
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const key = requestKey(input, init);
    let pending = responses.get(key);
    if (!pending) {
      pending = fetchImplementation(input, init).then(async (response) => Object.freeze({
        body: new Uint8Array(await response.arrayBuffer()),
        status: response.status,
        statusText: response.statusText,
        headers: Object.freeze([...response.headers.entries()].map((entry) => Object.freeze(entry) as readonly [string, string])),
      }));
      responses.set(key, pending);
    }
    const stored = await pending;
    return new Response(stored.body.slice(), {
      status: stored.status,
      statusText: stored.statusText,
      headers: stored.headers.map(([key, value]): [string, string] => [key, value]),
    });
  }) as typeof fetch;
}

const errorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  if (/ALL_SOURCES_FAILED/u.test(message)) return 'ALL_OFFICIAL_SOURCES_UNAVAILABLE';
  if (/TIMEOUT|AbortError|TimeoutError/u.test(message)) return 'OFFICIAL_SOURCE_TIMEOUT';
  if (/PAYLOAD|XML|RSS|AUTHORIZ|REGISTRY|PROVENANCE/u.test(message)) return 'OFFICIAL_SOURCE_VALIDATION_FAILED';
  return 'OFFICIAL_SOURCE_UNAVAILABLE';
};

const loadOperationalDelta = async (
  dependencies: RealCompanionSourceDependencies,
): Promise<OperationalDeltaSnapshot | null> => {
  if (dependencies.readOperational) return dependencies.readOperational();
  const configuration = readOperationalLedgerConfiguration(dependencies.environment ?? process.env);
  if (configuration.state !== 'ready') return null;
  const storage = dependencies.operationalStorage ?? new VercelBlobOperationalLedgerStorage(configuration.auth);
  const result = await readLatestOperationalDelta(storage, configuration.instanceId);
  return result.state === 'ready' ? result.delta : null;
};

export async function buildRealCompanionSources(
  dependencies: RealCompanionSourceDependencies = {},
): Promise<RealCompanionSourceBundle> {
  const now = dependencies.now ?? Date.now;
  const checkedAt = new Date(now()).toISOString();
  const releaseBaseline = readEuReleaseBaseline();
  const memoizedFetch = createRequestMemoizedFetch(dependencies.fetchImplementation ?? fetch);
  const deltaBuilder = dependencies.buildDelta ?? buildDeltaOfficialSnapshot;
  const liveBuilder = dependencies.buildLive ?? buildLiveOfficialSnapshot;
  const sharedDependencies = {
    fetchImplementation: memoizedFetch,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  };
  const [operationalResult, liveResult] = await Promise.allSettled([
    loadOperationalDelta(dependencies),
    liveBuilder(sharedDependencies),
  ]);

  if (operationalResult.status === 'rejected') {
    return Object.freeze({
      checkedAt,
      baselineAt: releaseBaseline.capturedAt,
      baselineHash: releaseBaseline.baselineHash,
      delta: null,
      deltaMode: 'none',
      live: liveResult.status === 'fulfilled' ? liveResult.value : null,
      deltaError: errorCode(operationalResult.reason),
      liveError: liveResult.status === 'rejected' ? errorCode(liveResult.reason) : null,
    });
  }

  if (operationalResult.value) {
    return Object.freeze({
      checkedAt,
      baselineAt: operationalResult.value.baselineAt,
      baselineHash: operationalResult.value.baselineHash,
      delta: operationalResult.value,
      deltaMode: 'operational-ledger',
      live: liveResult.status === 'fulfilled' ? liveResult.value : null,
      deltaError: null,
      liveError: liveResult.status === 'rejected' ? errorCode(liveResult.reason) : null,
    });
  }

  const deltaResult = await Promise.allSettled([deltaBuilder(sharedDependencies)]).then(([result]) => result);
  return Object.freeze({
    checkedAt,
    baselineAt: releaseBaseline.capturedAt,
    baselineHash: releaseBaseline.baselineHash,
    delta: deltaResult.status === 'fulfilled' ? deltaResult.value : null,
    deltaMode: deltaResult.status === 'fulfilled' ? 'release-baseline' : 'none',
    live: liveResult.status === 'fulfilled' ? liveResult.value : null,
    deltaError: deltaResult.status === 'rejected' ? errorCode(deltaResult.reason) : null,
    liveError: liveResult.status === 'rejected' ? errorCode(liveResult.reason) : null,
  });
}
