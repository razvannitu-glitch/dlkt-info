# Local source photos — execution contract

Task: local-source-photos-20261126. Canonical repository: razvannitu-glitch/dlkt-info; base main: 04c19db4b1ff1151ab0590ab50b4a3692e666708; base tree: 213d2263dafb89e20bdd01f03e39ea5e674eee33. User instruction: "Fa sa aiba poze de la surse!" Existing verification/publication authorization remains in force. Root is the sole writer; delegated source and QA reviewers are read-only.

## Outcome and protected behavior

Show the actual publisher-selected photograph on eligible local event cards, beginning with the two observed ARCUB events, in the public recent/city and Daily renderers. Preserve current local-news photos. An official information card without an identifiable source photograph keeps its information and source action; no stock, generated, keyword-selected or guessed image is introduced. The continuous local/city/country/international sequence, complete unlinked titles, "Deschide sursa", account/email work, private-reader image opt-out and current layout thresholds are protected.

## Acceptance fixed before implementation

K1 — Knowledge: image eligibility is established from the exact original event/article page, matching its title and canonical identity. Observe two current ARCUB page/image pairs using bounded public requests; record URL, checked time, HTML hash, metadata/DOM binding, image MIME, dimensions and byte hash. Event schedule/retrieval time must not be represented as article publication time. Availability does not assert a reuse licence.

T1 — Trust: clients send only an exact record id, city and document revision. The server resolves the current validated official local source record. A wrong city/revision, disappeared/expired record, mismatched page/title or injected URL cannot fetch a publisher image. Existing robots, HTTPS host/path, redirect, MIME/raster, byte-size, cache/concurrency and source-attribution safeguards remain effective. Existing negative tests plus focused official-event cases are sufficient evidence.

A1 — Action: local recent/city and Daily cards request the same eligible source image. A real loaded image displays its source credit; a failed image removes only photographic elements and preserves the full title, details and original source action. Existing global/local-news behavior and private image omission remain tested.

A2 — Layout: retain current card/header/footer spacing assertions, no horizontal overflow, no hidden local fold, and unchanged ordering. Exercise genuine local fixture image bytes at 320/390/1440, all existing seven viewport gates, night modes and enlarged-font gate. Do not relax existing geometry or first-content budgets.

R1 — Release: strict TypeScript and repository release verification, offline browser QA, independent raw-diff review and production release/photo readback must refer to the exact candidate. Live source observations, offline fixture behavior and production evidence are reported separately. Production rollout follows the existing source generation/manifest/pin and Vercel promotion path.

## Scope and resource boundary

Allowed: article-photo reference/source/resolution and shared local/Daily renderers; focused existing test/QA fixtures; narrowly necessary local image styles; existing asset-sync mapping if needed; task evidence; a bounded local-photo probe in the existing publisher-probe workflow; generated reader assets/manifest/source pin. No new providers, database changes, auth mutations, emails, background automation or unrelated source expansion.

Root/public evidence: at most two bounded ARCUB probe runs, each one robots request, one agenda, two original pages and two image downloads (six HTTP requests; 75 seconds wall clock; HTML 1 MiB, raster 1.5 MiB). A separate production readback is capped at one release, one local snapshot and two photo responses, without retrying denied sources. Up to three generation/release attempts, two full browser candidate runs, one corrected final gate run if a demonstrated defect invalidates evidence, and one production deployment/promotion plus one corrective attempt only for a demonstrated deployment failure. Failed requests count. Additional work requires an explicit recorded contract revision, never silent threshold or budget expansion.

Agents: source evidence at most six public reads; backend review at most six focused reads; QA planning at most four focused reads; final review restricted to the task's raw diff and required evidence. Pending Supabase authentication handoff remains untouched; no CUA calls.
