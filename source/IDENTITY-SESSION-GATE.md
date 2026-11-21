# DLKT Info 0.9.45 — Identity Session Gate

DLKT Info now has a complete server-side identity boundary for email one-time-code sign-in, session refresh, sign-out and authenticated companion persistence. The identity layer is independent from every other DLKT product and can activate only against the exact dedicated DLKT Info Supabase project.

## Browser boundary

The browser never receives, stores or forwards a Supabase access token. Access and refresh credentials are held only in `__Host-` cookies with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` and no `Domain` attribute. The page cannot read those cookies through JavaScript. There is no `localStorage`, `sessionStorage` or browser-side token cache.

`GET /api/auth` resolves the current account state. `POST /api/auth` requests a one-time email code. `PUT /api/auth` verifies the code and establishes the HttpOnly session. `DELETE /api/auth` clears both local session cookies even when the upstream identity provider is unavailable.

An expired access credential is validated once, refreshed once server-side and rotated before the authenticated request continues. Invalid refresh credentials clear the local session. Provider outages fail closed and do not produce a synthetic signed-in state.

The refresh-token parser supports the documented twelve-character opaque Supabase token as well as longer tokens in the existing safe character set, up to 4096 characters. Whitespace, control bytes, cookie delimiters, non-ASCII values and shorter or oversized values remain invalid. Parsing, verification, cookie storage and refresh are tested through the existing Account route with controlled provider responses; this is not proof of a live hosted session or email delivery.

## Request integrity

Identity and persistence calls require an internal request marker plus explicit same-origin evidence or exact browser Fetch Metadata. Bodies are JSON-only and bounded. Email, code, timezone, locale and provider responses are strictly validated. The code-request response never reflects the submitted email. Session responses never include access or refresh tokens.

## Product behavior

Anonymous users retain the finite synthetic companion preview. When identity is enabled, a user can sign in and explicitly save companion rules across devices. Persistence derives ownership from the authenticated Supabase session and never accepts an owner ID from the browser.

Identity activation requires the dedicated DLKT Info project and a successful release readiness attestation. Infrastructure or user data from another product must never be reused to satisfy this requirement.

The current interface expects a numeric email code. Before enabling `DLKT_INFO_AUTH_EMAIL_READY`, a production email service and the corresponding Supabase email templates must be configured and actual delivery and verification must pass. A feature flag alone does not prove email delivery. Project capacity, email setup and external Gmail/social consent are separate prerequisites.

The identity boundary remains independent from EU Official Change Radar. Installing the pack does not enable accounts, persistence or source acquisition; each gate is activated separately.

The Provisioning Control Plane requires the private database instance UUID and the exact `dlkt_info_read_system_identity` response before runtime gates can open. Environment flags alone never authorize Auth, Persistence, acquisition or delivery.
