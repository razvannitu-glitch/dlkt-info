# DLKT Info 0.9.2 — Source Content Insights

The current release adds selected publisher passages to existing cards. It does not claim a generated full-document summary, personalised advice, historical delta, account persistence, or scheduled delivery.

## Content scope

Supported software records must be exact stable releases in the official nodejs/node or vercel/next.js repositories. The service reads the release body, checks tag, source URL, publication timestamp and draft/prerelease flags, and selects whole bullets from a recognised change section. Introductory security wording is used only when the publisher explicitly writes that this is a security release. Individual notes are selected, not ranked as exhaustive or independently corroborated.

ECB support is limited to registered institutional statistical/press publications with an exact matching title, main article container and publisher highlight list before the first section heading. Signed speeches, papers, unknown layouts, legal documents and procurement details are not silently rewritten into summaries. The source terms and attribution are linked; reused passages are marked and formatting normalisation is disclosed.

## Evidence and limits

Each result binds to both the catalog card ID and content hash. Every selected whole passage records its publisher section, index and SHA-256; the document response has its own hash and content-check time. Maximum three passages, each at most 1,000 characters, with an aggregate 2,000-character excerpt budget prevent wholesale reproduction. A long passage is omitted, never truncated into a claim. These are extraction safety/display budgets, not user subscription limits.

## Security and efficiency

GET/HEAD /api/insight accepts only one 24-hex id and one 64-hex hash. The server resolves the canonical card; users cannot supply fetch URLs, SPARQL, headers or credentials. Source requests use TLS, manual redirects, MIME validation, a one-megabyte stream limit and an eight-second timeout. Nonmatching identity or unavailable source leaves the listing intact without substitute content.

Browser work starts when a supported card approaches the viewport, with two simultaneous requests and detached-observer cleanup. Server work coalesces duplicate requests, caches successful content for fifteen minutes in-process, caches errors for one minute, limits concurrent content fetches to four per instance and respects upstream rate-limit reset times. These are process-local safeguards, not a global distributed quota or durable cache. No external model is invoked.

## Verification and deployment

Unit/integration tests include number and negation fidelity, qualifiers, title/identity mismatch, malicious destinations, invalid MIME/oversized input, script removal, cache expiry, rate limits, replay hash checks and safe locale fallback. Browser tests verify actual Node.js and ECB passages, expandable evidence, source links, malformed response rejection and responsive widths. The isolated public build contains only the read-only catalog and insight APIs plus curated assets. Authentication placeholders, private review routes and workers remain unpublished.
