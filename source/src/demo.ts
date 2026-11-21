import { runBriefingOrchestra } from './core/orchestra.js';
import {
  COMPANION_VERSION,
  DEFAULT_COMPANION_PREFERENCES,
  parseCompanionPreferences,
  type CompanionPreferences,
} from './companion/index.js';
import type {
  AtomicClaim,
  BriefingDefinition,
  ClaimKind,
  DeliveryChannel,
  EvidenceRef,
  SourceRecord,
} from './core/contracts.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const iso = (time: number): string => new Date(time).toISOString();
const hash = (character: string): string => character.repeat(64);
const CHANNELS = Object.freeze(['web'] as const satisfies readonly DeliveryChannel[]);
const ALL_KINDS = Object.freeze([
  'release', 'change', 'regulation', 'opportunity', 'price', 'availability', 'state',
] as const satisfies readonly ClaimKind[]);

function source(input: {
  id: string;
  name: string;
  origin: string;
  authority: SourceRecord['authority'];
  role: SourceRecord['role'];
  path: string;
  now: number;
}): SourceRecord {
  return Object.freeze({
    id: input.id,
    name: input.name,
    origin: input.origin,
    authority: input.authority,
    role: input.role,
    languages: Object.freeze(['en']),
    pathRules: Object.freeze([{ pathnamePrefix: input.path, claimKinds: ALL_KINDS }]),
    rights: Object.freeze({
      automatedAccess: 'permitted',
      factualExtraction: 'permitted',
      commercialSummaries: 'attribution-required',
      attributionRequired: true,
      termsUrl: `${input.origin}/terms`,
      reviewedAt: iso(input.now - 30 * DAY),
      reviewExpiresAt: iso(input.now + 30 * DAY),
      note: 'Synthetic demonstration source. No real-world assertion is made.',
    }),
    limits: Object.freeze({ minIntervalSeconds: 3600, maxRequestsPerDay: 24, timeoutMs: 5000, maxBytes: 1_000_000 }),
  });
}

function evidence(input: {
  sourceId: string;
  origin: string;
  path: string;
  title: string;
  retrievedAt: string;
  hashCharacter: string;
}): EvidenceRef {
  return Object.freeze({
    sourceId: input.sourceId,
    url: `${input.origin}${input.path}`,
    title: input.title,
    retrievedAt: input.retrievedAt,
    publishedAt: input.retrievedAt,
    contentHash: hash(input.hashCharacter),
  });
}

function claim(input: {
  id: string;
  entityId: string;
  entityType: string;
  entityLabel: string;
  topicId: string;
  kind: AtomicClaim['kind'];
  predicate: string;
  value: AtomicClaim['value'];
  materiality: AtomicClaim['materiality'];
  actionability: number;
  observedAt: string;
  validFrom: string;
  validUntil: string;
  geography: string;
  affects: readonly string[];
  evidence: EvidenceRef;
}): AtomicClaim {
  return Object.freeze({
    id: input.id,
    entity: Object.freeze({ id: input.entityId, type: input.entityType, label: input.entityLabel }),
    topicId: input.topicId,
    kind: input.kind,
    predicate: input.predicate,
    value: input.value,
    materiality: input.materiality,
    actionability: input.actionability,
    observedAt: input.observedAt,
    effectiveAt: null,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    locale: 'en',
    geography: input.geography,
    affects: Object.freeze([...input.affects]),
    evidence: Object.freeze([input.evidence]),
  });
}

