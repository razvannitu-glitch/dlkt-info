import { PRODUCT_VERSION } from '../core/contracts.js';
import type { ReadyPersistenceConfiguration } from '../persistence/contracts.js';
import {
  SYSTEM_IDENTITY_RPC,
  type DatabaseReadinessAttestation,
  type ProvisioningFetch,
  type SystemIdentity,
} from './contracts.js';
import { DATABASE_READINESS_RPC } from './readiness-manifest.js';
import { readDatabaseReadiness, readSystemIdentity } from './guards.js';

const MAX_RESPONSE_BYTES = 16_384;
const TIMEOUT_MS = 5_000;

async function readBoundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    throw new Error('DLKT_INFO_PROVISIONING_RESPONSE_TOO_LARGE');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new Error('DLKT_INFO_PROVISIONING_RESPONSE_CONTENT_TYPE_INVALID');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('DLKT_INFO_PROVISIONING_RESPONSE_TOO_LARGE');
  if (!response.ok) throw new Error(`DLKT_INFO_PROVISIONING_HTTP_${response.status}`);
  try { return JSON.parse(text) as unknown; } catch { throw new Error('DLKT_INFO_PROVISIONING_RESPONSE_INVALID'); }
}

export class SupabaseProvisioningTransport {
  readonly #configuration: ReadyPersistenceConfiguration;
  readonly #fetch: ProvisioningFetch;

  constructor(configuration: ReadyPersistenceConfiguration, fetchImplementation: ProvisioningFetch = fetch) {
    this.#configuration = configuration;
    this.#fetch = fetchImplementation;
  }

  async #call(functionName: string): Promise<unknown> {
    return readBoundedJson(await this.#fetch(`${this.#configuration.url}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apikey: this.#configuration.publishableKey,
        'X-Client-Info': `dlkt-info/${PRODUCT_VERSION}`,
      },
      body: '{}',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }));
  }

  async readIdentity(): Promise<SystemIdentity> {
    return readSystemIdentity(await this.#call(SYSTEM_IDENTITY_RPC));
  }

  async readReadiness(): Promise<DatabaseReadinessAttestation> {
    return readDatabaseReadiness(await this.#call(DATABASE_READINESS_RPC));
  }
}
