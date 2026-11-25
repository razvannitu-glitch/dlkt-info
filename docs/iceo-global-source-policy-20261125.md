# ICEO global source policy and bounded implementation — 2026-11-25

## Authorized product rule

The same rule applies to every country. Belgium and Russia were examples, not a country-specific implementation scope. ICEO should discover relevant original reporting and primary records as close to the event as justified by evidence, preserve their original language and provenance, and present eligible public information in the reader's chosen language. Reader location affects relevance; reader language affects presentation. Neither is permission to exclude an otherwise eligible foreign original.

A local publisher is not automatically the first publisher or an independent confirmation of its own claims. Original reporting, official statements and independent corroboration remain distinguishable. An official source is authoritative for what it issued, not automatically for every disputed claim. Reporting from abroad remains eligible. Publisher country, source language, reader location and the reported event's location are separate facts. Unknown geography stays unknown.

The product retains its existing scrollable cards and categories. This policy does not add UI controls, country-specific modes, a new orchestrator or an invented confidence score.

## Current source and corrected baseline

Repository razvannitu-glitch/dlkt-info, main b7c9186be6bcb4ba57b3eed0b231b69513494431, tree 8f34639a07603da2091e2356efc2c090c79b9a14, rechecked 2026-11-25. The recursive tree has no AGENTS.md. PR55 language preference work remains separate at 4e4da8255704297f18d3c0ea7bd84decd1082c0c; PR54 is not part of this change.

Correction to the preceding explanation: source/src/iceo/browser.ts initializes newsSourceScope to all and explicitly sends it to the continuation service. The API fallback edition only applies when the caller omits sourceScope. The homepage already includes eligible originals across source languages. Preserve that behavior. Translation of those originals remains unimplemented.

The current global discovery directory stages candidates; it never activates them. The active collector still uses reviewed configured feeds and an allowlist of original publisher origins. A country in a catalog is not a connected local feed, and a configured feed is not evidence of a successful current acquisition.

Two verified defects in the universal staging/review path are independently correctable. stageSourceCandidate assigns international scope without evidence. assessDiscoveryReview records that terms and robots were reviewed, but neither their decision nor an exact candidate-origin binding is required. A prohibited use can therefore look complete for human review. This is a review-accuracy defect, not a demonstrated acquisition bypass: activationAllowed is already always false.

## Increment and acceptance, fixed before code changes

Root is the sole writer. Independent reviewers read the raw diff. This increment changes only the two existing staging/review modules, their regression tests, this policy and required generated release metadata.

G1. Every newly discovered candidate starts with unknown scope and no asserted country. Observe multiple country-like hostnames and labels through stageSourceCandidate and qualifyDiscoveryBatch. Host suffix, name and index cannot manufacture geography.

G2. Review evidence identifies the exact candidate origin and robots URL. A different origin, www alias, malformed origin, or robot policy from another host remains blocked. External license or permission documents may be cited, but their origin alone cannot establish which publisher grants a requested use. The explicit source-origin binding is a reviewer assertion, not authenticated proof of permission.

G3. Both requested-use terms and automated-access robots decisions must explicitly be permitted. Prohibited, unknown, missing or invalid decisions remain blocked even when the review flags are true. Existing identity, evidence URL, requested-use and expiry requirements remain.

G4. Identical evidence requirements apply to every country and language. Evidence for one source cannot be reused for another by changing only the proposal. Incomplete or forged candidate state remains blocked. A complete checklist remains complete-for-human-review with activationAllowed false. No test or implementation makes a network request or activates a source.

G5. Strict compilation, meaningful positive/negative regression tests, complete existing source/release/package checks and independent raw-diff review pass on the exact final candidate. Preserve failures and exact identities. No weakened gate or fake live-country-coverage claim.

Knowledge is exact original/candidate identity with explicit unknown geography. Trust is the origin-bound evidence and separate permission/access verdicts. Action remains manual source admission through the established registry; this increment has no source-fetch or publication authority.

