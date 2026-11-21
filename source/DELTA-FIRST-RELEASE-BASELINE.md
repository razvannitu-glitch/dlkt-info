# DLKT Info 0.8.8 — Delta First Release Baseline

`/delta` compares the current registered EUR-Lex feeds with one immutable release artifact captured at `2026-11-13T15:49:44.186Z`. The baseline contains 200 authorized official entries and is bound to SHA-256 fingerprint `157b9edae0f0f22a399f1318fdcad8275b86cf5de39649ea33ed3c6e218e601a`.

A current CELEX identity absent from the baseline is reported as a new official listing. A matching CELEX identity with a different source fingerprint is reported as changed official metadata, with before and now states. Matching fingerprints are counted as unchanged.

An entry that disappears from the rolling RSS window is never reported as resolved, withdrawn, repealed or superseded. Roll-off is counted separately and ignored as a factual conclusion.

The release baseline is persistent because it is part of the verified release artifact. It does not require Supabase, Vercel Blob or browser storage. It is immutable until a later release deliberately captures and verifies a new baseline.

The endpoint `/api/eu-official-delta` accepts same-origin GET and HEAD only, rejects query parameters, validates origin before private cache lookup, uses `Cache-Control: private, no-store`, supports ETag revalidation and returns no invented card when nothing changed. It performs no database write, user-profile write, delivery, automatic publication or AI interpretation.
