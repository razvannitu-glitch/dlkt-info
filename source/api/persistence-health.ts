import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  PERSISTENCE_ENVIRONMENT_KEYS,
  persistenceRuntimeProjection,
  readPersistenceConfiguration,
} from '../src/persistence/index.js';
import {
  PROVISIONING_INSTANCE_ENVIRONMENT_KEY,
  projectProvisioningControl,
  type ProvisioningDependencies,
  type ProvisioningProjection,
} from '../src/provisioning/index.js';

type Dependencies = ProvisioningDependencies & { readonly provisioning?: ProvisioningProjection };

export async function handlePersistenceHealth(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: Dependencies = {},
): Promise<void> {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD');
    response.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  const environment = dependencies.environment ?? process.env;
  const runtime = persistenceRuntimeProjection(readPersistenceConfiguration(environment));
  const provisioning = dependencies.provisioning ?? await projectProvisioningControl({
    environment,
    fetch: dependencies.fetch ?? fetch,
  });
  response.statusCode = provisioning.capabilities.persistence ? 200 : 503;
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  response.end(JSON.stringify({
    product: 'dlkt-info',
    ...runtime,
    provisioned: provisioning.capabilities.persistence,
    authEnabled: provisioning.capabilities.auth,
    realDataEnabled: provisioning.capabilities.realData,
    sourceAcquisitionEnabled: provisioning.capabilities.sourceAcquisition,
    deliveryWorkersEnabled: provisioning.capabilities.deliveryWorkers,
    blocker: provisioning.blocker,
    provisioning,
    dedicatedProjectRequired: true,
    requiredEnvironment: Object.freeze([...PERSISTENCE_ENVIRONMENT_KEYS, PROVISIONING_INSTANCE_ENVIRONMENT_KEY]),
  }));
}

export default async function persistenceHealth(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handlePersistenceHealth(request, response);
}
