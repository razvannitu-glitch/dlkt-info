# DLKT Info boundary

DLKT Info is an independent product and runtime. Its internal engine is **DLKT Info InphoCore Engine Orchestra**.

The architecture may reuse validated engineering principles, but it does not share application databases, source registries, user identities, secrets, queues, billing records, prompts, delivery schedules, telemetry or operational state with any other product.

The first foundation is domain-neutral. Sport is an optional information pack, not the product kernel. The kernel accepts only atomic claims with provenance, reconciles contradictions, computes deltas, ranks relevance and emits a finite scheduled briefing of InfoCards.

AI may extract bounded candidate claims or draft language. AI never grants source rights, establishes factual truth, suppresses contradictions or promotes an unsupported claim.

The persistence layer is provisioned only in a dedicated DLKT Info Supabase project in the EU Frankfurt region. Public user-owned records use RLS; source rights, raw claims, provenance, secret references and delivery outbox state remain server-only. No raw delivery destination is stored in the application database.

The application does not read generic `SUPABASE_URL`, anonymous-key or service-role environment variables. Persistence activates only when the exact dedicated `DLKT_INFO_*` project reference, URL, publishable key and readiness flags are present. Missing or partial configuration produces an explicit fail-closed state; another product's database is never an acceptable fallback.

Private source acquisition is isolated behind a dedicated service transport. The transport accepts only a DLKT Info `sb_secret_` key and Vercel `CRON_SECRET`, exposes no browser route to service-role RPCs and commits checkpoint plus claims atomically. A source baseline is private until later release gates explicitly authorize real InfoCards.

Internal real-data trials remain private even after human approval. The internal worker and review routes use separate secrets, candidate cards remain linked to private claims, review events are append-only, and the database forbids automatic creation of public cards. A future publication mechanism must be a separate, explicit release gate.

The Provisioning Control Plane requires the private database instance UUID and the exact `dlkt_info_read_system_identity` response before runtime gates can open. Environment flags alone never authorize Auth, Persistence, acquisition or delivery.
