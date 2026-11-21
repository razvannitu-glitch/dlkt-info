# DLKT Info 0.8.8 — Daily Companion Experience

The protected staging product exposes the finite end-user briefing at `/today`. One dominant InfoCard shows the direct answer, the verified Before → Now delta, why it matters, what to do, materiality, confidence, sources and the next signal that could change the reading.

Version 0.8.8 connects the homepage Companion to this experience. A strict URL contract transfers only allowlisted preferences and does not use browser storage. The selected rules filter the six synthetic scenarios by topic, minimum materiality, actionable status and card limit.

Valid rules are visible in the briefing rail. Invalid or partial rules are rejected as a unit and produce a safe-preview warning. When no card crosses the threshold, an explicit zero-result screen replaces the briefing instead of weakening the rules.

Navigation works through buttons, the briefing map, keyboard, wheel and swipe. Relevance and entity-follow feedback remain session-local. After the last card, DLKT Info displays “You’re caught up” and the configured next delivery time.

The experience performs no external request and makes no real-world assertion. Real persistence and delivery remain disabled until the dedicated project boundary is provisioned.

## History and ranking transparency

Each current card now declares whether it is new or updated since the previous briefing. A compact ranking breakdown is rendered from the shared synthetic history source, and the full finite archive is available at `/history`. The archive and memory ledger perform no external request and use no browser storage.

## Memory control bridge

Relevant, less-like and follow-entity decisions can open `/memory` through a strict allowlisted query containing only known synthetic card IDs. The Memory Control Room shows how those choices would affect the next briefing order. It does not mutate the current briefing, use browser storage or create a hidden profile.

## Personal Action Layer

Each current InfoCard can now open explicit action controls without leaving the briefing context. Watch, remind, compare, resolve-attention and ignore-pattern actions are finite, visible and reversible. The same state can be inspected in `/actions` through the strict session query contract. These actions never edit the current claim or reorder the canonical briefing unless a future authenticated action policy explicitly does so.

## Action Inbox follow-up

Explicit actions can now open `/inbox`, where due, scheduled, waiting, resolved-attention and muted states remain separate. The Inbox only projects follow-up against verified state change; it never mutates the underlying claim or executes an action automatically.
