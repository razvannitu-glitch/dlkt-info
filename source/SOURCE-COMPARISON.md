# DLKT Info 0.9.4 — Explicit Source Comparison

Changes compares current accepted publisher-listing metadata against one explicitly saved source check in this browser. It is not an automatic last-visit history, a full-article content diff, or cross-device memory. No background collection, notification or new server-side personal storage is enabled.

## User journey

Open Changes, choose Save this source check, return later and inspect records absent from the saved check or exact changed metadata. No checkpoint is written on visit, scroll, refresh or saving a different card. Replacing or forgetting a check requires confirmation. Saving uses the entire available source catalog, independent of visible filters and the card budget; it does not mark unseen cards as read. Filtering the differences never alters that baseline. Saved cards and remembered focus remain independent. Clear local data also removes this checkpoint.

## Comparison semantics

An absent record is labelled Not in your saved check, not newly published. Listing updates expose exact before/after values for title, date, date meaning, deadline, version, source URL and publisher. A different observation timestamp, content hash, source ordering or verification status alone does not produce a metadata change. Feed roll-off produces no withdrawal/removal claim. Closed notices are retained in this change view because a closing-date correction can matter; the underlying reader still labels their status.

Comparison uses only sources present in both checks with matching scope and topic, non-regressing observation times and a successful observation no older than one hour. This is an explicit comparison-freshness safety policy, not a delivery promise. Partial source quality stays partial even with zero differences. Added, missing, stale or failed sources are excluded with an explanation. Identity conflicts, inconsistent counts and invalid saved records do not yield an all-clear result. A failed refresh does not compare an older loaded snapshot as current.

## Local storage and concurrency

The checkpoint is a versioned allowlisted record under the existing IndexedDB meta store; no database upgrade or table migration is needed. The source observation times, accepted card fields and coverage descriptions are preserved. A generated revision participates in atomic compare-and-swap within one read/write transaction: another tab cannot overwrite a baseline using a revision it has not seen. Older observations cannot replace newer ones. Failed transactions leave the prior record intact. Same-browser retention depends on the browser; clearing or eviction removes it. No claim of encrypted or authenticated archival evidence is made.

## Scope and release

Only DLKT Info is modified. The existing stylesheet and palette remain unchanged. No credentials, analytics, email jobs, subscriptions, Supabase modifications or domain reassignment are introduced. Existing APIs remain read-only. Public catalog capability deltaAvailable=false continues to mean no server-side historical delta; this new feature is explicitly device-local.

Test fixtures for changed records, outages and concurrency are isolated to unit tests or the automated test browser. They are not injected into live sources. Source-content reading, saved-card controls, privacy boundaries and all legacy world redirects remain regression gates.
