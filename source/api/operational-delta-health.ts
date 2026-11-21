import type { IncomingMessage, ServerResponse } from 'node:http';
import { PRODUCT_ID, PRODUCT_VERSION } from '../src/core/contracts.js';
import {
  OPERATIONAL_LEDGER_ENVIRONMENT_KEYS,
  OPERATIONAL_LEDGER_VERSION,
  VercelBlobOperationalLedgerStorage,
  operationalLedgerContract,
  readLatestOperationalDelta,
  readOperationalLedgerConfiguration,
  type OperationalLedgerStorage,
} from '../src/operational-ledger/index.js';

interface Dependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly storage?: OperationalLedgerStorage;
}

const reply = (response: ServerResponse, status: number, body: unknown, head: boolean): void => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.end(head ? undefined : JSON.stringify(body));
};

export async function handleOperationalDeltaHealth(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: Dependencies = {},
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    reply(response, 405, { error: 'METHOD_NOT_ALLOWED' }, false);
    return;
  }
  const head = request.method === 'HEAD';
  const configuration = readOperationalLedgerConfiguration(dependencies.environment ?? process.env);
  if (configuration.state !== 'ready') {
    reply(response, 200, {
      product: PRODUCT_ID, productVersion: PRODUCT_VERSION, version: OPERATIONAL_LEDGER_VERSION,
      status: 'installed-not-activated', identityVerified: false, ledgerState: 'not-configured',
      blocker: configuration.blocker, requiredEnvironment: OPERATIONAL_LEDGER_ENVIRONMENT_KEYS,
      contract: operationalLedgerContract,
    }, head);
    return;
  }
  try {
    const storage = dependencies.storage ?? new VercelBlobOperationalLedgerStorage(configuration.auth);
    const state = await readLatestOperationalDelta(storage, configuration.instanceId);
    reply(response, 200, {
      product: PRODUCT_ID, productVersion: PRODUCT_VERSION, version: OPERATIONAL_LEDGER_VERSION,
      status: 'ready', identityVerified: true, ledgerState: state.state,
      sequence: state.state === 'ready' ? state.pointer.sequence : 0,
      slotAt: state.state === 'ready' ? state.pointer.slotAt : null,
      blocker: null, requiredEnvironment: OPERATIONAL_LEDGER_ENVIRONMENT_KEYS,
      contract: operationalLedgerContract,
    }, head);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    reply(response, 503, {
      product: PRODUCT_ID, productVersion: PRODUCT_VERSION, version: OPERATIONAL_LEDGER_VERSION,
      status: 'configured-not-verified', identityVerified: false, ledgerState: 'unavailable',
      blocker: /IDENTITY/u.test(message) ? 'OPERATIONAL_LEDGER_IDENTITY_REQUIRED' : 'OPERATIONAL_LEDGER_STORAGE_UNAVAILABLE',
      requiredEnvironment: OPERATIONAL_LEDGER_ENVIRONMENT_KEYS,
      contract: operationalLedgerContract,
    }, head);
  }
}

export default async function operationalDeltaHealth(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleOperationalDeltaHealth(request, response);
}
