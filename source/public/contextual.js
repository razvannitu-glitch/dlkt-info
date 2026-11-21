import { contextForCard } from './context.js';
import { compareDailyUse } from './card-guide.js';
import { COMPARISON_MAX_AGE_MS } from './comparison.js';
import { normalizeFocus, readingCard, selectReadingCards } from './reader.js';
import { PUBLIC_TOPICS, TOPIC_LABELS } from './topics.js';
const DAY = 86_400_000;
const DEFAULT_PUBLICATION_WINDOW_MS = 14 * DAY;
const HEADLINE_WINDOW_MS = 2 * DAY;
const MAX_RECORDS = 5000;
const stopWords = new Set(['a', 'an', 'and', 'as', 'at', 'be', 'been', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'were', 'will', 'with']);
function publicationWindow(value) {
    if (value === null)
        return null;
    if (value === undefined)
        return DEFAULT_PUBLICATION_WINDOW_MS;
    if (!Number.isSafeInteger(value) || value <= 0)
        throw Error('CONTEXTUAL_WINDOW_INVALID');
    return value;
}
function current(card, now, window) {
    const published = Date.parse(card.date), checked = Date.parse(card.observedAt);
    return card.sourceState !== 'stale' && Number.isFinite(published) && Number.isFinite(checked)
        && published <= now && (window === null || published > now - window)
        && checked <= now + 300_000 && now - checked < COMPARISON_MAX_AGE_MS;
}
function stableOrder(a, b) {
    return Date.parse(b.date) - Date.parse(a.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function geographyKey(card) {
    const context = contextForCard(card);
    // Unknown geography does not establish compatibility with a specific country.
    return context.countries.length ? context.countries.map(c => c.code).sort().join(',') : `unknown:${context.basis}:${context.label}`;
}
function comparableHeadline(card) {
    if (card.kind !== 'publication')
        return null;
    const title = normalizeFocus(card.title).replace(/[‘’]/gu, "'").replace(/[‐‑‒–—]/gu, '-');
    const words = title.match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
    const meaningful = new Set(words.filter(word => word.length > 2 && !stopWords.has(word)));
    // An exact informative headline is only a grouping hint. Keep punctuation,
    // negation and numbers, and leave generic announcements as separate listings.
    return title.length >= 55 && words.length >= 8 && meaningful.size >= 7 ? title : null;
}
function comparableExcerpt(card) {
    if (card.summary === undefined)
        return null;
    const excerpt = normalizeFocus(card.summary).replace(/[‘’]/gu, "'").replace(/[‐‑‒–—]/gu, '-');
    const words = excerpt.match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
    const meaningful = new Set(words.filter(word => word.length > 2 && !stopWords.has(word)));
    return excerpt.length >= 80 && meaningful.size >= 12 ? excerpt : null;
}
/**
 * Conservative presentation grouping of matching publisher listings. Both
 * an informative headline and an informative excerpt must match exactly.
 * Related records retain their own text, source, date and attribution. This
 * does not assert one verified event, semantic equivalence or corroboration.
 */
export function groupRelatedListings(records, now, publicationWindowMs) {
    if (!Number.isFinite(now) || records.length > MAX_RECORDS)
        throw Error('CONTEXTUAL_INPUT_INVALID');
    const window = publicationWindow(publicationWindowMs), byId = new Map(), conflicts = new Set();
    for (const card of records) {
        if (!current(card, now, window) || conflicts.has(card.id))
            continue;
        const old = byId.get(card.id);
        if (old && (old.identity !== card.identity || old.contentHash !== card.contentHash)) {
            byId.delete(card.id);
            conflicts.add(card.id);
            continue;
        }
        if (!old || stableOrder(card, old) < 0)
            byId.set(card.id, card);
    }
    const result = [];
    const indexed = new Map();
    for (const card of [...byId.values()].sort(stableOrder)) {
        const headline = comparableHeadline(card), excerpt = comparableExcerpt(card);
        const key = headline === null || excerpt === null ? null : `${headline}\n${excerpt}\n${geographyKey(card)}`;
        const position = key === null ? undefined : indexed.get(key)?.find(index => {
            const group = result[index];
            return group !== undefined && Math.abs(Date.parse(group.card.date) - Date.parse(card.date)) <= HEADLINE_WINDOW_MS;
        });
        if (position !== undefined) {
            result[position]?.related.push(card);
            continue;
        }
        const index = result.length;
        result.push({ card, related: [], key });
        if (key !== null) {
            const positions = indexed.get(key) ?? [];
            positions.push(index);
            indexed.set(key, positions);
        }
    }
    return Object.freeze(result.map(group => Object.freeze({ card: group.card, related: Object.freeze(group.related), grouping: group.related.length ? 'matching-headlines' : 'single' })));
}
function explanation(card, countryCode) {
    const context = contextForCard(card), match = countryCode === null ? undefined : context.countries.find(country => country.code === countryCode);
    if (match) {
        const scope = context.basis === 'publisher-category' ? `Publisher-tagged ${match.name} coverage` : `${match.name} source scope`;
        return { reason: `${scope} · matches your selected city's country.`, localMatch: true };
    }
    return { reason: `${TOPIC_LABELS[card.topic]} · ${context.label}.`, localMatch: false };
}
/** Explicit topics/query constrain eligibility before contextual ordering. */
export function rankContextualCards(records, settings, now) {
    if (!Number.isFinite(now) || records.length > MAX_RECORDS || !Number.isSafeInteger(settings.budget) || settings.budget <= 0 || settings.budget > MAX_RECORDS
        || settings.topics.some(topic => !PUBLIC_TOPICS.includes(topic)) || new Set(settings.topics).size !== settings.topics.length
        || typeof settings.query !== 'string' || settings.query.length > 200
        || settings.countryCode !== null && !/^[A-Za-z]{2}$/u.test(settings.countryCode))
        throw Error('CONTEXTUAL_SETTINGS_INVALID');
    const window = publicationWindow(settings.publicationWindowMs), countryCode = settings.countryCode?.toUpperCase() ?? null;
    const live = records.filter(card => current(card, now, window));
    // Reuse the established notice eligibility, query matching and software grouping.
    const selected = selectReadingCards(live, { topics: settings.topics, query: settings.query, budget: Math.max(1, live.length), mode: 'briefing' }, now);
    const views = new Map(selected.cards.map(view => [view.card.id, view]));
    const groups = groupRelatedListings(selected.cards.map(view => view.card), now, window);
    const remaining = groups.map(group => {
        const base = views.get(group.card.id), related = [...group.related, ...(base?.related ?? [])];
        const seen = new Set([group.card.id]);
        const allRelated = related.filter(card => { if (seen.has(card.id))
            return false; seen.add(card.id); return true; });
        const grouping = group.related.length ? 'matching-headlines' : allRelated.length ? 'software-versions' : 'single';
        return Object.freeze({ ...readingCard(group.card, now, allRelated), ...explanation(group.card, countryCode), grouping });
    }).sort((a, b) => Number(b.localMatch) - Number(a.localMatch) || compareDailyUse(a.card, b.card));
    const chosen = [], topics = new Set(), publishers = new Set();
    while (remaining.length && chosen.length < settings.budget) {
        let position = remaining.findIndex(view => !topics.has(view.card.topic) && !publishers.has(view.card.publisher));
        if (position < 0)
            position = remaining.findIndex(view => !publishers.has(view.card.publisher));
        if (position < 0)
            position = remaining.findIndex(view => !topics.has(view.card.topic));
        if (position < 0) {
            topics.clear();
            publishers.clear();
            position = 0;
        }
        const view = remaining.splice(position, 1)[0];
        if (!view)
            break;
        chosen.push(view);
        topics.add(view.card.topic);
        publishers.add(view.card.publisher);
    }
    return Object.freeze(chosen);
}
