# DLKT Info 0.8.8 — Internal Real Delta Trial

DLKT Info can transform a changed private source batch into a finite internal InfoCard trial. The trial is not a public briefing and cannot publish automatically.

## Private queue

A first source acquisition remains a silent baseline. A later non-baseline source batch that inserts at least one new or changed claim creates one private delta job. The worker claims jobs with a bounded lease, reconstructs the current and superseded claims with their provenance, runs the independent DLKT Info InphoCore Engine Orchestra and persists at most twelve candidate cards.

Each candidate is linked to the exact private claim IDs that support, contradict or precede it. Source URLs are checked again against the current Source Registry revision, authority, path rules, query contract and rights-review expiry. A card whose source is not backed by evidence from its linked claims is rejected transactionally.

## Human review gate

Pending candidates can be read only through a service-role RPC and the separate protected review route. A decision requires a distinct review secret and a configured human reviewer ID. Approvals and rejections create append-only events. A second decision on the same card is rejected.

The database constrains `public_cards_created` to `false`. Approved candidates remain internal evidence that the Delta First mechanism worked; approval does not copy them into `public.dlkt_info_briefing_cards`, create a delivery job or notify a user.

## Activation order

The worker requires the dedicated DLKT Info Supabase project, all five migrations, the data-foundation gate, real-data gate, source-acquisition gate, `sb_secret_` server key, `CRON_SECRET` and `DLKT_INFO_INTERNAL_TRIAL_ENABLED=1`. Review additionally requires `DLKT_INFO_INTERNAL_REVIEW_ENABLED=1`, `DLKT_INFO_INTERNAL_REVIEW_SECRET` and `DLKT_INFO_INTERNAL_REVIEWER_ID`.

The source acquisition schedule runs at minute 17. The internal trial schedule runs at minute 47, leaving the source worker time to commit its batch before Delta First evaluates it. Vercel executes these schedules only on production deployments; protected staging exposes the routes but they fail closed while the dedicated database configuration is absent.
