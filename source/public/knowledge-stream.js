import { selectKnowledgeCards, validateKnowledgeCatalog } from './knowledge.js';
/** Exactly eleven news reports appear between distinct reviewed knowledge cards. */
export const INLINE_KNOWLEDGE_INTERVAL = 12;
const NEWS_PER_KNOWLEDGE = INLINE_KNOWLEDGE_INTERVAL - 1;
/** Local-only reading history; no device identifier, account token or network request. */
export const KNOWLEDGE_SEEN_KEY = 'dlkt-info-knowledge-seen-v1';
const KNOWLEDGE_ID = /^[a-z][a-z0-9-]{2,79}$/u;
export function readKnowledgeSeen(storage = () => localStorage) {
    try {
        const raw = storage().getItem(KNOWLEDGE_SEEN_KEY);
        if (raw === null || raw.length > 450_000)
            return new Set();
        const value = JSON.parse(raw);
        if (!Array.isArray(value) || value.length > 5000 || value.some(id => typeof id !== 'string' || !KNOWLEDGE_ID.test(id)))
            return new Set();
        return new Set(value);
    }
    catch {
        return new Set();
    }
}
export function writeKnowledgeSeen(seen, storage = () => localStorage) {
    if (seen.size > 5000 || [...seen].some(id => !KNOWLEDGE_ID.test(id)))
        return false;
    try {
        storage().setItem(KNOWLEDGE_SEEN_KEY, JSON.stringify([...seen]));
        return true;
    }
    catch {
        return false;
    }
}
function validContext(context) {
    return context !== null && typeof context === 'object' &&
        (context.countryCode === null || typeof context.countryCode === 'string' && /^[A-Z]{2}$/u.test(context.countryCode)) &&
        (context.cityId === null || typeof context.cityId === 'string' && context.cityId.length > 0 && context.cityId.length <= 80 && context.cityId.trim() === context.cityId) &&
        (context.timeZone === undefined || typeof context.timeZone === 'string' && context.timeZone.length <= 70);
}
/**
 * Geography belongs to the reviewed fact, never to its publisher.
 * A fact about another city in the selected country is only a country fallback;
 * its original geography label must still be shown by the renderer.
 */
export function selectInlineKnowledge(cards, context, now, seed) {
    if (!validContext(context))
        throw Error('INLINE_KNOWLEDGE_CONTEXT_INVALID');
    const tiers = { city: [], country: [], global: [] };
    for (const card of validateKnowledgeCatalog(cards)) {
        const geography = card.geography;
        if (geography === undefined) {
            tiers.global.push(card);
            continue;
        }
        if (context.countryCode === null || geography.countryCode !== context.countryCode)
            continue;
        const scope = context.cityId !== null && geography.cityIds.includes(context.cityId) ? 'city' : 'country';
        tiers[scope].push(card);
    }
    const result = [];
    for (const scope of ['city', 'country', 'global']) {
        for (const card of selectKnowledgeCards(tiers[scope], 'all', now, seed, context.timeZone ?? 'UTC'))
            result.push({ card, scope });
    }
    // Independent care information retains its first slot. A calendar-confirmed
    // fact then takes priority, followed by a source-reviewed recipe, if available.
    const elevate = (format, position) => {
        const index = result.findIndex(entry => entry.card.format === format);
        if (index < 0)
            return;
        const [entry] = result.splice(index, 1);
        if (entry)
            result.splice(Math.min(position, result.length), 0, entry);
    };
    elevate('care', 0);
    elevate('on-this-day', result[0]?.card.format === 'care' ? 1 : 0);
    elevate('recipe', result[0]?.card.format === 'care' ? (result[1]?.card.format === 'on-this-day' ? 2 : 1) : result[0]?.card.format === 'on-this-day' ? 1 : 0);
    return result;
}
/**
 * Project an append-only news prefix with the same selected knowledge list.
 * Original news objects and their order are preserved. An exhausted catalogue
 * leaves news uninterrupted; it is never recycled or padded with placeholders.
 */
export function interleaveKnowledge(news, knowledge) {
    const newsKeys = new Set(), knowledgeIds = new Set();
    for (const item of news) {
        if (typeof item.key !== 'string' || !item.key || newsKeys.has(item.key))
            throw Error('INLINE_NEWS_IDENTITY_INVALID');
        newsKeys.add(item.key);
    }
    for (const item of knowledge) {
        if (knowledgeIds.has(item.card.id))
            throw Error('INLINE_KNOWLEDGE_DUPLICATE');
        knowledgeIds.add(item.card.id);
    }
    const result = [];
    let afterNews = 0, knowledgeIndex = 0;
    for (const item of news) {
        result.push({ kind: 'news', item });
        afterNews++;
        if (afterNews % NEWS_PER_KNOWLEDGE !== 0)
            continue;
        const next = knowledge[knowledgeIndex];
        if (next === undefined)
            continue;
        result.push({ kind: 'knowledge', item: next, afterNews });
        knowledgeIndex++;
    }
    return result;
}
