import type {IncomingMessage, ServerResponse} from 'node:http';
import {bodyJson, noQuery, respond, sameOrigin, type Environment} from '../src/account/http.js';
import {accountReadiness} from '../src/account/readiness.js';
import {isRecord, isUuid} from '../src/data/guards.js';
import {resolveIdentitySession} from '../src/identity/session.js';
import type {ProvisioningProjection} from '../src/provisioning/index.js';
import {
  WALLET_PROFILE_MAX_BYTES, isWalletRevision, parseWalletProfile, walletSnapshot,
} from '../src/wallet/contracts.js';
import {WalletProfileStore} from '../src/wallet/store.js';

export async function handleWallet(
  req: IncomingMessage,
  res: ServerResponse,
  deps: {environment?: Environment; fetch?: typeof fetch; provisioning?: ProvisioningProjection} = {},
): Promise<void> {
  const environment = deps.environment ?? process.env;
  if (!['GET', 'PUT', 'DELETE'].includes(req.method ?? '')) {
    respond(res, 405, {error: 'METHOD_NOT_ALLOWED'});
    return;
  }
  if (!noQuery(req)) {
    respond(res, 400, {error: 'QUERY_NOT_ALLOWED'});
    return;
  }
  if (!sameOrigin(req, 'wallet-v1', environment)) {
    respond(res, 403, {error: 'ORIGIN_REJECTED'});
    return;
  }
  try {
    const expectedOwner = req.headers['x-dlkt-info-owner'];
    if (expectedOwner !== undefined && !isUuid(expectedOwner)) throw new Error('WALLET_OWNER_INVALID');
    const request = deps.fetch ?? fetch;
    const readiness = await accountReadiness(environment, request, deps.provisioning);
    if (!readiness.enabled || readiness.configuration.state !== 'ready') {
      respond(res, req.method === 'GET' ? 200 : 503,
        req.method === 'GET' ? walletSnapshot('unavailable') : {error: 'WALLET_UNAVAILABLE'});
      return;
    }
    const session = await resolveIdentitySession(req, res, readiness.configuration, request);
    if (!session) {
      respond(res, req.method === 'GET' ? 200 : 401,
        req.method === 'GET' ? walletSnapshot('signed-out') : {error: 'AUTHENTICATION_REQUIRED'});
      return;
    }
    // Bind a new client's operation to the account it verified; a silent cookie change must not retarget it.
    if (expectedOwner !== undefined && expectedOwner.toLowerCase() !== session.user.id.toLowerCase()) {
      throw new Error('WALLET_OWNER_CHANGED');
    }
    const store = new WalletProfileStore(readiness.configuration, session.user.id, session.accessToken, request);
    if (req.method === 'GET') {
      respond(res, 200, walletSnapshot('signed-in', await store.read()));
      return;
    }
    const body = await bodyJson(req, WALLET_PROFILE_MAX_BYTES);
    if (!isRecord(body)) throw new Error('WALLET_INPUT_INVALID');
    if (req.method === 'DELETE') {
      if (Object.keys(body).join(',') !== 'expectedRevision' || !isWalletRevision(body.expectedRevision)) {
        throw new Error('WALLET_INPUT_INVALID');
      }
      await store.remove(body.expectedRevision);
      respond(res, 200, walletSnapshot('signed-in'));
      return;
    }
    if (Object.keys(body).sort().join(',') !== 'expectedRevision,value'
      || (body.expectedRevision !== null && !isWalletRevision(body.expectedRevision))) {
      throw new Error('WALLET_INPUT_INVALID');
    }
    const profile = await store.save(parseWalletProfile(body.value), body.expectedRevision);
    respond(res, 200, walletSnapshot('signed-in', profile));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const invalidInput = ['WALLET_INPUT_INVALID', 'WALLET_PROFILE_INVALID', 'WALLET_REVISION_INVALID', 'WALLET_OWNER_INVALID', 'BODY_EMPTY'].includes(message);
    const status = message === 'WALLET_CONFLICT' || message === 'WALLET_OWNER_CHANGED' ? 409
      : message === 'WALLET_SESSION_INVALID' ? 401
        : message === 'WALLET_FORBIDDEN' ? 403
          : message === 'CONTENT_TYPE_REQUIRED' ? 415
            : message === 'BODY_TOO_LARGE' || message === 'WALLET_PROFILE_TOO_LARGE' ? 413
              : invalidInput || error instanceof SyntaxError ? 400 : 502;
    respond(res, status, {error: status === 502 ? 'WALLET_UPSTREAM_UNAVAILABLE'
      : error instanceof SyntaxError ? 'WALLET_INPUT_INVALID' : message || 'WALLET_INPUT_INVALID'});
  }
}

export default handleWallet;
