import type { AtomicClaim, ClaimKind, EvidenceRef, SourceRecord } from './contracts.js';
import { assertSourceRecord, isSafeEvidenceUrl } from './guards.js';

export type EvidenceAuthorization = Readonly<{
  allowed: true;
  source: SourceRecord;
}> | Readonly<{
  allowed: false;
  reason: 'source-unknown' | 'registry-expired' | 'unsafe-url' | 'origin-mismatch' | 'path-unregistered' | 'query-unregistered' | 'rights-blocked';
}>;

export class SourceRegistry {
  readonly #sources: ReadonlyMap<string, SourceRecord>;

  constructor(sources: readonly SourceRecord[]) {
    const records = new Map<string, SourceRecord>();
    for (const source of sources) {
      assertSourceRecord(source);
      if (records.has(source.id)) throw new Error('SOURCE_DUPLICATE');
      records.set(source.id, structuredClone(source));
    }
    this.#sources = records;
  }

  get size(): number { return this.#sources.size; }

  get(sourceId: string): SourceRecord | null {
    const source = this.#sources.get(sourceId);
    return source ? structuredClone(source) : null;
  }

  authorize(evidence: EvidenceRef, kind: ClaimKind, now: number): EvidenceAuthorization {
    const source = this.#sources.get(evidence.sourceId);
    if (!source) return { allowed: false, reason: 'source-unknown' };
    if (!Number.isFinite(now) || Date.parse(source.rights.reviewExpiresAt) <= now) return { allowed: false, reason: 'registry-expired' };
    if (!isSafeEvidenceUrl(evidence.url)) return { allowed: false, reason: 'unsafe-url' };
    const url = new URL(evidence.url);
    if (url.origin !== source.origin) return { allowed: false, reason: 'origin-mismatch' };
    const rule = source.pathRules.find((candidate) => candidate.claimKinds.includes(kind)
      && (url.pathname === candidate.pathnamePrefix
        || url.pathname.startsWith(candidate.pathnamePrefix.endsWith('/') ? candidate.pathnamePrefix : `${candidate.pathnamePrefix}/`)));
    if (!rule) return { allowed: false, reason: 'path-unregistered' };

    const allowedKeys = new Set(rule.allowedQueryKeys ?? []);
    const requiredKeys = new Set(rule.requiredQueryKeys ?? []);
    const seenKeys = new Set<string>();
    for (const [key, value] of url.searchParams.entries()) {
      if (!allowedKeys.has(key) || seenKeys.has(key) || value.length < 1 || value.length > 512
        || /[\s\\\u0000-\u001f\u007f]/u.test(value)) {
        return { allowed: false, reason: 'query-unregistered' };
      }
      seenKeys.add(key);
    }
    if ([...requiredKeys].some((key) => !seenKeys.has(key))) {
      return { allowed: false, reason: 'query-unregistered' };
    }
    const allowed = new Set(['permitted', 'attribution-required']);
    if (!allowed.has(source.rights.automatedAccess) || !allowed.has(source.rights.factualExtraction)
      || !allowed.has(source.rights.commercialSummaries)) return { allowed: false, reason: 'rights-blocked' };
    return { allowed: true, source: structuredClone(source) };
  }

  authorizeClaim(claim: AtomicClaim, now: number): boolean {
    return claim.evidence.every((evidence) => this.authorize(evidence, claim.kind, now).allowed);
  }
}
