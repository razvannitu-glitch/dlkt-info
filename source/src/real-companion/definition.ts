import { DEFAULT_COMPANION_PREFERENCES } from '../companion/contracts.js';
import { parseCompanionBridgeSearch } from '../bridge/guards.js';
import { defaultTrustPolicy } from '../trust/contracts.js';
import { parseTrustPolicySearch } from '../trust/policy.js';
import type { RealCompanionDefinition } from './contracts.js';

const MAX_SEARCH_LENGTH = 32_768;

export function parseRealCompanionDefinition(search: unknown): RealCompanionDefinition {
  if (typeof search !== 'string' || search.length > MAX_SEARCH_LENGTH || /[\u0000-\u001f\u007f]/u.test(search)) {
    throw new Error('REAL_COMPANION_SEARCH_INVALID');
  }
  const bridge = parseCompanionBridgeSearch(search);
  if (bridge.state === 'invalid') throw new Error(`REAL_COMPANION_BRIDGE_${bridge.reason}`);
  const trust = parseTrustPolicySearch(search);
  if (trust.state === 'invalid') throw new Error(`REAL_COMPANION_TRUST_${trust.reason}`);
  return Object.freeze({
    preferences: bridge.state === 'valid' ? bridge.definition : DEFAULT_COMPANION_PREFERENCES,
    trustPolicy: trust.state === 'valid' ? trust.policy : defaultTrustPolicy,
  });
}
