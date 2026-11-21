# DLKT Info 0.9.12 — Stable personal selection

## Observed defect

A saved one-card briefing with three unchanged eligible publications selected A on the first visit, B on the second, A on the third and B on the fourth. The old comparison retained only displayed cards. Everything outside that display budget was promoted as absent from the preceding edition, even though the same source entries were available throughout. This was reproduced with validated isolated fixtures before modification, not inferred from a test count.

## Change

The optional `DailyEdition.comparison` contains the bounded, matched, grouped source metadata before the display budget and temporary suppression are applied. `records` remains the actual prepared selection. No article body, extra user identifier or inferred reading history is added. Both representations are validated, copied through field allowlists, and remain in the existing browser-only store. Full source metadata is limited to 5,000 entries and the existing 8 MB total representation limit. Selected entries must occur unmodified in the comparison representation.

Changes are detected against this source-check corpus, so a changed record outside the prior display budget can be prioritized. Previously selected unchanged cards stay stable. An older matched document is not promoted solely because it did not fit the prior brief. Newly arriving source entries are explicitly distinguished from newly published documents. A known alternative shown after temporary suppression or source-window removal is labelled available, not new.

Old stored editions without comparison are accepted. Their next complete check creates the comparison corpus without pretending that previously untracked entries are known new arrivals. Partial or failed selected sources and identity conflicts do not overwrite the last complete saved baseline. Existing compare-and-swap protection remains unchanged. This is comparison against the previous complete source check, not an unlimited monitoring history and not proof that a person read any card. Changes beyond a selected display budget are not a guaranteed alert service.

## Preserved scope

No stylesheet, HTML layout, URL route, source provider, account, cloud data store, payment, automatic email, telemetry destination or background scheduler is introduced. Both the confirmed-city reader and the topic reader remain intact. No claims of retention or revenue are derived from these fixes.

## Verification

Pure tests cover repeated identical checks, tight reading budgets, source changes outside that budget, true new source entries with old publication dates, source disappearance, identity conflicts, suppression, query filtering, serialization, legacy migration, corrupt corpora and field allowlists. A retained browser test repeats the saved one-card flow against real source metadata and separately injects isolated changed-title and outage responses. Synthetic content never enters the public collector. Existing entry, personal, expiry and HTTP/API regressions are rerun. Browser tests are Chromium, not Safari or a physical iPhone.
