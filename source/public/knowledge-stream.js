import { selectKnowledgeCards, validateKnowledgeCatalog } from './knowledge.js';
/** A knowledge card follows each complete group of 22 original news records. */
export const INLINE_KNOWLEDGE_INTERVAL = 23;
const NEWS_PER_KNOWLEDGE = INLINE_KNOWLEDGE_INTERVAL - 1;
function validContext(context) {
    return context !== null && typeof context === 'object' &&
        (context.countryCode === null || typeof context.countryCode === 'string' && /^[A-Z]{2}$/u.test(context.countryCode)) &&
        (context.cityId === null || typeof context.cityId === 'string' && context.cityId.length > 0 && context.cityId.length <= 80 && context.cityId.trim() === context.cityId);
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
        for (const card of selectKnowledgeCards(tiers[scope], 'all', now, seed))
            result.push({ card, scope });
    }
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
