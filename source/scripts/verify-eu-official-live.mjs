import { mkdir, writeFile } from 'node:fs/promises';
import { SourceRegistry } from '../.build/src/core/index.js';
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
const results = [];
for (const definition of EU_OFFICIAL_FEEDS) {
  const fetched = await fetchEuOfficialFeed({ definition });
  if (fetched.status !== 'modified') throw new Error(`LIVE_BASELINE_NOT_MODIFIED:${definition.id}`);
  const parsed = parseEuOfficialRss(definition, fetched.body, fetched.retrievedAt);
  if (parsed.entries.length < 1 || parsed.entries.length > 200) throw new Error(`LIVE_COUNT:${definition.id}`);
  const now = Date.parse(fetched.retrievedAt);
  const claims = parsed.entries.map((entry) => euOfficialEntryClaim(entry, fetched.retrievedAt));
  if (!claims.every((claim) => registry.authorizeClaim(claim, now))) throw new Error(`LIVE_PROVENANCE:${definition.id}`);
  results.push({
    feedId: definition.id,
    sourceId: definition.sourceId,
    status: fetched.status,
    contentTypeVerified: true,
    retrievedAt: fetched.retrievedAt,
    channelPublishedAt: parsed.channelPublishedAt,
    bodyBytes: Buffer.byteLength(fetched.body, 'utf8'),
    bodyHash: fetched.bodyHash,
    entryCount: parsed.entries.length,
    uniqueCelexCount: new Set(parsed.entries.map((entry) => entry.celexId)).size,
    firstCelexId: parsed.entries[0]?.celexId ?? null,
    lastCelexId: parsed.entries.at(-1)?.celexId ?? null,
    authorizedClaims: claims.length,
  });
}
const report = {
  product: 'dlkt-info',
  pack: EU_OFFICIAL_PACK_ID,
  packVersion: EU_OFFICIAL_PACK_VERSION,
  verifiedAt: new Date().toISOString(),
  officialFeeds: results,
  totalEntries: results.reduce((sum, feed) => sum + feed.entryCount, 0),
  noPublicCardsCreated: true,
  databaseChanged: false,
};
await mkdir('audit/eu-official', { recursive: true });
await writeFile('audit/eu-official/live-verification.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
