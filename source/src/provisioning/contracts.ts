import type { PersistenceConfigurationState, ReadyPersistenceConfiguration } from '../persistence/contracts.js';
import {
  DATABASE_READINESS_MIGRATION,
  DATABASE_READINESS_RPC,
  DATABASE_READINESS_VERSION,
  EXPECTED_SCHEMA_FINGERPRINT,
  SCHEMA_MANIFEST_VERSION,
} from './readiness-manifest.js';

export const PROVISIONING_CONTROL_VERSION = 'dlkt-info-provisioning-control-2' as const;
export const SYSTEM_IDENTITY_VERSION = 'dlkt-info-system-identity-1' as const;
export const SYSTEM_IDENTITY_RPC = 'dlkt_info_read_system_identity' as const;
export const PROVISIONING_IDENTITY_MIGRATION = '20261113115256_dlkt_info_provisioning_identity_guard' as const;
export const EXPECTED_PRODUCT_ID = 'dlkt-info' as const;
export const EXPECTED_ENGINE_ID = 'dlkt-info-inphocore-engine-orchestra' as const;
export const EXPECTED_DATA_FOUNDATION_VERSION = 'dlkt-info-data-1' as const;
export const EXPECTED_PERSISTENCE_VERSION = 'dlkt-info-persistence-2' as const;
export const EXPECTED_DATA_REGION = 'eu-central-1' as const;
export const PROVISIONING_INSTANCE_ENVIRONMENT_KEY = 'DLKT_INFO_DATABASE_INSTANCE_ID' as const;

export type ProvisioningIdentityState = 'not-configured' | 'unverified' | 'verified' | 'invalid' | 'unavailable';
export type DatabaseReadinessState = ProvisioningIdentityState;

export interface SystemIdentity {
  readonly version: typeof SYSTEM_IDENTITY_VERSION;
  readonly instanceId: string;
  readonly productId: typeof EXPECTED_PRODUCT_ID;
  readonly engineId: typeof EXPECTED_ENGINE_ID;
  readonly dataFoundationVersion: typeof EXPECTED_DATA_FOUNDATION_VERSION;
  readonly persistenceVersion: typeof EXPECTED_PERSISTENCE_VERSION;
  readonly schemaRevision: typeof PROVISIONING_IDENTITY_MIGRATION;
  readonly dataRegion: typeof EXPECTED_DATA_REGION;
  readonly dedicated: true;
  readonly automaticExecution: false;
  readonly publicCardsEnabled: false;
}

export interface DatabaseReadinessCounts {
  readonly relationsExpected: number;
  readonly relationsPresent: number;
  readonly relationsTotal: number;
  readonly functionsExpected: number;
  readonly functionsPresent: number;
  readonly functionsTotal: number;
  readonly rlsExpected: number;
  readonly rlsPresent: number;
  readonly rlsTotal: number;
  readonly policiesExpected: number;
  readonly policiesPresent: number;
  readonly policiesTotal: number;
  readonly triggersExpected: number;
  readonly triggersPresent: number;
  readonly triggersTotal: number;
}

export interface DatabaseReadinessChecks {
  readonly identity: boolean;
  readonly relations: boolean;
  readonly functions: boolean;
  readonly rls: boolean;
  readonly policies: boolean;
  readonly triggers: boolean;
  readonly privateSchema: boolean;
  readonly privateTables: boolean;
  readonly publicDataPermissions: boolean;
  readonly publicRpcPermissions: boolean;
  readonly privateFunctionPermissions: boolean;
  readonly securityDefiner: boolean;
  readonly searchPath: boolean;
  readonly noUnexpectedObjects: boolean;
}

export interface DatabaseReadinessAttestation {
  readonly version: typeof DATABASE_READINESS_VERSION;
  readonly instanceId: string;
  readonly schemaRevision: typeof DATABASE_READINESS_MIGRATION;
  readonly schemaFingerprint: typeof EXPECTED_SCHEMA_FINGERPRINT;
  readonly activationReceipt: string | null;
  readonly ready: boolean;
  readonly counts: DatabaseReadinessCounts;
  readonly checks: DatabaseReadinessChecks;
  readonly automaticExecution: false;
  readonly publicCardsEnabled: false;
}

export interface ProvisioningCapabilities {
  readonly identity: boolean;
  readonly foundation: boolean;
  readonly auth: boolean;
  readonly persistence: boolean;
  readonly realData: boolean;
  readonly sourceAcquisition: boolean;
  readonly deliveryWorkers: boolean;
}

export interface ProvisioningProjection {
  readonly version: typeof PROVISIONING_CONTROL_VERSION;
  readonly configuration: PersistenceConfigurationState;
  readonly configured: boolean;
  readonly instanceBound: boolean;
  readonly identityState: ProvisioningIdentityState;
  readonly identityVerified: boolean;
  readonly readinessState: DatabaseReadinessState;
  readonly schemaVerified: boolean;
  readonly schemaFingerprint: typeof EXPECTED_SCHEMA_FINGERPRINT | null;
  readonly activationReceipt: string | null;
  readonly capabilities: ProvisioningCapabilities;
  readonly blocker: string | null;
  readonly failClosed: true;
  readonly environmentFlagsAreInsufficient: true;
  readonly secretsExposed: false;
}

export type ProvisioningFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ProvisioningDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: ProvisioningFetch;
}

export const provisioningControlContract = Object.freeze({
  version: PROVISIONING_CONTROL_VERSION,
  identityVersion: SYSTEM_IDENTITY_VERSION,
  identityRpc: SYSTEM_IDENTITY_RPC,
  identityMigration: PROVISIONING_IDENTITY_MIGRATION,
  readinessVersion: DATABASE_READINESS_VERSION,
  readinessRpc: DATABASE_READINESS_RPC,
  readinessMigration: DATABASE_READINESS_MIGRATION,
  schemaManifestVersion: SCHEMA_MANIFEST_VERSION,
  expectedSchemaFingerprint: EXPECTED_SCHEMA_FINGERPRINT,
  route: '/api/provisioning-health',
  expectedProduct: EXPECTED_PRODUCT_ID,
  expectedEngine: EXPECTED_ENGINE_ID,
  expectedDataRegion: EXPECTED_DATA_REGION,
  dedicatedProjectRequired: true,
  databaseInstanceBindingRequired: true,
  schemaAttestationRequired: true,
  activationReceiptRequired: true,
  environmentFlagsAreInsufficient: true,
  publishableKeyIsNotBearerToken: true,
  failClosed: true,
  secretsExposed: false,
  automaticExecution: false,
  factualStateMutation: false,
} as const);

export type { ReadyPersistenceConfiguration };
