import {DAILY_FEEDS} from './daily-feeds.js';
import {CONSUMER_FEEDS} from './consumer-feeds.js';
import type { SourceDefinition } from './contracts.js';
import {GENERAL_FEEDS} from './general-feeds.js';
import { REVIEWED_FEEDS } from './reviewed-feeds.js';
import { NEWS_SOURCES } from './news-sources.js';
const rights = { rightsCheckedAt: '2026-11-14', rightsReviewBy: '2027-02-14' } as const;
const ecb = {
  ...rights, adapter: 'ecb-rss', publisher: 'European Central Bank',
  homepage: 'https://www.ecb.europa.eu/home/html/rss.en.html',
  termsUrl: 'https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html',
  attribution: 'Source: European Central Bank. Original information is available free of charge on the ECB website. Listing metadata only; no investment advice.',
} as const;
/** Every endpoint is operator-reviewed. Users cannot supply outbound URLs or queries. */
export const ICEO_SOURCES: readonly SourceDefinition[] = Object.freeze([
  { ...rights, id: 'eu-law', label: 'EU legal documents', publisher: 'EU Publications Office', topic: 'regulation', adapter: 'cellar-sparql', endpoint: 'https://publications.europa.eu/webapi/rdf/sparql', homepage: 'https://op.europa.eu/en/web/cellar/cellar-data', termsUrl: 'https://eur-lex.europa.eu/content/legal-notice/legal-notice.html', attribution: 'Source: EU Publications Office / Cellar. EUR-Lex metadata: CC0. Document date is not the publication or effective date.', scope: 'Recent English-language legal metadata, last 14 days; at most 100 records per acquisition, not comprehensive legal coverage.' },
  { ...ecb, id: 'ecb-news', label: 'ECB publications', topic: 'business', endpoint: 'https://www.ecb.europa.eu/rss/press.html', scope: 'Current ECB press feed; titles and source links, not independently corroborated conclusions.' },
  { ...ecb, id: 'ecb-statistics', label: 'ECB statistics', topic: 'business', endpoint: 'https://www.ecb.europa.eu/rss/statpress.html', scope: 'Current ECB statistical release listings. Dates refer to publication, not the measurement period.' },
  { ...ecb, id: 'ecb-procurement', label: 'ECB procurement notices', topic: 'opportunities', endpoint: 'https://www.ecb.europa.eu/rss/procurements.html', scope: 'Current procurement feed, including notices and awards. Listing does not establish eligibility or an open application period.' },
  { ...rights, id: 'nextjs', label: 'Next.js releases', publisher: 'Vercel / Next.js maintainers', topic: 'technology', adapter: 'github-releases', repo: 'vercel/next.js', endpoint: 'https://api.github.com/repos/vercel/next.js/releases?per_page=30', homepage: 'https://github.com/vercel/next.js/releases', termsUrl: 'https://github.com/vercel/next.js/blob/canary/license.md', attribution: 'Source: official vercel/next.js release metadata. Names, tags and dates only; release notes are linked, not republished.', scope: 'Non-draft, non-prerelease semantic-version releases in the latest 30 repository records; not a complete release history.' },
  { ...rights, id: 'nodejs', label: 'Node.js releases', publisher: 'Node.js maintainers', topic: 'technology', adapter: 'github-releases', repo: 'nodejs/node', endpoint: 'https://api.github.com/repos/nodejs/node/releases?per_page=30', homepage: 'https://github.com/nodejs/node/releases', termsUrl: 'https://github.com/nodejs/node/blob/main/LICENSE', attribution: 'Source: official nodejs/node release metadata. Names, tags and dates only; release notes are linked, not republished.', scope: 'Non-draft, non-prerelease semantic-version releases in the latest 30 repository records; not a security support or upgrade recommendation.' },
  ...REVIEWED_FEEDS,
  ...GENERAL_FEEDS,
  ...CONSUMER_FEEDS,
  ...DAILY_FEEDS,
  ...NEWS_SOURCES,
]);
export function sourceRequest(source: SourceDefinition, now: number): URL {
  const registered = ICEO_SOURCES.find((entry) => entry.id === source.id);
  if (!registered || JSON.stringify(registered) !== JSON.stringify(source)) throw new Error('SOURCE_NOT_REGISTERED');
  if (source.adapter === 'news-index') throw new Error('SOURCE_REQUIRES_EDITORIAL_DISCOVERY');
  if (new Date(now).toISOString().slice(0,10) > source.rightsReviewBy) throw new Error('RIGHTS_REVIEW_EXPIRED');
  const url = new URL(source.endpoint);
  if (source.adapter === 'cellar-sparql') {
    const until = new Date(now).toISOString().slice(0,10);
    const since = new Date(now - 14 * 86400000).toISOString().slice(0,10);
    const query = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> SELECT DISTINCT ?work ?celex ?date ?title WHERE { ?work cdm:work_date_document ?date ; cdm:resource_legal_id_celex ?celex . FILTER(?date >= "${since}"^^xsd:date && ?date <= "${until}"^^xsd:date) ?expression cdm:expression_belongs_to_work ?work ; cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> ; cdm:expression_title ?title . } ORDER BY DESC(?date) ?celex LIMIT 100`;
    url.search = new URLSearchParams({ query, format: 'application/sparql-results+json' }).toString();
  }
  return url;
}
