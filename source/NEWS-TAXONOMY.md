# News taxonomy

## Vocabulary and attribution

DLKT uses the 17 top-level concepts of IPTC Media Topics, checked on 2026-11-22 against the official English (en-US) tree dated 2026-10-16:

https://www.iptc.org/std/NewsCodes/treeview/mediatopic/mediatopic-en-US.html

Scheme and canonical concept identifiers: http://cv.iptc.org/newscodes/mediatopic/

Standard overview: https://iptc.org/standards/media-topics/

The concept names and identifiers are © IPTC and licensed under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/

The exact IPTC English names are kept in iptcLabel. Short reader labels and Romanian translations are DLKT editorial labels, not official Romanian IPTC translations. The canonical HTTP identifier is not a content-fetch endpoint. No network lookup is needed at runtime.

## Classification policy

This module supplies a DLKT classifier over the standard vocabulary; IPTC does not provide or endorse these classification decisions.

An explicit publisher subject section is an exact URL path segment, excluding the final article slug. Geographic sections such as world, international, cities and country names are not treated as subjects. URL query strings never provide a subject. A specifically identified care-delivery headline, Retail Medicine, remains Health even on a broad business desk.

Where a publisher does not provide a subject section, the classifier uses the original headline. Specific legal actions, emergencies and armed conflicts take precedence over incidental institutional words. Financial results remain Economy; machine learning remains Science & technology; teachers' strikes concern Labour. School activity can be Education. A generic city reference does not establish housing or planning. Planning decisions, commercial housing and social housing are different subjects and must be supported by the reported headline.

The existing reviewed English, French, German, Spanish, Portuguese, Arabic and Japanese headline semantics remain available. The new rules add explicit Romanian headline evidence. These are bounded deterministic rules, not a claim of complete multilingual understanding. Unknown subjects remain null and must remain accessible in the reader.

Current EvidenceCard and LocalNewsArticle contracts do not expose publisher subject tags. The module does not manufacture them. A single, unambiguous existing category-discovery source ID can provide a compatibility hint for a terse global headline. An explicit news-unclassified marker disables that fallback. Broad world/housing hints and a default business Topic cannot classify an otherwise unknown record.

Local news is classified from news.title and news.url only. Its legacy news.topic may have been inferred from a summary; that value and the summary are intentionally excluded. Summaries never drive this classifier. Forecast/event record kinds have their existing narrow Weather/Culture context; generic city records receive no automatic housing category.

## Compatibility and boundary

NEWS_CATEGORIES, isNewsCategoryId and newsCategoryLabel provide the reader contract. classifyEvidenceCard and classifyLocalCard expose the category and its basis; newsCategory returns the ID or null. classifyNewsSubject is the shared headline/URL entry point.

legacyCategoryToNewsCategory is a DLKT compatibility projection, not an official IPTC mapping. It never rewrites stored preferences, old topic IDs, source IDs, titles, summaries, identity, content hashes or provenance. Ambiguous work-education and other values remain unmapped. The classifier never defaults an unknown story to Economy.

The module does not select or hide articles, change acquisition, translate headlines, alter locale selection, reorder cards, modify photos or change styles. Reader ordering and filtering are separate consumers.

## Regression coverage

The dedicated tests cover the exact 17 codes, canonical URIs, reader labels, Retail Medicine, financial/medical distinctions, school references appearing only in summaries, geographic-only headlines, publisher sections versus slugs, multilingual fallback, identity preservation and invalid inputs. Classification remains an editorial inference; ambiguous headlines should remain unclassified rather than acquiring a confident but unsupported topic.
