import { createHash } from 'node:crypto';
import { readPersistenceConfiguration } from '../persistence/index.js';
import {
  PROVISIONING_CONTROL_VERSION,
  PROVISIONING_INSTANCE_ENVIRONMENT_KEY,
  type DatabaseReadinessState,
  type ProvisioningCapabilities,
  type ProvisioningDependencies,
  type ProvisioningIdentityState,
  type ProvisioningProjection,
} from './contracts.js';
import { DATABASE_READINESS_MIGRATION, EXPECTED_SCHEMA_FINGERPRINT } from './readiness-manifest.js';
import { readExpectedInstanceId } from './guards.js';
import { SupabaseProvisioningTransport } from './transport.js';

const emptyCapabilities = (): ProvisioningCapabilities => Object.freeze({
  identity: false,
  foundation: false,
  auth: false,
  persistence: false,
  realData: false,
  sourceAcquisition: false,
  deliveryWorkers: false,
});

function projection(
  configuration: ProvisioningProjection['configuration'],
  configured: boolean,
  instanceBound: boolean,
  identityState: ProvisioningIdentityState,
  readinessState: DatabaseReadinessState,
  schemaFingerprint: typeof EXPECTED_SCHEMA_FINGERPRINT | null,
  activationReceipt: string | null,
  capabilities: ProvisioningCapabilities,
  blocker: string | null,
): ProvisioningProjection {
  return Object.freeze({
    version: PROVISIONING_CONTROL_VERSION,
    configuration,
    configured,
    instanceBound,
    identityState,
    identityVerified: identityState === 'verified',
    readinessState,
    schemaVerified: readinessState === 'verified',
    schemaFingerprint,
    activationReceipt,
    capabilities,
    blocker,
    failClosed: true,
    environmentFlagsAreInsufficient: true,
    secretsExposed: false,
  });
}

function failureCode(error: unknown, stage: 'identity' | 'readiness'): { readonly state: ProvisioningIdentityState; readonly code: string } {
  const message = error instanceof Error ? error.message : '';
  if (message === 'DLKT_INFO_SYSTEM_IDENTITY_INVALID'
      || message === 'DLKT_INFO_DATABASE_READINESS_INVALID'
      || message === 'DLKT_INFO_PROVISIONING_RESPONSE_INVALID'
      || message === 'DLKT_INFO_PROVISIONING_RESPONSE_CONTENT_TYPE_INVALID'
      || message === 'DLKT_INFO_PROVISIONING_RESPONSE_TOO_LARGE') {
    return { state: 'invalid', code: stage === 'identity' ? 'DLKT_INFO_DATABASE_IDENTITY_INVALID' : 'DLKT_INFO_DATABASE_READINESS_INVALID' };
  }
  if (message === 'DLKT_INFO_PROVISIONING_HTTP_404') {
    return { state: 'unverified', code: stage === 'identity'
      ? 'DLKT_INFO_DATABASE_IDENTITY_MIGRATION_REQUIRED'
      : 'DLKT_INFO_DATABASE_READINESS_MIGRATION_REQUIRED' };
  }
  if (/^DLKT_INFO_PROVISIONING_HTTP_(?:401|403)$/u.test(message)) {
    return { state: 'invalid', code: 'DLKT_INFO_DATABASE_ATTESTATION_FORBIDDEN' };
  }
  return { state: 'unavailable', code: 'DLKT_INFO_DATABASE_ATTESTATION_UNAVAILABLE' };
}

export async function projectProvisioningControl(dependencies: ProvisioningDependencies = {}): Promise<ProvisioningProjection> {
  const environment = dependencies.environment ?? process.env;
  const configuration = readPersistenceConfiguration(environment);
  if (configuration.state === 'missing') {
    return projection('missing', false, false, 'not-configured', 'not-configured', null, null, emptyCapabilities(), 'DEDICATED_SUPABASE_PROJECT_REQUIRED');
  }
  if (configuration.state === 'invalid') {
    return projection('invalid', false, false, 'invalid', 'invalid', null, null, emptyCapabilities(), configuration.code);
  }

  let expectedInstanceId: string | null;
  try { expectedInstanceId = readExpectedInstanceId(environment[PROVISIONING_INSTANCE_ENVIRONMENT_KEY]); } catch {
    return projection('ready', true, false, 'invalid', 'invalid', null, null, emptyCapabilities(), 'DLKT_INFO_DATABASE_INSTANCE_ID_INVALID');
  }
  if (!expectedInstanceId) {
    return projection('ready', true, false, 'unverified', 'unverified', null, null, emptyCapabilities(), 'DLKT_INFO_DATABASE_INSTANCE_BINDING_REQUIRED');
  }

  const transport = new SupabaseProvisioningTransport(configuration, dependencies.fetch ?? fetch);
  let identity;
  try { identity = await transport.readIdentity(); } catch (error) {
    const failure = failureCode(error, 'identity');
    return projection('ready', true, true, failure.state, 'unverified', null, null, emptyCapabilities(), failure.code);
  }
  if (identity.instanceId !== expectedInstanceId) {
    return projection('ready', true, true, 'invalid', 'invalid', null, null, emptyCapabilities(), 'DLKT_INFO_DATABASE_INSTANCE_MISMATCH');
  }

  let readiness;
  try { readiness = await transport.readReadiness(); } catch (error) {
    const failure = failureCode(error, 'readiness');
    return projection('ready', true, true, 'verified', failure.state, null, null, emptyCapabilities(), failure.code);
  }
  if (readiness.instanceId !== expectedInstanceId) {
    return projection('ready', true, true, 'verified', 'invalid', null, null, emptyCapabilities(), 'DLKT_INFO_DATABASE_READINESS_INSTANCE_MISMATCH');
  }
  if (!readiness.ready || readiness.activationReceipt === null) {
    return projection('ready', true, true, 'verified', 'unverified', readiness.schemaFingerprint, null, emptyCapabilities(), 'DLKT_INFO_DATABASE_NOT_READY');
  }
  const expectedReceipt = createHash('sha256')
    .update(`${expectedInstanceId}:${EXPECTED_SCHEMA_FINGERPRINT}:${DATABASE_READINESS_MIGRATION}`)
    .digest('hex');
  if (readiness.activationReceipt !== expectedReceipt) {
    return projection('ready', true, true, 'verified', 'invalid', readiness.schemaFingerprint, null, emptyCapabilities(), 'DLKT_INFO_DATABASE_ACTIVATION_RECEIPT_INVALID');
  }

  const capabilities: ProvisioningCapabilities = Object.freeze({
    identity: true,
    foundation: configuration.foundationReady,
    auth: configuration.foundationReady && configuration.authEnabled,
    persistence: configuration.foundationReady && configuration.authEnabled,
    realData: configuration.foundationReady && configuration.realDataEnabled,
    sourceAcquisition: configuration.foundationReady && configuration.realDataEnabled && configuration.sourceAcquisitionEnabled,
    deliveryWorkers: configuration.foundationReady && configuration.realDataEnabled && configuration.deliveryWorkersEnabled,
  });
  return projection('ready', true, true, 'verified', 'verified', readiness.schemaFingerprint, readiness.activationReceipt, capabilities, null);
}
