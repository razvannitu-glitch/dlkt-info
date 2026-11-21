# DLKT Info 0.8.8 — EU Official Change Radar 0.1.1

EU Official Change Radar is the first real Information Pack for DLKT Info. It monitors two official EUR-Lex feeds: European Commission proposals and related documents, and legislation adopted by the European Parliament and the Council.

The pack uses only official-source records registered inside the independent DLKT Info Source Registry. Each source is bound to its exact origin, legal-document path, allowed query contract, language, rights review, attribution duty, request interval, daily ceiling, timeout and maximum response size.

## Private baseline and claim ledger

The first collection creates a private baseline and does not publish historical cards. Baseline entries become source-specific atomic claims with immutable evidence. Later new entries append new claims. Material metadata changes append a new claim linked to its predecessor. Stable entries create no duplicate claims, and feed roll-off never implies withdrawal, repeal or resolution.

Checkpoint, batch metadata, claims, evidence and source state commit in one transaction. A provenance error, malformed claim, stale lease or invalid checkpoint rolls back the whole write. Source claim batches and their items are append-only and accessible only to the service role.

## Rights and interpretation

Every public card must preserve EUR-Lex attribution and link to the exact document. The pack extracts bounded metadata only. It does not copy full legal texts, infer adoption from a proposal feed, or infer applicability, obligations or effective dates from a feed listing. The rights review used by this release expires on 9 February 2027; collection blocks after expiry until reviewed again.

## Acquisition boundary

Acquisition runs only through `/api/eu-official-acquire`, protected by Vercel Schedule authorization. The route uses a dedicated `sb_secret_` key only in the server-side `apikey` header, never in browser JavaScript or a user Authorization header. It returns operational counts only and never returns CELEX identifiers, titles, XML or database credentials.

The route is installed but disabled in staging until a dedicated DLKT Info Supabase project exists and every activation gate is explicitly enabled.
