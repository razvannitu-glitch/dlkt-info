import { readPersistenceConfiguration } from '../persistence/config.js';
import type { ServiceConfiguration } from './contracts.js';

const SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{20,240}$/u;
const CRON_SECRET = /^[A-Za-z0-9_-]{32,256}$/u;
type Environment = Readonly<Record<string, string | undefined>>;

const clean = (value: string | undefined): string | undefined => {
  if (value === undefined || value === '') return undefined;
  return value === value.trim() ? value : '__INVALID_WHITESPACE__';
};

export function readServiceConfiguration(environment: Environment): ServiceConfiguration {
  const persistence = readPersistenceConfiguration(environment);
  if (persistence.state !== 'ready') return Object.freeze({ state: persistence.state, code: persistence.code });
  if (!persistence.foundationReady || !persistence.realDataEnabled || !persistence.sourceAcquisitionEnabled) {
    return Object.freeze({ state: 'invalid', code: 'DLKT_INFO_SOURCE_ACQUISITION_NOT_ENABLED' });
  }
  const secretKey = clean(environment.DLKT_INFO_SUPABASE_SECRET_KEY);
  const cronSecret = clean(environment.CRON_SECRET);
  if (secretKey === undefined || cronSecret === undefined) {
    return Object.freeze({ state: 'missing', code: 'DLKT_INFO_SERVICE_SECRETS_REQUIRED' });
  }
  if (!SECRET_KEY.test(secretKey)) return Object.freeze({ state: 'invalid', code: 'DLKT_INFO_SECRET_KEY_INVALID' });
  if (!CRON_SECRET.test(cronSecret)) return Object.freeze({ state: 'invalid', code: 'DLKT_INFO_CRON_SECRET_INVALID' });
  return Object.freeze({ state: 'ready', persistence, secretKey, cronSecret });
}
