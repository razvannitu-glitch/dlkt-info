import {
  EXPECTED_DATA_FOUNDATION_VERSION,
  EXPECTED_DATA_REGION,
  EXPECTED_ENGINE_ID,
  EXPECTED_PERSISTENCE_VERSION,
  EXPECTED_PRODUCT_ID,
  PROVISIONING_IDENTITY_MIGRATION,
  SYSTEM_IDENTITY_VERSION,
  type DatabaseReadinessAttestation,
  type DatabaseReadinessChecks,
  type DatabaseReadinessCounts,
  type SystemIdentity,
} from './contracts.js';
import {
  DATABASE_READINESS_MIGRATION,
  DATABASE_READINESS_VERSION,
  EXPECTED_SCHEMA_COUNTS,
  EXPECTED_SCHEMA_FINGERPRINT,
} from './readiness-manifest.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTITY_KEYS = Object.freeze([
  'automaticExecution', 'dataFoundationVersion', 'dataRegion', 'dedicated', 'engineId',
  'instanceId', 'persistenceVersion', 'productId', 'publicCardsEnabled', 'schemaRevision', 'version',
] as const);
const READINESS_KEYS = Object.freeze([
  'activationReceipt', 'automaticExecution', 'checks', 'counts', 'instanceId', 'publicCardsEnabled',
  'ready', 'schemaFingerprint', 'schemaRevision', 'version',
] as const);
const COUNT_KEYS = Object.freeze([
  'functionsExpected', 'functionsPresent', 'functionsTotal', 'policiesExpected', 'policiesPresent',
  'policiesTotal', 'relationsExpected', 'relationsPresent', 'relationsTotal', 'rlsExpected',
  'rlsPresent', 'rlsTotal', 'triggersExpected', 'triggersPresent', 'triggersTotal',
] as const);
const CHECK_KEYS = Object.freeze([
  'functions', 'identity', 'noUnexpectedObjects', 'policies', 'privateFunctionPermissions',
  'privateSchema', 'privateTables', 'publicDataPermissions', 'publicRpcPermissions', 'relations', 'rls', 'searchPath',
  'securityDefiner', 'triggers',
] as const);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function readInteger(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error('DLKT_INFO_DATABASE_READINESS_INVALID');
  }
  return value;
}

function readCounts(value: unknown): DatabaseReadinessCounts {
  if (!isRecord(value) || !exactKeys(value, COUNT_KEYS)) throw new Error('DLKT_INFO_DATABASE_READINESS_INVALID');
  const result: DatabaseReadinessCounts = Object.freeze({
    relationsExpected: readInteger(value.relationsExpected, 10_000),
    relationsPresent: readInteger(value.relationsPresent, 10_000),
    relationsTotal: readInteger(value.relationsTotal, 10_000),
    functionsExpected: readInteger(value.functionsExpected, 10_000),
    functionsPresent: readInteger(value.functionsPresent, 10_000),
    functionsTotal: readInteger(value.functionsTotal, 10_000),
    rlsExpected: readInteger(value.rlsExpected, 10_000),
    rlsPresent: readInteger(value.rlsPresent, 10_000),
    rlsTotal: readInteger(value.rlsTotal, 10_000),
    policiesExpected: readInteger(value.policiesExpected, 10_000),
    policiesPresent: readInteger(value.policiesPresent, 10_000),
    policiesTotal: readInteger(value.policiesTotal, 10_000),
    triggersExpected: readInteger(value.triggersExpected, 10_000),
    triggersPresent: readInteger(value.triggersPresent, 10_000),
    triggersTotal: readInteger(value.triggersTotal, 10_000),
  });
  return result;
}

function readChecks(value: unknown): DatabaseReadinessChecks {
  if (!isRecord(value) || !exactKeys(value, CHECK_KEYS)) throw new Error('DLKT_INFO_DATABASE_READINESS_INVALID');
  for (const key of CHECK_KEYS) if (typeof value[key] !== 'boolean') throw new Error('DLKT_INFO_DATABASE_READINESS_INVALID');
  return Object.freeze({
    identity: value.identity as boolean,
    relations: value.relations as boolean,
    functions: value.functions as boolean,
    rls: value.rls as boolean,
    policies: value.policies as boolean,
    triggers: value.triggers as boolean,
    privateSchema: value.privateSchema as boolean,
    privateTables: value.privateTables as boolean,
    publicDataPermissions: value.publicDataPermissions as boolean,
    publicRpcPermissions: value.publicRpcPermissions as boolean,
    privateFunctionPermissions: value.privateFunctionPermissions as boolean,
    securityDefiner: value.securityDefiner as boolean,
    searchPath: value.searchPath as boolean,
    noUnexpectedObjects: value.noUnexpectedObjects as boolean,
  });
}

