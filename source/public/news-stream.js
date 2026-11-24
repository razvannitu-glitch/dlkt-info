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
/** Proximity alone never loads a page: each rendered sentinel needs fresh downward reader intent. */
export function observeNewsStream(sentinel, next) {
    if (typeof IntersectionObserver !== 'function')
        return () => { };
    const doc = sentinel.ownerDocument, win = doc.defaultView;
    if (win === null)
        return () => { };
    let done = false, near = false, intentUntil = 0, intentTop = 0, intentNear = false, touchX = null, touchY = null;
    let observer = null;
    const interactive = (event, keyboard = false) => event.target instanceof Element
        && event.target.closest(keyboard ? 'dialog,[role="dialog"],[role="alertdialog"],input,textarea,select,button,a[href],summary,[contenteditable],[role="button"],[role="link"],[role="textbox"],[role="listbox"],[role="combobox"]'
            : 'dialog,[role="dialog"],[role="alertdialog"],input,textarea,select,[contenteditable],[role="textbox"],[role="listbox"],[role="combobox"]') !== null;
    const stop = () => {
        done = true;
        intentUntil = 0;
        touchX = null;
        touchY = null;
        observer?.disconnect();
        win.removeEventListener('wheel', wheel);
        win.removeEventListener('keydown', key);
        win.removeEventListener('touchstart', touchStart);
        win.removeEventListener('touchmove', touchMove);
        win.removeEventListener('touchend', touchEnd);
        win.removeEventListener('touchcancel', touchEnd);
        win.removeEventListener('blur', touchEnd);
        doc.removeEventListener('visibilitychange', touchEnd);
    };
    const advance = () => {
        const active = doc.activeElement;
        if (active instanceof Element && active.closest('dialog,[role="dialog"],[role="alertdialog"]') !== null) {
            intentUntil = 0;
            return;
        }
        if (done || !near || !sentinel.isConnected || doc.visibilityState !== 'visible' || intentUntil <= win.performance.now()
            || !intentNear && win.scrollY <= intentTop)
            return;
        stop();
        next();
    };
    const arm = () => {
        if (done || doc.visibilityState !== 'visible')
            return;
        intentUntil = win.performance.now() + 1000;
        intentTop = win.scrollY;
        intentNear = near;
        advance();
    };
    const wheel = (event) => {
        if (!event.isTrusted)
            return;
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || interactive(event)) {
            intentUntil = 0;
            return;
        }
        if (event.deltaY <= 0 || Math.abs(event.deltaX) > event.deltaY) {
            intentUntil = 0;
            return;
        }
        arm();
    };
    const key = (event) => {
        if (!event.isTrusted)
            return;
        if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || interactive(event, true)) {
            intentUntil = 0;
            return;
        }
        if (event.shiftKey || ['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
            intentUntil = 0;
            return;
        }
        if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key))
            arm();
    };
    const touchStart = (event) => {
        const point = event.isTrusted && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey && !interactive(event) && event.touches.length === 1 ? event.touches[0] : undefined;
        touchX = point?.clientX ?? null;
        touchY = point?.clientY ?? null;
        intentUntil = 0;
    };
    const touchMove = (event) => {
        if (!event.isTrusted || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || interactive(event) || event.touches.length !== 1) {
            touchX = null;
            touchY = null;
            intentUntil = 0;
            return;
        }
        const point = event.touches[0];
        if (touchX === null || touchY === null || point === undefined)
            return;
        const delta = touchY - point.clientY, sideways = Math.abs(touchX - point.clientX);
        if (Math.max(Math.abs(delta), sideways) < 8)
            return;
        if (delta <= 0 || sideways > delta) {
            touchX = null;
            touchY = null;
            intentUntil = 0;
            return;
        }
        touchX = point.clientX;
        touchY = point.clientY;
        arm();
    };
    const touchEnd = () => { touchX = null; touchY = null; intentUntil = 0; };
    try {
        observer = new IntersectionObserver(entries => {
            if (done)
                return;
            near = entries.some(entry => entry.target === sentinel && entry.isIntersecting);
            advance();
        }, { rootMargin: '600px 0px' });
        win.addEventListener('wheel', wheel, { passive: true });
        win.addEventListener('keydown', key, { passive: true });
        win.addEventListener('touchstart', touchStart, { passive: true });
        win.addEventListener('touchmove', touchMove, { passive: true });
        win.addEventListener('touchend', touchEnd, { passive: true });
        win.addEventListener('touchcancel', touchEnd, { passive: true });
        win.addEventListener('blur', touchEnd);
        doc.addEventListener('visibilitychange', touchEnd);
        observer.observe(sentinel);
        return stop;
    }
    catch {
        stop();
        return () => { };
    }
}
