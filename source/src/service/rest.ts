import type { RpcTransport } from '../data/contracts.js';
import type { ReadyServiceConfiguration, ServiceFetch } from './contracts.js';

const SERVICE_RPC = new Set([
  'dlkt_info_reserve_source_acquisition',
  'dlkt_info_complete_source_acquisition',
  'dlkt_info_commit_source_acquisition',
  'dlkt_info_read_source_acquisition',
  'dlkt_info_claim_internal_delta_jobs',
  'dlkt_info_complete_internal_delta_trial',
  'dlkt_info_fail_internal_delta_job',
  'dlkt_info_review_internal_delta_card',
  'dlkt_info_read_internal_delta_review_queue',
]);
const MAX_REQUEST_BYTES = 2_500_000;
const MAX_RESPONSE_BYTES = 2_500_000;
const TIMEOUT_MS = 10_000;

async function readBoundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    throw new Error('DLKT_INFO_SERVICE_RESPONSE_TOO_LARGE');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new Error('DLKT_INFO_SERVICE_RESPONSE_CONTENT_TYPE_INVALID');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('DLKT_INFO_SERVICE_RESPONSE_TOO_LARGE');
  if (!response.ok) throw new Error(`DLKT_INFO_SERVICE_RPC_HTTP_${response.status}`);
  try { return JSON.parse(text) as unknown; } catch { throw new Error('DLKT_INFO_SERVICE_RESPONSE_INVALID'); }
}

export class SupabaseServiceRpcTransport implements RpcTransport {
  readonly #configuration: ReadyServiceConfiguration;
  readonly #fetch: ServiceFetch;

  constructor(configuration: ReadyServiceConfiguration, fetchImplementation: ServiceFetch = fetch) {
    this.#configuration = configuration;
    this.#fetch = fetchImplementation;
  }

  async call(functionName: string, parameters: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (!SERVICE_RPC.has(functionName)) throw new Error('DLKT_INFO_SERVICE_RPC_NOT_ALLOWED');
    const body = JSON.stringify(parameters);
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new Error('DLKT_INFO_SERVICE_REQUEST_TOO_LARGE');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.#fetch(
        `${this.#configuration.persistence.url}/rest/v1/rpc/${functionName}`,
        {
          method: 'POST',
          headers: {
            apikey: this.#configuration.secretKey,
            'Content-Type': 'application/json',
            'X-Client-Info': 'dlkt-info-service/0.8.8',
          },
          body,
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        },
      );
      return await readBoundedJson(response);
    } finally {
      clearTimeout(timeout);
    }
  }
}
