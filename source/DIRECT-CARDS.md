# DLKT Info 0.9.13 — Direct public cards

## User-visible scope

Topic cards can now share a DLKT URL rather than sending the recipient only to the publisher. The recipient opens the selected public document with its date, source, existing explanatory context and verified source excerpts where supported. The core card is server-rendered and readable without JavaScript or an account. The existing visual identity and stylesheet are reused. Original publisher access and sharing remain available. Personal-edition topic cards also have the share action. Local city/transport/weather cards are not included in this release's sharing scope.

The recipient can choose the card's connected topic to preview a personal briefing. This passes only a validated topic enum; it never imports the sender's query, city, settings, saved documents, feedback or history. Opening a card does not write browser data. Opening the topic preview does not overwrite an existing personal briefing or advance its baseline, including when its configuration happens to match. Explicit saving is required; replacement of a different saved profile requires confirmation.

## Identity, provenance and boundaries

The public path contains a source-derived document ID. The optional version parameter is the publisher-metadata hash already produced by ICEO, not a signed authentication token or a hash of the complete article. It is neither a permanent archive nor a frozen copy of everything the sender saw. A current matching catalog record is revalidated server-side. When its metadata differs, the page explicitly shows the current listing rather than reconstructing the old wording. Records absent from a complete catalog produce an honest missing state. An incomplete or unavailable catalog cannot support a claim that the document disappeared; it produces an unavailable state. No arbitrary replacement is shown.

The read-only endpoint accepts GET/HEAD only. It rejects extra parameters, duplicate/conflicting references, traversal, untrusted URLs and browser-supplied content before source acquisition. It recomputes the document identity and metadata digest, requires current contributing sources and validates excerpt identity, timestamps and hashes. Invalid or unsupported excerpts are not displayed. User/source text is escaped for HTML. Fixed canonical origins do not trust Host or forwarded headers. The response uses no-store, no-referrer and a self-only CSP. The UI flags expiry without polling. Source-document dates are not rewritten as the current date.

Open Graph and summary metadata are present in initial HTML. Rendering by third-party social platforms has not been certified. The existing preview noindex/robots policy is preserved; this is not an SEO launch. Native sharing is tested through an isolated browser stub, not a physical mobile sharing sheet. Clipboard rejection preserves a selectable link; cancelling native share does not claim success. No subscription, paid service, database, DNS/email setting, account sync, background job or new source provider is activated.

## Verification

Unit checks cover malformed inputs, provenance mismatch, duplicate identities, failure and partial-source semantics, escaped publisher text, current-version notices, unsupported content, timestamps, response security and no-write semantics. Browser checks use real source records, simulated share/clipboard permissions, JavaScript-disabled reading, responsive widths, explicit topic preview, saved-profile protection and a controlled browser clock for expiry. Controlled failures do not change upstream or public records. Chromium automation is not Safari or physical-iPhone certification. Tests do not prove adoption, daily retention or paid conversion.
