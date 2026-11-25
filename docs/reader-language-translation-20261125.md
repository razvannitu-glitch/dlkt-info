# DLKT reader language and all-card translation — 2026-11-25

## Authorized outcome

Use the current approximate IP-country language when the reader has no prior explicit language choice. A manual choice always wins and survives later location/browser changes and reloads where browser storage is available. Multilingual countries use a supported local browser preference; an unavailable national language falls through to browser preferences and then English. A city chosen for information relevance must not change reading language.

The full requested product outcome additionally requires public card titles and existing descriptions from any source country to be readable in the selected language, with translation identified and the exact original still accessible. Selecting a reading language must ultimately not limit source countries.

## Canonical source and ownership

Repository razvannitu-glitch/dlkt-info, main b7c9186be6bcb4ba57b3eed0b231b69513494431, tree 8f34639a07603da2091e2356efc2c090c79b9a14, checked on 2026-11-25. No AGENTS.md exists in this recursive tree. PR54 remains an independent ready, unmerged Wallet-to-Saved change and is not included here.

Root is the sole writer. Independent source and provider reviews are read-only. This contract precedes implementation; subsequent evidence must name its exact candidate and environment.

## Confirmed implementation gaps

The resolver currently gives a URL language priority over a saved manual choice. It also returns English directly for unsupported national languages instead of trying the browser. The browser language controller treats a newly selected home city as a language decision.

The current country-first interface does not translate publisher articles. README.md and source/CONTEXTUAL-EDITION.md explicitly document no automatic article translation. NewsPageService's edition source scope filters original source languages; its existing all scope provides a reusable multilingual source path. Public-source records and source comparisons preserve originals.

Current production environment metadata has no translation-provider credential configured. Only variable names, types and targets were inspected, without decrypting credentials. No external translation account, credit allowance, provider terms or spending limit has been established by the current request. Completing live automatic translation is therefore dependency-blocked, not equivalent to passing locale tests.

## Executable acceptance

A1. A valid saved/manual locale wins over conflicting, malformed and duplicated URL language values, late country/browser hints and Back/Forward presentation. Observe the actual compiled resolver and controller. Keep URL validation strict for readers without a manual choice. A valid explicit language link remains a temporary first-entry choice when no manual preference exists; it never becomes a saved preference automatically.

A2. With no explicit choice, the valid country default wins; supported language choices in multilingual countries use browser order. Unsupported national language or an unknown country falls through to supported browser preferences, then English. Observe RO, FR, CA, CH, EE and unknown-region cases.

A3. Current estimated country/city evidence may initialize language. Manual city selection, restored cities, Explore query parameters and malformed events cannot change it. A late automatic hint remains usable after a manual city choice. Observe unchanged URL geography, hash, original source nodes, focus and unrelated preferences.

A4. Manual choices persist through actual browser reloads and conflicting entry URLs. When storage is denied, the current session remains usable and no extra storage, network, profile or account operation occurs. The current URL still carries a manual choice for compatible reloads.

A5. Exact final candidate passes strict compilation, relevant regression tests, required complete release/source integrity and existing Chromium QA. Review the raw diff independently. Do not relax source preservation, security, layout or identity gates.

## Full translation acceptance, still required

B1. A real connected translation provider must translate the supported public fields into the selected supported target language. Output must be a separate projection keyed by exact original identity/content hash and target locale, with source URL, publisher, source dates and original content unchanged. Preserve the source record for Saved and comparisons. Existing titles must not be expanded into invented descriptions.

B2. Serve foreign-source cards through the existing all-source scope only together with a working translation presentation. Reject stale revisions, wrong-target results and late responses after a locale change. Surface unavailability honestly. Do not disguise unmodified source text as a translation, silently drop foreign stories to claim completeness, or use fixture output as live coverage evidence.

B3. Send only server-resolved public card fields to the provider, not arbitrary submitted text or private profile-derived explanations. Keep keys server-side. Establish the real service account, accepted terms, supported targets, bounded quota/cost and durable reuse strategy before activation. Verify at least Romanian and English with real public inputs and failure cases before claiming production completion.

## Scope and resource boundary

This independently executable increment changes the two existing i18n controllers, their existing tests, one bounded Chromium scenario, accurate reading-language documentation and generated assets/pin/manifest. No CSS, branding, source acquisition, publication, database or provider activation. The source-language filters remain unchanged until B1–B3 can be fulfilled coherently.

Reuse the existing generation and test workflows. At most one retry of a transient read; a failed test is rerun only after a concrete correction. Zero paid translation/model calls, zero subscription activation and no production publication in this increment. Do not change a gate merely to mark this incomplete full feature as passed.

## Trust and action boundaries

Knowledge uses existing country evidence, catalog codes and immutable public records. Trust requires exact-commit test logs and an independent raw-diff review, with the provider dependency and live translation absence explicitly retained. Action is the explicit language selection stored in the existing browser preference. Account identity, delivery, billing and private profile mutations are inapplicable to that action and remain out of scope.

## Evidence-driven scope clarification before final acceptance

The first generated verification at b506c8936808f52a64913cd04633c0afe02252b1 passed 2538/2540 application tests and all 52 packaging tests. The two failing country-edition assertions equated the final non-null display language directly with localeFromCountry's now-nullable intermediate result. The existing country profile correctly retains its final English fallback when it has no native locale. Extend this increment only to those two expectations in source/tests/country-editions.test.mjs, plus an explicit regression that an Estonian country profile preserves a Romanian reader choice while honestly reporting its unsupported national default. Every country-count, provenance, availability and immutable-data assertion remains. No country-edition production behavior changes.
