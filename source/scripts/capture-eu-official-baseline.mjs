import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { SourceRegistry } from '../.build/src/core/source-registry.js';
import {
  EU_OFFICIAL_FEEDS,
  EU_OFFICIAL_PACK_ID,
  EU_OFFICIAL_PACK_VERSION,
  EU_OFFICIAL_SOURCES,
  euOfficialEntryClaim,
  fetchEuOfficialFeed,
  parseEuOfficialRss,
} from '../.build/src/packs/eu-official/index.js';

const registry = new SourceRegistry(EU_OFFICIAL_SOURCES);
const feeds = [];
for (const definition of EU_OFFICIAL_FEEDS) {
  const fetched = await fetchEuOfficialFeed({ definition });
  if (fetched.status !== 'modified') throw new Error(`BASELINE_NOT_MODIFIED:${definition.id}`);
  const parsed = parseEuOfficialRss(definition, fetched.body, fetched.retrievedAt);
  const observed = Date.parse(fetched.retrievedAt);
  const entries = parsed.entries.map((entry) => {
    const claim = euOfficialEntryClaim(entry, fetched.retrievedAt);
    if (!registry.authorizeClaim(claim, observed)) throw new Error(`BASELINE_UNAUTHORIZED:${entry.celexId}`);
    return {
      feedId: entry.feedId,
      feedKind: entry.feedKind,
      sourceId: entry.sourceId,
      celexId: entry.celexId,
      documentTitle: entry.documentTitle,
      creator: entry.creator,
      link: entry.link,
      guid: entry.guid,
      publishedAt: entry.publishedAt,
      fingerprint: entry.fingerprint,
    };
  });
  feeds.push({
    feedId: definition.id,
    feedKind: definition.kind,
    sourceId: definition.sourceId,
    label: definition.label,
    retrievedAt: fetched.retrievedAt,
    channelPublishedAt: parsed.channelPublishedAt,
    bodyHash: fetched.bodyHash,
    entries,
  });
}
const capturedAt = feeds.map((feed) => feed.retrievedAt).sort().at(-1);
if (!capturedAt) throw new Error('BASELINE_CAPTURE_CLOCK_MISSING');
const unsigned = {
  version: 'dlkt-info-eu-release-baseline-1',
  product: 'dlkt-info',
  pack: EU_OFFICIAL_PACK_ID,
  packVersion: EU_OFFICIAL_PACK_VERSION,
  capturedAt,
  feeds,
  entryCount: feeds.reduce((sum, feed) => sum + feed.entries.length, 0),
};
const baselineHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
const baseline = { ...unsigned, baselineHash };
await mkdir('src/delta-official', { recursive: true });
await writeFile(
  'src/delta-official/baseline.generated.ts',
  `import type { EuReleaseBaseline } from './contracts.js';\n\nexport const EU_RELEASE_BASELINE: EuReleaseBaseline = ${JSON.stringify(baseline, null, 2)};\n`,
  'utf8',
);
console.log(JSON.stringify({
  output: 'src/delta-official/baseline.generated.ts',
  capturedAt,
  feeds: feeds.map((feed) => ({ id: feed.feedId, entries: feed.entries.length, bodyHash: feed.bodyHash })),
  entryCount: baseline.entryCount,
  baselineHash,
}));