export function buildSyntheticBriefing(
  now = Date.now(),
  preferences: CompanionPreferences = DEFAULT_COMPANION_PREFERENCES,
) {
  if (!Number.isFinite(now)) throw new Error('DEMO_CLOCK_INVALID');
  const companion = parseCompanionPreferences(preferences);
  const windowStart = iso(now - DAY);
  const windowEnd = iso(now);
  const validUntil = iso(now + DAY);

  const officialCompany = source({
    id: 'demo-company-official', name: 'Synthetic Company', origin: 'https://company.example',
    authority: 'official', role: 'company', path: '/updates', now,
  });
  const officialRegulator = source({
    id: 'demo-regulator-official', name: 'Synthetic Regulator', origin: 'https://regulator.example',
    authority: 'official', role: 'regulator', path: '/notices', now,
  });
  const officialFunding = source({
    id: 'demo-funding-official', name: 'Synthetic Funding Office', origin: 'https://funding.example',
    authority: 'official', role: 'government', path: '/calls', now,
  });
  const secondaryPublisher = source({
    id: 'demo-publisher-secondary', name: 'Synthetic Industry Desk', origin: 'https://publisher.example',
    authority: 'reputable-secondary', role: 'publisher', path: '/reports', now,
  });

  const previousClaims: AtomicClaim[] = [
    claim({
      id: 'demo-launch-waitlist', entityId: 'company:demo-ai', entityType: 'company', entityLabel: 'Demo AI',
      topicId: 'technology', kind: 'release', predicate: 'public launch state', value: 'waitlist',
      materiality: 'high', actionability: 0.75, observedAt: iso(now - 25 * HOUR), validFrom: iso(now - 25 * HOUR),
      validUntil, geography: 'Global', affects: ['product-access', 'launch-planning'],
      evidence: evidence({ sourceId: officialCompany.id, origin: officialCompany.origin, path: '/updates/launch-waitlist', title: 'Synthetic launch notice', retrievedAt: iso(now - 25 * HOUR), hashCharacter: 'a' }),
    }),
    claim({
      id: 'demo-price-before', entityId: 'service:demo-cloud', entityType: 'service', entityLabel: 'Demo Cloud',
      topicId: 'business', kind: 'price', predicate: 'monthly price', value: 199,
      materiality: 'medium', actionability: 0.85, observedAt: iso(now - 26 * HOUR), validFrom: iso(now - 26 * HOUR),
      validUntil, geography: 'Europe', affects: ['budget', 'procurement'],
      evidence: evidence({ sourceId: officialCompany.id, origin: officialCompany.origin, path: '/updates/pricing-previous', title: 'Synthetic pricing notice', retrievedAt: iso(now - 26 * HOUR), hashCharacter: 'b' }),
    }),
  ];

  const currentClaims: AtomicClaim[] = [
    claim({
      id: 'demo-launch-available', entityId: 'company:demo-ai', entityType: 'company', entityLabel: 'Demo AI',
      topicId: 'technology', kind: 'release', predicate: 'public launch state', value: 'available',
      materiality: 'high', actionability: 0.95, observedAt: iso(now - HOUR), validFrom: iso(now - HOUR),
      validUntil, geography: 'Global', affects: ['product-access', 'launch-planning'],
      evidence: evidence({ sourceId: officialCompany.id, origin: officialCompany.origin, path: '/updates/launch-available', title: 'Synthetic launch update', retrievedAt: iso(now - HOUR), hashCharacter: 'c' }),
    }),
    claim({
      id: 'demo-price-current', entityId: 'service:demo-cloud', entityType: 'service', entityLabel: 'Demo Cloud',
      topicId: 'business', kind: 'price', predicate: 'monthly price', value: 149,
      materiality: 'medium', actionability: 0.9, observedAt: iso(now - 2 * HOUR), validFrom: iso(now - 2 * HOUR),
      validUntil, geography: 'Europe', affects: ['budget', 'procurement'],
      evidence: evidence({ sourceId: officialCompany.id, origin: officialCompany.origin, path: '/updates/pricing-current', title: 'Synthetic pricing update', retrievedAt: iso(now - 2 * HOUR), hashCharacter: 'd' }),
    }),
    claim({
      id: 'demo-regulation-consultation', entityId: 'regulation:demo-ai-act', entityType: 'regulation', entityLabel: 'Demo AI Framework',
      topicId: 'regulation', kind: 'regulation', predicate: 'consultation status', value: 'open',
      materiality: 'critical', actionability: 0.98, observedAt: iso(now - 3 * HOUR), validFrom: iso(now - 3 * HOUR),
      validUntil, geography: 'European Union', affects: ['compliance', 'product-policy'],
      evidence: evidence({ sourceId: officialRegulator.id, origin: officialRegulator.origin, path: '/notices/consultation-open', title: 'Synthetic regulatory notice', retrievedAt: iso(now - 3 * HOUR), hashCharacter: 'e' }),
    }),
    claim({
      id: 'demo-grant-open', entityId: 'opportunity:demo-innovation', entityType: 'opportunity', entityLabel: 'Demo Innovation Fund',
      topicId: 'opportunities', kind: 'opportunity', predicate: 'application window', value: 'open',
      materiality: 'high', actionability: 1, observedAt: iso(now - 4 * HOUR), validFrom: iso(now - 4 * HOUR),
      validUntil, geography: 'Europe', affects: ['funding', 'growth'],
      evidence: evidence({ sourceId: officialFunding.id, origin: officialFunding.origin, path: '/calls/innovation-open', title: 'Synthetic funding call', retrievedAt: iso(now - 4 * HOUR), hashCharacter: 'f' }),
    }),
    claim({
      id: 'demo-supply-official', entityId: 'product:demo-device', entityType: 'product', entityLabel: 'Demo Device',
      topicId: 'supply', kind: 'availability', predicate: 'regional availability', value: 'available',
      materiality: 'high', actionability: 0.8, observedAt: iso(now - 90 * 60_000), validFrom: iso(now - 90 * 60_000),
      validUntil, geography: 'Europe', affects: ['procurement', 'delivery'],
      evidence: evidence({ sourceId: officialCompany.id, origin: officialCompany.origin, path: '/updates/device-available', title: 'Synthetic official availability update', retrievedAt: iso(now - 90 * 60_000), hashCharacter: '1' }),
    }),
    claim({
      id: 'demo-supply-secondary', entityId: 'product:demo-device', entityType: 'product', entityLabel: 'Demo Device',
      topicId: 'supply', kind: 'availability', predicate: 'regional availability', value: 'delayed',
      materiality: 'high', actionability: 0.8, observedAt: iso(now - 70 * 60_000), validFrom: iso(now - 70 * 60_000),
      validUntil, geography: 'Europe', affects: ['procurement', 'delivery'],
      evidence: evidence({ sourceId: secondaryPublisher.id, origin: secondaryPublisher.origin, path: '/reports/device-delayed', title: 'Synthetic industry availability report', retrievedAt: iso(now - 70 * 60_000), hashCharacter: '2' }),
    }),
  ];

  const definition: BriefingDefinition = Object.freeze({
    id: 'demo-personal-briefing',
    ownerId: 'demo:user',
    name: 'Personal Briefing',
    timezone: companion.timezone,
    deliveryLocalTime: companion.deliveryLocalTime,
    weekdays: Object.freeze([1, 2, 3, 4, 5, 6, 7]),
    channels: CHANNELS,
    maxCards: companion.maxCards,
    rules: Object.freeze([Object.freeze({
      id: 'demo-personal-rule',
      includeTopics: companion.topics,
      excludeTopics: Object.freeze([]),
      includeEntities: companion.entities,
      excludeEntities: Object.freeze([]),
      includeGeographies: Object.freeze([]),
      languages: Object.freeze(['en']),
      minMateriality: companion.minMateriality,
      weight: 2,
      onlyActionable: companion.onlyActionable,
    })]),
  });

  return {
    synthetic: true,
    companionVersion: COMPANION_VERSION,
    warning: 'Demonstration data only. No real-world claim is made.',
    definition: {
      name: definition.name,
      timezone: definition.timezone,
      deliveryLocalTime: definition.deliveryLocalTime,
      maxCards: definition.maxCards,
      topics: definition.rules[0]?.includeTopics ?? [],
      entities: definition.rules[0]?.includeEntities ?? [],
      minMateriality: companion.minMateriality,
      onlyActionable: companion.onlyActionable,
    },
    ...runBriefingOrchestra({
      definition,
      sources: [officialCompany, officialRegulator, officialFunding, secondaryPublisher],
      previousClaims,
      currentClaims,
      windowStart,
      windowEnd,
      now,
    }),
  };
}
