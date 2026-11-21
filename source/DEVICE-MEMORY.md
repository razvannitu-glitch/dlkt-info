# DLKT Info 0.9.3 — Explicit Device Memory

## Implemented scope

Remember this focus stores the current topics, search phrase, finite card budget and reading mode only after an explicit click. Future edits are not automatically saved. An existing valid preference is restored on a later visit unless the visitor has already started editing the page.

Save here stores one canonical public card snapshot in the browser's IndexedDB. The Saved here collection ignores current topic filters, preserves the original source-check time, labels saved copies and keeps them available when the live source snapshot is unavailable. It does not turn a saved publication into a fresh observation. Extracted article passages are not persisted by this feature. Opening the site shell still needs connectivity; no offline application or cross-device sync is claimed.

Users can remove individual cards, forget only their focus or explicitly confirm clearing both DLKT Info stores. Other browser data is not cleared. The empty database schema can be initialized on a visit, but no preference, history, identifier or card record is written until requested. Scrolling is not tracked and there is no automatic read history.

## Storage contract

Database: dlkt-info-device-memory-v1, schema version 1. Stores: meta and saved. Every stored value has a version and timestamp. Input is treated as untrusted, validated and copied through an allowlist of fields. Invalid entries are excluded and disclosed, not silently repaired into facts. No credential, account identifier, hidden preference payload or third-party URL is stored.

Writes resolve only after IndexedDB transaction completion. Overlapping transactions serialize across tabs. Saving an existing ID is idempotent and does not silently replace the historical copy. Quota errors, blocked storage and invalid values fail visibly without claiming success. BroadcastChannel carries only a change notification, never the data. Browser focus provides refresh when that API is unavailable.

Stored data is specific to this origin and browser profile. Private browsing, browser eviction or clearing site data can remove it. Saving on a shared device can expose saved interests to another user of that profile. The interface discloses these limits. No storage-persistence permission prompt, login, subscription or scheduled delivery is activated.

## Validation

Pure tests cover schema validation, positive finite budgets, canonical field copying, hostile links, provenance and blocked storage. Chromium tests exercise actual IndexedDB writes and reloads, dual-tab concurrency, idempotency, partial deletion, clear confirmation and preservation of unrelated data. Separately mocked quota errors, corruption and source outages verify failure behaviour. These are not tests on a physical iPhone, nor a Safari certification.
