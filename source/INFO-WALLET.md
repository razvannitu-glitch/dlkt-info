# DLKT Info Wallet — 0.9.45

## User outcome and scope

The private profile and future personal activity belong to the same DLKT daily experience as general and city information. Public reading remains available without signing in. Info Wallet is an information wallet; no payment, asset custody or cryptocurrency feature is introduced. Existing Kate identity, CSS, palette, typography, finite city selection and ticker behavior are preserved.

This release provides `/wallet`, a compact homepage status, the `/api/wallet` private profile API, a provider capability catalog, a strict private-event model, a bounded daily projection and a server-only Gmail metadata adapter. Real sign-in, profile persistence and external connections remain gated by actual infrastructure readiness. A prepared adapter is not a live account connection.

## Profile and access

The profile contains an optional display name, language locale, IANA timezone, preferred briefing time, supported topics and `personal-first` or `balanced` priority. Time is only a preference; it creates no schedule, background worker, message or notification. The version is `dlkt-info-wallet-profile-1`.

The existing `public.dlkt_info_user_memory` table stores this preference under `wallet-profile-v1`, separate from the reader copy. No schema migration is needed. The user can read, create, update and remove only their Wallet profile using a verified identity session and user-scoped JWT. A stale revision returns conflict, and creating an already existing profile does not overwrite it. Removing the Wallet profile does not delete the account or browser reader memory.

The API accepts only same-origin marked requests without query parameters, bounds request bodies to 16 KiB, validates every profile field and returns `private, no-store` responses. Disabled or signed-out requests do not read private storage. Service-role credentials cannot be used as a user profile token. The profile is a user preference, never evidence of a real external connection or provider activity.

The browser stores no Wallet profile, event, token or connection state in localStorage, sessionStorage or IndexedDB. It clears private UI during revalidation, on session loss and when leaving the active view. Personal data does not enter the public sharing or downloadable public edition flows.

## Provider capabilities and honest availability

Gmail and Outlook are listed as future email integrations. Instagram is scoped to supported professional accounts, and Facebook is scoped to Page activity. Every catalog entry is currently unavailable and has `connectionAvailable: false`. There is no fake Connect action and no flag that turns a catalog item into a connected account.

Authenticated DLKT identity does not authorize an external mailbox. Each external service will need its own OAuth registration, consent, bounded permissions, encrypted server token storage, refresh/revocation lifecycle, provider review where required, and tested disconnect/deletion controls before activation. No passwords or provider tokens are requested by this UI.

Only identities explicitly supplied by a provider may appear as actors. Shares and view counts do not imply a complete list of people who shared or viewed. Display names do not merge identities across providers. Known provider failures, missing connections and incomplete scans remain distinct from a successful scan with no activity.

## Private events and daily projection

Events include a stable owner, connection and provider identity, event ID, timestamps, bounded source text, explicit source actor provenance and a validated provider link. They are always private. Wrong-owner input, invalid URLs, unsupported event kinds and fabricated viewer identity are rejected. A finite daily projection uses explicit source coverage and priorities, preserves incompleteness and deduplicates within the correct provider/connection scope.

The projection and Gmail adapter are server modules, not deployed browser assets. They do not create a persistent ingestion worker. No personal event is synthesized to populate an empty Wallet. The public runtime currently returns an unavailable or not-connected activity state with no invented events.

## Gmail metadata adapter

The adapter reads the Gmail `users/me/messages` list and individual message metadata. It uses only selected headers and provider message timestamps, never message body, attachment text or Gmail snippet. Authorization is an injected server-side bearer token sent only in the request header. The metadata scope does not support the `q` search parameter; the adapter uses bounded INBOX pagination and local date filtering.

Requests and response sizes are bounded, redirects are rejected, and partial pagination, authorization failure, quota/rate limit, malformed data and timeout remain explicit. A generated Gmail navigation link is identified as generated navigation, not a permalink returned by the API. Tests use provider-contract fixtures; no live personal inbox is claimed as accessed.

## Current activation boundary

A dedicated DLKT Supabase project, verified schema/identity and working production email OTP delivery are required before enabling the existing account readiness gate. Wantadaaa and Veciniada projects are ineligible. Environment flags alone cannot attest readiness. Provider OAuth apps, secrets and a token vault are not supplied by this release. The public copy continues to state that accounts and external connections are not active.

## Verification

Acceptance criteria are fixed in the task evidence contract before release integration. Required evidence includes strict TypeScript, profile/API negative tests, actual PGlite owner isolation, Gmail contract fixtures, event/projection failures, controlled browser lifecycle flows, unchanged protected behavior, independent review, the mandatory release gate on the exact final commit and production readback after publication. The continuation report records observed results separately from these requirements.

## Primary provider references

Reviewed 18 November 2026: https://developers.google.com/workspace/gmail/api/auth/scopes ; https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list ; https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get ; https://developers.google.com/workspace/workspace-api-user-data-developer-policy ; https://learn.microsoft.com/en-us/graph/api/mailfolder-list-messages?view=graph-rest-1.0 ; https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login . These references establish capabilities and restrictions, not a claim that DLKT has passed a provider review or connected a user account.

## Account handoff and private session lifecycle

The Wallet sign-in link carries the fixed `returnTo=wallet` intent. Only that exact supported destination can return automatically to `/wallet`, after a fresh enabled and authenticated session response; no arbitrary return URL or account credentials are accepted in the location. A fixed Back to Info Wallet link remains available on Account even when sign-in is unavailable.

Account clears its private copy, pending operations and signed-in state when the session cannot be confirmed, the page leaves the foreground or another tab signals a session change. Abort and generation guards prevent late responses from restoring old private data. Re-entry verifies the session before showing account data. Logout clears visible private data immediately and requires a confirmed signed-out response and readback.

An acknowledged OTP challenge is bound to its email address in memory. Editing that address invalidates the old challenge and code; switching to an email app can preserve the acknowledged challenge while private reader details and code input are cleared. Import, restore and deletion continue to require explicit user actions. Public authentication and provider integrations remain inactive until their existing external requirements are met.

Version 0.9.45 adds the pre-activation database privilege attestation and compatibility with twelve-character Supabase refresh tokens. The database protocol rejects the older readiness response and requires the new public-data permission check before the account gate can open. The dedicated project creation attempt was rejected by the provider's Free-project capacity limit; no hosted database or personal connection was created by this release.

Explicit Account restore propagates its operation cancellation into IndexedDB. Cancellation before a delayed open completes prevents a restore transaction from starting; an uncommitted restore transaction is aborted. This cannot undo an already committed transaction. Existing public reader operations without a signal keep their previous behavior.
