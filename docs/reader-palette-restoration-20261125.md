# Restore approved DLKT card surfaces — 25 November 2026

The user reported that the reader had replaced the established full-card colors with almost white surfaces. The canonical source for this correction is commit ac30275d1752febccf94afa79cc24926e4d1b304 in razvannitu-glitch/dlkt-info. The previously approved palette and its semantic text/action pairs still exist in reader-theme.css, but later composition rules override them.

The approved Prism surface map is paper #F0EDE5, ivory #D8D6CD, coral #F66061, berry #142D44, wine #7D969B and gold #B7C4C3. The identifiers are existing internal keys, not new color names. The original Night category palette remains in use. The existing assignment mechanism and reading order are protected.

The runtime correction removes only the late neutral surface/semantic-role overrides and the replacement of full-card color by small news accent dots. It preserves the original palette declarations, text/action pairs, photograph handling, responsive layout, typography, badge padding, account styling, original headlines, source links, grouping, auth and data behavior.

Acceptance A1 requires the actual computed backgrounds of a complete six-variant Prism story cycle and local utility cards to match their assigned original swatches at mobile and desktop sizes. A2 requires readable actual title, metadata, source action and category text on every measured variant, with normal text contrast at least 4.5:1. A3 retains Night, image-fallback, keyboard, spacing and responsive gates from the existing browser suite. A4 requires the reviewed source tree, generated manifest and published release receipt to agree, followed by live verification on the official domain.

The former static palette tests read exact variant declarations without evaluating later CSS overrides. The browser suite checked Night contrast on a sample card, but not the painted Prism surfaces. This correction adds a browser regression against the rendered cards rather than changing the approved swatches or weakening contrast.

Scope is source/public/reader-theme.css, scripts/qa-browser.mjs, this task record and the generated source pin/release manifest. Existing GitHub generation and verification workflows are used without shell calls, new dependencies, infrastructure changes or production authentication changes. One generation and candidate suite are planned; another run requires a demonstrated code/test failure or changed publication environment.

Independent source and browser-contract review precede publication. Fixture results must be distinguished from live services and from physical Safari/iPhone checks. The prior deployment remains available as a rollback reference. Actual outcomes are recorded in the associated pull request after verification.

## Verified generation and review

Generation run 45504191101, job 138834993867, completed successfully from 4e45373ca6cad7cb9c3adcb2adba92187c5c9386. The generated two-file envelope was independently verified for framing, input commit, byte counts, SHA256, baseline identities, the complete 1003-file source index, manifest consistency and unchanged compiled news projection. Source SHA256 is 82153cccf3d9a23b8d55726abe908e6ad6a30a4fa45db2ad5b849f3c93d2d519; manifest SHA256 is 3e3fbe8f6183f72158e05bdd55210abdbacdecc3863796da46de87cd47e4b76d. Only the reader-theme.css source hash and generated manifest hash change within the source pin.

An independent CSS review found no blocking issue and confirmed byte-identical original palette declarations and responsive rules. The new browser check measures the actual six assigned Prism surfaces and actual text contrast across all seven fixture stories and two local utilities, then repeats after Night and return to Prism. The fixture continues to use failed photo requests; successful photographs require the separate live inspection. The root reviewed this QA change and confirmed the previous geometry and interaction probes remain unchanged. Browser execution and public receipt verification are still required before completion.
