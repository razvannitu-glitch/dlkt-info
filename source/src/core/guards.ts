import type { AtomicClaim, BriefingDefinition, ClaimValue, EvidenceRef, SourceRecord } from './contracts.js';

const CONTROL = /[\u0000-\u001f\u007f]/u;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/u;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isSafeText = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim() === value && !CONTROL.test(value);

export const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

export const isInstant = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

const safeHttpsUrl = (value: unknown, allowQuery: boolean): value is string => {
  if (typeof value !== 'string' || value.length > 1800 || /[\s\\@#\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && !url.hash && (allowQuery || !url.search);
  } catch {
    return false;
  }
};

export const isSafeHttpsUrl = (value: unknown): value is string => safeHttpsUrl(value, false);
export const isSafeEvidenceUrl = (value: unknown): value is string => safeHttpsUrl(value, true);

export function isClaimValue(value: unknown): value is ClaimValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!Array.isArray(value) || value.length > 64) return false;
  if (value.every((item) => typeof item === 'string' && item.length <= 300)) return new Set(value).size === value.length;
  if (value.every((item) => typeof item === 'number' && Number.isFinite(item))) return true;
  return false;
}

export function assertEvidence(value: EvidenceRef): void {
  if (!isId(value.sourceId) || !isSafeEvidenceUrl(value.url) || !isSafeText(value.title, 300)
    || !isInstant(value.retrievedAt) || !(value.publishedAt === null || isInstant(value.publishedAt))
    || !HASH.test(value.contentHash)) throw new Error('EVIDENCE_INVALID');
}

export function assertAtomicClaim(value: AtomicClaim): void {
  if (!isId(value.id) || !isId(value.entity.id) || !isSafeText(value.entity.type, 80) || !isSafeText(value.entity.label, 180)
    || !isId(value.topicId) || !isSafeText(value.predicate, 160) || !isClaimValue(value.value)
    || !Number.isFinite(value.actionability) || value.actionability < 0 || value.actionability > 1
    || !isInstant(value.observedAt) || !(value.effectiveAt === null || isInstant(value.effectiveAt))
    || !isInstant(value.validFrom) || !(value.validUntil === null || isInstant(value.validUntil))
    || !LOCALE.test(value.locale) || !(value.geography === null || isSafeText(value.geography, 120))
    || !Array.isArray(value.affects) || value.affects.length > 32 || value.affects.some((item) => !isId(item))
    || !Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > 12) throw new Error('CLAIM_INVALID');
  if (Date.parse(value.validFrom) > Date.parse(value.observedAt) + 60_000) throw new Error('CLAIM_TIME_INVALID');
  if (value.validUntil !== null && Date.parse(value.validUntil) <= Date.parse(value.validFrom)) throw new Error('CLAIM_LIFETIME_INVALID');
  const evidenceIds = new Set<string>();
  for (const evidence of value.evidence) {
    assertEvidence(evidence);
    const identity = `${evidence.sourceId}|${evidence.url}|${evidence.contentHash}`;
    if (evidenceIds.has(identity)) throw new Error('EVIDENCE_DUPLICATE');
    evidenceIds.add(identity);
  }
}

export function assertSourceRecord(value: SourceRecord): void {
  if (!isId(value.id) || !isSafeText(value.name, 180) || !isSafeHttpsUrl(`${value.origin}/source`)
    || new URL(`${value.origin}/source`).origin !== value.origin || !Array.isArray(value.languages) || value.languages.length === 0
    || value.languages.some((language) => !LOCALE.test(language)) || !Array.isArray(value.pathRules) || value.pathRules.length === 0
    || value.pathRules.some((rule) => {
      const allowed = rule.allowedQueryKeys ?? [];
      const required = rule.requiredQueryKeys ?? [];
      const validKey = (key: string): boolean => /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/u.test(key);
      return !rule.pathnamePrefix.startsWith('/') || rule.pathnamePrefix.length > 500
        || /[?#\\\u0000-\u001f\u007f]/u.test(rule.pathnamePrefix) || rule.claimKinds.length === 0
        || !Array.isArray(allowed) || allowed.length > 16 || allowed.some((key) => !validKey(key))
        || new Set(allowed).size !== allowed.length || !Array.isArray(required) || required.length > allowed.length
        || required.some((key) => !validKey(key) || !allowed.includes(key)) || new Set(required).size !== required.length;
    })
    || !(value.rights.termsUrl === null || isSafeHttpsUrl(value.rights.termsUrl)) || !isSafeText(value.rights.note, 1000)
    || !isInstant(value.rights.reviewedAt) || !isInstant(value.rights.reviewExpiresAt)
    || Date.parse(value.rights.reviewExpiresAt) <= Date.parse(value.rights.reviewedAt)
    || !Number.isInteger(value.limits.minIntervalSeconds) || value.limits.minIntervalSeconds < 0
    || !Number.isInteger(value.limits.maxRequestsPerDay) || value.limits.maxRequestsPerDay < 1
    || !Number.isInteger(value.limits.timeoutMs) || value.limits.timeoutMs < 100 || value.limits.timeoutMs > 120_000
    || !Number.isInteger(value.limits.maxBytes) || value.limits.maxBytes < 1 || value.limits.maxBytes > 20_000_000) throw new Error('SOURCE_INVALID');
}

export function assertBriefingDefinition(value: BriefingDefinition): void {
  if (!isId(value.id) || !isId(value.ownerId) || !isSafeText(value.name, 120) || !TIME.test(value.deliveryLocalTime)
    || !Array.isArray(value.weekdays) || value.weekdays.length === 0 || value.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    || new Set(value.weekdays).size !== value.weekdays.length || !Array.isArray(value.channels) || value.channels.length === 0
    || !Number.isSafeInteger(value.maxCards) || value.maxCards < 1 || value.maxCards > 2_147_483_647
    || !Array.isArray(value.rules) || value.rules.length === 0 || value.rules.length > 50) throw new Error('BRIEFING_INVALID');
  try { new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }).format(0); } catch { throw new Error('TIMEZONE_INVALID'); }
  for (const rule of value.rules) {
    if (!isId(rule.id) || !Number.isFinite(rule.weight) || rule.weight < 0 || rule.weight > 10
      || !Array.isArray(rule.includeTopics) || !Array.isArray(rule.excludeTopics)
      || !Array.isArray(rule.includeEntities) || !Array.isArray(rule.excludeEntities)
      || !Array.isArray(rule.includeGeographies) || !Array.isArray(rule.languages)) throw new Error('INTEREST_RULE_INVALID');
  }
}
