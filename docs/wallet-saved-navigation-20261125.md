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

## Integration and publication continuation — 2026-11-26

Current canonical main and official release were independently read as cae6ce90602703a8f95726be816568fb776a272f, tree275ac7061ac3d5fd38744a5127cde4d105e65fb5. PR54 remains open at b3013c369b246c8e960e1740bd327cd70a203f31. Its successful historical browser and release evidence is retained, but does not validate the integration with current source. The user asked to continue toward launch with standing authorization; no additional permission is required for this existing navigation fix.

I1. Apply only the eight authored source/HTML/test/harness deltas already reviewed in PR54 to current main. Reuse a two-parent integration history, retaining both the current publication and the original PR54 work. Never replace current files wholesale with historical files. Preserve the visible source-language controls, Kate account/preferences, consistent source actions, continuous geographic cards and independently verified original-source photo revisions. No CSS, database, credentials, provider, paid service, email or translation activation.

I2. Regenerate affected public browser modules, release manifest and source pin using the existing generation workflow. Verify the exact export input, sequence, byte counts, file/payload/baseline hashes and allowed paths. A generated historical asset is not an integration source.

I3. All A1–A6 remain. Run strict compilation, required complete release checks and the existing Chromium suite on the integrated tree, including the Wallet-to-Saved assertions and all current gates. Independently review the raw integration delta. Current browser screenshots may be inspected where the navigation/link surface changes. Synthetic account tests do not establish real hosted account/RLS/email behavior.

I4. After passing gates, merge the reviewed tree, deploy the exact merged commit to the existing DLKT INFO Vercel project and explicitly promote to official domains. Verify release identity and published Wallet link/compiled entry behavior. A bounded public browser entry check may run through the existing CI workflow; no CUA while the previously requested manual authentication handoff is pending. No production state is written by a read-only link check.

Root is sole writer. Finite boundary: one integration implementation and source generation, one final browser/release cycle, at most one correction/retry only for a demonstrated failure; one deployment/promotion and at most four public readback requests. Independent review at most four focused repository reads. Use existing workflows; no terminal. Preserve failed and unverified observations and stop optional checks after these criteria are met.

Integration observation: seven authored patches applied with exact unique context to current main. The historical browser-harness context had since gained account/email visual exports and additional current acceptance phases. Its Wallet Saved function is retained verbatim; its explicit preview label, call and result field are inserted into the current harness while retaining account-profile, authentication-email, locale, continuous-local/photo and every existing gate. The outdated screenshot-count comment is replaced with an accurate explicit-pair description. No assertion or limit is reduced.
