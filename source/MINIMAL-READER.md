# DLKT Info 0.9.7 — Minimal Reader

## Scope
User-authorized visual simplification of the public 0.9.6 reader. Built in a separate worktree from public commit 5f96e44a9ae3ac6f30cc3eb54cc746e60fa1978e. The internal durable-dispatch branch and its unpublished database, archive and scheduled-generation candidates are not merged into this release.

## Visible changes
Single centered reading column without marketing hero or permanent settings sidebar. Three primary modes: Briefing, Changes, Saved. Explore records and source coverage are secondary actions in More. The same topic selection remains available, with bounded horizontal topic scrolling on narrow screens rather than page overflow.

Personalise opens a labelled native modal dialog; Escape, close button and outside clicks dismiss it. Search gets focus and the background is inert. Settings preview live; submitting explicitly returns to Briefing, including when opened from Changes. Remember requires explicit consent as before. Browser data management is disclosed inside the dialog; save/error acknowledgements also have a compact live-region toast outside it.

White cards use quieter category markers, lighter borders, compact source/date rows and a maximum four-line reading title. The source details retain the unabridged original title and original timestamp. Evidence remains available, including incomplete coverage and the historical status of saved copies. No article summary or location coverage was invented. Source excerpts, canonical evidence, filtering, save/restore, comparison and offline downloads are preserved.

Keep this edition invokes the existing preparation flow; it does not imply automatic persistence or email. Accounts, cross-device memory and timed delivery remain inactive and explicitly labelled. Only black, white and #f66061 are literal palette colours; neutral shades derive from those colours. No new fonts, trackers or dependencies.

## Verification boundary
Full strict-TypeScript/unit/database release suite. Chromium browser regression covers reader selection, saved browser data, explicit source comparison, source excerpts, exact downloadable editions and the new modal/navigation flow. Dimensions 320x780, 390x844, 768x1024 and 1440x1000; an extra CSS 200-percent zoom check exercises reflow but is not a physical-device/browser-zoom certification. No claim of Safari or physical iPhone validation. Testing includes controlled invalid responses and unavailable-source simulations that are never published as real data.

## Deployment
One source build staged and tested on info.dlkt.ee before assigning www.dlkt.ee. Existing DNS, email, billing, DB gates and legacy redirects remain unchanged. Public source visibility and deployment authentication remain as previously configured. No hosted migrations or cron registration.

## Source compatibility found during staging

The first staging regression detected an ECB canonical URL emitted with two leading path slashes. The unchanged old public release rejected the same page with INSIGHT_DOCUMENT_MISMATCH. This release accepts only that exact first-party spelling variant for the already-requested /press/ document, with identical title and all content checks preserved. Other paths, hosts, schemes, credentials, query strings, fragments and additional slash variants remain rejected. The source extraction policy is not generally relaxed.
