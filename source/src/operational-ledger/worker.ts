import { canonicalJson } from './canonical.js';
import {
  buildOperationalCheckpoint,
  operationalSlotAt,
  readOperationalCheckpoint,
  readOperationalPointer,
  serializeOperationalCheckpoint,
  serializeOperationalPointer,
} from './checkpoint.js';
import {
  OPERATIONAL_LEDGER_VERSION,
  OPERATIONAL_POINTER_VERSION,
  type OperationalCollectionResult,
  type OperationalLedgerSourceDependencies,
  type OperationalLedgerStorage,
  type OperationalPointer,
} from './contracts.js';
import { projectOperationalDelta } from './delta.js';
import { assertOperationalLedgerIdentity } from './identity.js';
import { operationalCheckpointPath, operationalPointerPath } from './paths.js';
import { OperationalLedgerConflictError } from './storage.js';

const sourceError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  if (/TIMEOUT|AbortError|TimeoutError/u.test(message)) return 'OPERATIONAL_SOURCE_TIMEOUT';
  if (/HTTP|FETCH|CERT|TLS/u.test(message)) return 'OPERATIONAL_SOURCE_TRANSPORT_ERROR';
  if (/RSS|XML|CHECKPOINT|PROVENANCE|PAYLOAD|SOURCE|FEED/u.test(message)) return 'OPERATIONAL_SOURCE_VALIDATION_ERROR';
  return 'OPERATIONAL_SOURCE_UNAVAILABLE';
};

const result = (input: Omit<OperationalCollectionResult, 'version' | 'databaseChanged' | 'publicCardsCreated' | 'automaticPublication'>): OperationalCollectionResult =>
  Object.freeze({
    version: OPERATIONAL_LEDGER_VERSION,
    ...input,
    databaseChanged: false,
    publicCardsCreated: false,
    automaticPublication: false,
  });

const readPointer = async (storage: OperationalLedgerStorage) => {
  const record = await storage.read(operationalPointerPath);
  return record ? Object.freeze({ record, pointer: readOperationalPointer(JSON.parse(record.body) as unknown) }) : null;
};

