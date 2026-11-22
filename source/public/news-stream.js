import { readingCard } from './reader.js';
import { editorialCategory } from './editorial-categories.js';
import { NEWS_CATEGORIES, newsCategory } from './news-taxonomy.js';
export const NEWS_PAGE_SIZE = 20;
/** Round-robin subjects and publishers affect order only. Every original article is retained. */
function diversify(items) {
    const categories = new Map();
    for (const item of items) {
        const key = item.category ?? 'other', publishers = categories.get(key) ?? new Map();
        const publisher = item.publisher.normalize('NFKC').trim().toLowerCase(), queue = publishers.get(publisher) ?? { items: [], index: 0 };
        queue.items.push(item);
        publishers.set(publisher, queue);
        categories.set(key, publishers);
    }
    const ordered = [], used = new Map();
    while (ordered.length < items.length) {
        let added = false;
        for (const publishers of categories.values()) {
            const candidates = [...publishers].filter(([, queue]) => queue.index < queue.items.length).sort(([a, x], [b, y]) => (used.get(a) ?? 0) - (used.get(b) ?? 0) || Date.parse(y.items[y.index].publishedAt) - Date.parse(x.items[x.index].publishedAt) || a.localeCompare(b));
            const next = candidates[0];
            if (!next)
                continue;
            const [publisher, queue] = next, item = queue.items[queue.index++];
            if (!item)
                continue;
            ordered.push(item);
            used.set(publisher, (used.get(publisher) ?? 0) + 1);
            added = true;
        }
        if (!added)
            break;
    }
    return ordered;
}
/** Inputs already passed source freshness, identity, language and conflict validation. Never change their records. */
export function selectNewsStream(today, local, now, filter = 'all') {
    if (!Number.isFinite(now) || !['all', 'other', ...NEWS_CATEGORIES.map(category => category.id)].includes(filter))
        throw Error('NEWS_STREAM_CONTEXT_INVALID');
    const pool = [], leading = [], ids = new Set(), identities = new Set(), urls = new Set();
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
    // Preserve up to six distinct primary reports; the complete corpus below has no count limit.
    for (const group of today.first) {
        if (leading.length === 6)
            break;
        const item = original(group.card, group);
        if (item && add(item, group.card.id, group.card.identity))
            leading.push(item);
    }
    for (const card of local) {
        if (card.kind !== 'local-news' || !card.news)
            continue;
        add({ kind: 'local', card, key: 'local:' + card.id, url: card.sourceUrl, publisher: card.publisher, publishedAt: card.news.publishedAt, category: newsCategory(card) }, card.id, card.sourceUrl);
    }
    for (const group of [...today.first, ...today.more])
        for (const card of [group.card, ...group.related]) {
            const item = original(card, group);
            if (item)
                add(item, card.id, card.identity);
        }
    pool.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.key.localeCompare(b.key));
    const ordered = diversify(pool), leadingKeys = new Set(leading.map(item => item.key));
    const items = Object.freeze(filter === 'all' ? [...leading, ...ordered.filter(item => !leadingKeys.has(item.key))] : ordered), counts = { other: 0 };
    for (const category of NEWS_CATEGORIES)
        counts[category.id] = 0;
    for (const item of items) {
        const key = item.category ?? 'other';
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.freeze({ items, filtered: Object.freeze(items.filter(item => filter === 'all' || (item.category ?? 'other') === filter)), counts: Object.freeze(counts), total: items.length, highlighted: filter === 'all' ? leading.length : 0, filter });
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
