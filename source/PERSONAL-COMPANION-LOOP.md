# DLKT Info Personal Companion Loop

The companion loop now has two explicit modes.

Anonymous mode builds a finite synthetic briefing from bounded in-session preferences. It does not create an identity or persist data.

Account mode uses a one-time email code and an HttpOnly server-side session. The user can load and save the canonical briefing definition across devices through authenticated database RPCs. The browser never sees Supabase credentials.

Both modes retain source rights, atomic claims, contradiction handling, Delta First, materiality ranking and a hard card limit. Unknown fields, duplicate topics, unsafe limits and unsupported timezones are rejected. Failed regeneration preserves the previous briefing; failed persistence preserves the current in-session configuration.

The protected staging UI exposes the complete interaction model while reporting the current provisioning blocker. Account mode remains disabled until the dedicated DLKT Info database exists and its migrations, RLS and identity configuration pass live validation.
