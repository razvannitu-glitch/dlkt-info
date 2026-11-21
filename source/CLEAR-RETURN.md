# DLKT Info 0.9.11 — Clear return

## User-visible scope

Continues the already-deployed personal edition (a1133e7). The approved entry, stylesheet, palette, hover and data providers are preserved. No account, paid service, new category, email, background polling, analytics destination or other project is enabled.

On return, changed and newly included topic cards stay in the primary reading sequence. Previously included unchanged topic cards remain accessible in a collapsed “Previously included” disclosure. City operational cards are never hidden by that grouping. A compact factual overview distinguishes changed, newly included, unchanged and incomplete coverage without asserting that the person read a card. New-to-selection does not mean newly published. The same source excerpts and evidence remain available.

A changed metadata field gains a concise visible explanation; the exact prior and current values stay in Source and details. Title changes are not interpreted as substantive real-world changes. Weather headings name the selected city instead of retaining a relative “next six hours” phrase as time passes; the source forecast period remains explicit.

## Time and memory

The existing one-hour topic source-verification window is now enforced while a page remains open, as well as on return from a hidden tab or persisted browser page. Local operational validity, the selected local date and the procurement publisher date also trigger clock-only re-evaluation. Expiry never sends another source request, advances the last complete persisted edition or silently re-marks evidence as fresh. Refresh remains explicit.

“Not today” ends at the actual next calendar date in the chosen timezone, including daylight-saving transitions and fractional-hour offsets. It does not assume 24 hours. Changed card versions may reappear earlier under the existing rules. The pure date-boundary tests cover the 23- and 25-hour Bucharest transitions, Kathmandu, New York and UTC.

Removing the personal briefing now also clears its in-memory comparison baseline. Undoing temporary suppression in a different unsaved preview cannot modify an unrelated saved personal profile. Saved cards and older independent city/topic preferences are unaffected.

## Verification

Tests include pure reading projection and time boundaries, existing personal edition and entry regressions, live public-source selection, explicit memory restoration, controlled metadata changes and source outages, clock-controlled topic and operational expiry, local date rollover and a persisted-page restoration event. Synthetic response/clock changes are confined to isolated browser contexts and never alter published source data.

Browser scripts are retained under tests/browser and run from the existing ui-check tooling directory. Chromium automation is not certification on Safari or a physical iPhone. No claim of adoption, subscription conversion or zero possible errors follows from these tests.
