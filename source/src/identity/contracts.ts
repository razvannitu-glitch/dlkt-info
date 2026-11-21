import type { IncomingMessage, ServerResponse } from 'node:http';

export const IDENTITY_VERSION = 'dlkt-info-identity-1' as const;
export const IDENTITY_REQUEST_MARKER = 'identity-v1' as const;
export const ACCESS_COOKIE = '__Host-dlkt_info_at' as const;
export const REFRESH_COOKIE = '__Host-dlkt_info_rt' as const;

export type IdentityFetch = typeof fetch;

export interface IdentityUser {
  readonly id: string;
  readonly email: string;
}

export interface IdentitySessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly user: IdentityUser;
}

export interface ResolvedIdentitySession {
  readonly accessToken: string;
  readonly user: IdentityUser;
  readonly refreshed: boolean;
}

export interface IdentityRuntimeProjection {
  readonly version: typeof IDENTITY_VERSION;
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly authenticated: boolean;
  readonly blocker: string | null;
  readonly user: IdentityUser | null;
}

export interface IdentityRequestDependencies {
  readonly fetch?: IdentityFetch;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => number;
}

export interface NodeRequest extends IncomingMessage {}
export interface NodeResponse extends ServerResponse {}
