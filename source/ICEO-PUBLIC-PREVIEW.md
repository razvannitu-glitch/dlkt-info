# DLKT Info 0.9.0 — ICEO Primary Mesh / Public Preview

This release adds a tested, usable primary-source briefing to the public DLKT domain. The complete pre-existing engineering source remains intact; the public deployment intentionally contains only the read-only ICEO API and the working finite-card interface. Review consoles, synthetic demos, account placeholders and inactive workers are not published by this build.

## Actual coverage

Cellar SPARQL supplies English-language EU legal metadata from a rolling fourteen-day query window (up to 100 rows per collection, explicitly not comprehensive legal coverage). Three ECB RSS feeds supply publication, statistics and procurement notice metadata. Two official public GitHub repositories supply non-draft, non-prerelease software release metadata; final semantic version syntax is also checked to reject alpha versions with incorrect upstream flags. GitHub acquisition inspects a window of 30 releases per repository, not a complete history.

Only titles, identifiers, dates and original source links are published. Release notes, legal documents, authored papers and third-party images are not copied. Publisher attribution and applicable source terms remain inspectable on every card and in the registry. Review expiry blocks the affected source. Registry rights assessment is operational metadata, not a legal warranty.

## Source boundary

Every outbound destination is operator-registered. Requests reject redirects, incorrect MIME types, malformed UTF-8, oversized payloads, unexpected identities, unsafe links, DTDs and XML entities. No user-supplied URL, request header, credential or SPARQL expression reaches upstream sources. Individual invalid records are quarantined and counted. Divergent content for the same identity is excluded rather than silently selected. Duplicate listings do not imply independent corroboration.

Each feed has request coalescing, conditional acquisition, a fifteen-minute healthy process-local cache, bounded retry backoff and an explicitly dated last-known-good snapshot retained for at most 24 hours in that process. No durable cache or historical delta continuity is claimed. Process restart loses the cache. The catalog API contains only public publisher metadata and can be shared by the CDN; personal filters are never sent to or stored in it. No account or cookie is needed for the public catalog.

A successful source observation proves that a record was listed. A legal document date is not its publication or effective date. Procurement notices may already be closed; parsed deadlines are displayed, and eligibility is never inferred. No software is installed automatically. No investment or legal advice is generated.

## User experience and current limits

The homepage is the working product. Four covered categories, immediate text filtering from the first letter, a user-defined positive finite card budget, balanced category selection, source links and expandable evidence work without registration. Existing DLKT palette remains black, white and #F66061. The product displays current metadata rather than pretending to know what changed since the user's last visit.

Scheduled personal delivery, account persistence, cross-device memory and continuous operational delta collection are not activated by this release. The existing ledger code is preserved but has no configured storage credentials. The public UI labels this release as a preview and makes those boundaries visible. No billing or subscription is enabled.

## Public release boundary and rollback

The production build verifies the full source release before curating its output. Only api/iceo.ts is retained in the isolated Vercel build directory. No scheduled jobs are enabled. DLKT World remains on its unchanged deployment at world.dlkt.ee. Known legacy routes and their subpaths redirect to that host. Main-domain mapping is changed only after actual HTTP and browser validation of the new production build; the prior world project/deployment remain available for rollback. Email DNS records are not changed.
