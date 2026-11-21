import { readServiceConfiguration } from '../service/config.js';
import type { InternalTrialConfiguration } from './contracts.js';

const SECRET = /^[A-Za-z0-9._~-]{32,256}$/u;
const REVIEWER = /^human:[a-zA-Z0-9][a-zA-Z0-9._:-]{2,120}$/u;
type Environment = Readonly<Record<string, string | undefined>>;

const flag = (value: string | undefined): boolean | null => {
  if (value === undefined || value === '' || value === '0') return false;
  if (value === '1') return true;
  return null;
};

export function readInternalTrialConfiguration(environment: Environment): InternalTrialConfiguration {
  const service = readServiceConfiguration(environment);
  if (service.state !== 'ready') return Object.freeze({ state: service.state, code: service.code });
  const trialEnabled = flag(environment.DLKT_INFO_INTERNAL_TRIAL_ENABLED);
  const reviewEnabled = flag(environment.DLKT_INFO_INTERNAL_REVIEW_ENABLED);
  if (trialEnabled === null || reviewEnabled === null) {
    return Object.freeze({ state: 'invalid', code: 'DLKT_INFO_INTERNAL_TRIAL_FLAG_INVALID' });
  }
  if (!trialEnabled) return Object.freeze({ state: 'disabled', code: 'DLKT_INFO_INTERNAL_TRIAL_DISABLED' });
  const reviewSecret = environment.DLKT_INFO_INTERNAL_REVIEW_SECRET;
  const reviewerId = environment.DLKT_INFO_INTERNAL_REVIEWER_ID;
  if (reviewEnabled && (!reviewSecret || !SECRET.test(reviewSecret) || !reviewerId || !REVIEWER.test(reviewerId))) {
    return Object.freeze({ state: 'invalid', code: 'DLKT_INFO_INTERNAL_REVIEW_CONFIGURATION_INVALID' });
  }
  return Object.freeze({
    state: 'ready',
    trialEnabled: true,
    reviewEnabled: Boolean(reviewEnabled),
    reviewSecret: reviewEnabled ? reviewSecret ?? null : null,
    reviewerId: reviewEnabled ? reviewerId ?? null : null,
  });
}
