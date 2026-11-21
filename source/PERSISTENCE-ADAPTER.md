# DLKT Info 0.8.8 — Dedicated Persistence Adapter

DLKT Info accepts only dedicated `DLKT_INFO_*` configuration and cannot fall back to another Supabase project. Browser Authorization headers are ignored. Authenticated user RPCs use the server-resolved HttpOnly session; service acquisition uses a separate server-only secret transport.

Persistence projection version `dlkt-info-persistence-2` stores the exact Companion contract: topics, explicit entities, timezone, local delivery time, user-defined finite card budget, materiality, actionable-only state and complete trust policy.

The forward-only migration `20261112233000_dlkt_info_activation_account_handoff` changes card budgets and run counters to positive integers, removes the old entity-count ceiling, persists trust-policy fields and makes finalization obey the saved briefing budget. Entity lists remain protected by item validation and an aggregate text budget.

The dedicated Supabase project remains the activation requirement. Until it exists, identity and persistence routes fail closed and no other product database is reused.

The Provisioning Control Plane requires the private database instance UUID and the exact `dlkt_info_read_system_identity` response before runtime gates can open. Environment flags alone never authorize Auth, Persistence, acquisition or delivery.
