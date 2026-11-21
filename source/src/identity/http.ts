import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  IDENTITY_REQUEST_MARKER,
  IDENTITY_VERSION,
  SupabaseIdentityTransport,
  normalizeIdentityEmail,
  readIdentityLocale,
  readIdentityOtp,
  readIdentityTimezone,
  resolveIdentitySession,
  signOutIdentitySession,
  writeIdentityCookies,
  type IdentityFetch,
} from './index.js';
import { readPersistenceConfiguration } from '../persistence/index.js';
import { projectProvisioningControl, type ProvisioningProjection } from '../provisioning/index.js';

const MAX_BODY_BYTES = 4096;
const HOST = /^[a-z0-9.-]+(?::\d+)?$/iu;
const PROTOCOL = /^(?:https|http)$/u;
const REQUEST_KEYS = new Set(['action', 'email', 'timezone', 'locale']);
const VERIFY_KEYS = new Set(['action', 'email', 'code']);

type Dependencies = {
  readonly fetch?: IdentityFetch;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly provisioning?: ProvisioningProjection;
};

const firstHeader = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '').split(',')[0]?.trim() ?? '';

function trustedFetchMetadata(request: IncomingMessage): boolean {
  return firstHeader(request.headers['sec-fetch-site']).toLowerCase() === 'same-origin'
    && ['cors', 'same-origin'].includes(firstHeader(request.headers['sec-fetch-mode']).toLowerCase())
    && firstHeader(request.headers['sec-fetch-dest']).toLowerCase() === 'empty';
}

function isSameOrigin(request: IncomingMessage): boolean {
  const marker = firstHeader(request.headers['x-dlkt-info-request']);
  const host = firstHeader(request.headers['x-forwarded-host']) || firstHeader(request.headers.host);
  const protocol = (firstHeader(request.headers['x-forwarded-proto']) || 'https').toLowerCase();
  if (marker !== IDENTITY_REQUEST_MARKER || !HOST.test(host) || !PROTOCOL.test(protocol)) return false;
  const origin = firstHeader(request.headers.origin);
  if (!origin) return trustedFetchMetadata(request);
  try { return new URL(origin).origin === `${protocol}://${host}`; } catch { return false; }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  if (size === 0) throw new Error('BODY_EMPTY');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function exactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Vary', 'Cookie, Origin');
  response.end(JSON.stringify(body));
}

function upstreamFailure(error: unknown): { readonly status: number; readonly code: string } {
  if (error instanceof Error && /^DLKT_INFO_IDENTITY_HTTP_429$/u.test(error.message)) {
    return { status: 429, code: 'IDENTITY_RATE_LIMITED' };
  }
  if (error instanceof Error && /^DLKT_INFO_IDENTITY_HTTP_(?:400|401|403)$/u.test(error.message)) {
    return { status: 400, code: 'IDENTITY_VERIFICATION_FAILED' };
  }
  return { status: 502, code: 'IDENTITY_PROVIDER_UNAVAILABLE' };
}

export async function handleIdentityRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: Dependencies = {},
): Promise<void> {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method ?? '')) {
    response.setHeader('Allow', 'GET, POST, PUT, DELETE');
    respond(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  if (!isSameOrigin(request)) {
    respond(response, 403, { error: 'INVALID_REQUEST_ORIGIN' });
    return;
  }

  const environment = dependencies.environment ?? process.env;
  const configuration = readPersistenceConfiguration(environment);
  const provisioning = dependencies.provisioning ?? await projectProvisioningControl({
    environment,
    fetch: dependencies.fetch ?? fetch,
  });
  const configured = configuration.state === 'ready' && provisioning.configured;
  const blocker = configuration.state === 'missing'
    ? 'DEDICATED_SUPABASE_PROJECT_REQUIRED'
    : configuration.state === 'invalid'
      ? configuration.code
      : provisioning.blocker;
  const enabled = configuration.state === 'ready' && provisioning.capabilities.auth;

  if (request.method === 'GET') {
    if (!enabled || configuration.state !== 'ready') {
      respond(response, 200, {
        version: IDENTITY_VERSION,
        configured,
        enabled: false,
        authenticated: false,
        blocker,
        user: null,
      });
      return;
    }
    try {
      const session = await resolveIdentitySession(request, response, configuration, dependencies.fetch ?? fetch);
      respond(response, 200, {
        version: IDENTITY_VERSION,
        configured: true,
        enabled: true,
        authenticated: session !== null,
        blocker: null,
        user: session?.user ?? null,
      });
    } catch {
      respond(response, 502, { error: 'IDENTITY_PROVIDER_UNAVAILABLE' });
    }
    return;
  }

  if (!enabled || configuration.state !== 'ready') {
    respond(response, 503, { error: 'IDENTITY_NOT_PROVISIONED', reason: blocker });
    return;
  }

  const transport = new SupabaseIdentityTransport(configuration, dependencies.fetch ?? fetch);

  if (request.method === 'DELETE') {
    try {
      await signOutIdentitySession(request, response, configuration, dependencies.fetch ?? fetch);
    } catch { /* Cookies are cleared even when provider revocation cannot be confirmed. */ }
    respond(response, 200, {
      version: IDENTITY_VERSION,
      configured: true,
      enabled: true,
      authenticated: false,
      blocker: null,
      user: null,
    });
    return;
  }

  if (!/^application\/json(?:\s*;|$)/iu.test(firstHeader(request.headers['content-type']))) {
    respond(response, 415, { error: 'CONTENT_TYPE_REQUIRED' });
    return;
  }

  try {
    const body = await readJson(request);
    if (!isRecord(body)) throw new Error('IDENTITY_INPUT_INVALID');

    if (request.method === 'POST') {
      if (!exactKeys(body, REQUEST_KEYS) || body.action !== 'request-code') throw new Error('IDENTITY_INPUT_INVALID');
      const email = normalizeIdentityEmail(body.email);
      const timezone = readIdentityTimezone(body.timezone);
      const locale = readIdentityLocale(body.locale);
      await transport.requestCode(email, { timezone, locale });
      respond(response, 202, {
        version: IDENTITY_VERSION,
        configured: true,
        enabled: true,
        authenticated: false,
        blocker: null,
        user: null,
        challenge: 'code-sent',
      });
      return;
    }

    if (!exactKeys(body, VERIFY_KEYS) || body.action !== 'verify-code') throw new Error('IDENTITY_INPUT_INVALID');
    const email = normalizeIdentityEmail(body.email);
    const code = readIdentityOtp(body.code);
    const tokens = await transport.verifyCode(email, code);
    writeIdentityCookies(response, tokens);
    respond(response, 200, {
      version: IDENTITY_VERSION,
      configured: true,
      enabled: true,
      authenticated: true,
      blocker: null,
      user: tokens.user,
    });
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && [
      'BODY_TOO_LARGE', 'BODY_EMPTY', 'IDENTITY_INPUT_INVALID',
      'DLKT_INFO_EMAIL_INVALID', 'DLKT_INFO_OTP_INVALID',
    ].includes(error.message))) {
      respond(response, 400, { error: 'IDENTITY_INPUT_INVALID' });
      return;
    }
    const failure = upstreamFailure(error);
    respond(response, failure.status, { error: failure.code });
  }
}

export default async function auth(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleIdentityRequest(request, response);
}
