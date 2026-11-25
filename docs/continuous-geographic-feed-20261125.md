# Continuous geographic reader and source breadth — 2026-11-25

## User-authorized outcome

After the spacing correction, the user explicitly rejected the “Mai multe informatii locale” disclosure and requested continuous cards in the agreed local / city / country / international progression. A subsequent message reaffirmed much broader coverage of useful sources on that same progression. The standing authorization to publish a verified version remains in force.

Canonical baseline is main1bd2266c7d0b8974450f35298c7db08ca13e9de9, tree06a458d8910920e6e22fa46058d8204084fdccf1, observed2026-11-25 20:15:27UTC. PR57 spacing is already deployed and its public stylesheet/receipt/19px local margins and live checks verified. This increment preserves it.

## Current-source findings

browser.ts renders only the first2 operational local cards directly and puts the remainder in details#home-local-more. selectHomeLocal additionally caps support selection at12 and at2 per kind when local news is present. The accepted local snapshot is already bounded at60 records, with source identity, individual expiry and event eligibility enforced.

NewsPageService already combines city originals and national/international publications in one server edition. Its ordering policy currently gives one local/national opening then mixes all geographies. “National” means reviewed publisher country; it does not prove an event occurred in that country. Checked city records supply city membership. No neighbourhood/precise user-location classification is available and none will be invented.

## Fixed acceptance criteria

F1. Render every eligible operational card retained by the existing validated local snapshot and CMTEB overview grouping directly in the local grid, once, in stable kind-diverse order. Remove both the collapsed wrapper and the homepage-only12/two-per-kind display omissions. Preserve all source bounds (maximum60 snapshot records), validity, unique IDs, event semantics, operator grouping and honest unavailable/empty states. Individual card evidence can remain expandable.

F2. Order the complete grouped news edition as city-local, national-publisher, international-publisher bands, preserving all groups and originals. Maintain category and publisher diversity within each band. Unknown event geography is not reclassified from publisher country. Local operational cards precede these news bands. Existing geographically neutral knowledge cards remain explicitly distinguished and do not alter relative news order.

F3. Perform ordering before category filtering and20-story pagination. Category filtering is a subsequence of the complete order. Bump the signed cursor order revision so old offsets expire instead of reading a different ordering. Preserve grouped-source access, counts, expiry, signatures and stable identities. Do not reorder a retained, already-read prefix on refresh; the new hierarchy applies to a newly started edition and its continuation.

F4. Preserve the PR57 button/card spacing, full labels,44px targets, RTL/language behavior, palette, sources/provenance, photographs, account/privacy boundaries, database and paid services. This reader increment changes no source registration or rights claim. Source admission is a separate evidence gate, not a nominal source-count increase.

F5. Replace only tests that explicitly asserted the now-rejected interleaving policy with meaningful full-band progression and within-band diversity tests across multiple pages. Retain determinism, immutability, original identity, all-original reachability, category projections, invalid-input and old-cursor rejection checks.

F6. Keep the existing two-local-card browser scenario and its density/spacing limits unchanged. Add a controlled scenario with the same utilities plus8 actual-schema-valid ARCUB fixture records. Assert all expected local IDs occur exactly once, visibly outside a closed details ancestor, before the news grid, with normal inter-card/section spacing. Apply current action-spacing and source/title checks. A many-card scenario measures the editorial gap after the final local card instead of imposing the two-card fixture's absolute editorial Y-limit; its first-useful-card limit stays unchanged. Verify320/390/1440 and at least one open evidence interaction.

F7. Require strict compilation, complete application/package/release gates, exact-head controlled browser evidence, independent raw-diff review, merge-tree equality and one official release. Read back the official receipt/changed compiled assets and visually confirm the absence of the fold plus the continuous cards. Do not claim physical Safari execution or universal worldwide source coverage.

## Source breadth work and boundaries

The production read-only check at20:09:59UTC reported51/51 registered sources available,537 publication records and664 cards; these are existing acquisitions, not newly added publishers or proof of full coverage. Research of ESO/CORDIS/CERN/Europeana plus a final targeted eLife/PLOS pass is limited to23 primary requests in this continuation. No guessed feed becomes active. At most one bounded technical source probe may follow for officially documented endpoints. Any admission requires verified transport/rights/identity/date semantics plus its own explicit forward schema contract, tests, deployment ordering and live evidence. Current-source discovery is separate from successful activation.

Root is the sole writer. Independent agents provide read-only audits and code proposals. Reader scope: four product TypeScript modules, up to four existing relevant test modules, the existing browser QA script, this contract and verified generated metadata/assets. Allow two generation runs, two final-candidate browser executions and one release for this reader increment. Additional attempts require a concrete failure cause and a recorded amendment; do not weaken gates to pass. No shell, new dependencies, paid provider/subscription, external messages or other project changes are needed.
