import type {IncomingMessage, ServerResponse} from 'node:http';
import {bodyJson, noQuery, respond, sameOrigin, type Environment} from '../src/account/http.js';
import {accountReadiness} from '../src/account/readiness.js';
import {isRecord} from '../src/data/guards.js';
import {resolveIdentitySession} from '../src/identity/session.js';
import type {ProvisioningProjection} from '../src/provisioning/index.js';
import {isWalletProviderId, type WalletProviderId} from '../src/wallet/providers.js';
import {connectionOrigin, PROVIDER_IDS} from '../src/connections/config.js';
import {verifiedSessionHash} from '../src/connections/crypto.js';
import {ConnectionError, ConnectionService, type ProviderOperations} from '../src/connections/service.js';
import {SupabaseConnectionStore} from '../src/connections/store.js';
import {CONNECTIONS_VERSION} from '../src/connections/types.js';
import type {ConnectionStore} from '../src/connections/types.js';
import type {ReadyPersistenceConfiguration} from '../src/persistence/contracts.js';

interface Dependencies {
  readonly environment?: Environment;
  readonly fetch?: typeof fetch;
  readonly provisioning?: ProvisioningProjection;
  readonly now?: () => Date;
  readonly drivers?: ProviderOperations;
  readonly storeFactory?: (configuration: ReadyPersistenceConfiguration, ownerId: string, accessToken: string, request: typeof fetch) => ConnectionStore;
}
const cookieName = (providerId: WalletProviderId): string => `__Host-dlkt_connection_${providerId.replaceAll('-', '_')}`;
function stateCookie(request: IncomingMessage, providerId: WalletProviderId): string {
  const name = cookieName(providerId), values = (request.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  return values.length === 1 ? (values[0]?.slice(name.length + 1) ?? '') : '';
}
function setStateCookie(response: ServerResponse, providerId: WalletProviderId, state: string | null): void {
  const existing = response.getHeader('Set-Cookie');
  const cookies = Array.isArray(existing) ? existing.map(String) : existing === undefined ? [] : [String(existing)];
  cookies.push(`${cookieName(providerId)}=${state ?? ''}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${state ? '600' : '0'}`);
  response.setHeader('Set-Cookie', cookies);
}
function redirect(response: ServerResponse, outcome: 'connected' | 'cancelled' | 'expired' | 'failed'): void {
  response.statusCode = 303;
  response.setHeader('Location', `/wallet?connection=${outcome}`);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Vary', 'Cookie, Origin');
  response.end();
}
function parseCallback(req: IncomingMessage): {providerId: WalletProviderId; state: string; code: string | null; denied: boolean} {
  if ((req.url?.length ?? 0) > 8192 || req.method !== 'GET') throw new Error('CONNECTION_INPUT_INVALID');
  const url = new URL(req.url ?? '', 'https://www.dlkt.ee');
  const allowed = new Set(['provider', 'state', 'code', 'error', 'error_description', 'error_uri', 'scope', 'authuser', 'prompt', 'iss', 'session_state']);
  const keys = [...url.searchParams.keys()];
  if (url.pathname !== '/api/connections' || url.hash || keys.some(key => !allowed.has(key)) || new Set(keys).size !== keys.length) throw new Error('CONNECTION_INPUT_INVALID');
  // Only Outlook owns the queryless registered callback. The provider-specific
  // cookie and stored authorization still bind owner, session and one-time state.
  const explicitProvider = url.searchParams.get('provider');
  if (explicitProvider === 'outlook') throw new Error('CONNECTION_INPUT_INVALID');
  const providerId = explicitProvider ?? 'outlook', state = url.searchParams.get('state') ?? '', code = url.searchParams.get('code'), error = url.searchParams.get('error');
  if (!isWalletProviderId(providerId) || !/^[A-Za-z0-9_-]{43}$/u.test(state) || (code !== null && error !== null) || (code === null && error === null) || (code !== null && (code.length < 1 || code.length > 4096 || /[\u0000-\u0020\u007f]/u.test(code)))) throw new Error('CONNECTION_INPUT_INVALID');
  return {providerId, state, code, denied: error === 'access_denied'};
}
function unavailableSnapshot(): unknown {
  return {version: CONNECTIONS_VERSION, providers: PROVIDER_IDS.map(providerId => ({providerId, status: 'unavailable', connection: null}))};
}

export async function handleConnections(req: IncomingMessage, res: ServerResponse, deps: Dependencies = {}): Promise<void> {
  const environment = deps.environment ?? process.env;
  if (!['GET', 'POST'].includes(req.method ?? '')) { respond(res, 405, {error: 'METHOD_NOT_ALLOWED'}); return; }
  const callback = req.method === 'GET' && !noQuery(req);
  let callbackProvider: WalletProviderId | null = null;
  const finish = (outcome: 'connected' | 'cancelled' | 'expired' | 'failed'): void => {
    if (callbackProvider) setStateCookie(res, callbackProvider, null);
    redirect(res, outcome);
  };
  try {
    const host = typeof req.headers.host === 'string' ? req.headers.host.toLowerCase() : '';
    const origin = connectionOrigin(environment, host);
    const callbackData = callback ? parseCallback(req) : null;
    callbackProvider = callbackData?.providerId ?? null;
    if (callbackData) {
      if (!origin || (req.headers['x-forwarded-proto'] !== undefined && req.headers['x-forwarded-proto'] !== 'https')) { finish('failed'); return; }
    } else {
      if (!noQuery(req)) { respond(res, 400, {error: 'QUERY_NOT_ALLOWED'}); return; }
      if (!sameOrigin(req, 'connections-v1', environment)) { respond(res, 403, {error: 'ORIGIN_REJECTED'}); return; }
    }
    const request = deps.fetch ?? fetch, readiness = await accountReadiness(environment, request, deps.provisioning);
    if (!readiness.enabled || readiness.configuration.state !== 'ready') {
      if (callback) finish('failed');
      else respond(res, req.method === 'GET' ? 200 : 503, req.method === 'GET' ? unavailableSnapshot() : {error: 'CONNECTION_UNAVAILABLE'});
      return;
    }
    const session = await resolveIdentitySession(req, res, readiness.configuration, request);
    if (!session) {
      if (callback) finish('expired'); else respond(res, 401, {error: 'AUTHENTICATION_REQUIRED'});
      return;
    }
    const sessionHash = verifiedSessionHash(session.accessToken, session.user.id);
    const store = deps.storeFactory ? deps.storeFactory(readiness.configuration, session.user.id, session.accessToken, request) : new SupabaseConnectionStore(readiness.configuration, session.user.id, session.accessToken, request);
    const service = new ConnectionService(session.user.id, sessionHash, store, environment, origin, {fetchImpl: request, ...(deps.now ? {now: deps.now} : {}), ...(deps.drivers ? {drivers: deps.drivers} : {})});
    if (callbackData) {
      await service.complete(callbackData.providerId, callbackData.state, stateCookie(req, callbackData.providerId), callbackData.code, callbackData.denied);
      finish('connected'); return;
    }
    if (req.method === 'GET') { respond(res, 200, await service.snapshot()); return; }
    const body = await bodyJson(req, 2048);
    if (!isRecord(body) || Object.keys(body).sort().join(',') !== 'action,providerId' || !isWalletProviderId(body.providerId) || typeof body.action !== 'string' || !['connect', 'sync', 'disconnect'].includes(body.action)) throw new Error('CONNECTION_INPUT_INVALID');
    if (body.action === 'connect') {
      const result = await service.begin(body.providerId);
      setStateCookie(res, body.providerId, result.state);
      respond(res, 200, {authorizationUrl: result.authorizationUrl});
    } else if (body.action === 'sync') { respond(res, 200, await service.sync(body.providerId)); }
    else { respond(res, 200, await service.disconnect(body.providerId)); }
  } catch (error) {
    if (callback) {
      const code = error instanceof ConnectionError ? error.code : '';
      finish(code === 'CONNECTION_CANCELLED' ? 'cancelled' : code === 'CONNECTION_STATE_EXPIRED' || (error instanceof Error && error.message === 'CONNECTION_SESSION_INVALID') ? 'expired' : 'failed');
      return;
    }
    const code = error instanceof Error ? error.message : '';
    const status = ['CONNECTION_CONFLICT', 'CONNECTION_BUSY'].includes(code) ? 409
      : ['CONNECTION_SESSION_INVALID'].includes(code) ? 401
        : code === 'CONNECTION_FORBIDDEN' ? 403
          : code === 'CONTENT_TYPE_REQUIRED' ? 415
            : code === 'BODY_TOO_LARGE' ? 413
              : ['CONNECTION_INPUT_INVALID', 'BODY_EMPTY'].includes(code) || error instanceof SyntaxError ? 400
                : code === 'CONNECTION_NOT_FOUND' ? 404
                  : code === 'CONNECTION_RECONNECT_REQUIRED' ? 409
                    : code === 'CONNECTION_UNAVAILABLE' ? 503 : 502;
    respond(res, status, {error: status === 502 ? 'CONNECTION_UPSTREAM_UNAVAILABLE' : status === 400 ? 'CONNECTION_INPUT_INVALID' : code});
  }
}

export default handleConnections;
