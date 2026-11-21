/** Server-only transport. Never surface upstream text, request URLs or credentials. */
import {Buffer} from 'node:buffer';
import {isRecord} from '../data/guards.js';
import type {ProviderDependencies} from './types.js';

export type ProviderErrorCode = 'configuration' | 'authorization' | 'scope-denied' | 'invalid-response' | 'rate-limited' | 'upstream' | 'timeout' | 'network' | 'reauthorization-required';
export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode) { super(`CONNECTION_PROVIDER_${code.toUpperCase().replaceAll('-', '_')}`); this.name = 'ProviderError'; }
}
export function fail(code: ProviderErrorCode = 'invalid-response'): never { throw new ProviderError(code); }
export function record(value: unknown): Record<string, unknown> { if (!isRecord(value)) fail(); return value; }
export function plain(value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail();
  return value;
}
export function secret(value: unknown): string {
  const token = plain(value, 8192);
  if (!/^[\x21-\x7e]+$/u.test(token)) fail();
  return token;
}
export function numericId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,64}$/u.test(value)) fail();
  return value;
}
export function instant(now?: () => Date): string {
  const date = (now ?? (() => new Date()))();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('configuration');
  return date.toISOString();
}
function allowed(url: URL, method: string): boolean {
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return false;
  const path = url.pathname;
  if (url.hostname === 'oauth2.googleapis.com') return method === 'POST' && ['/token', '/revoke'].includes(path);
  if (url.hostname === 'openidconnect.googleapis.com') return method === 'GET' && path === '/v1/userinfo';
  if (url.hostname === 'login.microsoftonline.com') return method === 'POST' && path === '/common/oauth2/v2.0/token';
  if (url.hostname === 'graph.microsoft.com') return method === 'GET' && ['/v1.0/me', '/v1.0/me/mailFolders/inbox/messages'].includes(path);
  if (url.hostname === 'api.instagram.com') return method === 'POST' && path === '/oauth/access_token';
  if (url.hostname === 'graph.instagram.com') return method === 'GET' && (['/access_token', '/refresh_access_token'].includes(path) || /^\/v\d{1,2}\.\d{1,2}\/(?:me|\d{1,64})(?:\/(?:media|comments))?$/u.test(path));
  if (url.hostname === 'graph.facebook.com') {
    if (method === 'DELETE') return /^\/v\d{1,2}\.\d{1,2}\/\d{1,64}\/permissions$/u.test(path);
    return method === 'GET' && /^\/v\d{1,2}\.\d{1,2}\/(?:oauth\/access_token|me|\d{1,64}(?:_\d{1,64})?)(?:\/(?:permissions|accounts|posts|comments))?$/u.test(path);
  }
  return false;
}
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => undefined); fail('timeout'); }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener('abort', abort); reject(new ProviderError('timeout')); };
    signal.addEventListener('abort', abort, {once: true});
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, () => { signal.removeEventListener('abort', abort); reject(new ProviderError(signal.aborted ? 'timeout' : 'network')); });
  });
}
export class ProviderHttp {
  readonly #fetch: typeof fetch;
  readonly #controller = new AbortController();
  readonly #timer: ReturnType<typeof setTimeout>;
  #requests = 0;
  constructor(deps: ProviderDependencies) {
    if (typeof window !== 'undefined') fail('configuration');
    this.#fetch = deps.fetchImpl ?? fetch;
    this.#timer = setTimeout(() => this.#controller.abort(), 12_000);
  }
  close(): void { clearTimeout(this.#timer); this.#controller.abort(); }
  async request(url: URL, options: {method?: 'GET' | 'POST' | 'DELETE'; token?: string; form?: URLSearchParams; empty?: boolean} = {}): Promise<unknown> {
    const method = options.method ?? 'GET';
    if (!allowed(url, method) || ++this.#requests > 32) fail('configuration');
    const headers: Record<string, string> = {Accept: 'application/json'};
    if (options.token !== undefined) headers.Authorization = `Bearer ${secret(options.token)}`;
    if (options.form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const signal = this.#controller.signal;
    const response = await bounded(Promise.resolve().then(() => this.#fetch(url, {method, headers, ...(options.form ? {body: options.form.toString()} : {}), signal, credentials: 'omit', redirect: 'error', cache: 'no-store'})).then(result => {
      if (signal.aborted) { void result.body?.cancel().catch(() => undefined); fail('timeout'); }
      return result;
    }), signal);
    if (response.redirected || (response.status >= 300 && response.status < 400) || (response.url && new URL(response.url).origin !== url.origin)) { void response.body?.cancel().catch(() => undefined); fail(); }
    if (response.status === 429) { void response.body?.cancel().catch(() => undefined); fail('rate-limited'); }
    if (response.status === 401) { void response.body?.cancel().catch(() => undefined); fail('authorization'); }
    if (options.empty && response.ok) { void response.body?.cancel().catch(() => undefined); return null; }
    const length = response.headers.get('content-length');
    const limit = response.ok ? 131_072 : 8192;
    if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '') || (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit))) { void response.body?.cancel().catch(() => undefined); fail(response.ok ? 'invalid-response' : 'upstream'); }
    const reader = response.body?.getReader();
    if (!reader) fail();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await bounded(reader.read(), signal);
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > limit) { void reader.cancel().catch(() => undefined); fail(); }
        chunks.push(part.value);
      }
    } finally { if (signal.aborted) void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))) as unknown; } catch { return fail(); }
    if (!response.ok || (isRecord(parsed) && parsed.error !== undefined)) {
      const error = isRecord(parsed) ? parsed.error : undefined;
      const code = isRecord(error) ? error.code : error;
      if ([4, 17, 32, 613].includes(code as number)) fail('rate-limited');
      if (response.status === 403 || ['invalid_grant', 'access_denied', 'invalid_token', 190, 102, 10, 200].includes(code as string | number)) fail('authorization');
      fail('upstream');
    }
    return parsed;
  }
}
