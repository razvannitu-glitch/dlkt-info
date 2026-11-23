# Daily editions and knowledge cards

Implementation contract based on d429372b9ef9579c460fdfdd1cddcb79b93393d4.

Canonical repository: razvannitu-glitch/dlkt-info. Public destination: https://www.dlkt.ee/.

## Approved product decisions

The user selected EUR 6.99 per month on 23 November 2026 (Europe/Bucharest). Seven days of unlimited trial access is the planned offer. Checkout, subscriptions and trial entitlements are not active. A browser preference or editable profile must never grant paid access. Current news and the knowledge preview remain free until the billing and consumer-contract flows are implemented and verified.

The news reader offers a continuous stream. Twenty is a transport page size, not a commercial or editorial total. Today uses the selected validated city's calendar date and time zone. Recent retains the existing source eligibility windows. Publication date, source-check time, publisher origin and event location have distinct meanings.

Did you know is a separate mode of the same reader and a light insertion in the news stream. Original short explanations, useful connections, primary-source links and review timestamps form a finite curated preview. The preview uses existing IPTC category identifiers, with 15 cards across 8 populated categories. It does not claim all categories already contain content or that an autonomous fact-generation service is running. Encyclopedic information is never presented as a newly reported event. Source documents and images retain their own rights.

## Acceptance

Today is derived on the server from the validated city's time zone. Requests cannot supply arbitrary day boundaries. Signed cursor version 4 pins the period and day; page protocol version 3 exposes them. The day-end boundary expires the cursor. Recent preserves existing behavior. Tests cover partial-hour offsets,23/25-hour civil days, midnight expiry and 270 eligible articles across 14 transport pages. Runtime authorization and validation remain server-side.

Country and language selection use the common city/country path. National publisher priority is based on verified publisher provenance; it does not invent an event location. The release adds English-language profiles for already admitted Al Jazeera and SCMP paths, without enabling a new host, feed, language, database permission or paid provider. There are 22 explicit profiles covering 13 country/territory codes, plus the existing South African official source. This is 14 configured provenance codes, not 14 guaranteed live native-language editions.

The utility band keeps the date, city/country, Use my location, Weather & rates, language and theme in a compact main row. A secondary row exists only when actual weather or ECB values are available. Expiring controls transfer focus before hiding when necessary. No empty breaking-news ticker or invented alert is introduced.

Knowledge cards contain original English, Romanian and Italian copy. Other interface languages explicitly fall back to English content. All links use reviewed primary origins. Text rendering uses textContent. Cards carry a review date, future re-review deadline, revision and canonical share link. Category rounds avoid repetition until all currently available categories have been used. Masonry preserves DOM reading order. The finite collection is never recycled to imitate fresh content.

The user selected one knowledge card in every 23 displayed cards: 22 original news records, then one knowledge card at positions 23, 46, 69 and so on. This projection preserves every original news object, news ordering, counts and signed cursors. It uses an immutable selected sequence throughout the current edition, including 20-record page boundaries. Inserted knowledge IDs are not selected again when changing editions in the same loaded reader. With fewer than 22 news records or an exhausted checked catalogue, news continues without fake filler.

Geography belongs to the verified fact, never to its publisher. Selection first uses the selected city, then facts in the same country, then clearly labeled general knowledge. Another-city national fallback retains its true city label. This release includes one verified Turin fact and one Bucharest fact; it does not claim worldwide local-fact coverage or region-level metadata. Other-country local facts are excluded from this inline selection. No continuous GPS or extra geolocation permission is needed.

The planned EUR 6.99 monthly offer and 7-day trial are visible, together with the fact that payments and trial activation are not open. There is no billing call, browser entitlement, fake checkout button or charge in this release.

Strict TypeScript compilation, full release verification, packaging import closure, independent review, exact-commit CI and live browser checks are required before a completion claim.

## Evidence scope and limits

No paid provider activation, terminal, domain/auth change, secret read or SQL mutation is part of this release. Existing build, generation and publication mechanisms are used. File ownership is isolated between contributors.

The live corpus retains at most 5000 records or 8 MiB. Global news must currently be published within a rolling 24-hour window and checked within one hour; local eligibility follows its separate policy. A Today projection cannot recover records already excluded from that corpus, including the earliest hour of a 25-hour civil day. A complete persistent daily archive requires coordinated discovery, ranking, database and original-photo lookup changes. This release does not claim that archive exists.

Source registration is not proof of successful ingestion or complete national coverage. Country and city logic operates generically, while coverage gaps remain visible. The 73 publisher-family registry is unchanged. Missing countries are not silently presented as locally covered. Selecting a country cannot create articles that have not been connected and validated.

Database readiness manifest 9 retains its historical page-v2 permission metadata and fingerprint. The database permission boundary is unchanged; that metadata is not an attestation of the new HTTP page-v3 protocol. Do not recompute its fingerprint independently of its migration.

Knowledge sources were reviewed during this task. The Statue of Liberty review also used the NPS detailed FAQ, which explains protective patina: https://www.nps.gov/stli/planyourvisit/frequently-asked-questions-statue-of-liberty.htm. Knowledge content is not automatically refreshed, billed or translated on demand. Local source reviews: https://www.museoegizio.it/en/discover/story (foundation in 1824, not public opening), https://www.museoegizio.it/info/come-raggiungerci (Turin location), and https://www.filarmonicaenescu.ro/ro/istoric-ateneul-roman (circular Athenaeum foundations).

## Commercial hypothesis

The paid value to test is useful selection, reliable context, continuity across devices and personal collections. Public facts alone are not a defensible paid product. The approved price is a product decision, not evidence of conversion, retention or profit.

A later Plus trial must have a server-verified start/end, clear tax-inclusive checkout, cancellation, webhook verification, duplicate-event handling and access revocation. Personal learning trails, collections and saved discoveries are product directions to validate. The one-in-23 inline sample is free in this release; the full collection is planned as a Plus benefit. Frequency 23 is a hypothesis, not an experimentally proven optimum. Card exposure, source opening, saving and continuation metrics are not instrumented in this release. Any sponsorship must be labeled and must not affect factual verification.

## 23 November 2026 incremental editorial additions

A new on-this-day card is gated to November 23 in the selected edition's IANA calendar timezone and links to the Computer History Museum's November 23 chronology. An original short cooking suggestion links to Food Hero's apple-oats recipe. Both reuse the existing reviewed knowledge model, article-safe text rendering and provenance, with distinct reader labels. This does not imply a real-time historical or recipe feed or a daily fully refreshed catalog.

The existing one-in-23 knowledge cadence remains unchanged. Zodiac is a separate proposed entertainment product requiring opt-in sign selection, transparent creative provenance and a non-predictive label, not an independently verified news report. No horoscope provider or invented prediction is activated.

Local coverage remains bounded by existing registered, rights-reviewed sources. Region, neighborhood, street and building information require independently verified event-level geographic evidence, not the publisher's headquarters, the reader's IP or a general national press label. Full worldwide and real-time source coverage is not yet certified.
