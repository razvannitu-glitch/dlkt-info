# DLKT Info 0.8.8 — Delivery & Notification Control

DLKT Info now exposes a transparent delivery-policy surface at `/delivery`. The page decides whether an explicit action may interrupt now, wait until quiet hours end, return in the next finite briefing, remain scheduled, wait for a material delta, or stay muted.

Delivery is evaluated only after Action Inbox state, trust, materiality, official evidence and contradiction status are known. A conflicting card cannot become an exceptional alert. A high-impact alert requires official evidence. An action configured for briefing-only never creates a separate interruption.

Quiet hours are timezone-aware and visible. The default policy blocks interruption between 22:00 and 07:00 in the selected timezone. The only optional bypass is an explicit rule for confirmed, official, high-impact information. The default bypass is never.

Anti-spam protection is structural, not cosmetic. The projection collapses duplicate changes, enforces a configurable minimum gap, limits exceptional alerts per 24-hour window and never stacks two projected interruptions in the same gap window. Every rate-limited candidate remains visible with the exact reason and next eligible time.

The user can configure delivery separately for watches, one-time reminders, comparisons, resolved attention and ignored patterns. Web is the only projected channel in protected staging. Email and push remain disabled until authenticated endpoints and the dedicated DLKT Info persistence boundary exist.

Projection is not delivery. The protected preview sends no email, push, reminder or web notification. It uses no localStorage, sessionStorage, IndexedDB, application cookie or external request. Every policy edit is session-only, reversible and incapable of mutating claims, provenance, trust or factual state.
