import { validLocalNewsArticle, NEWS_WINDOW_MS } from './local-news-policy.js';
import { currentLocalSnapshot, validCity, object, stamp, localEventEligible } from './local-contracts.js';
const kindOrder = { 'utility-notice': 0, 'transport-notice': 1, transport: 2, forecast: 3, event: 4, 'municipal-news': 5, 'local-news': 6 };
const folded = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function titleKey(card) { return folded(card.title).replace(/^(?:video|foto|breaking)\s*[|:—-]?\s*/u, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
/** Only identical normalized headlines or article URLs are grouped; similar wording may describe conflicting reports. */
function sameStory(a, b) {
    return a.sourceUrl === b.sourceUrl || titleKey(a) === titleKey(b);
}
function newsOrder(card, now) {
    if (!card.news)
        return Number.POSITIVE_INFINITY;
    const age = now - Date.parse(card.news.publishedAt), freshness = age < 86400000 ? 0 : age < 172800000 ? 1 : 2;
    const practical = card.news.topic === 'safety' ? 0 : ['transport', 'education', 'utilities', 'environment'].includes(card.news.topic) ? 1 : ['city', 'economy'].includes(card.news.topic) ? 2 : 3;
    return freshness * 10 + practical;
}
/** Source breadth and topic breadth follow freshness; this is a reading policy, not a calibrated impact score. */
function selectNews(cards, now) {
    const pool = [...cards].sort((a, b) => newsOrder(a, now) - newsOrder(b, now) || Date.parse(b.news?.publishedAt ?? '') - Date.parse(a.news?.publishedAt ?? '') || a.id.localeCompare(b.id));
    const selected = [], publishers = new Map(), topics = new Map();
    while (selected.length < 8) {
        const available = pool.filter(card => card.news && !selected.includes(card) && !selected.some(previous => sameStory(previous, card)) && (publishers.get(card.publisher) ?? 0) < 4 && (topics.get(card.news.topic) ?? 0) < 3);
        if (!available.length)
            break;
        available.sort((a, b) => Math.floor(newsOrder(a, now) / 10) - Math.floor(newsOrder(b, now) / 10)
            || Number(publishers.has(a.publisher)) - Number(publishers.has(b.publisher))
            || Number(topics.has(a.news?.topic ?? '')) - Number(topics.has(b.news?.topic ?? ''))
            || newsOrder(a, now) - newsOrder(b, now) || Date.parse(b.news?.publishedAt ?? '') - Date.parse(a.news?.publishedAt ?? '') || a.id.localeCompare(b.id));
        const next = available[0];
        if (!next?.news)
            break;
        selected.push(next);
        publishers.set(next.publisher, (publishers.get(next.publisher) ?? 0) + 1);
        topics.set(next.news.topic, (topics.get(next.news.topic) ?? 0) + 1);
    }
    return selected;
}
/** One city overview retains the exact operator document and source-check interval; it does not infer a user's sector. */
function operationalCards(cards, city) {
    const cmteb = cards.filter(card => card.kind === 'utility-notice' && /^bucharest:cmteb:sector-[1-6]$/u.test(card.id));
    if (city.id !== '683506' || cmteb.length < 2)
        return [...cards];
    const first = cmteb[0];
    if (!first?.context || cmteb.some(card => card.checkedAt !== first.checkedAt || card.context?.documentHash !== first.context?.documentHash))
        return [...cards];
    const sectors = cmteb.map(card => card.id.slice(-1)).sort().join(', ');
    const text = 'CMTEB lists heating or hot-water service notices for sectors ' + sectors + '. Check the official operator list for your street, the affected service and estimated restoration time.';
    const overview = { ...first, id: 'bucharest:cmteb:overview', title: 'Heating and hot-water updates in ' + city.name, text,
        validTo: new Date(Math.min(...cmteb.map(card => Date.parse(card.validTo)))).toISOString(), facts: cmteb.map(card => card.title),
        boundary: 'A city overview derived from the checked CMTEB sector records. It does not establish that your building is affected. Restoration times in the operator list are estimates.',
        context: { ...first.context, place: city.name + ' · sectors ' + sectors, when: 'Current operator list checked for ' + cmteb.length + ' sectors; exact areas and estimated times are at the source.',
            why: 'The same checked operator document contains service notices in several sectors of this city.', action: 'Check your street and building in the official operator list.' } };
    return [overview, ...cards.filter(card => !cmteb.includes(card))];
}
/** Actual local information only: map references and source directories never become edition cards. */
export function selectHomeLocal(snapshot, city, now) {
    if (!Number.isFinite(now) || !validCity(city) || !object(snapshot) || !stamp(snapshot.checkedAt))
        return { cards: [], expiresAt: null };
    const checked = Date.parse(snapshot.checkedAt);
    // Validate the complete source identity at its check, then expire records individually.
    // A short event does not erase an otherwise-current forecast or another local listing.
    if (checked > now + 5000 || now - checked >= 300000 || !currentLocalSnapshot(snapshot, city, checked))
        return { cards: [], expiresAt: null };
    const eligible = operationalCards(snapshot.cards.filter(card => Date.parse(card.validTo) > now && localEventEligible(card, now) && (card.kind !== 'local-news' || validLocalNewsArticle(card.news, city, now))), city);
    const news = selectNews(eligible.filter(card => card.kind === 'local-news'), now);
    const supporting = eligible.filter(card => card.kind !== 'local-news');
    const ordered = supporting.map((card, index) => ({ card, index })).sort((left, right) => {
        const kind = kindOrder[left.card.kind] - kindOrder[right.card.kind];
        if (kind)
            return kind;
        if (left.card.kind === 'event') {
            const leftVenue = left.card.context?.place === 'Venue not specified in the agenda' ? 1 : 0, rightVenue = right.card.context?.place === 'Venue not specified in the agenda' ? 1 : 0;
            if (leftVenue !== rightVenue)
                return leftVenue - rightVenue;
            // A verified start takes precedence. An undated publisher listing stays undated.
            const leftStart = left.card.context?.startsAt, rightStart = right.card.context?.startsAt;
            if (leftStart && rightStart)
                return Date.parse(leftStart) - Date.parse(rightStart) || left.index - right.index;
            if (leftStart)
                return -1;
            if (rightStart)
                return 1;
        }
        if (left.card.kind === 'municipal-news') {
            const leftDate = left.card.context?.sourceDate, rightDate = right.card.context?.sourceDate;
            if (leftDate && rightDate)
                return rightDate.localeCompare(leftDate) || left.index - right.index;
        }
        return left.index - right.index;
    });
    const kinds = new Set(), cards = [...news];
    for (const { card } of ordered) {
        if (kinds.has(card.kind))
            continue;
        cards.push(card);
        kinds.add(card.kind);
        if (cards.length === 12)
            break;
    }
    // A first pass gives different kinds visibility; the remaining local information is retained.
    while (cards.length < Math.min(12, ordered.length + news.length)) {
        const before = cards.length;
        for (const kind of kinds) {
            if (news.length && cards.filter(card => card.kind === kind).length >= 2)
                continue;
            const next = ordered.find(item => item.card.kind === kind && !cards.includes(item.card));
            if (next)
                cards.push(next.card);
            if (cards.length === 12)
                break;
        }
        if (cards.length === before)
            break;
    }
    if (!cards.length)
        return { cards: [], expiresAt: null };
    const expiries = [checked + 300000, ...cards.flatMap(card => [Date.parse(card.validTo), ...(card.news ? [Date.parse(card.news.publishedAt) + NEWS_WINDOW_MS + 1] : []), ...(card.context?.startsAt ? [Date.parse(card.context.endsAt ?? card.context.startsAt)] : [])])].filter(time => time > now);
    return { cards, expiresAt: Math.min(...expiries) };
}
