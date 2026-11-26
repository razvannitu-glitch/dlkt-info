# DLKT INFO — Public news translation boundary — 26 November 2026

## Outcome and source

Prepare one independently verifiable server-only prerequisite for the already authorized title/description translation feature. Canonical baseline is `razvannitu-glitch/dlkt-info`, `main`, commit `22eabb45692cd3e0495be85397ec9fe0bcbd63e3`. The complete recursive tree contains no repository AGENTS.md. The user's standing development authorization applies; terminal execution is not used.

This increment is a draft prerequisite, not the completed B1–B3 feature in `docs/reader-language-translation-20261125.md`. It does not enable a provider or publish a translation endpoint. The current production release is preserved.

## Acceptance contract written before implementation

C1 — Only an exact current public article reference resolved through the existing committed NewsCorpusStore may supply translation input. Require an exact epoch, original ID/revision, supported target locale and bounded translator version. Reject arbitrary text, additional private fields, malformed references and unknown cities before any lookup. Observe with deterministic fixture stores and the existing concrete store adapter.

C2 — Extract only the exact publisher title and optional publisher summary. Local input uses `card.news.summary`, never the platform fallback in `card.text`. Do not invent missing descriptions. All original fields, identities, URLs, publishers and dates remain unchanged. Observe exact equality and before/after copies for global and local originals.

C3 — Bind an immutable translation projection to the original kind, ID, identity, revision, digest of the exact submitted fields, verified source language, requested target locale and translator configuration version. A key may be reused across committed epochs only when those inputs match. Changed text, identity, source language, target or translator version must not reuse a projection. Observe deterministic SHA-256 and mismatch cases.

C4 — Treat a candidate provider/cache result as unknown data. Accept only the exact projection schema with bounded nonempty text and the same summary presence. Reject wrong targets/revisions/identities/digests, missing or extra fields, excess lengths and forged resolution objects. Copy and freeze accepted values; do not return mutable provider objects or interpret text as HTML. Markup-like text remains untrusted plain data; a future browser renderer must use textContent.

C5 — Before accepting a well-shaped candidate, resolve the same reference again through the same store and epoch. Missing, expired, changed or unavailable originals cannot authorize a cached/result projection. Do not retain upstream error bodies. Deterministic fixtures cover expiry during lookup, withdrawal, store errors and request/result mutation. The existing browser continuation generation rules remain responsible for a later client locale switch; this increment does not claim browser race coverage.

C6 — Preserve the published reader, source scope, original storage and all runtime routes. No UI, CSS, database, source acquisition, hosted auth, environment configuration, provider network call or billed operation changes. Strict TypeScript without any and all required release/package gates must pass on the fixed final draft head. Generated release metadata is accepted only from the existing bounded CI export with verified hashes.

## Knowledge, trust and action

Knowledge applies to exact public source text and provenance. Trust applies to immutable identities, strict schemas, current committed-source authority and explicit fixture limitations. User-facing action is inapplicable in this prerequisite because there is no new live control or endpoint. Paid/provider execution is inapplicable and prohibited in this increment.

## Scope and finite boundary

Allowed authored files are this contract, `source/src/iceo/news-corpus-store.ts` (export the existing reference type only), one new server module and one new test file. Generated source pin/release manifest changes must come from the existing generation workflow. One writer and one independent read-only reviewer. One initial generation run and at most two corrective reruns after demonstrated failures; mandatory final-head checks are additional. No terminal, CUA calls, new infrastructure, provider activation or production deployment.

## Evidence and remaining dependency

Tests use controlled public fixtures and do not demonstrate live translation quality, hosted provider access, durable cache/reservations or worldwide translated coverage. A real provider, accepted terms, actual supported targets, durable reuse and a bounded quota/cost policy remain necessary before B1–B3 can be completed. Store exact CI and review observations in the draft PR without rewriting these acceptance criteria.
