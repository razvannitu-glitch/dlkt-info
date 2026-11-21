import { COMPARISON_MAX_AGE_MS } from './comparison.js';
import { editorialCategory, PUBLIC_EDITORIAL_CATEGORIES } from './editorial-categories.js';
import { PUBLIC_TOPICS } from './topics.js';
export const PUBLIC_EDITION_POLL_MS = 30_000;
/** Publisher content only. Rechecking a source or changing its homepage order is not news. */
export function editionCardSignature(card) {
    return JSON.stringify([card.id, card.identity, card.title, card.topic, card.kind, card.sourceUrl, card.publisher,
        card.date, card.dateLabel, card.summary ?? null, card.byline ?? null, card.licenseUrl ?? null,
        card.deadline, card.version, card.context ?? null]);
}
export function editionChanges(before, after) {
    const prior = new Map([...before.first, ...before.more].map(view => [view.card.id, editionCardSignature(view.card)]));
    const next = new Map([...after.first, ...after.more].map(view => [view.card.id, editionCardSignature(view.card)]));
    let added = 0, updated = 0, removed = 0;
    for (const [id, signature] of next) {
        const old = prior.get(id);
        if (old === undefined)
            added++;
        else if (old !== signature)
            updated++;
    }
    for (const id of prior.keys())
        if (!next.has(id))
            removed++;
    return Object.freeze({ added, updated, removed, total: added + updated + removed });
}
function current(view, now) {
    const published = Date.parse(view.card.date), observed = Date.parse(view.card.observedAt);
    return view.card.sourceState !== 'stale' && published <= now && published > now - 86_400_000
        && observed <= now + 300_000 && now - observed < COMPARISON_MAX_AGE_MS;
}
function withCards(base, first, more, now) {
    if (!base.daily)
        return Object.freeze({ first: Object.freeze(first), more: Object.freeze(more) });
    const selectedTopics = PUBLIC_TOPICS.filter(topic => first.some(view => view.card.topic === topic));
    const selectedCategories = PUBLIC_EDITORIAL_CATEGORIES.filter(category => first.some(view => (view.category ?? editorialCategory(view.card)) === category));
    return Object.freeze({ first: Object.freeze(first), more: Object.freeze(more), daily: Object.freeze({ ...base.daily,
            windowStart: new Date(now - 86_400_000).toISOString(), windowEnd: new Date(now).toISOString(),
            selectedTopics, selectedCategories, missingTopics: PUBLIC_TOPICS.filter(topic => !selectedTopics.includes(topic)),
            missingCategories: PUBLIC_EDITORIAL_CATEGORIES.filter(category => !selectedCategories.includes(category)),
            completeCoverage: selectedCategories.length === PUBLIC_EDITORIAL_CATEGORIES.length,
            belowMinimum: first.length < base.daily.minimum, belowTarget: first.length < base.daily.target }) });
}
/** In-memory reading state only. No profile, browsing history or saved card leaves this browser. */
export class LiveEdition {
    visible = null;
    context = '';
    present(candidate, context, now, apply = false) {
        if (!Number.isFinite(now))
            throw new Error('LIVE_EDITION_CLOCK_INVALID');
        if (this.visible === null || this.visible.first.length + this.visible.more.length === 0 || this.context !== context || apply) {
            this.visible = candidate;
            this.context = context;
        }
        else {
            const incoming = new Map([...candidate.first, ...candidate.more].map(view => [view.card.id, view]));
            // Same story, newly checked evidence: update metadata without rearranging the reading order.
            // Materially changed publisher wording stays staged until the reader applies it.
            const retain = (views) => views.flatMap(view => {
                const fresh = incoming.get(view.card.id);
                const copy = fresh && editionCardSignature(fresh.card) === editionCardSignature(view.card) ? fresh : view;
                return current(copy, now) ? [copy] : [];
            });
            this.visible = withCards(candidate, retain(this.visible.first), retain(this.visible.more), now);
        }
        return Object.freeze({ selection: this.visible, changes: editionChanges(this.visible, candidate) });
    }
}
export function editionUpdateLabel(changes) {
    const parts = [];
    if (changes.added)
        parts.push(`${changes.added} new`);
    if (changes.updated)
        parts.push(`${changes.updated} updated`);
    if (changes.removed)
        parts.push(`${changes.removed} no longer selected`);
    return parts.join(' · ');
}
export function publicEditionPollDelay(failures) {
    return Math.min(120_000, PUBLIC_EDITION_POLL_MS * 2 ** Math.max(0, Math.min(2, Math.trunc(failures))));
}
