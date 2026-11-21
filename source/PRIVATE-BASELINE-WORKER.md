# DLKT Info 0.8.8 — Private Baseline Worker

The worker is a server-only, scheduled acquisition boundary for real Information Packs.

## Activation gates

All gates are mandatory: dedicated DLKT Info project reference and URL, publishable key, applied data foundation, real-data approval, source-acquisition approval, dedicated Supabase `sb_secret_` key and `CRON_SECRET`. Generic Supabase variables and another product's credentials are ignored.

## Request boundary

Vercel Schedule calls `GET /api/eu-official-acquire` with `Authorization: Bearer <CRON_SECRET>`. The handler compares the value in constant time. Missing configuration returns 503 before any network or RPC call. Invalid authorization returns 401. Browser code has no call path to this route.

## Atomic persistence

A modified source response is committed through one service-only RPC. It validates the active source revision, lease owner, checkpoint version, baseline semantics, exact claim projection, provenance origin, hashes, timestamps and evidence count. It then appends entities, claims, evidence and batch membership before advancing the checkpoint. Any error rolls the entire transaction back.

## Output boundary

The HTTP response contains only feed IDs, source keys, status, checkpoint version and counts. It never includes legal-document identifiers, titles, raw payloads, claim values, tokens or secret material. Public InfoCards remain disabled until a later internal release gate proves two successive real collections and correct Delta First behavior.
