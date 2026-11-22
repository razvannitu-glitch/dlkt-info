import { readingCard } from './reader.js';
import { editorialCategory } from './editorial-categories.js';
import { NEWS_CATEGORIES, newsCategory } from './news-taxonomy.js';
export const NEWS_PAGE_SIZE = 20;
/** Layout-only generator: a fixed edition seed reproduces every category cycle. */
function categoryRandom(seed) {
    let state = 0x811c9dc5;
    for (let index = 0; index < seed.length; index++)
        state = Math.imul(state ^ seed.charCodeAt(index), 0x01000193) >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}
/** One report per active category per shuffled cycle; queue order preserves editorial relevance. */
function diversify(items, seed) {
    const categories = new Map();
    for (const item of items) {
        const key = item.category ?? 'other', queue = categories.get(key) ?? { items: [], index: 0 };
        queue.items.push(item);
        categories.set(key, queue);
    }
    const ordered = [], random = categoryRandom(seed);
    let previous = null;
    while (ordered.length < items.length) {
        const cycle = [...categories.keys()].filter(key => { const queue = categories.get(key); return queue.index < queue.items.length; }).sort();
        if (cycle.length === 0)
            break;
        for (let index = cycle.length - 1; index > 0; index--) {
            const swap = Math.floor(random() * (index + 1));
            [cycle[index], cycle[swap]] = [cycle[swap], cycle[index]];
        }
        // A new cycle cannot immediately repeat the previous category while another queue is available.
        if (cycle.length > 1 && cycle[0] === previous) {
            const swap = 1 + Math.floor(random() * (cycle.length - 1));
            [cycle[0], cycle[swap]] = [cycle[swap], cycle[0]];
        }
        for (const key of cycle) {
            const queue = categories.get(key);
            ordered.push(queue.items[queue.index++]);
            previous = key;
        }
    }
    return ordered;
}
/**
 * Inputs already passed source freshness, identity, language and conflict validation. Never change their records.
 * Keep seed fixed for the visible edition and language. Filters and page appends only project this full order.
 */
export function selectNewsStream(today, local, now, filter = 'all', seed = 'news-stream-v1') {
    if (!Number.isFinite(now) || typeof seed !== 'string' || !seed.trim() || seed.length > 1024 || !['all', 'other', ...NEWS_CATEGORIES.map(category => category.id)].includes(filter))
        throw Error('NEWS_STREAM_CONTEXT_INVALID');
    const pool = [], ids = new Set(), identities = new Set(), urls = new Set();
    const add = (item, id, identity) => {
        if (ids.has(id) || identities.has(identity) || urls.has(item.url))
            return false;
        ids.add(id);
        identities.add(identity);
        urls.add(item.url);
        pool.push(Object.freeze(item));
        return true;
    };
    const original = (card, group) => {
        if (card.kind !== 'publication')
            return null;
        const category = editorialCategory(card);
        const view = Object.freeze({ ...readingCard(card, now), reason: card.id === group.card.id ? group.reason : 'A distinct original report in the current source selection.', localMatch: card.id === group.card.id && group.localMatch, grouping: 'single', storyKey: 'article:' + card.identity, ...(category === null ? {} : { category }) });
        return { kind: 'global', view, key: 'article:' + card.id, url: card.sourceUrl, publisher: card.publisher, publishedAt: card.date, category: newsCategory(card) };
    };
    // Preserve the supplied editorial order within each category, including related original reports.
    for (const group of [...today.first, ...today.more])
        for (const card of [group.card, ...group.related]) {
            const item = original(card, group);
            if (item)
                add(item, card.id, card.identity);
        }
    for (const card of local) {
        if (card.kind !== 'local-news' || !card.news)
            continue;
        add({ kind: 'local', card, key: 'local:' + card.id, url: card.sourceUrl, publisher: card.publisher, publishedAt: card.news.publishedAt, category: newsCategory(card) }, card.id, card.sourceUrl);
    }
    const items = Object.freeze(diversify(pool, seed)), counts = { other: 0 };
    for (const category of NEWS_CATEGORIES)
        counts[category.id] = 0;
    for (const item of items) {
        const key = item.category ?? 'other';
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.freeze({ items, filtered: Object.freeze(items.filter(item => filter === 'all' || (item.category ?? 'other') === filter)), counts: Object.freeze(counts), total: items.length, highlighted: 0, filter });
}
export function newsStreamPage(selection, visible = NEWS_PAGE_SIZE) {
    if (!Number.isSafeInteger(visible) || visible < NEWS_PAGE_SIZE)
        throw Error('NEWS_STREAM_PAGE_INVALID');
    return Object.freeze(selection.filtered.slice(0, visible));
}
/** One observer per rendered page. The manual button remains usable when observation is unavailable. */
export function observeNewsStream(sentinel, next) {
    if (typeof IntersectionObserver !== 'function')
        return () => { };
    let done = false;
    try {
        const observer = new IntersectionObserver(entries => {
            if (done || !entries.some(entry => entry.isIntersecting))
                return;
            done = true;
            observer.disconnect();
            next();
        }, { rootMargin: '600px 0px' });
        observer.observe(sentinel);
        return () => { done = true; observer.disconnect(); };
    }
    catch {
        return () => { };
    }
}
