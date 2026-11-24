# DLKT reader redesign — execution contract

Base: `f8b3c7e0e66691e411e5c29cb135fe27da637001`. Production: https://www.dlkt.ee/. Requested by Razvan on 24 November 2026. This change implements a substantial responsive visual upgrade in the existing repository and deployment, with the DLKT mark and North Ledger palette retained.

## User outcome

The reader reaches useful content sooner. A compact, aligned masthead and context band lead to one readable news stream. Category is directly selectable; period and original-language/source options stay available in a native Filters disclosure. Local utility summaries expose their complete title, relevant period or next action, publisher and official source. Full information and provenance remain available in an accessible native disclosure. Two local records lead the page; further local records remain available in a labelled disclosure with the real remaining count. News cards use calm paper surfaces and clear typography; the brand colors remain in the identity, controls, utility context and owned DLKT cards.

## Protected behavior

Keep full original news titles, publisher citation, publication dates, original language, canonical links, source-group membership and all group links. Descopera and Spotmedia remain title/date/link-only with publisher citation above title and no image request. Do not change ingestion, category counts, semantic grouping, publisher balancing, pagination, source budgets, legal approval, authentication or billing. Preserve saved reading, source-expiry semantics, existing menu breakpoint at 1152px, focus behavior, both reader themes, reduced motion and the synchronous theme bootstrap before CSS. reader-theme.css remains the last stylesheet. The six surface IDs remain stable; the visual role of a swatch on a news card is separated from utility and owned-card surfaces.

## Implementation boundary

Root is the sole writer of UI files. A separate QA writer may change only scripts/qa-browser.mjs, which root integrates and reviews. Expected UI edits are source/public/iceo.html, source/public/editorial-cards.css, source/public/reader-theme.css, source/src/iceo/browser.ts source/src/local/card-node.ts, source/src/local/presentation.ts and source/src/glance/browser.ts. Ordinary headlines are removed from the moving ribbon; the existing context dialog retains its source links and the weather/currency buttons retain their dialogs. Generated browser assets, source pin and release manifest are produced only by the existing verified generation workflow. No new project, provider, hosted site, package dependency, remote asset or workflow is introduced.

## Acceptance and evidence

Run the existing complete release gates and the existing real Chromium QA at 320, 360, 390, 430, 768 and 1440 CSS pixels. Extend the controlled fixture through the actual local API contracts so two local utility cards are present. Preserve every existing grouping, citation and source rule. Check full text geometry, horizontal reflow, visible controls of at least 44px, actual tablet menu breakpoint and keyboard Escape/focus restoration. Check actual Night rendering at 390 and 1440px. With the controlled Bucharest fixture, first useful card must start at or before 620px at320 and550px at390; first editorial card after the two compact local cards must start at or before1100px at390. Expanded details may grow naturally and cannot clip content. Record measured positions instead of treating these targets as achieved.

Inspect the actual staged/live page, including a photo card, a citation-only card, grouped sources, expanded local utility and both themes. Independent raw-source review precedes integration. Verify the exact tested head, deployed SHA, release receipt and official alias separately. Report only checks actually executed. Category depth of7–10 distinct stories per category and universal semantic deduplication are not claims of this visual release.

## Bounded work

One generation candidate, required repair iterations for concrete failures, one final branch and PR. Reuse the existing CI and Vercel release procedure; no shell commands. Do not repeat broad tests after a sufficient exact-head pass. Any new data or editorial problem discovered during visual QA is recorded separately unless the redesign directly caused it.

## Preflight review disposition

Independent raw review of f4e5ae2d33b7a4c6da50fb47c82572f1b79a2cbe found two P1 interaction issues and one P2 utility-content issue. The draft now exposes the existing context dialog through a visible labelled 44px information action; the filter panel closes when keyboard focus moves outside and on Escape, restoring the summary action; compact utility summaries show exact forecast measurements or identified CMTEB sectors, with complete unknown wording used as fallback. The original paragraphs, source boundaries and evidence remain in the disclosure. QA asserts these specific interactions and known-summary fallback behavior. No successful execution is claimed by this disposition; CI and visual evidence follow on the generated candidate.
