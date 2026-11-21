# DLKT Info 0.8.8 — Briefing History & Explainable Memory

DLKT Info now exposes a finite synthetic history at `/history`. The history records delivered changes, resolved signals and rank movements across four bounded briefing runs. Stable information is deliberately omitted instead of being repeated as news.

Every current InfoCard carries an explicit `new`, `updated` or conflict-updated state relative to the previous briefing. The card also shows its current global rank, movement from the prior run and the strongest components that produced its position.

Ranking is inspectable. Materiality, delta type, freshness, actionability, source authority and personal-rule weight are separate numerical components. The core scoring contract now returns the same breakdown used to calculate the final score; the explanation is not generated after the fact by a language model.

Explainable Memory is represented as a visible ledger. Each signal identifies whether it came from an explicit rule, relevant feedback, less-like feedback or a followed entity. It also identifies its target, numerical effect and reason. Negative memory remains visible and bounded between -50 and +50.

The preview uses no browser storage, cookie, external request or hidden user profile. History and memory are deterministic synthetic data until the dedicated DLKT Info database is provisioned. Production, domains, real acquisition and public cards remain unchanged.

## User control

The visible ledger links to `/memory`, where every synthetic signal can be disabled, strengthened, weakened, undone or reset. The projected next-briefing order is recalculated separately from the factual base score, so personalisation remains inspectable rather than becoming an opaque recommendation layer.
