# Reviewed source cards and temporal weather wording — 2026-11-24

This batch addresses concrete behavior observed in the official public reader at https://www.dlkt.ee/ after the source-supply release at commit 04b8ed41712968339a96b75a4bb6b46ac35a0251. It builds on the publisher-headline grouping change merged at a59abf61969bcdda68499b29a1c06b0f5a5d9cca.

## Observed problem and implementation

The live Descopera and Spotmedia cards contained a source citation, but integratePhotoHeadline moved the headline into a photograph figure above that citation. These sources had been admitted for title/date/link presentation only. The browser created an /api/article-photo placeholder for them even though the server photograph policy did not admit either publisher. This observation is not evidence that a publisher photograph was delivered.

The card renderer now checks the existing exact-origin pressReviewCitation policy before creating a photograph node. The citation remains immediately before the original headline. The shared-card renderer applies the same presentation policy before creating a photograph placeholder. Original titles, dates, homepage attribution and full-publication links remain intact. Other publishers retain their existing photograph behavior. No CSS or broad visual redesign is included in this corrective batch.

The observed Descopera original “Un lanț muntos din vremea Gondwanei se ascunde sub gheața din Antarctica” was incorrectly classified as Weather because the headline classifier matched “vremea”. Its publisher section is Istorie, which is not mapped to a single supported DLKT subject. Classification now masks the narrow temporal phrase “din vremea” in the comparison text only. Stored and displayed metadata remain original. Genuine weather wording, independent forecast evidence and explicit publisher weather sections remain available. The broad ambiguous phrases “pe vremea” and “in vremea” are deliberately not removed, because they can describe actual weather.

The page ordering policy advances from r5 to r6 because changed category inference can change counts and offsets for an existing corpus. Signed cursors from r4 and r5 expire before a corpus read; the reader can start a fresh edition. The corpus storage protocol and SQL schema do not change.

## Regression coverage

The existing offline browser QA exercises the built reader and real NewsPageService over a controlled corpus at 320, 360, 390, 430, 768 and 1440 pixels. Four reduced public-metadata originals from the reviewed Descopera and Spotmedia fixture join the existing three-source event, a distinct penalty and an English article: nine originals, seven stories. Dates and source-check times in this browser fixture are controlled, not live verification claims.

For every reviewed-source card, the browser regression measures a visible homepage citation before and geometrically above the exact original title, the full-publication link, and absence of a photograph figure or article-photo image. Existing event uniqueness, all original source links, language labels, complete city/date display, mobile navigation, horizontal overflow and tap-target checks remain active. Shared-page HTML tests check citation order and absence of original photograph requests. Taxonomy regressions cover the observed history title, stale weather hints, case and spacing variants, genuine weather phrasing and publisher-bound weather metadata. Signed cursor tests cover both prior page policies and current continuation.

The inventory in docs/iceo-owned-cards-inventory-20261124.md now distinguishes the visually confirmed live EUR/RON reference component from an unperformed audit of its provider integration. No balances, user records or financial advice are involved.

## Boundaries

This batch does not guarantee universal semantic deduplication, seven to ten unique stories in every category, universal publisher availability or account-synchronized reading history. It does not broaden source reuse permissions, introduce a paid provider or change billing. The two newly admitted publishers remain subject to the current RSS/original verification and promotion filtering implemented in PR45.
