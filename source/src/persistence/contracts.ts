import type { CompanionPreferences } from '../companion/contracts.js';
import type { TrustPolicy } from '../trust/contracts.js';

export const PERSISTENCE_ADAPTER_VERSION = 'dlkt-info-persistence-2' as const;
export const PERSISTENCE_MIGRATION = '20261111213000_dlkt_info_companion_persistence' as const;
export const COMPANION_ENTITIES_MIGRATION = '20261112221500_dlkt_info_companion_entities' as const;
export const ACTIVATION_HANDOFF_MIGRATION = '20261112233000_dlkt_info_activation_account_handoff' as const;
export const PERSISTENCE_REQUEST_MARKER = 'persistence-v1' as const;
export const PERSISTENCE_ENVIRONMENT_KEYS = Object.freeze([
  'DLKT_INFO_SUPABASE_PROJECT_REF',
  'DLKT_INFO_SUPABASE_URL',
  'DLKT_INFO_SUPABASE_PUBLISHABLE_KEY',
  'DLKT_INFO_DATA_FOUNDATION_READY',
  'DLKT_INFO_AUTH_ENABLED',
  'DLKT_INFO_REAL_DATA_ENABLED',
  'DLKT_INFO_SOURCE_ACQUISITION_ENABLED',
  'DLKT_INFO_DELIVERY_WORKERS_ENABLED',
] as const);

export type PersistenceConfigurationState = 'missing' | 'invalid' | 'ready';

export interface MissingPersistenceConfiguration {
  readonly state: 'missing';
  readonly code: 'DLKT_INFO_SUPABASE_NOT_CONFIGURED';
}

export interface InvalidPersistenceConfiguration {
  readonly state: 'invalid';
  readonly code: string;
}

export interface ReadyPersistenceConfiguration {
  readonly state: 'ready';
  readonly projectRef: string;
  readonly url: string;
  readonly publishableKey: string;
  readonly foundationReady: boolean;
  readonly authEnabled: boolean;
  readonly realDataEnabled: boolean;
  readonly sourceAcquisitionEnabled: boolean;
  readonly deliveryWorkersEnabled: boolean;
}

export type PersistenceConfiguration =
  | MissingPersistenceConfiguration
  | InvalidPersistenceConfiguration
  | ReadyPersistenceConfiguration;

export interface PersistenceRuntimeProjection {
  readonly adapterVersion: typeof PERSISTENCE_ADAPTER_VERSION;
  readonly configuration: PersistenceConfigurationState;
  readonly configured: boolean;
  readonly provisioned: boolean;
  readonly authEnabled: boolean;
  readonly realDataEnabled: boolean;
  readonly sourceAcquisitionEnabled: boolean;
  readonly deliveryWorkersEnabled: boolean;
  readonly blocker: string | null;
}

export interface SaveCompanionConfigurationInput extends CompanionPreferences {
  readonly briefingId: string | null;
  readonly trustPolicy: TrustPolicy;
}

export interface CompanionPersistenceProjection {
  readonly version: typeof PERSISTENCE_ADAPTER_VERSION;
  readonly profile: {
    readonly locale: string;
    readonly timezone: string;
    readonly plan: 'free' | 'pro' | 'business' | 'internal';
    readonly onboardingState: 'new' | 'configured' | 'active' | 'paused';
  };
  readonly briefing: null | {
    readonly id: string;
    readonly name: string;
    readonly timezone: string;
    readonly deliveryLocalTime: string;
    readonly weekdays: readonly number[];
    readonly maxCards: number;
    readonly status: 'draft' | 'active' | 'paused' | 'archived';
    readonly version: number;
    readonly nextDeliveryAt: string | null;
  };
  readonly trustPolicy: TrustPolicy | null;
  readonly rule: null | {
    readonly topics: readonly string[];
    readonly entities: readonly string[];
    readonly minMateriality: 'low' | 'medium' | 'high' | 'critical';
    readonly onlyActionable: boolean;
  };
}

export type PersistenceFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
