# DLKT Info 0.8.8 — Personal Action Layer

DLKT Info now converts a verified InfoCard into an explicit, finite next step without becoming a generic task manager. The protected staging product exposes the full control surface at `/actions`, while each card in `/today` opens the same action contract in context.

The available actions are deliberately bounded: watch the next material change, bring the current card back once in the next briefing, compare the current verified state with the next verified state, mark the user’s attention as resolved, or ignore an explicit future pattern. Every action remains attached to a known card and candidate ID.

Actions change attention, not truth. Marking a card resolved does not mark the real-world claim resolved. Ignoring a pattern does not delete evidence. Watching an entity does not create a new fact. The atomic claim, provenance, source authority, contradiction state and trust level remain unchanged.

Ignore is exclusive. Selecting it removes other actions for the same card so the product cannot simultaneously promise to watch and suppress the same pattern. Every active action appears in a visible ledger and can be removed, undone or reset.

The action state uses a strict allowlisted URL contract that can coexist with Companion and Trust parameters. Unknown, duplicated, oversized or contradictory action parameters are rejected as one unit. No secret, authentication token or hidden profile is transported in the query.

The preview uses no localStorage, sessionStorage, IndexedDB, application cookie or external request. Reminder delivery, notifications, cross-device persistence and automatic execution remain disabled until the dedicated authenticated persistence boundary is provisioned. Public cards remain disabled.
