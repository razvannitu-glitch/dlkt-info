import type { OperationalDeltaSnapshot, OperationalLedgerStorage, OperationalPointer } from './contracts.js';
import { readOperationalCheckpoint, readOperationalPointer } from './checkpoint.js';
import { projectOperationalDelta } from './delta.js';
import { assertOperationalLedgerIdentity } from './identity.js';
import { operationalCheckpointPath, operationalPointerPath } from './paths.js';

export type OperationalLedgerReadResult =
  | Readonly<{ state: 'empty'; pointer: null; delta: null }>
  | Readonly<{ state: 'ready'; pointer: OperationalPointer; delta: OperationalDeltaSnapshot }>;

export async function readLatestOperationalDelta(
  storage: OperationalLedgerStorage,
  instanceId: string,
): Promise<OperationalLedgerReadResult> {
  await assertOperationalLedgerIdentity(storage, instanceId);
  const pointerRecord = await storage.read(operationalPointerPath);
  if (!pointerRecord) return Object.freeze({ state: 'empty', pointer: null, delta: null });
  const pointer = readOperationalPointer(JSON.parse(pointerRecord.body) as unknown);
  if (pointer.ledgerInstanceId !== instanceId) throw new Error('OPERATIONAL_POINTER_INSTANCE_MISMATCH');
  const currentRecord = await storage.read(operationalCheckpointPath(pointer.checkpointHash));
  if (!currentRecord) throw new Error('OPERATIONAL_CURRENT_CHECKPOINT_MISSING');
  const current = readOperationalCheckpoint(JSON.parse(currentRecord.body) as unknown);
  if (current.checkpointHash !== pointer.checkpointHash || current.sequence !== pointer.sequence
      || current.slotAt !== pointer.slotAt || current.previousCheckpointHash !== pointer.previousCheckpointHash) {
    throw new Error('OPERATIONAL_POINTER_CHECKPOINT_MISMATCH');
  }
  const previous = pointer.previousCheckpointHash
    ? await storage.read(operationalCheckpointPath(pointer.previousCheckpointHash)) : null;
  if (pointer.previousCheckpointHash && !previous) throw new Error('OPERATIONAL_PREVIOUS_CHECKPOINT_MISSING');
  const previousCheckpoint = previous ? readOperationalCheckpoint(JSON.parse(previous.body) as unknown) : null;
  return Object.freeze({ state: 'ready', pointer, delta: projectOperationalDelta(current, previousCheckpoint) });
}
