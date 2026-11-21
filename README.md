# dlkt-info

DLKT INFO — Daily Life. Key Things. AI-powered global and hyperlocal information intelligence platform.

## Source and verification

The application lives in `source/`. Its release manifest verifies the application and database contract. `SOURCE-PIN.json` pins every source file, including documentation, configuration and assets. The repository root provides reproducible packaging for the existing DLKT INFO Vercel project.

Use Node.js 22. Run `npm run setup` to install the locked dependencies. Run `npm run typecheck`, `npm test`, or `npm run verify` from the repository root. `npm run build` compiles the application. `npm run verify:release` also verifies the complete source pin and the application's release gate.

After an intentional, reviewed source change, update the corresponding release-manifest hashes and run `npm run source:pin`. This records the complete source index and synchronizes the public Vercel configuration. Run the release gate before deploying the new pin.

## Deployment

Vercel uses `node bootstrap.mjs`. The bootstrap verifies the pinned source, the production project and protected configuration, and the exact database readiness fingerprint and activation receipt. It builds a temporary copy, creates the reviewed public surface, and emits its API handlers and assets without modifying `source/`. No sandbox archive, historical Git repository, or external source download is required.

`npm run package:check` checks source and public configuration without contacting a service. `npm run package:local` compiles and emits the public surface into the ignored `.dlkt-local-build/` directory. Source files, root API wrappers and configuration stay unchanged. This local mode is refused on Vercel and does not attest production readiness.

Production credentials belong in the existing Vercel project's protected environment. Keep secrets and generated output out of Git. External account providers remain subject to their explicit verification gates. A build does not apply database migrations, promote a deployment, or enable a provider.
