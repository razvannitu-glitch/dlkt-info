import type {
  PersistenceFetch,
  ReadyPersistenceConfiguration,
} from './contracts.js';

const USER_RPC = new Set([
  'dlkt_info_read_companion_configuration',
  'dlkt_info_save_companion_configuration',
]);
const TOKEN = /^[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,2048}$/u;
const MAX_RESPONSE_BYTES = 524_288;
const TIMEOUT_MS = 8_000;

export function readBearerToken(value: string | string[] | undefined): string | null {
  const header = Array.isArray(value) ? value[0] : value;
  if (!header || header.length > 8200 || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  return TOKEN.test(token) ? token : null;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    throw new Error('DLKT_INFO_SUPABASE_RESPONSE_TOO_LARGE');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) throw new Error('DLKT_INFO_SUPABASE_RESPONSE_CONTENT_TYPE_INVALID');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('DLKT_INFO_SUPABASE_RESPONSE_TOO_LARGE');
  if (!response.ok) throw new Error(`DLKT_INFO_SUPABASE_RPC_HTTP_${response.status}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('DLKT_INFO_SUPABASE_RESPONSE_INVALID');
  }
}

export class SupabaseUserRpcTransport {
  readonly #configuration: ReadyPersistenceConfiguration;
  readonly #fetch: PersistenceFetch;

  constructor(configuration: ReadyPersistenceConfiguration, fetchImplementation: PersistenceFetch = fetch) {
    this.#configuration = configuration;
    this.#fetch = fetchImplementation;
  }

  async call(functionName: string, parameters: Readonly<Record<string, unknown>>, accessToken: string): Promise<unknown> {
    if (!USER_RPC.has(functionName)) throw new Error('DLKT_INFO_SUPABASE_RPC_FORBIDDEN');
    if (!TOKEN.test(accessToken)) throw new Error('DLKT_INFO_ACCESS_TOKEN_INVALID');
    const response = await this.#fetch(`${this.#configuration.url}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apikey: this.#configuration.publishableKey,
        Authorization: `Bearer ${accessToken}`,
        'X-Client-Info': 'dlkt-info/0.8.8',
      },
      body: JSON.stringify(parameters),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return readBoundedJson(response);
  }
}
