# DLKT Info 0.8.8 — Real Companion Bridge

`/companion` is the canonical real-data Companion. It consumes the verified Delta First comparator and the current Live Official Snapshot through one server-side source acquisition. The browser never contacts EUR-Lex directly and receives no synthetic InfoCard.

The request carries only the explicit Companion URL contract. The server validates the topics, tracked entities, timezone, delivery time, finite card budget, actionable filter and visible trust policy. Unknown parameters, invalid definitions, foreign origins, missing request markers and non-JSON bodies are rejected before the private source cache is consulted.

Every returned card is backed by an official EUR-Lex URL, CELEX identity, publication time, observation time and release-baseline fingerprint. Inclusion is deterministic: Regulation must be enabled, tracked entities must match the CELEX identity or normalized official metadata when entity restrictions exist, and official evidence must remain within the selected age boundary. No semantic synonym expansion or AI ranking is used.

One official authority is sufficient only for the narrow factual claim that the authority published or changed the listing. The Companion does not infer legal effect, applicability, adoption, entry into force or commercial impact. The requested materiality threshold remains visible but is not applied until separate impact evidence exists.

When the verified delta is empty, the result is exactly `caught-up` with zero cards. When verified changes exist but none match the explicit contract, the result is `no-match` with zero cards. One degraded source produces a visible `partial` state. If Delta First cannot be established, the result is `unavailable` and no substitute content is generated.

The previous synthetic Unified Companion remains isolated at `/companion-preview` for internal UX inspection. It is not loaded by `/companion`, does not feed the real API and cannot appear in the real card payload.

Responses are `private, no-store`, support ETag revalidation and use a 15-minute origin-safe in-memory source cache only after request authorization. The release creates no database record, account, delivery, notification, public card or automatic action.

A valid Companion request returns HTTP 200 even when the registered official sources are temporarily unavailable. The payload carries `resultState: unavailable`, the source errors, the real verification timestamp and the immutable baseline identity, allowing the interface to render a truthful degraded state without producing a browser resource error.
