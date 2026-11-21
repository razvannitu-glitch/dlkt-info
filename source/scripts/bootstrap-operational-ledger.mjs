import { execFileSync } from 'node:child_process';

execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
const {
  VercelBlobOperationalLedgerStorage,
  bootstrapOperationalLedgerIdentity,
  readOperationalLedgerConfiguration,
} = await import('../.build/src/operational-ledger/index.js');
const configuration = readOperationalLedgerConfiguration(process.env);
if (configuration.state !== 'ready') throw new Error(`OPERATIONAL_LEDGER_NOT_READY:${configuration.blocker}`);
if (process.env.DLKT_INFO_LEDGER_BOOTSTRAP_CONFIRM !== configuration.instanceId) {
  throw new Error('OPERATIONAL_LEDGER_BOOTSTRAP_CONFIRMATION_REQUIRED');
}
const storage = new VercelBlobOperationalLedgerStorage(configuration.auth);
const identity = await bootstrapOperationalLedgerIdentity(storage, configuration.instanceId);
console.log(JSON.stringify({ status: 'operational-ledger-identity-ready', instanceId: identity.instanceId, region: identity.region }));
