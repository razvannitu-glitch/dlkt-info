import { PUBLIC_EDITORIAL_CATEGORIES, editorialCategory, classifyNewsHeadline } from './editorial-categories.js';
import { compareEditorialCards, rankEditorialCards } from './editorial-ranking.js';
import { validCity } from './local-contracts.js';
import { exploreGeography } from './explore-geography.js';
/** Apply the existing public eligibility/conflict gates to the entire corpus, then explore it. */
export function selectExploreCards(records, context, now) {
    const code = context.countryCode?.toUpperCase() ?? null, aliases = context.cityAliases ?? [];
    if (context.city !== null && !validCity(context.city) || code !== null && !/^[A-Z]{2}$/u.test(code)
        || context.category !== null && !PUBLIC_EDITORIAL_CATEGORIES.includes(context.category)
        || aliases.length > 32 || aliases.some(alias => typeof alias !== 'string' || alias.length < 2 || alias.length > 200 || /[\u0000-\u001f\u007f<>\p{Surrogate}]/u.test(alias)))
        throw Error('EXPLORE_CONTEXT_INVALID');
    if (context.city !== null && code !== null && context.city.countryCode !== code)
        throw Error('EXPLORE_CITY_COUNTRY_MISMATCH');
    const eligible = rankEditorialCards(records, now);
    const groups = { city: [], country: [], world: [] };
    const specificity = { city: 0, country: 1, world: 2 };
    for (const view of eligible) {
        const members = [view.card, ...view.related];
        const matching = members.flatMap(card => {
            if (context.category !== null) {
                // A related member may satisfy a category that the global representative does not.
                const category = editorialCategory(card) ?? (card.sourceIds.includes('news-unclassified') ? null : classifyNewsHeadline(card.title, card.sourceUrl));
                if (category !== context.category)
                    return [];
            }
            const geography = exploreGeography(card, context.city, code, aliases);
            return geography === null ? [] : [{ card, geography }];
        }).sort((a, b) => specificity[a.geography.scope] - specificity[b.geography.scope]);
        const match = matching[0];
        if (match === undefined)
            continue;
        // Group identity comes from the whole eligible corpus. Choose one genuinely
        // matching original, at its strongest supported scope, without cloning the
        // same event into city/country/world buckets or discarding other sources.
        const primary = match.card.id === view.card.id ? view : rankEditorialCards([match.card], now)[0];
        if (primary === undefined)
            throw Error('EXPLORE_EVIDENCE_MISSING');
        const related = Object.freeze(members.filter(card => card.id !== match.card.id));
        const groupedReason = primary === view ? '' : view.grouping === 'shared-event'
            ? ' Related coverage of the same identified story is grouped; reports may differ and are not independent confirmations.'
            : related.length ? ' Matching listings are grouped; they are not independent confirmations.' : '';
        groups[match.geography.scope].push(Object.freeze({ ...primary, storyKey: view.storyKey ?? JSON.stringify(['article', view.card.identity]),
            grouping: view.grouping, related, editorialReason: primary.editorialReason + groupedReason, explore: match.geography }));
    }
    const views = (scope) => Object.freeze(groups[scope].sort(compareEditorialCards));
    const local = views('city'), national = views('country'), world = views('world'), cards = Object.freeze([...local, ...national, ...world]);
    return Object.freeze({ cards, local, national, world, eligibleCount: eligible.reduce((count, view) => count + 1 + view.related.length, 0), matchedCount: cards.length });
}
