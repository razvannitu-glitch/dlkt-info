# DLKT Info 0.9.6 — Verified Reading Editions

## Public change

Prepare this edition now preserves the existing canonical selection plus reviewed publisher excerpts for supported documents. The exact versioned artifact supplies the website, plain-text download and a self-contained HTML reading copy. The copy uses the established black/white/coral palette without modifying the website stylesheet. It includes source links, dates, attribution, terms and clear listing-only states. Files contain the chosen focus and must be shared deliberately. Downloading is not cloud persistence, account activation, an email, a public permanent card URL or an offline installation of the application.

## Evidence integrity

The server resolves records itself; visitors cannot submit cards, URLs or claimed excerpts. Each passage is bound to the canonical card ID and metadata hash, checked against a passage SHA-256 and accompanied by the source-content observation time. The complete artifact has a separate SHA-256. The browser validates both before displaying or downloading it. A hash detects internal corruption; it is not a publisher signature, proof of independent corroboration, or a defence against an attacker replacing both content and digest outside the trusted TLS/session boundary.

Unsupported layouts remain listings. Source failures, expired observations, invalid binding and exhausted processing time do not remove selected cards or invent summaries. Enrichment uses two workers and a bounded total deadline; underlying source acquisition has its own timeout and shared cache. At most three whole source passages per card and an aggregate 2,000-character excerpt budget are retained. These safety budgets do not change the reader's chosen number of cards. An edition is a dated source selection, not a claim that every item is new.

The downloaded HTML contains no script, embedded image, form, iframe, external font or remote stylesheet. All text and attributes are escaped and links validated. Its restrictive content-security policy and no-referrer policy accompany the file. No dynamic refresh is possible; only a deliberate original-source link can leave the file. Browser tests open the downloaded file offline and verify the exact selected passages at mobile and desktop widths.

## Inactive outbound adapter

A server-only email-envelope builder and Resend HTTP adapter are implemented but are not wired to a public endpoint or a scheduled job. They have no configured credentials and no real email has been sent. Unit tests use an injected provider response, never a live recipient. The same immutable artifact feeds text and HTML; retry logic retains the exact bytes and the logical schedule/local-date key instead of regenerating information on each attempt.

Outbound execution additionally requires a dedicated database, a durably acquired job lease, verified sender, verified unsubscribe implementation and current owner/consent/destination revisions. Missing readiness stops execution. Changed consent or destination cancels it. Accepted jobs are not resent. Provider API acceptance is recorded as accepted, never as confirmed recipient delivery. Ambiguous transport results retain the original key and body; results outside the conservative 23-hour retry window or after eight attempts require reconciliation. This is intentionally shorter than the documented 24-hour provider idempotency window. Provider Retry-After is respected; idempotency conflicts require manual reconciliation.

This adapter alone does not provide durable queuing, ownership verification, atomic subscription changes, suppression processing or signed delivery webhooks. Those integrations and hosted end-to-end tests remain required before activation. No claim of unconditional exactly-once delivery is made. An unsubscribe URL is accepted only when the implementation has been verified by the activation gate; this release does not publish an unsubscribe route.

Provider documentation verified during implementation:
https://resend.com/docs/dashboard/emails/idempotency-keys
https://resend.com/docs/api-reference/emails/send-email

## Release checks

Run strict TypeScript, all unit and database tests, manifest integrity and the dependency audit. Browser checks cover real source enrichment, exact text and HTML download, hash rejection, offline file reading, existing local memory/comparison and unchanged world-domain redirects. Hosted authentication, actual email sending, Safari and physical iPhone behaviour are not certified by these tests.
