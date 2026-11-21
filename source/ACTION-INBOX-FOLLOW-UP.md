# DLKT Info 0.8.8 — Action Inbox & Follow-up Loop

DLKT Info now separates explicit actions into a finite Action Inbox at `/inbox`. The Inbox is not a general task manager. Every item is anchored to a known InfoCard, action type and verified claim state.

The projection distinguishes five operational states: due now, scheduled, waiting for a material delta, attention resolved and muted. Watches and comparisons become due only when a materially different verified state appears. A one-time reminder becomes due only at its explicit time. A previously resolved attention state reopens only when a new material delta arrives.

Muted patterns remain visible. When an ignored pattern suppresses a material delta, the Inbox counts and explains that suppression instead of hiding it. Contradictions also remain preserved; following up on a conflicted card cannot resolve the factual conflict.

Handling a continuous watch acknowledges the current delta and rearms the watch. Handling a one-time reminder or comparison completes only that action. Unmuting removes the explicit suppression rule. Every operation is reversible in the session preview and produces a visible activity entry.

The Inbox changes attention, never truth. It cannot edit atomic claims, provenance, source authority, trust level or contradiction state. It performs no automatic execution and uses no localStorage, sessionStorage, IndexedDB, application cookie or external request.

Real persistence, reminder delivery, notifications and cross-device follow-up remain disabled until the dedicated authenticated DLKT Info data boundary is provisioned.
