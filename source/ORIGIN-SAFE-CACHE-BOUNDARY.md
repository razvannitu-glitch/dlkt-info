# DLKT Info 0.8.8 — Origin-Safe Private Snapshot Cache

The official live and Delta First endpoints validate method, query string, request marker, host, protocol, Fetch Metadata and origin before reading any cached snapshot. A foreign-origin request cannot receive a response previously generated for a same-origin request.

Successful responses use `Cache-Control: private, no-store`. Vercel CDN and intermediary caches are not authorized to reuse the payload. ETag revalidation remains available only after the request crosses the same-origin gate.

A 15-minute in-memory cache exists only inside an individual server instance. It reduces repeated EUR-Lex fetches, coalesces concurrent requests and never crosses the endpoint authorization boundary. Cache state is reported as `miss`, `hit` or `shared` through `X-DLKT-Info-Server-Cache`.

Loader failures are never cached. Origin rejection, forbidden query parameters and missing request markers are evaluated before cache lookup. The cache contains no credentials, user data, cookies, account state, database records or delivery instructions.