## Remaining requirements for the complete global outcome

Actual local-source expansion still needs publisher identity, relevant coverage, current terms/access decisions and real feed/original observations before promotion. Automatic discovery can propose candidates; it cannot override published restrictions or create licensing rights.

Event-local priority requires evidence tied to the exact report and event. Existing article-subject metadata covers sections and keywords, not event location. This increment must not infer event geography from publisher country or claim first-in-the-world detection.

Translations must be separate projections of canonical public fields, keyed by original identity/hash and target language. Keep originals, attribution, dates, Saved and comparisons intact. Use the existing NewsCorpusStore.lookup for supported news records; do not send private profile reasons or arbitrary browser text. Weather, utility and other non-news cards need their own legitimate localization path. A news-only translation test does not prove all cards are translated.

A real provider/account, supported target languages, accepted terms, bounded consumption and persistent reuse are required before translation activation. No configured provider was established by the current inspection. No provider key, subscription, paid/model call or new resource is activated here.

## Production observation and resource boundary

At 2026-11-25T18:14:20Z, the existing public collection was at revision 2734 with 656 cards and 51 source-health records, generated 15:52:45Z and last successfully published 15:52:47Z. Later observed worker leases expired; the last attempt was 17:32:36Z. These are dated database observations, not proof of a root cause or current recovery. Production remains on the base commit. Keep the outage separate from source-policy acceptance.

Use existing GitHub generation and verification workflows. One generation/verification attempt for the authored change; rerun a failed test only after a demonstrated correction. At most one retry of a transient read. No deployment, production database changes, source activation, CSS changes, new subscription or translation call in this increment. Stop optional checks once the relevant risks and existing gates are covered. Record the exact final evidence in the pull request.

## User clarification and independent review before acceptance

The user further clarified that editorial value includes achievements and useful developments with little media attention, including education competitions, artistic results, research, inventions and community work. Press popularity, commercial exposure or publisher homepage placement must not stand in for evidence of public value. Relevant first-party institutional records must be considered through the same global qualification path. This is not a positive-news-only filter: consequential adverse events remain relevant. Preliminary research, a patent and a clinically established result are different evidence states.

This increment does not yet change editorial ranking or connect additional institutional records. It makes no claim that low-visibility subjects are already comprehensively discovered. A future complete editorial implementation must demonstrate discoveries from real primary records, transparent relevance criteria, diverse subjects/geographies and accurate evidence labels without adding complexity to the existing cards.

The independent raw-diff review of eba0e6c142e59d81617d87946958f0f2b846fa64 found that a missing or forged candidate vertical was not rejected under G4. Revalidation is extended to reconstruct the complete proposal through qualifyDiscoveryBatch and compare its canonical fields. This preserves index-specific science and humanitarian verticals and avoids a duplicated validator. Add positive non-news-source regressions and negative vertical/index/provenance/observation checks. The first authored candidate is not accepted; evidence must name the corrected commit.

## Complete daily access and individual relevance

The user's worldwide ambition is a broad daily information collection, including worthwhile subjects that have not become mainstream news, with maximum practical satisfaction for each reader. All eligible information successfully acquired from the connected, reviewed sources should remain accessible through the existing categories and continuation flow. A daily opening selection is not a promise of exhaustive planetary coverage and must not be confused with the full accessible collection.

Personalization orders eligible information for a reader; it must not erase foreign sources solely because of language or hide every unfamiliar subject. Geographic coverage, topic diversity, actual source availability and unverified gaps must be measurable separately. A timestamp from collection cannot turn an older publication into news of the current day. Multiple reports of the same identified event may share one card while their originals remain accessible.

Absolute collection of every event on Earth and maximum satisfaction for every person cannot be guaranteed. Implementation and reporting must retain that limit without shrinking the user's ambition into a small fixed list. This policy increment does not claim that complete daily ingestion, editorial personalization or automatic translation has been delivered.
