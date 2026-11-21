# DLKT Info 0.8.8 — Companion-to-Briefing Bridge

The homepage Companion now opens the dedicated finite briefing at `/today` after the existing same-origin API validates the selected rules. The bridge serializes only allowlisted topics, timezone, delivery time, card limit, minimum materiality and actionable-only state.

The bridge uses a strict URL contract, not hidden browser persistence. It does not use browser storage: no localStorage, sessionStorage, IndexedDB or application cookie. Unknown, duplicated, partial or invalid parameters are rejected as one unit. An invalid link opens the full synthetic preview with a visible warning instead of partially applying unsafe state.

A valid definition filters the synthetic daily cards by topic, materiality, actionable status and maximum card count. The chosen delivery time and timezone are projected into the briefing. When no card crosses every rule, DLKT Info shows an explicit zero-result state rather than inventing content or weakening the threshold.

The query contains preferences, not authentication or secrets. It is suitable only for the protected synthetic preview. Real cross-device memory remains behind the dedicated authenticated persistence boundary.
