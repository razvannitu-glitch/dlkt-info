import { COMPARISON_MAX_AGE_MS } from './comparison.js';
import { groupStories } from './story-grouping.js';
/** The caller validates the full snapshot first. Only current checked records enter a disclosure. */
export function followStoryContext(snapshot, baselines, now) {
    const available = new Set(snapshot.sources.filter(source => (source.state === 'verified' || source.state === 'partial') && source.error === null
        && source.verifiedAt !== null && Date.parse(source.verifiedAt) <= now + 300_000 && now - Date.parse(source.verifiedAt) <= COMPARISON_MAX_AGE_MS).map(source => source.id));
    const records = snapshot.cards.filter(card => card.sourceState !== 'stale' && Date.parse(card.observedAt) <= now + 300_000
        && now - Date.parse(card.observedAt) <= COMPARISON_MAX_AGE_MS && card.sourceIds.some(id => available.has(id)));
    const byRecord = new Map();
    for (const group of groupStories(records))
        for (const card of [group.card, ...group.related])
            byRecord.set(card.id, group);
    const knownKeys = new Set(), knownIdentities = new Set();
    for (const baseline of baselines)
        for (const group of groupStories(baseline.records)) {
            knownKeys.add(group.key);
            for (const card of [group.card, ...group.related])
                knownIdentities.add(card.identity);
        }
    return { byRecord, knownKeys, knownIdentities };
}
function order(a, b) {
    return Number(b.kind === 'listing-updated') - Number(a.kind === 'listing-updated')
        || b.card.date.localeCompare(a.card.date) || a.card.id.localeCompare(b.card.id);
}
/** Preserve the validated per-article comparison; select one attributed change per reading thread. */
export function followedStoryChanges(changes, context) {
    const grouped = new Map();
    for (const difference of changes) {
        const group = context.byRecord.get(difference.card.id);
        if (!group)
            throw Error('CATEGORY_FOLLOW_STORY_CHECK_REQUIRED');
        const item = grouped.get(group.key) ?? { group, changes: [] };
        item.changes.push(difference);
        grouped.set(group.key, item);
    }
    return [...grouped.values()].map(({ group, changes: members }) => {
        const originals = [group.card, ...group.related], primary = [...members].sort(order)[0];
        if (!primary)
            throw Error('CATEGORY_FOLLOW_STORY_CHECK_REQUIRED');
        const known = context.knownKeys.has(group.key) || originals.some(card => context.knownIdentities.has(card.identity));
        const corrected = members.some(change => change.kind === 'listing-updated');
        return { ...primary, kind: known || corrected ? 'listing-updated' : 'not-in-saved-check', storyKey: group.key,
            related: originals.filter(card => card.id !== primary.card.id), coverageOnly: known && !corrected };
    }).sort((a, b) => b.card.date.localeCompare(a.card.date) || a.card.id.localeCompare(b.card.id));
}
/** Cross-category summaries count one event once; prefer an actual attributed correction over added coverage. */
export function uniqueFollowStories(changes) {
    const unique = new Map();
    for (const change of changes) {
        const previous = unique.get(change.storyKey);
        if (!previous || Number(previous.coverageOnly) > Number(change.coverageOnly)
            || previous.coverageOnly === change.coverageOnly && order(change, previous) < 0)
            unique.set(change.storyKey, change);
    }
    return [...unique.values()].sort((a, b) => b.card.date.localeCompare(a.card.date) || a.card.id.localeCompare(b.card.id));
}
