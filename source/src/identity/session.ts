import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ReadyPersistenceConfiguration } from '../persistence/contracts.js';
import {
  type IdentityFetch,
  type ResolvedIdentitySession,
} from './contracts.js';
import { clearIdentityCookies, readIdentityCookies, writeIdentityCookies } from './cookies.js';
import { SupabaseIdentityTransport, isIdentityUnauthorized } from './rest.js';

const SIGN_OUT_TIMEOUT_MS = 8_000;

/** Revoke this browser's provider session, then clear local cookies even on failure. */
export async function signOutIdentitySession(
  request: IncomingMessage,
  response: ServerResponse,
  configuration: ReadyPersistenceConfiguration,
  fetchImplementation: IdentityFetch = fetch,
): Promise<void> {
  const cookies = readIdentityCookies(request.headers.cookie);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIGN_OUT_TIMEOUT_MS);
  const transport = new SupabaseIdentityTransport(configuration, (input, init) => {
    controller.signal.throwIfAborted();
    return fetchImplementation(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal,
    });
  });

  try {
    if (cookies.accessToken) {
      try {
        await transport.logout(cookies.accessToken);
        return;
      } catch (error) {
        // Retry only a definitive authentication rejection. An outage can leave
        // revocation uncertain; do not create another session request in that case.
        if (!isIdentityUnauthorized(error) || !cookies.refreshToken) throw error;
      }
    }

    if (cookies.refreshToken) {
      const tokens = await transport.refresh(cookies.refreshToken);
      // The renewed token is used only to revoke this session. It is never
      // written back into browser cookies during sign-out.
      await transport.logout(tokens.accessToken);
    }
  } finally {
    clearTimeout(timeout);
    clearIdentityCookies(response);
  }
}

export async function resolveIdentitySession(
  request: IncomingMessage,
  response: ServerResponse,
  configuration: ReadyPersistenceConfiguration,
  fetchImplementation: IdentityFetch = fetch,
): Promise<ResolvedIdentitySession | null> {
  const cookies = readIdentityCookies(request.headers.cookie);
  const transport = new SupabaseIdentityTransport(configuration, fetchImplementation);

  if (cookies.accessToken) {
    try {
      const user = await transport.user(cookies.accessToken);
      return Object.freeze({ accessToken: cookies.accessToken, user, refreshed: false });
    } catch (error) {
      if (!isIdentityUnauthorized(error)) throw error;
    }
  }

  if (!cookies.refreshToken) {
    if (cookies.accessToken) clearIdentityCookies(response);
    return null;
  }

  try {
    const tokens = await transport.refresh(cookies.refreshToken);
    writeIdentityCookies(response, tokens);
    return Object.freeze({ accessToken: tokens.accessToken, user: tokens.user, refreshed: true });
  } catch (error) {
    if (isIdentityUnauthorized(error)) {
      clearIdentityCookies(response);
      return null;
    }
    throw error;
  }
}
