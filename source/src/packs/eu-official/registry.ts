import type { SourceRecord } from '../../core/contracts.js';
import type { EuOfficialFeedDefinition } from './contracts.js';

const reviewedAt = '2026-11-11T00:00:00.000Z';
const reviewExpiresAt = '2027-02-09T00:00:00.000Z';
const termsUrl = 'https://eur-lex.europa.eu/content/legal-notice/legal-notice.html';
const origin = 'https://eur-lex.europa.eu';

const source = (input: Readonly<{ id: string; name: string }>): SourceRecord => Object.freeze({
  id: input.id,
  name: input.name,
  origin,
  authority: 'official',
  role: 'regulator',
  languages: Object.freeze(['en']),
  pathRules: Object.freeze([Object.freeze({
    pathnamePrefix: '/legal-content/AUTO/',
    claimKinds: Object.freeze(['regulation'] as const),
    allowedQueryKeys: Object.freeze(['uri']),
    requiredQueryKeys: Object.freeze(['uri']),
  })]),
  rights: Object.freeze({
    automatedAccess: 'permitted',
    factualExtraction: 'permitted',
    commercialSummaries: 'attribution-required',
    attributionRequired: true,
    termsUrl,
    reviewedAt,
    reviewExpiresAt,
    note: 'Official EUR-Lex legal-document feed. Re-use requires source attribution; legal effect and applicability must be verified in the linked act.',
  }),
  limits: Object.freeze({
    minIntervalSeconds: 1800,
    maxRequestsPerDay: 48,
    timeoutMs: 8000,
    maxBytes: 500_000,
  }),
});

export const EU_OFFICIAL_SOURCES = Object.freeze([
  source({ id: 'eu-eurlex-commission-proposals', name: 'EUR-Lex — Commission proposals and related documents' }),
  source({ id: 'eu-eurlex-legislation', name: 'EUR-Lex — Parliament and Council legislation' }),
] as const);

export const EU_OFFICIAL_FEEDS = Object.freeze([
  Object.freeze({
    id: 'eu-commission-proposals',
    kind: 'commission-proposals',
    sourceId: 'eu-eurlex-commission-proposals',
    label: 'Commission proposals and related documents',
    url: 'https://eur-lex.europa.eu/EN/display-feed.rss?rssId=161',
    expectedChannelTitle: '4 - Commission proposals and related documents',
  }),
  Object.freeze({
    id: 'eu-parliament-council-legislation',
    kind: 'parliament-council-legislation',
    sourceId: 'eu-eurlex-legislation',
    label: 'Parliament and Council legislation',
    url: 'https://eur-lex.europa.eu/EN/display-feed.rss?rssId=162',
    expectedChannelTitle: '1 - All Parliament and Council legislation',
  }),
] as const satisfies readonly EuOfficialFeedDefinition[]);

export const euOfficialFeedById = (feedId: string): EuOfficialFeedDefinition | null =>
  EU_OFFICIAL_FEEDS.find((feed) => feed.id === feedId) ?? null;
