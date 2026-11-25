# Wallet saved-card navigation — bounded implementation contract

Date: 2026-11-25 (Europe/Bucharest)
Repository: razvannitu-glitch/dlkt-info
Verified starting commit: b7c9186be6bcb4ba57b3eed0b231b69513494431
Task owner and sole repository writer: root.
User request: continue DLKT with a concrete next step after the verified release.

## Outcome and current evidence

A reader who explicitly saves a public source card in Wallet can open the existing browser-only Saved collection directly and find the original. The existing homepage Wallet card explains the currently available private-profile and personal-selection function.

The current official Wallet was read in the authenticated browser. The previously saved UK Government public card was found intact after Back to briefing then Saved. There is no direct Saved link in Wallet or its successful save confirmation. The homepage already links to Wallet, but its description covers only authorized email/social accounts; the saved-profile status ends with those connections being unavailable.

Primary source: source/src/personal/browser.ts, source/src/entry/browser.ts, source/src/iceo/browser.ts, source/src/wallet/personal-inbox.ts, source/public/iceo.html and source/public/wallet.html at the starting commit. Existing product behavior is defined in source/PRODUCT-EXPERIENCE.md and docs/personal-profile-flow-20261125.md.

## Bounded implementation

Reuse the existing Saved collection and handler through an exact /#saved fragment. Support both an initial navigation and a later hashchange after modules are ready. Offer a clearly labelled browser-only Saved link from Wallet and a direct link after successful public-card persistence. Update only the existing Wallet homepage description and saved-profile guidance.

Preserve the existing design and CSS, saved-card identities, explicit save/remove actions, original source links, private profile boundaries, DailyState, remembered focus and comparison checkpoints. Navigation itself must not persist any state. The URL must contain no private profile fields or owner identifiers. Existing shared-topic and organization entry paths must continue to work.

No authentication, provider, payment, delivery, database, dependency, source-selection, routing infrastructure or production configuration changes are in scope.

## Acceptance

A1. Opening /#saved after startup and changing to #saved on the already loaded homepage both open the existing Saved view, with keyboard focus on its heading. Other fragments retain their existing meaning; near-matches do not select Saved.
A2. A confirmed Wallet save exposes a same-tab /#saved link. Failed or invalidated saves never display a new success link. No public card or private profile is saved by navigation.
A3. The actual compiled browser flow can save a controlled public card, follow the link, find that exact original and source URL, remove only that card, and confirm removal after reload. Other originals, private account profile, DailyState, remembered focus and comparison state remain unchanged.
A4. An empty browser collection renders the existing empty state through the same link. The Wallet link remains available without an account because the collection is browser-only.
A5. Homepage copy names profile-based personal selection without promising that a profile guarantees available or matching cards. Unavailable provider status stays accurate.
A6. Relevant regression and controlled Chromium checks pass on the final candidate; strict compilation, existing release integrity and generated-asset gates pass. Mobile layout is checked using the existing styles. Independent review covers the authored diff and recorded evidence.

## Execution and evidence

Use the existing GitHub connector, generation workflow and browser QA; no terminal. Root is the sole writer. Independent read-only reviewers cover entry initialization and test scope, followed by an exact-candidate diff review. Reuse the draft pull request as the task/evidence record.

One authored implementation followed by the existing generation pass; one final verification cycle unless a concrete failure needs repair. Do not change gates to turn failures green. Record candidate SHA, relevant job evidence, limits and publication state in the pull request. The contract itself grants no new publication or spending permission.
