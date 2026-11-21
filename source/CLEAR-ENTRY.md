# DLKT Info 0.9.9 — Clear entry

The user requested a bright, simple Google-style approach while retaining DLKT identity, usefulness, explanation and return continuity. The public first visit now presents a concrete city/topic choice, one large search field, finite city suggestions, and three descriptive starting points. It does not show an automatic EU-law or technical feed. It does not imitate Google's identity or claim whole-web retrieval.

The entry uses the existing city API and existing topic reader. It exposes no new backend, models, trackers, account flow, paid service or data persistence. Initial topic acquisition is deferred until a user chooses a topic or a previously saved focus is restored. Existing explicit browser-only saves and comparisons stay intact. A restored city is prioritized before a restored topic unless the user has already interacted; delayed restoration must never override a typed choice or navigation. Saved city is still a forecast/transport snapshot, not background monitoring or a completed personal subscription product.

A confirmed city displays local cards without unrelated technical records underneath. Topic reading is still available on request, with sources, status, extracts, local saving, comparison and edition downloads. The existing controls retain their identifiers and behavior except the intentional new entry gate. Tests must enter the topic flow rather than assume an automatic catalog.

This release does not claim to have solved general daily relevance, activated new categories, increased retention, or validated willingness to pay. Available sources and inactive accounts/delivery remain explained. Palette stays white, black and #f66061. No external fonts, gradients, hero illustrations or tracking.

## Verification

The entry browser test is retained under tests/browser/clear-entry.mjs. Run its copied harness from the existing ui-check directory, where the reviewed Playwright/Chromium tooling is installed. It covers fresh entry without catalog fetching, deliberate city selection, no-result and unavailable states, source identity rejection, saved-city and saved-topic restoration priority, interaction precedence, personalisation, saved cards, comparison, edition preparation/download, geolocation refusal, blocked IndexedDB, narrow-screen reflow, CSS 200% magnification and brand hover. None of these tests prove retention or willingness to pay. Chromium testing is not Safari or physical-device certification.