export async function collectOperationalDelta(input: Readonly<{
  storage: OperationalLedgerStorage;
  instanceId: string;
  dependencies?: OperationalLedgerSourceDependencies;
}>): Promise<OperationalCollectionResult> {
  await assertOperationalLedgerIdentity(input.storage, input.instanceId);
  const now = input.dependencies?.now?.() ?? Date.now();
  const slotAt = operationalSlotAt(now);
  const pointerState = await readPointer(input.storage);
  if (pointerState && pointerState.pointer.ledgerInstanceId !== input.instanceId) {
    throw new Error('OPERATIONAL_POINTER_INSTANCE_MISMATCH');
  }
  if (pointerState && pointerState.pointer.slotAt === slotAt) {
    return result({
      status: 'already-committed', slotAt, sequence: pointerState.pointer.sequence,
      checkpointHash: pointerState.pointer.checkpointHash,
      previousCheckpointHash: pointerState.pointer.previousCheckpointHash,
      newCount: 0, changedCount: 0, unchangedCount: 0, rolledOffIgnoredCount: 0, errorCode: null,
    });
  }
  if (pointerState && pointerState.pointer.slotAt > slotAt) {
    return result({
      status: 'superseded', slotAt, sequence: pointerState.pointer.sequence,
      checkpointHash: pointerState.pointer.checkpointHash,
      previousCheckpointHash: pointerState.pointer.previousCheckpointHash,
      newCount: 0, changedCount: 0, unchangedCount: 0, rolledOffIgnoredCount: 0, errorCode: null,
    });
  }

  const previousRecord = pointerState
    ? await input.storage.read(operationalCheckpointPath(pointerState.pointer.checkpointHash)) : null;
  if (pointerState && !previousRecord) throw new Error('OPERATIONAL_PREVIOUS_CHECKPOINT_MISSING');
  const previous = previousRecord ? readOperationalCheckpoint(JSON.parse(previousRecord.body) as unknown) : null;

  let current;
  try {
    current = await buildOperationalCheckpoint({
      ledgerInstanceId: input.instanceId,
      sequence: (pointerState?.pointer.sequence ?? 0) + 1,
      slotAt,
      previous,
      ...(input.dependencies ? { dependencies: input.dependencies } : {}),
    });
  } catch (error) {
    return result({
      status: 'source-unavailable', slotAt, sequence: pointerState?.pointer.sequence ?? null,
      checkpointHash: pointerState?.pointer.checkpointHash ?? null,
      previousCheckpointHash: pointerState?.pointer.previousCheckpointHash ?? null,
      newCount: 0, changedCount: 0, unchangedCount: 0, rolledOffIgnoredCount: 0,
      errorCode: sourceError(error),
    });
  }

  const checkpointPath = operationalCheckpointPath(current.checkpointHash);
  try {
    await input.storage.create(checkpointPath, serializeOperationalCheckpoint(current));
  } catch (error) {
    if (!(error instanceof OperationalLedgerConflictError)) throw error;
    const existing = await input.storage.read(checkpointPath);
    if (!existing) throw error;
    const stored = readOperationalCheckpoint(JSON.parse(existing.body) as unknown);
    if (canonicalJson(stored) !== serializeOperationalCheckpoint(current)) {
      throw new Error('OPERATIONAL_CHECKPOINT_CONTENT_CONFLICT');
    }
  }

  const pointer: OperationalPointer = Object.freeze({
    version: OPERATIONAL_POINTER_VERSION, product: 'dlkt-info', ledgerInstanceId: input.instanceId,
    sequence: current.sequence, slotAt: current.slotAt, checkpointHash: current.checkpointHash,
    previousCheckpointHash: current.previousCheckpointHash, updatedAt: new Date(now).toISOString(),
  });
  const pointerBody = serializeOperationalPointer(pointer);
  try {
    if (pointerState) await input.storage.compareAndSwap(operationalPointerPath, pointerBody, pointerState.record.etag);
    else await input.storage.create(operationalPointerPath, pointerBody);
  } catch (error) {
    if (!(error instanceof OperationalLedgerConflictError)) throw error;
    const winnerState = await readPointer(input.storage);
    if (!winnerState) throw error;
    const winner = winnerState.pointer;
    if (winner.slotAt === slotAt && winner.checkpointHash === current.checkpointHash) {
      const delta = projectOperationalDelta(current, previous);
      return result({
        status: 'already-committed', slotAt, sequence: winner.sequence,
        checkpointHash: winner.checkpointHash, previousCheckpointHash: winner.previousCheckpointHash,
        newCount: delta.newCount, changedCount: delta.changedCount, unchangedCount: delta.unchangedCount,
        rolledOffIgnoredCount: delta.rolledOffIgnoredCount, errorCode: null,
      });
    }
    if (winner.slotAt === slotAt) {
      return result({
        status: 'slot-conflict', slotAt, sequence: winner.sequence,
        checkpointHash: winner.checkpointHash, previousCheckpointHash: winner.previousCheckpointHash,
        newCount: 0, changedCount: 0, unchangedCount: 0, rolledOffIgnoredCount: 0,
        errorCode: 'OPERATIONAL_SLOT_ALREADY_COMMITTED',
      });
    }
    return result({
      status: 'superseded', slotAt, sequence: winner.sequence,
      checkpointHash: winner.checkpointHash, previousCheckpointHash: winner.previousCheckpointHash,
      newCount: 0, changedCount: 0, unchangedCount: 0, rolledOffIgnoredCount: 0, errorCode: null,
    });
  }

  const delta = projectOperationalDelta(current, previous);
  return result({
    status: previous ? 'committed' : 'initialized', slotAt, sequence: current.sequence,
    checkpointHash: current.checkpointHash, previousCheckpointHash: current.previousCheckpointHash,
    newCount: delta.newCount, changedCount: delta.changedCount, unchangedCount: delta.unchangedCount,
    rolledOffIgnoredCount: delta.rolledOffIgnoredCount, errorCode: null,
  });
}
