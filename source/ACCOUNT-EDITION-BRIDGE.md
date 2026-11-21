# DLKT Info 0.9.5 — Account and Edition Bridge

## Active public capability

Prepare this edition POSTs only the explicit topics, phrase and card budget to a same-origin endpoint. ICEO collects the current approved source snapshot; user-supplied cards, destinations and source URLs are rejected. The server creates a content-addressed, dated edition containing canonical source records, an explicit partial/unavailable state, and plain-text output. Download text edition saves that exact response on the user's request. It is not an email, account archive, full-document summary, permanent public card link or automatic delivery. Copies include selected topics and the user's phrase and must be shared intentionally.

Only successful source checks within the stated one-hour preparation freshness policy are eligible. A source outage is not 'nothing changed'; incomplete coverage remains partial. Published dates and original observation times are retained. The current JSON response is limited to 2 MiB for request safety, not an arbitrary subscription card count.

## Implemented but activation-gated account capability

The account page, email-code sign-in bridge, explicit browser-to-account import, explicit account-to-browser replacement, account reader-copy deletion and logout are implemented. The backend uses existing tested identity sessions and the established database identity/schema guard. No JWT, refresh token, provider secret or service-role key is exposed to JavaScript, URLs or browser storage.

Public account endpoints fail closed unless the dedicated database passes attestation, the account bridge is explicitly enabled and authentication email delivery has been validated by the operator. The inactive page collects no email address and shows no sign-in form. Read access uses Supabase's user token with RLS, not an administrative key. The verified session supplies owner_id; request bodies cannot select an owner.

A single canonical reader copy uses the existing public.dlkt_info_user_memory table with memory_key reader-account-v1, memory_type preference and an opaque revision. No schema change is required. Writes require an exact expected revision; concurrent edits or creation conflicts produce 409 instead of silent overwrite. Success is returned only for an exact roundtrip of the canonical value. Browser restore is one IndexedDB transaction and preserves original saved/observed dates. Cloud and local copies are not automatically synchronized or merged.

Saving a reader copy is not a subscription, not a scheduled-delivery opt-in, and does not make user-edited saved cards trusted source evidence. Edition composition accepts only the server's current source collection.

## Scheduling preparation

The daily-slot planner validates IANA timezones, local time and weekdays. It picks the first occurrence of a repeated local time and at most one slot per local date; a nonexistent wall-clock minute moves to the first valid minute after it. Deterministic tests cover spring/fall transitions, weekday selection and fractional-hour zones. No Cron Job, email sender or durable dispatch worker is activated in this release. A database-backed outbox, sender verification, pause/unsubscribe and provider acceptance/delivery reconciliation still require integration before automatic delivery is enabled.

## Infrastructure state and activation prerequisites

Hosted deployment requires a dedicated DLKT Info database and protected application configuration. Provisioning must preserve separation from other products and must not enable subscriptions or outbound email without the relevant authorization.

After explicit authorization: provision only the dedicated project, apply the existing migrations, confirm identity/readiness and RLS, configure protected environment variables, configure production auth email with the operator, test actual OTP with the authorized recipient, then enable the account bridge. Environment names: DLKT_INFO_ACCOUNT_BRIDGE_ENABLED and DLKT_INFO_AUTH_EMAIL_READY supplement, not replace, the existing identity and schema checks. Keep both unset until their real dependencies pass. Existing data-foundation/auth/persistence flags and per-database instance binding still apply.

## Verification scope

Unit and transport tests cover canonical payload validation, owner binding, optimistic concurrency, private cache headers, origin rejection and no outbound email while disabled. PGlite tests exercise actual PostgreSQL RLS with two separate users, cross-owner insert/update/delete rejection and revision-matched replacement. Browser tests exercise real public edition preparation/download and the real disabled-account state. Hosted account creation, real OTP, cross-device cloud roundtrip and email delivery are not certified because the required infrastructure is not active.