export function readSystemIdentity(value: unknown): SystemIdentity {
  if (!isRecord(value) || !exactKeys(value, IDENTITY_KEYS)
      || value.version !== SYSTEM_IDENTITY_VERSION
      || typeof value.instanceId !== 'string' || !UUID.test(value.instanceId)
      || value.productId !== EXPECTED_PRODUCT_ID
      || value.engineId !== EXPECTED_ENGINE_ID
      || value.dataFoundationVersion !== EXPECTED_DATA_FOUNDATION_VERSION
      || value.persistenceVersion !== EXPECTED_PERSISTENCE_VERSION
      || value.schemaRevision !== PROVISIONING_IDENTITY_MIGRATION
      || value.dataRegion !== EXPECTED_DATA_REGION
      || value.dedicated !== true
      || value.automaticExecution !== false
      || value.publicCardsEnabled !== false) {
    throw new Error('DLKT_INFO_SYSTEM_IDENTITY_INVALID');
  }
  return Object.freeze({
    version: SYSTEM_IDENTITY_VERSION,
    instanceId: value.instanceId,
    productId: EXPECTED_PRODUCT_ID,
    engineId: EXPECTED_ENGINE_ID,
    dataFoundationVersion: EXPECTED_DATA_FOUNDATION_VERSION,
    persistenceVersion: EXPECTED_PERSISTENCE_VERSION,
    schemaRevision: PROVISIONING_IDENTITY_MIGRATION,
    dataRegion: EXPECTED_DATA_REGION,
    dedicated: true,
    automaticExecution: false,
    publicCardsEnabled: false,
  });
}

export function readDatabaseReadiness(value: unknown): DatabaseReadinessAttestation {
  if (!isRecord(value) || !exactKeys(value, READINESS_KEYS)
      || value.version !== DATABASE_READINESS_VERSION
      || typeof value.instanceId !== 'string' || !UUID.test(value.instanceId)
      || value.schemaRevision !== DATABASE_READINESS_MIGRATION
      || value.schemaFingerprint !== EXPECTED_SCHEMA_FINGERPRINT
      || typeof value.ready !== 'boolean'
      || value.automaticExecution !== false
      || value.publicCardsEnabled !== false
      || !(value.activationReceipt === null || (typeof value.activationReceipt === 'string' && SHA256.test(value.activationReceipt)))) {
    throw new Error('DLKT_INFO_DATABASE_READINESS_INVALID');
  }
  const counts = readCounts(value.counts);
  const checks = readChecks(value.checks);
  const exactCounts = counts.relationsExpected === EXPECTED_SCHEMA_COUNTS.relations
    && counts.relationsPresent === EXPECTED_SCHEMA_COUNTS.relations
    && counts.relationsTotal === EXPECTED_SCHEMA_COUNTS.relations
    && counts.functionsExpected === EXPECTED_SCHEMA_COUNTS.functions
    && counts.functionsPresent === EXPECTED_SCHEMA_COUNTS.functions
    && counts.functionsTotal === EXPECTED_SCHEMA_COUNTS.functions
    && counts.rlsExpected === EXPECTED_SCHEMA_COUNTS.rls
    && counts.rlsPresent === EXPECTED_SCHEMA_COUNTS.rls
    && counts.rlsTotal === EXPECTED_SCHEMA_COUNTS.rls
    && counts.policiesExpected === EXPECTED_SCHEMA_COUNTS.policies
    && counts.policiesPresent === EXPECTED_SCHEMA_COUNTS.policies
    && counts.policiesTotal === EXPECTED_SCHEMA_COUNTS.policies
    && counts.triggersExpected === EXPECTED_SCHEMA_COUNTS.triggers
    && counts.triggersPresent === EXPECTED_SCHEMA_COUNTS.triggers
    && counts.triggersTotal === EXPECTED_SCHEMA_COUNTS.triggers;
  const allChecks = Object.values(checks).every(Boolean);
  if (value.ready) {
    if (!exactCounts || !allChecks || value.activationReceipt === null) throw new Error('DLKT_INFO_DATABASE_READINESS_INVALID');
  } else if (value.activationReceipt !== null) {
    throw new Error('DLKT_INFO_DATABASE_READINESS_INVALID');
  }
  return Object.freeze({
    version: DATABASE_READINESS_VERSION,
    instanceId: value.instanceId,
    schemaRevision: DATABASE_READINESS_MIGRATION,
    schemaFingerprint: EXPECTED_SCHEMA_FINGERPRINT,
    activationReceipt: value.activationReceipt,
    ready: value.ready,
    counts,
    checks,
    automaticExecution: false,
    publicCardsEnabled: false,
  });
}

export function readExpectedInstanceId(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  if (value !== value.trim() || !UUID.test(value)) throw new Error('DLKT_INFO_DATABASE_INSTANCE_ID_INVALID');
  return value;
}
