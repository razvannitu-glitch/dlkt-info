# DLKT Info 0.8.8 — Memory Control Room

DLKT Info now exposes a transparent, finite memory control surface at `/memory`. The user can inspect every explicit rule, relevant-feedback signal, less-like signal and followed entity that affects the next briefing preview.

Each signal shows its source, target, reason, numerical weight and active state. No hidden signal is allowed. The user can disable a signal, adjust its bounded strength, undo the last change or reset the complete preview. Every change recalculates the projected next-briefing order immediately.

The ranking preview separates factual base relevance from personal-memory effect. It shows base score, memory points, projected total, projected rank and rank movement for every synthetic candidate. A candidate inspector lists the exact active signals applied to that card.

Feedback from `/today` is transferred through a strict allowlisted URL contract containing only known synthetic card IDs. Duplicate, unknown or oversized parameters are rejected as one unit and the canonical preview is restored. No authentication token, secret or user identifier is carried in the query.

The preview is session-only. It performs no external request and uses no cookie, localStorage, sessionStorage, IndexedDB or hidden profile. Real cross-device memory remains disabled until the dedicated DLKT Info database is provisioned and the authenticated persistence gate is opened.
