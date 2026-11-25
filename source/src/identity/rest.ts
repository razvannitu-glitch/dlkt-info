import {authenticationEmailRedirect} from './email-locale.js';
import type { ReadyPersistenceConfiguration } from '../persistence/contracts.js';
import type { IdentityFetch, IdentitySessionTokens, IdentityUser } from './contracts.js';
import { readIdentitySessionTokens, readIdentityUser } from './guards.js';

const MAX_RESPONSE_BYTES = 131_072;
const TIMEOUT_MS = 8_000;

async function readBoundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel();
    throw new Error('DLKT_INFO_IDENTITY_RESPONSE_TOO_LARGE');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    await response.body?.cancel();
    throw new Error('DLKT_INFO_IDENTITY_RESPONSE_CONTENT_TYPE_INVALID');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('DLKT_INFO_IDENTITY_RESPONSE_INVALID');
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      receivedBytes += part.value.byteLength;
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('DLKT_INFO_IDENTITY_RESPONSE_TOO_LARGE');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!response.ok) throw new Error(`DLKT_INFO_IDENTITY_HTTP_${response.status}`);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new Error('DLKT_INFO_IDENTITY_RESPONSE_INVALID'); }
}
export class SupabaseIdentityTransport {
  readonly #configuration: ReadyPersistenceConfiguration;
  readonly #fetch: IdentityFetch;

  constructor(configuration: ReadyPersistenceConfiguration, fetchImplementation: IdentityFetch = fetch) {
    this.#configuration = configuration;
    this.#fetch = fetchImplementation;
  }

  async #request(path: string, init: RequestInit, allowEmpty = false): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.#fetch(`${this.#configuration.url}${path}`, {
        ...init,
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          apikey: this.#configuration.publishableKey,
          ...(init.headers ?? {}),
        },
      });
      if (allowEmpty && response.ok && (response.status === 204 || response.headers.get('content-length') === '0')) return null;
      return await readBoundedJson(response);
    } finally {
      clearTimeout(timeout);
    }
  }

  async requestCode(email: string, metadata: { readonly locale: string; readonly timezone: string }): Promise<void> {
    // The fixed first-party redirect carries current-request language to the hosted
    // OTP template. No user-supplied destination and no sign-in link is rendered.
    const redirect=authenticationEmailRedirect(metadata.locale);
    await this.#request('/auth/v1/otp?redirect_to='+encodeURIComponent(redirect), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        create_user: true,
        data: { locale: metadata.locale, timezone: metadata.timezone },
      }),
    });
  }

  async verifyCode(email: string, token: string): Promise<IdentitySessionTokens> {
    return readIdentitySessionTokens(await this.#request('/auth/v1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token, type: 'email' }),
    }));
  }

  async refresh(refreshToken: string): Promise<IdentitySessionTokens> {
    return readIdentitySessionTokens(await this.#request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }));
  }

  async user(accessToken: string): Promise<IdentityUser> {
    return readIdentityUser(await this.#request('/auth/v1/user', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }));
  }

  async logout(accessToken: string): Promise<void> {
    await this.#request('/auth/v1/logout?scope=local', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, true);
  }
}

export function isIdentityUnauthorized(error: unknown): boolean {
  return error instanceof Error && /^DLKT_INFO_IDENTITY_HTTP_(?:400|401|403)$/u.test(error.message);
}
