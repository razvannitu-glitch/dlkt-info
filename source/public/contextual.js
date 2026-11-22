import { contextForCard } from './context.js';
import { compareDailyUse } from './card-guide.js';
import { COMPARISON_MAX_AGE_MS } from './comparison.js';
import { readingCard, selectReadingCards } from './reader.js';
import { PUBLIC_TOPICS, TOPIC_LABELS } from './topics.js';
import { groupStories } from './story-grouping.js';
const DAY = 86_400_000;
const DEFAULT_PUBLICATION_WINDOW_MS = 14 * DAY;
const MAX_RECORDS = 5000;
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
/**
 * Use the shared story identity after existing freshness/window gates. Every
 * related record retains its own text, source, date and attribution; grouping
 * does not establish agreement, verification or independent corroboration.
 */
export function groupRelatedListings(records, now, publicationWindowMs) {
    if (!Number.isFinite(now) || records.length > MAX_RECORDS)
        throw Error('CONTEXTUAL_INPUT_INVALID');
    const window = publicationWindow(publicationWindowMs);
    return Object.freeze(groupStories(records.filter(card => current(card, now, window)), stableOrder).map(group => Object.freeze({ card: group.card, related: group.related, storyKey: group.key, grouping: group.basis })));
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
    // Quarantine conflicts before the legacy reader can collect duplicate IDs as
    // related software/listing records or apply a narrower topic/text filter.
    const live = groupRelatedListings(records, now, window).flatMap(group => [group.card, ...group.related]);
    // Reuse the established notice eligibility, query matching and software grouping.
    const selected = selectReadingCards(live, { topics: settings.topics, query: settings.query, budget: Math.max(1, live.length), mode: 'briefing' }, now);
    const views = new Map(selected.cards.map(view => [view.card.id, view]));
    // Publication groups are ephemeral reader views; regroup all their originals.
    // Software retains its separate product/version grouping below.
    const selectedRecords = selected.cards.flatMap(view => view.card.kind === 'publication' ? [view.card, ...view.related] : [view.card]);
    const groups = groupRelatedListings(selectedRecords, now, window);
    const remaining = groups.map(group => {
        const related = [...group.related, ...[group.card, ...group.related].flatMap(card => views.get(card.id)?.related ?? [])];
        const seen = new Set([group.card.id]);
        const allRelated = related.filter(card => { if (seen.has(card.id))
            return false; seen.add(card.id); return true; });
        const grouping = group.related.length ? group.grouping : allRelated.length ? 'software-versions' : 'single';
        return Object.freeze({ ...readingCard(group.card, now, allRelated), ...explanation(group.card, countryCode), grouping, storyKey: group.storyKey });
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
