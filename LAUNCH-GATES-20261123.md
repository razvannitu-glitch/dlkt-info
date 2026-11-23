# DLKT INFO — Launch control room (23 November 2026)

This document is a factual launch checkpoint, not a production certification or authorization to bypass release gates. Canonical service: https://www.dlkt.ee/. Brand: DLKT INFO — Daily Life. Key Things.

## Verified baseline

The approved repository is `razvannitu-glitch/dlkt-info`, with Node 22, strict TypeScript, immutable `SOURCE-PIN.json`, a matching release manifest and a local public-package build. The source registry distinguishes active source definitions, reviewed publisher origins and discovery-only candidates. Four Coral Care cards remain independent and never claim a WHO or nonprofit partnership. GDELT is an existing article-discovery index and an operator-only origin probe, **not** an entitlement to republish articles from every country. No new source is activated automatically.

Offline responsive browser QA in GitHub PR #12 passed at 320, 390, 768 and 1440 px, including mobile menu opening, Escape closure and document overflow checks. Screenshots are artifacts of the offline CI test, not proof of production browser behavior. Full source-integrity CI also passed at the merged commit.

## Observed deployment blocker

At the time of the 23 November prelaunch audit, GitHub `main` was `6dd31f9cb3f3bb6459a141e76f21c1cf188f3b9c`, while Vercel returned `www.dlkt.ee` as `READY` at deployment `dpl_FWmLM6vcU68ttbJLfLzCFyWRYq17`, sourced from `e4e5174381914c445683b4b6eb0c7163bfbfade2`. These are different code versions. Verify current values again before acting; neither value is a permanent deployment target.

Deployment `dpl_EH9b3nD2MmL4GYyRbsjHTP2sG3BM` for `f2b6ecbcdbdf81143e22f3ce85ad9a75ceb2afa4` failed with `BUILD_IDENTITY` because the build was not a correctly identified production-target build. `lib/production-attestation.mjs` intentionally requires `VERCEL=1`, an exact project ID, `VERCEL_ENV=production`, and `VERCEL_OIDC_TOKEN`, followed by protected Supabase identity and database readiness checks. **Never disable or weaken these gates to make a preview turn green.** Verify production project, branch, OIDC availability, environment and database attestation via authorized Vercel project controls. Do not paste or expose environment secrets or database identifiers in CI logs.

## New independent official read-back

`scripts/verify-official-readback.mjs` performs a fixed-host, read-only inspection of `https://www.dlkt.ee` with no cookies, credentials, redirects or write requests. It compares the exact full Git commit SHA supplied by the operator, hashed release-manifest content, static reader HTML, three shipped JS/CSS files, prelaunch robots/noindex policy, legal/contact routes and the source-atlas output. Mismatch fails closed. Unit and negative tests are included in `tests/official-readback.test.mjs`.

The manual GitHub Actions workflow `DLKT INFO official-domain release read-back` checks out `main`, calculates the exact checked-out SHA and runs that comparison. It should remain manual until the build/deployment pipeline correctly publishes the approved production target. **LIVE_READBACK_PASS means exact public static surface read-back only, not a launch decision.** Even a green result requires separate independent checks for the Vercel project/target/alias association, runtime source freshness, country coverage, regional service accuracy, auth, billing, consent and legal compliance.

## Mandatory GO/NO-GO decisions

### P0 — Release identity and production delivery

NO-GO until the reviewed release CI passes, a correctly targeted production build reaches READY, and Vercel confirms the official `www.dlkt.ee` alias points to that exact commit. Run the official read-back workflow after domain association. Failed, preview and branch-target deployments cannot substitute for this check.

### P0 — Operational public content

NO-GO for a worldwide-news claim until currently eligible publisher originals, publication times, updates, country and language coverage gaps and deduplication are observable on the actual API. Distinguish the 51 source definitions, 73 publisher families and research-only candidates from unique verified events. Source expiry, unavailable hosts and rate limits must produce honest missing-data states. Do not infer event neighborhoods from publishers.

### P0 — Security, privacy and legal

Preserve production source pin, CSP, authenticated/account permissions, Supabase RLS, rights-review expiration and no-unapproved-third-party-fetch policies. Independently verify real-user login/logout/cross-device behavior, rate limits, security headers, contact/terms/privacy and incident handling in the target deployment before public exposure of protected features. Confirm the Estonian company identity, privacy disclosures, publisher licences and medical-source caveats with qualified reviewers. A successful static test is not a legal or security certification.

### P0 — Commercial functionality

The EUR 6.99/month and 7-day trial currently represent an approved proposal, not an active subscription. Checkout, tax display, cancellation, refunds, webhook signatures, idempotency, entitlement revocation and billing-provider production configuration must be tested before selling. Until then, do not show working payment buttons or claim paid access is available.

### P1 — Product and visual UX

Keep one continuous reader of source-backed cards, the 22-news/1-reviewed-knowledge cadence, existing black/white/coral style, Kate brand image, local-first context and verified Coral Care links. Validate actual production keyboard, touch, focus, 320/390/768/1440 viewport rendering, card action controls, source opening, share preview and fallback states in real browsers. Offline snapshots are a regression gate, not an aesthetic approval of each screenshot.

### P1 — Return value and product analytics

Release "What Changed?" only when a durable per-user checked-baseline and revision semantics are verified. Release "World Window" only with attributable source and confirmed event geography; the publisher's domain or headquarters does not prove where a story took place. No synthetic novelty, fabricated world-locality or fake impact receipts. Instrument privacy-minimized unique-event yield, source-link opening, return frequency, useful-action completion, duplicate complaints and editorial correction latency before optimizing retention.

## Suggested execution order

First secure the intended Vercel production build without disabling attestation; then validate deployment-to-domain identity. Next verify the live reader/feeds and account flows, remediate confirmed UX faults, confirm legal and commercial boundaries, and only then decide whether to switch from prelaunch `noindex` to a deliberately approved public-indexable launch release. Introduce durable source-review records and additional world-candidate connectors behind separate production gates; do not conflate catalog growth with verified coverage.

## Explicit limitations

The new read-back script cannot introspect private Vercel settings, run browser tests, validate Supabase data, authenticate a real account, make a payment or certify legal compliance. It deliberately does not mutate deployments or relax `BUILD_IDENTITY`. A report is not a substitute for a human-reviewed GO decision.
