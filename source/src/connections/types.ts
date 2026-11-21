import type {WalletProviderId} from '../wallet/providers.js';
import type {PersonalEvent} from '../wallet/events.js';

export const CONNECTIONS_VERSION = 'dlkt-info-connections-1';
/** Microsoft personal accounts require a registered redirect URI without query parameters. */
export function connectionCallbackPath(providerId: WalletProviderId): string {
  return providerId === 'outlook' ? '/api/connections' : `/api/connections?provider=${providerId}`;
}
export interface ProviderConfiguration {
  readonly providerId: WalletProviderId;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly graphVersion: string | null;
}
export interface ProviderResource {
  readonly id: string;
  readonly label: string;
  readonly accessToken: string | null;
}
export interface ProviderGrant {
  readonly accountId: string;
  readonly accountLabel: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string;
  readonly scopes: readonly string[];
  readonly resources: readonly ProviderResource[];
}
export interface ProviderDependencies {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}
export interface ProviderSync {
  readonly events: readonly PersonalEvent[];
  readonly state: 'available' | 'partial';
  readonly checkedAt: string;
}
export type ConnectionState = 'connected' | 'reconnect-required';
export interface StoredConnection {
  readonly id: string;
  readonly ownerId: string;
  readonly providerId: WalletProviderId;
  readonly accountLabel: string;
  readonly status: ConnectionState;
  readonly sealedGrant: string;
  readonly connectedAt: string;
  readonly lastSyncAt: string | null;
  readonly revision: string;
  readonly operationExpiresAt: string | null;
}
export interface PendingAuthorization {
  readonly stateHash: string;
  readonly ownerId: string;
  readonly sessionHash: string;
  readonly providerId: WalletProviderId;
  readonly sealedVerifier: string;
  readonly expiresAt: string;
}
export interface ConnectionStore {
  list(): Promise<readonly StoredConnection[]>;
  read(providerId: WalletProviderId): Promise<StoredConnection | null>;
  save(value: StoredConnection, expectedRevision: string | null): Promise<void>;
  remove(providerId: WalletProviderId, expectedRevision: string): Promise<void>;
  createAuthorization(value: PendingAuthorization): Promise<void>;
  consumeAuthorization(stateHash: string): Promise<PendingAuthorization | null>;
}
export interface ConnectionSummary {
  readonly id: string;
  readonly accountLabel: string;
  readonly connectedAt: string;
  readonly lastSyncAt: string | null;
  readonly status: ConnectionState;
}
export interface ConnectionProviderView {
  readonly providerId: WalletProviderId;
  readonly status: 'unavailable' | 'available' | ConnectionState;
  readonly connection: ConnectionSummary | null;
}
export interface ConnectionsSnapshot {
  readonly version: typeof CONNECTIONS_VERSION;
  readonly providers: readonly ConnectionProviderView[];
}
