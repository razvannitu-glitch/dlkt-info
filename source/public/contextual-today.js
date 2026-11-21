import { contextForCard } from './context.js';
import { COMPARISON_MAX_AGE_MS } from './comparison.js';
import { rankContextualCards } from './contextual.js';
import { PUBLIC_TOPICS } from './topics.js';
import { PUBLIC_EDITORIAL_CATEGORIES, editorialCategory, headlineSignalPriority } from './editorial-categories.js';
import { compareEditorialCards, rankEditorialCards } from './editorial-ranking.js';
import { validateEditorialContext } from './editorial-relevance.js';
/** Compact-top preferences only, never limits on the complete eligible publication stream. */
export const DAILY_EDITION_POLICY = Object.freeze({ minimum: 20, target: 30, maximum: 40, perCategory: 2, perTopic: 2, perPublisher: 4, windowMs: 86_400_000 });
/** Match one representative per category before any category gets a second story. */
function representatives(candidates, keyOf, order) {
    const options = new Map();
    for (const view of candidates) {
        const key = keyOf(view), group = options.get(key) ?? [];
        if (!group.some(candidate => publisherKey(candidate) === publisherKey(view)))
            group.push(view);
        options.set(key, group);
    }
    const slots = new Map();
    const assign = (key, visited) => {
        for (const view of options.get(key) ?? []) {
            for (let index = 0; index < DAILY_EDITION_POLICY.perPublisher; index++) {
                const slot = JSON.stringify([publisherKey(view), index]);
                if (visited.has(slot))
                    continue;
                visited.add(slot);
                const previous = slots.get(slot);
                if (previous === undefined || assign(keyOf(previous), visited)) {
                    slots.set(slot, view);
                    return true;
                }
            }
        }
        return false;
    };
    const keys = [...options.keys()].sort((a, b) => (options.get(a)?.length ?? 0) - (options.get(b)?.length ?? 0) || order.indexOf(a) - order.indexOf(b));
    for (const key of keys)
        assign(key, new Set());
    const positions = new Map(candidates.map((view, index) => [view.card.id, index]));
    return [...slots.values()].sort((a, b) => (positions.get(a.card.id) ?? 0) - (positions.get(b.card.id) ?? 0));
}
function publisherKey(view) {
    return view.card.publisher.normalize('NFKC').trim().toLowerCase();
}
function coverage(first, candidates, now, limit) {
    const selectedTopics = PUBLIC_TOPICS.filter(topic => first.some(view => view.card.topic === topic));
    const availableTopics = PUBLIC_TOPICS.filter(topic => candidates.some(view => view.card.topic === topic));
    const selectedCategories = PUBLIC_EDITORIAL_CATEGORIES.filter(category => first.some(view => view.category === category));
    const availableCategories = PUBLIC_EDITORIAL_CATEGORIES.filter(category => candidates.some(view => view.category === category));
    const missingCategories = PUBLIC_EDITORIAL_CATEGORIES.filter(category => !selectedCategories.includes(category));
    return Object.freeze({ windowStart: new Date(now - DAILY_EDITION_POLICY.windowMs).toISOString(), windowEnd: new Date(now).toISOString(), minimum: 20, target: 30, limit,
        selectedTopics: Object.freeze(selectedTopics), availableTopics: Object.freeze(availableTopics), missingTopics: Object.freeze(PUBLIC_TOPICS.filter(topic => !selectedTopics.includes(topic))),
        selectedCategories: Object.freeze(selectedCategories), availableCategories: Object.freeze(availableCategories), missingCategories: Object.freeze(missingCategories),
        completeCoverage: missingCategories.length === 0, belowMinimum: first.length < DAILY_EDITION_POLICY.minimum, belowTarget: first.length < DAILY_EDITION_POLICY.target, eligibleCount: candidates.length });
}
/** Importance precedes top-page balance. Every other eligible story remains accessible in more. */
export function selectContextualToday(records, context, now) {
    const limit = context.limit ?? DAILY_EDITION_POLICY.target;
    if (![20, 30, 40].includes(limit))
        throw Error('DAILY_EDITION_LIMIT_INVALID');
    if (!Number.isFinite(now) || records.length > 5000)
        throw Error('DAILY_EDITION_CONTEXT_INVALID');
    validateEditorialContext(context);
    if (context.localEdition)
        return selectLocalToday(records, context, now, limit);
    const candidates = rankEditorialCards(records, now, context), first = [];
    const featured = (view) => view.editorial.signals.includes('publisher-frontpage');
    const priority = (view) => headlineSignalPriority(view.editorial.headlineSignals);
    const strength = (view) => JSON.stringify([view.editorial.developmentPriority, view.editorial.relevance.priority,
        view.editorial.classification === 'category-discovery' || view.card.sourceIds.includes('news-unclassified'), priority(view) === 2, featured(view), priority(view)]);
    const used = new Set(), identities = new Set(), urls = new Set();
    const categories = new Map(), publishers = new Map();
    const available = (view, firstCategory = false) => !used.has(view.card.id) && !identities.has(view.card.identity) && !urls.has(view.card.sourceUrl)
        && (view.category === undefined || view.editorial.globalEssential || (categories.get(view.category) ?? 0) < DAILY_EDITION_POLICY.perCategory)
        && (view.editorial.globalEssential || view.editorial.developmentPriority >= 2 && priority(view) === 2 || featured(view)
            || firstCategory && view.category !== undefined && !categories.has(view.category) || (publishers.get(publisherKey(view)) ?? 0) < DAILY_EDITION_POLICY.perPublisher);
    const take = (view, firstCategory = false) => {
        if (first.length >= limit || !available(view, firstCategory))
            return false;
        first.push(view);
        for (const card of [view.card, ...view.related]) {
            used.add(card.id);
            identities.add(card.identity);
            urls.add(card.sourceUrl);
        }
        if (view.category !== undefined)
            categories.set(view.category, (categories.get(view.category) ?? 0) + 1);
        publishers.set(publisherKey(view), (publishers.get(publisherKey(view)) ?? 0) + 1);
        return true;
    };
    // A third essential development is not exchanged for a weak category filler.
    // The compact-top ceiling remains bounded; overflow stays in the complete stream.
    for (const view of candidates)
        if (view.editorial.globalEssential)
            take(view, true);
    // Explanatory/listicle/minor-product items stay accessible below rather than
    // padding the compact top to a promised number or category count.
    for (const developmentPriority of [2, 1]) {
        const level = candidates.filter(view => view.editorial.developmentPriority === developmentPriority);
        // Confirmed publisher placement can earn a top position without a category label.
        for (const view of level)
            if (view.category === undefined && featured(view))
                take(view);
        const classified = level.filter((view) => view.category !== undefined);
        const bestStrength = new Map();
        for (const view of classified)
            if (!categories.has(view.category) && !bestStrength.has(view.category))
                bestStrength.set(view.category, strength(view));
        const representativePool = classified.filter(view => !categories.has(view.category) && strength(view) === bestStrength.get(view.category));
        for (const view of representatives(representativePool, view => view.category, PUBLIC_EDITORIAL_CATEGORIES))
            take(view);
        for (const view of classified)
            if (!categories.has(view.category))
                take(view, true);
        for (const view of level) {
            if (first.length >= limit)
                break;
            take(view);
        }
    }
    // Diversity controls membership. Readers see importance and context order,
    // rather than a mechanical first-category/second-category sequence.
    first.sort(compareEditorialCards);
    const more = candidates.filter(view => !used.has(view.card.id) && !identities.has(view.card.identity) && !urls.has(view.card.sourceUrl));
    return Object.freeze({ first: Object.freeze(first), more: Object.freeze(more), daily: coverage(first, candidates, now, limit) });
}
/** The explicit local-only path retains the prior personal reader ordering and eligibility. */
function selectLocalToday(records, context, now, limit) {
    const countryCode = (context.city?.countryCode ?? context.countryCode)?.toUpperCase() ?? null;
    const eligible = records.filter(card => {
        if (card.dateLabel === 'Document date' || card.kind === 'legal-document')
            return false;
        const geography = contextForCard(card);
        if (countryCode && geography.basis === 'publisher-scope' && geography.countries.length && !geography.countries.some(country => country.code === countryCode))
            return false;
        return !['regulation', 'opportunities'].includes(card.topic) || context.preferredTopics.includes(card.topic);
    });
    const ranked = rankContextualCards(eligible, { countryCode, topics: PUBLIC_TOPICS, query: '', budget: Math.max(1, records.length), publicationWindowMs: DAILY_EDITION_POLICY.windowMs }, now);
    const candidates = ranked.map((view, index) => ({ view, index })).sort((a, b) => Number(b.view.localMatch) - Number(a.view.localMatch)
        || Number(context.preferredTopics.includes(b.view.card.topic)) - Number(context.preferredTopics.includes(a.view.card.topic)) || a.index - b.index).map(({ view }) => {
        const category = editorialCategory(view.card);
        return category === null ? view : { ...view, category };
    });
    const first = [], used = new Set(), identities = new Set(), urls = new Set(), topics = new Map(), publishers = new Map();
    const available = (view) => !used.has(view.card.id) && !identities.has(view.card.identity) && !urls.has(view.card.sourceUrl)
        && (topics.get(view.card.topic) ?? 0) < 3 && (publishers.get(publisherKey(view)) ?? 0) < DAILY_EDITION_POLICY.perPublisher;
    const take = (view) => {
        if (first.length >= limit || !available(view))
            return false;
        first.push(context.preferredTopics.includes(view.card.topic) ? { ...view, reason: `From your saved interests. ${view.reason}` } : view);
        for (const card of [view.card, ...view.related]) {
            used.add(card.id);
            identities.add(card.identity);
            urls.add(card.sourceUrl);
        }
        topics.set(view.card.topic, (topics.get(view.card.topic) ?? 0) + 1);
        publishers.set(publisherKey(view), (publishers.get(publisherKey(view)) ?? 0) + 1);
        return true;
    };
    for (const view of representatives(candidates, view => view.card.topic, PUBLIC_TOPICS))
        take(view);
    while (first.length < limit) {
        const remaining = candidates.filter(available);
        if (!remaining.length)
            break;
        const fewest = Math.min(...remaining.map(view => topics.get(view.card.topic) ?? 0));
        const next = remaining.find(view => (topics.get(view.card.topic) ?? 0) === fewest);
        if (!next || !take(next))
            break;
    }
    return Object.freeze({ first: Object.freeze(first), more: Object.freeze([]), daily: coverage(first, candidates, now, limit) });
}
/** Reproject at the exact daily-window or source-check boundary; never renew source dates. */
export function nextDailyEditionDelay(selection, now) {
    const cards = [...selection.first, ...selection.more].flatMap(view => [view.card, ...view.related]);
    const boundaries = cards.flatMap(card => [Date.parse(card.observedAt) + COMPARISON_MAX_AGE_MS, Date.parse(card.date) + DAILY_EDITION_POLICY.windowMs]).filter(value => Number.isFinite(value) && value > now);
    return boundaries.length ? Math.min(2_147_483_647, Math.max(25, Math.min(...boundaries) - now + 1)) : null;
}
