# Reader action spacing and local-card balance — 2026-11-25

## Outcome and authority

The user supplied three Safari screenshots and explicitly requested readable, uncrowded button labels throughout DLKT INFO and equal spacing from the local-card top to its category label and from its bottom to the official-source button. Continue the existing verified-publication authorization. Root is the sole writer; an independent reviewer inspects the raw change. The earlier institutional-source investigation remains pending and is not source activation.

Canonical repository razvannitu-glitch/dlkt-info, branch main, commit f6b10f6e8bc16ff003cbd8390e06bf6df6ccedae, tree bd544a62d3030dde0e59732c60c43a9a7274b752, observed 2026-11-25 19:33:57 UTC. The recursive current tree contains no AGENTS.md. Changes are isolated on a new task branch.

## Reproduction before implementation

The actual public site at https://www.dlkt.ee/ was inspected in Chromium at a 1363 CSS-pixel viewport. The home-city button has computed padding 8px 0px 8px 0px and a 44px height. Both first local cards have a measured category-box top inset of 17px and source-button bottom inset of 9px. The final theme stylesheet sets local header top padding16px and action footer bottom padding8px; mobile reduces only the header to14px. The user's screenshots independently show the city-button hover fill touching its label and the same compressed footer spacing in Safari.

## Acceptance criteria fixed before implementation

S1. Text-bearing action controls retain visible internal space in their resting, hover and keyboard-focus states. The demonstrated home-city button has at least12 CSS pixels of inline padding, and no hover/focus operation changes its geometry. Icon-only controls retain their existing44px targets and accessible names rather than receiving text-layout rules that hide or crop their icons. Observe actual computed styles and painted text bounds in the existing Chromium fixture, including expanded controls.

S2. Each compact home-local utility uses a shared top/bottom inset. The top category line box and the lowest closed action row edge are equally inset within1 CSS pixel, including 320px,390px,768px and1440px widths. A long source label may wrap and grow; the source action and adjacent details control stretch within their row. Expanded details can extend the card, with preserved bottom padding and keyboard/source access, without falsely claiming that an internal CTA remains the final element.

S3. Complete labels remain readable, with no clipping, ellipsis, overlap or horizontal document overflow at the existing seven controlled widths320,360,390,430,440,768,1440px and the existing200% computed-font stress scenario. Existing first-useful-card density limits remain in force. Exercise Romanian, English and at least one longer or RTL supported locale through the actual locale controller. Keep touch targets at least44px. Record limitations: Chromium fixture metrics and text scaling do not claim physical Safari-device execution.

S4. Preserve the brand lockup, palette, photographs, content/provenance, language preference behavior, source acquisition, private account authority, database, payments and existing PR54 separation. Changes are limited to shared reader/header/action CSS as needed, targeted browser geometry verification and this contract. Generated SOURCE-PIN.json/release manifest and actually changed compiled assets may be imported only through the existing verified exporter. Do not introduce a new component framework, runtime dependency, source or paid service.

S5. Validate the exact final candidate through strict compilation, required application/package/release gates and the existing controlled-browser path. Independent review must inspect raw authored and generated differences. If publication gates pass, merge and deploy this exact accepted tree using the existing Vercel project and official domain. Read back the official build receipt and full changed CSS; then observe actual public button padding/local-card insets and visually inspect the result. A READY deployment alone does not satisfy this criterion.

Knowledge is the actual current DOM/CSS and original user screenshots. Trust is the dated measured baseline, independent scoped review and exact-head test/release evidence. Action is a reversible layout-only repository/release change under standing authorization; no account, source-registry or database mutation is involved.

## Finite resource boundary and recovery

At most five authored stylesheet files and one existing browser QA script, plus this contract and required generated metadata. Use existing dependencies and workflows. Allow at most two artifact-generation executions, two final-candidate browser executions and one exact-candidate release; an additional attempt requires a demonstrated cause and a recorded contract amendment. Source-specific primary research this turn has stopped after the delegated eight-request ESO review; no feed probe or source registration has run. No new model/provider request, subscription, external paid service or message to another person is authorized by this contract.

Preserve failed/skipped evidence. Do not relax existing geometry, source, security or release gates to obtain a pass. Stop optional tests once concrete risks and required gates are resolved. Read back every external mutation before reporting it complete.

## Observation record

Implementation and verification observations are added to the task PR after this contract; they do not rewrite the acceptance criteria above.
