# DLKT Info 0.9.0 — Operational Delta Ledger

The Operational Delta Ledger converts Delta First from a comparison against one release artifact into a durable sequence of verified official collections.

Each successful hourly collection creates one immutable, content-addressed checkpoint in a private Vercel Blob store. The checkpoint contains the two registered EUR-Lex feed states, their normalized entries, source metadata, collection slot, previous checkpoint hash and its own canonical SHA-256 identity.

A single pointer identifies the latest committed checkpoint. The pointer is updated only with an ETag compare-and-swap operation. Concurrent workers may create orphaned immutable checkpoint objects, but only one can advance the logical ledger for a collection slot. A conflicting writer returns `slot-conflict` or `superseded`; it cannot overwrite the committed chain.

The first verified collection establishes a private baseline and emits zero delta cards. Every later collection compares only with the immediately preceding committed checkpoint. New CELEX identities become `new`. Changed official metadata becomes `changed`. Entries that disappear from the finite RSS window are counted as `rolledOffIgnoredCount` and never become withdrawn, repealed, resolved or removed claims.

Source transport, TLS, parsing, registry, provenance or validation failure never advances the pointer. The previous checkpoint remains canonical and readable. No data is substituted and no partial collection is committed.

The storage identity is a dedicated UUID. Runtime activation requires either an explicit DLKT Info Blob token or an explicit Blob store ID plus Vercel OIDC. Generic `BLOB_READ_WRITE_TOKEN` variables are deliberately ignored. The ledger bootstrap requires an explicit confirmation equal to the configured instance UUID.

The collection endpoint is private and CRON-secret protected. The read endpoint is same-origin, private, no-store and ETag-aware. The health endpoint exposes configuration state, identity verification and current sequence without exposing tokens, store identifiers or user data.

The Real Companion prefers the operational ledger when a verified sequence exists. Until activation, it falls back to the immutable release baseline and labels the source mode accordingly. It never presents release-baseline comparison as “since your last verification.”

This release does not create public cards, accounts, notifications, automated publication or automatic user actions. It does not use AI to reinterpret official facts.
