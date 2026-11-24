import { validNewsPage, validNewsStorySourcesPage, newsOriginalLanguage, NEWS_SOURCE_PAGE_SIZE } from './news-page-contracts.js';
import { fetchNewsStorySources, NewsStorySourcesError } from './news-continuation.js';
import { resolveLocale, t } from './i18n-locale.js';
const CONTEXT_FIELDS = ['epoch', 'revision', 'generatedAt', 'startedAt', 'expiresAt', 'language', 'cityId', 'countryCode', 'period', 'filter'];
function original(item) {
    return item.kind === 'global' ? { kind: 'global', card: item.card } : { kind: 'local', card: item.card };
}
function contextOf(page) {
    return Object.freeze({ epoch: page.epoch, revision: page.revision, generatedAt: page.generatedAt, startedAt: page.startedAt, expiresAt: page.expiresAt,
        language: page.language, cityId: page.cityId, countryCode: page.countryCode, period: page.period, filter: page.filter, sourceScope: page.sourceScope ?? 'edition',
        day: page.day === null ? null : Object.freeze({ ...page.day }) });
}
function sameContext(expected, page) {
    if ((expected.sourceScope ?? 'edition') !== (page.sourceScope ?? 'edition') || CONTEXT_FIELDS.some(key => expected[key] !== page[key]))
        return false;
    const a = expected.day, b = page.day;
    return a === null ? b === null : b !== null && a.date === b.date && a.timeZone === b.timeZone && a.start === b.start && a.end === b.end;
}
function distinct(sources) {
    const ids = new Set(), identities = new Set(), urls = new Set();
    for (const source of sources) {
        const identity = source.kind === 'global' ? source.card.identity : source.card.sourceUrl;
        if (ids.has(source.card.id) || identities.has(identity) || urls.has(source.card.sourceUrl))
            return false;
        ids.add(source.card.id);
        identities.add(identity);
        urls.add(source.card.sourceUrl);
    }
    return true;
}
/** Validate one visible group against the fixed edition; the stream's current batch/cursor is unrelated. */
export function createNewsStorySourcesState(item, page, now = Date.now(), city) {
    if (!item.story || page.cityId !== null && city === undefined)
        return null;
    // The main-feed page may be a later batch. This one-item validation projection keeps
    // every edition count/context guard without revalidating twenty other cards per panel.
    if (!validNewsPage({ ...page, items: [item], nextCursor: null }, now, city))
        return null;
    return Object.freeze({ context: contextOf(page), storyKey: item.story.key, sourceTotal: item.story.sourceTotal,
        sources: Object.freeze([original(item), ...item.story.related]), nextCursor: item.story.nextSourcesCursor, usedCursors: Object.freeze([]) });
}
/** All-or-nothing append: a rejected response cannot change the retained original reports or cursor. */
export function appendNewsStorySources(state, value, now = Date.now(), city) {
    if (state.nextCursor === null || Date.parse(state.context.expiresAt) <= now || !validNewsStorySourcesPage(value, now, city)
        || !sameContext(state.context, value) || value.storyKey !== state.storyKey || value.sourceTotal !== state.sourceTotal
        || value.offset !== state.sources.length || value.nextCursor !== null && (value.nextCursor === state.nextCursor || state.usedCursors.includes(value.nextCursor)))
        return null;
    const sources = Object.freeze([...state.sources, ...value.sources]);
    if (!distinct(sources) || sources.length > state.sourceTotal || (value.nextCursor === null) !== (sources.length === state.sourceTotal))
        return null;
    return Object.freeze({ ...state, sources, nextCursor: value.nextCursor, usedCursors: Object.freeze([...state.usedCursors, state.nextCursor]) });
}
function publishedAt(source) {
    return source.kind === 'global' ? source.card.date : source.card.news.publishedAt;
}
function sourceNode(source, locale, timeZone) {
    const row = document.createElement('li'), meta = document.createElement('p'), publisher = document.createElement('strong'), date = document.createElement('time'), link = document.createElement('a');
    meta.className = 'news-story-source-meta';
    publisher.textContent = source.card.publisher;
    publisher.dir = 'auto';
    date.dateTime = publishedAt(source);
    date.textContent = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(date.dateTime));
    date.title = date.dateTime;
    date.setAttribute('aria-label', t(locale, 'published') + ': ' + date.textContent);
    link.className = 'news-story-source-link';
    link.href = source.card.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = source.card.title;
    link.title = source.card.sourceUrl;
    link.dir = 'auto';
    const originalLanguage = newsOriginalLanguage(source), language = document.createElement('span');
    link.lang = originalLanguage ?? '';
    link.setAttribute('translate', 'no');
    language.dataset.originalLanguage = originalLanguage ?? 'unknown';
    language.textContent = originalLanguage ? (new Intl.DisplayNames([locale], { type: 'language' }).of(originalLanguage) ?? originalLanguage) : locale === 'ro' ? 'Limba sursei neprecizata' : locale === 'it' ? 'Lingua della fonte non specificata' : 'Source language unspecified';
    meta.append(publisher, document.createTextNode(' · '), date, document.createTextNode(' · '), language);
    row.append(meta, link);
    return row;
}
/** Inert until the reader explicitly requests more originals from a connected, open disclosure. */
export function newsStorySourcesNode(item, page, language, city) {
    const initial = createNewsStorySourcesState(item, page, Date.now(), city);
    if (!initial)
        return null;
    let state = initial, request = null, expired = false;
    const locale = resolveLocale(language), timeZone = page.day?.timeZone ?? city?.timezone ?? 'UTC';
    const details = document.createElement('details'), summary = document.createElement('summary'), note = document.createElement('p'), list = document.createElement('ol'), progress = document.createElement('p'), more = document.createElement('button'), status = document.createElement('p');
    details.className = 'news-story-sources';
    details.dataset.storyKey = state.storyKey;
    summary.textContent = t(locale, 'navSources') + ' · ' + new Intl.NumberFormat(locale).format(state.sourceTotal);
    const publishers = document.createElement('span');
    publishers.className = 'news-story-publishers';
    publishers.dir = 'auto';
    publishers.setAttribute('translate', 'no');
    publishers.textContent = [...new Set(state.sources.map(source => source.card.publisher))].slice(0, 3).join(' · ');
    summary.append(publishers);
    details.dataset.sourceTotal = String(state.sourceTotal);
    note.className = 'news-story-sources-note';
    note.textContent = t(locale, 'storyReportsNote');
    list.className = 'news-story-sources-list';
    progress.className = 'news-story-sources-progress';
    more.className = 'news-story-sources-more';
    more.type = 'button';
    status.className = 'news-story-sources-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const update = () => {
        progress.textContent = t(locale, 'navSources') + ': ' + new Intl.NumberFormat(locale).format(state.sources.length) + ' / ' + new Intl.NumberFormat(locale).format(state.sourceTotal);
        const remaining = state.sourceTotal - state.sources.length;
        more.hidden = state.nextCursor === null;
        more.disabled = expired;
        // Keep keyboard focus during loading; the request guard prevents repeated activation.
        more.setAttribute('aria-disabled', String(request !== null || expired));
        more.textContent = request !== null ? t(locale, 'checkingSources') : t(locale, 'showMore', { count: Math.min(NEWS_SOURCE_PAGE_SIZE, remaining), remaining });
    };
    const markExpired = () => { expired = true; status.textContent = t(locale, 'followStale'); update(); };
    const loadMore = async () => {
        if (!details.isConnected || !details.open || request !== null || state.nextCursor === null || expired)
            return;
        if (Date.parse(state.context.expiresAt) <= Date.now()) {
            markExpired();
            return;
        }
        const controller = new AbortController();
        request = controller;
        details.setAttribute('aria-busy', 'true');
        status.textContent = '';
        update();
        try {
            const value = await fetchNewsStorySources(state.nextCursor, controller.signal, city);
            if (request !== controller || !details.isConnected || !details.open)
                return;
            const next = appendNewsStorySources(state, value, Date.now(), city);
            if (!next) {
                if (Date.parse(state.context.expiresAt) <= Date.now())
                    throw new NewsStorySourcesError('expired');
                throw new NewsStorySourcesError('unavailable');
            }
            const additions = next.sources.slice(state.sources.length).map(source => sourceNode(source, locale, timeZone)), focusMore = document.activeElement === more;
            list.append(...additions);
            state = next;
            request = null;
            update();
            status.textContent = progress.textContent;
            if (focusMore)
                additions[0]?.querySelector('a')?.focus();
        }
        catch (error) {
            if (request !== controller || !details.isConnected || !details.open)
                return;
            if (error instanceof NewsStorySourcesError && error.code === 'expired')
                markExpired();
            else
                status.textContent = t(locale, 'storiesUnavailable') + ' ' + t(locale, 'refreshHint');
        }
        finally {
            if (request === controller)
                request = null;
            if (request === null) {
                details.removeAttribute('aria-busy');
                update();
            }
        }
    };
    more.addEventListener('click', () => { void loadMore(); });
    details.addEventListener('toggle', () => {
        if (!details.open && request !== null) {
            request.abort();
            request = null;
            details.removeAttribute('aria-busy');
            status.textContent = '';
            update();
        }
    });
    for (const source of state.sources)
        list.append(sourceNode(source, locale, timeZone));
    details.append(summary, note, list, progress, more, status);
    update();
    return details;
}
