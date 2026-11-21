export const OPERATIONAL_LEDGER_ENVIRONMENT_KEYS = Object.freeze([
  'DLKT_INFO_OPERATIONAL_LEDGER_ENABLED',
  'DLKT_INFO_LEDGER_INSTANCE_ID',
  'DLKT_INFO_LEDGER_STORE_ID',
  'DLKT_INFO_LEDGER_BLOB_TOKEN',
  'VERCEL_OIDC_TOKEN',
  'CRON_SECRET',
] as const);

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const STORE = /^[a-zA-Z0-9_-]{8,128}$/u;
const TOKEN = /^vercel_blob_rw_[A-Za-z0-9_=-]{20,4096}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

export type OperationalLedgerAuth =
  | Readonly<{ mode: 'oidc'; storeId: string; oidcToken: string }>
  | Readonly<{ mode: 'token'; token: string }>;

export type OperationalLedgerConfiguration =
  | Readonly<{ state: 'disabled'; blocker: 'OPERATIONAL_LEDGER_DISABLED' }>
  | Readonly<{ state: 'blocked'; blocker: string }>
  | Readonly<{ state: 'ready'; instanceId: string; region: 'fra1'; auth: OperationalLedgerAuth }>;

const safeSecret = (value: string | undefined, maximum = 4096): value is string =>
  typeof value === 'string' && value.length >= 20 && value.length <= maximum
    && value.trim() === value && !CONTROL.test(value);

export function readOperationalLedgerConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): OperationalLedgerConfiguration {
  const enabled = environment.DLKT_INFO_OPERATIONAL_LEDGER_ENABLED;
  if (enabled === undefined || enabled === '' || enabled === '0') {
    return Object.freeze({ state: 'disabled', blocker: 'OPERATIONAL_LEDGER_DISABLED' });
  }
  if (enabled !== '1') return Object.freeze({ state: 'blocked', blocker: 'OPERATIONAL_LEDGER_FLAG_INVALID' });

  const instanceId = environment.DLKT_INFO_LEDGER_INSTANCE_ID;
  if (typeof instanceId !== 'string' || !UUID.test(instanceId)) {
    return Object.freeze({ state: 'blocked', blocker: 'OPERATIONAL_LEDGER_INSTANCE_ID_REQUIRED' });
  }

  const storeId = environment.DLKT_INFO_LEDGER_STORE_ID;
  const oidcToken = environment.VERCEL_OIDC_TOKEN;
  if (typeof storeId === 'string' && STORE.test(storeId) && safeSecret(oidcToken, 16_384)) {
    return Object.freeze({
      state: 'ready', instanceId: instanceId.toLowerCase(), region: 'fra1',
      auth: Object.freeze({ mode: 'oidc', storeId, oidcToken }),
    });
  }

  const token = environment.DLKT_INFO_LEDGER_BLOB_TOKEN;
  if (typeof token === 'string' && TOKEN.test(token)) {
    return Object.freeze({
      state: 'ready', instanceId: instanceId.toLowerCase(), region: 'fra1',
      auth: Object.freeze({ mode: 'token', token }),
    });
  }
  return Object.freeze({ state: 'blocked', blocker: 'OPERATIONAL_LEDGER_STORAGE_CREDENTIALS_REQUIRED' });
}
