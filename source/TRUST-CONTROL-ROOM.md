# DLKT Info 0.8.8 — Trust Control Room

DLKT Info now exposes a transparent evidence-policy surface at `/trust`. The user can decide the minimum accepted trust level, whether unresolved contradictions remain visible, the minimum source authority, the number of required sources, the maximum evidence age and whether high-impact claims require an official source.

The policy filters visibility only. It never edits an atomic claim, upgrades a weak source, chooses a winner inside a contradiction or changes provenance. A conflicting card can be excluded or shown with an explicit warning, but it remains conflicting and blocked from automatic action.

The Trust Control Room projects the finite synthetic briefing immediately. Every candidate is shown as included or held back, and the exact blocking reason remains inspectable. Source authority, evidence freshness, source count, materiality and trust state are visible for the selected candidate.

The policy travels to `/today` through a strict allowlisted URL contract and can coexist with the existing Companion definition. Invalid, duplicated, partial or unknown trust parameters are rejected as one unit. `/today` applies trust before ranking and before the maximum-card limit, so held-back cards never consume briefing capacity.

The preview performs no external request and uses no cookie, localStorage, sessionStorage or IndexedDB. Policy changes are session-only until the dedicated DLKT Info database exists. The exact visual palette remains black `#000000`, white `#FFFFFF` and coral `#F66061`.
