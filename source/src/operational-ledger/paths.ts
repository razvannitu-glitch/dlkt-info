import { OPERATIONAL_LEDGER_ROOT } from './contracts.js';

const HASH = /^[a-f0-9]{64}$/u;

export const operationalIdentityPath = `${OPERATIONAL_LEDGER_ROOT}/identity.json` as const;
export const operationalPointerPath = `${OPERATIONAL_LEDGER_ROOT}/pointer.json` as const;
export const operationalCheckpointPath = (hash: string): string => {
  if (!HASH.test(hash)) throw new Error('OPERATIONAL_CHECKPOINT_HASH_INVALID');
  return `${OPERATIONAL_LEDGER_ROOT}/checkpoints/${hash}.json`;
};
