import type { IncomingMessage, ServerResponse } from 'node:http';
import { PRODUCT_ID, PRODUCT_VERSION } from '../src/core/contracts.js';
import {
  EU_OFFICIAL_FEEDS,
  EU_OFFICIAL_PACK_ID,
  EU_OFFICIAL_PACK_VERSION,
  EU_OFFICIAL_SOURCES,
} from '../src/packs/eu-official/index.js';
import { persistenceRuntimeProjection, readPersistenceConfiguration } from '../src/persistence/index.js';

const activationBlocker = (runtime: ReturnType<typeof persistenceRuntimeProjection>): string | null => {
  if (runtime.sourceAcquisitionEnabled) return null;
  if (!runtime.configured) return runtime.blocker ?? 'DEDICATED_SUPABASE_PROJECT_REQUIRED';
  if (!runtime.provisioned) return 'DATA_FOUNDATION_NOT_APPLIED';
  if (!runtime.realDataEnabled) return 'REAL_DATA_DISABLED';
  return 'SOURCE_ACQUISITION_DISABLED';
};

export default function euOfficialHealth(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD');
    response.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
    return;
  }
  const runtime = persistenceRuntimeProjection(readPersistenceConfiguration(process.env));
  response.statusCode = 200;
  if (request.method === 'HEAD') { response.end(); return; }
  response.end(JSON.stringify({
    product: PRODUCT_ID,
    productVersion: PRODUCT_VERSION,
    pack: EU_OFFICIAL_PACK_ID,
    packVersion: EU_OFFICIAL_PACK_VERSION,
    status: runtime.sourceAcquisitionEnabled ? 'active' : 'installed-not-activated',
    baselineRequired: true,
    privateWorkerReady: true,
    privateClaimLedgerReady: true,
    scheduledAcquisitionConfigured: true,
    publicCardsEnabled: false,
    liveAcquisitionEnabled: runtime.sourceAcquisitionEnabled,
    blocker: activationBlocker(runtime),
    sourceRegistry: EU_OFFICIAL_SOURCES.map((source) => ({
      id: source.id,
      authority: source.authority,
      role: source.role,
      attributionRequired: source.rights.attributionRequired,
      rightsReviewExpiresAt: source.rights.reviewExpiresAt,
      minIntervalSeconds: source.limits.minIntervalSeconds,
      maxRequestsPerDay: source.limits.maxRequestsPerDay,
    })),
    feeds: EU_OFFICIAL_FEEDS.map((feed) => ({ id: feed.id, sourceId: feed.sourceId, label: feed.label })),
    safeguards: [
      'official-source-only', 'strict-xml-parser', 'bounded-response', 'conditional-fetch',
      'persistent-checkpoint', 'first-run-baseline', 'no-rolloff-resolution',
      'service-only-acquisition', 'lease-and-daily-limits', 'provenance-required',
      'atomic-checkpoint-claim-commit', 'append-only-claim-batches',
      'cron-secret-authentication', 'no-public-document-content',
    ],
  }));
}
