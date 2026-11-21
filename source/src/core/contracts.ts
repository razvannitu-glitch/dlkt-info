export const PRODUCT_ID = 'dlkt-info' as const;
export const ENGINE_ID = 'dlkt-info-inphocore-engine-orchestra' as const;
export const PRODUCT_VERSION = '0.9.46' as const;
export const ENGINE_VERSION = '0.1.0' as const;

export type ISODateTime = string;
export type Materiality = 'critical' | 'high' | 'medium' | 'low';
export type ClaimStatus = 'supported' | 'contested' | 'expired';
export type DeltaKind = 'new' | 'changed' | 'resolved' | 'conflicted';
export type SourceAuthority = 'official' | 'primary' | 'reputable-secondary' | 'community' | 'unknown';
export type SourceRole = 'regulator' | 'government' | 'company' | 'publisher' | 'public-data' | 'community' | 'social';
export type RightsState = 'permitted' | 'attribution-required' | 'permission-required' | 'subscription-required' | 'blocked' | 'unreviewed';
export type ClaimKind = 'event' | 'state' | 'change' | 'forecast' | 'availability' | 'price' | 'regulation' | 'release' | 'opportunity';
export type DeliveryChannel = 'web' | 'email' | 'push';
export type CardTrust = 'confirmed' | 'corroborated' | 'single-source' | 'conflicting';
export type Scalar = string | number | boolean | null;
export type ClaimValue = Scalar | readonly string[] | readonly number[];

export interface SourcePathRule {
  readonly pathnamePrefix: string;
  readonly claimKinds: readonly ClaimKind[];
  readonly allowedQueryKeys?: readonly string[];
  readonly requiredQueryKeys?: readonly string[];
}

export interface SourceRights {
  readonly automatedAccess: RightsState;
  readonly factualExtraction: RightsState;
  readonly commercialSummaries: RightsState;
  readonly attributionRequired: boolean;
  readonly termsUrl: string | null;
  readonly reviewedAt: ISODateTime;
  readonly reviewExpiresAt: ISODateTime;
  readonly note: string;
}

export interface SourceRecord {
  readonly id: string;
  readonly name: string;
  readonly origin: string;
  readonly authority: SourceAuthority;
  readonly role: SourceRole;
  readonly languages: readonly string[];
  readonly pathRules: readonly SourcePathRule[];
  readonly rights: SourceRights;
  readonly limits: Readonly<{
    minIntervalSeconds: number;
    maxRequestsPerDay: number;
    timeoutMs: number;
    maxBytes: number;
  }>;
}

export interface EvidenceRef {
  readonly sourceId: string;
  readonly url: string;
  readonly title: string;
  readonly retrievedAt: ISODateTime;
  readonly publishedAt: ISODateTime | null;
  readonly contentHash: string;
}

export interface EntityRef {
  readonly id: string;
  readonly type: string;
  readonly label: string;
}

export interface AtomicClaim {
  readonly id: string;
  readonly entity: EntityRef;
  readonly topicId: string;
  readonly kind: ClaimKind;
  readonly predicate: string;
  readonly value: ClaimValue;
  readonly materiality: Materiality;
  readonly actionability: number;
  readonly observedAt: ISODateTime;
  readonly effectiveAt: ISODateTime | null;
  readonly validFrom: ISODateTime;
  readonly validUntil: ISODateTime | null;
  readonly locale: string;
  readonly geography: string | null;
  readonly affects: readonly string[];
  readonly evidence: readonly EvidenceRef[];
}

export interface ReconciledClaim {
  readonly key: string;
  readonly status: ClaimStatus;
  readonly selectedClaimId: string | null;
  readonly reviewPriorityClaimId: string;
  readonly claims: readonly AtomicClaim[];
  readonly blockedDependencies: readonly string[];
  readonly trust: CardTrust;
}

export interface ClaimDelta {
  readonly id: string;
  readonly key: string;
  readonly kind: DeltaKind;
  readonly previous: ReconciledClaim | null;
  readonly current: ReconciledClaim | null;
  readonly materiality: Materiality;
  readonly detectedAt: ISODateTime;
}

export interface InterestRule {
  readonly id: string;
  readonly includeTopics: readonly string[];
  readonly excludeTopics: readonly string[];
  readonly includeEntities: readonly string[];
  readonly excludeEntities: readonly string[];
  readonly includeGeographies: readonly string[];
  readonly languages: readonly string[];
  readonly minMateriality: Materiality;
  readonly weight: number;
  readonly onlyActionable: boolean;
}

export interface BriefingDefinition {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly timezone: string;
  readonly deliveryLocalTime: string;
  readonly weekdays: readonly number[];
  readonly channels: readonly DeliveryChannel[];
  readonly maxCards: number;
  readonly rules: readonly InterestRule[];
}

export interface CardSource {
  readonly sourceId: string;
  readonly title: string;
  readonly url: string;
  readonly authority: SourceAuthority;
  readonly retrievedAt: ISODateTime;
}

export interface InfoCard {
  readonly id: string;
  readonly deltaId: string;
  readonly topicId: string;
  readonly entity: EntityRef;
  readonly kind: DeltaKind;
  readonly title: string;
  readonly direct: string;
  readonly whyItMatters: string;
  readonly changedSince: string;
  readonly materiality: Materiality;
  readonly trust: CardTrust;
  readonly score: number;
  readonly blockedDependencies: readonly string[];
  readonly sources: readonly CardSource[];
  readonly createdAt: ISODateTime;
  readonly expiresAt: ISODateTime | null;
}

export interface Briefing {
  readonly version: 'dlkt-info-briefing-1';
  readonly id: string;
  readonly definitionId: string;
  readonly generatedAt: ISODateTime;
  readonly windowStart: ISODateTime;
  readonly windowEnd: ISODateTime;
  readonly nextDeliveryAt: ISODateTime;
  readonly cards: readonly InfoCard[];
  readonly totalEligibleDeltas: number;
  readonly omittedByLimit: number;
  readonly contestedCount: number;
  readonly status: 'ready' | 'empty';
}

export interface NarrativeProjection {
  readonly title: string;
  readonly direct: string;
  readonly whyItMatters: string;
  readonly changedSince: string;
}

export interface InfoPack {
  readonly id: string;
  readonly version: string;
  readonly supportedKinds: readonly ClaimKind[];
  project(delta: ClaimDelta): NarrativeProjection;
}
