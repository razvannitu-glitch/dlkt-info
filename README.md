# dlkt-info

DLKT INFO — Daily Life. Key Things. AI-powered global and hyperlocal information intelligence platform.

## Source and verification

The application lives in `source/`. Its release manifest verifies the application and database contract. `SOURCE-PIN.json` pins every source file, including documentation, configuration and assets. The repository root provides reproducible packaging for the existing DLKT INFO Vercel project.

Use Node.js 22. Run `npm run setup` to install the locked dependencies. Run `npm run typecheck`, `npm test`, or `npm run verify` from the repository root. `npm run build` compiles the application. `npm run verify:release` also verifies the complete source pin and the application's release gate.

After an intentional, reviewed source change, update the corresponding release-manifest hashes and run `npm run source:pin`. This records the complete source index and synchronizes the public Vercel configuration. Run the release gate before deploying the new pin.

## Deployment

The only official platform and production URL is `https://www.dlkt.ee/`. `dlkt-info` is an internal repository and project label, not a separate public platform. A deployment on `info.dlkt.ee` or a `vercel.app` hostname does not satisfy the publication requirement.

Before publishing, verify the project that owns `www.dlkt.ee` separately from the deployment targeted by its alias; these can differ. Publication is complete only after the official hostname resolves to the approved deployment and the requested behavior is verified directly at `https://www.dlkt.ee/`. A successful build or a check on another hostname is insufficient. If domain access prevents that final association, report publication as blocked rather than complete.

Vercel uses `node bootstrap.mjs`. The bootstrap verifies the pinned source, the production project and protected configuration, and the exact database readiness fingerprint and activation receipt. It builds a temporary copy, creates the reviewed public surface, and emits its API handlers and assets without modifying `source/`. No sandbox archive, historical Git repository, or external source download is required.

`npm run package:check` checks source and public configuration without contacting a service. `npm run package:local` compiles and emits the public surface into the ignored `.dlkt-local-build/` directory. Source files, root API wrappers and configuration stay unchanged. This local mode is refused on Vercel and does not attest production readiness.

Production credentials belong in the existing Vercel project's protected environment. Keep secrets and generated output out of Git. External account providers remain subject to their explicit verification gates. A build does not apply database migrations, promote a deployment, or enable a provider.

## Reading language

The current-country language is the automatic starting point when there is no explicit URL or saved manual language choice. English remains available. News selection uses known source languages and preserves original publisher content; no automatic article translation service is enabled. See `source/CONTEXTUAL-EDITION.md` for coverage limits, local-news promotion and acquisition rules.

## Prelaunch control and production identity

The public homepage is generated from `source/public/iceo.html`, not the historical `source/public/index.html`. Every verified public package includes `/release.json` containing the exact source release-manifest SHA-256, version, revision and an optional sanitized Git SHA. This is **build provenance only**. It deliberately never discloses database identifiers, credentials, private API configuration or a false runtime-health attestation.

The official site remains `noindex, nofollow` with `robots.txt` blocking general indexing during prelaunch. To inspect the static output after `npm run package:local`, run `npm run qa:prelaunch`. This deterministic test fails on homepage drift, invalid or missing assets, broken internal links, release-receipt mismatch, missing static accessibility hooks, legal navigation, source attribution and unexpected SEO exposure. It also emits **explicitly unverified** requirements: real-device visual/keyboard journeys, live source availability, live database verification, publisher licensing, consumer-law review, payment flow and official deployment alias parity.

The static preflight is a **necessary but insufficient** release gate. Its passing result must never be presented as approval for public search indexing, a finished subscription launch, validated browser layouts or deployment to `www.dlkt.ee`. A deliberate public-launch change requires switching SEO controls and this gate together after the outstanding security, editorial, operational and commercial checks are independently verified. The Vercel preview build currently fails closed on `BUILD_IDENTITY` because production OIDC attestation is mandatory; do not remove that control merely to get a preview URL.
