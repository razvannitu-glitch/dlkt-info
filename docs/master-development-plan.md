# DLKT INFO — Master Development Plan

Version 1.0 | Initial baseline: 2026-11-28 | Product: DLKT INFO — Daily Life. Key Things.

## Mandate

Build a useful, trustworthy, globally relevant and commercially sustainable daily information product. The output is functioning, tested user value, not PR count, lines of code, or activity reports. Product design and brand remain unchanged unless an authorized requirement specifically changes them. English is the product-brand language. The project discussion can remain in Romanian.

This planning ref is a persistent coordination ledger, deliberately separate from the release source. It is not a new release candidate, not an automatic approval, and not a source of authority to bypass user instructions. The companion `docs/master-development-backlog.json` is the canonical work queue for this planning ref. State in the ledger is a dated observation, never a substitute for reading live sources.

## Immutable starting evidence

The integrated draft is [PR #116](https://github.com/razvannitu-glitch/dlkt-info/pull/116), initial head `b376b9791aebb2c207e17a270e29d0b1818e1dd5`, initial main `2005ad5cf04f6ea0f04080eeb66a99f6d895b55d`. Exact-head release CI: 2,879 tests passed, zero failures/skips; 15/15 static checks; npm audit reported zero. Offline Chromium and public ICEO freshness monitoring passed; comparative CodeQL reported 21 findings on the baseline and zero on this candidate. Ordinary independent Code Review found no issues. A separately identified security review is not confirmed. These are bounded observations, not proof of absence of vulnerabilities.

Public monitor [46172292410](https://github.com/razvannitu-glitch/dlkt-info/actions/runs/46172292410) failed canonical NSW card routes with HTTP 400 on the previous production revision while direct API requests returned 200. Offline candidate success does not prove hosted recovery. The independent account monitor checks were skipped by the earlier reader failure. Isolated correction `d89db45c081a712aa2d2846a006096352b7cf96a` passed [release CI](https://github.com/razvannitu-glitch/dlkt-info/actions/runs/46174243618) with 2,880 tests, zero failures/skips and 15/15 static checks; it is not adopted into PR #116 and requires independent review. The previous failure of a newly added test was corrected on that isolated branch.

## Nine workstreams, one release

| Track | Result | Acceptance boundary |
|---|---|---|
| F — Foundation | Reliable and secure release path | Exact-head CI, independently reviewed security and code, protected hosted evidence, explicit release approval |
| I — Intelligence | Verified information and source qualification | Provenance, rights, actual freshness, geographic/editorial scope, fail-closed admission |
| P — Personalization | Relevant local and global daily utility | Multi-locale and location fixtures, explicit preference, no false precision or fabricated coverage |
| X — Experience | Fast, accessible, coherent reader | Actual interaction and rendering evidence; no unsolicited visual redesign |
| H — Habit Engine | Users have a genuine reason to return | Defined experiment and consent-safe evidence of repeat use |
| V — Viral Engine | Useful, attributable distribution | Exact sharable content, recovery evidence, measured referred use, no fake reach |
| E — Editorial & Business Intelligence | Safe decision-quality measurement | Defined denominators, missingness and privacy review; no synthetic live claims |
| M — Monetization | Validated paid value and sustainable economics | Demand evidence, unit economics and sandbox acceptance; explicit activation authority |
| O — Autonomous Infrastructure | Observable, recoverable operation | Real monitoring and recovery evidence, measured cost, approval boundaries |

## Execution contract

1. Read the current planning ref and backlog, actual main and draft heads, relevant open PRs, exact-SHA CI and review evidence before acting. Reconcile existing work before creating a branch. Do not assume a stored status is current. No unrelated repository or project.
2. Select work by safety impact, dependency readiness, user value, then cost and reversibility. Priority 0 is release safety, 1 is verified product/operational value, 2 is exploration or dependent work. READY means its recorded dependencies permit useful work, not permission for an external operation. Independently ready work may proceed while another gate is blocked.
3. Keep one integrated release draft. The planning ref and isolated laboratory/QA branches are not competing release candidates. Inspect existing constituent and lab PRs before any new branch. No automatic closure or deletion of historical work. Avoid duplicate implementations, speculative refactors and scope creep. No force pushes.
4. For implementation, establish the failing case, exact baseline, smallest justified diff, regression tests and security boundary. Work in an isolated branch; verify exact tree, CI, manifests and independent review before controlled adoption. A failed, pending, skipped, missing or mismatched check is not PASS. Validate post-adoption evidence again. Never manufacture a passing result by disabling a gate.
5. For read-only research or analysis, document sources, method, measured evidence, unknowns and next actionable decision. A proposal is not an implemented feature. A synthetic fixture is not live editorial, commercial or security evidence. Public logs/ledger must not contain secrets, private data or exploit details.
6. Each hosted automation invocation is bounded: reconcile all immediately relevant evidence, complete as many independent useful steps as the available execution budget permits, normally no more than two simultaneous isolated implementation changes; no long polling or artificial work to stay busy. If a task is waiting, select another READY item; if all safe work is blocked, end the cycle. No promise of continuous execution between scheduled runs. Do not start a duplicate worker or modify the automation from within its own run.
7. Update only the affected backlog item after evidence is observed; maintain stable IDs and dependencies. Read the planning ref immediately before any write, preserve concurrent changes, use a non-force fast-forward with expected head and verify readback. If a conflict occurs, stop that write and reconcile later. Do not rewrite the plan or authority to justify broader action. Changes to this contract require user approval.
8. Keep reports concise: meaningful verified progress, failures, next blocker, and necessary decisions only. When nothing meaningful changed, suppress repetitive notifications. Record completed work with evidence URL, exact SHA where applicable, actual result and limitations.

## State and release semantics

READY: dependencies and scope permit useful work. IN_PROGRESS: work actually started, with a branch/job/evidence receipt. REVIEW: candidate evidence exists but independent acceptance remains. BLOCKED: dependency, access, evidence or authority missing. VALIDATED: stated acceptance tests passed for the exact bounded deliverable, not necessarily deployed. DONE: acceptance achieved and the intended authorized outcome verified. Do not mark a parent product capability DONE based solely on a component fixture.

On each pass, evaluate dependency and authorization separately. An item with explicit approval is not automatically executable merely because its dependencies passed. READY/REVIEW are work-queue states, not release clearance.

## Release authority and success metrics

Allowed autonomously: read-only repository and authorized observability inspection, fixture/lab implementation, isolated minimal corrective commits, existing CI and independent review, planning ledger maintenance and non-force draft integration after exact evidence. No automatic merge to main, staging or deployment, alias promotion/rollback, source activation, publication, live telemetry, billing, DB changes, credentials, permissions, infrastructure or cost changes. Such operations require separate explicit authorization. Preserve protection and use approved authentication; never weaken access to obtain test success.

Proposed metrics to define and baseline before setting numerical business targets: verified usable cards per edition; coverage by actually admitted sources and geography; freshness and failed refresh share; duplicate/incorrect-locality rates on reviewed samples; reader interaction success, responsive/accessibility defects, p50/p95 latency and request volume; eligible opt-in return share (clear cohort/window); valid share intent and attributable referred visits separately; validated conversion, recurring revenue, variable cost and contribution margin. A missing baseline remains unknown. No revenue, retention, uptime, coverage or cost-savings guarantees.

Public release requires exact artifact readback, applicable security and technical review, reviewed editorial/source gates, authorized protected hosted validation, rollback plan and separate explicit production decision. No candidate can be declared production-ready simply because CI is green.

## Initial priority

F-01 (existing isolated monitor fix review), I-03 (editorial evidence), O-02 (recovery decision packet) and F-03's unresolved dedicated review capability are release-safety priorities. While those are held, I-01, P-01, X-01, X-02, V-01, E-01, E-02, M-01 and O-01 provide independent, bounded work without modifying production. Reuse rather than duplicate existing PRs #101, #103, #105, #106–#115, #78 and #82.
