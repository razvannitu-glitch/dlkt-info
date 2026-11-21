# DLKT Info 0.9.10 — Personal edition

## Public result

The existing bright entry remains. “My briefing” previews one selection combining a confirmed city with explicitly selected connected topics. No topic is preselected on a fresh visit. A deliberate current topic choice can seed the preview; no generic institutional feed is added solely because it is available. The city contributes a centre forecast and, only for London, the existing Tube card. The source catalog has not expanded to cultural events, shopping, personal advice or unrestricted web search.

Saving the profile is explicit. After that, revisiting the same browser opens the personal edition directly and prepares current data. Settings remain collapsed. A complete prepared edition replaces the comparison baseline under an IndexedDB compare-and-swap transaction. This is a prepared-edition history of one preceding complete edition, not a claim about what was read, a cloud account, email delivery or background monitoring. An unavailable or partial required source does not advance the last complete baseline. A complete empty selection is distinguishable from failed acquisition.

## Value and boundaries

Each card explains the selection rule: city chosen, topic chosen, or explicit text filter. Existing source extracts are reused; this release does not claim full-document analysis or inferred personal consequences. Changed comparable metadata is prioritized. Newly included is distinct from newly published. Reverification time and transport hashes are not treated as material change. Removed items are not treated as resolved/withdrawn. A persistent-ID conflict is withheld.

“Useful” is explicit local feedback; it does not train a recommender or prove satisfaction. “Not today” hides only the same topic listing for the selected local calendar day, not a fixed 24-hour UTC interval. A material listing change can reappear before the day ends. Local operational cards cannot be hidden by this feedback. All hidden topic cards can be restored. Card saving reuses the existing Saved collection.

## Storage and privacy

The profile, last complete prepared edition and explicit feedback share the existing private browser database under a documented key. No additional analytics destination, database service, payment or personal-data endpoint is enabled. A preview does not persist its selection. Saved editions use a finite validated representation; unsupported fields are discarded. Saving on shared devices is discouraged in visible copy. Deleting only the personal briefing preserves the older card collection and city setting. Clearing the shared briefing store includes the new personal profile and does not revive it silently.

Race handling includes explicit choices beating late restoration, a saved personal profile taking precedence over older city/topic preferences, response tickets, exact canonical city/time-zone validation, and compare-and-swap writes. The browser is not a trusted source of facts; network results and saved objects are validated separately. Source fetches remain same-origin and source provenance stays inspectable.

## Verification

Pure tests cover scoped completeness, timestamp semantics, metadata change detection, query/grouping eligibility, invalid/corrupted storage, privacy field allowlists, local-day expiry including DST, and conflicting identities. Browser tests cover real source retrieval, preview versus explicit saving, revisit, source failure, a controlled changed listing, same-day suppression, unchanged local operational cards, existing card saves, concurrent tab writes, deletion, storage refusal, late restoration, and responsive reflow. Controlled response changes occur only in isolated browser tests, never in the public source service.

Current browser automation is Chromium. Safari/WebKit and an iPhone are not certified by these checks. The release does not establish adoption, daily retention, conversion or willingness to pay. No account, cross-device sync, durable card permalink, cultural-event coverage or scheduled delivery is activated.
