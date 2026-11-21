# DLKT Info 0.8.8 — Live Official Snapshot

`/live` is the first user-facing DLKT Info experience powered by current external data. It reads two registered EUR-Lex RSS feeds server-side, validates every entry through the existing Source Registry and exposes a finite read-only snapshot with official attribution.

The snapshot is not Delta First. Without a persisted prior checkpoint, DLKT Info states only that an official listing exists in the current feed. It does not claim that the item is new to the user, adopted, applicable, in force or legally binding in a specific case.

The endpoint `/api/eu-official-live` accepts same-origin GET and HEAD requests only. It rejects query parameters, credentials, redirects and foreign origins. Responses are bounded below 500 KB, use ETag revalidation and `Cache-Control: private, no-store`. A 15-minute per-instance memory cache is consulted only after same-origin validation. One unavailable feed produces a clearly partial snapshot; failure of every official feed returns no cards.

The browser chooses its own positive finite card budget and feed filter. These controls change only the current view. They do not create an account, checkpoint, database record, delivery job, notification or public persisted card.

The live snapshot uses no AI interpretation. Titles, CELEX identifiers, creators, publication times and source links come from EUR-Lex. Legal effect, applicability and effective dates must be verified in the linked official act.
