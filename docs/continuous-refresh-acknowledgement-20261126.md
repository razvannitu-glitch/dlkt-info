# Continuous public refresh acknowledgement repair — 2026-11-26

Objective: report an already committed public news update correctly when its write acknowledgement is unavailable, without repeating publication or treating an uncommitted update as successful.

Canonical source: razvannitu-glitch/dlkt-info, main 22eabb45692cd3e0495be85397ec9fe0bcbd63e3, observed 2026-11-26T11:16:48Z. Official host https://www.dlkt.ee. Complete current tree has no AGENTS.md. Translation PR63 remains draft and separate.

Confirmed starting evidence: Vercel production log at 2026-11-26T10:44:52.699Z reports snapshot-publish REFRESH_LEDGER_UNAVAILABLE; the corresponding database run started at10:44:30.601302Z and succeeded at10:44:52.207797Z. The current service catches this error without checking whether that same write committed. The transport cause is not established. Separate failed publications at09:45:24.984855Z and09:57:10.572161Z, and the expired10:54:37.869856Z attempt, remain unresolved; this change does not claim to fix them.

Protected behavior: existing lease fencing, atomic snapshot/corpus publication, exact original news records, source acquisition, publisher rights, public/private boundaries, current timeouts, failure/backoff behavior, release gates, UI/design, noindex, hosted auth and translation configuration. No database migration, production data edit, new service, secret read, paid API, scheduler change or publication retry.

Permitted authored scope: source/src/iceo/daily-cache.ts and directly relevant existing service tests; this contract/evidence document. Generated source pin and release manifest only through existing verified CI export. Root is sole writer; separate agent independently reviews the exact diff.

R1: A typed refresh-ledger availability error from snapshot publication may trigger exactly one authoritative snapshot read, only when a staged corpus is bound to the claimed fence. No second publication, collection or stage operation. Validate using existing full public-envelope/snapshot validation, exact original digest and generatedAt, ready state, current authoritative publication timestamp, and the scheduled success timestamp when applicable. Evidence: deterministic service tests including commit-then-error and call counts.

R2: Before a recovered success receipt, confirm the committed corpus for the exact staged epoch/fence, digest, generatedAt and database snapshot revision through the existing corpus adapter. Receipt values come from database readback. Evidence: controlled full-collection integration tests with positive and mismatching/null corpus cases.

R3: Uncommitted/old/invalid/wrong/newer snapshot, wrong staged fence, stale scheduled timestamp, unreadable snapshot/corpus, a directly returned invalid ledger envelope, validation error, collection failure and stage failure cannot be turned into recovered success. Snapshot-only legacy refresh retains failure behavior because it lacks the staged fence binding. Evidence: explicit negative tests and existing suite. Existing last-known public data and failure recording remain intact.

R4: No credential, source text, URL or arbitrary exception is added to logs. Existing bounded diagnostics remain. Evidence: raw diff review and existing redaction tests.

R5: Strict TypeScript, required source/release/packaging gates, independent review and exact final candidate checks must pass. Publish only this verified repair under existing authority; verify official release commit and subsequent automatic refresh observations. CI uses controlled fixtures and does not prove production continuous availability. Keep prelaunch noindex and record all failed checks.

Knowledge: exact snapshot digest, corpus epoch/fence, corpus digest, generatedAt and committed revision identify this publication. Trust: distinguish observed lost acknowledgement from unexplained historical failures and synthetic tests. Action: one bounded readback, no write replay, no invented success.

Resource boundary: at most3 generation attempts, each further attempt requires a concrete correction; one final required verification cycle plus evidence-driven retries only. Use current connectors and existing CI, no terminal. At most one production deployment/promotion of the final verified head; never force-push or overwrite changed main. Operational read queries are restricted to public refresh outcome/timestamps, bounded log metadata and health advisories. No private user rows or writer/lease secrets.

Status before implementation: R1–R5 planned. No modification or production deployment yet.

Contract clarification v2, before acceptance: independent review found that the real ledger adapter classifies an unusable write acknowledgement, including a malformed envelope or undecodable body, as REFRESH_LEDGER_UNAVAILABLE. The initial R3 phrase "malformed acknowledgement" was broader than the intended safety condition. It is explicitly superseded: an unusable write response may be reconciled only through the same independent, fully validated snapshot and committed-corpus checks R1–R2. An invalid authoritative readback must still fail; no acknowledgement is trusted or validation relaxed. The adapter integration regression must exercise both transport loss and malformed write responses after a controlled commit. The separate test for a malformed object returned directly by an injected ledger remains a failure case. All earlier observations on the superseded test wording are invalidated; the revised contract and tests require a new exact-head run and review.

The recovered-success diagnostic is the constant marker DLKT_ICEO_REFRESH_PUBLICATION_RECONCILED, emitted only after all persisted readback checks. Existing clock-skew tolerances are preserved, not tightened or silently removed. Recovery replaces the normal snapshot readback rather than adding a second read, preserving the existing 67-second maximum collection/stage/publish/readback budget.

Additional bounded investigation: PostgreSQL metadata showed SQLSTATE55000 in corpus staging at09:45:26.778Z and snapshot publication at09:57:11.704Z, both after the corresponding failed-run timestamp. Multiple article-lookup cancellations SQLSTATE57014 were also observed. These metadata correlations do not establish the original transport latency or a single cause for all historical failures. A log-schema DESCRIBE query returned a backend error; no conclusion was inferred from that failed read.
