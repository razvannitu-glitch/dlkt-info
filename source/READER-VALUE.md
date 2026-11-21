# DLKT Info 0.9.1 — Reading and Selection

This release improves the existing six-source public preview. It does not claim new source coverage, full-document summaries, user accounts, continuous monitoring or scheduled delivery.

## Reading contract

The first mobile view prioritises actual cards. Detailed personalisation starts collapsed on mobile, with one-tap topic selection visible. The exact black, white and #F66061 palette is retained. SVG strokes replace emoji arrows. Inputs use 16px text and primary interactions target at least 44 CSS pixels. No forced snap scrolling or infinite-scroll loading is added.

The shared strict-TypeScript reader classifies procurement notices from explicit title and closing-date metadata. Award, cancellation, expired and unconfirmed application windows are excluded from the default Briefing but preserved in Explore records. A future deadline never becomes a claim of verified open eligibility. Publisher calendar dates use Europe/Berlin; due-today notices require checking the exact source time.

Software releases are grouped by official product, preserving all linked versions in an expandable list. User text filtering is applied before grouping, so an older version remains discoverable. The selection takes recent metadata first while varying publishers; this is transparent selection, not learned personal relevance.

Consolidated legal identities are labelled separately. Only a date matching the consolidation suffix is called a consolidation date. A consolidated text is not described as a newly adopted law. Long headings are explicitly shortened, while the complete original title remains inspectable. Context paragraphs explain the record type and its limitations; they are not article summaries.

Sharing sends the original source link via native share when available, otherwise clipboard or a selectable field. It does not yet create permanent DLKT card URLs or social previews. Filtering remains page-local with no account, hidden preference storage or private API payload.

## Delivery boundary

The public build contains only the read-only ICEO catalog and the tested reader assets. Existing product development modules remain preserved but unpublished. No DNS, World content, other project data, billing or delivery worker is changed.
