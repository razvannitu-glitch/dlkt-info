import { validCity, stamp } from './local-contracts.js';
import { newsFeedsFor, NEWS_CHECK_MS } from './local-news-policy.js';
import { localCandidateExpiry, orderLocalCandidates, selectLocalCandidates } from './home-local.js';
import { parsePersonalLocalProfile } from './personal-contracts.js';
export { LOCAL_NEEDS, PERSONAL_LOCAL_VERSION, parsePersonalLocalProfile } from './personal-contracts.js';
const KIND_NEED = {
    forecast: 'weather', transport: 'mobility', 'transport-notice': 'mobility',
    'utility-notice': 'utilities', event: 'culture', 'municipal-news': 'administration',
    'local-news': 'local-reporting',
};
const NEED_DOMAIN = {
    weather: null, mobility: 'transport', utilities: 'utilities',
    culture: 'events', administration: 'administration', 'local-reporting': null,
};
function needResult(need, state, cards, checkedAt, sourceUrls, note, expiresAt = null) {
    return Object.freeze({
        coverage: Object.freeze({ need, state, matchedCount: cards.length, checkedAt,
            sourceUrls: Object.freeze([...new Set(sourceUrls)]), note }),
        cards: Object.freeze([...cards]), expiresAt,
    });
}
function freshCheck(value, now) {
    return value !== null && stamp(value) && Date.parse(value) <= now + 5_000
        && Date.parse(value) + NEWS_CHECK_MS > now;
}
function earliestCheck(values) {
    let result = null;
    for (const value of values) {
        if (result === null || Date.parse(value) < Date.parse(result))
            result = value;
    }
    return result;
}
function cardSources(cards) {
    return cards.map(card => card.sourceUrl);
}
function cardsFor(cards, need) {
    return cards.filter(card => KIND_NEED[card.kind] === need);
}
/** Current reviewed publication capabilities, not discovery or new source activation. */
function publicationSource(city, need) {
    if (city.id === '2512989' && city.countryCode === 'ES' && city.timezone === 'Europe/Madrid') {
        if (need === 'mobility')
            return 'https://www.tib.org/es/avisos';
        if (need === 'culture')
            return 'https://www.palmacultura.com/index.php?Idi=2';
        if (need === 'administration')
            return 'https://noticies.palma.es/inici';
    }
    if (city.id === '683506' && city.countryCode === 'RO' && city.timezone === 'Europe/Bucharest') {
        if (need === 'culture')
            return 'https://arcub.ro/agenda';
        if (need === 'utilities')
            return 'https://www.cmteb.ro/functionare_sistem_termoficare.php';
    }
    return null;
}
function checkedOperational(need, snapshot, cards) {
    const state = need === 'weather' ? snapshot.weatherState : snapshot.transportState;
    if (state === 'ready' && cards.length > 0) {
        return needResult(need, 'ready', cards, earliestCheck(cards.map(card => card.checkedAt)), cardSources(cards), cards.map(card => card.boundary).join(' '));
    }
    return needResult(need, state === 'not-covered' ? 'not-covered' : 'unavailable', [], null, [], need === 'weather'
        ? 'A current city-centre forecast could not be verified. This is not a weather all-clear.'
        : 'A current London Tube status could not be verified. Other transport is not covered.');
}
function checkedPublication(need, snapshot, cards, now) {
    const domain = NEED_DOMAIN[need], expected = publicationSource(snapshot.city, need);
    const row = domain === null ? undefined
        : snapshot.coverage?.find(item => item.domain === domain);
    if (expected === null) {
        return needResult(need, 'not-covered', [], null, [], row?.state === 'not-covered' ? row.note : 'This need has no connected publication source for the selected city.');
    }
    if (row === undefined) {
        // Legacy accepted records remain visible, but no successful coverage receipt is invented.
        if (cards.length > 0) {
            return needResult(need, 'partial', cards, earliestCheck(cards.map(card => card.checkedAt)), cardSources(cards), 'Only these accepted source records are available; a complete source-check receipt for this need is missing.');
        }
        return needResult(need, 'unavailable', [], null, [expected], 'The selected source check is missing. No matching card does not mean nothing is happening.');
    }
    if (row.state === 'not-covered') {
        return needResult(need, 'not-covered', [], null, [], row.note);
    }
    if (row.state === 'unavailable') {
        return needResult(need, 'unavailable', [], null, [expected], row.note);
    }
    if (row.sourceUrl !== expected || !freshCheck(row.checkedAt, now)) {
        return needResult(need, 'unavailable', [], null, [expected], 'The source-check identity or freshness could not be verified. ' + row.note);
    }
    const originalCount = cardsFor(snapshot.cards, need).length;
    if (originalCount > 0 && cards.length === 0) {
        return needResult(need, 'unavailable', [], row.checkedAt, [expected], 'The previously checked matching records have expired. Refresh the source before relying on this view. ' + row.note);
    }
    const state = row.state === 'partial' || cards.length < originalCount ? 'partial' : 'ready';
    return needResult(need, state, cards, row.checkedAt, [expected], row.note, Date.parse(row.checkedAt) + NEWS_CHECK_MS);
}
function checkedReporting(snapshot, cards, now) {
    const need = 'local-reporting';
    const definitions = newsFeedsFor(snapshot.city), sources = snapshot.newsSources;
    if (definitions.length === 0) {
        return needResult(need, 'not-covered', [], null, [], 'Local publisher feeds are not connected for the selected city.');
    }
    if (sources === undefined) {
        return needResult(need, 'unavailable', [], null, definitions.map(source => source.endpoint), 'The local publisher checks are missing. This does not establish that no local reports exist.');
    }
    const fresh = sources.filter(source => source.state !== 'unavailable' && freshCheck(source.checkedAt, now));
    const usableIds = new Set(fresh.map(source => source.sourceId));
    const usable = cards.filter(card => card.news !== undefined && usableIds.has(card.news.sourceId));
    const checked = fresh.flatMap(source => source.checkedAt === null ? [] : [source.checkedAt]);
    const checkedAt = earliestCheck(checked);
    if (fresh.length === 0 || checkedAt === null) {
        return needResult(need, 'unavailable', [], null, definitions.map(source => source.endpoint), 'The connected local publisher checks are unavailable or expired. Missing information is not an all-clear.');
    }
    const partial = fresh.length !== sources.length || fresh.some(source => source.state === 'partial')
        || usable.length < cardsFor(snapshot.cards, need).length;
    return needResult(need, partial ? 'partial' : 'ready', usable, checkedAt, definitions.map(source => source.endpoint), 'Coverage is limited to the connected publisher feeds and records explicitly naming this city.'
        + (partial ? ' Some checks or records are incomplete or expired.' : usable.length === 0 ? ' A successful empty check is not evidence that nothing happened.' : ''), Date.parse(checkedAt) + NEWS_CHECK_MS);
}
function selectNeed(need, snapshot, candidates, now) {
    const cards = cardsFor(candidates, need);
    if (need === 'weather' || (need === 'mobility' && snapshot.city.id === '2643743')) {
        return checkedOperational(need, snapshot, cards);
    }
    if (need === 'local-reporting')
        return checkedReporting(snapshot, cards, now);
    return checkedPublication(need, snapshot, cards, now);
}
function emptyEdition(state, coverage = []) {
    return Object.freeze({ state, matches: Object.freeze([]), coverage: Object.freeze([...coverage]),
        checkedAt: null, expiresAt: null });
}
/** All eligible records in the accepted source snapshot, before homepage display caps.
 * Ready/no-match describe only the selected source checks, never exhaustive city
 * coverage or household impact. Original acquisition limits remain in coverage notes. */
