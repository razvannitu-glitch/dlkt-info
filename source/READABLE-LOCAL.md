# Readable local cards and visible source buttons

Source: DLKT Info 0.9.14, commit 4023dc58574886e6ef19e0d128e9ee9279d9fec8. Requested outcome: make the primary source action recognisable at rest with brand coral #F66061, black background and white text on hover, and a visible keyboard focus state. Do not change other controls, layout, typography, palette or source acquisition.

Local and personal briefing cards must show a plain description, local event time, venue and complete admission conditions without repeated generic selection statements. Source check timestamps, expiry, original wording, attribution and evidence stay accessible in details. Expiry is never presented as event duration. Unknown admission terms remain verbatim; only a reviewed exact phrase can be rendered in English. The data and source contracts do not change.

Acceptance: computed default, hover, keyboard focus and touch styles; no horizontal overflow at 320, 390, 768 and 1440 px; 100% and 200% presentation; preserved source target and evidence; unchanged raw local data; truthful partial coverage. Strict TypeScript, relevant regression tests and the existing release gate apply before the same staged build is published. Resource boundary: one existing sandbox session, no paid feed, account, model or background job.
