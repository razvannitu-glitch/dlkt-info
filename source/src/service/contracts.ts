import type { PersistenceFetch, ReadyPersistenceConfiguration } from '../persistence/contracts.js';

export const SERVICE_CONFIGURATION_VERSION = 'dlkt-info-service-1' as const;
export const SERVICE_ENVIRONMENT_KEYS = Object.freeze([
  'DLKT_INFO_SUPABASE_SECRET_KEY',
  'CRON_SECRET',
] as const);

export interface ReadyServiceConfiguration {
  readonly state: 'ready';
  readonly persistence: ReadyPersistenceConfiguration;
  readonly secretKey: string;
  readonly cronSecret: string;
}

export type ServiceConfiguration =
  | ReadyServiceConfiguration
  | Readonly<{ state: 'missing' | 'invalid'; code: string }>;

export type ServiceFetch = PersistenceFetch;