export function selectPersonalLocalEdition(profileInput, snapshot, city, now) {
    if (profileInput === null)
        return emptyEdition('not-configured');
    const profile = parsePersonalLocalProfile(profileInput);
    if (profile.needs.length === 0)
        return emptyEdition('not-configured');
    const selectedCity = validCity(city) && city.id === profile.cityId ? city : null;
    const candidates = selectLocalCandidates(snapshot, selectedCity, now);
    if (candidates.state !== 'current') {
        const note = candidates.state === 'stale'
            ? 'The local source check has expired. Refresh before relying on it.'
            : 'Current local information for the confirmed city could not be verified. This is not an all-clear.';
        return emptyEdition('unavailable', profile.needs.map(need => needResult(need, 'unavailable', [], null, [], note).coverage));
    }
    const selections = profile.needs.map(need => selectNeed(need, candidates.snapshot, candidates.cards, now));
    const coverage = Object.freeze(selections.map(selection => selection.coverage));
    const matchedCards = orderLocalCandidates(selections.flatMap(selection => selection.cards));
    const matches = Object.freeze(matchedCards.map((card) => Object.freeze({
        card, reason: 'confirmed-city-and-declared-need', need: KIND_NEED[card.kind], applicability: 'city-context-only',
    })));
    const complete = coverage.every(item => item.state === 'ready');
    const partlyChecked = coverage.some(item => item.state === 'ready' || item.state === 'partial');
    const state = matches.length > 0
        ? complete ? 'ready' : 'partial'
        : complete ? 'no-match' : partlyChecked ? 'partial' : 'unavailable';
    const expiresAt = Math.min(localCandidateExpiry(matchedCards, Date.parse(candidates.checkedAt), now), ...selections.flatMap(selection => selection.expiresAt !== null && selection.expiresAt > now ? [selection.expiresAt] : []));
    return Object.freeze({ state, matches, coverage, checkedAt: candidates.checkedAt, expiresAt });
}
/** Compatibility wrapper for callers that only consume matches; invalid profiles still reject. */
export function selectPersonalLocal(profileInput, snapshot, city, now) {
    return selectPersonalLocalEdition(parsePersonalLocalProfile(profileInput), snapshot, city, now).matches;
}
