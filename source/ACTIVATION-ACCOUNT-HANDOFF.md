# DLKT Info 0.8.8 — Activation-to-Account Handoff

DLKT Info preserves one exact Companion contract from anonymous activation through secure account creation and cross-device restoration. The user configures topics, explicit entities, evidence policy, delivery time and a finite card budget once.

At `/start`, the contract remains usable immediately as a strict session URL. Cross-device save opens only through email OTP. Access and refresh tokens remain in `__Host-` HttpOnly cookies and never enter browser JavaScript, URL state or browser storage.

After OTP verification, `/api/persistence` saves topics, entities, timezone, local delivery time, user-defined card budget, materiality, actionable-only state and the complete trust policy in one authenticated RPC. The browser accepts success only when the returned projection matches the visible contract exactly.

Opening `/companion` without an explicit URL restores the authenticated saved contract. An explicit, valid Companion URL always wins and is never silently overwritten by stored preferences.

The product does not impose a commercial ceiling of eight entities or twelve cards. Entity tracking is constrained by the secured payload budget and each briefing uses a positive finite card budget chosen by the user. Internal review batches remain operationally bounded and separate from the user-facing product contract.

The forward-only migration `20261112233000_dlkt_info_activation_account_handoff` upgrades card-budget storage, persists the trust policy, removes the old entity-count ceiling and makes run finalization obey the saved briefing budget.

The handoff performs no source acquisition, automatic delivery, automatic action execution or factual-state mutation. Real persistence remains closed until the dedicated DLKT Info Supabase project is provisioned and its runtime gates are enabled.
