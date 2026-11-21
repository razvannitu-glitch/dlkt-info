# DLKT Info 0.8.8 — Provisioning Control Plane

DLKT Info no longer treats environment flags as proof that a database is safe to use. Auth, Persistence and every later runtime capability remain blocked until the configured Supabase project returns the exact DLKT Info system identity through `dlkt_info_read_system_identity`.

Migration `20261113115256_dlkt_info_provisioning_identity_guard` creates one private identity row with a database-specific UUID. The public RPC returns only bounded non-secret metadata: product, engine, foundation version, persistence version, schema revision, EU data region and safety flags. The private row is not readable by `anon` or `authenticated`.

The runtime must receive the same UUID in `DLKT_INFO_DATABASE_INSTANCE_ID`. A copied migration in another database produces another UUID, therefore a valid URL, publishable key and enabled flags are still insufficient. Any missing RPC, malformed response, wrong product, wrong region, wrong revision or instance mismatch fails closed before OTP, session validation or user RPC access.

The activation order is strict. Create a dedicated project in `eu-central-1`, apply every migration, call the identity RPC, copy only its `instanceId` into the protected runtime environment, set the project ref, exact project URL and publishable key, then enable the foundation and Auth gates. Real-data acquisition and delivery workers remain separate later gates.

WANTADAAA and VECINIADA databases are explicitly ineligible. No existing product database may be reused, linked, paused or repurposed to activate DLKT Info. `/api/provisioning-health` and `/api/persistence-health` reveal capability state and blockers without exposing URL, project ref, publishable key, UUID or user data.
