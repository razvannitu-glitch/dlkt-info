import type { IncomingMessage, ServerResponse } from 'node:http';
import { PRODUCT_ID, PRODUCT_VERSION } from '../src/core/contracts.js';
import {
  INTERNAL_DELTA_TRIAL_ENVIRONMENT_KEYS,
  INTERNAL_DELTA_TRIAL_MIGRATION,
  INTERNAL_DELTA_TRIAL_VERSION,
  readInternalTrialConfiguration,
} from '../src/trials/index.js';

export default function internalDeltaHealth(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD');
    response.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
    return;
  }
  const configuration = readInternalTrialConfiguration(process.env);
  response.statusCode = 200;
  if (request.method === 'HEAD') { response.end(); return; }
  response.end(JSON.stringify({
    product: PRODUCT_ID,
    productVersion: PRODUCT_VERSION,
    version: INTERNAL_DELTA_TRIAL_VERSION,
    migration: INTERNAL_DELTA_TRIAL_MIGRATION,
    status: configuration.state === 'ready' ? 'ready' : 'installed-not-activated',
    workerReady: true,
    finiteCardLimit: 12,
    humanReviewRequired: true,
    publicationAutomatic: false,
    publicCardsEnabled: false,
    reviewEnabled: configuration.state === 'ready' && configuration.reviewEnabled,
    blocker: configuration.state === 'ready' ? null : 'DEDICATED_SUPABASE_PROJECT_REQUIRED',
    requiredEnvironment: INTERNAL_DELTA_TRIAL_ENVIRONMENT_KEYS,
    safeguards: [
      'service-only-private-ledger',
      'finite-delta-orchestra',
      'claim-linked-candidates',
      'human-approval-required',
      'append-only-review-events',
      'zero-automatic-publication',
    ],
  }));
}
