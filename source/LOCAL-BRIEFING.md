# DLKT Info 0.9.8 — Confirmed city and local briefing

## Public scope

A city must be explicitly chosen before local content is collected. A platform IP-derived city is a suggestion only. The existing reader, source-insight, local topic memory, comparison and edition downloads remain available. Local cards are a separate section; current topic edition downloads do not include these cards. No account, cross-device sync, push notification, scheduled email, payment, new infrastructure or background polling is activated.

## Location

A reviewed GeoNames cities15000 snapshot contains 34,215 populated-place entries. The catalog is server-side and is not downloaded in full by the browser. Names, bounded alternate names, administrative region, country, IANA zone and a stable GeoNames ID disambiguate choices. Larger cities and capitals are covered, not every village, address or city boundary. Diacritic-normalized search starts with one character. Localized aliases are supported only where included by the dataset; no global completeness guarantee is made.

Optional device geolocation is requested only on a click. The browser rounds latitude/longitude to two decimals before a same-origin POST. The endpoint validates age, range and accuracy, rounds again, returns nearby city-centre candidates, and does not persist the user's position. It does not transmit GPS coordinates to a geocoder. Public forecast requests use the chosen city's canonical centre at four decimals, never a claimed home address. Normal infrastructure request logging still exists; the implementation makes no zero-logging claim. Manual choices are not replaced by later IP hints.

## Primary sources

MET Norway Locationforecast compact is verified for geometry, units, model age and complete consecutive hourly periods. The next six full hourly precipitation periods are combined; temperature range is over the seven associated hourly point forecasts, not observed extrema. Wind is converted from m/s to km/h, not represented as gusts. The original model issue time and source check time remain distinct. Source attribution, terms and the CC BY 4.0 licence are accessible. This is not an official severe-weather-alert service.

London (GeoNames 2643743) adds current TfL Tube status only. Multiple line/status entries become one card with full operator notices under source details. Only currently applicable periods are considered; malformed or unidentifiable statuses fail closed. Good Service is expressly attributed to TfL, not an independent guarantee or an all-clear for all London transport. No created/modified metadata is misrepresented as an incident timestamp. Status expires in the reader after two minutes unless refreshed. TfL, OS and Geomni attributions are present.

## Return loop and storage

The user may explicitly save the city and a source comparison in a separate local IndexedDB store. A confirmed overwrite uses an atomic revision comparison to detect concurrent tabs. Returning restores that city and requests current data. Only overlapping forecast hours and comparable Tube reports are compared; a moving forecast window, repeated check or disappeared entry is not fabricated into a new incident or resolution. This is browser-only comparison on opening/manual refresh, not continuous server monitoring. Forgetting the local city leaves the user's separate topic collection intact. Topic-data deletion is labelled separately.

## Security and resource boundaries

New public APIs accept bounded queries, a canonical city ID, or a same-origin coarse-location POST with an explicit request marker. No arbitrary URLs, user cards, HTML or source domains are accepted. Source fetches are server-side, fixed-origin, TLS, redirect-rejecting, time-bounded and size-bounded. Expires and Last-Modified/304 are respected; identical in-flight calls are joined, instance caches and concurrent work are bounded, and 429/503 or failed calls are backed off. Public city snapshot responses have short CDN caching. These are not a distributed global rate limiter or an SLA; broader rollout requires shared source budgets and provider-limit/load validation. Paid products or provider accounts have not been activated.

## Verification boundaries

Unit/API tests include source identity, timezone and timestamp validation, hourly-window arithmetic, duplicate and ambiguous transport data, upstream outages, caching, request abuse and changed-city response rejection. Browser tests cover city selection, permission denial, stale positions, coarse-location payload, explicit local save, restoration, concurrent-tab conflict, expired status removal, old response races, blocked storage, mobile widths and preservation of the existing reader/hover. Synthetic fault responses are confined to test clients. Real source reads are separately identified.

Chromium testing is available. WebKit installation in this sandbox reports missing host libraries; the alternative local runtime cannot resolve the browser-download host. These attempts are recorded, not claimed as Safari/iPhone verification. No actual physical-device or production-load certification is asserted.
