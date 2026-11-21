# DLKT Info Data & Delivery Foundation

DLKT Info has an isolated persistence, acquisition, trial and delivery contract. It does not connect to Veciniada, WANTADAAA, the retired INPHOMANIAC implementation or old DLKT World.

## Security boundary

The model requires a dedicated Supabase project in the EU Frankfurt region. User-owned configuration and generated output use RLS-protected public tables. Source rights, raw claims, evidence, source checkpoints, claim batches, internal delta trials, review events, secret references and delivery outbox state remain inside `dlkt_info_private`.

Profiles do not duplicate authentication email addresses. Raw delivery destinations are not stored in public tables. Browser code cannot call worker RPCs, write generated cards, review internal candidates, verify endpoints, modify scheduler fields or self-upgrade a plan.

## Source acquisition

`20261111224500_dlkt_info_source_acquisition` adds versioned source records, leases, daily limits, checkpoints and append-only attempt events. `20261111233000_dlkt_info_private_baseline_commit` adds source claim batches, source-specific external claim identities and the atomic checkpoint-plus-claim commit RPC.

The first collection creates a private baseline. New and changed source entries append claims and immutable evidence. Invalid provenance, stale leases or malformed payloads roll back the complete transaction. Feed roll-off is never interpreted as a factual withdrawal.

## Internal delta trial

`20261112003000_dlkt_info_internal_real_delta_trial` queues only non-baseline batches that inserted claims. A service worker leases each job, reconstructs the current and superseded claims, runs Delta First and stores at most twelve claim-linked candidates. A separate protected review queue requires explicit human approval or rejection. Database constraints keep `public_cards_created` false.

## Briefing and delivery

The user scheduler claims due briefings with `FOR UPDATE SKIP LOCKED`, creates one run per scheduled instant and advances local delivery with timezone and DST support. Finalization persists at most twelve public cards only through the independent user-briefing path and creates at most one outbox item per run, channel and endpoint. Internal trial approval does not call that path.

## Current compiled surface

The ten forward-only migrations compile to 27 product tables, two authenticated companion RPCs, four service-only source-acquisition RPCs, five service-only internal-trial RPCs and two public non-secret provisioning-attestation RPCs. No migration has been applied to another product's database.
