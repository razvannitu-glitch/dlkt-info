import { isInstant, isRecord } from '../core/guards.js';
import type { OperationalLedgerIdentity, OperationalLedgerStorage } from './contracts.js';
import { OPERATIONAL_LEDGER_IDENTITY_VERSION } from './contracts.js';
import { canonicalJson } from './canonical.js';
import { operationalIdentityPath } from './paths.js';
import { OperationalLedgerConflictError } from './storage.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export const readOperationalLedgerIdentity = (value: unknown): OperationalLedgerIdentity => {
  if (!isRecord(value) || !exactKeys(value, ['version', 'product', 'purpose', 'instanceId', 'region', 'createdAt'])
      || value.version !== OPERATIONAL_LEDGER_IDENTITY_VERSION || value.product !== 'dlkt-info'
      || value.purpose !== 'operational-delta-ledger' || typeof value.instanceId !== 'string'
      || !UUID.test(value.instanceId) || value.region !== 'fra1' || !isInstant(value.createdAt)) {
    throw new Error('OPERATIONAL_LEDGER_IDENTITY_INVALID');
  }
  return Object.freeze({
    version: OPERATIONAL_LEDGER_IDENTITY_VERSION,
    product: 'dlkt-info', purpose: 'operational-delta-ledger', instanceId: value.instanceId,
    region: 'fra1', createdAt: value.createdAt,
  });
};

export async function assertOperationalLedgerIdentity(
  storage: OperationalLedgerStorage,
  expectedInstanceId: string,
): Promise<OperationalLedgerIdentity> {
  const record = await storage.read(operationalIdentityPath);
  if (!record) throw new Error('OPERATIONAL_LEDGER_IDENTITY_MISSING');
  const identity = readOperationalLedgerIdentity(JSON.parse(record.body) as unknown);
  if (identity.instanceId !== expectedInstanceId) throw new Error('OPERATIONAL_LEDGER_INSTANCE_MISMATCH');
  return identity;
}

export async function bootstrapOperationalLedgerIdentity(
  storage: OperationalLedgerStorage,
  instanceId: string,
  now = Date.now(),
): Promise<OperationalLedgerIdentity> {
  const identity: OperationalLedgerIdentity = Object.freeze({
    version: OPERATIONAL_LEDGER_IDENTITY_VERSION, product: 'dlkt-info',
    purpose: 'operational-delta-ledger', instanceId, region: 'fra1',
    createdAt: new Date(now).toISOString(),
  });
  try {
    await storage.create(operationalIdentityPath, canonicalJson(identity));
    return identity;
  } catch (error) {
    if (!(error instanceof OperationalLedgerConflictError)) throw error;
    return assertOperationalLedgerIdentity(storage, instanceId);
  }
}
