import type { Topic } from './topics.js';
export type { Topic } from './topics.js';
/** Public, source-backed publication metadata. No account or preference data. */
export const ICEO_VERSION = 'iceo-primary-mesh-1' as const;
export type SourceState = 'verified' | 'partial' | 'stale' | 'unavailable';
export interface SourceDefinition {
  readonly id: string; readonly label: string; readonly publisher: string;
  readonly topic: Topic; readonly adapter: 'ecb-rss' | 'cellar-sparql' | 'github-releases' | 'reviewed-feed' | 'news-index';
  readonly endpoint: string; readonly repo?: string; readonly homepage: string;
  readonly termsUrl: string; readonly attribution: string; readonly scope: string;
  readonly rightsCheckedAt: string; readonly rightsReviewBy: string;
  readonly feed?: Readonly<{
    format: 'rss' | 'atom'; title: string; homeOrigin: string; homePath?:string; homeUrl?:string;
    credits?:'globalvoices'|'creator'|'publisher'; licenseUrl?:string; excludeCategories?:readonly string[];
    articlePaths: readonly string[]; articleOrigins: readonly string[]; allowHttpLinks?: boolean;
    trackingQueryKeys?: readonly string[];
    dateField: 'pubDate' | 'updated' | 'a10:updated'; dateLabel: 'Published' | 'Updated';
    requireDateTimezone?: boolean;
    summary: 'description' | 'summary'; summaryMode?:'first-paragraph'; boundary: string;
    refreshSeconds: number; windowDays: number;
  }>;
}
/** Publisher-provided coverage or declared publisher scope, never personal affectation. */
export interface ArticleContext {
  readonly countries: readonly {readonly code:string;readonly name:string}[];
  readonly basis: 'publisher-category' | 'publisher-scope' | 'unspecified';
  readonly label: string;
  readonly boundary: string;
}
export interface EvidenceCard {
  readonly id: string; readonly identity: string; readonly title: string;
  readonly topic: Topic; readonly kind: 'publication' | 'legal-document' | 'software-release' | 'procurement-notice';
  readonly sourceUrl: string; readonly publisher: string; readonly sourceIds: readonly string[];
  readonly date: string; readonly dateLabel: 'Published' | 'Document date' | 'Updated';
  readonly observedAt: string; readonly contentHash: string; readonly boundary: string;
  readonly deadline: string | null; readonly version: string | null;
  readonly attribution: string; readonly sourceState: Exclude<SourceState, 'unavailable'>;
  /** Complete bounded publisher excerpt from the reviewed feed, never generated prose. */
  readonly summary?: string;
  readonly byline?:string; readonly licenseUrl?:string;
  readonly context?:ArticleContext;
}
export interface Extraction {
  readonly cards: readonly EvidenceCard[]; readonly rejected: number;
  readonly windowed: boolean;
}
export interface SourceHealth {
  readonly id: string; readonly label: string; readonly publisher: string; readonly topic: Topic;
  readonly state: SourceState; readonly checkedAt: string; readonly verifiedAt: string | null;
  readonly count: number; readonly rejected: number; readonly error: string | null;
  readonly retryAt: string | null; readonly scope: string; readonly termsUrl: string;
  readonly windowed: boolean;
}
export interface SourceResult { readonly health: SourceHealth; readonly cards: readonly EvidenceCard[] }
export interface IceoSnapshot {
  readonly version: typeof ICEO_VERSION; readonly product: 'dlkt-info'; readonly productVersion: string;
  readonly mode: 'current-official-records' | 'current-source-records'; readonly generatedAt: string;
  readonly state: 'ready' | 'partial' | 'unavailable'; readonly sources: readonly SourceHealth[];
  readonly cards: readonly EvidenceCard[]; readonly conflictCount: number; readonly duplicateCount: number;
  readonly deltaAvailable: false; readonly scheduledDelivery: false; readonly accountPersistence: false;
  readonly coverage: readonly Topic[];
}
