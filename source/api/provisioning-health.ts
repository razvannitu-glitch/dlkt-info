import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  PROVISIONING_INSTANCE_ENVIRONMENT_KEY,
  provisioningControlContract,
  projectProvisioningControl,
  type ProvisioningDependencies,
} from '../src/provisioning/index.js';
import { PERSISTENCE_ENVIRONMENT_KEYS } from '../src/persistence/index.js';

export async function handleProvisioningHealth(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ProvisioningDependencies = {},
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

  const projection = await projectProvisioningControl(dependencies);
  response.statusCode = projection.schemaVerified ? 200 : 503;
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  response.end(JSON.stringify({
    product: 'dlkt-info',
    contract: provisioningControlContract,
    provisioning: projection,
    requiredEnvironment: Object.freeze([...PERSISTENCE_ENVIRONMENT_KEYS, PROVISIONING_INSTANCE_ENVIRONMENT_KEY]),
  }));
}

export default async function provisioningHealth(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleProvisioningHealth(request, response);
}
